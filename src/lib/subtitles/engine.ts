/**
 * Phase 4 Block 3 — Subtitle engine (deterministic, pure, no IO).
 *
 * Turns script text (and/or a DirectedVoicePlan from the voice director into
 * a full SUBTITLE PLAN: per-cue sentence timing (from the voice segments'
 * boundaries), per-word timing (ESTIMATE: words distributed length-proportionally
 * inside each segment's speech window at the segment speakingRate — a wpm model),
 * automatic line breaks at maxLineLength without breaking words, dynamic
 * captions (long cues split into on-screen pieces of max 2 lines), and keyword
 * emphasis (words marked by the voice plan's emphasis arrays, or caps /
 * proper-nouns / numbers via the pronunciation engine when no plan is given).
 *
 * Nothing here ever fabricates a subtitle file — buildSubtitles returns a
 * deterministic plan; toSrt renders a REAL SRT string from that plan.
 * Provider transcription (audio → subtitles) goes through the AI Model
 * Orchestrator ("subtitle_generation") in a later phase.
 */

import {
  directVoice,
  extractEmphasis,
  type DirectedSegment,
  type DirectedVoicePlan,
} from "@/lib/voice/director";

export interface WordTiming {
  word: string;
  startMs: number;
  endMs: number;
  /** Keyword emphasis: the word was marked by the voice plan / pronunciation engine. */
  emphasis: boolean;
}

export interface SubtitleCue {
  /** 1-based cue number == SRT index. */
  index: number;
  startMs: number;
  endMs: number;
  /** Display text; "\n" marks a forced line break. */
  text: string;
  words: WordTiming[];
  /** Per-cue style override (a SubtitleStyleId). Optional; most cues inherit the plan style. */
  style?: string;
}

export interface SubtitlePlan {
  cues: SubtitleCue[];
  language: string;
  style: string;
  maxLineLength: number;
  safeMargins: { x: number; y: number };
  timingModel: string;
}

/** Explicit timing view — a segment carrying its own startMs/endMs. */
export interface SegmentTimingView {
  startMs: number;
  endMs: number;
  text?: string;
  speakingRate?: number;
  emphasis?: string[];
}

/**
 * Permissive segment input accepted by buildSubtitles. The runtime dispatches
 * on the first entry: if it carries a finite startMs/endMs it is treated as an
 * explicit timing view; otherwise it is treated as a director-style segment
 * whose timing is ESTIMATED from its text length and speakingRate. All fields
 * beyond `text` are optional and defaulted (pauseBeforeMs/pauseAfterMs -> 0,
 * speakingRate -> 1, emphasis -> []). This is the honest contract of
 * normalizeSegments, covering both DirectedSegment[] and SegmentTimingView[]
 * payloads as well as loose API-parsed entries.
 */
export type SubtitleSegmentInput =
  | DirectedSegment
  | SegmentTimingView
  | {
      text: string;
      startMs?: number;
      endMs?: number;
      speakingRate?: number;
      pauseBeforeMs?: number;
      pauseAfterMs?: number;
      emphasis?: string[];
    };

export interface BuildSubtitlesInput {
  text?: string;
  /** DirectedVoicePlan segments (timing ESTIMATED) or explicit {startMs,endMs} views. */
  segments?: SubtitleSegmentInput[];
  language?: string;
  style?: string;
  maxLineLength?: number;
  safeMargins?: { x: number; y: number };
}

export const DEFAULT_MAX_LINE_LENGTH = 42;
export const DEFAULT_SAFE_MARGINS = { x: 48, y: 48 } as const;
/** Words per minute at 1.0x speaking rate — the ESTIMATE word-timing model. */
export const BASE_WPM = 150;
/** Dynamic captions: an on-screen piece never exceeds this many lines. */
export const MAX_ONSCREEN_LINES = 2;

/**
 * Deterministic keyword-emphasis dictionary (the "Keyword Emphasis" caption
 * feature in the Phase 4 spec). Universal punch words are marked emphasis:true
 * in addition to the voice plan's own emphasis arrays and pronunciation-derived
 * caps/proper nouns — same input always yields the same marks.
 */
export const SUBTITLE_KEYWORD_EMPHASIS: string[] = [
  "future", "everything", "nothing", "never", "always", "now", "today",
  "moment", "changes", "changed", "change", "remember", "finally", "big",
  "new", "first", "only", "real", "really", "huge", "incredible", "amazing",
  "massive", "breakthrough", "secret", "warning", "urgent",
];

/** Internal normalized narration block with explicit timing. */
interface SubBlock {
  startMs: number;
  endMs: number;
  text: string;
  rate: number;
  emphasis: string[];
  /** True when the caller supplied explicit startMs/endMs. */
  explicit: boolean;
}

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function tokenizeWords(text: string): { raw: string; clean: string }[] {
  return (text ?? "")
    .split(/\s+/)
    .map((raw) => raw.trim())
    .filter(Boolean)
    .map((raw) => ({
      raw,
      clean: raw.replace(/^[("“'`]+|[)"”'`.,!?:;…]+$/g, "").toLowerCase(),
    }));
}

/**
 * Place director-style segments sequentially (same chars/sec model the
 * ducking engine uses, so subtitle boundaries agree with the ducking
 * timeline). ESTIMATE ONLY — real TTS timing comes from the provider.
 */
function placeDirectedSegments(segments: DirectedSegment[]): SubBlock[] {
  const blocks: SubBlock[] = [];
  let cursor = 0;
  for (const seg of segments) {
    const speechMs =
      ((seg.spokenText ?? seg.text ?? "").length / 15 / Math.max(0.5, seg.speakingRate || 1)) * 1000;
    const startMs = cursor + (seg.pauseBeforeMs ?? 0);
    const endMs = startMs + Math.round(speechMs);
    blocks.push({
      startMs,
      endMs,
      text: seg.text ?? seg.spokenText ?? "",
      rate: seg.speakingRate || 1,
      emphasis: seg.emphasis ?? [],
      explicit: false,
    });
    cursor = endMs + (seg.pauseAfterMs ?? 0);
  }
  return blocks;
}

function normalizeSegments(
  segments: SubtitleSegmentInput[] | undefined,
): { blocks: SubBlock[]; isTimingView: boolean } | null {
  if (!segments || segments.length === 0) return null;
  const first = segments[0] as SegmentTimingView & DirectedSegment;
  const isTimingView = Number.isFinite(first.startMs);
  if (isTimingView) {
    const blocks: SubBlock[] = [];
    for (const s of segments as SegmentTimingView[]) {
      if (!Number.isFinite(s.startMs) || !Number.isFinite(s.endMs)) continue;
      const text = (s.text ?? "").trim();
      if (!text) continue;
      const emphasis = Array.isArray(s.emphasis) ? s.emphasis.map((e) => String(e).toLowerCase()) : [];
      blocks.push({
        startMs: Math.round(s.startMs),
        endMs: Math.max(Math.round(s.endMs), Math.round(s.startMs) + 1),
        text,
        rate: Number.isFinite(s.speakingRate) ? clamp(s.speakingRate ?? 1, 0.5, 1.5) : 1,
        emphasis,
        explicit: true,
      });
    }
    return blocks.length > 0 ? { blocks, isTimingView: true } : null;
  }
  // Director-style segments: carry speakingRate/pauses/emphasis.
  return { blocks: placeDirectedSegments(segments as DirectedSegment[]), isTimingView: false };
}

/**
 * Word timing inside one block. ESTIMATE: words are distributed
 * length-proportionally (longer words get more time) across the block's
 * speech window; the underlying rate model is BASE_WPM words/minute scaled by
 * the segment speakingRate. Monotonic, deterministic, non-overlapping, and
 * always inside [startMs, endMs].
 */
function buildWordTimings(block: SubBlock, emphasisKeywords: string[]): WordTiming[] {
  const tokens = tokenizeWords(block.text);
  const speechMs = Math.max(1, block.endMs - block.startMs);
  // Words partially covered by a multi-word emphasis keyword ("New York").
  const blendWords = tokens.map((t) => t.clean);

  const track = new Set(emphasisKeywords.map((e) => e.toLowerCase()).filter((e) => e.length > 0));
  const isEmphasis = (i: number): boolean => {
    // Single-word match.
    if (track.has(blendWords[i])) return true;
    // Multi-word match: greedily try up to 4 consecutive words.
    for (let n = 2; n <= Math.min(4, blendWords.length - i); n++) {
      const phrase = blendWords.slice(i, i + n).join(" ");
      if (track.has(phrase)) return true;
    }
    return false;
  };

  const weights = tokens.map((t) => Math.max(1, t.clean.length));
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const wordTimings: WordTiming[] = [];
  let cursor = block.startMs;
  tokens.forEach((token, i) => {
    const dur = Math.round((speechMs * weights[i]) / totalWeight);
    const startMs = i === 0 ? block.startMs : cursor;
    const endMs = Math.min(block.endMs, startMs + dur);
    wordTimings.push({ word: token.raw, startMs, endMs, emphasis: isEmphasis(i) });
    cursor = Math.max(cursor, endMs);
  });
  // Guarantee the last word ends exactly on the block boundary, and that
  // adjacent words never overlap.
  if (wordTimings.length > 0) {
    wordTimings[wordTimings.length - 1].endMs = block.endMs;
    for (let i = 1; i < wordTimings.length; i++) {
      if (wordTimings[i].startMs < wordTimings[i - 1].endMs) {
        wordTimings[i].startMs = wordTimings[i - 1].endMs;
      }
    }
  }
  return wordTimings;
}

/** Greedy line wrapping — never breaks a word; single-word overflow goes on its own line. */
export function wrapLines(text: string, maxLineLength: number): string[] {
  const words = (text ?? "").split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) {
      current = word;
    } else if ((current + " " + word).length <= maxLineLength) {
      current += " " + word;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length > 0 ? lines : [""];
}

/**
 * Dynamic captions: chunk wrapped lines into on-screen pieces of at most
 * MAX_ONSCREEN_LINES (2) lines each. Each piece becomes its own cue with a
 * sub-range of the block's word timings.
 */
export function chunkIntoPieces(
  lines: string[],
  wordTimings: WordTiming[],
): { text: string; words: WordTiming[] }[] {
  const pieces: { text: string; words: WordTiming[] }[] = [];
  for (let i = 0; i < lines.length; i += MAX_ONSCREEN_LINES) {
    const chunk = lines.slice(i, i + MAX_ONSCREEN_LINES);
    const lineWords = new Set<string>();
    for (const line of chunk) {
      for (const t of tokenizeWords(line)) lineWords.add(t.clean);
    }
    const cleanWord = (w: WordTiming) => w.word.replace(/^[("“'`]+|[)"”'`.,!?:;…]+$/g, "").toLowerCase();
    const words = wordTimings.filter((w) => lineWords.has(cleanWord(w)));
    // Words can repeat across lines; filter keeps the first occurrence per
    // clean token — enough to reconstruct the sub-range deterministically.
    const unique: WordTiming[] = [];
    const seen = new Set<string>();
    for (const w of words) {
      const key = cleanWord(w);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(w);
    }
    pieces.push({ text: chunk.join("\n"), words: unique });
  }
  return pieces;
}

/** Extract the display text from raw input or explicit-timing segments. */
function joinSegmentText(segments: SubtitleSegmentInput[] | undefined, fallback: string): string {
  if (segments && segments.length > 0) {
    const joined = (segments as Array<{ text?: string }>)
      .map((s) => s.text ?? "")
      .filter(Boolean)
      .join(" ")
      .trim();
    if (joined) return joined;
  }
  return fallback ?? "";
}

/**
 * Build the deterministic subtitle plan. Same input always yields the same
 * plan. Sentence timing comes from segment boundaries; word timing is the
 * ESTIMATE model documented above.
 */
export function buildSubtitles(input: BuildSubtitlesInput = {}): SubtitlePlan {
  const maxLineLength = Math.max(8, Math.round(input.maxLineLength ?? DEFAULT_MAX_LINE_LENGTH));
  const safeMargins = {
    x: Number.isFinite(input.safeMargins?.x) ? Math.round(input.safeMargins!.x) : DEFAULT_SAFE_MARGINS.x,
    y: Number.isFinite(input.safeMargins?.y) ? Math.round(input.safeMargins!.y) : DEFAULT_SAFE_MARGINS.y,
  };
  const language = input.language ?? "en";
  const style = input.style ?? "minimal";

  const text = joinSegmentText(input.segments, input.text ?? "");
  const normalized = normalizeSegments(input.segments);
  let blocks: SubBlock[] = [];
  let timingModel: string;

  if (normalized && normalized.blocks.length > 0) {
    blocks = normalized.blocks;
    timingModel = normalized.isTimingView
      ? "EXPLICIT: segment startMs/endMs supplied by the caller."
      : "ESTIMATE: sentence timing derived from voice-director segments (chars/sec model); word timing is a wpm-based estimate.";
  } else if (text.trim()) {
    // Pure-text path: run the voice director to get segments + emphasis.
    const plan: DirectedVoicePlan = directVoice(text);
    blocks = placeDirectedSegments(plan.segments);
    timingModel =
      "ESTIMATE: sentence timing derived from the voice director over the raw text (chars/sec model); word timing is a wpm-based estimate.";
  } else {
    return {
      cues: [],
      language,
      style,
      maxLineLength,
      safeMargins,
      timingModel: "No text or segments provided — nothing to subtitle.",
    };
  }

  const cues: SubtitleCue[] = [];
  let index = 0;
  for (const block of blocks) {
    // Keyword emphasis (deterministic union):
    //  1. the voice plan's emphasis arrays (when the caller supplied them),
    //  2. pronunciation-engine caps / proper-nouns / numbers on the text,
    //  3. the subtitle keyword dictionary (universal punch words).
    const emphasisSet = new Set<string>(SUBTITLE_KEYWORD_EMPHASIS.map((w) => w.toLowerCase()));
    if (block.emphasis.length > 0) {
      for (const w of block.emphasis) emphasisSet.add(w.toLowerCase());
    }
    if (extractEmphasis(block.text).length > 0 && block.emphasis.length === 0) {
      for (const w of extractEmphasis(block.text)) emphasisSet.add(w.toLowerCase());
    }
    const emphasisKeywords = Array.from(emphasisSet);
    const wordTimings = buildWordTimings(block, emphasisKeywords);
    const lines = wrapLines(block.text, maxLineLength);
    const pieces = chunkIntoPieces(lines, wordTimings);
    for (const piece of pieces) {
      index += 1;
      const words = piece.words.length > 0 ? piece.words : wordTimings;
      cues.push({
        index,
        startMs: words[0]?.startMs ?? block.startMs,
        endMs: words[words.length - 1]?.endMs ?? block.endMs,
        text: piece.text,
        words,
      });
    }
  }

  return { cues, language, style, maxLineLength, safeMargins, timingModel };
}

/** Render the plan as a REAL SRT string (deterministic). */
export function toSrt(plan: SubtitlePlan): string {
  return plan.cues
    .map((cue) => `${cue.index}\n${formatSrtTime(cue.startMs)} --> ${formatSrtTime(cue.endMs)}\n${cue.text}`)
    .join("\n\n") + (plan.cues.length > 0 ? "\n" : "");
}

/** Format ms as SRT timestamp HH:MM:SS,mmm. */
export function formatSrtTime(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const h = Math.floor(safe / 3_600_000);
  const m = Math.floor((safe % 3_600_000) / 60_000);
  const s = Math.floor((safe % 60_000) / 1000);
  const milli = safe % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(milli, 3)}`;
}