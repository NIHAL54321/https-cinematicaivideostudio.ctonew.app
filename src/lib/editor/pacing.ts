/**
 * Phase 5 Block 3 — Pacing analysis (deterministic, pure, no IO).
 *
 * Five dimension scores (0-100 each) + one overall reading, computed ONLY from
 * real timeline data — clip spans, track coverage, gains and scene counts. No
 * provider is involved and nothing is estimated from thin air:
 *
 *   narration   — voice-track coverage of the timeline (how much of the picture
 *                 is actually narrated). Scenes that carry narration TEXT but no
 *                 voice clip on the timeline are called out in the reason.
 *   visual      — how many shots the cut holds: video/b-roll/image clips,
 *                 b-roll support and how many distinct sources they come from.
 *   music       — music-bed coverage and energy (the recorded gain).
 *   sceneChange — cadence: the AVERAGE clip length on the video lane, faster
 *                 cadence → higher score (2s shots = 100, 10s shots = 0).
 *   attention   — the weighted blend of the four above plus a hook bonus for a
 *                 short (<3s / <5s) opening shot.
 *
 * `overall` is the weighted blend of all five (PACE_WEIGHTS) and `PACE_BANDS`
 * turns it — and the cadence — into the spec vocabulary
 * ("too slow" | "balanced" | "too fast"). Every score carries a `label` and a
 * human `reason` so the UI never has to invent one.
 *
 * Honesty: the analysis is arithmetic on the timeline, so it can only describe
 * what is there. Where an AI pass (re-timing, rewriting, a real music bed) would
 * move the numbers, `note` says so — nothing is AI-refined and no score is
 * invented.
 *
 * BLOCK 9: the provider half of `note` no longer hard-codes "no provider is
 * connected". That sentence is a claim about THIS SERVER, and on a server whose
 * wired slots are configured it would have printed a falsehood next to
 * `/api/ai/status` saying "connected". It is now DERIVED per call by
 * `paceProviderRequirement()` below (the same `capabilityConnectivity` predicate
 * the status API reports, plus the registry's own env var NAMES) — see the
 * function for the two kinds of clause it is allowed to contain.
 */
import { capabilityConnectivity, capabilityEnvRequirementFor } from "../ai/providers/capability-connectivity";
import { MIN_CLIP_MS, clipsAt, type Clip, type SceneInput, type Timeline } from "./timeline";

export const PACE_DIMENSIONS = ["narration", "visual", "music", "sceneChange", "attention"] as const;
export type PaceDimensionId = (typeof PACE_DIMENSIONS)[number];

export interface PaceDimension {
  /** 0-100. */
  score: number;
  label: string;
  reason: string;
}

export interface PacingAnalysis {
  dimensions: Record<PaceDimensionId, PaceDimension>;
  /** 0-100 weighted blend of the five dimensions. */
  overall: number;
  note: string;
}

/**
 * Band table. `scoreMin/scoreMax` classify the OVERALL score; `cadenceMsMin` is
 * the smallest average video-clip length that still belongs to the band, so the
 * same vocabulary can describe the cadence on its own.
 */
export const PACE_BANDS = [
  {
    band: "too slow",
    scoreMin: 0,
    scoreMax: 39,
    cadenceMsMin: 6500,
    hint: "Drags: long shots and/or thin narration. Tighten the scenes and add coverage.",
  },
  {
    band: "balanced",
    scoreMin: 40,
    scoreMax: 74,
    cadenceMsMin: 2600,
    hint: "Balanced: the cut moves at a watchable cadence with coverage behind it.",
  },
  {
    band: "too fast",
    scoreMin: 75,
    scoreMax: 100,
    cadenceMsMin: 0,
    hint: "Hyperactive: very short shots. Check that each beat is readable before shipping.",
  },
] as const;

export type PaceBand = (typeof PACE_BANDS)[number]["band"];

/** Band for an overall score (0-100). */
export function paceBandOf(score: number): PaceBand {
  const value = Number.isFinite(score) ? Math.round(score) : 0;
  for (const entry of PACE_BANDS) if (value >= entry.scoreMin && value <= entry.scoreMax) return entry.band;
  return value < 0 ? "too slow" : "too fast";
}

/** Band for an average video-clip length in ms (null / empty → "too slow"). */
export function cadenceBandOf(avgClipMs: number | null): PaceBand {
  if (avgClipMs === null || !Number.isFinite(avgClipMs)) return "too slow";
  for (const entry of PACE_BANDS) if (avgClipMs >= entry.cadenceMsMin) return entry.band;
  return "too fast";
}

/** Weights of the overall blend (sum = 1). */
export const PACE_WEIGHTS: Record<PaceDimensionId, number> = {
  narration: 0.3,
  visual: 0.2,
  music: 0.15,
  sceneChange: 0.2,
  attention: 0.15,
};

/** Hook bonus thresholds for the attention dimension (ms). */
export const HOOK_STRONG_MS = 3000;
export const HOOK_OK_MS = 5000;
export const HOOK_STRONG_BONUS = 10;
export const HOOK_OK_BONUS = 5;

/** Cadence anchors: a 2s average = 100, a 10s average = 0. */
export const CADENCE_FAST_MS = 2000;
export const CADENCE_SLOW_MS = 10_000;

/** Scores below this are reported as the weak spots an AI pass could help with. */
export const WEAK_DIMENSION_SCORE = 60;

function clampScore(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.round(Math.max(0, Math.min(100, n)));
}

function spanOf(clip: Clip): number {
  return clip.endMs - clip.startMs;
}

/** Union of clip spans (overlaps counted once). */
function coveredMs(clips: Clip[]): number {
  const spans = clips
    .filter((c) => c.endMs > c.startMs)
    .map((c) => [c.startMs, c.endMs] as [number, number])
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cursor = Number.NEGATIVE_INFINITY;
  for (const [start, end] of spans) {
    if (start > cursor) {
      total += end - start;
      cursor = end;
    } else if (end > cursor) {
      total += end - cursor;
      cursor = end;
    }
  }
  return total;
}

function pct(n: number): number {
  return Math.round(n * 100);
}

function seconds(ms: number): number {
  return Math.round(ms / 100) / 10;
}

function averageSpanMs(clips: Clip[]): number | null {
  if (clips.length === 0) return null;
  return Math.round(clips.reduce((sum, c) => sum + spanOf(c), 0) / clips.length);
}

function hasText(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/* ------------------------------------------------------------------ */
/* Dimensions                                                          */
/* ------------------------------------------------------------------ */

function narrationDimension(timeline: Timeline, scenes: SceneInput[], durationMs: number): PaceDimension {
  const voice = clipsAt(timeline, "voice");
  const coverage = durationMs > 0 ? Math.min(1, coveredMs(voice) / durationMs) : 0;
  const score = clampScore(coverage * 100);
  const label = voice.length === 0 ? "silent" : score >= 85 ? "wall-to-wall" : score >= 50 ? "well covered" : "sparse";
  const silentScenes: string[] = [];
  for (const clip of clipsAt(timeline, "video")) {
    if (!clip.sceneId || silentScenes.includes(clip.sceneId)) continue;
    const row = scenes.find((s) => s.id === clip.sceneId);
    if (!row || !hasText(row.narration)) continue;
    const hasVoice = voice.some((c) => c.sceneId === clip.sceneId);
    if (!hasVoice) silentScenes.push(clip.sceneId);
  }
  const detail =
    silentScenes.length > 0
      ? ` ${silentScenes.length} scene(s) have narration text but no voice clip (${silentScenes.join(", ")}).`
      : "";
  const reason =
    (voice.length === 0
      ? `No voice clip is on the timeline, so 0% of the ${seconds(durationMs)}s cut is narrated.`
      : `${voice.length} voice clip(s) cover ${pct(coverage)}% of the ${seconds(durationMs)}s cut.`) + detail;
  return { score, label, reason };
}

function visualDimension(timeline: Timeline): PaceDimension {
  const video = clipsAt(timeline, "video");
  const broll = clipsAt(timeline, "broll");
  const images = clipsAt(timeline, "images");
  const shots = video.length + broll.length + images.length;
  const sources = new Set<string>();
  for (const clip of [...video, ...broll, ...images]) {
    const prefix = (clip.sourceRef ?? "manual").split(":")[0] || "manual";
    sources.add(prefix);
  }
  const score = clampScore(shots * 10 + broll.length * 5 + sources.size * 5);
  const label = score >= 70 ? "rich" : score >= 40 ? "adequate" : "thin";
  const reason =
    shots === 0
      ? "No video, b-roll or image clip is on the timeline yet."
      : `${video.length} video, ${broll.length} b-roll and ${images.length} image clip(s) across ${sources.size} distinct source kind(s).`;
  return { score, label, reason };
}

function musicDimension(timeline: Timeline, durationMs: number): PaceDimension {
  const music = clipsAt(timeline, "music");
  if (music.length === 0) {
    return {
      score: 0,
      label: "no music",
      reason: "The timeline has no music-bed clip, so the score is 0 — nothing is assumed.",
    };
  }
  const coverage = durationMs > 0 ? Math.min(1, coveredMs(music) / durationMs) : 0;
  const gains = music.map((c) => Math.max(0, Math.min(1, c.gain ?? 1)));
  const energy = gains.reduce((sum, g) => sum + g, 0) / gains.length;
  const score = clampScore(coverage * 70 + energy * 30);
  const label = score >= 85 ? "front and centre" : score >= 55 ? "balanced bed" : score >= 25 ? "light bed" : "barely there";
  const reason =
    `${music.length} music clip(s) cover ${pct(coverage)}% of the cut at an average gain of ${Math.round(energy * 100) / 100}.`;
  return { score, label, reason };
}

function sceneChangeDimension(timeline: Timeline): { dimension: PaceDimension; avgClipMs: number | null } {
  const video = clipsAt(timeline, "video");
  const avg = averageSpanMs(video);
  if (avg === null) {
    return {
      dimension: { score: 0, label: "no scenes", reason: "The video lane is empty, so there is no cadence to measure." },
      avgClipMs: null,
    };
  }
  const score = clampScore(((CADENCE_SLOW_MS - avg) / (CADENCE_SLOW_MS - CADENCE_FAST_MS)) * 100);
  const band = cadenceBandOf(avg);
  const label = band === "too fast" ? "rapid" : score >= 55 ? "brisk" : score >= 30 ? "steady" : "slow";
  const shortest = Math.min(...video.map(spanOf));
  const longest = Math.max(...video.map(spanOf));
  const reason =
    `${video.length} video clip(s) average ${avg}ms (${band}); shortest ${Math.max(MIN_CLIP_MS, shortest)}ms, longest ${longest}ms.`;
  return { dimension: { score, label, reason }, avgClipMs: avg };
}

function attentionDimension(
  base: Omit<Record<PaceDimensionId, PaceDimension>, "attention">,
  timeline: Timeline,
): PaceDimension {
  const video = clipsAt(timeline, "video");
  const firstSpan = video.length > 0 ? spanOf(video[0]) : null;
  const bonus = firstSpan === null ? 0 : firstSpan <= HOOK_STRONG_MS ? HOOK_STRONG_BONUS : firstSpan <= HOOK_OK_MS ? HOOK_OK_BONUS : 0;
  const score = clampScore(
    0.35 * base.narration.score + 0.25 * base.visual.score + 0.15 * base.music.score + 0.25 * base.sceneChange.score + bonus,
  );
  const label = score >= 70 ? "gripping" : score >= 45 ? "steady" : "weak";
  const reason =
    `Blend of narration (${base.narration.score}), visuals (${base.visual.score}), music (${base.music.score}) and cadence ` +
    `(${base.sceneChange.score})` +
    (firstSpan === null
      ? " with no opening shot to hook from."
      : ` plus a +${bonus} hook bonus for a ${firstSpan}ms opening shot.`);
  return { score, label, reason };
}

/* ------------------------------------------------------------------ */
/* Analysis                                                            */
/* ------------------------------------------------------------------ */

/**
 * The capabilities a REAL AI pacing pass would need, named the way the provider
 * registry names them. The note's own parenthetical maps onto them one for one:
 * "re-timing" is an encode/processing job (`video_enhancement`), "re-writing" is
 * `script_generation` and "a real music bed" is `music_generation`. Written as
 * literals so this module stays free of the orchestrator.
 */
export const PACE_AI_CAPABILITIES = ["video_enhancement", "script_generation", "music_generation"] as const;

/**
 * The honest provider half of the pacing note, DERIVED on every call — never a
 * fixed claim about this machine.
 *
 * Every clause is one of exactly two kinds, and neither can rot:
 *   - a LIVE fact, from `capabilityConnectivity` — literally the status API's own
 *     predicate (configured AND wired), so this note and `GET /api/ai/status`
 *     cannot disagree;
 *   - a CODE fact — this module imports no orchestrator and has no call site that
 *     dispatches, so nothing here is AI-refined, connected or not.
 * 'no key for a wired slot' is therefore only ever said when no wired slot IS
 * configured, and the operator requirement names env vars straight from the
 * registry (names only, never values).
 */
export function paceProviderRequirement(): { connected: boolean; note: string } {
  const connectivity = PACE_AI_CAPABILITIES.map((c) => capabilityConnectivity(c));
  const connected = connectivity.every((c) => c.connected);
  const live = `Right now ${connectivity.map((c) => `${c.capability}: ${c.reason}`).join("; and ")}.`;
  const head = connected
    ? "An AI pass (re-timing, re-writing, a generated music bed) would be served by a provider that is configured " +
      "AND wired for every capability it needs " +
      `(${connectivity.map((c) => `${c.capability}: ${c.connectedSlots.join("+")}`).join(", ")}), so a request to one ` +
      "would genuinely be attempted."
    : "An AI pass (re-timing, re-writing, a generated music bed) would need a provider that is configured AND wired " +
      "for every capability it needs.";
  return {
    connected,
    note:
      `${head} ${live} ${capabilityEnvRequirementFor([...PACE_AI_CAPABILITIES])} ` +
      "This module has no code path that dispatches to a provider, so no score here is AI-refined and none is invented.",
  };
}

/**
 * Deterministic pacing report for a timeline. `scenes` (optional) is used only
 * to spot narration text that never made it onto the voice lane.
 */
export function analyzePacing(timeline: Timeline, scenes: SceneInput[] = []): PacingAnalysis {
  const durationMs = Math.max(0, timeline.durationMs);
  const narration = narrationDimension(timeline, Array.isArray(scenes) ? scenes : [], durationMs);
  const visual = visualDimension(timeline);
  const music = musicDimension(timeline, durationMs);
  const { dimension: sceneChange, avgClipMs } = sceneChangeDimension(timeline);
  const attention = attentionDimension({ narration, visual, music, sceneChange }, timeline);

  const dimensions: Record<PaceDimensionId, PaceDimension> = { narration, visual, music, sceneChange, attention };
  const overall = clampScore(
    PACE_DIMENSIONS.reduce((sum, id) => sum + PACE_WEIGHTS[id] * dimensions[id].score, 0),
  );
  const band = paceBandOf(overall);
  const weak = PACE_DIMENSIONS.filter((id) => dimensions[id].score < WEAK_DIMENSION_SCORE);
  // BLOCK 9 — the provider half is DERIVED here, per call, and appended to each
  // branch. The three branches say what THIS ENGINE did or did not do (a code
  // fact: it performs no re-timing, writes no score); `paceProviderRequirement()`
  // says what is connected right now (a live fact, from the same predicate
  // /api/ai/status reports). Neither sentence can be false on a keyed server.
  const provider = paceProviderRequirement();
  const note =
    timeline.clips.length === 0
      ? "The timeline is empty, so every dimension reads 0. Nothing was estimated. " + provider.note
      : weak.length === 0
        ? `All five dimensions read ${WEAK_DIMENSION_SCORE}+ (overall ${overall}, "${band}"). These numbers are arithmetic on the ` +
          "timeline itself, so nothing was re-timed and no score was invented. " +
          provider.note
        : `Overall ${overall} ("${band}") — weakest dimension(s): ${weak
            .map((id) => `${id} (${dimensions[id].score})`)
            .join(", ")}. Values are arithmetic on the timeline itself, so nothing was refined or invented. ` +
          provider.note;
  return { dimensions, overall, note };
}
