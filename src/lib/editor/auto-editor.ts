/**
 * Phase 5 Block 3 — AI Auto-Editor commands (deterministic, pure, no IO).
 *
 * The spec's twelve one-click "make it better" commands. Every command returns
 * the SAME envelope (mirroring `./scenes`, the Block 2 scene controls):
 *
 *   { command, changed, changelist, timeline?, provider?, plan?, note? }
 *
 *   - the deterministic part is a REAL, PURE edit of the timeline (tightened
 *     durations, transitions, grade markers, b-roll inserts, subtitle styles,
 *     gain normalisation, gap closing, …) and is always reported line by line
 *     in `changelist`,
 *   - the AI part is NEVER fabricated: where a command needs an image / voice /
 *     LLM provider it returns an HONEST gate
 *     (`{ connected: false, requiredEnv, envHint, note }` — env var NAMES only,
 *     never values) plus a `plan` describing exactly what WOULD be produced.
 *     Nothing is invented, no media is mocked.
 *
 * Determinism: same input → byte-identical output. No randomness, no clock, no
 * IO. `timelinesEqual` decides `changed`; when nothing changed the SAME timeline
 * reference is handed back (and, for pure commands, the changelist is empty
 * because nothing happened — plan/blocked lines are still reported, they are
 * phrased as "plan only" and never claim to have happened).
 *
 * Idempotency (documented per command):
 *   - NORMALISING commands are idempotent: `moreCinematic`, `betterPacing`,
 *     `betterVisuals`, `betterVoiceover`, `strongerHook`, `moreBroll`,
 *     `reduceRepetition`, `professional`, `documentary`, `youtubeOptimized`
 *     reach a fixed point — running them twice yields a structurally identical
 *     timeline.
 *   - The relative INTENSIFYING commands `moreEmotional` (and `documentary`'s
 *     duration step, which is marker-guarded) are "more of the same": calling
 *     them again makes the timeline a little longer. `intensity` (0-100,
 *     default 100) scales how much is applied.
 *
 * Documented conventions used while editing (the Clip fields do not change —
 * Block 3 does not touch ./timeline):
 *   - scene-derived clips move together: shifting a scene moves every clip that
 *     carries its `sceneId`; manual clips (no sceneId) are pinned. A gap on the
 *     video lane is only closed when the whole trailing chain is scene-derived,
 *     so no manual clip is ever overlapped.
 *   - captions are picture-bound: when a command shortens a shot, that scene's
 *     caption clips are pulled inside the new picture box (never outside it).
 *     The VOICE lane is not trimmed by these commands — narration timing is owned
 *     by `betterPacing` / `betterVoiceover` (and `documentary` adds voice clips).
 *   - `grade` records the colour-grade marker a command wants (`cinematic`,
 *     `color-accurate`); Block 4 renders it.
 *   - `subtitleStyle` records the caption style (`bold`, `documentary`).
 *   - `sourceRef` records provenance: `scene:<id>` for scene-derived inserts,
 *     `visual:scene:<id>` for the b-roll a visual prompt owns, `hook:title` for
 *     the hook title card, `subtitle:safe-margin` for captions that were moved
 *     inside the video-safe area (see `@/lib/subtitles` SUBTITLE_SAFE_MARGINS).
 */
import {
  EditorError,
  MIN_CLIP_MS,
  copyClip,
  nextClipId,
  rebuildTimeline,
  timelinesEqual,
  type Clip,
  type SceneInput,
  type Timeline,
} from "./timeline";
import {
  defaultDurationMs,
  describeTransition,
  setTransition,
  transitionDef,
  type TransitionKind,
} from "./transitions";
import { capabilityEnvHint, capabilityEnvNames, capabilityEnvRequirement } from "../ai/providers/capability-env";
import type { ProviderGate } from "./scenes";

/* ------------------------------------------------------------------ */
/* Command catalog (client-safe metadata)                              */
/* ------------------------------------------------------------------ */

export const AUTO_EDITOR_COMMANDS = [
  "moreCinematic",
  "moreEmotional",
  "moreViral",
  "betterPacing",
  "betterVisuals",
  "betterVoiceover",
  "strongerHook",
  "moreBroll",
  "reduceRepetition",
  "professional",
  "documentary",
  "youtubeOptimized",
] as const;

export type AutoEditorCommand = (typeof AUTO_EDITOR_COMMANDS)[number];

export interface AutoEditorMeta {
  id: AutoEditorCommand;
  label: string;
  hint: string;
}

/** UI metadata for the twelve one-click commands. */
export const AUTO_EDITOR_META: readonly AutoEditorMeta[] = [
  {
    id: "moreCinematic",
    label: "More Cinematic",
    hint: "Tighten over-long scenes into a 4-8s band, soft dissolves at scene boundaries, cinematic grade marker.",
  },
  {
    id: "moreEmotional",
    label: "More Emotional",
    hint: "Lengthen the closing scene, stretch the dissolves, pull the music bed down to a calmer energy target.",
  },
  {
    id: "moreViral",
    label: "More Viral",
    hint: "Cut the first shot to 3s or less, hard cut out of it, bold hook captions.",
  },
  {
    id: "betterPacing",
    label: "Better Pacing",
    hint: "Match each scene's length to its voice clip and close the gaps on the video lane.",
  },
  {
    id: "betterVisuals",
    label: "Better Visuals",
    hint: "B-roll for the scenes that have a visual prompt; prompts still to generate are planned (image provider gate).",
  },
  {
    id: "betterVoiceover",
    label: "Better Voiceover",
    hint: "Normalise the voice-clip gain; missing narration is planned (voice provider gate).",
  },
  {
    id: "strongerHook",
    label: "Stronger Hook",
    hint: "Shorten the opening shot, bold hook captions and a title card on the timeline.",
  },
  {
    id: "moreBroll",
    label: "More B-roll",
    hint: "Cut b-roll inserts (1.5-2.5s) in at every scene boundary.",
  },
  {
    id: "reduceRepetition",
    label: "Reduce Repetition",
    hint: "Shorten a scene that repeats the one before it (near-duplicate titles/narration).",
  },
  {
    id: "professional",
    label: "Professional",
    hint: "Colour-accurate grade marker and one consistent dissolve instead of mixed transitions.",
  },
  {
    id: "documentary",
    label: "Documentary",
    hint: "Longer scenes, long dissolves, documentary captions and voice clips for narrated scenes.",
  },
  {
    id: "youtubeOptimized",
    label: "YouTube Optimized",
    hint: "3s hook, safe subtitle margins, gaps tightened; title/description ideas are planned (LLM gate).",
  },
];

export function isAutoEditCommand(v: unknown): v is AutoEditorCommand {
  return typeof v === "string" && (AUTO_EDITOR_COMMANDS as readonly string[]).includes(v);
}

/* ------------------------------------------------------------------ */
/* Tunables (documented, deterministic)                                */
/* ------------------------------------------------------------------ */

/** Cinematic scene band: over-long scenes are tightened towards it. */
export const CINEMATIC_MIN_SCENE_MS = 4000;
export const CINEMATIC_MAX_SCENE_MS = 8000;
/** A hook shot may not be longer than this. */
export const HOOK_MAX_MS = 3000;
/** At least this many cut edges must pass between two soft blends. */
export const BLEND_MIN_CUTS_BETWEEN = 2;
/** "More emotional": the closing scene grows by this factor (at intensity 100). */
export const EMOTIONAL_LAST_SCENE_FACTOR = 1.25;
/** …and by at least this much. */
export const EMOTIONAL_MIN_EXTRA_MS = 1000;
/** The (0-100) music-energy target the command asks the music engine for. */
export const EMOTIONAL_MUSIC_ENERGY_TARGET = 30;
/** 0-100 energy → music-bed gain, the formula `./scenes` uses (0.2 + 0.3·e). */
export const EMOTIONAL_MUSIC_GAIN = 0.29;
/** "Documentary": scene length factor (at intensity 100) + its caption marker. */
export const DOCUMENTARY_SCENE_FACTOR = 1.2;
export const DOCUMENTARY_SUBTITLE_STYLE = "documentary";
/** Grade markers the commands record (Block 4 renders them). */
export const CINEMATIC_GRADE = "cinematic";
export const PROFESSIONAL_GRADE = "color-accurate";
/** Near-duplicate detection for `reduceRepetition`. */
export const REPETITION_SIMILARITY_THRESHOLD = 0.55;
export const REPETITION_SHORTEN_FACTOR = 0.6;
export const REPETITION_MIN_MS = 1000;
/** B-roll inserts rotate through these spans (spec: 1.5-2.5s). */
export const BROLL_INSERT_DURATIONS_MS: readonly number[] = [1500, 2000, 2500];
/** Normalised voice-clip gain. */
export const VOICE_GAIN_TARGET = 1;
/** Provenance markers written into `sourceRef`. */
export const BROLL_SOURCE_PREFIX = "scene:";
export const VISUAL_BROLL_PREFIX = "visual:scene:";
export const HOOK_TEXT_SOURCE_REF = "hook:title";
export const SAFE_SUBTITLE_MARGIN_REF = "subtitle:safe-margin";
/** Default intensity for the commands that accept one. */
export const DEFAULT_INTENSITY = 100;

/**
 * Provider env var NAMES (never values) that would enable the AI half of a
 * command. Derived from the provider env-key registry plus the capability→
 * provider slot table (`capability-env`), never hard-coded: each list is the set
 * of names some code actually reads for that capability. Where the derived list
 * is empty no provider slot serves the capability, and the gate then names
 * nothing at all rather than a placeholder.
 */
export const IMAGE_PROVIDER_ENV_NAMES = capabilityEnvNames("image_generation");
export const VOICE_PROVIDER_ENV_NAMES = capabilityEnvNames("voice_generation");
export const LLM_PROVIDER_ENV_NAMES = capabilityEnvNames("seo_generation");

/**
 * The auto editor wires NO provider: every gated command reports the honest
 * "Provider Not Connected" state. This is the single switch a later block flips
 * when it connects a real provider (the gate shape stays identical).
 */
export const AUTO_EDITOR_PROVIDER_CONNECTED = false;

/* ------------------------------------------------------------------ */
/* Result envelope                                                     */
/* ------------------------------------------------------------------ */

export interface AutoEditArgs {
  /** 0-100, how strongly to apply the relative commands. Default 100. */
  intensity?: number | null;
}

export interface AutoEditorResult {
  command: AutoEditorCommand;
  changed: boolean;
  changelist: string[];
  timeline?: Timeline;
  provider?: ProviderGate;
  plan?: Record<string, unknown>;
  note?: string;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function r(v: number): number {
  return Math.round(v);
}

function spanOf(clip: Clip): number {
  return clip.endMs - clip.startMs;
}

function resolveIntensity(args: AutoEditArgs | undefined): number {
  const raw = args?.intensity;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_INTENSITY;
  return Math.round(Math.max(0, Math.min(100, raw)));
}

/** Scale a documented factor (given at intensity 100) by the intensity. */
function scaleFactor(factor: number, intensity: number): number {
  return 1 + (factor - 1) * (intensity / 100);
}

/**
 * Honest provider gate: `connected` mirrors AUTO_EDITOR_PROVIDER_CONNECTED,
 * `requiredEnv` lists env var NAMES only (never values) and the note says what
 * was NOT produced.
 */
function providerGate(capability: string, what: string): ProviderGate {
  const requiredEnv = capabilityEnvNames(capability);
  return {
    capability,
    connected: AUTO_EDITOR_PROVIDER_CONNECTED,
    requiredEnv,
    envHint: capabilityEnvHint(capability),
    note:
      `${what} needs a connected provider. ${capability} is not wired into the auto editor, so nothing was generated ` +
      `and no provider output was invented. ` +
      capabilityEnvRequirement(capability),
  };
}

function clipOf(clips: Clip[], id: string): Clip | null {
  return clips.find((c) => c.id === id) ?? null;
}

function setSpan(clips: Clip[], id: string, startMs: number, endMs: number): void {
  const clip = clipOf(clips, id);
  if (!clip) return;
  const start = Math.max(0, r(startMs));
  clip.startMs = start;
  clip.endMs = Math.max(start + MIN_CLIP_MS, r(endMs));
}

/** The video lane as an ordered, numeric snapshot (ids + spans only). */
interface LaneEntry {
  id: string;
  sceneId?: string;
  startMs: number;
  endMs: number;
}

function laneSnapshot(clips: Clip[]): LaneEntry[] {
  return clips
    .filter((c) => c.trackId === "video")
    .sort((a, b) => a.startMs - b.startMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((c) => ({ id: c.id, sceneId: c.sceneId, startMs: c.startMs, endMs: c.endMs }));
}

/**
 * Move every clip of every scene AFTER `lane[index]` by `deltaMs` (negative =
 * earlier), keeping each clip's own span. Manual clips (no sceneId) are pinned —
 * which is why gap closing refuses to run over a manual clip (see below).
 */
function shiftScenesAfter(clips: Clip[], lane: LaneEntry[], index: number, deltaMs: number): number {
  if (deltaMs === 0) return 0;
  const ids = new Set<string>();
  for (let j = index + 1; j < lane.length; j += 1) {
    const sceneId = lane[j].sceneId;
    if (sceneId) ids.add(sceneId);
  }
  if (ids.size === 0) return 0;
  let moved = 0;
  for (const clip of clips) {
    if (!clip.sceneId || !ids.has(clip.sceneId)) continue;
    const span = spanOf(clip);
    clip.startMs = Math.max(0, r(clip.startMs + deltaMs));
    clip.endMs = clip.startMs + span;
    moved += 1;
  }
  return moved;
}

/**
 * Close every positive gap on the video lane by pulling the following scenes
 * earlier. A gap is only touched when the whole trailing chain is scene-derived
 * (`sceneId` present) — a manual video clip is never moved or overlapped.
 */
function closeVideoLaneGaps(clips: Clip[], log: string[]): number {
  const lane = laneSnapshot(clips);
  let total = 0;
  for (let i = 0; i + 1 < lane.length; i += 1) {
    const trailing = lane.slice(i + 1);
    if (trailing.some((e) => !e.sceneId)) continue; // a pinned manual clip follows
    const gap = lane[i + 1].startMs - lane[i].endMs;
    if (gap <= 0) continue;
    const moved = shiftScenesAfter(clips, lane, i, -gap);
    if (moved === 0) continue;
    for (let j = i + 1; j < lane.length; j += 1) {
      lane[j].startMs -= gap;
      lane[j].endMs -= gap;
    }
    log.push(`video: closed a ${gap}ms gap before ${lane[i + 1].id} — ${moved} clip(s) of the following scene(s) pulled earlier.`);
    total += gap;
  }
  return total;
}

/**
 * Keep a scene's caption clips inside its picture box.
 * Captions are picture-bound: when a command shortens a shot the captions must
 * not overhang it. The VOICE lane is deliberately never trimmed — audio is
 * re-derived by `betterPacing` / `betterVoiceover`, not by cutting a clip.
 */
function trimCaptionsToBox(
  clips: Clip[],
  sceneId: string,
  boxStartMs: number,
  boxEndMs: number,
  log: string[],
  why: string,
): number {
  let trimmed = 0;
  for (const clip of clips) {
    if (clip.sceneId !== sceneId || clip.trackId !== "subtitles") continue;
    if (clip.startMs >= boxStartMs && clip.endMs <= boxEndMs) continue; // already inside
    log.push(`subtitles: ${clip.id} ${clip.startMs}→${clip.endMs}ms → ${boxStartMs}→${boxEndMs}ms (${why}).`);
    setSpan(clips, clip.id, boxStartMs, boxEndMs);
    trimmed += 1;
  }
  return trimmed;
}

/** Extend one scene's video clip by `deltaMs`, pushing the following scenes later. */
function extendSceneBy(clips: Clip[], lane: LaneEntry[], index: number, deltaMs: number): number {
  if (deltaMs <= 0) return 0;
  shiftScenesAfter(clips, lane, index, deltaMs);
  for (let j = index + 1; j < lane.length; j += 1) {
    lane[j].startMs += deltaMs;
    lane[j].endMs += deltaMs;
  }
  const clip = clipOf(clips, lane[index].id);
  if (clip) setSpan(clips, clip.id, clip.startMs, clip.endMs + deltaMs);
  lane[index].endMs += deltaMs;
  return deltaMs;
}

/** Apply a clip-list mutation and rebuild (canonical order + derived duration). */
function mutate(
  timeline: Timeline,
  fn: (clips: Clip[], log: string[]) => void,
): { next: Timeline; log: string[] } {
  const clips = timeline.clips.map(copyClip);
  const log: string[] = [];
  fn(clips, log);
  return { next: rebuildTimeline(clips, timeline.version), log };
}

/** Deterministic new clip id against the WORKING list (same convention as nextClipId). */
function freshId(clips: Clip[], version: number, base: string): string {
  return nextClipId({ version, durationMs: 0, clips }, base);
}

/** Words of a title/narration, normalised (lowercase, alphanumeric, ≥2 chars). */
export function normalizeWords(text: string | null | undefined): Set<string> {
  if (typeof text !== "string") return new Set<string>();
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((w) => w.length >= 2),
  );
}

/** Jaccard word overlap (0 when either side has no words). */
export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const word of a) if (b.has(word)) shared += 1;
  const union = a.size + b.size - shared;
  return union === 0 ? 0 : shared / union;
}

function sceneRow(scenes: SceneInput[], sceneId: string | undefined): SceneInput | null {
  if (!sceneId) return null;
  return scenes.find((s) => s.id === sceneId) ?? null;
}

function hasText(v: string | null | undefined): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* Transition helpers (reuse ./transitions — conservative, fit-checked) */
/* ------------------------------------------------------------------ */

const SOFT_BLEND_ROTATION: readonly TransitionKind[] = ["dissolve", "crossfade"];

/**
 * Largest usable duration for `kind` between two neighbours: the catalog range
 * clamped into at most HALF of the shorter neighbour (the same "fit or fall
 * back" rule as the auto policy). null = even the catalog minimum does not fit.
 */
function blendDurationMs(kind: TransitionKind, spanA: number, spanB: number, wanted: number): number | null {
  const def = transitionDef(kind);
  if (def.durationMsMax === 0) return 0;
  const room = Math.floor(Math.min(spanA, spanB) / 2);
  if (room < def.durationMsMin) return null;
  return Math.max(def.durationMsMin, Math.min(def.durationMsMax, Math.min(r(wanted), room)));
}

function isSceneBoundary(a: LaneEntry, b: LaneEntry): boolean {
  if (a.sceneId && b.sceneId && a.sceneId === b.sceneId) return false; // never inside a scene
  return true;
}

/**
 * Soft blends at scene boundaries of the video lane.
 * Conservative by construction: the first clip of the lane never opens on a
 * blend, a boundary inside the same scene is skipped, a blend is only placed
 * where it fits into half of the shorter neighbour, and at least
 * BLEND_MIN_CUTS_BETWEEN cut edges pass between two blends. The kind is a pure
 * function of the boundary index (dissolve/crossfade alternating), so the
 * operation is idempotent.
 */
function withBoundaryBlends(
  timeline: Timeline,
  log: string[],
  strength: "conservative" | "long",
  kinds: readonly TransitionKind[] = SOFT_BLEND_ROTATION,
): Timeline {
  const lane = laneSnapshot(timeline.clips);
  let current = timeline;
  let cutsSinceBlend = BLEND_MIN_CUTS_BETWEEN;
  // i starts at 1: the lane's opening clip never carries a transition.
  for (let i = 1; i + 1 < lane.length; i += 1) {
    const entry = lane[i];
    const next = lane[i + 1];
    if (!isSceneBoundary(entry, next)) {
      cutsSinceBlend += 1;
      continue;
    }
    if (cutsSinceBlend < BLEND_MIN_CUTS_BETWEEN) {
      cutsSinceBlend += 1;
      continue;
    }
    const kind = kinds[(i - 1) % kinds.length];
    const wanted = strength === "long" ? transitionDef(kind).durationMsMax : defaultDurationMs(kind);
    const durationMs = blendDurationMs(kind, entry.endMs - entry.startMs, next.endMs - next.startMs, wanted);
    if (durationMs === null) {
      cutsSinceBlend += 1;
      continue;
    }
    const target = clipOf(current.clips, entry.id);
    if (!target) continue;
    const before = describeTransition(target.transition ?? null);
    const applied = setTransition(current, { clipId: entry.id, kind, durationMs });
    if (!applied.changed) {
      cutsSinceBlend = 0;
      continue; // already exactly this blend — nothing to report
    }
    current = applied.timeline;
    cutsSinceBlend = 0;
    log.push(
      `transition: ${entry.id} ${before} → ${describeTransition({ kind, durationMs })} ` +
        `(soft blend at the scene boundary before ${entry.id}).`,
    );
  }
  return current;
}

/** Raise every non-cut transition of the video lane towards its catalog maximum. */
function lengthenBlends(timeline: Timeline, log: string[], only?: TransitionKind): Timeline {
  const lane = laneSnapshot(timeline.clips);
  let current = timeline;
  for (let i = 1; i + 1 < lane.length; i += 1) {
    const entry = lane[i];
    const next = lane[i + 1];
    const clip = clipOf(current.clips, entry.id);
    const transition = clip?.transition ?? null;
    if (!transition || transition.kind === "cut") continue;
    if (only && transition.kind !== only) continue;
    const kind = transition.kind as TransitionKind;
    const max = blendDurationMs(kind, entry.endMs - entry.startMs, next.endMs - next.startMs, transitionDef(kind).durationMsMax);
    if (max === null || max <= Math.round(transition.durationMs)) continue;
    const applied = setTransition(current, { clipId: entry.id, kind, durationMs: max });
    if (!applied.changed) continue;
    const before = describeTransition(transition);
    current = applied.timeline;
    log.push(`transition: ${entry.id} ${before} → ${describeTransition({ kind, durationMs: max })} (longer dissolve).`);
  }
  return current;
}

/**
 * Collapse every non-cut transition to a single dissolve (the 2-kind cap), and
 * reset a blend on the LANE'S OPENING clip to a hard cut — a lane never opens on
 * a transition (the house policy in ./transitions).
 */
function collapseToDissolve(timeline: Timeline, log: string[]): Timeline {
  const lane = laneSnapshot(timeline.clips);
  let current = timeline;
  const opening = lane[0] ? clipOf(current.clips, lane[0].id) : null;
  if (opening?.transition && opening.transition.kind !== "cut") {
    const before = describeTransition(opening.transition);
    const applied = setTransition(current, { clipId: opening.id, kind: "cut", durationMs: 0 });
    if (applied.changed) {
      current = applied.timeline;
      log.push(`transition: ${opening.id} ${before} → cut (the opening edge of a lane never blends).`);
    }
  }
  // The last clip always has a next-clip-free outgoing edge; its own span is the
  // only room available, so a dangling non-cut transition still obeys the cap.
  for (let i = 1; i < lane.length; i += 1) {
    const entry = lane[i];
    const next = lane[i + 1] ?? null;
    const clip = clipOf(current.clips, entry.id);
    const transition = clip?.transition ?? null;
    if (!transition || transition.kind === "cut" || transition.kind === "dissolve") continue;
    const spanA = entry.endMs - entry.startMs;
    const spanB = next ? next.endMs - next.startMs : spanA;
    const wanted = blendDurationMs("dissolve", spanA, spanB, transition.durationMs);
    const durationMs = wanted ?? transitionDef("dissolve").durationMsMin;
    const applied = setTransition(current, { clipId: entry.id, kind: "dissolve", durationMs });
    if (!applied.changed) continue;
    const before = describeTransition(transition);
    current = applied.timeline;
    log.push(`transition: ${entry.id} ${before} → ${describeTransition({ kind: "dissolve", durationMs })} (one consistent blend).`);
  }
  return current;
}

/* ------------------------------------------------------------------ */
/* 1) moreCinematic                                                    */
/* ------------------------------------------------------------------ */

function moreCinematic(timeline: Timeline): AutoEditorResult {
  // The spec band: over-long scenes are tightened towards 4-8 s.
  const ceiling = CINEMATIC_MAX_SCENE_MS;
  const { next: tightened, log } = mutate(timeline, (clips, out) => {
    const lane = laneSnapshot(clips);
    for (let i = 0; i < lane.length; i += 1) {
      const clip = clipOf(clips, lane[i].id);
      if (!clip) continue;
      const span = spanOf(clip);
      if (span <= ceiling) continue;
      const delta = ceiling - span; // negative
      const moved = shiftScenesAfter(clips, lane, i, delta);
      for (let j = i + 1; j < lane.length; j += 1) {
        lane[j].startMs += delta;
        lane[j].endMs += delta;
      }
      setSpan(clips, clip.id, clip.startMs, clip.startMs + ceiling);
      lane[i].endMs = clip.startMs + ceiling;
      out.push(
        `video: ${clip.id} tightened ${span}ms → ${ceiling}ms ` +
          `(cinematic band ${CINEMATIC_MIN_SCENE_MS}-${ceiling}ms); ${moved} clip(s) of the following scene(s) pulled earlier.`,
      );
      trimCaptionsToBox(clips, lane[i].sceneId ?? "", clip.startMs, clip.startMs + ceiling, out, "kept inside the tightened shot");
    }
    for (const clip of clips) {
      if (clip.trackId !== "video" && clip.trackId !== "broll" && clip.trackId !== "images") continue;
      if (!clip.sceneId) continue;
      if ((clip.grade ?? null) === CINEMATIC_GRADE) continue;
      out.push(`grade: ${clip.id} ${clip.grade ?? "none"} → ${CINEMATIC_GRADE} (cinematic marker).`);
      clip.grade = CINEMATIC_GRADE;
    }
  });

  const next = withBoundaryBlends(tightened, log, "conservative");
  const changed = !timelinesEqual(next, timeline);
  const blended = next.clips.filter((c) => c.transition && c.transition.kind !== "cut").length;
  return {
    command: "moreCinematic",
    changed,
    changelist: changed ? log : [],
    timeline: changed ? next : timeline,
    plan: { applied: changed, sceneBandMs: [CINEMATIC_MIN_SCENE_MS, ceiling], grade: CINEMATIC_GRADE, blends: blended },
    note: changed
      ? `Scenes were pulled into a ${CINEMATIC_MIN_SCENE_MS}-${ceiling}ms band, tagged "${CINEMATIC_GRADE}" and handed over on soft ` +
        `dissolves/crossfades (at least ${BLEND_MIN_CUTS_BETWEEN} cuts between two blends). Nothing was persisted — save to keep it.`
      : "Every scene already sits in the cinematic band and the boundaries already carry soft blends — nothing to change.",
  };
}

/* ------------------------------------------------------------------ */
/* 2) moreEmotional                                                    */
/* ------------------------------------------------------------------ */

function moreEmotional(timeline: Timeline, args: AutoEditArgs | undefined): AutoEditorResult {
  const intensity = resolveIntensity(args);
  const factor = scaleFactor(EMOTIONAL_LAST_SCENE_FACTOR, intensity);
  const { next: stretched, log } = mutate(timeline, (clips, out) => {
    const lane = laneSnapshot(clips);
    const last = lane[lane.length - 1];
    if (last) {
      const clip = clipOf(clips, last.id);
      if (clip) {
        const span = spanOf(clip);
        const wanted = Math.max(r(span * factor), span + EMOTIONAL_MIN_EXTRA_MS);
        setSpan(clips, clip.id, clip.startMs, clip.startMs + wanted);
        out.push(
          `video: ${clip.id} (closing scene) lengthened ${span}ms → ${wanted}ms (×${round2(factor)} emotion hold).`,
        );
      }
    }
    for (const clip of clips) {
      if (clip.trackId !== "music") continue;
      const gain = clip.gain ?? 1;
      if (gain === EMOTIONAL_MUSIC_GAIN) continue;
      clip.gain = EMOTIONAL_MUSIC_GAIN;
      out.push(
        `music: ${clip.id} gain ${gain} → ${EMOTIONAL_MUSIC_GAIN} (energy target ${EMOTIONAL_MUSIC_ENERGY_TARGET}/100).`,
      );
    }
  });

  const withLonger = lengthenBlends(stretched, log);
  const next = withBoundaryBlends(withLonger, log, "long");
  const changed = !timelinesEqual(next, timeline);
  return {
    command: "moreEmotional",
    changed,
    changelist: changed ? log : [],
    timeline: changed ? next : timeline,
    plan: {
      applied: changed,
      musicEnergyTarget: EMOTIONAL_MUSIC_ENERGY_TARGET,
      musicGain: EMOTIONAL_MUSIC_GAIN,
      lastSceneFactor: round2(factor),
      intensity,
    },
    note: changed
      ? `The closing scene holds longer and the dissolves were stretched to their catalog maximum; the music bed target is ` +
        `${EMOTIONAL_MUSIC_ENERGY_TARGET}/100 (gain ${EMOTIONAL_MUSIC_GAIN}). The music AUDIO itself still needs a connected ` +
        `provider — only the deterministic target was recorded. Nothing was persisted — save to keep it.`
      : "The closing scene and the dissolves are already at the emotional setting — nothing to change.",
  };
}

/* ------------------------------------------------------------------ */
/* 3) moreViral                                                        */
/* ------------------------------------------------------------------ */

function moreViral(timeline: Timeline): AutoEditorResult {
  const { next: hooked, log } = mutate(timeline, (clips, out) => {
    const lane = laneSnapshot(clips);
    const first = lane[0] ? clipOf(clips, lane[0].id) : null;
    if (first && lane[0].sceneId) {
      const span = spanOf(first);
      if (span > HOOK_MAX_MS) {
        const delta = HOOK_MAX_MS - span;
        const moved = shiftScenesAfter(clips, lane, 0, delta);
        for (let j = 1; j < lane.length; j += 1) {
          lane[j].startMs += delta;
          lane[j].endMs += delta;
        }
        setSpan(clips, first.id, first.startMs, first.startMs + HOOK_MAX_MS);
        out.push(
          `video: ${first.id} trimmed ${span}ms → ${HOOK_MAX_MS}ms (viral hook); ${moved} clip(s) of the following scene(s) pulled earlier.`,
        );
      }
      const sceneId = lane[0].sceneId;
      const box = clipOf(clips, first.id);
      if (box) trimCaptionsToBox(clips, sceneId, box.startMs, box.endMs, out, `kept inside the ${HOOK_MAX_MS}ms hook`);
      for (const clip of clips) {
        if (clip.sceneId !== sceneId || clip.trackId !== "subtitles") continue;
        if ((clip.subtitleStyle ?? null) === "bold") continue;
        out.push(`subtitles: ${clip.id} style ${clip.subtitleStyle ?? "default"} → bold (hook captions).`);
        clip.subtitleStyle = "bold";
      }
    }
  });

  const first = laneSnapshot(hooked.clips)[0];
  let next = hooked;
  if (first) {
    const applied = setTransition(next, { clipId: first.id, kind: "cut", durationMs: 0 });
    if (applied.changed) {
      log.push(`transition: ${first.id} → cut (hard cut out of the hook).`);
      next = applied.timeline;
    }
  }
  const changed = !timelinesEqual(next, timeline);
  const hardCut = first ? (clipOf(next.clips, first.id)?.transition?.kind ?? null) === "cut" : false;
  return {
    command: "moreViral",
    changed,
    changelist: changed ? log : [],
    timeline: changed ? next : timeline,
    plan: {
      applied: changed,
      hookClipId: first?.id ?? null,
      hookSceneId: first?.sceneId ?? null,
      hookSpanMs: first ? first.endMs - first.startMs : 0,
      hookMaxMs: HOOK_MAX_MS,
      subtitleStyle: "bold",
      hardCut,
    },
    note: changed
      ? "The opening shot is at most 3s, the timeline cuts hard out of it and the hook captions are bold. " +
        "Deterministic — no provider involved. Nothing was persisted — save to keep it."
      : "The opening shot is already a ≤3s hard-cut hook with bold captions — nothing to change.",
  };
}

/* ------------------------------------------------------------------ */
/* 4) betterPacing                                                     */
/* ------------------------------------------------------------------ */

function betterPacing(timeline: Timeline): AutoEditorResult {
  const { next: paced, log } = mutate(timeline, (clips, out) => {
    const lane = laneSnapshot(clips);
    for (let i = 0; i < lane.length; i += 1) {
      const entry = lane[i];
      if (!entry.sceneId) continue;
      const sceneClips = clips.filter((c) => c.sceneId === entry.sceneId);
      const voice = sceneClips.filter((c) => c.trackId === "voice");
      if (voice.length === 0) continue; // no voice clip → nothing drives the target
      const voiceStart = voice.reduce((min, c) => Math.min(min, c.startMs), voice[0].startMs);
      const voiceEnd = voice.reduce((max, c) => Math.max(max, c.endMs), voice[0].endMs);
      const target = Math.max(MIN_CLIP_MS, voiceEnd - voiceStart);
      const clip = clipOf(clips, entry.id);
      if (!clip) continue;
      const span = spanOf(clip);
      const delta = target - span;
      if (delta !== 0) {
        const moved = shiftScenesAfter(clips, lane, i, delta);
        for (let j = i + 1; j < lane.length; j += 1) {
          lane[j].startMs += delta;
          lane[j].endMs += delta;
        }
        setSpan(clips, clip.id, clip.startMs, clip.startMs + target);
        lane[i].endMs = clip.startMs + target;
        out.push(
          `video: ${clip.id} ${span}ms → ${target}ms (matched its ${voice.length} voice clip(s) at ${voiceStart}→${voiceEnd}ms); ` +
            `${moved} clip(s) of the following scene(s) re-timed.`,
        );
      }
      // Captions follow the picture: the scene's caption lane is re-aligned to the box.
      for (const caption of clips) {
        if (caption.sceneId !== entry.sceneId || caption.trackId !== "subtitles") continue;
        const captionSpan = spanOf(caption);
        if (caption.startMs === clip.startMs && captionSpan === target) continue;
        out.push(
          `subtitles: ${caption.id} ${caption.startMs}→${caption.endMs}ms → ${clip.startMs}→${clip.startMs + target}ms (aligned to the scene box).`,
        );
        setSpan(clips, caption.id, clip.startMs, clip.startMs + target);
      }
    }
    closeVideoLaneGaps(clips, out);
  });
  const changed = !timelinesEqual(paced, timeline);
  const video = laneSnapshot(paced.clips);
  const avg = video.length === 0 ? 0 : r(video.reduce((sum, c) => sum + (c.endMs - c.startMs), 0) / video.length);
  return {
    command: "betterPacing",
    changed,
    changelist: changed ? log : [],
    timeline: changed ? paced : timeline,
    plan: { applied: changed, sceneCount: video.length, averageSceneMs: avg },
    note: changed
      ? "Every scene with a voice clip was re-timed to the narration length and the video lane's gaps were closed. " +
        "Deterministic — no provider involved. Nothing was persisted — save to keep it."
      : "Scene lengths already match their narration and the video lane has no gaps — nothing to change.",
  };
}

/* ------------------------------------------------------------------ */
/* 5) betterVisuals                                                    */
/* ------------------------------------------------------------------ */

function betterVisuals(timeline: Timeline, scenes: SceneInput[]): AutoEditorResult {
  const provider = providerGate(
    "image_generation",
    "Generating the missing visuals",
  );
  const { next: filled, log } = mutate(timeline, (clips, out) => {
    const lane = laneSnapshot(clips);
    for (let i = 0; i < lane.length; i += 1) {
      const entry = lane[i];
      if (!entry.sceneId) continue;
      const row = sceneRow(scenes, entry.sceneId);
      const prompt = row?.visualPrompt ?? null;
      if (!hasText(prompt)) continue; // no prompt → planned below, nothing added
      const already = clips.some(
        (c) => c.trackId === "broll" && c.sourceRef === `${VISUAL_BROLL_PREFIX}${entry.sceneId}`,
      );
      if (already) continue;
      const span = Math.max(MIN_CLIP_MS, Math.min(entry.endMs - entry.startMs, 2500));
      const id = freshId(clips, timeline.version, `broll-visual-${entry.sceneId}`);
      clips.push({
        id,
        name: `B-roll — ${clipOf(clips, entry.id)?.name ?? entry.sceneId}`,
        trackId: "broll",
        sceneId: entry.sceneId,
        startMs: entry.startMs,
        endMs: entry.startMs + span,
        sourceRef: `${VISUAL_BROLL_PREFIX}${entry.sceneId}`,
        transition: null,
      });
      out.push(`broll: added ${id} (${entry.startMs}→${entry.startMs + span}ms, sourceRef ${VISUAL_BROLL_PREFIX}${entry.sceneId}).`);
    }
  });

  const missing: string[] = [];
  const unknown: string[] = [];
  const ready: { sceneId: string; visualPrompt: string }[] = [];
  for (const clip of timeline.clips) {
    if (clip.trackId !== "video" || !clip.sceneId) continue;
    if (missing.includes(clip.sceneId) || unknown.includes(clip.sceneId)) continue;
    const row = sceneRow(scenes, clip.sceneId);
    if (!row) {
      unknown.push(clip.sceneId);
      continue;
    }
    const prompt = row.visualPrompt;
    if (typeof prompt === "string" && prompt.trim()) ready.push({ sceneId: clip.sceneId, visualPrompt: prompt.trim() });
    else missing.push(clip.sceneId);
  }
  for (const sceneId of missing) {
    log.push(
      `scene ${sceneId}: no visual prompt yet — an image provider would generate one here (plan only, nothing generated — ${provider.requiredEnv[0]} not set).`,
    );
  }
  for (const sceneId of unknown) {
    log.push(`scene ${sceneId}: no Scene row, so its visual prompt is unknown — left untouched (no output invented).`);
  }

  const changed = !timelinesEqual(filled, timeline);
  const blocked = missing.length > 0 || unknown.length > 0;
  const plan = {
    applied: changed,
    capability: provider.capability,
    missingVisualPrompt: missing,
    unknownVisualPrompt: unknown,
    readyPrompts: ready,
    brollAdded: filled.clips.filter((c) => c.sourceRef?.startsWith(VISUAL_BROLL_PREFIX)).map((c) => c.id),
  };
  return {
    command: "betterVisuals",
    changed,
    changelist: log,
    timeline: changed ? filled : timeline,
    provider: blocked ? provider : undefined,
    plan,
    note: changed
      ? `B-roll was attached to ${plan.brollAdded.length} scene(s) that already have a visual prompt. ` +
        (blocked
          ? `Provider Not Connected — ${missing.length} scene(s) still need a generated visual, ${unknown.length} are unknown.`
          : "Every scene has a visual prompt.")
      : blocked
        ? `Provider Not Connected — ${missing.length} scene(s) have no visual prompt and ${unknown.length} scene(s) have no Scene row ` +
          "(their prompt is unknown). No visual clip was changed and nothing was fabricated."
        : "Every scene already has a visual prompt and its b-roll clip — nothing to change.",
  };
}

/* ------------------------------------------------------------------ */
/* 6) betterVoiceover                                                  */
/* ------------------------------------------------------------------ */

function betterVoiceover(timeline: Timeline, scenes: SceneInput[]): AutoEditorResult {
  const provider = providerGate(
    "voice_generation",
    "Speaking the narration",
  );
  const { next: normalised, log } = mutate(timeline, (clips, out) => {
    for (const clip of clips) {
      if (clip.trackId !== "voice") continue;
      if (clip.gain === undefined || clip.gain === VOICE_GAIN_TARGET) continue; // missing gain ≈ the implicit 1.0
      const before = clip.gain;
      clip.gain = VOICE_GAIN_TARGET;
      out.push(`voice: ${clip.id} gain ${before} → ${VOICE_GAIN_TARGET} (normalised delivery level).`);
    }
  });

  const missing: string[] = [];
  const unknown: string[] = [];
  for (const clip of timeline.clips) {
    if (clip.trackId !== "video" || !clip.sceneId) continue;
    if (missing.includes(clip.sceneId) || unknown.includes(clip.sceneId)) continue;
    const row = sceneRow(scenes, clip.sceneId);
    if (!row) {
      unknown.push(clip.sceneId);
      continue;
    }
    if (!hasText(row.narration)) missing.push(clip.sceneId);
  }
  for (const sceneId of missing) {
    log.push(
      `scene ${sceneId}: no narration text to speak — a TTS provider would need a script first (plan only, no speech synthesized — ${provider.requiredEnv[0]} not set).`,
    );
  }
  for (const sceneId of unknown) {
    log.push(`scene ${sceneId}: no Scene row, so its narration is unknown — left untouched (no speech invented).`);
  }

  const changed = !timelinesEqual(normalised, timeline);
  return {
    command: "betterVoiceover",
    changed,
    changelist: log,
    timeline: changed ? normalised : timeline,
    provider,
    plan: {
      applied: true,
      capability: provider.capability,
      gainTarget: VOICE_GAIN_TARGET,
      missingNarration: missing,
      unknownNarration: unknown,
    },
    note: changed
      ? `Voice-clip gain normalised to ${VOICE_GAIN_TARGET}. ${provider.note}`
      : `Voice-clip gain already at ${VOICE_GAIN_TARGET}. ${provider.note}`,
  };
}

/* ------------------------------------------------------------------ */
/* 7) strongerHook                                                     */
/* ------------------------------------------------------------------ */

function strongerHook(timeline: Timeline): AutoEditorResult {
  const { next: hooked, log } = mutate(timeline, (clips, out) => {
    const lane = laneSnapshot(clips);
    const first = lane[0] ? clipOf(clips, lane[0].id) : null;
    if (!first || !lane[0].sceneId) return;
    const sceneId = lane[0].sceneId;
    const span = spanOf(first);
    if (span > HOOK_MAX_MS) {
      const delta = HOOK_MAX_MS - span;
      const moved = shiftScenesAfter(clips, lane, 0, delta);
      for (let j = 1; j < lane.length; j += 1) {
        lane[j].startMs += delta;
        lane[j].endMs += delta;
      }
      setSpan(clips, first.id, first.startMs, first.startMs + HOOK_MAX_MS);
      out.push(`video: ${first.id} shortened ${span}ms → ${HOOK_MAX_MS}ms (hook). ${moved} clip(s) of the following scene(s) pulled earlier.`);
    }
    const box = clipOf(clips, first.id);
    if (box) trimCaptionsToBox(clips, sceneId, box.startMs, box.endMs, out, `kept inside the ${HOOK_MAX_MS}ms hook`);
    for (const clip of clips) {
      if (clip.sceneId !== sceneId || clip.trackId !== "subtitles") continue;
      if ((clip.subtitleStyle ?? null) === "bold") continue;
      out.push(`subtitles: ${clip.id} style ${clip.subtitleStyle ?? "default"} → bold (hook captions).`);
      clip.subtitleStyle = "bold";
    }
    const titleCard = clips.find((c) => c.trackId === "text" && c.sourceRef === HOOK_TEXT_SOURCE_REF);
    if (!titleCard) {
      const endMs = clipOf(clips, first.id)?.endMs ?? first.endMs;
      const id = freshId(clips, timeline.version, `text-hook-${sceneId}`);
      clips.push({
        id,
        name: `Hook — ${first.name}`,
        trackId: "text",
        sceneId,
        startMs: first.startMs,
        endMs,
        sourceRef: HOOK_TEXT_SOURCE_REF,
        transition: null,
      });
      out.push(`text: added ${id} (${first.startMs}→${endMs}ms, title card "${first.name}").`);
    }
  });
  const changed = !timelinesEqual(hooked, timeline);
  return {
    command: "strongerHook",
    changed,
    changelist: changed ? log : [],
    timeline: changed ? hooked : timeline,
    plan: {
      applied: changed,
      hookMaxMs: HOOK_MAX_MS,
      subtitleStyle: "bold",
      titleCardRef: HOOK_TEXT_SOURCE_REF,
    },
    note: changed
      ? `The opening shot was shortened, its captions set to bold and a title card added on the text track (sourceRef ${HOOK_TEXT_SOURCE_REF}). ` +
        "Deterministic — no provider involved. Nothing was persisted — save to keep it."
      : "The hook is already short, bold and titled — nothing to change.",
  };
}

/* ------------------------------------------------------------------ */
/* 8) moreBroll                                                        */
/* ------------------------------------------------------------------ */

function moreBroll(timeline: Timeline): AutoEditorResult {
  const { next: withBroll, log } = mutate(timeline, (clips, out) => {
    const lane = laneSnapshot(clips);
    let inserted = 0;
    for (let i = 0; i + 1 < lane.length; i += 1) {
      const nextScene = lane[i + 1].sceneId;
      if (!nextScene) continue; // no source scene to point at
      const entry = lane[i + 1];
      const span = Math.max(
        MIN_CLIP_MS,
        Math.min(BROLL_INSERT_DURATIONS_MS[inserted % BROLL_INSERT_DURATIONS_MS.length], entry.endMs - entry.startMs),
      );
      const already = clips.some(
        (c) => c.trackId === "broll" && c.sceneId === nextScene && c.sourceRef === `${BROLL_SOURCE_PREFIX}${nextScene}` && c.startMs === entry.startMs,
      );
      if (already) continue;
      const id = freshId(clips, timeline.version, `broll-${nextScene}-${i + 1}`);
      clips.push({
        id,
        name: `B-roll — ${clipOf(clips, entry.id)?.name ?? nextScene}`,
        trackId: "broll",
        sceneId: nextScene,
        startMs: entry.startMs,
        endMs: entry.startMs + span,
        sourceRef: `${BROLL_SOURCE_PREFIX}${nextScene}`,
        transition: null,
      });
      out.push(
        `broll: added ${id} at the ${i + 1}. scene boundary (${entry.startMs}→${entry.startMs + span}ms, sourceRef ${BROLL_SOURCE_PREFIX}${nextScene}).`,
      );
      inserted += 1;
    }
  });
  const changed = !timelinesEqual(withBroll, timeline);
  const broll = withBroll.clips.filter((c) => c.trackId === "broll").length;
  return {
    command: "moreBroll",
    changed,
    changelist: changed ? log : [],
    timeline: changed ? withBroll : timeline,
    plan: { applied: changed, brollClips: broll, insertLengthsMs: [...BROLL_INSERT_DURATIONS_MS] },
    note: changed
      ? `B-roll inserts (${BROLL_INSERT_DURATIONS_MS.join("/")}ms) were cut in at the scene boundaries. Each insert points at its source scene ` +
        `(${BROLL_SOURCE_PREFIX}<sceneId>) — no stock footage was invented, the renderer resolves the reference. Nothing was persisted — save to keep it.`
      : "Every scene boundary already carries its b-roll insert — nothing to change.",
  };
}

/* ------------------------------------------------------------------ */
/* 9) reduceRepetition                                                 */
/* ------------------------------------------------------------------ */

function reduceRepetition(timeline: Timeline, scenes: SceneInput[]): AutoEditorResult {
  const { next: deduped, log } = mutate(timeline, (clips, out) => {
    const lane = laneSnapshot(clips);
    for (let i = 1; i < lane.length; i += 1) {
      const previous = lane[i - 1];
      const entry = lane[i];
      const current = clipOf(clips, entry.id);
      const before = clipOf(clips, previous.id);
      if (!current || !before) continue;
      const titleScore = jaccardSimilarity(normalizeWords(before.name), normalizeWords(current.name));
      const narrScore = jaccardSimilarity(
        normalizeWords(sceneRow(scenes, previous.sceneId)?.narration),
        normalizeWords(sceneRow(scenes, entry.sceneId)?.narration),
      );
      const score = Math.max(titleScore, narrScore);
      if (score < REPETITION_SIMILARITY_THRESHOLD) continue;
      const span = spanOf(current);
      const target = Math.max(REPETITION_MIN_MS, r(span * REPETITION_SHORTEN_FACTOR));
      if (target >= span) {
        out.push(
          `video: ${entry.id} repeats ${previous.id} (overlap ${round2(score)}) but is already only ${span}ms — left as is (scenes are never deleted).`,
        );
        continue;
      }
      setSpan(clips, current.id, current.startMs, current.startMs + target);
      out.push(
        `video: ${entry.id} repeats ${previous.id} (${titleScore >= narrScore ? "title" : "narration"} overlap ${round2(score)}) — ` +
          `shortened ${span}ms → ${target}ms; the scene is kept, never deleted.`,
      );
    }
  });
  const changed = !timelinesEqual(deduped, timeline);
  return {
    command: "reduceRepetition",
    changed,
    changelist: changed ? log : [],
    timeline: changed ? deduped : timeline,
    plan: { applied: changed, threshold: REPETITION_SIMILARITY_THRESHOLD, shortenFactor: REPETITION_SHORTEN_FACTOR },
    note: changed
      ? `A scene that repeated the one before it was shortened to ${Math.round(REPETITION_SHORTEN_FACTOR * 100)}% of its length ` +
        `(word overlap ≥ ${REPETITION_SIMILARITY_THRESHOLD}). Nothing was deleted and no clip was invented. Nothing was persisted — save to keep it.`
      : "No two consecutive scenes are near-duplicates (word overlap stays below " +
        `${REPETITION_SIMILARITY_THRESHOLD}) — nothing to change.`,
  };
}

/* ------------------------------------------------------------------ */
/* 10) professional                                                    */
/* ------------------------------------------------------------------ */

function professional(timeline: Timeline): AutoEditorResult {
  const { next: graded, log } = mutate(timeline, (clips, out) => {
    for (const clip of clips) {
      if (clip.trackId !== "video" && clip.trackId !== "broll" && clip.trackId !== "images") continue;
      if (!clip.sceneId) continue;
      if ((clip.grade ?? null) === PROFESSIONAL_GRADE) continue;
      out.push(`grade: ${clip.id} ${clip.grade ?? "none"} → ${PROFESSIONAL_GRADE} (professional marker).`);
      clip.grade = PROFESSIONAL_GRADE;
    }
  });
  const next = collapseToDissolve(graded, log);
  const changed = !timelinesEqual(next, timeline);
  const lane = laneSnapshot(next.clips);
  const kinds = new Set<string>();
  for (const entry of lane) {
    const transition = clipOf(next.clips, entry.id)?.transition;
    if (transition) kinds.add(transition.kind);
  }
  return {
    command: "professional",
    changed,
    changelist: changed ? log : [],
    timeline: changed ? next : timeline,
    plan: { applied: changed, grade: PROFESSIONAL_GRADE, transitionKinds: [...kinds].sort(), kindCap: 2 },
    note: changed
      ? `The visual clips carry the "${PROFESSIONAL_GRADE}" grade marker and every non-cut transition is one consistent dissolve ` +
        `(the lane now uses at most ${Math.max(kinds.size, 2)} of the 8 kinds: cut + dissolve). Deterministic — no provider involved. ` +
        "Nothing was persisted — save to keep it."
      : "The grade marker and the transitions already match the professional preset — nothing to change.",
  };
}

/* ------------------------------------------------------------------ */
/* 11) documentary                                                     */
/* ------------------------------------------------------------------ */

function documentary(timeline: Timeline, scenes: SceneInput[], args: AutoEditArgs | undefined): AutoEditorResult {
  const intensity = resolveIntensity(args);
  const factor = scaleFactor(DOCUMENTARY_SCENE_FACTOR, intensity);
  const { next: stretched, log } = mutate(timeline, (clips, out) => {
    const lane = laneSnapshot(clips);
    for (let i = 0; i < lane.length; i += 1) {
      const entry = lane[i];
      if (!entry.sceneId) continue;
      const marked = clips.some(
        (c) => c.sceneId === entry.sceneId && c.trackId === "subtitles" && c.subtitleStyle === DOCUMENTARY_SUBTITLE_STYLE,
      );
      if (!marked) {
        const clip = clipOf(clips, entry.id);
        if (clip) {
          const span = spanOf(clip);
          const delta = Math.max(1, r(span * factor) - span);
          extendSceneBy(clips, lane, i, delta);
          out.push(`video: ${clip.id} extended ${span}ms → ${span + delta}ms (×${round2(factor)} documentary hold).`);
        }
      }
      // Documentary captions + a voice clip for every narrated scene that lacks one.
      for (const caption of clips) {
        if (caption.sceneId !== entry.sceneId || caption.trackId !== "subtitles") continue;
        if ((caption.subtitleStyle ?? null) === DOCUMENTARY_SUBTITLE_STYLE) continue;
        out.push(`subtitles: ${caption.id} style ${caption.subtitleStyle ?? "default"} → ${DOCUMENTARY_SUBTITLE_STYLE}.`);
        caption.subtitleStyle = DOCUMENTARY_SUBTITLE_STYLE;
      }
      const row = sceneRow(scenes, entry.sceneId);
      if (!hasText(row?.narration)) continue;
      const hasVoice = clips.some((c) => c.sceneId === entry.sceneId && c.trackId === "voice");
      if (hasVoice) continue;
      const box = lane[i];
      const id = freshId(clips, timeline.version, `sc-${entry.sceneId}-voice`);
      clips.push({
        id,
        name: `Voice — ${clipOf(clips, entry.id)?.name ?? entry.sceneId}`,
        trackId: "voice",
        sceneId: entry.sceneId,
        startMs: box.startMs,
        endMs: box.endMs,
        sourceRef: `${BROLL_SOURCE_PREFIX}${entry.sceneId}`,
        transition: null,
      });
      out.push(
        `voice: added ${id} (${box.startMs}→${box.endMs}ms, sourceRef ${BROLL_SOURCE_PREFIX}${entry.sceneId}) — the audio itself needs a TTS provider.`,
      );
    }
  });

  const withLong = lengthenBlends(stretched, log, "dissolve");
  const next = withBoundaryBlends(withLong, log, "long", ["dissolve"]);
  const changed = !timelinesEqual(next, timeline);
  return {
    command: "documentary",
    changed,
    changelist: changed ? log : [],
    timeline: changed ? next : timeline,
    plan: {
      applied: changed,
      sceneFactor: round2(factor),
      subtitleStyle: DOCUMENTARY_SUBTITLE_STYLE,
      intensity,
    },
    note: changed
      ? `Scenes were extended (×${round2(factor)}), the dissolves stretched, the captions switched to "${DOCUMENTARY_SUBTITLE_STYLE}" and every narrated ` +
        "scene now has a voice clip. The voice AUDIO still needs a connected TTS provider — nothing was synthesized. Nothing was persisted — save to keep it."
      : "The timeline is already in the documentary shape — nothing to change.",
  };
}

/* ------------------------------------------------------------------ */
/* 12) youtubeOptimized                                                */
/* ------------------------------------------------------------------ */

function youtubeOptimized(timeline: Timeline, scenes: SceneInput[]): AutoEditorResult {
  const provider = providerGate(
    "seo_generation",
    "Writing the title and description",
  );
  const { next: tuned, log } = mutate(timeline, (clips, out) => {
    const lane = laneSnapshot(clips);
    const first = lane[0] ? clipOf(clips, lane[0].id) : null;
    if (first && lane[0].sceneId) {
      const span = spanOf(first);
      if (span > HOOK_MAX_MS) {
        const delta = HOOK_MAX_MS - span;
        const moved = shiftScenesAfter(clips, lane, 0, delta);
        for (let j = 1; j < lane.length; j += 1) {
          lane[j].startMs += delta;
          lane[j].endMs += delta;
        }
        setSpan(clips, first.id, first.startMs, first.startMs + HOOK_MAX_MS);
        out.push(`video: ${first.id} trimmed ${span}ms → ${HOOK_MAX_MS}ms (≤3s hook). ${moved} clip(s) of the following scene(s) pulled earlier.`);
      }
      const box = clipOf(clips, first.id);
      if (box) trimCaptionsToBox(clips, lane[0].sceneId, box.startMs, box.endMs, out, `kept inside the ${HOOK_MAX_MS}ms hook`);
    }
    for (const clip of clips) {
      if (clip.trackId !== "subtitles") continue;
      if (clip.sourceRef === SAFE_SUBTITLE_MARGIN_REF) continue;
      out.push(`subtitles: ${clip.id} sourceRef ${clip.sourceRef ?? "none"} → ${SAFE_SUBTITLE_MARGIN_REF} (mobile-safe margins recorded).`);
      clip.sourceRef = SAFE_SUBTITLE_MARGIN_REF;
    }
    closeVideoLaneGaps(clips, out);
  });

  const title = timeline.clips.find((c) => c.trackId === "video")?.name ?? null;
  const hooks = sceneRow(scenes, laneSnapshot(timeline.clips)[0]?.sceneId)?.title ?? null;
  log.push(
    `seo: title/description suggestions were NOT generated — ${provider.capability} is not connected ` +
      `(set ${provider.requiredEnv[0]} server-side to enable it). Local material for a later pass: ` +
      `${title ? `opening shot "${title}"` : "no opening shot"}, ${hooks ? `hook scene "${hooks}"` : "no hook scene"}, ` +
      `${sceneCountOf(timeline)} scene(s), ${Math.round(timeline.durationMs / 100) / 10}s long.`,
  );

  const changed = !timelinesEqual(tuned, timeline);
  return {
    command: "youtubeOptimized",
    changed,
    changelist: log,
    timeline: changed ? tuned : timeline,
    provider,
    plan: {
      applied: changed,
      hookMaxMs: HOOK_MAX_MS,
      subtitleMarginRef: SAFE_SUBTITLE_MARGIN_REF,
      suggestions: { requested: ["title", "description"], produced: false, capability: provider.capability },
    },
    note: changed
      ? `The hook is ≤3s, the captions are inside the mobile-safe margins and the gaps are closed. ${provider.note}`
      : `The hook, the caption margins and the gaps already match the YouTube preset. ${provider.note}`,
  };
}

function sceneCountOf(timeline: Timeline): number {
  const ids = new Set<string>();
  for (const clip of timeline.clips) if (clip.sceneId) ids.add(clip.sceneId);
  return ids.size;
}

/* ------------------------------------------------------------------ */
/* Dispatcher                                                          */
/* ------------------------------------------------------------------ */

/**
 * One entry point for all twelve commands — the API service and the unit tests
 * call exactly this, so the tested behaviour is the served behaviour.
 * Unknown command → typed `invalid_input` (the API turns it into a 400).
 */
export function applyAutoEditCommand(
  timeline: Timeline,
  scenes: SceneInput[],
  command: AutoEditorCommand,
  args?: AutoEditArgs,
): AutoEditorResult {
  if (!isAutoEditCommand(command)) {
    throw new EditorError("invalid_input", `Unknown auto-edit command "${String(command)}".`);
  }
  const rows = Array.isArray(scenes) ? scenes : [];
  switch (command) {
    case "moreCinematic":
      return moreCinematic(timeline);
    case "moreEmotional":
      return moreEmotional(timeline, args);
    case "moreViral":
      return moreViral(timeline);
    case "betterPacing":
      return betterPacing(timeline);
    case "betterVisuals":
      return betterVisuals(timeline, rows);
    case "betterVoiceover":
      return betterVoiceover(timeline, rows);
    case "strongerHook":
      return strongerHook(timeline);
    case "moreBroll":
      return moreBroll(timeline);
    case "reduceRepetition":
      return reduceRepetition(timeline, rows);
    case "professional":
      return professional(timeline);
    case "documentary":
      return documentary(timeline, rows, args);
    case "youtubeOptimized":
      return youtubeOptimized(timeline, rows);
    default:
      throw new EditorError("invalid_input", `Unknown auto-edit command "${String(command)}".`);
  }
}
