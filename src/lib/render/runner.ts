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
import { StageFailure, type ProjectFacts, type RenderJobFacts, type StageFile, type StageOutcome } from "./types";
import { encoderProbe, METERED_PROBE_IDS, stageRun, type MeterResult } from "@/lib/usage/metering";
import type { UsageEventInput } from "@/lib/usage/types";

/** The persistence the runner needs. Implemented over Prisma in `./store.ts`. */
export interface RenderStore {
  readJob(jobId: string): Promise<RenderJobFacts | null>;
  startJob(jobId: string, at: Date): Promise<void>;
  finishJob(jobId: string, at: Date): Promise<void>;
  /** Creates the RUNNING row and returns its id. */
  createStageRun(input: {
    jobId: string;
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
  status: DerivedJobStatus;
  stageRows: StageRowView[];
  artefactsWritten: number;
  /** The stage that stopped the pipeline, and why. */
  halted: { stageId: string; state: "BLOCKED" | "FAILED" | "STOPPED"; reason: string; missingInput: string | null } | null;
  progress: ReturnType<typeof deriveProgress>;
  /** Usage rows this run wrote, and any it could not write. */
  metering: MeteringOutcome;
}

export interface RunDeps {
  store: RenderStore;
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

  const rows: StageRowView[] = [];
  const artefacts: Record<string, StageFile> = {};
  let artefactsWritten = 0;
  let halted: RunResult["halted"] = null;
  const metering: MeteringOutcome = { recorded: 0, failed: [] };

  await store.startJob(jobId, now());

  for (const stage of stages) {
    // A stop is re-read before every stage, so it takes effect between stages.
    const fresh = await store.readJob(jobId);
    if (fresh?.stopRequestedAt) {
      const runId = await store.createStageRun({ jobId, stageId: stage.id, sequence: stage.sequence, startedAt: now(), syntheticProof: job.syntheticProof });
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
        missing.push(`${need.label} — stage "${need.stageId}" produced no "${need.artefactKind}" artefact`);
      }
    }

    if (missing.length > 0) {
      const runId = await store.createStageRun({ jobId, stageId: stage.id, sequence: stage.sequence, startedAt: now(), syntheticProof: job.syntheticProof });
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
    const runId = await store.createStageRun({ jobId, stageId: stage.id, sequence: stage.sequence, startedAt: now(), syntheticProof: job.syntheticProof });
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

  await store.finishJob(jobId, now());
  const progress = deriveProgress(rows, stages);
  return {
    jobId,
    status: deriveJobStatus(rows, stages),
    stageRows: rows,
    artefactsWritten,
    halted,
    progress,
    metering,
  };
}
