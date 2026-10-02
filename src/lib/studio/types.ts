/**
 * Shared types for the Phase 2 studio engines (IDEA → SCRIPT → STORY → STORYBOARD).
 *
 * All modules in src/lib/studio are PURE and DETERMINISTIC: they take typed
 * inputs and return typed outputs. Nothing here talks to the network, the
 * database, or an AI provider. Anything that genuinely needs AI generation
 * routes through src/lib/ai (the AI Model Orchestrator) and honestly reports
 * "Provider Not Connected" until providers are wired in a later phase.
 *
 * Every piece of output produced here is a STRUCTURE / TEMPLATE, never
 * AI-written copy and never fabricated statistics.
 */

export const VIDEO_FORMATS = ["LONG", "SHORT", "SOCIAL"] as const;
export type VideoFormat = (typeof VIDEO_FORMATS)[number];

export const FORMAT_LABELS: Record<VideoFormat, string> = {
  LONG: "Long Video",
  SHORT: "Short Video",
  SOCIAL: "Social Video",
};

export const INPUT_TYPES = ["IDEA", "SCRIPT", "ARTICLE", "URL", "DOCUMENT"] as const;
export type InputType = (typeof INPUT_TYPES)[number];

export const INPUT_TYPE_LABELS: Record<InputType, string> = {
  IDEA: "Idea",
  SCRIPT: "Script",
  ARTICLE: "Article",
  URL: "URL",
  DOCUMENT: "Document",
};

/** Allowed duration presets, seconds. */
export const DURATION_OPTIONS = [15, 30, 60, 90, 180, 300, 600, 900, 1800, 3600, 7200] as const;
export type DurationSeconds = (typeof DURATION_OPTIONS)[number];

export const DURATION_LABELS: Record<number, string> = {
  15: "15 seconds",
  30: "30 seconds",
  60: "1 minute",
  90: "1.5 minutes",
  180: "3 minutes",
  300: "5 minutes",
  600: "10 minutes",
  900: "15 minutes",
  1800: "30 minutes",
  3600: "60 minutes",
  7200: "120 minutes",
};

export const MIN_DURATION = 15;
export const MAX_DURATION = 7200;

/** Format → project aspect ratio (spec: LONG→16:9, SHORT→9:16, SOCIAL→1:1). */
export const FORMAT_ASPECT_RATIO = {
  LONG: "SIXTEEN_NINE",
  SHORT: "NINE_SIXTEEN",
  SOCIAL: "ONE_ONE",
} as const;

/** Role a beat plays in retention/structure analysis. */
export type BeatRole = "hook" | "body" | "ending";

export interface StructureBeat {
  id: string;
  name: string;
  purpose: string;
  /** Relative weight used by budgeting.ts to split time across beats. */
  share: number;
  role: BeatRole;
}

export interface StoryStructure {
  id: string;
  name: string;
  description: string;
  /** Video shapes the structure fits best (heuristic hint). */
  suitedFor: VideoFormat[];
  /** Keyword hints for selectStructure() — deterministic heuristics, not AI. */
  keywords: string[];
  beats: StructureBeat[];
}

export interface ScenePlan {
  order: number;
  title: string;
  beatId: string;
  beatName: string;
  durationSeconds: number;
  /**
   * NEVER set by the structure engines: narration is AI territory. Scene
   * skeletons carry `null` here so the UI can show an honest "awaiting
   * provider" placeholder.
   */
  narration: null;
  /** Template-based visual prompt (structure), assembled deterministically. */
  visualPrompt: string | null;
  /** Shot plan for this scene. */
  camera: string;
  /** Media decision for this scene. */
  mediaType: string;
  /** Sub-clip plan (editing rhythm). Sum of clip durations === scene duration. */
  clips: number[];
}

export interface ChapterPlan {
  order: number;
  beatId: string;
  beatName: string;
  /** All structure beats merged into this chapter, in order. */
  beatIds: string[];
  title: string;
  summary: string;
  durationSeconds: number;
  scenes: ScenePlan[];
}

export interface VideoPlan {
  format: VideoFormat;
  totalDurationSeconds: number;
  structure: StoryStructure;
  chapterCount: number;
  sceneCount: number;
  clipCount: number;
  hookSeconds: number;
  chapters: ChapterPlan[];
  /** Transparency label — this plan is template structure, not AI output. */
  source: "structure-template";
}
