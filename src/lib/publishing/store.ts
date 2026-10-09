/**
 * Phase 7 Block 1 — Prisma-backed PublishingStore (server only).
 *
 * This is the ONLY place in the publishing feature that touches the database. It
 * implements the `PublishingStore` interface from ./service, which keeps the
 * derivation and its tests free of Prisma.
 *
 * Reads are all tenant-scoped through the caller's resolved project row, and
 * every read is a projection: the store returns exactly the columns the package
 * derives from and nothing else. A date becomes an ISO string here, so the
 * derivation modules stay pure and JSON-safe.
 *
 * Writes are APPEND-ONLY: a build inserts a new row with version = max + 1 for
 * that project. Packages are never updated, so a package a user has seen cannot
 * change under them. `@@unique([projectId, version])` is the backstop if two
 * builds race — the store retries once rather than overwriting.
 */
import { prisma } from "@/lib/db";
import type { SavedPackage, SavedPackageSummary, PublishStore } from "./service";
import type {
  PublishingAssetRow,
  PublishingChapterRow,
  PublishingScriptRow,
  PublishingSettingsRow,
  PublishingSource,
} from "./types";

function iso(value: Date | null | undefined): string | null {
  return value instanceof Date ? value.toISOString() : null;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function createPrismaPublishStore(): PublishStore {
  return {
    async findOwnedProject(userId: string, projectId: string) {
      const row = await prisma.project.findFirst({
        where: { id: projectId, userId, deletedAt: null },
        select: { id: true, title: true },
      });
      return row ? { id: row.id, title: row.title } : null;
    },

    async loadSource(projectId: string): Promise<PublishingSource> {
      const [project, chapters, assets] = await Promise.all([
        prisma.project.findUnique({
          where: { id: projectId },
          select: {
            id: true,
            title: true,
            description: true,
            targetAspectRatio: true,
            targetDurationSeconds: true,
            updatedAt: true,
            settings: {
              select: {
                seoDefaults: true,
                language: true,
                tone: true,
                style: true,
                targetAudience: true,
              },
            },
            script: {
              select: {
                id: true,
                title: true,
                logline: true,
                language: true,
                tone: true,
                style: true,
                targetAudience: true,
              },
            },
          },
        }),
        prisma.chapter.findMany({
          where: { projectId },
          orderBy: { order: "asc" },
          select: {
            id: true,
            scriptId: true,
            order: true,
            title: true,
            summary: true,
            scenes: {
              orderBy: { order: "asc" },
              select: {
                id: true,
                order: true,
                title: true,
                narration: true,
                durationSeconds: true,
                status: true,
              },
            },
          },
        }),
        prisma.asset.findMany({
          where: { projectId, deletedAt: null },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true,
            name: true,
            kind: true,
            status: true,
            mimeType: true,
            createdAt: true,
            licensing: {
              select: {
                id: true,
                licenseType: true,
                source: true,
                attribution: true,
                licenseUrl: true,
                purchasedAt: true,
                expiresAt: true,
              },
            },
          },
        }),
      ]);

      if (!project) throw new Error(`loadSource(): project ${projectId} does not exist`);

      const seo = isObj(project.settings?.seoDefaults) ? project.settings.seoDefaults : null;
      const settings: PublishingSettingsRow | null = project.settings
        ? {
            seoDefaultsDescription: str(seo?.description),
            language: project.settings.language,
            tone: project.settings.tone,
            style: project.settings.style,
            targetAudience: project.settings.targetAudience,
          }
        : null;

      const script: PublishingScriptRow | null = project.script
        ? {
            id: project.script.id,
            title: project.script.title,
            logline: project.script.logline,
            language: project.script.language,
            tone: project.script.tone,
            style: project.script.style,
            targetAudience: project.script.targetAudience,
          }
        : null;

      const chapterRows: PublishingChapterRow[] = chapters.map((c) => ({
        id: c.id,
        scriptId: c.scriptId,
        order: c.order,
        title: c.title,
        summary: c.summary,
        scenes: c.scenes.map((s) => ({
          id: s.id,
          order: s.order,
          title: s.title,
          narration: s.narration,
          durationSeconds: s.durationSeconds,
          status: String(s.status),
        })),
      }));

      const assetRows: PublishingAssetRow[] = assets.map((a) => ({
        id: a.id,
        name: a.name,
        kind: String(a.kind),
        status: String(a.status),
        mimeType: a.mimeType,
        createdAt: a.createdAt.toISOString(),
        licensing: a.licensing
          ? {
              id: a.licensing.id,
              licenseType: String(a.licensing.licenseType),
              source: a.licensing.source,
              attribution: a.licensing.attribution,
              licenseUrl: a.licensing.licenseUrl,
              purchasedAt: iso(a.licensing.purchasedAt),
              expiresAt: iso(a.licensing.expiresAt),
            }
          : null,
      }));

      return {
        project: {
          id: project.id,
          title: project.title,
          description: project.description,
          targetAspectRatio: project.targetAspectRatio ? String(project.targetAspectRatio) : null,
          targetDurationSeconds: project.targetDurationSeconds,
          updatedAt: project.updatedAt.toISOString(),
        },
        settings,
        script,
        chapters: chapterRows,
        assets: assetRows,
      };
    },

    async savePackage({ userId, projectId, pkg }): Promise<{ id: string; version: number; derivedAt: string }> {
      const summary = pkg.summary;
      const payload = pkg as unknown as object;
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const last = await prisma.publishingPackage.findFirst({
          where: { projectId },
          orderBy: { version: "desc" },
          select: { version: true },
        });
        const version = (last?.version ?? 0) + 1;
        try {
          const row = await prisma.publishingPackage.create({
            data: {
              projectId,
              userId,
              version,
              format: pkg.format,
              sourceFingerprint: pkg.sourceFingerprint,
              chapterCount: summary.chapters,
              sceneCount: summary.scenes,
              assetCount: summary.assets,
              keywordCount: summary.keywords,
              tagCount: summary.tags,
              hashtagCount: summary.hashtags,
              emptyFieldCount: summary.fields.emptyNoInput,
              payload: payload as never,
              derivedAt: new Date(pkg.derivedAt),
            },
            select: { id: true, version: true, derivedAt: true },
          });
          return { id: row.id, version: row.version, derivedAt: row.derivedAt.toISOString() };
        } catch (err) {
          const code = (err as { code?: string }).code;
          if (code !== "P2002" || attempt === 2) throw err;
        }
      }
      throw new Error("savePackage(): could not allocate a version after 3 attempts");
    },

    async latestPackage(projectId: string): Promise<SavedPackage | null> {
      const row = await prisma.publishingPackage.findFirst({
        where: { projectId },
        orderBy: { version: "desc" },
      });
      if (!row) return null;
      return {
        id: row.id,
        version: row.version,
        derivedAt: row.derivedAt.toISOString(),
        sourceFingerprint: row.sourceFingerprint,
        format: row.format,
        payload: row.payload as unknown as SavedPackage["payload"],
        payloadBytes: Buffer.byteLength(JSON.stringify(row.payload), "utf8"),
      };
    },

    async listPackages(projectId: string): Promise<SavedPackageSummary[]> {
      const rows = await prisma.publishingPackage.findMany({
        where: { projectId },
        orderBy: { version: "desc" },
        select: {
          id: true,
          version: true,
          derivedAt: true,
          sourceFingerprint: true,
          chapterCount: true,
          sceneCount: true,
          assetCount: true,
          keywordCount: true,
          tagCount: true,
          hashtagCount: true,
          emptyFieldCount: true,
        },
      });
      return rows.map((r) => ({
        id: r.id,
        version: r.version,
        derivedAt: r.derivedAt.toISOString(),
        sourceFingerprint: r.sourceFingerprint,
        counts: {
          chapters: r.chapterCount,
          scenes: r.sceneCount,
          assets: r.assetCount,
          keywords: r.keywordCount,
          tags: r.tagCount,
          hashtags: r.hashtagCount,
          emptyFields: r.emptyFieldCount,
        },
      }));
    },
  };
}
