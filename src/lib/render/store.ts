/**
 * The Prisma-backed implementation of the runner's store contract, plus the
 * facts the pipeline reads from a project's own rows.
 *
 * Every query is scoped by project/user id where the caller supplies one: the
 * API layer resolves ownership FIRST (a foreign project is a 404), and this
 * layer never widens it.
 */
import { prisma } from "@/lib/db";
import { meter } from "@/lib/usage/metering";
import { authorFromAttribution } from "@/lib/media/licence-fields";
import { sourcePathKind } from "./source-clip";
import type { RenderStore } from "./runner";
import type { HistoryArtefact, HistoryRow } from "./recovery";
import { AttemptAlreadyRunError, type ProjectFacts, type RenderAttemptFacts, type RenderJobFacts, type RenderSceneFact } from "./types";

/** Prisma's unique-constraint code. Read off the error, so it holds across client versions. */
function isUniqueViolation(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === "P2002";
}

function toAttemptFacts(row: {
  id: string;
  jobId: string;
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
}): RenderAttemptFacts {
  return {
    id: row.id,
    jobId: row.jobId,
    attemptNumber: row.attemptNumber,
    state: row.state as RenderAttemptFacts["state"],
    startStageId: row.startStageId,
    continuedFromId: row.continuedFromId,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    heartbeatAt: row.heartbeatAt,
    heartbeatCount: row.heartbeatCount,
    lastStageId: row.lastStageId,
    ownerHost: row.ownerHost,
    ownerPid: row.ownerPid,
    ownerProcStart: row.ownerProcStart,
    endedReason: row.endedReason,
    reusedArtefacts: row.reusedArtefacts,
  };
}

function toJobFacts(row: {
  id: string;
  projectId: string;
  userId: string;
  presetId: string;
  presetLabel: string;
  presetSpec: unknown;
  presetSpecSha256: string | null;
  specVersion: string | null;
  pipelineVersion: string;
  fixture: boolean;
  syntheticProof: boolean;
  syntheticSource: unknown;
  requestedAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  stopRequestedAt: Date | null;
  stopReason: string | null;
}): RenderJobFacts {
  return {
    id: row.id,
    projectId: row.projectId,
    userId: row.userId,
    presetId: row.presetId,
    presetLabel: row.presetLabel,
    presetSpec: row.presetSpec,
    presetSpecSha256: row.presetSpecSha256,
    specVersion: row.specVersion,
    pipelineVersion: row.pipelineVersion,
    fixture: row.fixture,
    syntheticProof: row.syntheticProof,
    syntheticSource: row.syntheticSource,
    requestedAt: row.requestedAt,
    startedAt: row.startedAt,
    finishedAt: row.finishedAt,
    stopRequestedAt: row.stopRequestedAt,
    stopReason: row.stopReason,
  };
}

/**
 * The project's facts, read from its own rows.
 *
 * Scene duration is `Scene.durationSeconds` AS STORED — a scene with no declared
 * duration contributes 0 ms and the timeline says so, because inventing a length
 * would make the timeline a fiction. Source media is `Asset.s3Key ?? Asset.url`
 * of the scene's first asset, so the encode stage can tell whether there is
 * anything to encode instead of assuming there is.
 */
export async function readProjectFacts(projectId: string): Promise<ProjectFacts> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, deletedAt: null },
    select: {
      id: true,
      title: true,
      scenes: {
        orderBy: [{ order: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          order: true,
          durationSeconds: true,
          narration: true,
          _count: { select: { subtitles: true, assets: true } },
          assets: {
            orderBy: { order: "asc" },
            take: 1,
            select: {
              asset: {
                select: {
                  s3Key: true,
                  url: true,
                  metadata: true,
                  stockAsset: { select: { provider: true, externalId: true, pageUrl: true } },
                  licensing: {
                    select: {
                      licenseType: true,
                      source: true,
                      licenseUrl: true,
                      attribution: true,
                      purchasedAt: true,
                      expiresAt: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!project) throw new Error(`project ${projectId} does not exist (or is deleted) — no facts to read`);
  const scenes: RenderSceneFact[] = project.scenes.map((s) => {
    const asset = s.assets[0]?.asset ?? null;
    const sourcePath = asset?.s3Key ?? asset?.url ?? null;
    // The stored-bytes record written by `ingestStockFootage`. It is the only
    // place a digest of the stored object is stated, so it is read here rather
    // than guessed from the row.
    const footage = (asset?.metadata as { footage?: { bytes?: number; sha256?: string } } | null)?.footage ?? null;
    const attribution = asset?.licensing?.attribution ?? null;
    return {
      id: s.id,
      order: s.order,
      durationSeconds: s.durationSeconds,
      narrationChars: (s.narration ?? "").length,
      subtitleCount: s._count.subtitles,
      assetCount: s._count.assets,
      sourcePath,
      source: sourcePath
        ? {
            pathKind: sourcePathKind(sourcePath),
            storedBytes: typeof footage?.bytes === "number" ? footage.bytes : null,
            storedSha256: typeof footage?.sha256 === "string" ? footage.sha256 : null,
            provider: asset?.stockAsset?.provider ?? null,
            providerAssetId: asset?.stockAsset?.externalId ?? null,
            pageUrl: asset?.stockAsset?.pageUrl ?? null,
            author: authorFromAttribution(attribution),
            licenseType: asset?.licensing?.licenseType ?? null,
            licenseSource: asset?.licensing?.source ?? null,
            licenseUrl: asset?.licensing?.licenseUrl ?? null,
            attribution,
            purchasedAt: asset?.licensing?.purchasedAt?.toISOString() ?? null,
            expiresAt: asset?.licensing?.expiresAt?.toISOString() ?? null,
          }
        : null,
    };
  });
  return {
    projectId: project.id,
    title: project.title,
    sceneCount: scenes.length,
    scenes,
    scriptChars: scenes.reduce((n, s) => n + s.narrationChars, 0),
    subtitleCueCount: scenes.reduce((n, s) => n + s.subtitleCount, 0),
    sourceMediaCount: scenes.filter((s) => s.sourcePath).length,
  };
}

export function prismaRenderStore(): RenderStore {
  return {
    async readJob(jobId) {
      const row = await prisma.renderJob.findUnique({ where: { id: jobId } });
      return row ? toJobFacts(row) : null;
    },
    async startJob(jobId, at) {
      // Only the first start counts: a re-run does not move the start time.
      await prisma.renderJob.updateMany({ where: { id: jobId, startedAt: null }, data: { startedAt: at } });
    },
    async finishJob(jobId, at) {
      await prisma.renderJob.update({ where: { id: jobId }, data: { finishedAt: at } });
    },
    /* --- attempts (Phase 8 block 6) ----------------------------------- */
    async createAttempt({ jobId, attemptNumber, startStageId, continuedFromId, startedAt, owner }) {
      const row = await prisma.renderAttempt.create({
        data: {
          jobId,
          attemptNumber,
          startStageId,
          continuedFromId,
          startedAt,
          heartbeatAt: startedAt,
          ownerHost: owner.host,
          ownerPid: owner.pid,
          ownerProcStart: owner.procStart,
          lastStageId: startStageId,
        },
        select: { id: true },
      });
      return row.id;
    },
    async readAttempt(attemptId) {
      const row = await prisma.renderAttempt.findUnique({ where: { id: attemptId } });
      return row ? toAttemptFacts(row) : null;
    },
    async latestAttempt(jobId) {
      const row = await prisma.renderAttempt.findFirst({
        where: { jobId },
        orderBy: { attemptNumber: "desc" },
      });
      return row ? toAttemptFacts(row) : null;
    },
    async heartbeat(attemptId, at, lastStageId) {
      await prisma.renderAttempt.update({
        where: { id: attemptId },
        data: { heartbeatAt: at, heartbeatCount: { increment: 1 }, ...(lastStageId ? { lastStageId } : {}) },
      });
    },
    async finishAttempt(attemptId, patch) {
      await prisma.renderAttempt.update({
        where: { id: attemptId },
        data: {
          state: patch.state,
          finishedAt: patch.finishedAt,
          endedReason: patch.endedReason,
          ...(patch.reusedArtefacts === undefined ? {} : { reusedArtefacts: patch.reusedArtefacts as never }),
        },
      });
    },
    /**
     * Every stage row and artefact row this job has, from EVERY attempt.
     *
     * Read-only by construction: this method has no write path, so the retry
     * logic it feeds (`computeResumePoint`) cannot mutate a previous attempt
     * even by accident.
     */
    async stageHistory(jobId): Promise<{ rows: HistoryRow[]; artefacts: HistoryArtefact[] }> {
      const [runs, arts] = await Promise.all([
        prisma.renderStageRun.findMany({
          where: { jobId },
          orderBy: [{ attempt: { attemptNumber: "asc" } }, { sequence: "asc" }],
          select: { attemptId: true, stageId: true, sequence: true, state: true, attempt: { select: { attemptNumber: true } } },
        }),
        prisma.renderArtefact.findMany({
          where: { jobId },
          orderBy: { createdAt: "asc" },
          select: { stageRun: { select: { attemptId: true } }, stageId: true, kind: true, path: true, bytes: true, sha256: true },
        }),
      ]);
      return {
        rows: runs.map((r) => ({
          attemptId: r.attemptId,
          attemptNumber: r.attempt.attemptNumber,
          stageId: r.stageId,
          sequence: r.sequence,
          state: r.state as HistoryRow["state"],
        })),
        artefacts: arts.map((a) => ({
          attemptId: a.stageRun.attemptId,
          stageId: a.stageId,
          kind: a.kind,
          path: a.path,
          bytes: a.bytes,
          sha256: a.sha256,
        })),
      };
    },
    /**
     * Creates the RUNNING row — and is TOLERANT of the one thing that can go
     * wrong here: the row already exists.
     *
     * `RenderStageRun` is unique on `(attemptId, stageId)`. The runner refuses a
     * re-delivered attempt before it writes anything (see `runRenderPipeline`),
     * so this is the belt to that braces: if the insert still collides, the row
     * is looked up and answered with instead of throwing P2002 mid-render.
     *
     *   - an existing RUNNING row is REUSED — the same attempt, the same stage,
     *     the same work in flight, so its id is the right id to finish;
     *   - an existing TERMINAL row (SUCCEEDED / FAILED / BLOCKED / STOPPED) is
     *     never overwritten and never reused: that work has already been
     *     recorded, and rewriting it would erase what the row says happened.
     *     The typed refusal is thrown instead.
     */
    async createStageRun({ jobId, attemptId, stageId, sequence, startedAt, syntheticProof }) {
      try {
        const row = await prisma.renderStageRun.create({
          data: { jobId, attemptId, stageId, sequence, state: "RUNNING", startedAt, syntheticProof },
          select: { id: true },
        });
        return row.id;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        const existing = await prisma.renderStageRun.findUnique({
          where: { attemptId_stageId: { attemptId, stageId } },
          select: { id: true, state: true },
        });
        if (!existing) throw err;
        if (existing.state === "RUNNING") return existing.id;
        throw new AttemptAlreadyRunError(jobId, attemptId, 1);
      }
    },
    async finishStageRun(runId, patch) {
      await prisma.renderStageRun.update({
        where: { id: runId },
        data: {
          state: patch.state,
          finishedAt: patch.finishedAt,
          blockedReason: patch.blockedReason ?? null,
          missingInput: patch.missingInput ?? null,
          errorMessage: patch.errorMessage ?? null,
          artefactCount: patch.artefactCount,
          output: (patch.output ?? undefined) as never,
        },
      });
    },
    async createArtefact({ jobId, stageRunId, stageId, file, createdAt, syntheticProof }) {
      await prisma.renderArtefact.create({
        data: {
          jobId,
          stageRunId,
          stageId,
          kind: file.artefactKind,
          path: file.path,
          bytes: file.bytes,
          sha256: file.sha256,
          createdAt,
          syntheticProof,
        },
      });
    },
    projectFacts: readProjectFacts,
    /**
     * THE PRODUCTION METER (Phase 8, block 5). Every real run uses this store,
     * so every stage row and encoder probe a run produces lands a `UsageEvent`
     * row as it happens. `meter()` never throws: a refused usage row is returned
     * to the runner, which reports it in `RunResult.metering` instead of
     * pretending the accounting succeeded.
     */
    async recordUsage(input) {
      return meter(input);
    },
  };
}
