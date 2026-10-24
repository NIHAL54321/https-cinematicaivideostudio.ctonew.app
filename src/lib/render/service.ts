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
import { ApiError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { QUEUES, enqueue, queueIsAvailable } from "@/lib/queue";
import { findExportPreset } from "@/lib/export/presets";
import {
  PIPELINE_STAGES,
  PIPELINE_VERSION,
  deriveJobStatus,
  deriveProgress,
  type DerivedJobStatus,
  type StageState,
} from "./pipeline";

export const RENDER_ACTIONS = ["enqueue", "read", "stop", "list"] as const;
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
    pipelineVersion: string;
    fixture: boolean;
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

  const job = await prisma.renderJob.create({
    data: {
      projectId: project.id,
      userId: input.userId,
      presetId: preset.id,
      presetLabel: preset.label,
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
      pipelineVersion: job.pipelineVersion,
      fixture: job.fixture,
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
    where: { userId: input.userId, ...(input.projectId ? { projectId: input.projectId } : {}) },
    orderBy: { requestedAt: "desc" },
    take: MAX_JOBS,
    select: { id: true },
  });
  return Promise.all(jobs.map((j) => readRenderJob({ userId: input.userId, jobId: j.id })));
}
