/**
 * Phase 5 Block 5a — Prisma-backed RepurposeStore (server only).
 *
 * The ONLY place in the repurposing feature that touches the database. It
 * implements the `RepurposeStore` interface from ./service, which keeps the
 * service logic (and its contract tests) free of Prisma.
 *
 * Storage map (no schema migration needed):
 *   - the applied shorts set → ProjectSettings.extra.shortsRepurpose (Json),
 *     MERGED into the existing `extra` object so editorTimeline, colorGrade and
 *     any other settings keys survive untouched.
 *
 * A project without settings yet is upserted on first write; a read of a missing
 * row returns null, which the service reports honestly as "nothing applied".
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { RepurposeStore } from "./service";

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The Prisma implementation of the repurposing system's storage contract. */
export function createPrismaRepurposeStore(): RepurposeStore {
  return {
    async findOwnedProject(userId: string, projectId: string) {
      const row = await prisma.project.findFirst({
        where: { id: projectId, userId, deletedAt: null },
        select: { id: true, title: true },
      });
      return row ?? null;
    },

    /** Scenes in narrative order: chapter order, then scene order. */
    async listScenes(projectId: string) {
      return prisma.scene.findMany({
        where: { projectId },
        select: { id: true, title: true, narration: true, durationSeconds: true },
        orderBy: [{ chapter: { order: "asc" } }, { order: "asc" }],
      });
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

    /** Upsert ProjectSettings, merging `shortsRepurpose` into `extra`. */
    async writeShortsRepurpose(projectId: string, value: unknown) {
      const settings = await prisma.projectSettings.findUnique({
        where: { projectId },
        select: { extra: true },
      });
      const extra: Record<string, unknown> = isObj(settings?.extra) ? { ...settings.extra } : {};
      extra.shortsRepurpose = value ?? null;
      const json = extra as Prisma.InputJsonValue;
      await prisma.projectSettings.upsert({
        where: { projectId },
        create: { projectId, extra: json },
        update: { extra: json },
      });
    },
  };
}
