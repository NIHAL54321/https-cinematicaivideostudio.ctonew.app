/**
 * Phase 6 Block 1 — Prisma-backed ExportStore (server only).
 *
 * This is the ONLY place in the export feature that touches the database. It
 * implements the `ExportStore` interface from ./service, which keeps the service
 * logic (and its contract tests) free of Prisma.
 *
 * Storage map (no schema migration):
 *   - the applied export presets → ProjectSettings.extra.exportPreset (Json),
 *     MERGED into the existing `extra` object so editorTimeline (Phase 5 Block 1),
 *     colorGrade (Block 4), shortsRepurpose (Block 5a) and framing (Block 5b)
 *     survive untouched. A clear writes a bare `null`, so nothing half-applied
 *     can be left behind.
 *
 * Real, read-only inputs:
 *   - `listScenes` reads the project's scenes (with their real durations) so the
 *     duration can be summed when no timeline has been saved.
 *   - `readRawTimeline` reads the saved editor timeline so the duration comes
 *     from the project's actual cut rather than from an assumption.
 *
 * A project without settings yet is upserted on first write; reads of a missing
 * row return null, which the service reports honestly as "no choice applied".
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { ExportSceneRow, ExportStore } from "./service";

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** The Prisma implementation of the export system's storage contract. */
export function createPrismaExportStore(): ExportStore {
  return {
    async findOwnedProject(userId: string, projectId: string) {
      const row = await prisma.project.findFirst({
        where: { id: projectId, userId, deletedAt: null },
        select: { id: true, title: true },
      });
      return row ? { id: row.id, title: row.title } : null;
    },

    /** Scenes in narrative order — their durations feed the fallback duration sum. */
    async listScenes(projectId: string): Promise<ExportSceneRow[]> {
      return prisma.scene.findMany({
        where: { projectId },
        select: { id: true, title: true, durationSeconds: true },
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

    /** ProjectSettings.extra.exportPreset (unvalidated raw JSON) or null. */
    async readExportPreset(projectId: string) {
      const settings = await prisma.projectSettings.findUnique({
        where: { projectId },
        select: { extra: true },
      });
      if (!isObj(settings?.extra)) return null;
      const value = settings.extra.exportPreset;
      return value === undefined ? null : value;
    },

    /**
     * Upsert ProjectSettings, merging `exportPreset` into `extra` — the same
     * merge strategy every other block uses, so the timeline, the grade
     * assignment, the shorts set and the reframe overrides all survive.
     * `value === null` writes a bare null, which clears the choice.
     */
    async writeExportPreset(projectId: string, value: unknown) {
      const settings = await prisma.projectSettings.findUnique({
        where: { projectId },
        select: { extra: true },
      });
      const extra: Record<string, unknown> = isObj(settings?.extra) ? { ...settings.extra } : {};
      extra.exportPreset = value ?? null;
      const json = extra as Prisma.InputJsonValue;
      await prisma.projectSettings.upsert({
        where: { projectId },
        create: { projectId, extra: json },
        update: { extra: json },
      });
    },
  };
}
