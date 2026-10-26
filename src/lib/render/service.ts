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
  type DerivedJobStatus,
  type StageState,
} from "./pipeline";

export const RENDER_ACTIONS = ["enqueue", "read", "stop", "list", "synthetic-proof"] as const;
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
  /** True when the pipeline reached this stage (a row exists for it). */
  reached: boolean;
  state: StageState | null;
  startedAt: string | null;
  finishedAt: string | null;
  blockedReason: string | null;
  missingInput: string | null;
  errorMessage: string | null;
  artefactCount: number;
  output: unknown;
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
  /** Declared stages with no row at all: the pipeline never got there. */
  notReached: string[];
  artefacts: {
    count: number;
    rows: Array<{ kind: string; path: string; bytes: number; sha256: string; stageId: string; createdAt: string }>;
  };
}

function basisFor(status: DerivedJobStatus, rows: Array<{ stageId: string; state: StageState }>): string {
  const describe = (s: StageState) => rows.filter((r) => r.state === s).map((r) => r.stageId).join(", ");
  switch (status) {
    case "queued":
      return "queued: no stage row exists yet — the worker has not reached this job (derived; there is no status column)";
    case "running":
      return `running: stage rows exist and none is FAILED/BLOCKED/STOPPED — succeeded so far: ${describe("SUCCEEDED") || "none"}`;
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

  const queued = await enqueue(QUEUES.render, "render", { jobId: job.id }, { jobId: `render-${job.id}` });
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
    widthPx: preset.video.widthPx,
    heightPx: preset.video.heightPx,
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
        title: `SYNTHETIC ENCODER PROOF — ${preset.video.widthPx}×${preset.video.heightPx} ${preset.id}`,
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

  const queued = await enqueue(QUEUES.render, "render", { jobId: created.jobId }, { jobId: `render-${created.jobId}` });
  if (!queued.queued) {
    throw new ApiError(503, `Queue Not Connected: ${queued.reason}`, "queue_unavailable");
  }
  await prisma.renderJob.update({ where: { id: created.jobId }, data: { queueJobId: queued.jobId ?? null } });
  return { jobId: created.jobId, projectId: created.projectId, queued: true, queueJobId: queued.jobId, source };
}

/** A real stop: records the request and its reason. The runner honours it between stages. */
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
  return readRenderJob({ userId: input.userId, jobId: input.jobId });
}

export async function readRenderJob(input: { userId: string; jobId: string }): Promise<RenderReadout> {
  const job = await prisma.renderJob.findFirst({
    where: { id: input.jobId, userId: input.userId },
    include: {
      stageRuns: { orderBy: { sequence: "asc" } },
      artefacts: { orderBy: { createdAt: "asc" } },
      project: { select: { title: true } },
    },
  });
  if (!job) throw new ApiError(404, "Render job not found.", "not_found");

  const rows = job.stageRuns.map((r) => ({ stageId: r.stageId, sequence: r.sequence, state: r.state as StageState }));
  const status = deriveJobStatus(rows);
  const progress = deriveProgress(rows);
  const byStage = new Map(job.stageRuns.map((r) => [r.stageId, r]));
  const stages: StageReadout[] = PIPELINE_STAGES.map((s) => {
    const row = byStage.get(s.id);
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
      state: row ? (row.state as StageState) : null,
      startedAt: row ? row.startedAt.toISOString() : null,
      finishedAt: row?.finishedAt ? row.finishedAt.toISOString() : null,
      blockedReason: row?.blockedReason ?? null,
      missingInput: row?.missingInput ?? null,
      errorMessage: row?.errorMessage ?? null,
      artefactCount: row?.artefactCount ?? 0,
      output: row?.output ?? null,
    };
  });

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
    statusBasis: basisFor(status, rows),
    progress,
    stages,
    notReached: stages.filter((s) => !s.reached).map((s) => s.id),
    artefacts: {
      count: job.artefacts.length,
      rows: job.artefacts.map((a) => ({
        kind: a.kind,
        path: a.path,
        bytes: a.bytes,
        sha256: a.sha256,
        stageId: a.stageId,
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
