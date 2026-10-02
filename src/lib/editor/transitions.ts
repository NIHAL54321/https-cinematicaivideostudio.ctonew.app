/**
 * Phase 5 Block 2 — Transitions engine (deterministic, pure, no IO, no provider).
 *
 * A transition lives on a clip's OUTGOING edge: it describes how that clip
 * hands off to the NEXT clip on the same track. `Clip.transition` was reserved
 * in Block 1 and is now interpreted here:
 *
 *   { kind: TransitionKind, durationMs: number }   // 0 ms = a hard cut
 *   null / undefined = "no transition recorded"    // the first clip always has none
 *
 * ------------------------------------------------------------------ CATALOG
 * Eight spec kinds (TRANSITIONS): cut, fade, dissolve, crossfade, zoom, slide,
 * wipe, cinematic. Durations follow the spec: cut = 0 ms, the soft effects are
 * 300-600 ms, `cinematic` is the long one at 700-1200 ms. `audioCrossfade`
 * records whether the edge should also cross-fade the audio bed.
 *
 * ------------------------------------------------------ AUTO-SELECTION POLICY
 * `autoSelectTransitions(timeline)` is CONSERVATIVE by design — the spec's
 * "do not use excessive transitions" rule is encoded here and unit-tested:
 *
 *   1. AUTHORITATIVE + IDEMPOTENT. It clears every transition on every clip and
 *      then re-applies the policy to ONE lane (the "video" track by default).
 *      Running it twice yields a structurally identical timeline.
 *   2. FIRST CLIP NEVER / OPENING CUT. The leading edge of a lane (clip 1 →
 *      clip 2) is ALWAYS a hard cut and the first clip carries no transition
 *      record at all (null): a timeline never opens with a blend. `fade`-in
 *      style openings are therefore manual-only and are reported by
 *      validateTransition.
 *   3. NO TRANSITIONS INSIDE A SCENE. Two consecutive clips that share a
 *      `sceneId` always get a hard `cut` — a scene change is the only place the
 *      policy looks for drama.
 *   4. ONLY BOUNDARIES ARE CANDIDATES. An edge is a candidate when the sceneId
 *      changes (scene boundary) or when the clips are separated by a gap of at
 *      least BEAT_GAP_MS (500 ms — a beat / act break). Anything else → cut.
 *   5. BUDGET: at least DRAMA_MIN_CUTS (3) edges must pass between two
 *      non-cut transitions, so a plain 6-scene timeline (5 video edges) gets at
 *      most 2 non-cut transitions and never more than ~1 dramatic one per 3
 *      cuts. The budget is spent by the FIRST eligible boundary after the gap.
 *   6. STRENGTH LADDER (deterministic, no randomness anywhere):
 *        gap >= ACT_BREAK_GAP_MS (1200 ms) → "cinematic"        (dramatic)
 *        gap >= BEAT_GAP_MS      ( 500 ms) → zoom|slide|wipe    (dramatic, rotating)
 *        scene boundary, no gap            → dissolve|crossfade (soft, rotating)
 *      rotation indices advance once per chosen transition, so equal timelines
 *      always produce equal results.
 *   7. FIT OR FALL BACK. A transition may use at most HALF of the shorter
 *      neighbour; the duration is the catalog midpoint clamped into that room.
 *      When even the catalog minimum does not fit, the edge degrades to a cut.
 *   8. LAST CLIP: no outgoing target → null (the policy never invents one).
 *
 * `fade` is deliberately NOT auto-selected (it is a manual statement — fade to
 * black on an outro); it stays available through `setTransition`.
 *
 * --------------------------------------------------------------- VALIDATION
 * `validateTransition(timeline)` lists every problem an (optionally hand-edited /
 * client-supplied) timeline has: unknown kind, unusable duration, a transition
 * longer than its clip, a transition longer than half its clip, or a non-cut
 * transition on the first clip of a lane (the auto policy always opens on a hard
 * cut). It is a pure honesty helper for the API + UI.
 *
 * No AI provider is involved in this module: choosing and storing a transition
 * is deterministic editing, so there is no provider gate here.
 */
import {
  EditorError,
  clipsAt,
  copyClip,
  isTrackId,
  rebuildTimeline,
  type Clip,
  type ClipTransition,
  type OpResult,
  type Timeline,
  type TrackId,
} from "./timeline";

export type TransitionKind =
  | "cut"
  | "fade"
  | "dissolve"
  | "crossfade"
  | "zoom"
  | "slide"
  | "wipe"
  | "cinematic";

export interface TransitionDef {
  kind: TransitionKind;
  label: string;
  /** Shortest usable duration (ms). 0 for a cut. */
  durationMsMin: number;
  /** Longest usable duration (ms). 0 for a cut. */
  durationMsMax: number;
  /** true when the edge should also cross-fade the audio bed. */
  audioCrossfade?: boolean;
  description: string;
}

/** The 8 spec kinds with sane default durations. */
export const TRANSITIONS: readonly TransitionDef[] = [
  {
    kind: "cut",
    label: "Cut",
    durationMsMin: 0,
    durationMsMax: 0,
    audioCrossfade: false,
    description: "Hard cut — the picture and the audio switch instantly. The default between clips of the same scene.",
  },
  {
    kind: "fade",
    label: "Fade",
    durationMsMin: 300,
    durationMsMax: 600,
    audioCrossfade: true,
    description: "Fade out to (and in from) black — a manual statement, e.g. the end of an act or an outro.",
  },
  {
    kind: "dissolve",
    label: "Dissolve",
    durationMsMin: 300,
    durationMsMax: 600,
    audioCrossfade: true,
    description: "Soft dissolve between two shots — the default scene-boundary transition.",
  },
  {
    kind: "crossfade",
    label: "Crossfade",
    durationMsMin: 300,
    durationMsMax: 600,
    audioCrossfade: true,
    description: "Symmetric cross-fade, picture and audio — a slightly more polished dissolve.",
  },
  {
    kind: "zoom",
    label: "Zoom",
    durationMsMin: 300,
    durationMsMax: 600,
    audioCrossfade: false,
    description: "Push/zoom transition into the next shot — a dramatic scene-change accent.",
  },
  {
    kind: "slide",
    label: "Slide",
    durationMsMin: 300,
    durationMsMax: 600,
    audioCrossfade: true,
    description: "The next shot slides in over the outgoing one — a dramatic scene-change accent.",
  },
  {
    kind: "wipe",
    label: "Wipe",
    durationMsMin: 300,
    durationMsMax: 600,
    audioCrossfade: true,
    description: "Geometric wipe between shots — a dramatic scene-change accent.",
  },
  {
    kind: "cinematic",
    label: "Cinematic",
    durationMsMin: 700,
    durationMsMax: 1200,
    audioCrossfade: true,
    description: "Long, deliberate cinematic blend reserved for act breaks — the strongest transition.",
  },
] as const;

export const TRANSITION_KINDS: readonly TransitionKind[] = TRANSITIONS.map((t) => t.kind);

/** Dramatic accents — only ever placed at scene boundaries / beat moments. */
export const DRAMATIC_TRANSITIONS: readonly TransitionKind[] = ["zoom", "slide", "wipe", "cinematic"];

/** Soft blends — cheap, atmospheric, used at plain scene boundaries. */
export const SOFT_TRANSITIONS: readonly TransitionKind[] = ["fade", "dissolve", "crossfade"];

/** Rotations used by the auto policy (deterministic index cycling). */
const DRAMATIC_ROTATION: readonly TransitionKind[] = ["zoom", "slide", "wipe"];
const SOFT_ROTATION: readonly TransitionKind[] = ["dissolve", "crossfade"];

/** A gap of at least this long between two clips is a "beat moment". */
export const BEAT_GAP_MS = 500;
/** A gap of at least this long is an act break → the strongest transition. */
export const ACT_BREAK_GAP_MS = 1200;
/** At least this many clip edges must pass between two non-cut transitions. */
export const DRAMA_MIN_CUTS = 3;
/** The lane the auto policy owns (the primary visual lane). */
export const AUTO_TRANSITION_TRACK: TrackId = "video";

export const CUT: ClipTransition = { kind: "cut", durationMs: 0 };

export function isTransitionKind(v: unknown): v is TransitionKind {
  return typeof v === "string" && (TRANSITION_KINDS as readonly string[]).includes(v);
}

export function transitionDef(kind: TransitionKind): TransitionDef {
  const def = TRANSITIONS.find((t) => t.kind === kind);
  if (!def) throw new EditorError("invalid_input", `Unknown transition kind "${String(kind)}".`);
  return def;
}

export function isDramatic(kind: string): boolean {
  return (DRAMATIC_TRANSITIONS as readonly string[]).includes(kind);
}

/** Deterministic default duration of a kind — the catalog midpoint. */
export function defaultDurationMs(kind: TransitionKind): number {
  const def = transitionDef(kind);
  return Math.round((def.durationMsMin + def.durationMsMax) / 2);
}

/** Catalog-clamped duration (0 stays 0 for a cut). */
export function clampDurationMs(kind: TransitionKind, durationMs?: number): number {
  const def = transitionDef(kind);
  if (def.durationMsMax === 0) return 0;
  const wanted = typeof durationMs === "number" && Number.isFinite(durationMs) ? Math.round(durationMs) : defaultDurationMs(kind);
  return Math.max(def.durationMsMin, Math.min(def.durationMsMax, wanted));
}

function cutTransition(): ClipTransition {
  return { kind: "cut", durationMs: 0 };
}

function spanOf(clip: Clip): number {
  return clip.endMs - clip.startMs;
}

/** `{ kind, durationMs }` → the canonical comparable form (for changelists). */
export function describeTransition(transition: ClipTransition | null | undefined): string {
  if (!transition) return "none";
  if (isTransitionKind(transition.kind) && transition.kind === "cut") return "cut";
  return `${transition.kind} (${Math.round(transition.durationMs)}ms)`;
}

/**
 * Largest usable duration for `kind` between two neighbours, or null when even
 * the catalog minimum does not fit inside half of the shorter neighbour.
 */
export function fitDurationMs(kind: TransitionKind, aSpanMs: number, bSpanMs: number): number | null {
  const def = transitionDef(kind);
  if (def.durationMsMax === 0) return 0;
  const room = Math.floor(Math.min(aSpanMs, bSpanMs) / 2);
  if (room < def.durationMsMin) return null;
  return Math.max(def.durationMsMin, Math.min(def.durationMsMax, Math.min(defaultDurationMs(kind), room)));
}

/* ------------------------------------------------------------------ */
/* Auto selection                                                      */
/* ------------------------------------------------------------------ */

export interface AutoSelectOptions {
  /** Lane to own. Defaults to "video" (AUTO_TRANSITION_TRACK). */
  trackId?: TrackId;
}

export interface AutoTransitionsReport {
  timeline: Timeline;
  /** Edges inspected on the lane. */
  edges: number;
  cuts: number;
  nonCut: number;
  dramatic: number;
  /** clipId → chosen transition (only non-cut ones). */
  placed: { clipId: string; kind: TransitionKind; durationMs: number }[];
}

/**
 * The auto policy in one call. Pure: returns a NEW timeline (canonical order +
 * derived duration) and never touches the input. See the module docstring for
 * the eight documented rules.
 */
export function autoSelectTransitions(timeline: Timeline, options: AutoSelectOptions = {}): Timeline {
  return planAutoTransitions(timeline, options).timeline;
}

/** Same as `autoSelectTransitions` but also returns the honest counters. */
export function planAutoTransitions(timeline: Timeline, options: AutoSelectOptions = {}): AutoTransitionsReport {
  const lane = options.trackId ?? AUTO_TRANSITION_TRACK;
  const trackId = isTrackId(lane) ? lane : AUTO_TRANSITION_TRACK;
  const clips = clipsAt(timeline, trackId);
  const chosen = new Map<string, ClipTransition>();
  const placed: { clipId: string; kind: TransitionKind; durationMs: number }[] = [];
  let cutsSinceNonCut = DRAMA_MIN_CUTS; // the first eligible boundary may carry a transition
  let dramaticIndex = 0;
  let softIndex = 0;
  let nonCut = 0;
  let dramatic = 0;
  let cuts = 0;

  for (let i = 0; i < clips.length; i += 1) {
    const clip = clips[i];
    const next = clips[i + 1];
    if (!next) continue; // last clip: no outgoing edge
    if (i === 0) {
      // Rule 2: the leading edge is always a hard cut and carries no record.
      cuts += 1;
      continue;
    }
    const gapMs = next.startMs - clip.endMs;
    const sameScene = clip.sceneId !== undefined && clip.sceneId === next.sceneId;
    const sceneBoundary = !sameScene && clip.sceneId !== next.sceneId;
    const beat = gapMs >= BEAT_GAP_MS;
    const candidate = !sameScene && (sceneBoundary || beat);
    const budget = cutsSinceNonCut >= DRAMA_MIN_CUTS;

    let picked: TransitionKind | null = null;
    if (candidate && budget) {
      if (gapMs >= ACT_BREAK_GAP_MS) picked = "cinematic";
      else if (beat) picked = DRAMATIC_ROTATION[dramaticIndex];
      else picked = SOFT_ROTATION[softIndex];
    }

    if (picked) {
      const durationMs = fitDurationMs(picked, spanOf(clip), spanOf(next));
      if (durationMs === null) {
        // Too short to hold even the shortest blend → honest cut.
        chosen.set(clip.id, cutTransition());
        cuts += 1;
        cutsSinceNonCut += 1;
        continue;
      }
      chosen.set(clip.id, { kind: picked, durationMs });
      placed.push({ clipId: clip.id, kind: picked, durationMs });
      nonCut += 1;
      if (isDramatic(picked)) dramatic += 1;
      if (beat) dramaticIndex += 1;
      else softIndex += 1;
      cutsSinceNonCut = 0;
      continue;
    }

    chosen.set(clip.id, cutTransition());
    cuts += 1;
    cutsSinceNonCut += 1;
  }

  const clips2 = timeline.clips.map((c) => {
    const replacement = chosen.get(c.id);
    // AUTHORITATIVE: every transition is reset, then the lane policy re-applies.
    return replacement ? { ...copyClip(c), transition: replacement } : { ...copyClip(c), transition: null };
  });

  return {
    timeline: rebuildTimeline(clips2, timeline.version),
    edges: Math.max(0, clips.length - 1),
    cuts,
    nonCut,
    dramatic,
    placed,
  };
}

/* ------------------------------------------------------------------ */
/* Manual override / removal                                           */
/* ------------------------------------------------------------------ */

export interface SetTransitionArgs {
  /** Target clip — its OUTGOING edge gets the transition. */
  clipId?: string;
  /**
   * Target scene — the scene's OUTGOING edge clip gets the transition. The
   * outgoing edge clip of a scene is the video-track clip with the GREATEST
   * endMs (the last one the scene hands over from). Providing both clipId and
   * sceneId, or neither, is an error (ambiguous target).
   */
  sceneId?: string;
  kind: TransitionKind;
  /** Clamped into the kind's catalog range; omitted → the catalog midpoint. */
  durationMs?: number;
}

/**
 * The scene's OUTGOING edge clip: the video-track clip of that scene with the
 * greatest endMs (the last one the scene hands over from). Falls back to the
 * scene's last clip on any track when the scene has no video clip. null when the
 * scene has no clips at all.
 */
export function outgoingClipForScene(timeline: Timeline, sceneId: string): Clip | null {
  const lane = clipsAt(timeline, AUTO_TRANSITION_TRACK).filter((c) => c.sceneId === sceneId);
  if (lane.length > 0) return lane.reduce((best, c) => (c.endMs > best.endMs ? c : best), lane[0]);
  const any = timeline.clips.filter((c) => c.sceneId === sceneId);
  if (any.length === 0) return null;
  return any.reduce((best, c) => (c.endMs > best.endMs ? c : best), any[0]);
}

/**
 * Set one clip's (or one scene's outgoing) transition. Deterministic: the kind
 * is validated against the catalog and the duration is clamped into the kind's
 * documented range. Unknown target → clip_not_found / scene_not_found.
 */
export function setTransition(timeline: Timeline, args: SetTransitionArgs): OpResult {
  if (args.clipId !== undefined && args.sceneId !== undefined) {
    throw new EditorError("invalid_input", "setTransition takes either clipId or sceneId, not both.");
  }
  if (!isTransitionKind(args.kind)) {
    throw new EditorError("invalid_input", `Unknown transition kind "${String(args.kind)}".`);
  }
  if (args.durationMs !== undefined && (!Number.isFinite(args.durationMs) || args.durationMs < 0)) {
    throw new EditorError("invalid_input", "setTransition.durationMs must be a finite, non-negative number.");
  }
  let clip: Clip | null = null;
  if (args.clipId !== undefined) {
    clip = timeline.clips.find((c) => c.id === args.clipId) ?? null;
    if (!clip) throw new EditorError("clip_not_found", `No clip with id "${String(args.clipId)}".`);
  } else if (args.sceneId !== undefined) {
    clip = outgoingClipForScene(timeline, args.sceneId);
    if (!clip) throw new EditorError("scene_not_found", `No clips for scene "${args.sceneId}".`);
  } else {
    throw new EditorError("invalid_input", "setTransition needs a clipId or a sceneId.");
  }

  const transition: ClipTransition = { kind: args.kind, durationMs: clampDurationMs(args.kind, args.durationMs) };
  const previous = clip.transition ?? null;
  if (previous && previous.kind === transition.kind && Math.round(previous.durationMs) === transition.durationMs) {
    return { timeline, changed: false };
  }
  const clips = timeline.clips.map((c) => (c.id === clip!.id ? { ...copyClip(c), transition } : copyClip(c)));
  return { timeline: rebuildTimeline(clips, timeline.version), changed: true };
}

/** Clear a clip's outgoing transition (→ null). Unknown clip → clip_not_found. */
export function removeTransition(timeline: Timeline, args: { clipId: string }): OpResult {
  const clip = timeline.clips.find((c) => c.id === args.clipId);
  if (!clip) throw new EditorError("clip_not_found", `No clip with id "${String(args.clipId)}".`);
  if (clip.transition === null || clip.transition === undefined) return { timeline, changed: false };
  const clips = timeline.clips.map((c) => (c.id === clip.id ? { ...copyClip(c), transition: null } : copyClip(c)));
  return { timeline: rebuildTimeline(clips, timeline.version), changed: true };
}

/** Every clip that carries a non-null transition, in canonical order. */
export function transitionsOn(timeline: Timeline, trackId?: TrackId): Clip[] {
  const clips = trackId ? clipsAt(timeline, trackId) : timeline.clips;
  return clips.filter((c) => c.transition !== null && c.transition !== undefined);
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

export type TransitionViolationCode =
  | "unknown_transition_kind"
  | "invalid_transition_duration"
  | "transition_longer_than_clip"
  | "transition_exceeds_half_clip"
  | "transition_on_first_clip";

export interface TransitionViolation {
  code: TransitionViolationCode;
  clipId: string;
  trackId: TrackId;
  detail: string;
}

/**
 * Deterministic violation list for a timeline (empty = clean). Checks, per
 * track: unknown kind, unusable duration, transition longer than its clip,
 * transition longer than half its clip, and a transition on the FIRST clip of a
 * lane (a timeline never opens with a transition).
 */
export function validateTransition(timeline: Timeline): TransitionViolation[] {
  const violations: TransitionViolation[] = [];
  const tracks = new Set<TrackId>(timeline.clips.map((c) => c.trackId));
  const firstOfTrack = new Map<TrackId, string>();
  for (const trackId of tracks) {
    const lane = clipsAt(timeline, trackId);
    if (lane.length > 0) firstOfTrack.set(trackId, lane[0].id);
  }

  for (const clip of timeline.clips) {
    const transition = clip.transition;
    if (transition === null || transition === undefined) continue;
    if (!isTransitionKind(transition.kind)) {
      violations.push({
        code: "unknown_transition_kind",
        clipId: clip.id,
        trackId: clip.trackId,
        detail: `"${String(transition.kind)}" is not one of the 8 supported transition kinds.`,
      });
      continue;
    }
    if (!Number.isFinite(transition.durationMs) || transition.durationMs < 0) {
      violations.push({
        code: "invalid_transition_duration",
        clipId: clip.id,
        trackId: clip.trackId,
        detail: `Transition duration must be a finite, non-negative number (got ${String(transition.durationMs)}).`,
      });
      continue;
    }
    const span = spanOf(clip);
    if (transition.durationMs > span) {
      violations.push({
        code: "transition_longer_than_clip",
        clipId: clip.id,
        trackId: clip.trackId,
        detail: `Transition is ${Math.round(transition.durationMs)}ms long but the clip is only ${span}ms.`,
      });
      continue;
    }
    if (transition.durationMs > span / 2) {
      violations.push({
        code: "transition_exceeds_half_clip",
        clipId: clip.id,
        trackId: clip.trackId,
        detail: `Transition uses ${Math.round(transition.durationMs)}ms of a ${span}ms clip — more than half the shot.`,
      });
    }
    if (transition.kind !== "cut" && firstOfTrack.get(clip.trackId) === clip.id) {
      violations.push({
        code: "transition_on_first_clip",
        clipId: clip.id,
        trackId: clip.trackId,
        detail:
          "The auto policy always opens a lane on a hard cut — a non-cut transition on the first clip is a manual override (nothing precedes it to blend from).",
      });
    }
  }
  return violations;
}

/** Honest summary of a timeline's transitions (used by the API + UI). */
export function transitionSummary(timeline: Timeline): {
  total: number;
  nonCut: number;
  dramatic: number;
  cuts: number;
  violations: TransitionViolation[];
} {
  const withTransition = transitionsOn(timeline);
  return {
    total: withTransition.length,
    nonCut: withTransition.filter((c) => c.transition!.kind !== "cut").length,
    dramatic: withTransition.filter((c) => isDramatic(c.transition!.kind)).length,
    cuts: withTransition.filter((c) => c.transition!.kind === "cut").length,
    violations: validateTransition(timeline),
  };
}
