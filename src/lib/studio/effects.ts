/**
 * Visual Effects — deterministic, restrained post-look effects.
 *
 * Each effect maps to a short, reusable prompt suffix. This is description
 * vocabulary, not arbitrary embellishment — effects are applied only when a
 * caller explicitly opts in via `applyEffects`. Pure and deterministic.
 */
export interface VisualEffect {
  id: string;
  name: string;
  description: string;
  /** Prompt suffix appended when the effect is active. */
  promptSuffix: string;
}

/** Effects keyed by id. */
export const VISUAL_EFFECTS: Record<string, VisualEffect> = {
  zoom: {
    id: "zoom",
    name: "Zoom",
    description: "Slow in-camera zoom toward the subject.",
    promptSuffix: "slow push-in zoom toward subject",
  },
  pan: {
    id: "pan",
    name: "Pan",
    description: "Lateral pan across the scene.",
    promptSuffix: "smooth lateral pan across scene",
  },
  "ken-burns": {
    id: "ken-burns",
    name: "Ken Burns",
    description: "Subtle zoom-and-pan drift for stills.",
    promptSuffix: "Ken Burns style subtle zoom and pan on still",
  },
  "depth-of-field": {
    id: "depth-of-field",
    name: "Depth of Field",
    description: "Shallow depth of field isolating the subject.",
    promptSuffix: "shallow depth of field, blurred background",
  },
  "light-leak": {
    id: "light-leak",
    name: "Light Leak",
    description: "Warm organic light leak across the frame.",
    promptSuffix: "subtle warm light leak across frame",
  },
  "film-grain": {
    id: "film-grain",
    name: "Film Grain",
    description: "Organic 35mm grain texture.",
    promptSuffix: "subtle 35mm film grain",
  },
  blur: {
    id: "blur",
    name: "Blur",
    description: "Soft dreamy blur.",
    promptSuffix: "soft dreamy blur",
  },
  "motion-blur": {
    id: "motion-blur",
    name: "Motion Blur",
    description: "Smeared motion for speed and energy.",
    promptSuffix: "subtle motion blur conveying speed",
  },
  "color-grade": {
    id: "color-grade",
    name: "Color Grade",
    description: "Cinematic color-grade finish.",
    promptSuffix: "cinematic color grade",
  },
  vignette: {
    id: "vignette",
    name: "Vignette",
    description: "Soft darkening at the frame edges.",
    promptSuffix: "subtle vignette darkening frame edges",
  },
};

export const EFFECT_IDS = Object.keys(VISUAL_EFFECTS);

/** Apply a set of effect suffixes to a prompt. Valid ids only; unknown ids are ignored. */
export function applyEffects(prompt: string, effectIds: string[]): string {
  const suffixes = Array.from(
    new Set(
      effectIds
        .map((id) => VISUAL_EFFECTS[id]?.promptSuffix)
        .filter((s): s is string => Boolean(s)),
    ),
  );
  if (suffixes.length === 0) return prompt.trim();
  return `${prompt.trim()}, ${suffixes.join(", ")}`;
}
