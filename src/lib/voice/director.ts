/**
 * Phase 4 — Voice Director (deterministic script-analysis engine, pure, no IO).
 *
 * Turns raw script text into a per-segment DIRECTED VOICE PLAN so synthesized
 * narration never sounds robotic/monotone: each segment carries a direction
 * (narrative/calm/serious/dramatic/energetic/emotional), pace, emotion,
 * intensity, emphasis keywords, pause markers and speaking rate. The plan is
 * the FULLY-BUILT request a TTS provider would consume; real synthesis goes
 * through the AI Model Orchestrator ("voice_generation").
 */

import { normalizeSpokenText, wordToPhoneticHint, type Corrections } from "./pronunciation";

export type SegmentDirection = "narrative" | "calm" | "serious" | "dramatic" | "energetic" | "emotional";
export type SegmentPace = "slow" | "normal" | "fast";

export interface DirectedSegment {
  startIndex: number;
  endIndex: number;
  text: string;
  spokenText: string;
  direction: SegmentDirection;
  pace: SegmentPace;
  emotion: string;
  intensity: number; // 0-100
  emphasis: string[];
  pauseBeforeMs: number;
  pauseAfterMs: number;
  speakingRate: number; // 0.5-1.5 multiplier
}

export interface DirectedVoicePlan {
  voice: string;
  language: string;
  segments: DirectedSegment[];
  /** Overall narrative energy 0-100. */
  energy: number;
  estimatedDurationMs: number;
  /** ESTIMATE model label for honesty. */
  timingModel: string;
}

export interface DirectOptions {
  language?: string;
  voiceId?: string;
  style?: string;
  corrections?: Corrections;
  speakingRate?: number;
}

const DRAMATIC_WORDS = [
  "huge", "incredible", "unbelievable", "shocking", "amazing", "breakthrough",
  "revolutionary", "explosive", "massive", "stunning", "jaw-dropping",
  "mind-blowing", "epic", "triumph", "disaster", "crisis", "urgent", "warning",
  "secret", "revealed", "finally", "never", "ever", "insane", "wild", "crazy",
];
const SERIOUS_WORDS = [
  "analysis", "data", "research", "study", "evidence", "methodology",
  "statistics", "technical", "framework", "protocol", "regulation", "policy",
  "financial", "revenue", "fiscal", "according", "consequently", "therefore",
  "significant", "substantial", "comprehensive", "fundamental", "critical",
  "infrastructure", "algorithm", "quantum", "clinical", "empirical",
];
const CALM_WORDS = [
  "gentle", "soft", "quiet", "peaceful", "calm", "serene", "slow", "breathe",
  "relax", "stillness", "tranquil", "soothe", "drift", "dream", "rest",
  "mindful", "tender", "warm", "embrace", "whisper",
];
const ENERGETIC_WORDS = [
  "go", "let's", "now", "fast", "quick", "boom", "power", "energy", "action",
  "start", "launch", "ready", "hype", "win", "champion", "strong",
];
const EMOTIONAL_WORDS = [
  "love", "heart", "tears", "joy", "sorrow", "hope", "dream", "believe",
  "feel", "remember", "lost", "found", "family", "home", "journey", "story",
  "together", "forever", "beautiful", "pain", "heal", "courage",
];

function countHits(text: string, words: string[]): number {
  const lower = text.toLowerCase();
  let hits = 0;
  for (const w of words) {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = lower.match(new RegExp(`\\b${escaped}\\b`, "g"));
    if (m) hits += m.length;
  }
  return hits;
}

/** Split text into sentence-ish segments (deterministic). */
export function splitSegments(text: string): string[] {
  const cleaned = (text ?? "").replace(/\s+/g, " ").trim();
  if (!cleaned) return [];
  const parts = cleaned.match(/[^.!?…]+[.!?…]+["”)]?|\S[^.!?…]*$/g) ?? [cleaned];
  return parts.map((p) => p.trim()).filter(Boolean);
}

function classifyDirection(sentence: string): { direction: SegmentDirection; intensity: number } {
  const dramatic = countHits(sentence, DRAMATIC_WORDS);
  const serious = countHits(sentence, SERIOUS_WORDS);
  const calm = countHits(sentence, CALM_WORDS);
  const energetic = countHits(sentence, ENERGETIC_WORDS);
  const emotional = countHits(sentence, EMOTIONAL_WORDS);
  const exclamations = (sentence.match(/!/g) ?? []).length;
  const questions = (sentence.match(/\?/g) ?? []).length;
  const caps = (sentence.match(/\b[A-Z]{3,}\b/g) ?? []).length;

  const dramaticScore = dramatic * 3 + exclamations * 4 + caps * 2;
  const energeticScore = energetic * 3 + exclamations * 2;
  const emotionalScore = emotional * 3 + questions * 1;
  const seriousScore = serious * 3;
  const calmScore = calm * 3;

  const scores: Array<[SegmentDirection, number]> = [
    ["dramatic", dramaticScore],
    ["energetic", energeticScore],
    ["emotional", emotionalScore],
    ["serious", seriousScore],
    ["calm", calmScore],
  ];
  scores.sort((a, b) => b[1] - a[1]);
  const [direction, top] = scores[0];
  if (top === 0) return { direction: "narrative", intensity: 40 };
  return { direction, intensity: Math.min(100, 45 + top * 9) };
}

/**
 * Emphasis keywords: proper nouns (Capitalized words), numbers / currency /
 * dates via the pronunciation engine, dramatic words, and quoted phrases.
 */
export function extractEmphasis(sentence: string, corrections: Corrections = {}): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (w: string) => {
    const t = w.trim().replace(/^[("“]+|[)"”.,!?:;]+$/g, "");
    if (t.length < 2 || seen.has(t.toLowerCase())) return;
    seen.add(t.toLowerCase());
    out.push(t);
  };
  for (const m of sentence.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/g)) {
    if (!["The", "This", "That", "These", "Those", "And", "But", "For"].includes(m[1])) push(m[1]);
  }
  for (const m of sentence.matchAll(/\b([A-Z]{2,}(?:\s+\d+)?)\b/g)) push(m[1]);
  for (const m of sentence.matchAll(/([$€£¥₹][\d,]+(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?%?\b)/g)) {
    if (wordToPhoneticHint(m[1]) !== null) push(m[1]);
  }
  for (const w of [...DRAMATIC_WORDS, ...EMOTIONAL_WORDS]) {
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = sentence.match(new RegExp(`\\b(${escaped})\\b`, "i"));
    if (m) push(m[1]);
  }
  for (const token of Object.keys(corrections)) {
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const m = sentence.match(new RegExp(`\\b(${escaped})\\b`, "i"));
    if (m) push(m[1]);
  }
  return out.slice(0, 6);
}

const PACE_FOR: Record<SegmentDirection, SegmentPace> = {
  narrative: "normal",
  calm: "slow",
  serious: "slow",
  dramatic: "normal",
  energetic: "fast",
  emotional: "slow",
};
const EMOTION_FOR: Record<SegmentDirection, string> = {
  narrative: "neutral",
  calm: "soothing",
  serious: "grave",
  dramatic: "intense",
  energetic: "excited",
  emotional: "heartfelt",
};
const RATE_FOR: Record<SegmentPace, number> = { slow: 0.9, normal: 1.0, fast: 1.12 };

/**
 * Build the directed voice plan for a script. Pure + deterministic: same
 * input always yields the same plan.
 */
export function directVoice(script: string, options: DirectOptions = {}): DirectedVoicePlan {
  const sentences = splitSegments(script);
  const corrections = options.corrections ?? {};
  const baseRate = options.speakingRate && Number.isFinite(options.speakingRate) ? options.speakingRate : 1.0;
  const segments: DirectedSegment[] = [];
  let cursor = 0;
  const scriptLower = (script ?? "").toLowerCase();
  sentences.forEach((sentence, i) => {
    const startIndex = (script ?? "").indexOf(sentence, cursor);
    const safeStart = startIndex >= 0 ? startIndex : cursor;
    cursor = safeStart + sentence.length;
    const { direction, intensity } = classifyDirection(sentence);
    const pace = PACE_FOR[direction];
    const endsStrong = /[!?…]$/.test(sentence.trim());
    const pauseBeforeMs = i === 0 ? 400 : direction === "dramatic" ? 700 : direction === "calm" ? 600 : 350;
    const pauseAfterMs = endsStrong ? 800 : direction === "dramatic" ? 700 : /[.!?]$/.test(sentence.trim()) ? 500 : 250;
    const styleBoost = options.style ? 1 : 0;
    void styleBoost;
    void scriptLower;
    segments.push({
      startIndex: safeStart,
      endIndex: safeStart + sentence.length,
      text: sentence,
      spokenText: normalizeSpokenText(sentence, corrections),
      direction,
      pace,
      emotion: EMOTION_FOR[direction],
      intensity,
      emphasis: extractEmphasis(sentence, corrections),
      pauseBeforeMs,
      pauseAfterMs,
      speakingRate: Math.round(RATE_FOR[pace] * baseRate * 100) / 100,
    });
  });
  const energy =
    segments.length === 0
      ? 0
      : Math.round(
          Math.min(
            100,
            segments.reduce((sum, s) => sum + s.intensity, 0) / segments.length,
          ),
        );
  const estimatedDurationMs = segments.reduce(
    (sum, s) =>
      sum +
      computeTiming({ text: s.spokenText, speakingRate: s.speakingRate, pauseBeforeMs: s.pauseBeforeMs, pauseAfterMs: s.pauseAfterMs }).durationMs,
    0,
  );
  return {
    voice: options.voiceId ?? "nora-female",
    language: options.language ?? "en",
    segments,
    energy,
    estimatedDurationMs,
    timingModel: "ESTIMATE: chars-per-second model — real TTS duration comes from the provider",
  };
}

/**
 * Estimated timing for one spoken segment. ESTIMATE ONLY: assumes ~15
 * characters per second at 1.0x rate plus explicit pauses. Real duration
 * comes from the TTS provider response.
 */
export function computeTiming(input: {
  text: string;
  speakingRate?: number;
  pauseBeforeMs?: number;
  pauseAfterMs?: number;
}): { durationMs: number; model: string } {
  const CPS = 15; // chars per second at 1.0x
  const rate = input.speakingRate && input.speakingRate > 0 ? input.speakingRate : 1.0;
  const speechMs = Math.round(((input.text ?? "").length / CPS / rate) * 1000);
  const durationMs = speechMs + (input.pauseBeforeMs ?? 0) + (input.pauseAfterMs ?? 0);
  return { durationMs, model: "ESTIMATE" };
}
