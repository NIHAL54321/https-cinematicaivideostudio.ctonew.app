/**
 * The Prisma-backed implementation of the runner's store contract, plus the
 * facts the pipeline reads from a project's own rows.
 *
 * Every query is scoped by project/user id where the caller supplies one: the
 * API layer resolves ownership FIRST (a foreign project is a 404), and this
 * layer never widens it.
 */
import { prisma } from "@/lib/db";
import type { RenderStore } from "./runner";
import type { ProjectFacts, RenderJobFacts, RenderSceneFact } from "./types";

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
            select: { asset: { select: { s3Key: true, url: true } } },
          },
        },
      },
    },
  });
  if (!project) throw new Error(`project ${projectId} does not exist (or is deleted) — no facts to read`);
  const scenes: RenderSceneFact[] = project.scenes.map((s) => ({
    id: s.id,
    order: s.order,
    durationSeconds: s.durationSeconds,
    narrationChars: (s.narration ?? "").length,
    subtitleCount: s._count.subtitles,
    assetCount: s._count.assets,
    sourcePath: s.assets[0]?.asset?.s3Key ?? s.assets[0]?.asset?.url ?? null,
  }));
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
    async createStageRun({ jobId, stageId, sequence, startedAt }) {
      const row = await prisma.renderStageRun.create({
        data: { jobId, stageId, sequence, state: "RUNNING", startedAt },
        select: { id: true },
      });
      return row.id;
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
    async createArtefact({ jobId, stageRunId, stageId, file, createdAt }) {
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
        },
      });
    },
    projectFacts: readProjectFacts,
  };
}
