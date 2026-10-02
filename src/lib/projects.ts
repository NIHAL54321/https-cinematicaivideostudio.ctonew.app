import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { Prisma } from "@prisma/client";
import { buildBrandDefaultsPatch } from "@/lib/brandkit";

/**
 * Project system — server-side business logic (tenant-scoped).
 *
 * Every function takes `userId` and scopes all reads/writes with it. A user
 * can never see or touch another user's projects: ids are only ever used in
 * `findFirst({ where: { id, userId, ... } })` style queries.
 *
 * Version snapshots (ProjectVersion.snapshot) store a plain-JSON copy of the
 * project tree at a point in time:
 *
 *   { format: 1,
 *     project: { title, description, status, targetAspectRatio,
 *                targetDurationSeconds, brandKitId },
 *     settings: { defaultAspectRatio, language, targetAudience, tone, style,
 *                 voiceoverDefaults, subtitleDefaults, musicDefaults,
 *                 seoDefaults, extra },
 *     script: null | { title, logline, language, targetAudience, tone, style,
 *                      chapters: [{ title, order, summary, scenes: [...] }] } }
 */

// ---------------------------------------------------------------------------
// Types (shared with the client via `import type` — erased at build time)
// ---------------------------------------------------------------------------

export const PROJECT_STATUSES = ["DRAFT", "PLANNING", "IN_PRODUCTION", "COMPLETE", "ARCHIVED"] as const;
export type ProjectStatusValue = (typeof PROJECT_STATUSES)[number];

export const ASPECT_RATIO_VALUES = [
  "SIXTEEN_NINE",
  "NINE_SIXTEEN",
  "ONE_ONE",
  "FOUR_THREE",
  "TWENTY_ONE_NINE",
  "FOUR_FIVE",
] as const;
export type AspectRatioValue = (typeof ASPECT_RATIO_VALUES)[number];

export type ProjectSummary = {
  id: string;
  title: string;
  description: string | null;
  status: string;
  targetAspectRatio: string | null;
  targetDurationSeconds: number | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
};

export type ProjectSettingsSummary = {
  defaultAspectRatio: string;
  language: string | null;
  targetAudience: string | null;
  tone: string | null;
  style: string | null;
  voiceoverDefaults: unknown;
  subtitleDefaults: unknown;
  musicDefaults: unknown;
  seoDefaults: unknown;
  extra: unknown;
};

export type ProjectDetail = ProjectSummary & {
  settings: ProjectSettingsSummary | null;
  scriptCounts: { chapters: number; scenes: number };
  versionCount: number;
};

export type VersionSummary = {
  id: string;
  versionNumber: number;
  note: string | null;
  createdAt: string;
  createdBy: { name: string | null; email: string } | null;
  snapshotTitle: string | null;
  snapshotCounts: { chapters: number; scenes: number };
};

export type SnapshotShape = {
  format: number;
  project: {
    title: string;
    description: string | null;
    status: string;
    targetAspectRatio: string | null;
    targetDurationSeconds: number | null;
    brandKitId: string | null;
  };
  settings: ProjectSettingsSummary | null;
  script: null | {
    title: string | null;
    logline: string | null;
    language: string | null;
    targetAudience: string | null;
    tone: string | null;
    style: string | null;
    chapters: {
      title: string;
      order: number;
      summary: string | null;
      scenes: {
        order: number;
        title: string | null;
        narration: string | null;
        visualPrompt: string | null;
        aspectRatio: string | null;
        targetLanguage: string | null;
        voiceId: string | null;
        durationSeconds: number | null;
        status: string;
      }[];
    }[];
  };
};

type Db = Prisma.TransactionClient | typeof prisma;

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

function iso(d: Date): string {
  return d.toISOString();
}

export function projectSummary(p: {
  id: string;
  title: string;
  description: string | null;
  status: string;
  targetAspectRatio: string | null;
  targetDurationSeconds: number | null;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}): ProjectSummary {
  return {
    id: p.id,
    title: p.title,
    description: p.description,
    status: p.status,
    targetAspectRatio: p.targetAspectRatio,
    targetDurationSeconds: p.targetDurationSeconds,
    createdAt: iso(p.createdAt),
    updatedAt: iso(p.updatedAt),
    deletedAt: p.deletedAt ? iso(p.deletedAt) : null,
  };
}

// ---------------------------------------------------------------------------
// Snapshots & versions
// ---------------------------------------------------------------------------

const SNAPSHOT_FORMAT = 1;

/** Builds the plain-JSON snapshot of a project's full tree. */
export async function buildProjectSnapshot(projectId: string, db: Db = prisma): Promise<SnapshotShape> {
  const project = await db.project.findUnique({
    where: { id: projectId },
    include: {
      settings: true,
      script: {
        include: {
          chapters: {
            orderBy: { order: "asc" },
            include: { scenes: { orderBy: { order: "asc" } } },
          },
        },
      },
    },
  });
  if (!project) throw new ApiError(404, "Project not found.", "not_found");

  const settings = project.settings
    ? {
        defaultAspectRatio: project.settings.defaultAspectRatio,
        language: project.settings.language,
        targetAudience: project.settings.targetAudience,
        tone: project.settings.tone,
        style: project.settings.style,
        voiceoverDefaults: project.settings.voiceoverDefaults,
        subtitleDefaults: project.settings.subtitleDefaults,
        musicDefaults: project.settings.musicDefaults,
        seoDefaults: project.settings.seoDefaults,
        extra: project.settings.extra,
      }
    : null;

  const script = project.script
    ? {
        title: project.script.title,
        logline: project.script.logline,
        language: project.script.language,
        targetAudience: project.script.targetAudience,
        tone: project.script.tone,
        style: project.script.style,
        chapters: project.script.chapters.map((ch) => ({
          title: ch.title,
          order: ch.order,
          summary: ch.summary,
          scenes: ch.scenes.map((sc) => ({
            order: sc.order,
            title: sc.title,
            narration: sc.narration,
            visualPrompt: sc.visualPrompt,
            aspectRatio: sc.aspectRatio,
            targetLanguage: sc.targetLanguage,
            voiceId: sc.voiceId,
            durationSeconds: sc.durationSeconds,
            status: sc.status,
          })),
        })),
      }
    : null;

  return {
    format: SNAPSHOT_FORMAT,
    project: {
      title: project.title,
      description: project.description,
      status: project.status,
      targetAspectRatio: project.targetAspectRatio,
      targetDurationSeconds: project.targetDurationSeconds,
      brandKitId: project.brandKitId,
    },
    settings,
    script,
  };
}

/** Creates the next ProjectVersion row (number = max + 1). Runs inside `db`. */
export async function createVersion(
  projectId: string,
  note: string | null,
  createdById: string,
  db: Db = prisma,
): Promise<string> {
  const agg = await db.projectVersion.aggregate({
    where: { projectId },
    _max: { versionNumber: true },
  });
  const versionNumber = (agg._max.versionNumber ?? 0) + 1;
  const snapshot = await buildProjectSnapshot(projectId, db);
  const created = await db.projectVersion.create({
    data: {
      projectId,
      versionNumber,
      snapshot: snapshot as unknown as Prisma.InputJsonValue,
      note,
      createdById,
    },
  });
  return created.id;
}

/** Lightweight summary of a snapshot for list rows (avoids shipping the JSON). */
export function snapshotSummary(snapshot: unknown): { title: string | null; chapters: number; scenes: number } {
  const s = snapshot as SnapshotShape | null;
  if (!s || s.format !== SNAPSHOT_FORMAT || !s.project) {
    return { title: null, chapters: 0, scenes: 0 };
  }
  const chapters = s.script?.chapters ?? [];
  return {
    title: s.project.title ?? null,
    chapters: chapters.length,
    scenes: chapters.reduce((n, ch) => n + (ch.scenes?.length ?? 0), 0),
  };
}

export function versionSummary(v: {
  id: string;
  versionNumber: number;
  note: string | null;
  createdAt: Date;
  snapshot: Prisma.JsonValue;
  createdBy: { name: string | null; email: string } | null;
}): VersionSummary {
  const { title, chapters, scenes } = snapshotSummary(v.snapshot);
  return {
    id: v.id,
    versionNumber: v.versionNumber,
    note: v.note,
    createdAt: iso(v.createdAt),
    createdBy: v.createdBy ? { name: v.createdBy.name, email: v.createdBy.email } : null,
    snapshotTitle: title,
    snapshotCounts: { chapters, scenes },
  };
}

// ---------------------------------------------------------------------------
// Tenant-scoped lookup
// ---------------------------------------------------------------------------

export async function getOwnedProject(userId: string, id: string, includeDeleted = false) {
  const project = await prisma.project.findFirst({
    where: { id, userId, deletedAt: includeDeleted ? { not: null } : null },
  });
  if (!project) throw new ApiError(404, "Project not found.", "not_found");
  return project;
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createProject(userId: string, title: string): Promise<ProjectDetail> {
  const trimmed = title.trim();
  // Phase 3 Brand Kit: if the user has a kit, seed the new project's settings
  // with its defaults (colors, fonts, voice/subtitle/music/thumbnail defaults,
  // intro/outro, watermark) so every new video inherits the brand. Explicit
  // settings set later always win — seeding only fills the initially-empty row.
  const kit = await prisma.brandKit.findFirst({ where: { userId } });
  const seedPatch = kit ? buildBrandDefaultsPatch(kit) : null;
  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: { userId, title: trimmed || "Untitled Video", brandKitId: kit?.id ?? null },
    });
    const settingsData: Prisma.ProjectSettingsUncheckedCreateInput = { projectId: created.id };
    if (seedPatch?.language) settingsData.language = seedPatch.language;
    if (seedPatch?.voiceoverDefaults) settingsData.voiceoverDefaults = seedPatch.voiceoverDefaults as Prisma.InputJsonValue;
    if (seedPatch?.subtitleDefaults) settingsData.subtitleDefaults = seedPatch.subtitleDefaults as Prisma.InputJsonValue;
    if (seedPatch?.musicDefaults) settingsData.musicDefaults = seedPatch.musicDefaults as Prisma.InputJsonValue;
    if (seedPatch?.extra) settingsData.extra = seedPatch.extra as Prisma.InputJsonValue;
    await tx.projectSettings.create({ data: settingsData });
    return created;
  });
  await createVersion(project.id, "Project created", userId);
  return getProjectDetail(userId, project.id);
}

// ---------------------------------------------------------------------------
// Update (auto-save) — PATCH semantics: only provided fields are touched.
// Writes a ProjectVersion snapshot only when something actually changed.
// ---------------------------------------------------------------------------

export type ProjectPatch = {
  project?: Partial<{
    title: string;
    description: string | null;
    status: ProjectStatusValue;
    targetAspectRatio: AspectRatioValue | null;
    targetDurationSeconds: number | null;
  }>;
  settings?: Partial<ProjectSettingsSummary>;
};

const MAX_TITLE = 120;
const MAX_DESCRIPTION = 2000;
const MAX_STRING = 500;

function asString(v: unknown, field: string, max: number): string {
  if (typeof v !== "string") throw new ApiError(400, `Field "${field}" must be a string.`, "bad_input");
  return v.trim().slice(0, max);
}

/** Validates + normalizes a raw PATCH body. Throws 400 on invalid input. */
export function parseProjectPatch(body: unknown): ProjectPatch {
  if (typeof body !== "object" || body === null) {
    throw new ApiError(400, "Request body must be an object.", "bad_input");
  }
  const raw = body as Record<string, unknown>;
  const patch: ProjectPatch = {};

  if (raw.project !== undefined) {
    if (typeof raw.project !== "object" || raw.project === null) {
      throw new ApiError(400, "Field \"project\" must be an object.", "bad_input");
    }
    const p = raw.project as Record<string, unknown>;
    const out: NonNullable<ProjectPatch["project"]> = {};

    if (p.title !== undefined) {
      const t = asString(p.title, "project.title", MAX_TITLE);
      if (!t) throw new ApiError(400, "Title cannot be empty.", "bad_input");
      out.title = t;
    }
    if (p.description !== undefined) {
      if (p.description === null) out.description = null;
      else out.description = asString(p.description, "project.description", MAX_DESCRIPTION) || null;
    }
    if (p.status !== undefined) {
      if (typeof p.status !== "string" || !(PROJECT_STATUSES as readonly string[]).includes(p.status)) {
        throw new ApiError(400, "Invalid project.status.", "bad_input");
      }
      out.status = p.status as ProjectStatusValue;
    }
    if (p.targetAspectRatio !== undefined) {
      if (p.targetAspectRatio === null) out.targetAspectRatio = null;
      else if (
        typeof p.targetAspectRatio !== "string" ||
        !(ASPECT_RATIO_VALUES as readonly string[]).includes(p.targetAspectRatio)
      ) {
        throw new ApiError(400, "Invalid project.targetAspectRatio.", "bad_input");
      } else {
        out.targetAspectRatio = p.targetAspectRatio as AspectRatioValue;
      }
    }
    if (p.targetDurationSeconds !== undefined) {
      if (p.targetDurationSeconds === null) out.targetDurationSeconds = null;
      else {
        const n = Number(p.targetDurationSeconds);
        if (!Number.isFinite(n) || n < 0 || n > 7200) {
          throw new ApiError(400, "targetDurationSeconds must be 0–7200.", "bad_input");
        }
        out.targetDurationSeconds = Math.round(n);
      }
    }
    if (Object.keys(out).length) patch.project = out;
  }

  if (raw.settings !== undefined) {
    if (typeof raw.settings !== "object" || raw.settings === null) {
      throw new ApiError(400, "Field \"settings\" must be an object.", "bad_input");
    }
    const s = raw.settings as Record<string, unknown>;
    const out: NonNullable<ProjectPatch["settings"]> = {};

    if (s.defaultAspectRatio !== undefined) {
      if (typeof s.defaultAspectRatio !== "string" || !(ASPECT_RATIO_VALUES as readonly string[]).includes(s.defaultAspectRatio)) {
        throw new ApiError(400, "Invalid settings.defaultAspectRatio.", "bad_input");
      }
      out.defaultAspectRatio = s.defaultAspectRatio;
    }
    for (const field of ["language", "targetAudience", "tone", "style"] as const) {
      if (s[field] !== undefined) {
        if (s[field] === null) out[field] = null;
        else out[field] = asString(s[field], `settings.${field}`, field === "style" ? MAX_STRING : 200);
      }
    }
    for (const field of ["voiceoverDefaults", "subtitleDefaults", "musicDefaults", "seoDefaults", "extra"] as const) {
      if (s[field] !== undefined) {
        if (s[field] === null) out[field] = null;
        else if (typeof s[field] === "object" && !Array.isArray(s[field])) out[field] = s[field];
        else throw new ApiError(400, `settings.${field} must be an object or null.`, "bad_input");
      }
    }
    if (Object.keys(out).length) patch.settings = out;
  }

  if (!patch.project && !patch.settings) {
    throw new ApiError(400, "Nothing to update — provide project and/or settings fields.", "bad_input");
  }
  return patch;
}

/** Applies a validated patch; writes one version snapshot when changed. */
export async function updateProjectAndVersion(
  userId: string,
  projectId: string,
  patch: ProjectPatch,
): Promise<{ changed: boolean; project: ProjectDetail }> {
  const existing = await prisma.project.findFirst({
    where: { id: projectId, userId, deletedAt: null },
    include: { settings: true },
  });
  if (!existing) throw new ApiError(404, "Project not found.", "not_found");

  const changes: string[] = [];
  const projectData: Prisma.ProjectUpdateInput = {};
  if (patch.project?.title !== undefined && patch.project.title !== existing.title) {
    projectData.title = patch.project.title;
    changes.push(`Renamed to “${patch.project.title}”`);
  }
  if (patch.project?.description !== undefined && patch.project.description !== existing.description) {
    projectData.description = patch.project.description;
    changes.push("Description updated");
  }
  if (patch.project?.status !== undefined && patch.project.status !== existing.status) {
    projectData.status = patch.project.status;
    changes.push(`Status set to ${patch.project.status.replace(/_/g, " ")}`);
  }
  if (patch.project?.targetAspectRatio !== undefined && patch.project.targetAspectRatio !== existing.targetAspectRatio) {
    projectData.targetAspectRatio = patch.project.targetAspectRatio;
    changes.push("Format updated");
  }
  if (
    patch.project?.targetDurationSeconds !== undefined &&
    patch.project.targetDurationSeconds !== existing.targetDurationSeconds
  ) {
    projectData.targetDurationSeconds = patch.project.targetDurationSeconds;
    changes.push("Target duration updated");
  }

  const settingsData: Prisma.ProjectSettingsUpdateInput = {};
  if (patch.settings) {
    const cur = existing.settings;
    for (const [key, value] of Object.entries(patch.settings)) {
      const current = cur ? (cur as unknown as Record<string, unknown>)[key] : undefined;
      if (value !== current) {
        (settingsData as unknown as Record<string, unknown>)[key] = value;
      }
    }
    if (Object.keys(settingsData).length) changes.push("Settings updated");
  }

  if (changes.length === 0) {
    return { changed: false, project: await getProjectDetail(userId, projectId) };
  }

  const note = changes.join(" · ");
  await prisma.$transaction(async (tx) => {
    if (Object.keys(projectData).length) {
      await tx.project.update({ where: { id: projectId }, data: projectData });
    }
    if (Object.keys(settingsData).length) {
      await tx.projectSettings.upsert({
        where: { projectId },
        create: {
          projectId,
          ...(settingsData as Omit<Prisma.ProjectSettingsUncheckedCreateInput, "projectId">),
        },
        update: settingsData,
      });
    }
    await createVersion(projectId, note, userId, tx);
  });

  return { changed: true, project: await getProjectDetail(userId, projectId) };
}

// ---------------------------------------------------------------------------
// Duplicate — deep copy (project + settings + script tree, new ids)
// ---------------------------------------------------------------------------

export async function duplicateProject(userId: string, projectId: string): Promise<ProjectDetail> {
  const existing = await prisma.project.findFirst({
    where: { id: projectId, userId, deletedAt: null },
    include: {
      settings: true,
      script: {
        include: {
          chapters: { orderBy: { order: "asc" }, include: { scenes: { orderBy: { order: "asc" } } } },
        },
      },
    },
  });
  if (!existing) throw new ApiError(404, "Project not found.", "not_found");

  const copy = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        userId,
        title: `${existing.title} (Copy)`,
        description: existing.description,
        status: existing.status,
        targetAspectRatio: existing.targetAspectRatio,
        targetDurationSeconds: existing.targetDurationSeconds,
        brandKitId: existing.brandKitId,
      },
    });

    if (existing.settings) {
      await tx.projectSettings.create({
        data: {
          projectId: created.id,
          defaultAspectRatio: existing.settings.defaultAspectRatio,
          language: existing.settings.language,
          targetAudience: existing.settings.targetAudience,
          tone: existing.settings.tone,
          style: existing.settings.style,
          voiceoverDefaults: existing.settings.voiceoverDefaults ?? Prisma.JsonNull,
          subtitleDefaults: existing.settings.subtitleDefaults ?? Prisma.JsonNull,
          musicDefaults: existing.settings.musicDefaults ?? Prisma.JsonNull,
          seoDefaults: existing.settings.seoDefaults ?? Prisma.JsonNull,
          extra: existing.settings.extra ?? Prisma.JsonNull,
        },
      });
    }

    if (existing.script) {
      const script = await tx.script.create({
        data: {
          projectId: created.id,
          title: existing.script.title,
          logline: existing.script.logline,
          language: existing.script.language,
          targetAudience: existing.script.targetAudience,
          tone: existing.script.tone,
          style: existing.script.style,
        },
      });
      for (const ch of existing.script.chapters) {
        const chapter = await tx.chapter.create({
          data: { scriptId: script.id, projectId: created.id, title: ch.title, order: ch.order, summary: ch.summary },
        });
        for (const sc of ch.scenes) {
          await tx.scene.create({
            data: {
              chapterId: chapter.id,
              projectId: created.id,
              order: sc.order,
              title: sc.title,
              narration: sc.narration,
              visualPrompt: sc.visualPrompt,
              aspectRatio: sc.aspectRatio,
              targetLanguage: sc.targetLanguage,
              voiceId: sc.voiceId,
              durationSeconds: sc.durationSeconds,
              status: sc.status,
            },
          });
        }
      }
    }
    return created;
  });

  await createVersion(copy.id, `Created as a copy of “${existing.title}”`, userId);
  return getProjectDetail(userId, copy.id);
}

// ---------------------------------------------------------------------------
// Soft delete / restore / permanent delete
// ---------------------------------------------------------------------------

export async function softDeleteProject(userId: string, projectId: string): Promise<void> {
  await getOwnedProject(userId, projectId); // 404 unless owned & not deleted
  await prisma.project.update({ where: { id: projectId }, data: { deletedAt: new Date() } });
}

export async function restoreProject(userId: string, projectId: string): Promise<ProjectDetail> {
  await getOwnedProject(userId, projectId, true); // must currently be in trash
  await prisma.project.update({ where: { id: projectId }, data: { deletedAt: null } });
  return getProjectDetail(userId, projectId);
}

export async function permanentDeleteProject(userId: string, projectId: string): Promise<void> {
  await getOwnedProject(userId, projectId, true); // permanent delete only from trash
  await prisma.project.delete({ where: { id: projectId } });
}

// ---------------------------------------------------------------------------
// Detail / list reads
// ---------------------------------------------------------------------------

export async function getProjectDetail(userId: string, projectId: string): Promise<ProjectDetail> {
  const project = await prisma.project.findFirst({
    where: { id: projectId, userId, deletedAt: null },
    include: {
      settings: true,
      _count: { select: { chapters: true, scenes: true, versions: true } },
    },
  });
  if (!project) throw new ApiError(404, "Project not found.", "not_found");

  return {
    ...projectSummary(project),
    settings: project.settings
      ? {
          defaultAspectRatio: project.settings.defaultAspectRatio,
          language: project.settings.language,
          targetAudience: project.settings.targetAudience,
          tone: project.settings.tone,
          style: project.settings.style,
          voiceoverDefaults: project.settings.voiceoverDefaults,
          subtitleDefaults: project.settings.subtitleDefaults,
          musicDefaults: project.settings.musicDefaults,
          seoDefaults: project.settings.seoDefaults,
          extra: project.settings.extra,
        }
      : null,
    scriptCounts: { chapters: project._count.chapters, scenes: project._count.scenes },
    versionCount: project._count.versions,
  };
}

export async function listProjects(userId: string, trash: boolean): Promise<ProjectSummary[]> {
  const projects = await prisma.project.findMany({
    where: { userId, deletedAt: trash ? { not: null } : null },
    orderBy: trash ? { deletedAt: "desc" } : { updatedAt: "desc" },
    take: 200,
  });
  return projects.map(projectSummary);
}

export async function trashCount(userId: string): Promise<number> {
  return prisma.project.count({ where: { userId, deletedAt: { not: null } } });
}

export async function listVersions(userId: string, projectId: string): Promise<VersionSummary[]> {
  await getOwnedProject(userId, projectId);
  const versions = await prisma.projectVersion.findMany({
    where: { projectId },
    orderBy: { versionNumber: "desc" },
    include: { createdBy: { select: { name: true, email: true } } },
  });
  return versions.map(versionSummary);
}

export async function getVersion(userId: string, projectId: string, versionId: string) {
  await getOwnedProject(userId, projectId);
  const version = await prisma.projectVersion.findFirst({
    where: { id: versionId, projectId },
    include: { createdBy: { select: { name: true, email: true } } },
  });
  if (!version) throw new ApiError(404, "Version not found.", "not_found");
  return version;
}

// ---------------------------------------------------------------------------
// Version restore — restores project fields + settings, and the script tree
// when the snapshot contains one (replaced with new row ids; assets are never
// deleted). Always records a new snapshot so restores appear in history.
// ---------------------------------------------------------------------------

export async function restoreVersion(
  userId: string,
  projectId: string,
  versionId: string,
): Promise<ProjectDetail> {
  const version = await getVersion(userId, projectId, versionId);
  const s = version.snapshot as unknown as SnapshotShape;
  if (!s || s.format !== SNAPSHOT_FORMAT || !s.project) {
    throw new ApiError(400, "This version's snapshot is not restorable.", "bad_snapshot");
  }

  await prisma.$transaction(async (tx) => {
    const data: Prisma.ProjectUpdateInput = {
      title: s.project.title,
      description: s.project.description,
      status: (s.project.status as ProjectStatusValue) || "DRAFT",
      targetAspectRatio: (s.project.targetAspectRatio as AspectRatioValue) ?? null,
      targetDurationSeconds: s.project.targetDurationSeconds,
    };
    await tx.project.update({ where: { id: projectId }, data });

    if (s.settings) {
      const settingsData: Prisma.ProjectSettingsUncheckedCreateInput = {
        projectId,
        defaultAspectRatio: (s.settings.defaultAspectRatio as AspectRatioValue) || "SIXTEEN_NINE",
        language: s.settings.language ?? null,
        targetAudience: s.settings.targetAudience ?? null,
        tone: s.settings.tone ?? null,
        style: s.settings.style ?? null,
        voiceoverDefaults: (s.settings.voiceoverDefaults as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        subtitleDefaults: (s.settings.subtitleDefaults as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        musicDefaults: (s.settings.musicDefaults as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        seoDefaults: (s.settings.seoDefaults as Prisma.InputJsonValue) ?? Prisma.JsonNull,
        extra: (s.settings.extra as Prisma.InputJsonValue) ?? Prisma.JsonNull,
      };
      const { projectId: _projectId, ...settingsUpdate } = settingsData;
      await tx.projectSettings.upsert({
        where: { projectId },
        create: settingsData,
        update: settingsUpdate,
      });
    }

    // Structure restore: replace the script tree when the snapshot has one.
    // (Snapshots without a script leave any newer script untouched.)
    if (s.script) {
      await tx.script.deleteMany({ where: { projectId } }); // cascades chapters → scenes → scene links
      const script = await tx.script.create({
        data: {
          projectId,
          title: s.script.title,
          logline: s.script.logline,
          language: s.script.language ?? "en",
          targetAudience: s.script.targetAudience,
          tone: s.script.tone,
          style: s.script.style,
        },
      });
      for (const ch of s.script.chapters) {
        const chapter = await tx.chapter.create({
          data: { scriptId: script.id, projectId, title: ch.title, order: ch.order, summary: ch.summary },
        });
        for (const sc of ch.scenes) {
          await tx.scene.create({
            data: {
              chapterId: chapter.id,
              projectId,
              order: sc.order,
              title: sc.title,
              narration: sc.narration,
              visualPrompt: sc.visualPrompt,
              aspectRatio: (sc.aspectRatio as AspectRatioValue) ?? null,
              targetLanguage: sc.targetLanguage,
              voiceId: sc.voiceId,
              durationSeconds: sc.durationSeconds,
              status: (sc.status as Prisma.SceneCreateInput["status"]) ?? "DRAFT",
            },
          });
        }
      }
    }

    const note = `Restored from version #${version.versionNumber}${version.note ? ` (“${version.note}”)` : ""}`;
    await createVersion(projectId, note, userId, tx);
  });

  return getProjectDetail(userId, projectId);
}
