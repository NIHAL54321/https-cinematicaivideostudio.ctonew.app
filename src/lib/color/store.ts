/**
 * Phase 5 Block 4 — Prisma-backed ColorStore (server only).
 *
 * The ONLY place in the colour feature that touches the database. It implements
 * the `ColorStore` interface from ./service, which keeps the service logic (and
 * its contract tests) free of Prisma.
 *
 * Storage map (no schema migration needed):
 *   - the grade assignment → ProjectSettings.extra.colorGrade (Json), MERGED
 *     into the existing `extra` object so editorTimeline and any other settings
 *     keys survive untouched.
 *
 * A project without settings yet is upserted on first write; reads of a missing
 * row return null, which the service reports honestly as "no assignment".
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ColorStore } from "./service";

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The Prisma implementation of the colour system's storage contract. */
export function createPrismaColorStore(): ColorStore {
  return {
    async findOwnedProject(userId: string, projectId: string) {
      const row = await prisma.project.findFirst({
        where: { id: projectId, userId, deletedAt: null },
        select: { id: true, title: true },
      });
      return row ?? null;
    },

    /** ProjectSettings.extra.colorGrade (unvalidated raw JSON) or null. */
    async readColorGrade(projectId: string) {
      const settings = await prisma.projectSettings.findUnique({
        where: { projectId },
        select: { extra: true },
      });
      if (!isObj(settings?.extra)) return null;
      const value = settings.extra.colorGrade;
      return value === undefined ? null : value;
    },

    /** Upsert ProjectSettings, merging `colorGrade` into `extra`. */
    async writeColorGrade(projectId: string, value: unknown) {
      const settings = await prisma.projectSettings.findUnique({
        where: { projectId },
        select: { extra: true },
      });
      const extra: Record<string, unknown> = isObj(settings?.extra) ? { ...settings.extra } : {};
      extra.colorGrade = value ?? null;
      const json = extra as Prisma.InputJsonValue;
      await prisma.projectSettings.upsert({
        where: { projectId },
        create: { projectId, extra: json },
        update: { extra: json },
      });
    },

    /** Scenes in narrative order: chapter order, then scene order. */
    async listScenes(projectId: string) {
      return prisma.scene.findMany({
        where: { projectId },
        select: { id: true, title: true },
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
  };
}
