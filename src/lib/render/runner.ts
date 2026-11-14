/**
 * THE RUNNER — executes the declared pipeline for one job and writes exactly
 * what happened.
 *
 * THREE RULES IT ENFORCES, because a plausible-looking success is a failure:
 *
 *   1. A stage runs only if EVERY requisite probe passes. When one fails the
 *      stage gets a row in state BLOCKED carrying the probe's own evidence and
 *      the named missing input, and the pipeline STOPS there. Later stages get
 *      NO ROW AT ALL — the read-out derives "not reached" from the absence of a
 *      row, so the database never says a stage happened when it did not.
 *   2. A stage that declares a `file` produce must return a file that exists on
 *      disk with the byte count and SHA-256 it claims. Missing, unreadable, or
 *      mismatched bytes → the row is FAILED and NO artefact row is written.
 *      This is what makes "zero artefacts" a count rather than a claim.
 *   3. Progress is computed from the SUCCEEDED rows and their declared weights,
 *      after every stage, and the arithmetic is recorded on the row.
 *
 * Stopping is real: `stopRequestedAt` is re-read before every stage, and the
 * stage that would have run gets a STOPPED row with the stored reason.
 */
import { existsSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  PIPELINE_STAGES,
  deriveJobStatus,
  deriveProgress,
  stageById,
  type DerivedJobStatus,
  type RenderStage,
  type StageState,
  type StageRowView,
} from "./pipeline";
import { PROBES, renderOutputDir, runProbe, type Probe, type ProbeId, type ProbeResult } from "./probes";
import { EXECUTORS, sha256File, type StageExecutor } from "./executors";
import { findExportPreset, resolvedSpecCore } from "@/lib/export/presets";
import { encodeCommandPlan } from "@/lib/export/youtube-master";
import { sha256OfJson } from "@/lib/export/spec-fingerprint";
import { SYNTHETIC_MARKER } from "./synthetic-source";
import {
  AttemptAlreadyRunError,
  StageFailure,
  type ProjectFacts,
  type RenderJobFacts,
  type RenderAttemptFacts,
  type StageFile,
  type StageOutcome,
} from "./types";
import { encoderProbe, METERED_PROBE_IDS, stageRun, type MeterResult } from "@/lib/usage/metering";
import type { UsageEventInput } from "@/lib/usage/types";
import { HEARTBEAT_INTERVAL_MS, currentProcessIdentity } from "./attempt";
import { computeResumePoint, type HistoryArtefact, type HistoryRow } from "./recovery";

/** The persistence the runner needs. Implemented over Prisma in `./store.ts`. */
export interface RenderStore {
  readJob(jobId: string): Promise<RenderJobFacts | null>;
  startJob(jobId: string, at: Date): Promise<void>;
  finishJob(jobId: string, at: Date): Promise<void>;
  /* --- attempts (Phase 8 block 6) ------------------------------------- */
  /** Creates the RUNNING attempt row and returns its id. */
  createAttempt(input: {
    jobId: string;
    attemptNumber: number;
    startStageId: string;
    continuedFromId: string | null;
    startedAt: Date;
    owner: { host: string; pid: number; procStart: string | null };
  }): Promise<string>;
  readAttempt(attemptId: string): Promise<RenderAttemptFacts | null>;
  latestAttempt(jobId: string): Promise<RenderAttemptFacts | null>;
  /** Stamps the attempt as alive and names the stage it is working in. */
  heartbeat(attemptId: string, at: Date, lastStageId: string | null): Promise<void>;
  finishAttempt(
    attemptId: string,
    patch: {
      state: "SUCCEEDED" | "FAILED" | "BLOCKED" | "STOPPED";
      finishedAt: Date;
      endedReason: string;
      reusedArtefacts?: unknown;
    },
  ): Promise<void>;
  /** Every stage row and artefact row this job has, from every attempt. Read-only. */
  stageHistory(jobId: string): Promise<{ rows: HistoryRow[]; artefacts: HistoryArtefact[] }>;
  /** Creates the RUNNING row and returns its id. */
  createStageRun(input: {
    jobId: string;
    attemptId: string;
    stageId: string;
    sequence: number;
    startedAt: Date;
    /** Carried onto the row itself, so one row is enough to read what it belongs to. */
    syntheticProof: boolean;
  }): Promise<string>;
  finishStageRun(
    runId: string,
    patch: {
      state: StageState;
      finishedAt: Date;
      blockedReason?: string | null;
      missingInput?: string | null;
      output?: unknown;
      artefactCount: number;
      errorMessage?: string | null;
    },
  ): Promise<void>;
  createArtefact(input: {
    jobId: string;
    stageRunId: string;
    stageId: string;
    file: StageFile;
    createdAt: Date;
    /** Same marking as the job: a synthetic-proof output is never a user's video. */
    syntheticProof: boolean;
  }): Promise<void>;
  /**
   * RECORDS METERED WORK (Phase 8, block 5). Optional so an in-memory store in a
   * test meters nothing, while `prismaRenderStore()` -- the only store a real run
   * uses -- writes the row. The runner calls this at the moment each action
   * happens: a stage row is metered when it is finished, a probe when it is run.
   */
  recordUsage?(input: UsageEventInput): Promise<MeterResult>;
  projectFacts(projectId: string): Promise<ProjectFacts>;
}

/**
 * What the run managed to METER (Phase 8, block 5). A stage that ran but could
 * not be recorded is reported here rather than hidden: the pipeline's job is the
 * video, and its accounting must not pretend to be complete when it is not.
 */
export interface MeteringOutcome {
  recorded: number;
  failed: Array<{ kind: string; error: string }>;
}
export interface RunResult {
  jobId: string;
  /** The attempt this run was (Phase 8 block 6). */
  attemptId: string;
  attemptNumber: number;
  /** The stage this attempt started at, and the stages it honoured instead of re-running. */
  startStageId: string;
  honouredStageIds: string[];
  status: DerivedJobStatus;
  /** The rows THIS attempt wrote. Honoured stages have no row here — they did not run. */
  stageRows: StageRowView[];
  artefactsWritten: number;
  /** File artefacts reused from an earlier attempt, with the digest each was verified against. */
  reusedArtefacts: Array<{ stageId: string; kind: string; path: string; sha256: string; fromAttemptNumber: number }>;
  /** Artefacts an earlier attempt recorded that could NOT be reused, and why. */
  refusedReuse: Array<{ stageId: string; kind: string; path: string; detail: string }>;
  /** The stage that stopped the pipeline, and why. */
  halted: { stageId: string; state: "BLOCKED" | "FAILED" | "STOPPED"; reason: string; missingInput: string | null } | null;
  progress: ReturnType<typeof deriveProgress>;
  /** Usage rows this run wrote, and any it could not write. */
  metering: MeteringOutcome;
}

export interface RunDeps {
  store: RenderStore;
  /**
   * The attempt to run. The enqueue/retry path creates it and passes its id, so
   * the rows and the queue message agree. When it is absent — a job queued by an
   * older build — the runner creates the next attempt itself, starting where
   * `computeResumePoint` says, which is the same rule a retry uses.
   */
  attemptId?: string;
  /** Test seams — production passes nothing and gets the real registry. */
  stages?: readonly RenderStage[];
  probes?: Record<ProbeId, Probe>;
  executors?: Record<string, StageExecutor>;
  outputRoot?: string;
  now?: () => Date;
}

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
/**
 * Meters one action, and never lets an accounting failure change the run: the
 * stage has already happened, so a refusal to record it is collected into
 * `RunResult.metering` rather than thrown.
 */
async function meterAction(
  store: RenderStore,
  input: UsageEventInput,
  into: MeteringOutcome,
): Promise<void> {
  if (!store.recordUsage) return;
  const result = await store.recordUsage(input);
  if (result.recorded) into.recorded += 1;
  else into.failed.push({ kind: input.kind, error: result.error ?? "not recorded" });
}

/**
 * WHAT A GATED FILE STAGE WOULD HAVE RUN WITH (Phase 8, block 2a).
 *
 * A blocked encode row used to say only "ffmpeg is missing". That is true but
 * uninformative: it does not show WHICH encode it was blocked from doing. This
 * builds the exact specification and the exact argv the stage would spawn, from
 * the job's own recorded spec, so the gate gets more informative — and it is
 * still a gate: `missingInput` names the binary, nothing runs, no file exists.
 *
 * `specMatchesRecord` compares the live catalogue's digest for this preset with
 * the digest recorded on the job at enqueue time. When a preset is edited later,
 * a job re-read months afterwards says so instead of quietly running different
 * numbers.
 */
function wouldRunWith(job: RenderJobFacts): Record<string, unknown> | null {
  const live = findExportPreset(job.presetId);
  if (!live) {
    return {
      resolved: false,
      reason: `preset "${job.presetId}" is not in the catalogue any more, so no specification can be shown for it`,
      recordedSpecSha256: job.presetSpecSha256,
    };
  }
  const liveDigest = sha256OfJson(resolvedSpecCore(live));
  return {
    resolved: true,
    presetId: live.id,
    presetLabel: live.label,
    spec: resolvedSpecCore(live),
    recordedSpec: job.presetSpec ?? null,
    recordedSpecSha256: job.presetSpecSha256,
    liveSpecSha256: liveDigest,
    specMatchesRecord: job.presetSpecSha256 !== null && job.presetSpecSha256 === liveDigest,
    command: encodeCommandPlan(live),
    producedNothing: true,
    note:
      "This is what the stage WOULD run with. Nothing ran and no file exists: the missing input named on this row is " +
      "the encoder binary itself.",
  };
}

/**
 * Verify a `file` stage's declared artefact really exists on disk with the
 * bytes and digest it claims. Returns the verified file or throws StageFailure.
 */
function verifyDeclaredFile(stage: RenderStage, outcome: StageOutcome): StageFile {
  const kind = stage.produces.artefactKind;
  if (!kind) {
    throw new StageFailure(`${stage.id} declares a file produce but names no artefactKind — the declaration is broken.`);
  }
  const file = (outcome.files ?? []).find((f) => f.artefactKind === kind);
  if (!file) {
    throw new StageFailure(
      `${stage.id} declared it produces "${kind}" and returned no such file — a stage does not succeed without its declared artefact.`,
    );
  }
  if (!existsSync(file.path)) {
    throw new StageFailure(`${stage.id} returned "${kind}" at ${file.path} but nothing exists at that path.`);
  }
  const size = statSync(file.path).size;
  if (size <= 0) throw new StageFailure(`${stage.id} wrote a 0-byte "${kind}" at ${file.path}.`);
  if (size !== file.bytes) {
    throw new StageFailure(`${stage.id} claims ${file.bytes} bytes for "${kind}" but the file is ${size} bytes.`);
  }
  const measured = sha256File(file.path);
  if (measured.sha256 !== file.sha256) {
    throw new StageFailure(
      `${stage.id} claims SHA-256 ${file.sha256} for "${kind}" but the bytes hash to ${measured.sha256}.`,
    );
  }
  return file;
}

/** Look at a file an earlier attempt recorded, and report what is really there. */
export function probeArtefactFile(artefact: HistoryArtefact): {
  present: boolean;
  bytes: number | null;
  sha256: string | null;
  detail: string;
} {
  if (!existsSync(artefact.path)) {
    return {
      present: false,
      bytes: null,
      sha256: null,
      detail: `the file recorded for "${artefact.kind}" is not on disk at ${artefact.path} — a reset or a cleanup removed it, so the row cannot be reused`,
    };
  }
  const size = statSync(artefact.path).size;
  const measured = sha256File(artefact.path);
  if (size !== artefact.bytes || measured.sha256 !== artefact.sha256) {
    return {
      present: true,
      bytes: size,
      sha256: measured.sha256,
      detail:
        `the file at ${artefact.path} is ${size} bytes / ${measured.sha256.slice(0, 16)}… but the row records ` +
        `${artefact.bytes} bytes / ${artefact.sha256.slice(0, 16)}… — the bytes are not the ones that were recorded, so the row is not reused`,
    };
  }
  return {
    present: true,
    bytes: size,
    sha256: measured.sha256,
    detail: `re-measured ${size} bytes / ${measured.sha256.slice(0, 16)}… at ${artefact.path} — identical to the row`,
  };
}

export async function runRenderPipeline(jobId: string, deps: RunDeps): Promise<RunResult> {
  const store = deps.store;
  const stages = deps.stages ?? PIPELINE_STAGES;
  const probes = deps.probes ?? PROBES;
  const executors = deps.executors ?? EXECUTORS;
  const outputRoot = deps.outputRoot ?? renderOutputDir();
  const now = deps.now ?? (() => new Date());

  const job = await store.readJob(jobId);
  if (!job) throw new Error(`render job ${jobId} does not exist`);

  const facts = await store.projectFacts(job.projectId);
  const probeCtx = {
    projectId: job.projectId,
    outputDir: outputRoot,
    projectFacts: async () => ({ sceneCount: (await store.projectFacts(job.projectId)).sceneCount }),
  };

  /* ------------------------------------------------------------------ *
   * THE ATTEMPT (Phase 8 block 6)
   *
   * Everything below is recorded against ONE attempt. A retry is a new
   * attempt: the earlier attempt's rows are read here and never written.
   * ------------------------------------------------------------------ */
  const history = await store.stageHistory(jobId);
  const attemptNumbers = new Map<string, number>();
  for (const r of history.rows) attemptNumbers.set(r.attemptId, r.attemptNumber);
  const resume = computeResumePoint({
    stages,
    attempts: [...attemptNumbers].map(([id, attemptNumber]) => ({ id, attemptNumber })),
    rows: history.rows,
    artefacts: history.artefacts,
    probe: probeArtefactFile,
  });

  let attempt: RenderAttemptFacts;
  if (deps.attemptId) {
    const found = await store.readAttempt(deps.attemptId);
    if (!found) throw new Error(`render attempt ${deps.attemptId} does not exist`);
    if (found.jobId !== jobId) throw new Error(`render attempt ${deps.attemptId} belongs to job ${found.jobId}, not ${jobId}`);
    attempt = found;
  } else {
    // A job queued by an older build carries no attempt. The runner creates one
    // under exactly the rule a retry uses, so there is one rule, not two.
    const latest = await store.latestAttempt(jobId);
    const attemptNumber = (latest?.attemptNumber ?? 0) + 1;
    const id = await store.createAttempt({
      jobId,
      attemptNumber,
      startStageId: resume.startStageId ?? stages[0].id,
      continuedFromId: latest?.id ?? null,
      startedAt: now(),
      owner: currentProcessIdentity(),
    });
    const created = await store.readAttempt(id);
    if (!created) throw new Error(`the attempt row ${id} was created but could not be read back`);
    attempt = created;
  }
  const attemptId = attempt.id;

  /* ------------------------------------------------------------------ *
   * AN ATTEMPT RUNS AT MOST ONCE
   *
   * The queue can hand the same attempt to the runner twice — a stalled or
   * re-delivered message — and `RenderStageRun` is unique on
   * `(attemptId, stageId)`. A second execution therefore collided with the
   * FIRST execution's own row and threw `Unique constraint failed on
   * (attemptId, stageId)` mid-render. The refusal belongs here, before the job
   * is started and before a single row is written: an attempt that already has
   * stage rows has already run, and re-running it would overwrite the record it
   * made. A retry is a NEW attempt; this one is refused, typed and quiet.
   * ------------------------------------------------------------------ */
  const rowsForAttempt = history.rows.filter((r) => r.attemptId === attemptId);
  if (rowsForAttempt.length > 0) {
    throw new AttemptAlreadyRunError(jobId, attemptId, rowsForAttempt.length);
  }

  const startSeq = stageById(attempt.startStageId)?.sequence ?? stages[0].sequence;

  // Stages before the start point are HONOURED: their rows stay where they are
  // and their files are reused, verified, rather than produced again.
  const honouredStageIds = stages.filter((s) => s.sequence < startSeq).map((s) => s.id);
  const reusedArtefacts = resume.reused.filter((r) => honouredStageIds.includes(r.stageId));
  const refusedReuse = resume.refused.filter((r) => honouredStageIds.includes(r.stageId));

  const rows: StageRowView[] = [];
  const artefacts: Record<string, StageFile> = {};
  let artefactsWritten = 0;
  let halted: RunResult["halted"] = null;
  const metering: MeteringOutcome = { recorded: 0, failed: [] };

  // Honoured stages count towards the JOB's progress exactly as they did when
  // they ran — the weight was earned then, and a retry does not un-earn it.
  for (const id of honouredStageIds) {
    const s = stageById(id);
    if (s) rows.push({ stageId: s.id, sequence: s.sequence, state: "SUCCEEDED" });
  }
  for (const r of reusedArtefacts) {
    artefacts[r.kind] = { artefactKind: r.kind, path: r.path, bytes: r.bytes, sha256: r.sha256 };
  }

  await store.startJob(jobId, now());

  /* The heartbeat: the attempt says it is alive, and names the stage it is in. */
  let currentStage: string | null = null;
  const beat = async () => {
    try {
      await store.heartbeat(attemptId, now(), currentStage);
    } catch {
      // A failed heartbeat must never change the run: the stage has already
      // happened, and the pipeline's job is the video.
    }
  };
  const heartbeatTimer = setInterval(() => void beat(), HEARTBEAT_INTERVAL_MS);
  if (typeof heartbeatTimer.unref === "function") heartbeatTimer.unref();

  try {
  for (const stage of stages) {
    if (stage.sequence < startSeq) continue;
    currentStage = stage.id;
    await beat();
    // A stop is re-read before every stage, so it takes effect between stages.
    const fresh = await store.readJob(jobId);
    if (fresh?.stopRequestedAt) {
      const runId = await store.createStageRun({ jobId, attemptId, stageId: stage.id, sequence: stage.sequence, startedAt: now(), syntheticProof: job.syntheticProof });
      const reason = fresh.stopReason ?? "stopped by the owner (no reason recorded)";
      await store.finishStageRun(runId, {
        state: "STOPPED",
        finishedAt: now(),
        blockedReason: `stopped before this stage ran: ${reason}`,
        missingInput: null,
        output: { stoppedBeforeRunning: true, reason },
        artefactCount: 0,
      });
      rows.push({ stageId: stage.id, sequence: stage.sequence, state: "STOPPED" });
      await meterAction(
        store,
        stageRun({
          userId: job.userId,
          projectId: job.projectId,
          renderJobId: jobId,
          stageId: stage.id,
          state: "STOPPED",
          synthetic: job.syntheticProof,
          detail: { reason },
        }),
        metering,
      );
      halted = { stageId: stage.id, state: "STOPPED", reason, missingInput: null };
      break;
    }

    // 1 — requisites. Every one is a live probe; a typed boolean cannot enter here.
    const evidence: ProbeResult[] = [];
    const missing: string[] = [];
    for (const req of stage.requires) {
      const probe = (probes as Partial<Record<ProbeId, Probe>>)[req.probeId];
      const result = probe
        ? await runProbe(req.probeId, probeCtx, probes)
        : {
            probeId: req.probeId,
            ok: false,
            detail: `no probe registered for "${req.probeId}"`,
            missing: `${req.missingLabel} — the pipeline names a probe that does not exist`,
            checkedAt: now().toISOString(),
          };
      evidence.push(result);
      if (METERED_PROBE_IDS.includes(result.probeId)) {
        await meterAction(
          store,
          encoderProbe({
            userId: job.userId,
            projectId: job.projectId,
            renderJobId: jobId,
            stageId: stage.id,
            probeId: result.probeId,
            ok: result.ok,
            synthetic: job.syntheticProof,
            detail: result.detail,
          }),
          metering,
        );
      }
      if (!result.ok) missing.push(result.missing ?? req.missingLabel);
    }
    // Reported (non-gating) probes: recorded so the read-out can say what else is absent.
    for (const probeId of stage.reports ?? []) {
      const reported = await runProbe(probeId, probeCtx, probes);
      evidence.push(reported);
      if (METERED_PROBE_IDS.includes(reported.probeId)) {
        await meterAction(
          store,
          encoderProbe({
            userId: job.userId,
            projectId: job.projectId,
            renderJobId: jobId,
            stageId: stage.id,
            probeId: reported.probeId,
            ok: reported.ok,
            synthetic: job.syntheticProof,
            detail: reported.detail,
          }),
          metering,
        );
      }
    }
    if (stage.requiresArtefactOf) {
      const need = stage.requiresArtefactOf;
      const present = artefacts[need.artefactKind];
      if (!present) {
        // Distinguish "the earlier stage never produced it" from "it produced it
        // and the file is no longer usable" — the second is what a retry after a
        // reset actually hits, and a person needs to know which one it is.
        const refused = refusedReuse.find((r) => r.kind === need.artefactKind);
        missing.push(
          refused
            ? `${need.label} — the "${need.artefactKind}" artefact recorded by an earlier attempt could not be reused: ${refused.detail}`
            : `${need.label} — stage "${need.stageId}" produced no "${need.artefactKind}" artefact`,
        );
      }
    }

    if (missing.length > 0) {
      const runId = await store.createStageRun({ jobId, attemptId, stageId: stage.id, sequence: stage.sequence, startedAt: now(), syntheticProof: job.syntheticProof });
      const missingInput = missing.join("; ");
      const blockedReason =
        `${stage.title} is gated: it needs ${missingInput}. Nothing was run and no file was written for this stage.`;
      // A file-producing stage also prints the exact specification and argv it
      // would run with. The gate is more informative; it is not weaker — the
      // missing input is still named, and nothing is executed.
      const plan = stage.produces.kind === "file" ? wouldRunWith(job) : null;
      await store.finishStageRun(runId, {
        state: "BLOCKED",
        finishedAt: now(),
        blockedReason,
        missingInput,
        output: plan ? { probes: evidence, producedNothing: true, wouldRunWith: plan } : { probes: evidence, producedNothing: true },
        artefactCount: 0,
      });
      rows.push({ stageId: stage.id, sequence: stage.sequence, state: "BLOCKED" });
      await meterAction(
        store,
        stageRun({
          userId: job.userId,
          projectId: job.projectId,
          renderJobId: jobId,
          stageId: stage.id,
          state: "BLOCKED",
          synthetic: job.syntheticProof,
          detail: { missingInput },
        }),
        metering,
      );
      halted = { stageId: stage.id, state: "BLOCKED", reason: blockedReason, missingInput };
      break;
    }

    // 2 — run it, and hold it to its declared output.
    const runId = await store.createStageRun({ jobId, attemptId, stageId: stage.id, sequence: stage.sequence, startedAt: now(), syntheticProof: job.syntheticProof });
    // A synthetic proof writes into its own marked directory. The marker is in
    // the PATH as well as in the row, so a file found on disk by someone who never
    // sees the database still cannot be mistaken for a project's render.
    const jobRoot = job.syntheticProof ? join(outputRoot, SYNTHETIC_MARKER) : outputRoot;
    const stageDir = join(jobRoot, jobId, stage.id);
    mkdirSync(stageDir, { recursive: true });
    try {
      const executor = executors[stage.id];
      if (!executor) throw new StageFailure(`${stage.id} has no executor registered — a declared stage must do something.`);
      const outcome = await executor({ job, facts, stageDir, artefacts });
      if (!outcome || typeof outcome !== "object" || !outcome.record || Object.keys(outcome.record).length === 0) {
        throw new StageFailure(`${stage.id} returned no record — a stage does not succeed with nothing to show.`);
      }
      const files: StageFile[] = [];
      if (stage.produces.kind === "file") files.push(verifyDeclaredFile(stage, outcome));
      for (const file of files) {
        await store.createArtefact({ jobId, stageRunId: runId, stageId: stage.id, file, createdAt: now(), syntheticProof: job.syntheticProof });
        artefacts[file.artefactKind] = file;
        artefactsWritten += 1;
      }
      const progressNow = deriveProgress([...rows, { stageId: stage.id, sequence: stage.sequence, state: "SUCCEEDED" }], stages);
      await store.finishStageRun(runId, {
        state: "SUCCEEDED",
        finishedAt: now(),
        artefactCount: files.length,
        output: { ...outcome.record, progressAfterStage: { percent: progressNow.percent, arithmetic: progressNow.arithmetic } },
      });
      rows.push({ stageId: stage.id, sequence: stage.sequence, state: "SUCCEEDED" });
      await meterAction(
        store,
        stageRun({
          userId: job.userId,
          projectId: job.projectId,
          renderJobId: jobId,
          stageId: stage.id,
          state: "SUCCEEDED",
          synthetic: job.syntheticProof,
          detail: { artefacts: files.length },
        }),
        metering,
      );
    } catch (err) {
      const message = errMessage(err);
      await store.finishStageRun(runId, {
        state: "FAILED",
        finishedAt: now(),
        errorMessage: message,
        blockedReason: null,
        missingInput: null,
        output: { failed: true },
        artefactCount: 0,
      });
      rows.push({ stageId: stage.id, sequence: stage.sequence, state: "FAILED" });
      await meterAction(
        store,
        stageRun({
          userId: job.userId,
          projectId: job.projectId,
          renderJobId: jobId,
          stageId: stage.id,
          state: "FAILED",
          synthetic: job.syntheticProof,
          detail: { error: message },
        }),
        metering,
      );
      halted = { stageId: stage.id, state: "FAILED", reason: message, missingInput: null };
      break;
    }
  }
  } finally {
    clearInterval(heartbeatTimer);
  }

  /* ------------------------------------------------------------------ *
   * CLOSING THE ATTEMPT
   *
   * The attempt writes its OWN ending. It never touches an earlier attempt's
   * rows, and the stage rows it leaves are the ones it wrote. An attempt that
   * reaches here without a terminal status is a bug in the loop, and it is
   * recorded as FAILED with that sentence rather than left RUNNING forever.
   * ------------------------------------------------------------------ */
  const status = deriveJobStatus(rows, stages);
  const ownRows = rows.filter((r) => !honouredStageIds.includes(r.stageId));
  const reusedForRow = reusedArtefacts.map((r) => ({
    stageId: r.stageId,
    kind: r.kind,
    path: r.path,
    bytes: r.bytes,
    sha256: r.sha256,
    fromAttemptId: r.fromAttemptId,
    fromAttemptNumber: r.fromAttemptNumber,
    measuredSha256: r.measuredSha256,
    measuredBytes: r.measuredBytes,
  }));

  const ended: RunResult["halted"] = halted;
  let attemptState: "SUCCEEDED" | "FAILED" | "BLOCKED" | "STOPPED";
  let endedReason: string;
  if (status === "succeeded") {
    attemptState = "SUCCEEDED";
    endedReason =
      `every one of the ${stages.length} declared stage(s) has a SUCCEEDED row; this attempt ran ` +
      `${ownRows.length} of them and reused ${reusedArtefacts.length} file artefact(s) from an earlier attempt`;
  } else if (status === "failed" && ended) {
    attemptState = "FAILED";
    endedReason = `stage "${ended.stageId}" failed: ${ended.reason}`;
  } else if (status === "blocked" && ended) {
    attemptState = "BLOCKED";
    endedReason = `stage "${ended.stageId}" is gated: ${ended.missingInput ?? ended.reason}`;
  } else if (status === "stopped" && ended) {
    attemptState = "STOPPED";
    endedReason = `stopped before stage "${ended.stageId}" ran: ${ended.reason}`;
  } else {
    attemptState = "FAILED";
    endedReason =
      `this attempt's loop ended without every declared stage succeeding and without naming a stopping stage ` +
      `(derived status "${status}") — recorded as failed rather than left running`;
  }
  await store.finishAttempt(attemptId, {
    state: attemptState,
    finishedAt: now(),
    endedReason,
    reusedArtefacts: reusedForRow,
  });

  await store.finishJob(jobId, now());
  const progress = deriveProgress(rows, stages);
  return {
    jobId,
    attemptId,
    attemptNumber: attempt.attemptNumber,
    startStageId: attempt.startStageId,
    honouredStageIds,
    status,
    stageRows: ownRows,
    artefactsWritten,
    reusedArtefacts: reusedArtefacts.map((r) => ({
      stageId: r.stageId,
      kind: r.kind,
      path: r.path,
      sha256: r.sha256,
      fromAttemptNumber: r.fromAttemptNumber,
    })),
    refusedReuse,
    halted,
    progress,
    metering,
  };
}
