/**
 * Phase 5 Block 5a — Long-form → shorts MOMENT ANALYSIS (deterministic, pure).
 *
 * WHAT IT READS (and what it does NOT): the timeline's own structure (clip spans,
 * scene grouping, track coverage, cadence) plus the project's SCRIPT — the
 * narration text and titles on the Scene rows. It has NOT watched the footage.
 * There is no transcript, no audio analysis and no visual ML here, so every
 * candidate carries `watchedFootage: false` and a `basis` string saying so. A
 * moment that would genuinely need real media analysis (speech-to-text, audio /
 * visual ML) is NOT invented — that path comes back as the honest provider gate
 * from ./service with env var NAMES only.
 *
 * HOW A SCORE IS BUILT: every candidate's `score` is the clamped sum of the
 * `signals` returned alongside it. Each signal is a stated, inspectable input —
 * sentence length, a matched word from a published lexicon, a numeral or a
 * percentage, scene position, the pacing dimensions from ../editor/pacing — and
 * carries its own point value and a human-readable detail. Nothing is random and
 * nothing is hard-coded per moment: change the script or the timeline and the
 * numbers move.
 *
 * Kinds: hook | emotional | surprise | quote | stat | informative (MOMENT_KINDS).
 */
import { clipsAt, type Clip, type SceneInput, type Timeline } from "../editor/timeline";
import { analyzePacing } from "../editor/pacing";
import {
  capabilityConnectivity,
  capabilityEnvRequirementFor,
} from "../ai/providers/capability-connectivity";

/* ------------------------------------------------------------------ */
/* Vocabulary and published thresholds                                 */
/* ------------------------------------------------------------------ */

export const MOMENT_KINDS = ["hook", "emotional", "surprise", "quote", "stat", "informative"] as const;
export type MomentKind = (typeof MOMENT_KINDS)[number];

export const MOMENT_LABELS: Record<MomentKind, string> = {
  hook: "Hook",
  emotional: "Emotional",
  surprise: "Surprise",
  quote: "Quote",
  stat: "Stat",
  informative: "Informative",
};

export const MOMENT_BASIS = "script narration + timeline structure (the footage itself was not analysed)";

/** Candidates below this score are not reported at all (a weak signal is not a moment). */
export const MIN_MOMENT_SCORE = 25;

/** A hook must sit in the opening: unit 0, or inside this fraction of the cut. */
export const HOOK_WINDOW_RATIO = 0.2;
/** Word counts used by several scorers. */
export const SHORT_SENTENCE_WORDS = 18;
export const MEDIUM_SENTENCE_WORDS = 30;
export const REFLECTIVE_SENTENCE_WORDS = 20;
export const DETAILED_SENTENCE_WORDS = 25;
/** A unit needs this much room to land an emotional beat (ms). */
export const EMOTIONAL_MIN_MS = 6000;
/** Cap on how many candidates one call returns (the total is reported too). */
export const MOMENT_CANDIDATE_LIMIT = 40;

/**
 * The published lexicons. They are the ONLY word lists used, they are plain
 * English, and a match is reported verbatim in the candidate's reason.
 */
export const MOMENT_LEXICONS = {
  emotion: [
    "love", "fear", "afraid", "dream", "dreams", "hope", "grief", "loss", "lost", "hurt", "joy", "proud",
    "regret", "alone", "lonely", "brave", "cry", "cried", "heart", "pain", "painful", "struggle", "struggled",
    "fail", "failed", "failure", "devastated", "terrified", "desperate", "shame", "ashamed", "grateful",
    "angry", "anger", "sad", "sadness", "happy", "happiness", "anxious", "worried",
  ],
  surprise: [
    "but", "however", "yet", "surprisingly", "surprising", "unexpected", "unexpectedly", "actually",
    "turns out", "turned out", "shock", "shocking", "secret", "hidden", "nobody", "no one", "myth", "myths",
    "wrong", "mistake", "mistaken", "impossible", "suddenly", "sudden", "contrary", "instead",
  ],
  informative: [
    "how to", "guide", "learn", "explain", "explained", "because", "therefore", "for example", "means",
    "reason", "reasons", "method", "process", "system", "framework", "rule", "tutorial", "lesson", "tip",
    "tips", "definition", "step",
  ],
  attribution: ["said", "says", "told", "according to", "quote", "quoted", "claims", "argues"],
  superlative: [
    "best", "worst", "fastest", "slowest", "biggest", "smallest", "most", "least", "never", "always",
    "only", "ultimate", "record", "greatest", "first ever", "largest", "highest", "lowest",
  ],
  comparison: [
    "more", "less", "than", "increase", "increased", "decrease", "decreased", "faster", "slower", "higher",
    "lower", "double", "doubled", "triple", "twice", "half",
  ],
  scale: ["thousand", "million", "billion", "trillion", "percent", "percentage", "hundred", "dozen"],
  ordinal: ["first", "second", "third", "then", "next", "finally", "lastly"],
} as const;

/** Point values, all in one place so a reading of the score is easy to audit. */
export const MOMENT_POINTS = {
  hookFirstUnit: 30,
  hookInWindow: 18,
  hookShortSentence: 15,
  hookQuestion: 15,
  hookSecondPerson: 12,
  hookNumeralOrSuperlative: 10,
  hookMediumSentence: 8,
  hookShortShotMs: 8000,
  hookShortShotBonus: 8,
  hookAttentionWeight: 0.2,
  emotionalWord: 12,
  emotionalWordCap: 48,
  emotionalFirstPerson: 10,
  emotionalExclamation: 8,
  emotionalLongSentence: 10,
  emotionalRoom: 8,
  emotionalTurnBonus: 4,
  surpriseMarker: 14,
  surpriseMarkerCap: 42,
  surpriseContrast: 12,
  surpriseSuperlative: 10,
  surpriseExclamation: 8,
  surpriseSetup: 8,
  quoteQuoted: 28,
  quoteAttribution: 18,
  quoteWord: 12,
  quoteShortSentence: 10,
  quoteSuperlative: 10,
  quoteSecondPerson: 6,
  statNumeral: 14,
  statNumeralCap: 42,
  statPercentage: 18,
  statCurrency: 12,
  statMultiplier: 12,
  statComparison: 10,
  statScaleWord: 8,
  informativeMarker: 10,
  informativeMarkerCap: 50,
  informativeOrdinal: 12,
  informativeExplanation: 10,
  informativeDetailed: 12,
  informativeVoiceCoverage: 8,
  informativeRoom: 6,
} as const;

/* ------------------------------------------------------------------ */
/* Shapes                                                             */
/* ------------------------------------------------------------------ */

/** One inspectable input behind a score. */
export interface MomentSignal {
  /** Stable machine name. */
  signal: string;
  /** Points this signal contributes (always > 0 for a matched signal). */
  points: number;
  /** Human-readable explanation of exactly what was measured. */
  detail: string;
}

export interface MomentCandidate {
  /** Deterministic id: `<kind>-<unitId>`. */
  id: string;
  kind: MomentKind;
  sceneId: string | null;
  /** 0-based position of the unit in narrative order. */
  sceneIndex: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  /** A title/label hint derived from the script (never AI-written). */
  title: string;
  /** The exact script excerpt the score was computed from ("" when none). */
  text: string;
  /** Clamped sum of `signals`, 0-100. */
  score: number;
  /** Human-readable reason, built from the signals above. */
  reason: string;
  signals: MomentSignal[];
  /** Always false: this reads the script and the timeline, not the pixels. */
  watchedFootage: false;
  basis: string;
}

/** One scoreable chunk of the timeline: a scene's span, or a manual clip. */
export interface MomentUnit {
  id: string;
  sceneId: string | null;
  sceneIndex: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  title: string;
  text: string;
  hasNarration: boolean;
  /** Video-lane clips inside the span. */
  clipCount: number;
  /** True when a voice clip covers the span (used only as a stated signal). */
  hasVoice: boolean;
  source: "scene" | "timeline" | "clip";
}

export interface MomentAnalysis {
  units: MomentUnit[];
  candidates: MomentCandidate[];
  /** Candidates before the MOMENT_CANDIDATE_LIMIT cap. */
  candidateCount: number;
  countsByKind: Record<MomentKind, number>;
  totals: { units: number; narratedUnits: number; structuralOnlyUnits: number };
  pacing: { attention: number; narration: number; cadence: number };
  basis: string;
  note: string;
}

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Distinct lexicon entries present in `text`, in first-appearance order. */
function matchesOf(text: string, lexicon: readonly string[]): string[] {
  const out: string[] = [];
  for (const entry of lexicon) {
    const re = new RegExp(`\\b${escapeRe(entry)}`, "i");
    if (re.test(text)) out.push(entry);
  }
  return out;
}

/** Distinct numerals as written ("12", "3.5", "1,200"), in order of appearance. */
export function numeralsOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/\d[\d,]*(?:\.\d+)?/g)) {
    if (!out.includes(m[0])) out.push(m[0]);
  }
  return out;
}

export function isPercent(text: string): boolean {
  return /%|\bpercent\b|\bper cent\b|\bpercentage\b/i.test(text);
}

export function isCurrency(text: string): boolean {
  return /[$£€¥]|\b(usd|eur|gbp|dollars?|euros?|pounds?|cents?)\b/i.test(text);
}

export function isMultiplier(text: string): boolean {
  return /\b\d+(?:\.\d+)?\s?(x|times|-fold)\b|\b(double|doubled|triple|tripled|twice|half)\b/i.test(text);
}

export function isQuoted(text: string): boolean {
  return /["“”«»]|‘|’/.test(text);
}

export function isQuestion(text: string): boolean {
  return text.includes("?");
}

function hasSecondPerson(text: string): boolean {
  return /\b(you|your|you're|yourself|yours)\b/i.test(text);
}

function hasFirstPerson(text: string): boolean {
  return /\b(i|we|me|my|our|us|ours)\b/i.test(text);
}

export function wordCount(text: string): number {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

/** Sentence split, deterministic: on . ! ? followed by whitespace or end. */
export function sentencesOf(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(0, Math.min(100, n)));
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/* ------------------------------------------------------------------ */
/* Units                                                              */
/* ------------------------------------------------------------------ */

function narrationFor(scenes: Map<string, SceneInput>, sceneId: string | null): string {
  if (!sceneId) return "";
  const row = scenes.get(sceneId);
  const value = row?.narration;
  return typeof value === "string" ? value.trim() : "";
}

function titleFor(scenes: Map<string, SceneInput>, sceneId: string | null, fallback: string): string {
  if (sceneId) {
    const title = scenes.get(sceneId)?.title;
    if (typeof title === "string" && title.trim()) return title.trim();
  }
  return fallback;
}

/**
 * The scoreable units: every scene that appears on the video lane (grouped in
 * narrative order), plus one unit per manual video clip that has no scene.
 */
export function momentUnits(timeline: Timeline, scenes: SceneInput[] = []): MomentUnit[] {
  const byId = new Map<string, SceneInput>();
  for (const scene of scenes) if (scene && typeof scene.id === "string") byId.set(scene.id, scene);
  const voice = clipsAt(timeline, "voice");
  const units: MomentUnit[] = [];
  const seen = new Map<string, number>();

  for (const clip of clipsAt(timeline, "video")) {
    const sceneId = typeof clip.sceneId === "string" && clip.sceneId ? clip.sceneId : null;
    if (sceneId && seen.has(sceneId)) {
      // Extend the existing unit (a scene can span several clips).
      const unit = units[seen.get(sceneId) as number];
      unit.endMs = Math.max(unit.endMs, clip.endMs);
      unit.startMs = Math.min(unit.startMs, clip.startMs);
      unit.durationMs = unit.endMs - unit.startMs;
      unit.clipCount += 1;
      continue;
    }
    const text = narrationFor(byId, sceneId);
    const unit: MomentUnit = {
      id: sceneId ? `s${units.length}` : `c${units.length}`,
      sceneId,
      sceneIndex: units.length,
      startMs: clip.startMs,
      endMs: clip.endMs,
      durationMs: Math.max(0, clip.endMs - clip.startMs),
      title: titleFor(byId, sceneId, clip.name || "Clip"),
      text,
      hasNarration: text.length > 0,
      clipCount: 1,
      hasVoice: sceneId
        ? voice.some((v) => v.sceneId === sceneId)
        : voice.some((v) => v.startMs < clip.endMs && clip.startMs < v.endMs),
      source: sceneId ? (byId.has(sceneId) ? "scene" : "timeline") : "clip",
    };
    if (sceneId) seen.set(sceneId, units.length);
    units.push(unit);
  }

  units.sort((a, b) => a.startMs - b.startMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  units.forEach((u, i) => {
    u.sceneIndex = i;
  });
  return units;
}

/* ------------------------------------------------------------------ */
/* Per-kind scorers                                                    */
/* ------------------------------------------------------------------ */

interface Draft {
  score: number;
  signals: MomentSignal[];
  /** The sentence the score was computed from (best of the unit's sentences). */
  text: string;
}

function signal(signals: MomentSignal[], name: string, points: number, detail: string): void {
  if (points <= 0) return;
  signals.push({ signal: name, points, detail });
}

/** Best sentence for a scorer: the one whose sentence-level points are highest. */
function best<T>(items: T[], scoreOf: (item: T) => number): T | null {
  let winner: T | null = null;
  let winnerScore = -1;
  for (const item of items) {
    const value = scoreOf(item);
    if (value > winnerScore) {
      winner = item;
      winnerScore = value;
    }
  }
  return winner;
}

function scoreHook(unit: MomentUnit, totalMs: number, attention: number): Draft | null {
  const inWindow = unit.sceneIndex === 0 || (totalMs > 0 && unit.startMs <= totalMs * HOOK_WINDOW_RATIO);
  if (!inWindow) return null; // a hook that is not in the opening is not a hook
  const signals: MomentSignal[] = [];
  if (unit.sceneIndex === 0) {
    signal(signals, "opening-unit", MOMENT_POINTS.hookFirstUnit, `it is the first unit on the timeline (scene ${unit.sceneIndex + 1})`);
  } else {
    signal(
      signals,
      "opening-window",
      MOMENT_POINTS.hookInWindow,
      `it starts ${seconds(unit.startMs)}s in, inside the opening ${Math.round(HOOK_WINDOW_RATIO * 100)}% (${seconds(totalMs * HOOK_WINDOW_RATIO)}s)`,
    );
  }

  const sentences = sentencesOf(unit.text);
  const winner = best(sentences, (s) => {
    let p = 0;
    const w = wordCount(s);
    if (w <= SHORT_SENTENCE_WORDS) p += MOMENT_POINTS.hookShortSentence;
    else if (w <= MEDIUM_SENTENCE_WORDS) p += MOMENT_POINTS.hookMediumSentence;
    if (isQuestion(s)) p += MOMENT_POINTS.hookQuestion;
    if (hasSecondPerson(s)) p += MOMENT_POINTS.hookSecondPerson;
    if (numeralsOf(s).length > 0 || matchesOf(s, MOMENT_LEXICONS.superlative).length > 0) {
      p += MOMENT_POINTS.hookNumeralOrSuperlative;
    }
    return p;
  });

  if (winner) {
    const w = wordCount(winner);
    if (w <= SHORT_SENTENCE_WORDS) {
      signal(signals, "short-sentence", MOMENT_POINTS.hookShortSentence, `the opening line is short (${w} ${plural(w, "word", "words")})`);
    } else if (w <= MEDIUM_SENTENCE_WORDS) {
      signal(signals, "medium-sentence", MOMENT_POINTS.hookMediumSentence, `the opening line runs ${w} words`);
    }
    if (isQuestion(winner)) signal(signals, "question", MOMENT_POINTS.hookQuestion, "the line opens a question");
    if (hasSecondPerson(winner)) {
      signal(signals, "second-person", MOMENT_POINTS.hookSecondPerson, "it addresses the viewer directly (\"you\")");
    }
    const numerals = numeralsOf(winner);
    const supers = matchesOf(winner, MOMENT_LEXICONS.superlative);
    if (numerals.length > 0 || supers.length > 0) {
      const parts: string[] = [];
      if (numerals.length > 0) parts.push(`numeral(s) ${numerals.map(quoted).join(", ")}`);
      if (supers.length > 0) parts.push(`superlative(s) ${supers.map(quoted).join(", ")}`);
      signal(signals, "numeral-or-superlative", MOMENT_POINTS.hookNumeralOrSuperlative, parts.join(" and "));
    }
  }

  const attentionPoints = Math.round(attention * MOMENT_POINTS.hookAttentionWeight);
  signal(signals, "pacing-attention", attentionPoints, `the pacing analyzer reads attention ${attention}/100`);

  if (unit.durationMs <= MOMENT_POINTS.hookShortShotMs) {
    signal(
      signals,
      "short-opening-shot",
      MOMENT_POINTS.hookShortShotBonus,
      `the opening shot holds ${seconds(unit.durationMs)}s (≤ ${seconds(MOMENT_POINTS.hookShortShotMs)}s)`,
    );
  }

  return { score: sum(signals), signals, text: winner ?? unit.text };
}

function scoreEmotional(unit: MomentUnit): Draft | null {
  const signals: MomentSignal[] = [];
  const sentences = sentencesOf(unit.text);
  const winner = best(sentences, (s) => {
    const hits = matchesOf(s, MOMENT_LEXICONS.emotion);
    return (
      Math.min(hits.length * MOMENT_POINTS.emotionalWord, MOMENT_POINTS.emotionalWordCap) +
      (hasFirstPerson(s) ? MOMENT_POINTS.emotionalFirstPerson : 0) +
      (s.includes("!") ? MOMENT_POINTS.emotionalExclamation : 0) +
      (wordCount(s) >= REFLECTIVE_SENTENCE_WORDS ? MOMENT_POINTS.emotionalLongSentence : 0)
    );
  });

  if (winner) {
    const hits = matchesOf(winner, MOMENT_LEXICONS.emotion);
    if (hits.length > 0) {
      signal(
        signals,
        "emotion-lexicon",
        Math.min(hits.length * MOMENT_POINTS.emotionalWord, MOMENT_POINTS.emotionalWordCap),
        `${hits.length} emotional ${plural(hits.length, "word", "words")} (${hits.map(quoted).join(", ")}) at ${MOMENT_POINTS.emotionalWord} points each (capped at ${MOMENT_POINTS.emotionalWordCap})`,
      );
    }
    if (hasFirstPerson(winner)) {
      signal(signals, "first-person", MOMENT_POINTS.emotionalFirstPerson, "it speaks in the first person (\"I\" / \"we\")");
    }
    if (winner.includes("!")) signal(signals, "exclamation", MOMENT_POINTS.emotionalExclamation, "the line is an exclamation");
    const w = wordCount(winner);
    if (w >= REFLECTIVE_SENTENCE_WORDS) {
      signal(signals, "reflective-length", MOMENT_POINTS.emotionalLongSentence, `the line is ${w} words long (≥ ${REFLECTIVE_SENTENCE_WORDS})`);
    }
  }

  if (unit.durationMs >= EMOTIONAL_MIN_MS) {
    signal(
      signals,
      "room-to-land",
      MOMENT_POINTS.emotionalRoom,
      `the unit holds ${seconds(unit.durationMs)}s (≥ ${seconds(EMOTIONAL_MIN_MS)}s) — room for the beat to land`,
    );
  }
  if (unit.sceneIndex > 0) {
    signal(signals, "has-setup", MOMENT_POINTS.emotionalTurnBonus, `it is unit ${unit.sceneIndex + 1}, so something already precedes it`);
  }

  return { score: sum(signals), signals, text: winner ?? unit.text };
}

function scoreSurprise(unit: MomentUnit, totalMs: number): Draft | null {
  const signals: MomentSignal[] = [];
  const sentences = sentencesOf(unit.text);
  const winner = best(sentences, (s) => {
    const hits = matchesOf(s, MOMENT_LEXICONS.surprise);
    let p = Math.min(hits.length * MOMENT_POINTS.surpriseMarker, MOMENT_POINTS.surpriseMarkerCap);
    if (hits.length > 0 && numeralsOf(s).length > 0) p += MOMENT_POINTS.surpriseContrast;
    if (matchesOf(s, MOMENT_LEXICONS.superlative).length > 0) p += MOMENT_POINTS.surpriseSuperlative;
    if (s.includes("!")) p += MOMENT_POINTS.surpriseExclamation;
    return p;
  });

  if (winner) {
    const hits = matchesOf(winner, MOMENT_LEXICONS.surprise);
    const numerals = numeralsOf(winner);
    if (hits.length > 0) {
      signal(
        signals,
        "surprise-lexicon",
        Math.min(hits.length * MOMENT_POINTS.surpriseMarker, MOMENT_POINTS.surpriseMarkerCap),
        `${hits.length} turn ${plural(hits.length, "marker", "markers")} (${hits.map(quoted).join(", ")}) at ${MOMENT_POINTS.surpriseMarker} points each (capped at ${MOMENT_POINTS.surpriseMarkerCap})`,
      );
    }
    if (hits.length > 0 && numerals.length > 0) {
      signal(
        signals,
        "contrast-numeral",
        MOMENT_POINTS.surpriseContrast,
        `a turn marker next to ${plural(numerals.length, "a hard number", "hard numbers")} (${numerals.map(quoted).join(", ")})`,
      );
    }
    const supers = matchesOf(winner, MOMENT_LEXICONS.superlative);
    if (supers.length > 0) {
      signal(signals, "superlative", MOMENT_POINTS.surpriseSuperlative, `absolute phrasing (${supers.map(quoted).join(", ")})`);
    }
    if (winner.includes("!")) signal(signals, "exclamation", MOMENT_POINTS.surpriseExclamation, "the line is an exclamation");
  }

  if (unit.sceneIndex > 0) {
    signal(
      signals,
      "has-setup",
      MOMENT_POINTS.surpriseSetup,
      `it is unit ${unit.sceneIndex + 1} of the ${seconds(totalMs)}s cut (starting at ${seconds(unit.startMs)}s), so a turn has something to turn from`,
    );
  }

  return { score: sum(signals), signals, text: winner ?? unit.text };
}

function scoreQuote(unit: MomentUnit): Draft | null {
  const signals: MomentSignal[] = [];
  const sentences = sentencesOf(unit.text);
  const winner = best(sentences, (s) => {
    let p = 0;
    if (isQuoted(s)) p += MOMENT_POINTS.quoteQuoted;
    if (matchesOf(s, MOMENT_LEXICONS.attribution).length > 0) p += MOMENT_POINTS.quoteAttribution;
    if (/\bquot(e|ed|es)\b/i.test(s)) p += MOMENT_POINTS.quoteWord;
    if (wordCount(s) <= DETAILED_SENTENCE_WORDS) p += MOMENT_POINTS.quoteShortSentence;
    if (matchesOf(s, MOMENT_LEXICONS.superlative).length > 0) p += MOMENT_POINTS.quoteSuperlative;
    if (hasSecondPerson(s)) p += MOMENT_POINTS.quoteSecondPerson;
    return p;
  });

  if (winner) {
    if (isQuoted(winner)) {
      signal(signals, "quoted-text", MOMENT_POINTS.quoteQuoted, "the line carries quotation marks");
    }
    const attrib = matchesOf(winner, MOMENT_LEXICONS.attribution);
    if (attrib.length > 0) {
      signal(signals, "attribution", MOMENT_POINTS.quoteAttribution, `an attribution verb (${attrib.map(quoted).join(", ")})`);
    }
    if (/\bquot(e|ed|es)\b/i.test(winner)) {
      signal(signals, "quote-word", MOMENT_POINTS.quoteWord, "the word \"quote\" appears in the line");
    }
    const w = wordCount(winner);
    if (w <= DETAILED_SENTENCE_WORDS) {
      signal(signals, "quotable-length", MOMENT_POINTS.quoteShortSentence, `the line is ${w} words — short enough to stand alone`);
    }
    const supers = matchesOf(winner, MOMENT_LEXICONS.superlative);
    if (supers.length > 0) {
      signal(signals, "superlative", MOMENT_POINTS.quoteSuperlative, `absolute phrasing (${supers.map(quoted).join(", ")})`);
    }
    if (hasSecondPerson(winner)) {
      signal(signals, "second-person", MOMENT_POINTS.quoteSecondPerson, "it addresses the viewer directly (\"you\")");
    }
  }

  return { score: sum(signals), signals, text: winner ?? unit.text };
}

function scoreStat(unit: MomentUnit): Draft | null {
  const signals: MomentSignal[] = [];
  const sentences = sentencesOf(unit.text);
  const winner = best(sentences, (s) => {
    const nums = numeralsOf(s);
    let p = Math.min(nums.length * MOMENT_POINTS.statNumeral, MOMENT_POINTS.statNumeralCap);
    if (isPercent(s)) p += MOMENT_POINTS.statPercentage;
    if (isCurrency(s)) p += MOMENT_POINTS.statCurrency;
    if (isMultiplier(s)) p += MOMENT_POINTS.statMultiplier;
    if (matchesOf(s, MOMENT_LEXICONS.comparison).length > 0) p += MOMENT_POINTS.statComparison;
    if (matchesOf(s, MOMENT_LEXICONS.scale).length > 0) p += MOMENT_POINTS.statScaleWord;
    return p;
  });

  if (winner) {
    const nums = numeralsOf(winner);
    if (nums.length > 0) {
      signal(
        signals,
        "numerals",
        Math.min(nums.length * MOMENT_POINTS.statNumeral, MOMENT_POINTS.statNumeralCap),
        `${nums.length} ${plural(nums.length, "numeral", "numerals")} (${nums.map(quoted).join(", ")}) at ${MOMENT_POINTS.statNumeral} points each (capped at ${MOMENT_POINTS.statNumeralCap})`,
      );
    }
    if (isPercent(winner)) signal(signals, "percentage", MOMENT_POINTS.statPercentage, "it states a percentage");
    if (isCurrency(winner)) signal(signals, "currency", MOMENT_POINTS.statCurrency, "it states a currency amount");
    if (isMultiplier(winner)) signal(signals, "multiplier", MOMENT_POINTS.statMultiplier, "it states a multiplier or ratio");
    const comps = matchesOf(winner, MOMENT_LEXICONS.comparison);
    if (comps.length > 0) {
      signal(signals, "comparison", MOMENT_POINTS.statComparison, `comparison framing (${comps.map(quoted).join(", ")})`);
    }
    const scales = matchesOf(winner, MOMENT_LEXICONS.scale);
    if (scales.length > 0) {
      signal(signals, "scale-word", MOMENT_POINTS.statScaleWord, `scale wording (${scales.map(quoted).join(", ")})`);
    }
  }

  return { score: sum(signals), signals, text: winner ?? unit.text };
}

function scoreInformative(unit: MomentUnit): Draft | null {
  const signals: MomentSignal[] = [];
  const sentences = sentencesOf(unit.text);
  const winner = best(sentences, (s) => {
    const markers = matchesOf(s, MOMENT_LEXICONS.informative);
    let p = Math.min(markers.length * MOMENT_POINTS.informativeMarker, MOMENT_POINTS.informativeMarkerCap);
    if (matchesOf(s, MOMENT_LEXICONS.ordinal).length > 0) p += MOMENT_POINTS.informativeOrdinal;
    if (/\b(because|therefore|so that|which means|that means)\b/i.test(s)) p += MOMENT_POINTS.informativeExplanation;
    if (wordCount(s) >= DETAILED_SENTENCE_WORDS) p += MOMENT_POINTS.informativeDetailed;
    return p;
  });

  if (winner) {
    const markers = matchesOf(winner, MOMENT_LEXICONS.informative);
    if (markers.length > 0) {
      signal(
        signals,
        "explainer-lexicon",
        Math.min(markers.length * MOMENT_POINTS.informativeMarker, MOMENT_POINTS.informativeMarkerCap),
        `${markers.length} explainer ${plural(markers.length, "marker", "markers")} (${markers.map(quoted).join(", ")}) at ${MOMENT_POINTS.informativeMarker} points each (capped at ${MOMENT_POINTS.informativeMarkerCap})`,
      );
    }
    const ordinals = matchesOf(winner, MOMENT_LEXICONS.ordinal);
    if (ordinals.length > 0) {
      signal(signals, "sequence", MOMENT_POINTS.informativeOrdinal, `step/sequence wording (${ordinals.map(quoted).join(", ")})`);
    }
    if (/\b(because|therefore|so that|which means|that means)\b/i.test(winner)) {
      signal(signals, "explanation", MOMENT_POINTS.informativeExplanation, "it explains a cause or a consequence");
    }
    const w = wordCount(winner);
    if (w >= DETAILED_SENTENCE_WORDS) {
      signal(signals, "detailed-length", MOMENT_POINTS.informativeDetailed, `the line is ${w} words (≥ ${DETAILED_SENTENCE_WORDS})`);
    }
  }

  if (unit.hasVoice) {
    signal(signals, "voice-coverage", MOMENT_POINTS.informativeVoiceCoverage, "a voice clip covers this unit on the timeline");
  }
  if (unit.durationMs >= EMOTIONAL_MIN_MS) {
    signal(signals, "room-to-explain", MOMENT_POINTS.informativeRoom, `the unit holds ${seconds(unit.durationMs)}s of explanation room`);
  }

  return { score: sum(signals), signals, text: winner ?? unit.text };
}

function sum(signals: MomentSignal[]): number {
  return clampScore(signals.reduce((total, s) => total + s.points, 0));
}

function quoted(s: string): string {
  return `"${s}"`;
}

function seconds(ms: number): string {
  return `${Math.round(ms / 100) / 10}`;
}

/* ------------------------------------------------------------------ */
/* Analysis                                                           */
/* ------------------------------------------------------------------ */

/** The unit's scoreable text: its narration, else its title. */
function textOf(unit: MomentUnit): string {
  return unit.hasNarration ? unit.text : "";
}

function labelHint(unit: MomentUnit, kind: MomentKind, excerpt: string): string {
  const source = excerpt.trim() || unit.title;
  const trimmed = source.length > 72 ? `${source.slice(0, 69).trimEnd()}...` : source;
  return `${MOMENT_LABELS[kind]} — ${trimmed}`;
}

/**
 * The two capabilities a REAL moment analysis would need: transcription and
 * audio/visual moment detection — the same pair the repurposing engine's own
 * gate names (`REPURPOSE_ANALYSIS_CAPABILITY` / `REPURPOSE_VISUAL_CAPABILITY`).
 * Written as literals so this pure module does not import ./service (which pulls
 * the orchestrator in).
 */
export const MOMENT_ANALYSIS_CAPABILITIES = ["speech_recognition", "scene_detection"] as const;

/**
 * The honest provider requirement for real moment analysis, DERIVED on every
 * call from the provider registry — never a fixed claim about this machine.
 *
 * The note below used to hard-code "no provider is connected", which is a
 * statement about THIS server: on a server whose wired slots are configured it
 * would have printed a falsehood while `GET /api/ai/status` said "connected".
 * Every clause here is one of exactly two kinds, and neither can rot:
 *   - a LIVE fact, from `capabilityConnectivity` — the same predicate (configured
 *     AND wired) the status API reports, so the two surfaces cannot disagree;
 *   - a CODE fact — this module imports no orchestrator, so it cannot dispatch.
 * Together they let a key change the live half without the sentence lying, and
 * 'no key for a wired slot' is only ever said when no wired slot IS configured.
 * The operator requirement names env vars straight from the registry.
 */
export function momentProviderRequirement(): { connected: boolean; note: string } {
  const connectivity = MOMENT_ANALYSIS_CAPABILITIES.map((c) => capabilityConnectivity(c));
  const connected = connectivity.every((c) => c.connected);
  const live = `Right now ${connectivity.map((c) => `${c.capability}: ${c.reason}`).join("; and ")}.`;
  const liveHead = connected
    ? "Every capability real media analysis needs is configured AND wired right now " +
      `(${connectivity.map((c) => `${c.capability}: ${c.connectedSlots.join("+")}`).join(", ")}), ` +
      "so a request to one would genuinely be attempted."
    : "Transcription and audio/visual moment detection would each need a provider that is configured AND wired.";
  return {
    connected,
    note:
      `${liveHead} ${live} ${capabilityEnvRequirementFor([...MOMENT_ANALYSIS_CAPABILITIES])} ` +
      "This module has no code path that dispatches to a provider, so no transcript and no " +
      '"detected" moment is produced here either way.',
  };
}

/**
 * Deterministic moment analysis over a timeline + its scenes.
 *
 * The same timeline and the same scenes always produce the same candidates in
 * the same order (score desc, then startMs asc, then id asc). Nothing is random,
 * nothing is time-dependent and no provider is involved.
 */
export function analyzeMoments(timeline: Timeline, scenes: SceneInput[] = []): MomentAnalysis {
  const safeScenes = Array.isArray(scenes) ? scenes : [];
  const units = momentUnits(timeline, safeScenes);
  const pacing = analyzePacing(timeline, safeScenes);
  const totalMs = Math.max(0, timeline.durationMs);
  const attention = pacing.dimensions.attention.score;

  const candidates: MomentCandidate[] = [];
  for (const unit of units) {
    const scoreable: MomentUnit = { ...unit, text: textOf(unit) };
    const drafts: [MomentKind, Draft | null][] = [
      ["hook", scoreHook(scoreable, totalMs, attention)],
      ["emotional", scoreable.text ? scoreEmotional(scoreable) : null],
      ["surprise", scoreable.text ? scoreSurprise(scoreable, totalMs) : null],
      ["quote", scoreable.text ? scoreQuote(scoreable) : null],
      ["stat", scoreable.text ? scoreStat(scoreable) : null],
      ["informative", scoreable.text ? scoreInformative(scoreable) : null],
    ];
    for (const [kind, draft] of drafts) {
      if (!draft || draft.score < MIN_MOMENT_SCORE) continue;
      const details = draft.signals.map((s) => s.detail);
      candidates.push({
        id: `${kind}-${unit.id}`,
        kind,
        sceneId: unit.sceneId,
        sceneIndex: unit.sceneIndex,
        startMs: unit.startMs,
        endMs: unit.endMs,
        durationMs: unit.durationMs,
        title: labelHint(unit, kind, draft.text),
        text: draft.text,
        score: draft.score,
        reason:
          `${MOMENT_LABELS[kind]} ${draft.score}/100 from ${MOMENT_BASIS}: ` +
          `${details.join("; ")}. Score = the sum of the listed signals; the footage was not analysed and no statistic was invented.`,
        signals: draft.signals,
        watchedFootage: false,
        basis: MOMENT_BASIS,
      });
    }
  }

  candidates.sort(
    (a, b) => b.score - a.score || a.startMs - b.startMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );

  const countsByKind = Object.fromEntries(MOMENT_KINDS.map((k) => [k, 0])) as Record<MomentKind, number>;
  for (const c of candidates) countsByKind[c.kind] += 1;

  const narratedUnits = units.filter((u) => u.hasNarration).length;
  const candidateCount = candidates.length;
  /*
   * The note's provider half is DERIVED (see `momentProviderRequirement`): the
   * old wording asserted "no provider is connected" as a fixed fact, which is a
   * claim about this server's keys rather than about this code.
   */
  const requirement = momentProviderRequirement();
  const note =
    units.length === 0
      ? "The video lane is empty, so there is nothing to score. No moment was invented and nothing " +
        `was analysed — this reads the timeline structure and the script only. ${requirement.note}`
      : `Scored ${units.length} unit(s) of the timeline against the script. ${candidateCount} candidate moment(s) cleared the ` +
        `${MIN_MOMENT_SCORE}-point floor. This reads the narration text and the timeline structure, so no transcript and no ` +
        `"detected" moment was produced. ${requirement.note}`;

  return {
    units,
    candidates: candidates.slice(0, MOMENT_CANDIDATE_LIMIT),
    candidateCount,
    countsByKind,
    totals: {
      units: units.length,
      narratedUnits,
      structuralOnlyUnits: units.length - narratedUnits,
    },
    pacing: {
      attention,
      narration: pacing.dimensions.narration.score,
      cadence: pacing.dimensions.sceneChange.score,
    },
    basis: MOMENT_BASIS,
    note,
  };
}

/** The unit spans a candidate clip window covers (used by ./clips for the scene list). */
export function sceneIdsIn(clips: Clip[]): string[] {
  const out: string[] = [];
  for (const clip of clips) {
    if (clip.sceneId && !out.includes(clip.sceneId)) out.push(clip.sceneId);
  }
  return out;
}
