/**
 * Storyboard workspace — server-side scene operations (SERVER-ONLY, tenant-scoped).
 *
 * Every operation resolves the caller's userId FIRST and always includes it in
 * the query, so a user can never touch another user's scenes (404, not 403 —
 * consistent with the rest of the project system).
 *
 * Deterministic template work (visual re-rolls, default prompts for new
 * scenes) runs through the pure studio engines in src/lib/studio. Anything
 * labeled AI routes through the AI Model Orchestrator (src/lib/ai) and returns
 * its REAL result — "Provider Not Connected" in Phase 1. Nothing is ever
 * simulated, and narration/hooks are never fabricated.
 *
 * Mutations that meaningfully change the project write a ProjectVersion
 * snapshot via createVersion() — the same auto-save/version pattern used
 * across the project system.
 */
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { execute, type AiResult } from "@/lib/ai";
import { createVersion, getOwnedProject } from "@/lib/projects";
import { getScriptTree, type ScriptTree } from "./pipeline";
import { MEDIA_TYPES, decideSceneMedia, type MediaType } from "./scene-intelligence";
import { SHOT_TYPES, pickCamera } from "./cameras";
import { selectDescriptors } from "./cinematic";
import { assembleVisualPrompt, defaultScenePrompt } from "./visual-prompts";
import { defaultSceneDuration } from "./budgeting";
import type { VideoFormat } from "./types";

export type { ScriptTree };

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** Aspect ratio → format vocabulary (mirrors the wizard's FORMAT_ASPECT_RATIO). */
function formatForAspect(aspect: string | null): VideoFormat {
  return aspect === "NINE_SIXTEEN" ? "SHORT" : aspect === "ONE_ONE" ? "SOCIAL" : "LONG";
}

function videoTypeFor(format: VideoFormat): "longform" | "shorts" | "clip" {
  return format === "LONG" ? "longform" : format === "SHORT" ? "shorts" : "clip";
}

/** Resolves the scene only when it belongs to the caller's project. */
async function getOwnedScene(userId: string, projectId: string, sceneId: string) {
  await getOwnedProject(userId, projectId);
  const scene = await prisma.scene.findFirst({ where: { id: sceneId, projectId } });
  if (!scene) throw new ApiError(404, "Scene not found.", "not_found");
  return scene;
}

/** Reads ProjectSettings.extra (created on first write if missing). */
async function readSettingsExtra(projectId: string): Promise<Record<string, unknown>> {
  const settings = await prisma.projectSettings.findUnique({ where: { projectId } });
  const extra = settings?.extra;
  return extra && typeof extra === "object" && !Array.isArray(extra) ? (extra as Record<string, unknown>) : {};
}

async function writeSettingsExtra(projectId: string, extra: Record<string, unknown>): Promise<void> {
  await prisma.projectSettings.upsert({
    where: { projectId },
    create: { projectId, extra: extra as never },
    update: { extra: extra as never },
  });
}

/** Valid media type from the persisted plan (fallback STOCK). */
function asMediaType(v: unknown): MediaType {
  return typeof v === "string" && (MEDIA_TYPES as readonly string[]).includes(v) ? (v as MediaType) : "STOCK";
}

// ---------------------------------------------------------------------------
// Visual prompt re-roll (deterministic template engine, NOT AI)
// ---------------------------------------------------------------------------

const MOTION_VARIANTS = ["slow, stable", "slow push-in", "steady lateral drift", "locked frame with subtle parallax"];

/** Shot types plausibly suited to each media category (re-roll variation pool). */
const MEDIA_SHOT_HINTS: Record<string, string[]> = {
  MAP: ["aerial", "drone", "establishing"],
  TIMELINE: ["time-lapse", "aerial", "tracking"],
  CHART: ["extreme-close-up", "close-up", "medium"],
  NUMBER_ANIMATION: ["extreme-close-up", "close-up"],
  SCREEN_SIMULATION: ["medium", "close-up"],
  TEXT_ANIMATION: ["medium", "close-up"],
  INFOGRAPHIC: ["close-up", "medium"],
  AI_IMAGE: ["wide", "medium", "close-up", "establishing"],
  AI_VIDEO: ["wide", "tracking", "dolly", "crane"],
  ANIMATION: ["medium", "wide", "dolly"],
  STOCK: ["wide", "establishing", "tracking", "crane"],
};

export interface RerollContext {
  topic: string;
  beatName?: string;
  mediaType: MediaType;
  format?: string;
  tone?: string;
  durationSeconds?: number;
  /** Deterministic variation index — a higher variant yields a different prompt. */
  variant: number;
}

/**
 * Deterministic visual-prompt re-roll. Same variant → same prompt; a new
 * variant rotates the shot, motion and descriptors. Template composition via
 * visual-prompts.ts — never AI, always labeled template.
 */
export function rerollVisualPrompt(ctx: RerollContext): string {
  const media = ctx.mediaType;
  const variant = Math.max(1, Math.floor(ctx.variant));
  const candidates = SHOT_TYPES.filter((s) => (MEDIA_SHOT_HINTS[media] ?? []).includes(s.id));
  const shot =
    candidates.length > 0
      ? candidates[variant % candidates.length]
      : pickCamera({ beatName: ctx.beatName, mediaType: media, format: ctx.format }).shot;

  const descriptors = selectDescriptors({
    tone: ctx.tone,
    mediaType: media,
    format: ctx.format,
    variant,
  });

  // Chart-like media keep their hold-on-screen motion language (engine default).
  const staticMedia = media === "TIMELINE" || media === "CHART" || media === "MAP";
  const motion = !staticMedia && (ctx.durationSeconds ?? 60) > 4 ? MOTION_VARIANTS[variant % MOTION_VARIANTS.length] : undefined;

  return assembleVisualPrompt({
    subject: `scenes evoking "${ctx.topic.trim().slice(0, 80)}" (${(ctx.beatName ?? "scene").toLowerCase()} beat)`,
    beatName: ctx.beatName,
    camera: shot,
    mediaType: media,
    format: ctx.format,
    descriptors,
    durationSeconds: ctx.durationSeconds,
    motion,
  });
}

// ---------------------------------------------------------------------------
// Update scene (narration / duration / title) — user content, real persistence
// ---------------------------------------------------------------------------

export interface SceneUpdateInput {
  narration?: string | null;
  durationSeconds?: number | null;
  title?: string | null;
}

const MAX_NARRATION = 20_000;
const MAX_TITLE = 200;

/** Validates + normalizes a PATCH body for a scene. Throws 400 on bad input. */
export function parseScenePatch(body: unknown): SceneUpdateInput {
  if (typeof body !== "object" || body === null) {
    throw new ApiError(400, "Request body must be an object.", "bad_input");
  }
  const raw = body as Record<string, unknown>;
  const out: SceneUpdateInput = {};

  if (raw.narration !== undefined) {
    if (raw.narration === null) {
      out.narration = null;
    } else if (typeof raw.narration !== "string") {
      throw new ApiError(400, "narration must be a string or null.", "bad_input");
    } else {
      out.narration = raw.narration.trim().slice(0, MAX_NARRATION) || null;
    }
  }
  if (raw.durationSeconds !== undefined) {
    const n = Number(raw.durationSeconds);
    if (!Number.isInteger(n) || n < 1 || n > 7200) {
      throw new ApiError(400, "durationSeconds must be a whole number of seconds between 1 and 7200.", "bad_input");
    }
    out.durationSeconds = n;
  }
  if (raw.title !== undefined) {
    if (typeof raw.title !== "string") throw new ApiError(400, "title must be a string.", "bad_input");
    const t = raw.title.trim().slice(0, MAX_TITLE);
    if (!t) throw new ApiError(400, "title cannot be empty.", "bad_input");
    out.title = t;
  }
  if (Object.keys(out).length === 0) {
    throw new ApiError(400, "Nothing to update — provide narration, durationSeconds or title.", "bad_input");
  }
  return out;
}

/** Applies a validated scene patch; writes a ProjectVersion when something changed. */
export async function updateScene(
  userId: string,
  projectId: string,
  sceneId: string,
  input: SceneUpdateInput,
): Promise<{ tree: ScriptTree; scene: NonNullable<Awaited<ReturnType<typeof getOwnedScene>>> }> {
  const scene = await getOwnedScene(userId, projectId, sceneId);
  const data: Record<string, string | number | null> = {};
  const changes: string[] = [];

  if (input.narration !== undefined && input.narration !== scene.narration) {
    data.narration = input.narration;
    changes.push(input.narration ? "Narration updated" : "Narration cleared");
  }
  if (input.durationSeconds !== undefined && input.durationSeconds !== scene.durationSeconds) {
    data.durationSeconds = input.durationSeconds;
    changes.push(`Scene duration set to ${input.durationSeconds}s`);
  }
  if (input.title !== undefined && input.title !== scene.title) {
    data.title = input.title;
    changes.push(`Scene renamed to “${input.title}”`);
  }

  if (changes.length > 0) {
    await prisma.scene.update({ where: { id: sceneId }, data: data as never });
    await createVersion(projectId, changes.join(" · "), userId);
  }

  const updated = await prisma.scene.findUnique({ where: { id: sceneId } });
  return { tree: await getScriptTree(userId, projectId), scene: updated ?? scene };
}

// ---------------------------------------------------------------------------
// Replace visual — template re-roll (REAL) or AI generation (honest result)
// ---------------------------------------------------------------------------

export async function replaceVisual(
  userId: string,
  projectId: string,
  sceneId: string,
  mode: "template" | "ai",
): Promise<{ tree?: ScriptTree; scene?: unknown; result?: AiResult }> {
  const project = await getOwnedProject(userId, projectId);
  const scene = await getOwnedScene(userId, projectId, sceneId);
  const format = formatForAspect(project.targetAspectRatio);
  const tree = await getScriptTree(userId, projectId);

  if (mode === "ai") {
    // AI path — routes through the orchestrator. Phase 1 honestly returns
    // not_connected with the required env vars; nothing is persisted.
    const result = await execute(userId, {
      type: "IMAGE",
      capability: "image_generation",
      projectId,
      payload: {
        prompt: scene.visualPrompt ?? scene.title ?? "a cinematic scene",
        negativePrompt: "text, watermark, low quality, distorted",
        aspectRatio: (project.targetAspectRatio ?? "SIXTEEN_NINE").replace(/_/g, ":"),
      },
      params: {
        aspectRatio: (project.targetAspectRatio ?? "SIXTEEN_NINE").replace(/_/g, ":"),
        format: "png",
        style: tree.meta?.style ?? undefined,
        tone: tree.meta?.style ?? undefined,
        durationSeconds: scene.durationSeconds ?? undefined,
      },
    });
    return { result };
  }

  // Template path — deterministic engine re-roll, persisted for real.
  const extra = await readSettingsExtra(projectId);
  const variants = (extra.rerollVariants && typeof extra.rerollVariants === "object"
    ? (extra.rerollVariants as Record<string, unknown>)
    : {}) as Record<string, number>;
  const variant = (typeof variants[sceneId] === "number" ? variants[sceneId] : 0) + 1;
  variants[sceneId] = variant;

  const chapter = await prisma.chapter.findUnique({ where: { id: scene.chapterId } });
  const planScene = planSceneLookup(tree, sceneId);
  const prompt = rerollVisualPrompt({
    topic: tree.meta?.sourceText ?? project.title ?? "this topic",
    beatName: planScene?.beatName ?? chapter?.title ?? "scene",
    mediaType: asMediaType(planScene?.mediaType),
    format: tree.meta?.format ?? format,
    tone: tree.meta?.style ?? undefined,
    durationSeconds: scene.durationSeconds ?? undefined,
    variant,
  });

  await prisma.scene.update({ where: { id: sceneId }, data: { visualPrompt: prompt } });
  await writeSettingsExtra(projectId, { ...extra, rerollVariants: variants });
  await createVersion(projectId, "Visual prompt re-rolled (template)", userId);

  const updated = await prisma.scene.findUnique({ where: { id: sceneId } });
  return { tree: await getScriptTree(userId, projectId), scene: updated };
}

/** Finds the structure-plan entry for a scene (matched by chapter:scene order). */
function planSceneLookup(tree: ScriptTree, sceneId: string): { mediaType?: string; beatName?: string } | null {
  const chapters = tree.script?.chapters ?? [];
  for (const ch of chapters) {
    const idx = ch.scenes.findIndex((s) => s.id === sceneId);
    if (idx === -1) continue;
    const plan = tree.meta?.structurePlan;
    if (typeof plan !== "object" || plan === null) return null;
    const planChapters = (plan as { chapters?: unknown }).chapters;
    if (!Array.isArray(planChapters)) return null;
    const planCh = planChapters.find(
      (c) => typeof c === "object" && c !== null && (c as { order?: unknown }).order === ch.order,
    );
    const planScenes = planCh ? (planCh as { scenes?: unknown }).scenes : null;
    if (!Array.isArray(planScenes)) return null;
    const planScene = planScenes.find(
      (s) => typeof s === "object" && s !== null && (s as { order?: unknown }).order === ch.scenes[idx].order,
    );
    if (!planScene || typeof planScene !== "object") return null;
    const p = planScene as { mediaType?: unknown; beatName?: unknown };
    return {
      mediaType: typeof p.mediaType === "string" ? p.mediaType : undefined,
      beatName: typeof p.beatName === "string" ? p.beatName : undefined,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Regenerate scene — AI only. Honest orchestrator result in Phase 1.
// ---------------------------------------------------------------------------

export async function regenerateScene(
  userId: string,
  projectId: string,
  sceneId: string,
): Promise<{ result: AiResult }> {
  const project = await getOwnedProject(userId, projectId);
  const scene = await getOwnedScene(userId, projectId, sceneId);
  const tree = await getScriptTree(userId, projectId);
  const format = formatForAspect(project.targetAspectRatio);

  const result = await execute(userId, {
    type: "STORYBOARD",
    capability: "reasoning",
    projectId,
    payload: {
      prompt:
        `Regenerate the storyboard treatment for this scene. ` +
        `Scene: ${scene.title ?? "untitled"}. ` +
        `Current narration: ${scene.narration ?? "(none — AI narration pending)"}. ` +
        `Current visual requirement: ${scene.visualPrompt ?? "(none)"}. ` +
        `Video topic: ${(tree.meta?.sourceText ?? project.title ?? "").slice(0, 1000)}`,
      mode: "storyboard",
    },
    params: {
      tone: tree.meta?.style ?? undefined,
      videoType: videoTypeFor(format),
      language: tree.script?.language ?? "en",
      durationSeconds: scene.durationSeconds ?? undefined,
    },
  });
  return { result };
}

// ---------------------------------------------------------------------------
// Reorder — up/down within the chapter (persisted)
// ---------------------------------------------------------------------------

export async function moveScene(
  userId: string,
  projectId: string,
  sceneId: string,
  direction: "up" | "down",
): Promise<{ tree: ScriptTree }> {
  const scene = await getOwnedScene(userId, projectId, sceneId);
  const siblings = await prisma.scene.findMany({
    where: { chapterId: scene.chapterId, projectId },
    orderBy: { order: "asc" },
  });
  const idx = siblings.findIndex((s) => s.id === sceneId);
  const target = direction === "up" ? idx - 1 : idx + 1;
  if (idx === -1) throw new ApiError(404, "Scene not found.", "not_found");
  if (target < 0 || target >= siblings.length) {
    throw new ApiError(400, `Scene is already at the ${direction === "up" ? "top" : "bottom"} of its chapter.`, "bad_move");
  }

  await prisma.$transaction(async (tx) => {
    const a = siblings[idx];
    const b = siblings[target];
    // Temp value dodges the unique([chapterId, order]) constraint mid-swap.
    await tx.scene.update({ where: { id: a.id }, data: { order: -1 } });
    await tx.scene.update({ where: { id: b.id }, data: { order: a.order } });
    await tx.scene.update({ where: { id: a.id }, data: { order: b.order } });
  });
  await createVersion(projectId, `Scene moved ${direction}`, userId);
  return { tree: await getScriptTree(userId, projectId) };
}

// ---------------------------------------------------------------------------
// Add scene — real row with an engine-derived default duration + template prompt
// ---------------------------------------------------------------------------

export async function addScene(
  userId: string,
  projectId: string,
  chapterId: string,
): Promise<{ tree: ScriptTree; scene: unknown }> {
  const project = await getOwnedProject(userId, projectId);
  const chapter = await prisma.chapter.findFirst({ where: { id: chapterId, projectId } });
  if (!chapter) throw new ApiError(404, "Chapter not found.", "not_found");

  const siblings = await prisma.scene.findMany({
    where: { chapterId, projectId },
    orderBy: { order: "asc" },
  });
  const newOrder = siblings.length + 1;
  // Engine heuristic: average scene length for this chapter (default when empty).
  const chapterSeconds = siblings.reduce((a, s) => a + (s.durationSeconds ?? 0), 0) || 45;
  const durationSeconds = defaultSceneDuration(chapterSeconds);

  const tree = await getScriptTree(userId, projectId);
  const format = formatForAspect(project.targetAspectRatio);
  const topic = tree.meta?.sourceText ?? project.title ?? "this topic";
  const media = decideSceneMedia({
    beatName: chapter.title,
    sceneTitle: "New scene",
    topic,
    format,
    style: tree.meta?.style ?? undefined,
  });
  const camera = pickCamera({ beatName: chapter.title, mediaType: media.mediaType, format });
  const descriptors = selectDescriptors({
    tone: tree.meta?.style ?? undefined,
    mediaType: media.mediaType,
    format,
  });
  // Template prompt (deterministic structure), narration stays null — AI territory.
  const visualPrompt = defaultScenePrompt({
    topic,
    beatName: chapter.title,
    camera: camera.shot,
    mediaType: media.mediaType,
    format,
    descriptors,
    durationSeconds,
  });

  let created: unknown = null;
  await prisma.$transaction(async (tx) => {
    created = await tx.scene.create({
      data: {
        chapterId,
        projectId,
        order: newOrder,
        title: "New scene",
        narration: null,
        visualPrompt,
        aspectRatio: project.targetAspectRatio,
        durationSeconds,
        status: "DRAFT",
      },
    });
  });
  await createVersion(projectId, "Scene added: New scene", userId);
  return { tree: await getScriptTree(userId, projectId), scene: created };
}

// ---------------------------------------------------------------------------
// Delete scene — removes the row, compacts the chapter's ordering
// ---------------------------------------------------------------------------

export async function deleteScene(userId: string, projectId: string, sceneId: string): Promise<{ tree: ScriptTree }> {
  const scene = await getOwnedScene(userId, projectId, sceneId);
  const label = scene.title ?? `Scene ${scene.order}`;
  const remaining = await prisma.scene.findMany({
    where: { chapterId: scene.chapterId, projectId, id: { not: sceneId } },
    orderBy: { order: "asc" },
  });

  await prisma.$transaction(async (tx) => {
    await tx.scene.delete({ where: { id: sceneId } });
    for (let i = 0; i < remaining.length; i++) {
      const want = i + 1;
      if (remaining[i].order !== want) {
        await tx.scene.update({ where: { id: remaining[i].id }, data: { order: remaining[i].order + 100000 } });
      }
    }
    for (let i = 0; i < remaining.length; i++) {
      const want = i + 1;
      if (remaining[i].order !== want) {
        await tx.scene.update({ where: { id: remaining[i].id }, data: { order: want } });
      }
    }
  });
  await createVersion(projectId, `Scene deleted: ${label}`, userId);
  return { tree: await getScriptTree(userId, projectId) };
}

// ---------------------------------------------------------------------------
// Duplicate scene — copies the row (new id), "(copy)" title, inserted after
// ---------------------------------------------------------------------------

export async function duplicateScene(
  userId: string,
  projectId: string,
  sceneId: string,
): Promise<{ tree: ScriptTree; scene: unknown }> {
  const scene = await getOwnedScene(userId, projectId, sceneId);
  const siblings = await prisma.scene.findMany({
    where: { chapterId: scene.chapterId, projectId },
    orderBy: { order: "asc" },
  });
  const toBump = siblings.filter((s) => s.order > scene.order);
  const insertOrder = scene.order + 1;

  let created: unknown = null;
  await prisma.$transaction(async (tx) => {
    for (const s of toBump) {
      await tx.scene.update({ where: { id: s.id }, data: { order: s.order + 100000 } });
    }
    for (const s of toBump) {
      await tx.scene.update({ where: { id: s.id }, data: { order: s.order + 1 } });
    }
    created = await tx.scene.create({
      data: {
        chapterId: scene.chapterId,
        projectId,
        order: insertOrder,
        title: scene.title ? `${scene.title} (copy)` : "New scene (copy)",
        narration: scene.narration,
        visualPrompt: scene.visualPrompt,
        aspectRatio: scene.aspectRatio,
        targetLanguage: scene.targetLanguage,
        voiceId: scene.voiceId,
        durationSeconds: scene.durationSeconds,
        status: scene.status,
      },
    });
  });
  await createVersion(projectId, `Scene duplicated: ${scene.title ?? "New scene"}`, userId);
  return { tree: await getScriptTree(userId, projectId), scene: created };
}
