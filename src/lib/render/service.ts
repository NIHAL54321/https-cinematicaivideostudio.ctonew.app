/**
 * The render service — enqueue, stop, read. The API route is a thin shell over
 * this, so the rules below are testable without HTTP.
 *
 * TENANT ISOLATION: every read and every write is scoped by `userId` in the
 * WHERE clause. A job or project belonging to someone else is reported as NOT
 * FOUND (404) and never as forbidden (403) — a 403 would confirm that an id
 * exists on another tenant's account, which is a leak in itself. This matches
 * the rest of the app.
 *
 * THE READ-OUT IS DERIVED. `status` and `progress` are computed from the job's
 * RenderStageRun rows on every read (`./pipeline` deriveJobStatus /
 * deriveProgress) — there is no status column to drift. Every declared stage
 * appears in the read-out with `reached: false` when it has no row, so the UI
 * cannot show a stage as done that never ran.
 */
import { join } from "node:path";
import { ApiError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { meter, renderJobCreated } from "@/lib/usage/metering";
import { QUEUES, enqueue, queueIsAvailable } from "@/lib/queue";
import { findExportPreset, resolvedSpecCore, type ExportPresetSpec } from "@/lib/export/presets";
import { sha256OfJson } from "@/lib/export/spec-fingerprint";
import { renderOutputDir } from "./probes";
import {
  SYNTHETIC_MARKER,
  SYNTHETIC_STATEMENT,
  generateSyntheticSource,
  type SyntheticSourceDeclaration,
} from "./synthetic-source";
import {
  PIPELINE_STAGES,
  PIPELINE_VERSION,
  deriveJobStatus,
  deriveProgress,
  deriveStageDisplayState,
  type DerivedJobStatus,
  type StageDisplayState,
  type StageState,
} from "./pipeline";
import { deriveAttemptLiveness, currentProcessIdentity, type AttemptLiveness } from "./attempt";
import { computeResumePoint, type HistoryRow } from "./recovery";
import { probeArtefactFile } from "./runner";
import { prismaRenderStore } from "./store";

export const RENDER_ACTIONS = ["enqueue", "read", "stop", "list", "retry", "synthetic-proof"] as const;
export type RenderAction = (typeof RENDER_ACTIONS)[number];

export function isRenderAction(v: unknown): v is RenderAction {
  return typeof v === "string" && (RENDER_ACTIONS as readonly string[]).includes(v);
}

export interface StageReadout {
  id: string;
  sequence: number;
  title: string;
  weight: number;
  consumes: string[];
  produces: { kind: string; label: string; artefactKind: string | null };
  requires: Array<{ probeId: string; missingLabel: string }>;
  reports: string[];
  note: string;
  /** True when the pipeline reached this stage (a row exists for it on ANY attempt). */
  reached: boolean;
  /**
   * What the product reports for this stage (Phase 8 block 6). A row left in
   * state RUNNING by a process that no longer exists is INTERRUPTED here.
   */
  state: StageDisplayState | null;
  /** What the row itself says. Never hidden when it differs from `state`. */
  recordedState: StageState | null;
  /** The sentence explaining a derived state, present only when it differs. */
  stateBasis: string | null;
  /** The attempt whose row this read-out is showing. */
  attemptNumber: number | null;
  startedAt: string | null;
  finishedAt: string | null;
  blockedReason: string | null;
  missingInput: string | null;
  errorMessage: string | null;
  artefactCount: number;
  output: unknown;
}

/** One attempt at a job, as the page reads it (Phase 8 block 6). */
export interface AttemptReadout {
  id: string;
  attemptNumber: number;
  /** What the attempt row says. */
  recordedState: "RUNNING" | "SUCCEEDED" | "FAILED" | "BLOCKED" | "STOPPED";
  /**
   * What the product reports: `queued` when the attempt exists but has no stage
   * rows yet, otherwise the recorded state, or the derived interruption when the
   * process that owned it was observed gone.
   */
  state: "queued" | "running" | "interrupted" | "unknown" | "succeeded" | "failed" | "blocked" | "stopped";
  startStageId: string;
  continuedFromId: string | null;
  startedAt: string;
  finishedAt: string | null;
  lastHeartbeatAt: string;
  heartbeatCount: number;
  lastStageId: string | null;
  endedReason: string | null;
  /** The observation behind `state`, in words. */
  liveness: AttemptLiveness;
  stageRowCount: number;
  reusedArtefacts: unknown;
}

export interface RetryReadout {
  /** Whether the retry endpoint would accept a retry right now. */
  available: boolean;
  /** Why not, when it would not. */
  unavailableReason: string | null;
  /**
   * The first declared stage whose latest row is not SUCCEEDED — read from the
   * stage rows ALONE. The retry endpoint re-checks every honoured artefact's
   * file and may start earlier; this line is a hint, not the promise.
   */
  firstUnsuccessfulStageId: string | null;
  note: string;
}

export interface RenderReadout {
  job: {
    id: string;
    projectId: string;
    projectTitle: string;
    presetId: string;
    presetLabel: string;
    /** The resolved specification recorded when the job was enqueued. */
    presetSpec: unknown;
    /** SHA-256 of the canonical JSON of `presetSpec` — re-checkable by hand. */
    presetSpecSha256: string | null;
    /** The export-specification matrix version it was resolved against. */
    specVersion: string | null;
    /**
     * True when the catalogue's CURRENT resolution of this preset still hashes to
     * the digest recorded on the job. False means the preset was edited after the
     * job was enqueued, and the recorded numbers are the ones the job ran with.
     */
    presetStillMatchesRecord: boolean | null;
    pipelineVersion: string;
    fixture: boolean;
    /**
     * True only for a SYNTHETIC ENCODER PROOF job: the input was a source the
     * encoder generated itself. Such a job is never a user's render, and the
     * read-out says so in `syntheticNote` rather than leaving it to a reader to
     * infer from a flag.
     */
    syntheticProof: boolean;
    /** The declared source (pattern, tone, duration, resolution, fps, frames, digest). */
    syntheticSource: unknown;
    /** One sentence, present only when `syntheticProof` is true. */
    syntheticNote: string | null;
    requestedAt: string;
    startedAt: string | null;
    finishedAt: string | null;
    stopRequestedAt: string | null;
    stopReason: string | null;
    queueJobId: string | null;
  };
  /** DERIVED from the stage rows — there is no status column. */
  status: DerivedJobStatus;
  /** How that status was arrived at, in words. */
  statusBasis: string;
  progress: ReturnType<typeof deriveProgress>;
  stages: StageReadout[];
  /** Declared stages with no row on any attempt: the pipeline never got there. */
  notReached: string[];
  /** Every attempt, oldest first. A retry adds one; none is ever rewritten. */
  attempts: AttemptReadout[];
  /** The latest attempt, or null for a job nothing has picked up. */
  latestAttempt: AttemptReadout | null;
  retry: RetryReadout;
  artefacts: {
    count: number;
    rows: Array<{ kind: string; path: string; bytes: number; sha256: string; stageId: string; attemptNumber: number | null; createdAt: string }>;
  };
}

function basisFor(
  status: DerivedJobStatus,
  rows: Array<{ stageId: string; state: StageDisplayState }>,
  interrupted: AttemptReadout | null,
): string {
  const describe = (s: StageDisplayState) => rows.filter((r) => r.state === s).map((r) => r.stageId).join(", ");
  switch (status) {
    case "queued":
      return "queued: no stage row exists yet — the worker has not reached this job (derived; there is no status column)";
    case "running":
      return `running: stage rows exist and none is FAILED/BLOCKED/STOPPED/INTERRUPTED — succeeded so far: ${describe("SUCCEEDED") || "none"}`;
    case "interrupted":
      return (
        `interrupted: the process that owned attempt ${interrupted?.attemptNumber ?? "?"} is gone, so the stage row(s) at ` +
        `${describe("INTERRUPTED")} have no outcome — they are NOT running and NOT succeeded. ${interrupted?.liveness.basis ?? ""}`
      ).trim();
    case "blocked":
      return `blocked: BLOCKED row(s) at ${describe("BLOCKED")} — a requisite is absent and the pipeline stopped there`;
    case "failed":
      return `failed: FAILED row(s) at ${describe("FAILED")} — a stage ran and did not produce its declared output`;
    case "stopped":
      return `stopped: STOPPED row(s) at ${describe("STOPPED")} — a stop was requested and recorded with its reason`;
    case "succeeded":
      return "succeeded: every declared stage has a SUCCEEDED row";
  }
}

/** The catalogue's current digest for a preset — null when it no longer exists. */
function liveSpecDigest(presetId: string): string | null {
  const live: ExportPresetSpec | null = findExportPreset(presetId);
  return live ? sha256OfJson(resolvedSpecCore(live)) : null;
}

/**
 * Create one attempt row, owned by THIS process.
 *
 * The owner identity is what makes liveness an observation later: without it a
 * reader can only compare a timestamp to a clock, and this block exists because
 * that comparison is a guess.
 */
async function createAttemptRow(input: {
  jobId: string;
  attemptNumber: number;
  startStageId: string;
  continuedFromId: string | null;
}): Promise<string> {
  const owner = currentProcessIdentity();
  const at = new Date();
  const row = await prisma.renderAttempt.create({
    data: {
      jobId: input.jobId,
      attemptNumber: input.attemptNumber,
      startStageId: input.startStageId,
      continuedFromId: input.continuedFromId,
      startedAt: at,
      heartbeatAt: at,
      lastStageId: input.startStageId,
      ownerHost: owner.host,
      ownerPid: owner.pid,
      ownerProcStart: owner.procStart,
    },
    select: { id: true },
  });
  return row.id;
}

/** Everything a retry decided, in the words the caller gets back. */
export interface RetryResult {
  jobId: string;
  attemptId: string;
  attemptNumber: number;
  startStageId: string;
  continuedFromId: string | null;
  /** The stages this attempt will NOT run, because an earlier attempt already did. */
  honoured: Array<{ stageId: string; fromAttemptNumber: number; reason: string }>;
  /** File artefacts reused, each with the digest re-measured from disk. */
  reused: Array<{ stageId: string; kind: string; path: string; bytes: number; sha256: string; measuredSha256: string | null; measuredBytes: number | null; fromAttemptNumber: number }>;
  /** Artefacts an earlier attempt recorded that could not be reused, and why. */
  refused: Array<{ stageId: string; kind: string; path: string; detail: string }>;
  /** The arithmetic of the decision, printed. */
  basis: string;
  job: RenderReadout;
}

/**
 * RETRY FROM THE FIRST STAGE THAT DID NOT SUCCEED (Phase 8 block 6).
 *
 * A retry is a NEW ATTEMPT. It creates one attempt row and one queue message; it
 * reads every earlier attempt's rows to decide where to start, and it writes
 * none of them. The unique key `[attemptId, stageId]` is what makes that
 * possible: attempt 2 can run "encode-master" without touching attempt 1's row
 * for it.
 *
 * THREE REFUSALS, each with its reason:
 *   - the job is not the caller's            → 404 (never 403)
 *   - the latest attempt's process is ALIVE  → 409, because two runners on one
 *                                              job is how a render corrupts itself
 *   - every stage is already honoured        → 409, because there is nothing to do
 *                                              and creating an empty attempt would
 *                                              be a row that claims work nobody did
 */
export async function retryRenderJob(input: { userId: string; jobId: string }): Promise<RetryResult> {
  const job = await prisma.renderJob.findFirst({
    where: { id: input.jobId, userId: input.userId },
    select: { id: true },
  });
  if (!job) throw new ApiError(404, "Render job not found.", "not_found");

  if (!queueIsAvailable()) {
    throw new ApiError(503, "Queue Not Connected: REDIS_URL is not configured, so nothing was queued.", "queue_unavailable");
  }

  const latest = await prisma.renderAttempt.findFirst({
    where: { jobId: job.id },
    orderBy: { attemptNumber: "desc" },
  });
  if (latest && latest.state === "RUNNING") {
    const liveness = deriveAttemptLiveness(latest);
    if (liveness.verdict === "alive") {
      throw new ApiError(
        409,
        `Attempt ${latest.attemptNumber} is still running: ${liveness.basis}. A retry is refused while its process is alive, because two runners on one job is how a render corrupts itself.`,
        "attempt_running",
      );
    }
  }

  const history = await prismaRenderStore().stageHistory(job.id);
  const resume = computeResumePoint({
    stages: PIPELINE_STAGES,
    attempts: distinctAttempts(history.rows),
    rows: history.rows,
    artefacts: history.artefacts,
    probe: probeArtefactFile,
  });

  if (resume.startStageId === null) {
    throw new ApiError(
      409,
      `There is nothing to retry: ${resume.basis}`,
      "nothing_to_retry",
    );
  }

  const attemptNumber = (latest?.attemptNumber ?? 0) + 1;
  const attemptId = await createAttemptRow({
    jobId: job.id,
    attemptNumber,
    startStageId: resume.startStageId,
    continuedFromId: latest?.id ?? null,
  });

  const queued = await enqueue(
    QUEUES.render,
    "render",
    { jobId: job.id, attemptId },
    { jobId: `render-${job.id}-a${attemptNumber}` },
  );
  if (!queued.queued) {
    // Nothing was started: the attempt row stays with no stage rows, which reads
    // as "queued, nothing has started" rather than as a run that failed.
    throw new ApiError(503, `Queue Not Connected: ${queued.reason}`, "queue_unavailable");
  }

  return {
    jobId: job.id,
    attemptId,
    attemptNumber,
    startStageId: resume.startStageId,
    continuedFromId: latest?.id ?? null,
    honoured: resume.honoured.map((h) => ({
      stageId: h.stageId,
      fromAttemptNumber: h.fromAttemptNumber,
      reason: h.reason,
    })),
    reused: resume.reused.map((r) => ({
      stageId: r.stageId,
      kind: r.kind,
      path: r.path,
      bytes: r.bytes,
      sha256: r.sha256,
      measuredSha256: r.measuredSha256,
      measuredBytes: r.measuredBytes,
      fromAttemptNumber: r.fromAttemptNumber,
    })),
    refused: resume.refused,
    basis: resume.basis,
    job: await readRenderJob({ userId: input.userId, jobId: job.id }),
  };
}

function distinctAttempts(rows: readonly HistoryRow[]): Array<{ id: string; attemptNumber: number }> {
  const seen = new Map<string, number>();
  for (const r of rows) seen.set(r.attemptId, r.attemptNumber);
  return [...seen].map(([id, attemptNumber]) => ({ id, attemptNumber }));
}

const MAX_JOBS = 25;

export async function enqueueRenderJob(input: {
  userId: string;
  projectId: string;
  presetId?: string | null;
  /** Label the proof world sets on its own jobs; it changes nothing about the run. */
  fixture?: boolean;
}): Promise<{ jobId: string; queued: true; queueJobId: string | undefined }> {
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, userId: input.userId, deletedAt: null },
    select: { id: true },
  });
  // 404, never 403: a foreign project must not be distinguishable from a missing one.
  if (!project) throw new ApiError(404, "Project not found.", "not_found");

  const preset = findExportPreset(input.presetId ?? "youtube-2160p") ?? findExportPreset("youtube-2160p");
  if (!preset) throw new ApiError(500, "No export preset catalogue is available.", "no_presets");

  if (!queueIsAvailable()) {
    // Honest refusal: nothing is created, because a job row that nothing will
    // ever pick up would look queued forever.
    throw new ApiError(503, "Queue Not Connected: REDIS_URL is not configured, so nothing was queued.", "queue_unavailable");
  }

  // The RESOLVED SPECIFICATION is recorded on the job, not just the preset's
  // name. The numbers stay with the job even if the preset catalogue is edited
  // afterwards, so a job is reproducible: re-reading it months later shows the
  // exact frame, codec, level, rate control, colour and audio it ran with.
  const specCore = resolvedSpecCore(preset);
  const job = await prisma.renderJob.create({
    data: {
      projectId: project.id,
      userId: input.userId,
      presetId: preset.id,
      presetLabel: preset.label,
      presetSpec: specCore as never,
      presetSpecSha256: sha256OfJson(specCore),
      specVersion: preset.specVersion,
      pipelineVersion: PIPELINE_VERSION,
      fixture: input.fixture === true,
    },
    select: { id: true },
  });

  // ATTEMPT 1 (Phase 8 block 6). The attempt row exists before the job is
  // queued, so the queue message names it and the worker cannot start a second
  // one by mistake. Its owner is recorded now, which is what lets a reader tell
  // "queued, nothing has started" from "running, and the process is still there".
  const attemptId = await createAttemptRow({
    jobId: job.id,
    attemptNumber: 1,
    startStageId: PIPELINE_STAGES[0].id,
    continuedFromId: null,
  });

  // METERED HERE, by the code that created the job (Phase 8, block 5). The row
  // exists, so the action happened — whether or not the queue then takes it.
  await meter(
    renderJobCreated({
      userId: input.userId,
      projectId: project.id,
      renderJobId: job.id,
      presetId: preset.id,
      synthetic: false,
    }),
  );
  const queued = await enqueue(QUEUES.render, "render", { jobId: job.id, attemptId }, { jobId: `render-${job.id}` });
  if (!queued.queued) {
    // The queue refused it after the row was written: say so and leave the row
    // in its `queued` (no stage rows) state rather than pretending it is running.
    throw new ApiError(503, `Queue Not Connected: ${queued.reason}`, "queue_unavailable");
  }
  await prisma.renderJob.update({ where: { id: job.id }, data: { queueJobId: queued.jobId ?? null } });
  return { jobId: job.id, queued: true, queueJobId: queued.jobId };
}

/**
 * ENQUEUE A SYNTHETIC ENCODER PROOF (Phase 8 block 2b).
 *
 * This is the only way a render is ever started on a test source, and everything
 * it creates says so in its own columns:
 *
 *   - a Project titled with SYNTHETIC_MARKER, a Script/Chapter/Scene/Asset under
 *     it, and an Asset whose metadata carries the marker — so the project list,
 *     the media library and any admin view can recognise it without a join;
 *   - a RenderJob with `syntheticProof: true` and the full source declaration in
 *     `syntheticSource` (pattern, tone, duration, resolution, frame rate, frame
 *     count, argv, path, bytes, SHA-256) recorded BEFORE the run;
 *   - stage rows and artefact rows that carry `syntheticProof` too, and files
 *     written under `<outputRoot>/synthetic-encoder-proof/…`.
 *
 * It is NOT the fixture world: the two labelled FIXTURE jobs belong to the
 * scripted proof project and are untouched by this. It is NOT a user's render:
 * no user project is read, and `listRenderJobs` excludes these jobs from the
 * user-facing list entirely.
 *
 * The source is generated by the encoder itself at enqueue time, so the digest
 * the encode stage will check the input against is on the job before any stage
 * runs. If generation fails, nothing is created — a job with no source would be
 * a job that cannot encode, dressed up as a queued render.
 */
export async function enqueueSyntheticProofJob(input: {
  userId: string;
  presetId?: string | null;
  durationSeconds?: number;
}): Promise<{ jobId: string; projectId: string; queued: true; queueJobId: string | undefined; source: SyntheticSourceDeclaration }> {
  const preset = findExportPreset(input.presetId ?? "youtube-2160p") ?? findExportPreset("youtube-2160p");
  if (!preset) throw new ApiError(500, "No export preset catalogue is available.", "no_presets");

  if (!queueIsAvailable()) {
    throw new ApiError(503, "Queue Not Connected: REDIS_URL is not configured, so nothing was queued.", "queue_unavailable");
  }

  // The source matches the SIZE AND CADENCE the preset asks for, so the encode
  // stage is fed an input of the delivery frame rather than a scaled one — a
  // 2160p prove-the-encode on a 640×360 source would prove nothing about 2160p.
  const durationSeconds = input.durationSeconds ?? 2;
  const req = {
    widthPx: preset.widthPx,
    heightPx: preset.heightPx,
    frameRate: preset.video.frameRate,
    durationSeconds,
  };
  const sourceDir = join(renderOutputDir(), SYNTHETIC_MARKER, "sources");
  const generated = generateSyntheticSource(req, sourceDir);
  if (!generated.ok) {
    throw new ApiError(503, `The encoder could not generate the synthetic source: ${generated.failure}`, "no_encoder");
  }
  const source = generated.declaration;

  const specCore = resolvedSpecCore(preset);
  const projectMark = `${SYNTHETIC_MARKER} — a generated test source, not a project`;
  const created = await prisma.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        userId: input.userId,
        title: `SYNTHETIC ENCODER PROOF — ${preset.widthPx}×${preset.heightPx} ${preset.id}`,
        description: SYNTHETIC_STATEMENT,
        status: "DRAFT",
      },
      select: { id: true },
    });
    const script = await tx.script.create({
      data: { projectId: project.id, title: projectMark, logline: SYNTHETIC_STATEMENT },
      select: { id: true },
    });
    const chapter = await tx.chapter.create({
      data: { scriptId: script.id, projectId: project.id, title: projectMark, order: 0, summary: SYNTHETIC_STATEMENT },
      select: { id: true },
    });
    const scene = await tx.scene.create({
      data: {
        chapterId: chapter.id,
        projectId: project.id,
        order: 0,
        title: projectMark,
        narration: null,
        durationSeconds: source.durationSeconds,
        status: "READY",
      },
      select: { id: true },
    });
    const asset = await tx.asset.create({
      data: {
        projectId: project.id,
        userId: input.userId,
        kind: "VIDEO",
        name: `${SYNTHETIC_MARKER}-source.mp4`,
        status: "READY",
        mimeType: "video/mp4",
        sizeBytes: BigInt(source.bytes ?? 0),
        width: source.widthPx,
        height: source.heightPx,
        durationSeconds: source.durationSeconds,
        // The path is stored on s3Key because that is the field readProjectFacts
        // treats as "the scene's source media" — and a local path is what this
        // stage actually opens. It is not an object key, and the marker in the
        // metadata says so rather than leaving a reader to guess.
        s3Key: source.path,
        metadata: {
          marker: SYNTHETIC_MARKER,
          synthetic: true,
          statement: SYNTHETIC_STATEMENT,
          pathKind: "local-filesystem-path, not an object key",
          sourceSha256: source.sha256,
        },
      },
      select: { id: true },
    });
    await tx.sceneAsset.create({ data: { sceneId: scene.id, assetId: asset.id, role: "VISUAL", order: 0 } });
    const job = await tx.renderJob.create({
      data: {
        projectId: project.id,
        userId: input.userId,
        presetId: preset.id,
        presetLabel: preset.label,
        presetSpec: specCore as never,
        presetSpecSha256: sha256OfJson(specCore),
        specVersion: preset.specVersion,
        pipelineVersion: PIPELINE_VERSION,
        fixture: false,
        syntheticProof: true,
        syntheticSource: source as never,
      },
      select: { id: true },
    });
    return { projectId: project.id, jobId: job.id };
  });

  // METERED, and marked synthetic in the row's own column: this job's usage is
  // an encoder proof, never a customer's render.
  await meter(
    renderJobCreated({
      userId: input.userId,
      projectId: created.projectId,
      renderJobId: created.jobId,
      presetId: preset.id,
      synthetic: true,
    }),
  );
  const attemptId = await createAttemptRow({
    jobId: created.jobId,
    attemptNumber: 1,
    startStageId: PIPELINE_STAGES[0].id,
    continuedFromId: null,
  });
  const queued = await enqueue(QUEUES.render, "render", { jobId: created.jobId, attemptId }, { jobId: `render-${created.jobId}` });
  if (!queued.queued) {
    throw new ApiError(503, `Queue Not Connected: ${queued.reason}`, "queue_unavailable");
  }
  await prisma.renderJob.update({ where: { id: created.jobId }, data: { queueJobId: queued.jobId ?? null } });
  return { jobId: created.jobId, projectId: created.projectId, queued: true, queueJobId: queued.jobId, source };
}

/**
 * A real stop: records the request and its reason, and — when nothing is left
 * that could honour it — closes the attempt with a sentence.
 *
 * TWO HONEST CASES, AND THEY ARE DIFFERENT:
 *
 *  - The attempt's owning process is ALIVE. The stop is recorded and the runner
 *    honours it before the next stage. It cannot interrupt the stage that is
 *    already running, because the encoder is a blocking child process; the
 *    read-out says so instead of pretending the stage stopped.
 *  - The owning process is GONE. Nothing will ever re-read the stop request, so
 *    leaving the attempt RUNNING would be a lie that never resolves. The attempt
 *    is closed as STOPPED with the reason, and the stage row it left in RUNNING
 *    is NOT rewritten — the read-out reports it as INTERRUPTED, which is what it
 *    is.
 */
export async function stopRenderJob(input: { userId: string; jobId: string; reason?: string | null }): Promise<RenderReadout> {
  const job = await prisma.renderJob.findFirst({
    where: { id: input.jobId, userId: input.userId },
    select: { id: true, finishedAt: true },
  });
  if (!job) throw new ApiError(404, "Render job not found.", "not_found");
  const reason = (input.reason ?? "").trim() || "stopped by the owner";
  await prisma.renderJob.update({
    where: { id: job.id },
    data: { stopRequestedAt: new Date(), stopReason: reason },
  });

  const latest = await prisma.renderAttempt.findFirst({
    where: { jobId: job.id },
    orderBy: { attemptNumber: "desc" },
  });
  if (latest && latest.state === "RUNNING") {
    const liveness = deriveAttemptLiveness(latest);
    if (liveness.verdict === "interrupted" || liveness.verdict === "interrupted-by-lease") {
      await prisma.renderAttempt.update({
        where: { id: latest.id },
        data: {
          state: "STOPPED",
          finishedAt: new Date(),
          endedReason:
            `stopped by the owner after the process that owned this attempt was gone (${liveness.basis}). ` +
            `The stage it was last working in ("${latest.lastStageId ?? "(no stage recorded)"}") never recorded an outcome, ` +
            `and no stage row was rewritten to pretend otherwise. Reason given: ${reason}`,
        },
      });
    }
  }

  return readRenderJob({ userId: input.userId, jobId: input.jobId });
}

/** One attempt row, turned into what the page reads. */
function toAttemptReadout(
  row: {
    id: string;
    attemptNumber: number;
    state: string;
    startStageId: string;
    continuedFromId: string | null;
    startedAt: Date;
    finishedAt: Date | null;
    heartbeatAt: Date;
    heartbeatCount: number;
    lastStageId: string | null;
    ownerHost: string | null;
    ownerPid: number | null;
    ownerProcStart: string | null;
    endedReason: string | null;
    reusedArtefacts: unknown;
  },
  stageRowCount: number,
  now: () => Date,
): AttemptReadout {
  const recordedState = row.state as AttemptReadout["recordedState"];
  const liveness = deriveAttemptLiveness(
    {
      attemptNumber: row.attemptNumber,
      state: recordedState,
      ownerHost: row.ownerHost,
      ownerPid: row.ownerPid,
      ownerProcStart: row.ownerProcStart,
      heartbeatAt: row.heartbeatAt,
      lastStageId: row.lastStageId,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
      endedReason: row.endedReason,
    },
    { now },
  );

  let state: AttemptReadout["state"];
  if (recordedState !== "RUNNING") {
    state = recordedState.toLowerCase() as AttemptReadout["state"];
  } else if (stageRowCount === 0) {
    // The attempt exists but has not touched a stage: nothing has started, and
    // calling it "running" because the process is alive would be a lie about
    // the WORK rather than about the process.
    state = "queued";
  } else if (liveness.verdict === "alive") {
    state = "running";
  } else if (liveness.verdict === "interrupted" || liveness.verdict === "interrupted-by-lease") {
    state = "interrupted";
  } else {
    state = "unknown";
  }

  return {
    id: row.id,
    attemptNumber: row.attemptNumber,
    recordedState,
    state,
    startStageId: row.startStageId,
    continuedFromId: row.continuedFromId,
    startedAt: row.startedAt.toISOString(),
    finishedAt: row.finishedAt ? row.finishedAt.toISOString() : null,
    lastHeartbeatAt: row.heartbeatAt.toISOString(),
    heartbeatCount: row.heartbeatCount,
    lastStageId: row.lastStageId,
    endedReason: row.endedReason,
    liveness,
    stageRowCount,
    reusedArtefacts: row.reusedArtefacts,
  };
}

export async function readRenderJob(input: { userId: string; jobId: string }): Promise<RenderReadout> {
  const job = await prisma.renderJob.findFirst({
    where: { id: input.jobId, userId: input.userId },
    include: {
      stageRuns: { orderBy: [{ attempt: { attemptNumber: "asc" } }, { sequence: "asc" }] },
      artefacts: { orderBy: { createdAt: "asc" } },
      attempts: { orderBy: { attemptNumber: "asc" } },
      project: { select: { title: true } },
    },
  });
  if (!job) throw new ApiError(404, "Render job not found.", "not_found");

  const attemptNumberById = new Map(job.attempts.map((a) => [a.id, a.attemptNumber]));
  const stageRunAttempt = new Map(job.stageRuns.map((r) => [r.id, r.attemptId]));
  const rowsByAttempt = new Map<string, number>();
  for (const r of job.stageRuns) rowsByAttempt.set(r.attemptId, (rowsByAttempt.get(r.attemptId) ?? 0) + 1);

  const attempts = job.attempts.map((a) => toAttemptReadout(a, rowsByAttempt.get(a.id) ?? 0, () => new Date()));
  const attemptByNumber = new Map(attempts.map((a) => [a.attemptNumber, a]));

  // For each declared stage, the LATEST attempt's row decides. A retry that
  // honoured a stage leaves no new row for it, so the earlier attempt's row is
  // the one that still speaks for it.
  const latestRowByStage = new Map<string, (typeof job.stageRuns)[number]>();
  for (const r of job.stageRuns) {
    const current = latestRowByStage.get(r.stageId);
    const currentNumber = current ? (attemptNumberById.get(current.attemptId) ?? 0) : -1;
    const thisNumber = attemptNumberById.get(r.attemptId) ?? 0;
    if (!current || thisNumber >= currentNumber) latestRowByStage.set(r.stageId, r);
  }

  const stages: StageReadout[] = PIPELINE_STAGES.map((s) => {
    const row = latestRowByStage.get(s.id);
    const attemptNumber = row ? (attemptNumberById.get(row.attemptId) ?? null) : null;
    const attempt = attemptNumber === null ? null : attemptByNumber.get(attemptNumber) ?? null;
    const recordedState = row ? (row.state as StageState) : null;
    // A RUNNING row is only "running" while the attempt that owns it is alive.
    const ownerAlive = attempt ? attempt.state === "running" : null;
    const state = recordedState ? deriveStageDisplayState(recordedState, ownerAlive) : null;
    const stateBasis =
      state && recordedState && state !== recordedState
        ? `the row left by attempt ${attemptNumber} says ${recordedState}; it is reported as ${state} because ${
            attempt?.liveness.basis ?? "the attempt that owns it is not running"
          }`
        : null;
    return {
      id: s.id,
      sequence: s.sequence,
      title: s.title,
      weight: s.weight,
      consumes: s.consumes,
      produces: { kind: s.produces.kind, label: s.produces.label, artefactKind: s.produces.artefactKind ?? null },
      requires: s.requires.map((r) => ({ probeId: r.probeId, missingLabel: r.missingLabel })),
      reports: s.reports ?? [],
      note: s.note,
      reached: Boolean(row),
      state,
      recordedState,
      stateBasis,
      attemptNumber,
      startedAt: row ? row.startedAt.toISOString() : null,
      finishedAt: row?.finishedAt ? row.finishedAt.toISOString() : null,
      blockedReason: row?.blockedReason ?? null,
      missingInput: row?.missingInput ?? null,
      errorMessage: row?.errorMessage ?? null,
      artefactCount: row?.artefactCount ?? 0,
      output: row?.output ?? null,
    };
  });

  const rowViews = stages
    .filter((s) => s.state !== null)
    .map((s) => ({ stageId: s.id, sequence: s.sequence, state: s.state as StageDisplayState }));
  const status = deriveJobStatus(rowViews);
  const progress = deriveProgress(rowViews);
  const latestAttempt = attempts.length > 0 ? attempts[attempts.length - 1] : null;
  const interruptedAttempt = attempts.find((a) => a.state === "interrupted") ?? null;

  // A cheap hint for the page: the first declared stage whose latest row is not
  // SUCCEEDED. The retry endpoint re-checks the files behind every honoured
  // artefact and may start EARLIER than this; the hint never overrides it.
  const firstUnsuccessful = PIPELINE_STAGES.find((s) => {
    const row = latestRowByStage.get(s.id);
    return !row || row.state !== "SUCCEEDED";
  });
  const nothingToRetry = !firstUnsuccessful;
  const stillRunning = latestAttempt !== null && latestAttempt.state === "running";
  const retry: RetryReadout = {
    available: !nothingToRetry && !stillRunning,
    unavailableReason: nothingToRetry
      ? "every declared stage has a SUCCEEDED row — there is nothing to retry"
      : stillRunning
        ? `attempt ${latestAttempt?.attemptNumber} is still running; a retry is refused while its process is alive`
        : null,
    firstUnsuccessfulStageId: firstUnsuccessful?.id ?? null,
    note:
      "read from the stage rows alone. The retry endpoint re-measures every honoured artefact's file before it decides " +
      "where to start, so it may start earlier than this line says — never later.",
  };

  return {
    job: {
      id: job.id,
      projectId: job.projectId,
      projectTitle: job.project.title,
      presetId: job.presetId,
      presetLabel: job.presetLabel,
      presetSpec: job.presetSpec,
      presetSpecSha256: job.presetSpecSha256,
      specVersion: job.specVersion,
      presetStillMatchesRecord:
        job.presetSpecSha256 === null ? null : liveSpecDigest(job.presetId) === job.presetSpecSha256,
      pipelineVersion: job.pipelineVersion,
      fixture: job.fixture,
      syntheticProof: job.syntheticProof,
      syntheticSource: job.syntheticSource,
      syntheticNote: job.syntheticProof
        ? `${SYNTHETIC_STATEMENT} Job ${job.id} is excluded from the project's render list and from every user-facing surface.`
        : null,
      requestedAt: job.requestedAt.toISOString(),
      startedAt: job.startedAt ? job.startedAt.toISOString() : null,
      finishedAt: job.finishedAt ? job.finishedAt.toISOString() : null,
      stopRequestedAt: job.stopRequestedAt ? job.stopRequestedAt.toISOString() : null,
      stopReason: job.stopReason,
      queueJobId: job.queueJobId,
    },
    status,
    statusBasis: basisFor(status, rowViews, interruptedAttempt),
    progress,
    stages,
    notReached: stages.filter((s) => !s.reached).map((s) => s.id),
    attempts,
    latestAttempt,
    retry,
    artefacts: {
      count: job.artefacts.length,
      rows: job.artefacts.map((a) => ({
        kind: a.kind,
        path: a.path,
        bytes: a.bytes,
        sha256: a.sha256,
        stageId: a.stageId,
        attemptNumber: attemptNumberById.get(stageRunAttempt.get(a.stageRunId) ?? "") ?? null,
        createdAt: a.createdAt.toISOString(),
      })),
    },
  };
}

export async function listRenderJobs(input: { userId: string; projectId?: string | null }): Promise<RenderReadout[]> {
  const jobs = await prisma.renderJob.findMany({
    // SYNTHETIC PROOF JOBS ARE EXCLUDED HERE — this is the exclusion, not a
    // convention. A proof run encodes a generated test source, and putting it in
    // a user's list of their own renders would be the one thing the marking
    // exists to prevent. There is no query parameter that brings them back; the
    // block-4 admin surface reads them by `syntheticProof: true` deliberately.
    where: { userId: input.userId, syntheticProof: false, ...(input.projectId ? { projectId: input.projectId } : {}) },
    orderBy: { requestedAt: "desc" },
    take: MAX_JOBS,
    select: { id: true },
  });
  return Promise.all(jobs.map((j) => readRenderJob({ userId: input.userId, jobId: j.id })));
}
