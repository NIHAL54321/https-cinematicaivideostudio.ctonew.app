/**
 * Phase 5 Block 1 — Prisma-backed EditorStore (server only).
 *
 * This is the ONLY place in the editor feature that touches the database. It
 * implements the small `EditorStore` interface from ./service, which keeps the
 * service logic (and its contract tests) free of Prisma.
 *
 * Storage map (no schema migration in Block 1):
 *   - the working timeline  → ProjectSettings.extra.editorTimeline (Json),
 *     merged into the existing `extra` object so other settings keys survive,
 *   - named versions        → ProjectVersion rows (snapshot = editor snapshot
 *     envelope, note + createdById for the audit trail).
 *
 * Honest numbers: the versions list is read with a projection that returns the
 * STORED byte size (pg_column_size) and the clip count / duration recorded in
 * the snapshot envelope — it never ships the snapshot payload itself.
 */
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { EditorSceneRow, EditorStore, EditorVersionRow } from "./service";
import type { FramingAssetRow } from "../framing/service";
import { EDITOR_TIMELINE_FORMAT, isEditorSnapshot, snapshotBytes, validateTimelineShape } from "./versions";

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toInt(v: unknown, fallback = 0): number {
  const n = typeof v === "number" ? v : typeof v === "bigint" ? Number(v) : Number(v);
  return Number.isFinite(n) ? Math.round(n) : fallback;
}

function toDate(v: unknown): Date {
  return v instanceof Date ? v : new Date(typeof v === "string" ? v : 0);
}

/** Snapshot → honest (clipCount, durationMs) without a full validation pass. */
function snapshotStats(snapshot: unknown): { clipCount: number; durationMs: number } {
  if (isObj(snapshot)) {
    const clipCount = typeof snapshot.clipCount === "number" ? Math.round(snapshot.clipCount) : undefined;
    const durationMs = typeof snapshot.durationMs === "number" ? Math.round(snapshot.durationMs) : undefined;
    if (clipCount !== undefined && durationMs !== undefined) return { clipCount, durationMs };
  }
  const check = validateTimelineShape(snapshot);
  return check.ok
    ? { clipCount: check.timeline.clips.length, durationMs: check.timeline.durationMs }
    : { clipCount: 0, durationMs: 0 };
}

/**
 * Versions, newest first, WITHOUT the snapshot payloads.
 *
 * The primary path is a projection query: real stored byte size + the counts
 * recorded in the envelope + whether the row is an EDITOR snapshot (Block 2:
 * Phase 1-3 project snapshots live in the same table and must not be listed as
 * restorable editor versions). If that ever fails on a surprising schema, we
 * fall back to reading the rows and computing the same numbers in JS — the shape
 * the caller sees is identical either way (and still never includes the snapshot).
 */
async function listVersionRows(projectId: string): Promise<EditorVersionRow[]> {
  try {
    const rows = await prisma.$queryRaw<
      {
        versionNumber: number;
        note: string | null;
        createdAt: Date;
        snapshotBytes: number;
        clipCount: number;
        durationMs: number;
        editorSnapshot: boolean;
      }[]
    >`
      SELECT "versionNumber",
             "note",
             "createdAt",
             pg_column_size("snapshot") AS "snapshotBytes",
             CASE
               WHEN jsonb_typeof("snapshot" -> 'clipCount') = 'number' THEN ("snapshot" ->> 'clipCount')::int
               WHEN jsonb_typeof("snapshot" -> 'timeline' -> 'clips') = 'array'
                 THEN jsonb_array_length("snapshot" -> 'timeline' -> 'clips')
               ELSE 0
             END AS "clipCount",
             CASE
               WHEN jsonb_typeof("snapshot" -> 'durationMs') = 'number' THEN ("snapshot" ->> 'durationMs')::int
               ELSE 0
             END AS "durationMs",
             ("snapshot" ->> 'format' = ${EDITOR_TIMELINE_FORMAT}
               AND jsonb_typeof("snapshot" -> 'timeline') = 'object') AS "editorSnapshot"
      FROM "ProjectVersion"
      WHERE "projectId" = ${projectId}
      ORDER BY "versionNumber" DESC
      LIMIT 200
    `;
    return rows.map((r) => ({
      versionNumber: toInt(r.versionNumber),
      note: r.note ?? null,
      createdAt: toDate(r.createdAt),
      snapshotBytes: toInt(r.snapshotBytes),
      clipCount: toInt(r.clipCount),
      durationMs: toInt(r.durationMs),
      editorSnapshot: r.editorSnapshot === true,
    }));
  } catch (err) {
    console.error("[editor] version projection query failed, falling back:", err);
    const rows = await prisma.projectVersion.findMany({
      where: { projectId },
      orderBy: { versionNumber: "desc" },
      take: 200,
      select: { versionNumber: true, note: true, createdAt: true, snapshot: true },
    });
    return rows.map((r) => {
      const stats = snapshotStats(r.snapshot);
      return {
        versionNumber: r.versionNumber,
        note: r.note,
        createdAt: r.createdAt,
        snapshotBytes: snapshotBytes(r.snapshot),
        clipCount: stats.clipCount,
        durationMs: stats.durationMs,
        editorSnapshot: isEditorSnapshot(r.snapshot),
      };
    });
  }
}

/** The Prisma implementation of the editor's storage contract. */
export function createPrismaEditorStore(): EditorStore {
  return {
    async findOwnedProject(userId: string, projectId: string) {
      const row = await prisma.project.findFirst({
        where: { id: projectId, userId, deletedAt: null },
        select: { id: true, title: true, targetAspectRatio: true },
      });
      return row ? { id: row.id, title: row.title, targetAspect: row.targetAspectRatio } : null;
    },

    /** Scenes in narrative order: chapter order, then scene order. */
    async listScenes(projectId: string): Promise<EditorSceneRow[]> {
      return prisma.scene.findMany({
        where: { projectId },
        select: { id: true, title: true, narration: true, durationSeconds: true, visualPrompt: true, aspectRatio: true },
        orderBy: [{ chapter: { order: "asc" } }, { order: "asc" }],
      });
    },

    /**
     * Block 5b — assets with REAL pixel dimensions and the scenes they are
     * attached to. Assets without dimensions (or attached to no scene) are
     * absent rather than guessed at.
     */
    async listMediaAssets(projectId: string): Promise<FramingAssetRow[]> {
      const rows = await prisma.asset.findMany({
        where: { projectId, deletedAt: null, width: { not: null }, height: { not: null } },
        select: { id: true, name: true, width: true, height: true, sceneAssets: { select: { sceneId: true } } },
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

    /** Upsert ProjectSettings, merging `editorTimeline` into `extra`. */
    async writeRawTimeline(projectId: string, timeline: unknown) {
      const settings = await prisma.projectSettings.findUnique({
        where: { projectId },
        select: { extra: true },
      });
      const extra: Record<string, unknown> = isObj(settings?.extra) ? { ...settings.extra } : {};
      extra.editorTimeline = timeline ?? null;
      const value = extra as Prisma.InputJsonValue;
      await prisma.projectSettings.upsert({
        where: { projectId },
        create: { projectId, extra: value },
        update: { extra: value },
      });
    },

    listVersionRows,

    async nextVersionNumber(projectId: string): Promise<number> {
      const agg = await prisma.projectVersion.aggregate({
        where: { projectId },
        _max: { versionNumber: true },
      });
      return (agg._max.versionNumber ?? 0) + 1;
    },

    async insertVersion(input: {
      projectId: string;
      versionNumber: number;
      note: string | null;
      snapshot: unknown;
      createdById: string;
    }) {
      return prisma.projectVersion.create({
        data: {
          projectId: input.projectId,
          versionNumber: input.versionNumber,
          note: input.note,
          snapshot: input.snapshot as Prisma.InputJsonValue,
          createdById: input.createdById,
        },
        select: { versionNumber: true, createdAt: true },
      });
    },

    async findVersion(projectId: string, versionNumber: number) {
      const row = await prisma.projectVersion.findUnique({
        where: { projectId_versionNumber: { projectId, versionNumber } },
        select: { snapshot: true, createdAt: true },
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

    /**
     * Upsert ProjectSettings, merging `colorGrade` into `extra` — the same merge
     * strategy writeRawTimeline uses, so the Block 4 grade assignment and the
     * Block 1 timeline never overwrite each other.
     */
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

    /**
     * Upsert ProjectSettings, merging `shortsRepurpose` into `extra` — the same
     * merge strategy the timeline and the grade assignment use, so Block 1's
     * timeline, Block 4's grading and Block 5a's shorts set never overwrite each
     * other.
     */
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
     * Upsert ProjectSettings, merging `framing` into `extra` — Block 5b's
     * reframe overrides sit beside the timeline, the grade assignment and the
     * shorts set without overwriting any of them.
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
     * Upsert ProjectSettings, merging `exportPreset` into `extra` — Phase 6
     * Block 1's applied delivery presets sit beside the timeline, the grade
     * assignment, the shorts set and the reframe overrides without overwriting
     * any of them. A null value clears the choice.
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
