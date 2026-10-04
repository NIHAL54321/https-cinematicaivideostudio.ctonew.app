/**
 * Task router — maps every task type to a capability and produces the ranked
 * candidate list the orchestrator walks as its A → B → C → D chain.
 *
 * Ranking considers provider quality, speed, cost, availability (resolution /
 * language / feature requirements), the user's plan, the video type
 * (long-form vs Shorts), resolution, and language. Scores are a weighted sum
 * with documented weights so future tuning is a one-line change.
 */
import {
  AI_TASK_TYPES,
  type AiCapabilityId,
  type AiTask,
  type AiTaskType,
  type AiUserPlan,
} from "./types";
import { type AiProvider, isProviderReady } from "./providers/types";
import { providersFor } from "./providers/registry";

// Task type → primary capability (the "plus the rest" mapping from the spec).
export const TASK_TO_CAPABILITY: Record<AiTaskType, AiCapabilityId> = {
  REASON: "reasoning",
  SCRIPT: "script_generation",
  STORYBOARD: "reasoning", // scene-by-scene storyboard reasoning
  IMAGE: "image_generation",
  VIDEO: "video_generation",
  VOICE: "voice_generation", // TTS
  TRANSCRIBE: "speech_recognition",
  TRANSLATE: "translation",
  MUSIC: "music_generation",
  SOUND_EFFECT: "sound_effects",
  ENHANCE_IMAGE: "image_enhancement",
  ENHANCE_VIDEO: "video_enhancement",
  UPSCALE: "upscaling",
  LIP_SYNC: "lip_sync",
  SUBTITLE: "subtitle_generation",
  DETECT_SCENE: "scene_detection",
  DETECT_OBJECT: "object_detection",
  DETECT_FACE: "face_detection",
  SEARCH_SEMANTIC: "semantic_search",
  SEARCH_STOCK: "stock_media_search",
  THUMBNAIL: "thumbnail_generation",
  SEO: "seo_generation",
};

export function capabilityForTaskType(type: AiTaskType): AiCapabilityId {
  return TASK_TO_CAPABILITY[type];
}

export interface TaskContext {
  plan?: AiUserPlan;
  videoType?: "longform" | "shorts" | "clip";
  resolution?: string;
  language?: string;
  /** Explicit requirements, e.g. "4k", "consistent_characters", "no_watermark". */
  requirements?: string[];
}

export interface ProviderCandidate {
  provider: AiProvider;
  model: string | null;
  /** Weighted score 0..1 — the router sorts by this. */
  score: number;
  quality: number;
  speed: number;
  cost: number;
  /** 0 when the provider cannot satisfy a hard requirement. */
  availability: number;
  reasons: string[];
}

/** Hard requirements that map to provider metadata feature flags. */
const FEATURE_REQUIREMENTS: Record<string, string> = {
  consistent_characters: "consistent_characters",
  no_watermark: "no_watermark",
  voice_cloning: "voice_cloning",
  high_quality_voice: "voice_cloning", // best-in-class voice is a feature flag
};

/** "1920x1080" / "3840x2160" → pixel width (0 when unparsable). */
export function resolutionWidth(resolution: string | undefined): number {
  if (!resolution) return 0;
  const w = Number(resolution.split(/[x×]/i)[0]);
  return Number.isFinite(w) ? w : 0;
}

const REQUIRED_4K_WIDTH = 3840;

/** Base scoring weights (quality, availability, speed, cost). */
const BASE_WEIGHTS: Record<AiUserPlan, [number, number, number, number]> = {
  FREE: [0.35, 0.3, 0.15, 0.2],
  PRO: [0.45, 0.25, 0.15, 0.15],
  STUDIO: [0.55, 0.2, 0.15, 0.1],
  TEAM: [0.55, 0.2, 0.15, 0.1],
};

export function routeTask(
  task: AiTask,
  ctx: TaskContext = {},
  candidates: AiProvider[] = providersFor(task.capability),
): ProviderCandidate[] {
  const plan = ctx.plan ?? "FREE";
  const weights = [...BASE_WEIGHTS[plan]] as [number, number, number, number];
  // Shorts favor speed over quality; long-form favors quality.
  if (ctx.videoType === "shorts") weights[0] = Math.max(0.25, weights[0] - 0.1);
  if (ctx.videoType === "longform") weights[0] = Math.min(0.6, weights[0] + 0.05);

  const want4k = ctx.resolution !== undefined ? resolutionWidth(ctx.resolution) >= REQUIRED_4K_WIDTH : false;
  const wantsFeature = (ctx.requirements ?? []).map((r) => FEATURE_REQUIREMENTS[r]).filter(Boolean);
  const language = ctx.language;

  const scored: ProviderCandidate[] = candidates.map((provider) => {
    const reasons: string[] = [];
    let availability = 1;

    // Hard availability checks — a 0 here excludes the provider.
    if (want4k) {
      const maxW = resolutionWidth(provider.metadata.maxResolution);
      if (maxW > 0 && maxW < REQUIRED_4K_WIDTH) {
        availability = 0;
        reasons.push("no 4K");
      }
    }
    if (language && provider.metadata.supportedLanguages) {
      if (!provider.metadata.supportedLanguages.includes(language)) {
        availability = 0;
        reasons.push(`no ${language} support`);
      }
    }
    for (const f of wantsFeature) {
      if (!provider.metadata.features?.includes(f)) {
        availability = 0;
        reasons.push(`lacks "${f}"`);
      }
    }

    const quality = provider.metadata.quality;
    const speed = provider.metadata.speed;
    const cost = provider.metadata.cost;
    const score =
      (weights[0] * quality + weights[1] * availability + weights[2] * speed + weights[3] * cost) *
      (availability === 0 ? 0.001 : 1);

    if (reasons.length === 0) reasons.push("available");
    if (provider.isConfigured() && provider.isWired(task.capability)) reasons.push("ready");
    if (!provider.isConfigured()) reasons.push("no key set");
    return {
      provider,
      model: provider.modelFor(task.capability),
      score,
      quality,
      speed,
      cost,
      availability,
      reasons,
    };
  });

  return scored.sort((a, b) => b.score - a.score || a.provider.rank - b.provider.rank);
}

/** Convenience: route + filter to providers that can actually be attempted now. */
export function routeReadyCandidates(task: AiTask, ctx: TaskContext = {}): ProviderCandidate[] {
  return routeTask(task, ctx).filter((c) => isProviderReady(c.provider, task.capability));
}

export function allTaskTypes(): readonly AiTaskType[] {
  return AI_TASK_TYPES;
}
