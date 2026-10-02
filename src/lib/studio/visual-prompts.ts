/**
 * Visual prompt assembly — deterministic, labeled template construction.
 *
 * Takes structured scene data (subject, environment, beat, tone, camera,
 * descriptors, media type, format) and assembles ONE detailed prompt string.
 * This is template composition, NOT AI writing: every segment is drawn from
 * typed inputs and the template shape is public (see VISUAL_PROMPT_TEMPLATE).
 */
import type { CinematicDescriptor } from "./cinematic";
import type { ShotType } from "./cameras";
import type { MediaType } from "./scene-intelligence";

export interface VisualPromptInput {
  subject: string;
  environment?: string;
  beatId?: string;
  beatName?: string;
  tone?: string;
  descriptors?: CinematicDescriptor[];
  camera?: ShotType | null;
  mediaType?: MediaType;
  format?: string;
  /** Seconds of screen time the prompt is for (influences motion language). */
  durationSeconds?: number;
  /** Optional user-supplied lighting, e.g. "golden hour". */
  lighting?: string;
  /** Optional user-supplied motion, e.g. "slow push-in". */
  motion?: string;
  /** Optional user-supplied depth of field, e.g. "shallow". */
  depthOfField?: string;
  /** Optional user-supplied color direction, e.g. "teal and orange". */
  color?: string;
}

export const VISUAL_PROMPT_TEMPLATE = [
  "{shot} of {subject} in {environment}",
  "lighting: {lighting}",
  "camera: {shot name}, {motion}",
  "depth of field: {dof}",
  "color: {color}",
  "quality: {descriptors}",
  "atmosphere: {mood descriptor}",
  "realism: {realism descriptor}",
  "format: {framing}",
].join(" · ");

const LIGHTING_BY_TONE: Record<string, string> = {
  cinematic: "dramatic key light with deep shadows",
  dramatic: "low-key lighting, high contrast",
  mysterious: "partial light, silhouettes, pools of shadow",
  calm: "soft diffused natural light",
  emotional: "warm soft light, gentle falloff",
  inspirational: "golden hour glow",
  energetic: "bright punchy studio light",
  educational: "clean even lighting",
  professional: "polished three-point studio lighting",
  serious: "neutral flat documentary lighting",
  friendly: "bright welcoming daylight",
  conversational: "natural window light",
};

const DEFAULT_LIGHTING = "moody cinematic lighting";
const DEFAULT_MOTION = "slow, stable";
const DEFAULT_DOF = "moderate";
const DEFAULT_COLOR = "color-accurate grade";

function framingFor(format: string | undefined): string {
  switch (format) {
    case "SHORT":
      return "vertical 9:16 framing";
    case "SOCIAL":
      return "square 1:1 framing";
    default:
      return "widescreen 16:9 framing";
  }
}

function motionFor(media: MediaType | undefined, duration?: number): string {
  if (media === "TIMELINE" || media === "CHART" || media === "MAP") return "camera holds, elements animate on screen";
  if (duration !== undefined && duration <= 4) return "single locked frame, minimal motion";
  return DEFAULT_MOTION;
}

/**
 * Assemble the visual prompt deterministically. All segments come from typed
 * inputs or tone defaults — nothing is invented.
 */
export function assembleVisualPrompt(input: VisualPromptInput): string {
  const subject = input.subject.trim() || "the subject";
  const environment = input.environment?.trim() || "an evocative, genre-appropriate setting";
  const lighting = input.lighting || LIGHTING_BY_TONE[input.tone ?? ""] || DEFAULT_LIGHTING;
  const shotName = input.camera?.name ?? (input.mediaType === "CHART" ? "close-up" : "wide shot");
  const motion = input.motion || motionFor(input.mediaType, input.durationSeconds);
  const dof = input.depthOfField || DEFAULT_DOF;
  const color = input.color || DEFAULT_COLOR;

  const descriptors = input.descriptors ?? [];
  const realism = descriptors.find((d) => d.category === "realism")?.label ?? "cinematic";
  const mood = descriptors.find((d) => d.category === "mood")?.label ?? "atmospheric";
  const quality = descriptors
    .filter((d) => d.category === "quality")
    .slice(0, 2)
    .map((d) => d.label)
    .join(", ");

  const parts = [
    `${shotName} of ${subject} in ${environment}`,
    `lighting: ${lighting}`,
    `camera: ${shotName}, ${motion}`,
    `depth of field: ${dof}`,
    `color: ${color}`,
    ...(quality ? [`quality: ${quality}`] : []),
    `atmosphere: ${mood}`,
    `realism: ${realism}`,
    `framing: ${framingFor(input.format)}`,
  ];

  return parts.join(" · ");
}

/**
 * Convenience wrapper: assemble a prompt for a scene plan entry given the
 * topic text and pre-decided camera/media/descriptors.
 */
export function defaultScenePrompt(opts: {
  topic: string;
  beatName: string;
  camera: ShotType;
  mediaType: MediaType;
  format?: string;
  descriptors?: CinematicDescriptor[];
  durationSeconds?: number;
}): string {
  const subject = `scenes evoking "${opts.topic.trim().slice(0, 80)}" (${opts.beatName.toLowerCase()} beat)`;
  return assembleVisualPrompt({
    subject,
    beatName: opts.beatName,
    camera: opts.camera,
    mediaType: opts.mediaType,
    format: opts.format,
    descriptors: opts.descriptors,
    durationSeconds: opts.durationSeconds,
  });
}
