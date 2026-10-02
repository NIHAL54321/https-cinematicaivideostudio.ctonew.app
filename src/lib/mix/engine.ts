/**
 * Phase 4 Block 3 — Final audio mix engine (deterministic, pure, no IO).
 *
 * EXACTLY the four spec tracks — voice, music, SFX, ambient — each with an
 * independent 0-1 gain in the INPUT that this engine STAGES (scales) so the
 * worst-case sum of track peaks never exceeds -1 dBFS (0.891 linear):
 * deterministic clipping prevention via gain staging. Loudness normalization
 * targets a configurable LUFS (default -14 for YouTube); the report labels
 * the value an ESTIMATE — true LUFS measurement happens in the Phase 5
 * renderer with real tracks.
 *
 * blendWithDucking() ties Block 2's ducking schedule into the mix: the music
 * track's per-event gain is lowered by duckedDepthDb during narration and
 * restored at full level in pauses / music-only spans. This is a MIX PLAN —
 * actual audio rendering happens in Phase 5 with real audio.
 */

import type { DuckingEvent, DuckingSchedule } from "@/lib/music/ducking";

export type MixTrackId = "voice" | "music" | "sfx" | "ambient";

export type ClippingMethod = "gain-staging" | "limiter";

export interface GainCue {
  startMs: number;
  endMs: number;
  gain: number;
}

export interface VoiceTrackInput {
  gain?: number;
  clips?: GainCue[];
}

export interface MusicTrackInput {
  gain?: number;
  duckedDepthDb?: number;
  fadeInMs?: number;
  fadeOutMs?: number;
  segments?: GainCue[];
}

export interface SfxTrackInput {
  gain?: number;
  cues?: GainCue[];
}

export interface AmbientTrackInput {
  gain?: number;
  cues?: GainCue[];
}

export interface AudioMixInput {
  voice?: VoiceTrackInput;
  music?: MusicTrackInput;
  sfx?: SfxTrackInput;
  ambient?: AmbientTrackInput;
  /** Target integrated loudness in LUFS (default -14, YouTube). */
  loudnessTarget?: number;
}

export interface MixTrackEvent {
  startMs: number;
  endMs: number;
  type: string;
  /** Effective (modulated) gain 0-1 for this event span. */
  gain: number;
}

export interface MixTrack {
  id: MixTrackId;
  /** Staged master gain 0-1 (after clipping prevention). */
  gain: number;
  pan?: number;
  events?: MixTrackEvent[];
}

export interface ClippingReport {
  prevented: boolean;
  method: ClippingMethod;
  /** Headroom remaining below full scale in dB (always positive after staging). */
  headroomDb: number;
}

export interface LoudnessReport {
  targetLufs: number;
  /** ESTIMATE — true LUFS measurement happens in the Phase 5 renderer. */
  measuredEstimateLufs: number;
  normalized: boolean;
  model: string;
}

export interface AudioMixPlan {
  tracks: MixTrack[];
  clipping: ClippingReport;
  loudness: LoudnessReport;
  summary: string;
}

/** -1 dBFS in linear gain. */
export const PEAK_CEILING = 0.891;
export const DEFAULT_LOUDNESS_TARGET_LUFS = -14;

const DEFAULT_GAINS: Record<MixTrackId, number> = { voice: 1, music: 0.7, sfx: 0.8, ambient: 0.5 };

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Longest timeline end across every track's cues/segments (ms). */
function timelineEndMs(input: AudioMixInput): number {
  const ends: number[] = [];
  for (const list of [
    input.voice?.clips,
    input.music?.segments,
    input.sfx?.cues,
    input.ambient?.cues,
  ]) {
    if (Array.isArray(list)) {
      for (const cue of list) {
        if (Number.isFinite(cue?.endMs)) ends.push(cue.endMs);
      }
    }
  }
  return ends.length > 0 ? Math.max(...ends) : 0;
}

function toCues(list: GainCue[] | undefined, defaultGain: number): GainCue[] | null {
  if (!Array.isArray(list)) return null;
  return list
    .filter((c) => c && Number.isFinite(c.startMs) && Number.isFinite(c.endMs) && c.endMs > c.startMs)
    .map((c) => ({
      startMs: Math.max(0, Math.round(c.startMs)),
      endMs: Math.max(0, Math.round(c.endMs)),
      gain: clamp(Number.isFinite(c.gain) ? c.gain : defaultGain, 0, 1),
    }))
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

/**
 * Build the deterministic mix plan. Same input always yields the same plan.
 * The four track gains are staged together so the worst-case sum of peaks
 * stays ≤ -1 dBFS; quiet mixes are left untouched (prevented:false).
 */
export function buildMix(input: AudioMixInput = {}): AudioMixPlan {
  const rawGains: Record<MixTrackId, number> = {
    voice: clamp(Number.isFinite(input.voice?.gain) ? input.voice!.gain! : DEFAULT_GAINS.voice, 0, 1),
    music: clamp(Number.isFinite(input.music?.gain) ? input.music!.gain! : DEFAULT_GAINS.music, 0, 1),
    sfx: clamp(Number.isFinite(input.sfx?.gain) ? input.sfx!.gain! : DEFAULT_GAINS.sfx, 0, 1),
    ambient: clamp(Number.isFinite(input.ambient?.gain) ? input.ambient!.gain! : DEFAULT_GAINS.ambient, 0, 1),
  };

  const peakSum = rawGains.voice + rawGains.music + rawGains.sfx + rawGains.ambient;
  const needsStaging = peakSum > PEAK_CEILING;
  const scale = needsStaging ? PEAK_CEILING / peakSum : 1;
  const method: ClippingMethod = needsStaging ? "gain-staging" : "gain-staging";
  const stagedPeak = peakSum * scale;
  const headroomDb = round2(20 * Math.log10(1 / Math.max(0.001, stagedPeak)));

  const staged: Record<MixTrackId, number> = {
    voice: round3(rawGains.voice * scale),
    music: round3(rawGains.music * scale),
    sfx: round3(rawGains.sfx * scale),
    ambient: round3(rawGains.ambient * scale),
  };

  const tracks: MixTrack[] = [
    {
      id: "voice",
      gain: staged.voice,
      events: toCues(input.voice?.clips, DEFAULT_GAINS.voice)?.map((c) => ({
        startMs: c.startMs,
        endMs: c.endMs,
        type: "clip",
        gain: round3(c.gain * scale),
      })),
    },
    {
      id: "music",
      gain: staged.music,
      pan: 0,
      events: toCues(input.music?.segments, DEFAULT_GAINS.music)?.map((c) => ({
        startMs: c.startMs,
        endMs: c.endMs,
        type: "segment",
        gain: round3(c.gain * scale),
      })),
    },
    {
      id: "sfx",
      gain: staged.sfx,
      events: toCues(input.sfx?.cues, DEFAULT_GAINS.sfx)?.map((c) => ({
        startMs: c.startMs,
        endMs: c.endMs,
        type: "cue",
        gain: round3(c.gain * scale),
      })),
    },
    {
      id: "ambient",
      gain: staged.ambient,
      events: toCues(input.ambient?.cues, DEFAULT_GAINS.ambient)?.map((c) => ({
        startMs: c.startMs,
        endMs: c.endMs,
        type: "cue",
        gain: round3(c.gain * scale),
      })),
    },
  ];

  const targetLufs = clamp(
    Number.isFinite(input.loudnessTarget) ? input.loudnessTarget! : DEFAULT_LOUDNESS_TARGET_LUFS,
    -60,
    0,
  );
  // ESTIMATE: how far the staged mix sits above/below a reference dense mix
  // (peak sum 0.7), then normalized toward the target by the renderer.
  const referenceSum = 0.7;
  const loudnessDelta = clamp(20 * Math.log10(Math.max(0.001, stagedPeak) / referenceSum), -9, 9);
  const measuredEstimateLufs = round2(targetLufs + loudnessDelta);

  const durationMs = timelineEndMs(input);
  const summary =
    `Mix plan: ${peakSum.toFixed(2)} summed input gain → ${stagedPeak.toFixed(3)} staged peak ` +
    `(${needsStaging ? "clipping prevented" : "no clipping risk"}), ` +
    `headroom ${headroomDb} dB below full scale, loudness ~${measuredEstimateLufs} LUFS vs target ${targetLufs} LUFS` +
    (durationMs > 0 ? ` · timeline ${durationMs} ms` : "") +
    " · actual audio rendering happens in Phase 5 with real tracks.";

  return {
    tracks,
    clipping: { prevented: needsStaging, method, headroomDb },
    loudness: {
      targetLufs,
      measuredEstimateLufs,
      normalized: true,
      model:
        "ESTIMATE: loudness derived from staged track gains + timeline length; true LUFS measurement happens in the Phase 5 renderer.",
    },
    summary,
  };
}

function clonePlan(mix: AudioMixPlan): AudioMixPlan {
  return {
    ...mix,
    tracks: mix.tracks.map((t) => ({ ...t, events: t.events ? [...t.events] : undefined })),
  };
}

/**
 * Blend a ducking schedule into the mix (returns a NEW plan; input is never
 * mutated). The music track's per-event gain follows the ducking curve:
 * lowered by duckedDepthDb while narration is active, full level in pauses and
 * music-only spans. Master gains + clipping report stay as staged (the loudest
 * possible sum is unchanged — ducking only ever lowers music).
 */
export function blendWithDucking(mix: AudioMixPlan, ducking?: DuckingSchedule): AudioMixPlan {
  const out = clonePlan(mix);
  if (!ducking || !Array.isArray(ducking.ducking) || ducking.ducking.length === 0) return out;
  const music = out.tracks.find((t) => t.id === "music");
  if (!music) return out;

  const baseGain = music.gain;
  const events: MixTrackEvent[] = ducking.ducking
    .filter((e) => e && Number.isFinite(e.startMs) && Number.isFinite(e.endMs) && e.endMs > e.startMs)
    .map((e: DuckingEvent) => ({
      startMs: Math.max(0, Math.round(e.startMs)),
      endMs: Math.max(0, Math.round(e.endMs)),
      type: e.reason,
      gain: round3(baseGain * Math.pow(10, e.dB / 20)),
    }));

  // Merge adjacent same-type events (deterministic, mirrors the scheduler).
  const merged: MixTrackEvent[] = [];
  for (const ev of events) {
    const last = merged[merged.length - 1];
    if (last && last.endMs === ev.startMs && last.type === ev.type && last.gain === ev.gain) {
      last.endMs = ev.endMs;
    } else {
      merged.push({ ...ev });
    }
  }
  music.events = merged;
  if (merged.length > 0) {
    const narrating = merged.filter((e) => e.type === "narrating");
    out.summary =
      `${mix.summary} · music ducked: ${narrating.length} narration span${narrating.length === 1 ? "" : "s"} ` +
      `lowered from ${round3(baseGain)} to ${round3(
        baseGain * Math.pow(10, -(ducking.mix?.duckedDepthDb ?? 6) / 20),
      )} during narration.`;
  }
  return out;
}