/**
 * Phase 5 Block 5b — Prisma-backed FramingStore (server only).
 *
 * This is the ONLY place in the framing feature that touches the database. It
 * implements the `FramingStore` interface from ./service, which keeps the
 * service logic (and its contract tests) free of Prisma.
 *
 * Storage map (no schema migration):
 *   - the reframe assignment → ProjectSettings.extra.framing (Json), MERGED into
 *     the existing `extra` object so editorTimeline (Block 1), colorGrade
 *     (Block 4) and shortsRepurpose (Block 5a) survive untouched.
 *
 * Real source geometry (read-only, never written):
 *   - `listMediaAssets` reads Asset.width / Asset.height for the project's
 *     non-deleted assets together with the SceneAsset links, so the framing
 *     engine can plan from the REAL pixel dimensions of the footage the project
 *     holds instead of assuming a frame size. Assets without dimensions, or not
 *     linked to any scene, are simply absent — nothing is invented for them.
 *
 * A project without settings yet is upserted on first write; reads of a missing
 * row return null, which the service reports honestly as "no override".
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { FramingAssetRow, FramingStore } from "./service";

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The Prisma implementation of the framing system's storage contract. */
export function createPrismaFramingStore(): FramingStore {
  return {
    async findOwnedProject(userId: string, projectId: string) {
      const row = await prisma.project.findFirst({
        where: { id: projectId, userId, deletedAt: null },
        select: { id: true, title: true, targetAspectRatio: true },
      });
      return row ? { id: row.id, title: row.title, targetAspect: row.targetAspectRatio } : null;
    },

    /** Scenes in narrative order: chapter order, then scene order. */
    async listScenes(projectId: string) {
      return prisma.scene.findMany({
        where: { projectId },
        select: { id: true, title: true, narration: true, durationSeconds: true, aspectRatio: true },
        orderBy: [{ chapter: { order: "asc" } }, { order: "asc" }],
      });
    },

    /** Assets with REAL pixel dimensions, and the scenes they are attached to. */
    async listMediaAssets(projectId: string): Promise<FramingAssetRow[]> {
      const rows = await prisma.asset.findMany({
        where: { projectId, deletedAt: null, width: { not: null }, height: { not: null } },
        select: {
          id: true,
          name: true,
          width: true,
          height: true,
          sceneAssets: { select: { sceneId: true } },
        },
        orderBy: { createdAt: "asc" },
      });
      return rows
        .filter((r) => typeof r.width === "number" && typeof r.height === "number" && r.width > 0 && r.height > 0)
        .map((r) => ({
          id: r.id,
          name: r.name,
          widthPx: r.width as number,
          heightPx: r.height as number,
          sceneIds: [...new Set(r.sceneAssets.map((s) => s.sceneId))],
        }));
    },

    /** ProjectSettings.extra.editorTimeline (unvalidated raw JSON) or null. */
    async readRawTimeline(projectId: string) {
      const settings = await prisma.projectSettings.findUnique({
        where: { projectId },
        select: { extra: true },
      });
      if (!isObj(settings?.extra)) return null;
      const value = settings.extra.editorTimeline;
      return value === undefined ? null : value;
    },

    /** ProjectSettings.extra.shortsRepurpose (unvalidated raw JSON) or null. */
    async readShortsRepurpose(projectId: string) {
      const settings = await prisma.projectSettings.findUnique({
        where: { projectId },
        select: { extra: true },
      });
      if (!isObj(settings?.extra)) return null;
      const value = settings.extra.shortsRepurpose;
      return value === undefined ? null : value;
    },

    /** ProjectSettings.extra.framing (unvalidated raw JSON) or null. */
    async readFraming(projectId: string) {
      const settings = await prisma.projectSettings.findUnique({
        where: { projectId },
        select: { extra: true },
      });
      if (!isObj(settings?.extra)) return null;
      const value = settings.extra.framing;
      return value === undefined ? null : value;
    },

    /**
     * Upsert ProjectSettings, merging `framing` into `extra` — the same merge
     * strategy the timeline, the grade assignment and the shorts set use, so no
     * block can overwrite another block's settings.
     */
    async writeFraming(projectId: string, value: unknown) {
      const settings = await prisma.projectSettings.findUnique({
        where: { projectId },
        select: { extra: true },
      });
      const extra: Record<string, unknown> = isObj(settings?.extra) ? { ...settings.extra } : {};
      extra.framing = value ?? null;
      const json = extra as Prisma.InputJsonValue;
      await prisma.projectSettings.upsert({
        where: { projectId },
        create: { projectId, extra: json },
        update: { extra: json },
      });
    },
  };
}
