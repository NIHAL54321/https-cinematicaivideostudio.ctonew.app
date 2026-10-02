/**
 * Scene intelligence — deterministic media-type heuristics.
 *
 * Given a scene (beat + title + topic + style), decide which media category
 * fits: Stock footage, AI video, AI image, Animation, Chart, Infographic, Map,
 * Timeline, Text animation, Number animation, Screen simulation.
 *
 * These are HEURISTICS about media type — never a claim that any media has
 * been generated. Media generation itself routes through the orchestrator.
 */
export const MEDIA_TYPES = [
  "STOCK",
  "AI_VIDEO",
  "AI_IMAGE",
  "ANIMATION",
  "CHART",
  "INFOGRAPHIC",
  "MAP",
  "TIMELINE",
  "TEXT_ANIMATION",
  "NUMBER_ANIMATION",
  "SCREEN_SIMULATION",
] as const;

export type MediaType = (typeof MEDIA_TYPES)[number];

export const MEDIA_LABELS: Record<MediaType, string> = {
  STOCK: "Stock footage",
  AI_VIDEO: "AI video",
  AI_IMAGE: "AI image",
  ANIMATION: "Animation",
  CHART: "Chart",
  INFOGRAPHIC: "Infographic",
  MAP: "Map",
  TIMELINE: "Timeline",
  TEXT_ANIMATION: "Text animation",
  NUMBER_ANIMATION: "Number animation",
  SCREEN_SIMULATION: "Screen simulation",
};

export interface SceneContext {
  beatId?: string;
  beatName?: string;
  sceneTitle?: string;
  topic?: string;
  format?: string;
  style?: string;
}

export interface MediaDecision {
  mediaType: MediaType;
  rationale: string;
  /** 0–1 heuristic strength. Lower = more generic fallback. */
  confidence: number;
}

const KEYWORD_RULES: { re: RegExp; media: MediaType; note: string }[] = [
  { re: /\b(number|statistic|percent|%|figure|data point|metric|rate)\b/i, media: "NUMBER_ANIMATION", note: "numeric content → number animation" },
  { re: /\b(chart|graph|statistics|data|survey|growth rate|revenue)\b/i, media: "CHART", note: "data/statistics content → chart" },
  { re: /\b(map|region|country|geography|city|world|area|territory)\b/i, media: "MAP", note: "geographic content → map" },
  { re: /\b(timeline|history|decade|evolution|chronolog|over the years)\b/i, media: "TIMELINE", note: "chronological content → timeline" },
  { re: /\b(app|software|screen|website|interface|dashboard|ui|phone)\b/i, media: "SCREEN_SIMULATION", note: "digital product content → screen simulation" },
  { re: /\b(how it works|explain|concept|definition|why it matters|mechanism)\b/i, media: "ANIMATION", note: "explanatory content → animation" },
  { re: /\b(top|list|ranking|compare|comparison|versus|vs)\b/i, media: "INFOGRAPHIC", note: "list/comparison content → infographic" },
  { re: /\b(story|tale|journey|experience|day|moment|narrative)\b/i, media: "STOCK", note: "narrative content → footage" },
];

/** Deterministic media decision per scene. */
export function decideSceneMedia(ctx: SceneContext): MediaDecision {
  const text = `${ctx.beatName ?? ""} ${ctx.sceneTitle ?? ""} ${ctx.topic ?? ""}`;
  const beat = (ctx.beatId ?? "").toLowerCase();
  const style = (ctx.style ?? "").toLowerCase();
  const format = (ctx.format ?? "").toUpperCase();

  for (const rule of KEYWORD_RULES) {
    if (rule.re.test(text)) {
      return { mediaType: rule.media, rationale: rule.note, confidence: 0.85 };
    }
  }

  // Beat-role heuristics.
  if (beat === "hook") {
    return {
      mediaType: format === "SHORT" ? "AI_IMAGE" : "STOCK",
      rationale: "hook beat → strong opening visual",
      confidence: 0.7,
    };
  }
  if (beat === "cta" || beat === "conclusion" || beat === "recap" || beat === "resolution" || beat === "return") {
    return {
      mediaType: "TEXT_ANIMATION",
      rationale: "ending/CTA beat → clear call-to-action text",
      confidence: 0.75,
    };
  }

  // Style heuristics.
  if (style.includes("faceless") || style.includes("documentary")) {
    return { mediaType: "STOCK", rationale: "faceless/documentary style → stock footage", confidence: 0.65 };
  }
  if (style.includes("animated") || style.includes("minimalist")) {
    return { mediaType: "ANIMATION", rationale: "animated/minimal style → motion graphics", confidence: 0.6 };
  }
  if (format === "SHORT") {
    return { mediaType: "AI_VIDEO", rationale: "short format → AI video by default", confidence: 0.55 };
  }
  if (format === "SOCIAL") {
    return { mediaType: "AI_IMAGE", rationale: "social format → striking stills", confidence: 0.55 };
  }
  return { mediaType: "STOCK", rationale: "long-form default → stock footage", confidence: 0.5 };
}
