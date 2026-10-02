/**
 * Restyle Engine — swap a scene's visual look between Cinematic Style Presets
 * while PRESERVING its narration, story and timing.
 *
 * A scene is treated as a shallow, modifiable object: story ('title',
 * 'narration', 'order', 'chapterId', 'durationSeconds', ...) is left untouched,
 * while the VISUAL description (visualPrompt / any 'visual*' field) is rebuilt
 * in the target preset's language. The result is a modified copy — the caller
 * may persist it as they see fit. Pure and deterministic.
 */
import { getPreset, applyPreset, type CinematicPreset } from "./presets";
import type { CinematicDescriptor } from "./cinematic";

/**
 * The scene shape restyle knows about. Extra fields are passed through.
 * Story/timing fields are preserved; visual fields are rebuilt.
 */
export interface RestylableScene {
  id?: string;
  title?: string | null;
  narration?: string | null;
  chapterId?: string;
  order?: number;
  durationSeconds?: number | null;
  aspectRatio?: string | null;
  visualPrompt?: string | null;
  mediaType?: string;
  tone?: string;
  format?: string;
  [key: string]: unknown;
}

export interface RestyleResult {
  /** The restyled scene (a modified shallow copy — story preserved, visuals swapped). */
  scene: RestylableScene;
  /** The fully-composed prompt describing the scene in the new style. */
  restylePrompt: string;
  /** The target preset applied. */
  preset: CinematicPreset;
  /** Human summary of what changed. */
  note: string;
}

/**
 * Aliases map common user-facing preset names to our canonical ids so the spec
 * examples resolve: Realistic → photorealistic/hyperrealistic, "Dark cinematic"
 * → moody, "Modern premium" → premium, etc.
 */
const PRESET_ALIASES: Record<string, string> = {
  realistic: "hyperrealistic",
  photorealistic: "photorealistic",
  hyperrealistic: "hyperrealistic",
  ultrarealistic: "ultrarealistic",
  "dark cinematic": "moody",
  "dark-cinematic": "moody",
  dark: "moody",
  moody: "moody",
  "modern premium": "premium",
  "modern-premium": "premium",
  premium: "premium",
  futuristic: "futuristic",
  luxury: "luxury",
  corporate: "corporate",
  news: "news",
  infographic: "infographic",
  animated: "animated",
  "3d": "3d",
  illustration: "illustration",
  vintage: "vintage",
  documentary: "documentary",
  cinematic: "cinematic",
};

/** Resolve a preset id or user-facing alias to a concrete preset. */
export function resolvePreset(input?: string | null): CinematicPreset {
  if (!input) return getPreset();
  const key = input.trim().toLowerCase();
  return getPreset(PRESET_ALIASES[key] ?? key);
}

function extractSubject(scene: RestylableScene): string {
  if (typeof scene.visualPrompt === "string" && scene.visualPrompt.trim()) {
    return scene.visualPrompt.trim().split(",")[0].trim();
  }
  if (typeof scene.title === "string" && scene.title.trim()) return scene.title.trim();
  return "the scene";
}

/** The set of visual-carrying fields restyle may rewrite. */
const VISUAL_KEYS: (keyof RestylableScene)[] = ["visualPrompt"];

/**
 * Restyle a scene from one preset to another. `fromPreset` is advisory (used in
 * the note); the target preset fully defines the new look. Story/timing fields
 * are preserved verbatim. Returns `{ scene, restylePrompt, preset, note }`.
 */
export function restyle(
  scene: RestylableScene,
  fromPreset?: string | null,
  toPreset?: string | null,
): RestyleResult {
  const target = resolvePreset(toPreset);
  const subject = extractSubject(scene);
  // Compose the new visual description in the target preset's language.
  const restylePrompt = applyPreset(target, subject, {
    tone: scene.tone ?? target.id,
    mediaType: scene.mediaType,
  });

  const restyled: RestylableScene = { ...scene };
  // Swap only visual-carrying fields; keep story/timing.
  if (typeof scene.visualPrompt === "string") {
    restyled.visualPrompt = restylePrompt;
  }
  if ("visualDescription" in scene) {
    restyled.visualDescription = restylePrompt;
  }
  const fromName = fromPreset ? resolvePreset(fromPreset).name : "its previous style";
  return {
    scene: restyled,
    restylePrompt,
    preset: target,
    note: `Restyled from ${fromName} to ${target.name}. Narration, story and timing are unchanged — only the visual look changed.`,
  };
}

/**
 * Convenience: restyle and immediately return just the new prompt (used by the
 * generation API's `restyle` action when the caller only wants the prompt).
 */
export function restylePrompt(
  scene: RestylableScene,
  fromPreset?: string | null,
  toPreset?: string | null,
): string {
  return restyle(scene, fromPreset, toPreset).restylePrompt;
}

export type { CinematicDescriptor };
