/**
 * Phase 5 Block 2 — Scene-control METADATA (pure, client-safe).
 *
 * These are the labels/ids the editor UI renders. They live in their own module
 * so the client bundle can import them WITHOUT pulling in ./scenes, which talks
 * to the AI orchestrator status module (server-only).
 *
 * Nothing here performs work — it is static data shared by the API and the UI.
 */
export const SCENE_CONTROLS = [
  "regenerateScene",
  "regenerateVisual",
  "regenerateVoice",
  "changeMusic",
  "changeTransition",
  "changeSubtitle",
  "restyleScene",
] as const;

export type SceneControlName = (typeof SCENE_CONTROLS)[number];

/** Button labels for the seven spec controls. */
export const SCENE_CONTROL_LABELS: Record<SceneControlName, string> = {
  regenerateScene: "Regenerate Scene",
  regenerateVisual: "Regenerate Visual",
  regenerateVoice: "Regenerate Voice",
  changeMusic: "Change Music",
  changeTransition: "Change Transition",
  changeSubtitle: "Change Subtitle",
  restyleScene: "Restyle Scene",
};

/** Controls that need an AI provider (shown with the honest gate). */
export const PROVIDER_CONTROLS: readonly SceneControlName[] = [
  "regenerateVisual",
  "regenerateVoice",
  "changeMusic",
];

/** Moods offered by the music form (the music engine's emotion vocabulary). */
export const MUSIC_MOODS = [
  "calm",
  "focused",
  "happy",
  "sad",
  "epic",
  "tense",
  "dark",
  "romantic",
  "energetic",
  "professional",
] as const;

/**
 * Placeholder colour-grade ids the UI offers. Block 4 owns the real catalog and
 * the renderer; Block 2 only records the id the user picked on the clips.
 */
export const COLOR_GRADE_HINTS = [
  "neutral",
  "cinematic-warm",
  "cinematic-cool",
  "teal-orange",
  "noir",
  "vintage-film",
  "high-contrast",
] as const;

export function isSceneControlName(v: unknown): v is SceneControlName {
  return typeof v === "string" && (SCENE_CONTROLS as readonly string[]).includes(v);
}
