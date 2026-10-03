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
import type { ExportProjectMeta, ExportSceneRow, ExportStore, ThumbnailAssetRow } from "./service";

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
        select: { id: true, title: true, narration: true, durationSeconds: true },
        orderBy: [{ chapter: { order: "asc" } }, { order: "asc" }],
      });
    },

    /**
     * Block 3 — the project's own text and declared format. `seoDefaults` is
     * free-form JSON (Phase 1), so it is reduced LENIENTLY to the three fields
     * the metadata sidecar can actually use: a non-string title/description or a
     * non-array tags value is reported as absent, never coerced into text.
     */
    async readProjectMeta(projectId: string): Promise<ExportProjectMeta | null> {
      const row = await prisma.project.findUnique({
        where: { id: projectId },
        select: {
          description: true,
          targetAspectRatio: true,
          targetDurationSeconds: true,
          settings: { select: { seoDefaults: true } },
        },
      });
      if (!row) return null;
      const seo = isObj(row.settings?.seoDefaults) ? row.settings.seoDefaults : null;
      const title = typeof seo?.title === "string" && seo.title.trim() ? seo.title.trim() : null;
      const description = typeof seo?.description === "string" && seo.description.trim() ? seo.description.trim() : null;
      const tagsRaw = seo?.tags;
      // Tags may be stored as an array or as a comma-separated string (the SEO
      // surface's own template); anything else is absent.
      const tags =
        Array.isArray(tagsRaw)
          ? tagsRaw.map((t) => String(t).trim()).filter(Boolean)
          : typeof tagsRaw === "string" && tagsRaw.trim()
            ? tagsRaw.split(",").map((t) => t.trim()).filter(Boolean)
            : null;
      return {
        description: row.description ?? null,
        targetAspect: row.targetAspectRatio ?? null,
        targetDurationSeconds: row.targetDurationSeconds ?? null,
        seoDefaults: seo ? { title, description, tags: tags && tags.length > 0 ? tags : null } : null,
        seoDefaultsSource: seo ? "ProjectSettings.seoDefaults (Phase 1, free-form JSON, read leniently)" : null,
      };
    },

    /**
     * Block 3 — the project's thumbnail assets. Only THUMBNAIL-kind assets are
     * returned (a generated image is not a thumbnail), and every status is
     * returned so the service can report "assets exist but none is READY"
     * instead of silently reporting none.
     */
    async listThumbnailAssets(projectId: string): Promise<ThumbnailAssetRow[]> {
      const rows = await prisma.asset.findMany({
        where: { projectId, deletedAt: null, kind: "THUMBNAIL" },
        select: { id: true, name: true, status: true, width: true, height: true },
        orderBy: { createdAt: "asc" },
      });
      return rows.map((r) => ({
        id: r.id,
        name: r.name,
        status: r.status,
        widthPx: r.width ?? null,
        heightPx: r.height ?? null,
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

    /**
     * Phase 6 Block 5 — the export JOB records (ProjectSettings.extra.exportJobs,
     * unvalidated raw JSON) or null. Stored beside the timeline, the grade, the
     * shorts set, the reframe overrides and the applied presets, with the same
     * merge strategy, so no schema migration is needed for a JSON snapshot.
     */
    async readExportJobs(projectId: string) {
      const settings = await prisma.projectSettings.findUnique({
        where: { projectId },
        select: { extra: true },
      });
      if (!isObj(settings?.extra)) return null;
      const value = settings.extra.exportJobs;
      return value === undefined ? null : value;
    },

    /** Append/rewrite the job list without touching any other extra key. */
    async writeExportJobs(projectId: string, value: unknown) {
      const settings = await prisma.projectSettings.findUnique({
        where: { projectId },
        select: { extra: true },
      });
      const extra: Record<string, unknown> = isObj(settings?.extra) ? { ...settings.extra } : {};
      extra.exportJobs = value ?? null;
      const json = extra as Prisma.InputJsonValue;
      await prisma.projectSettings.upsert({
        where: { projectId },
        create: { projectId, extra: json },
        update: { extra: json },
      });
    },
  };
}
