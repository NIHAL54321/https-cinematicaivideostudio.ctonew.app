/**
 * Retention heuristics — drop-off risk analysis for a structure plan.
 *
 * HONEST heuristics only: they reason about structure shape (weak hooks, long
 * intros, repetition, weak endings, pacing, visual variety). They make NO
 * claims about actual audience behavior and never cite engagement statistics.
 */
import type { StoryStructure } from "./types";
import { getStructure } from "./structures";

export const RETENTION_FACTORS = [
  "weak_hook",
  "long_intro",
  "repetition",
  "weak_ending",
  "missing_cta",
  "monotone_pacing",
  "low_visual_variety",
  "late_first_payoff",
] as const;
export type RetentionRiskFactor = (typeof RETENTION_FACTORS)[number];

export const RECOMMENDATION_TYPES = [
  "pattern_interrupt",
  "curiosity_loop",
  "question",
  "statistic",
  "example",
  "emotional_moment",
  "story_transition",
  "visual_change",
] as const;
export type RecommendationType = (typeof RECOMMENDATION_TYPES)[number];

export interface RetentionRisk {
  factor: RetentionRiskFactor;
  severity: "low" | "medium" | "high";
  reason: string;
}

export interface RetentionRecommendation {
  type: RecommendationType;
  reason: string;
}

export interface RetentionAnalysis {
  riskScore: number; // 0 (healthy shape) – 100 (high drop-off risk)
  risks: RetentionRisk[];
  recommendations: RetentionRecommendation[];
  /** Transparency label. */
  honestNote: string;
}

export interface RetentionInput {
  structureId?: string;
  hookType?: string;
  totalDurationSeconds: number;
  chapterCount: number;
  sceneCount: number;
  hookSeconds?: number;
  /** Beat names in order (used to detect repetition). */
  beatNames?: string[];
}

const RISK_WEIGHT: Record<RetentionRiskFactor, number> = {
  weak_hook: 25,
  long_intro: 15,
  repetition: 15,
  weak_ending: 20,
  missing_cta: 20,
  monotone_pacing: 8,
  low_visual_variety: 8,
  late_first_payoff: 12,
};

const RECOMMENDATION_FOR_FACTOR: Record<RetentionRiskFactor, RecommendationType[]> = {
  weak_hook: ["curiosity_loop", "question", "statistic"],
  long_intro: ["pattern_interrupt", "story_transition"],
  repetition: ["visual_change", "example", "pattern_interrupt"],
  weak_ending: ["emotional_moment", "question"],
  missing_cta: ["question", "emotional_moment"],
  monotone_pacing: ["pattern_interrupt", "visual_change", "story_transition"],
  low_visual_variety: ["visual_change", "example"],
  late_first_payoff: ["curiosity_loop", "story_transition"],
};

const ENDING_MARKERS = ["cta", "conclusion", "resolution", "recap", "return", "call to action", "synthesis"];

export function analyzeRetention(input: RetentionInput): RetentionAnalysis {
  const risks: RetentionRisk[] = [];
  const structure: StoryStructure | undefined = input.structureId ? getStructure(input.structureId) : undefined;

  const push = (factor: RetentionRiskFactor, severity: "low" | "medium" | "high", reason: string) => {
    risks.push({ factor, severity, reason });
  };

  // Weak / missing hook.
  if (!input.hookType || input.hookType === "none") {
    push("weak_hook", "high", "No hook type chosen — the first seconds are unplanned.");
  } else if (input.hookType === "statistics" && !input.beatNames?.some((b) => b.toLowerCase().includes("stat"))) {
    push("weak_hook", "medium", "Statistics hook planned without a statistics beat to back it up.");
  }

  // Long intro: hook chapter eating too much of a short video.
  if (input.hookSeconds !== undefined && input.totalDurationSeconds > 0) {
    const share = input.hookSeconds / input.totalDurationSeconds;
    if (share > 0.3) push("late_first_payoff", "high", `Hook/opening consumes ${Math.round(share * 100)}% of runtime — payoff arrives late.`);
    else if (share > 0.22) push("late_first_payoff", "low", "Opening is on the long side for the runtime.");
    if (share > 0.25) push("long_intro", "medium", "Intro is longer than a quarter of the video.");
  }

  // Repetition.
  if (input.beatNames) {
    const seen = new Map<string, number>();
    for (const n of input.beatNames) {
      const key = n.toLowerCase();
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    const dupes = [...seen.entries()].filter(([, c]) => c > 1);
    if (dupes.length > 0) {
      push("repetition", "medium", `Repeated section(s): ${dupes.map(([n, c]) => `${n} ×${c}`).join(", ")}.`);
    }
  }

  // Weak ending: last beat isn't an ending marker.
  const lastBeat = input.beatNames?.[input.beatNames.length - 1] ?? structure?.beats[structure.beats.length - 1]?.name ?? "";
  if (lastBeat && !ENDING_MARKERS.some((m) => lastBeat.toLowerCase().includes(m))) {
    push("weak_ending", "high", `The final beat (“${lastBeat}”) is not a conclusion/CTA — the video may trail off.`);
  }
  if (!lastBeat) push("missing_cta", "high", "No ending beat defined.");

  // Monotone pacing: similar chapter sizes.
  if (structure && structure.beats.length > 1 && input.totalDurationSeconds > 0) {
    const shares = structure.beats.map((b) => b.share);
    const avg = shares.reduce((a, b) => a + b, 0) / shares.length;
    const spread = Math.max(...shares) - Math.min(...shares);
    if (spread / avg < 0.25) {
      push("monotone_pacing", "low", "Beats have very similar weight — pacing may feel flat.");
    }
  }

  // Low visual variety.
  if (input.sceneCount > 0 && input.chapterCount > 0 && input.sceneCount < input.chapterCount) {
    push("low_visual_variety", "low", "Fewer scenes than chapters — visuals may repeat across sections.");
  }

  // Risk score: sum weighted risks (severity scales the weight).
  const severityScale = { low: 0.4, medium: 0.7, high: 1.0 } as const;
  const raw = risks.reduce((acc, r) => acc + RISK_WEIGHT[r.factor] * severityScale[r.severity], 0);
  const riskScore = Math.min(100, Math.round(raw));

  const recommendations: RetentionRecommendation[] = [];
  for (const r of risks) {
    for (const type of RECOMMENDATION_FOR_FACTOR[r.factor]) {
      if (recommendations.some((rec) => rec.type === type)) continue;
      recommendations.push({ type, reason: reasonFor(type, r.factor) });
    }
  }

  return {
    riskScore,
    risks,
    recommendations,
    honestNote:
      "Heuristic structure analysis only — it reasons about the plan's shape, not real audience behavior. No engagement statistics are claimed.",
  };
}

function reasonFor(type: RecommendationType, factor: RetentionRiskFactor): string {
  const reasons: Record<RecommendationType, string> = {
    pattern_interrupt: "Cut to a different visual/pacing before the current section overstays.",
    curiosity_loop: "Open a question the viewer can only close by watching on.",
    question: "Ask the viewer a direct question to re-engage attention.",
    statistic: "Anchor the point with a real, sourced figure (never invented).",
    example: "Ground the abstraction in one concrete example.",
    emotional_moment: "Insert a human moment to rebuild empathy.",
    story_transition: "Bridge sections with a story beat instead of a topic label.",
    visual_change: "Vary the media type/shot so the screen changes meaningfully.",
  };
  return `${reasons[type]} (addresses: ${factor})`;
}
