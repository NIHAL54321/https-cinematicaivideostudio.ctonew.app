/**
 * The Thumbnail tab's payload — the BRIEF the product would use, and the plain
 * statement that no thumbnail image exists.
 * Phase 8 Audio/Subtitle/Thumbnail block, Block B, 2026-11-15.
 *
 * WHY THIS MODULE EXISTS
 * The tab used to be a blank that sent the reader to `/thumbnail-generator` — a
 * page the served build answers 404 — and the product has never produced a
 * thumbnail image: `thumbnail_generation` is served by provider slots that are
 * neither configured nor wired. So this panel does the two things that are true:
 *
 *   1. it derives the BRIEF from this project's own rows — the project title, the
 *      key text the thumbnail would carry (the Script's logline, else the first
 *      narrated scene's first sentence, else that scene's title — each labelled
 *      with the row and field it came from), and the target frame implied by the
 *      project's stored `targetAspectRatio`;
 *   2. it says that no image exists, names the capability (`thumbnail_generation`)
 *      and the env var names the provider registry derives for it, and reports
 *      how many Thumbnail rows this project actually has.
 *
 * There is deliberately NO placeholder image, no preview box and no "generate"
 * control: nothing here could produce a picture, and a control that silently does
 * nothing is the defect this block removes.
 *
 * Server-side only (it reads Prisma). The component imports the DTO types with
 * `import type`, so nothing in this file reaches the browser bundle.
 */
import { ApiError } from "@/lib/api";
import { capabilityStatus } from "@/lib/ai";
import { prisma } from "@/lib/db";
import { projectSceneSource } from "@/lib/subtitles/scene-source";
import type { SceneSource } from "@/lib/subtitles/from-scenes";
import type { VoiceProviderRow } from "@/lib/studio/voice-audio-view";

/* ------------------------------------------------------------------ */
/* The payload                                                         */
/* ------------------------------------------------------------------ */

/** One piece of the brief, with the row and field it was read from. */
export interface BriefField {
  value: string;
  /** e.g. "Project.title" — never a guess about where it came from. */
  source: string;
}

export interface ThumbnailProviderFacts {
  capability: string;
  connected: boolean;
  status: string;
  /** Env var NAMES (never values), derived from the provider registry. */
  requiredEnv: string[];
  envNote: string;
  providers: VoiceProviderRow[];
}

export interface ThumbnailView {
  kind: "thumbnail_brief";
  projectId: string;
  projectTitle: string;
  brief: {
    title: BriefField;
    /** The key text a thumbnail would carry; null when the project has no script text. */
    keyText: BriefField | null;
    keyTextMissingReason: string | null;
    /** The frame the brief targets, from the project's stored aspect ratio. */
    frame: BriefField;
    /** What the brief is made of, in one sentence. */
    sentence: string;
    sceneCount: number;
    scenesWithNarration: number;
  };
  image: {
    /** Always false: this module cannot produce a picture and does not pretend to. */
    exists: false;
    sentence: string;
  };
  provider: ThumbnailProviderFacts;
  /** How many Thumbnail rows this project has — 0 on every deployment without an image provider. */
  thumbnailRows: number;
  /** How many Asset rows of kind THUMBNAIL this project has. */
  thumbnailAssets: number;
  note: string;
}

/* ------------------------------------------------------------------ */
/* The derivation — pure, over rows                                    */
/* ------------------------------------------------------------------ */

export interface ThumbnailBriefInput {
  projectId: string;
  projectTitle: string;
  /** Project.targetAspectRatio, exactly as stored (or null when the column says nothing). */
  targetAspectRatio: string | null;
  /** The project's Script row, reduced to the two fields this brief may carry. */
  script: { logline: string | null; title: string | null } | null;
  scenes: SceneSource[];
  thumbnailRows: number;
  thumbnailAssets: number;
  provider: ThumbnailProviderFacts;
}

/** The first sentence of a block of text, trimmed — never a rephrasing. */
function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = trimmed.match(/^[\s\S]*?[.!?…](\s|$)/);
  const sentence = (match ? match[0] : trimmed).trim();
  return sentence.length > 240 ? `${sentence.slice(0, 237).trimEnd()}…` : sentence;
}

/**
 * The key text the thumbnail would carry. Order: the Script's logline (the
 * project's own summary line), else the first scene that carries narration, else
 * the first scene's title. Each branch names the row and field it read, and an
 * empty project yields null plus the reason — never invented copy.
 */
export function deriveKeyText(input: {
  script: { logline: string | null } | null;
  scenes: readonly SceneSource[];
}): { keyText: BriefField | null; missing: string | null } {
  const logline = input.script?.logline?.trim();
  if (logline) {
    return { keyText: { value: firstSentence(logline), source: "Script.logline" }, missing: null };
  }
  const narrated = input.scenes.find((s) => (s.narration ?? "").trim().length > 0);
  if (narrated) {
    return {
      keyText: { value: firstSentence(narrated.narration ?? ""), source: `Scene.narration (scene ${narrated.number})` },
      missing: null,
    };
  }
  const titled = input.scenes.find((s) => (s.title ?? "").trim().length > 0);
  if (titled) {
    return { keyText: { value: (titled.title ?? "").trim(), source: `Scene.title (scene ${titled.number})` }, missing: null };
  }
  return {
    keyText: null,
    missing:
      "This project has no Script logline, no scene narration and no scene title, so the brief carries no key text " +
      "and none is invented to fill the space.",
  };
}

/** The target frame, from the project's stored aspect column. */
export function deriveFrame(targetAspectRatio: string | null): BriefField {
  if (targetAspectRatio === "SIXTEEN_NINE") {
    return {
      value: "16:9 — 1280 × 720",
      source: "Project.targetAspectRatio says SIXTEEN_NINE, which is the long-form thumbnail frame",
    };
  }
  if (targetAspectRatio === "NINE_SIXTEEN") {
    return {
      value: "9:16 — 720 × 1280",
      source: "Project.targetAspectRatio says NINE_SIXTEEN, which is the Shorts frame",
    };
  }
  return {
    value: "no target frame",
    source:
      targetAspectRatio === null
        ? "Project.targetAspectRatio is empty, so no frame is carried"
        : "Project.targetAspectRatio holds a value this app does not map to a thumbnail frame, so none is carried",
  };
}

export function deriveThumbnailView(input: ThumbnailBriefInput): ThumbnailView {
  const { keyText, missing } = deriveKeyText({ script: input.script, scenes: input.scenes });
  const frame = deriveFrame(input.targetAspectRatio);
  const scenesWithNarration = input.scenes.filter((s) => (s.narration ?? "").trim().length > 0).length;
  const scriptTitle = input.script?.title?.trim() || null;

  const sentence =
    `This brief is read from this project's own rows: the title from Project.title${scriptTitle ? ", the script's own title from Script.title" : ""}` +
    `, the key text from ${keyText ? keyText.source : "no row (this project carries none)"}, and the target frame from ` +
    `Project.targetAspectRatio. It is what the product would ask an image model for — it is not a picture, and no ` +
    `thumbnail image exists.`;

  const imageSentence =
    `No thumbnail image exists anywhere in this product: this project has ${input.thumbnailRows} Thumbnail row` +
    `${input.thumbnailRows === 1 ? "" : "s"} and ${input.thumbnailAssets} Asset row${input.thumbnailAssets === 1 ? "" : "s"} of kind ` +
    `THUMBNAIL. Producing one needs the "${input.provider.capability}" capability, which is ` +
    `${input.provider.connected ? "connected on this deployment" : "not connected on this deployment"} — it is served by ` +
    `${input.provider.providers.length} provider slot${input.provider.providers.length === 1 ? "" : "s"} ` +
    `(${input.provider.providers.map((p) => p.name).join(", ")}) and would be enabled by setting ` +
    `${
      input.provider.requiredEnv.length > 1
        ? `one of ${input.provider.requiredEnv.slice(0, -1).join(", ")} or ${input.provider.requiredEnv[input.provider.requiredEnv.length - 1]}`
        : input.provider.requiredEnv[0] ?? "no env var (no provider slot serves the capability)"
    } ` +
    `server-side. No placeholder image is shown in its place.`;

  return {
    kind: "thumbnail_brief",
    projectId: input.projectId,
    projectTitle: input.projectTitle,
    brief: {
      title: { value: input.projectTitle, source: "Project.title" },
      keyText,
      keyTextMissingReason: missing,
      frame,
      sentence,
      sceneCount: input.scenes.length,
      scenesWithNarration,
    },
    image: { exists: false, sentence: imageSentence },
    provider: input.provider,
    thumbnailRows: input.thumbnailRows,
    thumbnailAssets: input.thumbnailAssets,
    note:
      "Read from this project's own Project, Script and Scene rows and the AI status module's capability facts on " +
      "this request. No image provider is called, and no image is invented.",
  };
}

/* ------------------------------------------------------------------ */
/* The Prisma wrapper                                                  */
/* ------------------------------------------------------------------ */

/** The capability facts the panel prints, derived from the provider registry. */
export function thumbnailProviderFacts(): ThumbnailProviderFacts {
  const status = capabilityStatus("thumbnail_generation");
  return {
    capability: status.capability,
    connected: status.status === "connected",
    status: status.status,
    requiredEnv: [...status.requiredEnv],
    envNote: status.envNote,
    providers: status.providers.map((p) => ({ id: p.id, name: p.name, configured: p.configured, wired: p.wired })),
  };
}

export async function loadThumbnailView(input: {
  userId: string;
  projectId: string;
}): Promise<ThumbnailView> {
  const source = await projectSceneSource(input.userId, input.projectId);
  const project = await prisma.project.findFirst({
    where: { id: input.projectId, userId: input.userId },
    select: { id: true, title: true, targetAspectRatio: true, script: { select: { logline: true, title: true } } },
  });
  if (!project) throw new ApiError(404, "Project not found.", "not_found");

  const [thumbnailRows, thumbnailAssets] = await Promise.all([
    prisma.thumbnail.count({ where: { asset: { projectId: input.projectId, userId: input.userId } } }),
    prisma.asset.count({ where: { projectId: input.projectId, userId: input.userId, kind: "THUMBNAIL" } }),
  ]);

  return deriveThumbnailView({
    projectId: project.id,
    projectTitle: project.title,
    targetAspectRatio: project.targetAspectRatio ?? null,
    script: project.script ? { logline: project.script.logline ?? null, title: project.script.title ?? null } : null,
    scenes: source.scenes,
    thumbnailRows,
    thumbnailAssets,
    provider: thumbnailProviderFacts(),
  });
}
