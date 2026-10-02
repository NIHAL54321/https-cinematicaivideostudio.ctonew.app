/**
 * Phase 4 Block 2 — Automatic music ducking scheduler (deterministic, pure,
 * no IO).
 *
 * Takes a voice plan (either an explicit timing view {segments:[{startMs,
 * endMs}]} or a full DirectedVoicePlan from the voice director — timing is
 * then ESTIMATED by sequential placement) plus optional music regions, and
 * produces a ducking schedule: music is lowered while narration is active,
 * rises in narration pauses, and sits solo in music-only regions. Same input
 * always yields the same schedule.
 */

import { computeTiming, type DirectedVoicePlan } from "@/lib/voice/director";

export type DuckReason = "narrating" | "pause" | "music-only";

export interface DuckingVoiceSegment {
  startMs: number;
  endMs: number;
  /** Surrounding narrative pauses (informational — carried into gaps). */
  pauseBeforeMs?: number;
  pauseAfterMs?: number;
}

/** The timing view the ducking engine consumes. */
export interface DuckingVoicePlan {
  segments: DuckingVoiceSegment[];
  totalMs?: number;
}

export interface MusicRegion {
  startMs: number;
  endMs: number;
}

export interface DuckingEvent {
  startMs: number;
  endMs: number;
  /** Music level during the region: 0dB (full) or -duckedDepthDb (ducked). */
  dB: number;
  reason: DuckReason;
}

export interface DuckingMix {
  /** Master music level 0-1 (user control, default 0.7). */
  musicVolume: number;
  /** Duck depth in dB (positive magnitude; events report -duckedDepthDb). */
  duckedDepthDb: number;
  fadeInMs: number;
  fadeOutMs: number;
}

export interface DuckingSchedule {
  ducking: DuckingEvent[];
  mix: DuckingMix;
  /** Honest label: explicit segment timing vs director-derived estimate. */
  timingModel: string;
}

export interface DuckingInput {
  /**
   * Either a DirectedVoicePlan produced by the voice director (timing is
   * then estimated from character counts + pauses) or an explicit timing
   * view with segments carrying startMs/endMs.
   */
  voicePlan: Pick<DirectedVoicePlan, "segments"> | DuckingVoicePlan;
  musicSegments?: MusicRegion[];
  musicVolume?: number;
  duckedDepthDb?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
}

const DEFAULT_MIX: DuckingMix = { musicVolume: 0.7, duckedDepthDb: 6, fadeInMs: 600, fadeOutMs: 1200 };

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

/**
 * Convert a DirectedVoicePlan into explicit [startMs, endMs] narration
 * blocks by placing its segments sequentially. Speech occupies the block;
 * pauseBeforeMs / pauseAfterMs become the surrounding gaps (music rises).
 * ESTIMATE ONLY — real TTS timing comes from the provider.
 */
export function voicePlanToTiming(plan: DirectedVoicePlan): { segments: DuckingVoiceSegment[]; totalMs: number } {
  const segments: DuckingVoiceSegment[] = [];
  let cursor = 0;
  for (const seg of plan.segments) {
    const speechMs = computeTiming({
      text: seg.spokenText,
      speakingRate: seg.speakingRate,
      pauseBeforeMs: 0,
      pauseAfterMs: 0,
    }).durationMs;
    const startMs = cursor + (seg.pauseBeforeMs ?? 0);
    const endMs = startMs + speechMs;
    segments.push({ startMs, endMs, pauseBeforeMs: seg.pauseBeforeMs, pauseAfterMs: seg.pauseAfterMs });
    cursor = endMs + (seg.pauseAfterMs ?? 0);
  }
  return { segments, totalMs: cursor };
}

/** Normalize raw segment input into sorted, non-overlapping narration blocks. */
function normalizeSegments(segments: DuckingVoiceSegment[]): DuckingVoiceSegment[] {
  const clean = segments
    .filter((s) => Number.isFinite(s.startMs) && Number.isFinite(s.endMs))
    .map((s) => ({ ...s, startMs: Math.max(0, Math.round(s.startMs)), endMs: Math.max(0, Math.round(s.endMs)) }))
    .map((s) => (s.endMs < s.startMs ? { ...s, endMs: s.startMs } : s))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  // Merge overlapping / touching narration blocks so a segment is never
  // double-counted and adjacent blocks leave no phantom gap.
  const merged: DuckingVoiceSegment[] = [];
  for (const s of clean) {
    const last = merged[merged.length - 1];
    if (last && s.startMs <= last.endMs) {
      if (s.endMs > last.endMs) last.endMs = s.endMs;
    } else {
      merged.push({ ...s });
    }
  }
  return merged;
}

function normalizeMusic(regions: MusicRegion[] | undefined): MusicRegion[] {
  if (!regions) return [];
  return regions
    .filter((r) => Number.isFinite(r.startMs) && Number.isFinite(r.endMs) && r.endMs > r.startMs)
    .map((r) => ({ startMs: Math.max(0, Math.round(r.startMs)), endMs: Math.max(0, Math.round(r.endMs)) }))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

/** True when any music region exactly covers [from, to). */
function musicCovers(music: MusicRegion[], from: number, to: number): boolean {
  return music.some((r) => r.startMs <= from && r.endMs >= to);
}

/**
 * Build the deterministic ducking schedule.
 *
 * Timeline model: music is assumed to play from 0 to the end of the
 * composition (max of last narration end and last music region end). When
 * explicit musicSegments are given, only those regions carry music and
 * regions covered by neither voice nor music emit no ducking entry
 * (silence — nothing to duck).
 *
 * - narration active        -> "narrating"   at -duckedDepthDb dB
 * - gap between voice segments where music is present -> "pause"    at 0 dB
 * - music without narration (lead-in / tail / solo)    -> "music-only" at 0 dB
 */
export function buildDuckingSchedule(input: DuckingInput): DuckingSchedule {
  const raw = (input.voicePlan as DuckingVoicePlan)?.segments ?? (input.voicePlan as DirectedVoicePlan).segments;
  const segments = Array.isArray(raw) ? raw : [];

  // If the caller passed a DirectedVoicePlan (segments carry startIndex, no
  // startMs), derive explicit timing from the director model.
  const isTimingView = segments.length > 0 && Number.isFinite((segments[0] as DuckingVoiceSegment).startMs);
  const narration = isTimingView
    ? normalizeSegments(segments as DuckingVoiceSegment[])
    : voicePlanToTiming(input.voicePlan as DirectedVoicePlan).segments;

  const music = normalizeMusic(input.musicSegments);
  const end =
    music.length > 0
      ? Math.max(...music.map((r) => r.endMs), ...narration.map((s) => s.endMs))
      : narration.length > 0
        ? Math.max(...narration.map((s) => s.endMs))
        : 0;

  const mix: DuckingMix = {
    musicVolume: Number.isFinite(input.musicVolume) ? clamp(input.musicVolume ?? 0.7, 0, 1) : DEFAULT_MIX.musicVolume,
    duckedDepthDb: Number.isFinite(input.duckedDepthDb) ? clamp(Math.abs(input.duckedDepthDb ?? 6), 3, 20) : DEFAULT_MIX.duckedDepthDb,
    fadeInMs: Number.isFinite(input.fadeInMs) ? clamp(Math.round(input.fadeInMs ?? 600), 0, 4000) : DEFAULT_MIX.fadeInMs,
    fadeOutMs: Number.isFinite(input.fadeOutMs) ? clamp(Math.round(input.fadeOutMs ?? 1200), 0, 6000) : DEFAULT_MIX.fadeOutMs,
  };
  const depth = mix.duckedDepthDb;

  // Walk every boundary of narration blocks + music regions so each interval
  // [a, b) has a single stable state. Deterministic for identical inputs.
  const boundaries = new Set<number>([0, end]);
  for (const s of narration) {
    boundaries.add(s.startMs);
    boundaries.add(s.endMs);
  }
  for (const r of music) {
    boundaries.add(r.startMs);
    boundaries.add(r.endMs);
  }
  const points = Array.from(boundaries).sort((a, b) => a - b);

  const events: DuckingEvent[] = [];
  const push = (startMs: number, endMs: number, dB: number, reason: DuckReason) => {
    if (endMs <= startMs) return;
    // Merge with the previous event when same level + reason (adjacent).
    const last = events[events.length - 1];
    if (last && last.endMs === startMs && last.dB === dB && last.reason === reason) {
      last.endMs = endMs;
    } else {
      events.push({ startMs, endMs, dB, reason });
    }
  };

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (b <= a) continue;
    const voiceActive = narration.some((s) => s.startMs <= a && s.endMs >= b);
    if (voiceActive) {
      push(a, b, -depth, "narrating");
      continue;
    }
    const musicHere = music.length === 0 || musicCovers(music, a, b);
    if (!musicHere) continue; // neither voice nor music — silence, nothing to duck.
    const beforeHasVoice = narration.some((s) => s.endMs <= a);
    const afterHasVoice = narration.some((s) => s.startMs >= b);
    push(a, b, 0, beforeHasVoice && afterHasVoice ? "pause" : "music-only");
  }

  return {
    ducking: events,
    mix,
    timingModel: isTimingView
      ? "EXPLICIT: segment startMs/endMs supplied by the caller."
      : "ESTIMATE: narration timing derived from the voice director (chars/sec model).",
  };
}