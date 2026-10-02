/**
 * Phase 5 Block 1 — Editor timeline engine (deterministic, pure, no IO).
 *
 * A Timeline is a flat list of Clips distributed over EXACTLY nine tracks
 * (video, b-roll, voice, music, sfx, subtitles, images, text, graphics —
 * TRACKS order is the UI order). Every editing operation in this module is a
 * PURE function `(timeline, args) => { timeline, changed }`:
 *
 *   - the input timeline is NEVER mutated (a new object graph is returned),
 *   - `changed: false` means "valid request, nothing to do" (the SAME timeline
 *     reference is returned, so callers can skip a history commit),
 *   - structurally invalid input THROWS an `EditorError` with a machine
 *     readable `code` (clip_not_found, unknown_track, invalid_duration,
 *     invalid_split_point, scene_not_found, duplicate_clip, invalid_input).
 *
 * That is the single convention this engine follows — documented + tested.
 *
 * Deterministic invariants (documented defaults):
 *   - every millisecond value is an integer (inputs are Math.round()ed),
 *   - a clip always spans at least MIN_CLIP_MS (1 ms),
 *   - `timeline.durationMs` is DERIVED: the maximum clip end (0 when empty),
 *     recomputed by every operation,
 *   - `timeline.clips` is kept in a canonical order (track order → startMs →
 *     id) so equal timelines are structurally equal,
 *   - clip ids are derived deterministically (never random / Date.now()).
 *
 * OVERLAP POLICY (used by reorderClip / addScene / addClip):
 *   - SEQUENTIAL tracks (video, voice, subtitles — the scene-derived lanes)
 *     stay overlap-free: a clip landing on top of another is snapped forward
 *     to the next free slot that fits its full span.
 *   - OVERLAY tracks (broll, music, sfx, images, text, graphics) allow
 *     stacking; the requested position is honoured exactly.
 *
 * Nothing here calls an AI provider — Block 1 is pure deterministic editing.
 *
 * PHASE 5 BLOCK 2 additions (all BACKWARD COMPATIBLE — every new field is
 * optional, so Block 1 timelines keep validating and round-tripping):
 *   - `transition` is now interpreted by ./transitions (it was reserved in
 *     Block 1). It always describes the OUTGOING edge of a clip.
 *   - `subtitleStyle?: string | null` — the id of one of the 8 subtitle styles
 *     (Phase 4 `@/lib/subtitles`) that the scene's caption clips should use.
 *   - `grade?: string | null` — a colour-grade id kept on the visual clips.
 *     Block 4 owns the real grade catalog + renderer; Block 2 only records the
 *     user's choice so it survives save/load.
 */

export const TIMELINE_VERSION = 1;

/** A clip can never be shorter than this (ms). */
export const MIN_CLIP_MS = 1;

/** Default scene length when a scene has no durationSeconds (seconds). */
export const DEFAULT_SCENE_SECONDS = 5;

export type TrackId =
  | "video"
  | "broll"
  | "voice"
  | "music"
  | "sfx"
  | "subtitles"
  | "images"
  | "text"
  | "graphics";

export type TrackKind = "video" | "audio" | "caption" | "overlay";

export interface TrackDef {
  id: TrackId;
  /** UI label. */
  label: string;
  kind: TrackKind;
  /** true when clips on this track must not overlap (scene-derived lanes). */
  sequential: boolean;
}

/** UI order matters: this is the order the timeline rows are rendered in. */
export const TRACKS: readonly TrackDef[] = [
  { id: "video", label: "Video", kind: "video", sequential: true },
  { id: "broll", label: "B-roll", kind: "video", sequential: false },
  { id: "voice", label: "Voice", kind: "audio", sequential: true },
  { id: "music", label: "Music", kind: "audio", sequential: false },
  { id: "sfx", label: "SFX", kind: "audio", sequential: false },
  { id: "subtitles", label: "Subtitles", kind: "caption", sequential: true },
  { id: "images", label: "Images", kind: "overlay", sequential: false },
  { id: "text", label: "Text", kind: "overlay", sequential: false },
  { id: "graphics", label: "Graphics", kind: "overlay", sequential: false },
] as const;

export const TRACK_IDS: readonly TrackId[] = TRACKS.map((t) => t.id);

/** Tracks that carry an audio gain (0-1). Everything else rejects gain edits. */
export const AUDIO_TRACK_IDS: readonly TrackId[] = ["voice", "music", "sfx"];

/** Tracks whose clips are kept overlap-free. */
export const SEQUENTIAL_TRACK_IDS: readonly TrackId[] = ["video", "voice", "subtitles"];

/**
 * A transition on a clip's OUTGOING edge (how this clip hands off to the next
 * clip on the same track). `kind` is one of the 8 TransitionKinds in
 * ./transitions; `durationMs` is the overlap/length of the effect (0 for a cut).
 */
export interface ClipTransition {
  kind: string;
  durationMs: number;
}

export interface Clip {
  id: string;
  name: string;
  trackId: TrackId;
  /** The Scene this clip was derived from (absent for manual clips). */
  sceneId?: string;
  startMs: number;
  endMs: number;
  /** Where the content comes from (asset id, URL, "scene:<id>", …). */
  sourceRef?: string;
  /** Audio gain 0-1 — only meaningful on voice/music/sfx. */
  gain?: number;
  /**
   * The transition on this clip's OUTGOING edge (Block 2, see ./transitions).
   * null / absent = "no transition recorded" (the first clip of a track has no
   * outgoing edge, so it is always null there in an auto-selected timeline).
   */
  transition?: ClipTransition | null;
  /**
   * Block 2 (optional) — subtitle style id from `@/lib/subtitles`
   * (minimal|cinematic|modern|creator|bold|white|yellow|karaoke) applied to
   * this caption clip. Absent = the renderer's default style.
   */
  subtitleStyle?: string | null;
  /**
   * Block 2 (optional) — colour-grade id recorded on visual clips. Block 4 owns
   * the grade catalog and the renderer; this only persists the choice.
   */
  grade?: string | null;
}

export interface Timeline {
  version: number;
  /** Derived: max clip end (0 when empty). */
  durationMs: number;
  clips: Clip[];
}

/** A scene as the editor sees it (mirrors the Prisma Scene fields we use). */
export interface SceneInput {
  id: string;
  title?: string | null;
  narration?: string | null;
  durationSeconds?: number | null;
  /** Block 2 — the scene's stored visual prompt (Block 3 generates with it). */
  visualPrompt?: string | null;
}

export type EditorErrorCode =
  | "clip_not_found"
  | "scene_not_found"
  | "unknown_track"
  | "invalid_duration"
  | "invalid_split_point"
  | "duplicate_clip"
  | "invalid_input";

/** Typed error thrown by every editor operation on invalid input. */
export class EditorError extends Error {
  code: EditorErrorCode;
  constructor(code: EditorErrorCode, message: string) {
    super(message);
    this.name = "EditorError";
    this.code = code;
  }
}

/** Every op result: the next timeline + whether anything actually changed. */
export interface OpResult {
  timeline: Timeline;
  changed: boolean;
}

const NOOP = (timeline: Timeline): OpResult => ({ timeline, changed: false });

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isStr(v: unknown): v is string {
  return typeof v === "string";
}

function r(v: number): number {
  return Math.round(v);
}

/* ------------------------------------------------------------------ */
/* Track helpers                                                       */
/* ------------------------------------------------------------------ */

export function isTrackId(v: unknown): v is TrackId {
  return isStr(v) && (TRACK_IDS as readonly string[]).includes(v);
}

export function trackDef(id: TrackId): TrackDef {
  const def = TRACKS.find((t) => t.id === id);
  if (!def) throw new EditorError("unknown_track", `Unknown track "${String(id)}".`);
  return def;
}

function requireTrack(v: unknown): TrackId {
  if (!isTrackId(v)) throw new EditorError("unknown_track", `Unknown track "${String(v)}".`);
  return v;
}

export function isAudioTrack(id: TrackId): boolean {
  return (AUDIO_TRACK_IDS as readonly string[]).includes(id);
}

export function isSequentialTrack(id: TrackId): boolean {
  return (SEQUENTIAL_TRACK_IDS as readonly string[]).includes(id);
}

function trackIndex(id: TrackId): number {
  const i = (TRACK_IDS as readonly string[]).indexOf(id);
  return i < 0 ? TRACK_IDS.length : i;
}

/* ------------------------------------------------------------------ */
/* Derived helpers                                                     */
/* ------------------------------------------------------------------ */

/** Longest clip end (ms). 0 for an empty timeline. */
export function timelineDurationMs(timeline: Timeline): number {
  let max = 0;
  for (const c of timeline.clips) if (c.endMs > max) max = c.endMs;
  return max;
}

/** Clips on one track, ordered by startMs then id. Throws on unknown track. */
export function clipsAt(timeline: Timeline, trackId: TrackId): Clip[] {
  const track = requireTrack(trackId);
  return timeline.clips
    .filter((c) => c.trackId === track)
    .sort((a, b) => a.startMs - b.startMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Clips on `trackId` covering the given ms (start inclusive, end exclusive). */
export function clipsAtMs(timeline: Timeline, trackId: TrackId, ms: number): Clip[] {
  return clipsAt(timeline, trackId).filter((c) => c.startMs <= ms && ms < c.endMs);
}

/** The topmost clip under a playhead position, or null. */
export function clipAtMs(timeline: Timeline, trackId: TrackId, ms: number): Clip | null {
  return clipsAtMs(timeline, trackId, ms)[0] ?? null;
}

export function clipById(timeline: Timeline, clipId: string): Clip | null {
  return timeline.clips.find((c) => c.id === clipId) ?? null;
}

/** Clips derived from one scene, in canonical order. */
export function clipsForScene(timeline: Timeline, sceneId: string): Clip[] {
  return sortClips(timeline.clips.filter((c) => c.sceneId === sceneId));
}

/** "0:05.250" — pure display helper used by the editor UI. */
export function formatMs(ms: number): string {
  const safe = Math.max(0, r(ms));
  const total = Math.floor(safe / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  const millis = safe % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

/* ------------------------------------------------------------------ */
/* Internal construction helpers                                       */
/* ------------------------------------------------------------------ */

function sortClips(clips: Clip[]): Clip[] {
  return [...clips].sort(
    (a, b) =>
      trackIndex(a.trackId) - trackIndex(b.trackId) ||
      a.startMs - b.startMs ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}

function cloneClip(c: Clip): Clip {
  return { ...c, transition: c.transition === undefined ? undefined : c.transition };
}

/** Rebuilds a Timeline: canonical clip order + derived duration. */
function rebuild(clips: Clip[], version: number): Timeline {
  const sorted = sortClips(clips);
  return { version, durationMs: timelineDurationMs({ version, durationMs: 0, clips: sorted }), clips: sorted };
}

/**
 * Public wrapper around the canonical rebuild (Block 2 helpers — transitions,
 * scene controls — build timelines through this so they inherit the exact same
 * canonical order + derived duration as every Block 1 operation).
 */
export function rebuildTimeline(clips: Clip[], version: number = TIMELINE_VERSION): Timeline {
  return rebuild(clips, version);
}

/** Shallow copy of a clip (keeps `transition` semantics: undefined stays undefined). */
export function copyClip(clip: Clip): Clip {
  return { ...clip };
}

function requireClip(timeline: Timeline, clipId: string): Clip {
  const clip = timeline.clips.find((c) => c.id === clipId);
  if (!clip) throw new EditorError("clip_not_found", `No clip with id "${String(clipId)}".`);
  return clip;
}

/** Deterministic free clip id: `${base}`, `${base}-2`, `${base}-3`, … */
export function nextClipId(timeline: Timeline, base: string): string {
  const taken = new Set(timeline.clips.map((c) => c.id));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}-${n}`)) n += 1;
  return `${base}-${n}`;
}

/**
 * First position ≥ `desired` where a clip of `spanMs` fits without overlapping
 * the existing clips of that track. Overlay tracks honour `desired` exactly.
 */
function placeClip(
  others: Clip[],
  trackId: TrackId,
  desired: number,
  spanMs: number,
): number {
  if (!isSequentialTrack(trackId)) return Math.max(0, r(desired));
  const occupied = others
    .filter((c) => c.trackId === trackId)
    .map((c) => ({ start: c.startMs, end: c.endMs }))
    .sort((a, b) => a.start - b.start);
  let candidate = Math.max(0, r(desired));
  let moved = true;
  let guard = 0;
  while (moved && guard < 1000) {
    moved = false;
    guard += 1;
    for (const occ of occupied) {
      if (candidate < occ.end && candidate + spanMs > occ.start) {
        candidate = occ.end;
        moved = true;
      }
    }
  }
  return candidate;
}

/** Structural (deep, order-sensitive) equality of two timelines. */
export function timelinesEqual(a: Timeline, b: Timeline): boolean {
  if (a === b) return true;
  if (a.version !== b.version || a.durationMs !== b.durationMs) return false;
  if (a.clips.length !== b.clips.length) return false;
  for (let i = 0; i < a.clips.length; i += 1) {
    const x = a.clips[i];
    const y = b.clips[i];
    if (
      x.id !== y.id ||
      x.name !== y.name ||
      x.trackId !== y.trackId ||
      x.sceneId !== y.sceneId ||
      x.startMs !== y.startMs ||
      x.endMs !== y.endMs ||
      x.sourceRef !== y.sourceRef ||
      x.gain !== y.gain ||
      (x.subtitleStyle ?? null) !== (y.subtitleStyle ?? null) ||
      (x.grade ?? null) !== (y.grade ?? null) ||
      JSON.stringify(x.transition ?? null) !== JSON.stringify(y.transition ?? null)
    ) {
      return false;
    }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Initial timeline                                                    */
/* ------------------------------------------------------------------ */

/** Duration of a scene in ms: durationSeconds when > 0, else 5 s default. */
export function sceneDurationMs(scene: SceneInput): number {
  const secs = isNum(scene.durationSeconds) && scene.durationSeconds > 0 ? scene.durationSeconds : DEFAULT_SCENE_SECONDS;
  return Math.max(MIN_CLIP_MS, r(secs * 1000));
}

/**
 * Initial timeline from the project's scenes.
 *
 * Deterministic defaults (documented):
 *   - scenes are laid out back-to-back in the given order, starting at 0,
 *   - each scene → ONE clip on "video" (span = durationSeconds ?? 5 s),
 *   - a scene WITH narration also gets a "voice" clip over the same span,
 *   - EVERY scene gets a "subtitles" placeholder clip over the same span,
 *   - clip ids are `sc-<sceneId>-video|voice|subtitles`, so building twice
 *     from the same scenes yields a structurally identical timeline,
 *   - duplicate scene ids throw invalid_input.
 */
export function buildTimelineFromScenes(scenes: SceneInput[]): Timeline {
  const clips: Clip[] = [];
  const seen = new Set<string>();
  let cursor = 0;
  scenes.forEach((scene, index) => {
    if (!scene || !isStr(scene.id) || !scene.id.trim()) {
      throw new EditorError("invalid_input", "Every scene needs a non-empty id.");
    }
    if (seen.has(scene.id)) {
      throw new EditorError("invalid_input", `Duplicate scene id "${scene.id}".`);
    }
    seen.add(scene.id);
    const span = sceneDurationMs(scene);
    const label = isStr(scene.title) && scene.title.trim() ? scene.title.trim() : `Scene ${index + 1}`;
    const start = cursor;
    const end = cursor + span;
    clips.push({
      id: `sc-${scene.id}-video`,
      name: label,
      trackId: "video",
      sceneId: scene.id,
      startMs: start,
      endMs: end,
      sourceRef: `scene:${scene.id}`,
      transition: null,
    });
    if (isStr(scene.narration) && scene.narration.trim()) {
      clips.push({
        id: `sc-${scene.id}-voice`,
        name: `Voice — ${label}`,
        trackId: "voice",
        sceneId: scene.id,
        startMs: start,
        endMs: end,
        sourceRef: "voice:auto",
      });
    }
    clips.push({
      id: `sc-${scene.id}-subtitles`,
      name: `Subtitles — ${label}`,
      trackId: "subtitles",
      sceneId: scene.id,
      startMs: start,
      endMs: end,
      sourceRef: "subtitle:auto",
    });
    cursor = end;
  });
  return rebuild(clips, TIMELINE_VERSION);
}

/** True when the timeline contains at least one clip for this scene. */
export function hasScene(timeline: Timeline, sceneId: string): boolean {
  return timeline.clips.some((c) => c.sceneId === sceneId);
}

/* ------------------------------------------------------------------ */
/* Editing operations (pure)                                           */
/* ------------------------------------------------------------------ */

export interface TrimClipArgs {
  clipId: string;
  /** New absolute start (ms). Omitted → unchanged. */
  startMs?: number;
  /** New absolute end (ms). Omitted → unchanged. */
  endMs?: number;
}

/**
 * Trim absolute in/out points.
 * Clamping order is deterministic: the START is clamped into
 * `[0, originalEnd - MIN_CLIP_MS]`, then the END is clamped to
 * `[start + MIN_CLIP_MS, ∞)` — so a clip is always ≥ 1 ms and never inverts.
 */
export function trimClip(timeline: Timeline, args: TrimClipArgs): OpResult {
  const clip = requireClip(timeline, args.clipId);
  if (args.startMs !== undefined && !isNum(args.startMs)) {
    throw new EditorError("invalid_input", "trimClip.startMs must be a finite number.");
  }
  if (args.endMs !== undefined && !isNum(args.endMs)) {
    throw new EditorError("invalid_input", "trimClip.endMs must be a finite number.");
  }
  const upper = Math.max(0, clip.endMs - MIN_CLIP_MS);
  const start = Math.min(Math.max(0, r(args.startMs ?? clip.startMs)), upper);
  const end = Math.max(start + MIN_CLIP_MS, r(args.endMs ?? clip.endMs));
  if (start === clip.startMs && end === clip.endMs) return NOOP(timeline);
  const clips = timeline.clips.map((c) => (c.id === clip.id ? { ...c, startMs: start, endMs: end } : cloneClip(c)));
  return { timeline: rebuild(clips, timeline.version), changed: true };
}

export interface SplitClipArgs {
  clipId: string;
  /** Split point — must be strictly inside the clip. */
  atMs: number;
}

/**
 * Split one clip into two ADJACENT clips that exactly cover the original span.
 * The original id keeps the first half; the second half gets a deterministic
 * new id (`<id>-b`, `<id>-b-2`, …). A split point on/beyond either edge throws
 * invalid_split_point.
 */
export function splitClip(timeline: Timeline, args: SplitClipArgs): OpResult {
  const clip = requireClip(timeline, args.clipId);
  if (!isNum(args.atMs)) throw new EditorError("invalid_input", "splitClip.atMs must be a finite number.");
  const at = r(args.atMs);
  if (at <= clip.startMs || at >= clip.endMs) {
    throw new EditorError(
      "invalid_split_point",
      `Split point ${at}ms must be strictly inside the clip (${clip.startMs}-${clip.endMs}ms).`,
    );
  }
  const second: Clip = {
    ...clip,
    id: nextClipId(timeline, `${clip.id}-b`),
    name: `${clip.name} (2)`,
    startMs: at,
    endMs: clip.endMs,
  };
  const clips = timeline.clips.map((c) =>
    c.id === clip.id ? { ...c, endMs: at } : cloneClip(c),
  );
  clips.push(second);
  return { timeline: rebuild(clips, timeline.version), changed: true };
}

export function deleteClip(timeline: Timeline, args: { clipId: string }): OpResult {
  const clip = requireClip(timeline, args.clipId);
  return {
    timeline: rebuild(
      timeline.clips.filter((c) => c.id !== clip.id).map(cloneClip),
      timeline.version,
    ),
    changed: true,
  };
}

export interface DuplicateClipArgs {
  clipId: string;
  /** Shift from the ORIGINAL start. Default: place right after the source. */
  offsetMs?: number;
}

/**
 * Copy a clip (new id, same span, same track).
 * Default placement is immediately AFTER the source clip (no overlap);
 * pass `offsetMs` to shift from the original start instead (clamped at 0).
 */
export function duplicateClip(timeline: Timeline, args: DuplicateClipArgs): OpResult {
  const clip = requireClip(timeline, args.clipId);
  if (args.offsetMs !== undefined && !isNum(args.offsetMs)) {
    throw new EditorError("invalid_input", "duplicateClip.offsetMs must be a finite number.");
  }
  const span = clip.endMs - clip.startMs;
  const start = args.offsetMs === undefined ? clip.endMs : Math.max(0, clip.startMs + r(args.offsetMs));
  const copy: Clip = {
    ...clip,
    id: nextClipId(timeline, `${clip.id}-copy`),
    name: `${clip.name} copy`,
    startMs: start,
    endMs: start + span,
  };
  return {
    timeline: rebuild([...timeline.clips.map(cloneClip), copy], timeline.version),
    changed: true,
  };
}

export interface ReplaceClipArgs {
  clipId: string;
  /** New display name. */
  name?: string;
  /** New content reference (asset id / URL / scene ref). null clears it. */
  sourceRef?: string | null;
  /** Re-bind the clip to another scene. null clears it. */
  sceneId?: string | null;
}

/**
 * Swap a clip's content while PRESERVING its id, track and span.
 * Only the fields present in `args` are touched.
 */
export function replaceClip(timeline: Timeline, args: ReplaceClipArgs): OpResult {
  const clip = requireClip(timeline, args.clipId);
  const next: Clip = { ...clip };
  let changed = false;
  if (args.name !== undefined) {
    if (!isStr(args.name) || !args.name.trim()) {
      throw new EditorError("invalid_input", "replaceClip.name must be a non-empty string.");
    }
    if (next.name !== args.name.trim()) {
      next.name = args.name.trim();
      changed = true;
    }
  }
  if (args.sourceRef !== undefined) {
    const value = args.sourceRef === null ? undefined : args.sourceRef;
    if (value !== undefined && !isStr(value)) {
      throw new EditorError("invalid_input", "replaceClip.sourceRef must be a string or null.");
    }
    if (next.sourceRef !== value) {
      next.sourceRef = value;
      changed = true;
    }
  }
  if (args.sceneId !== undefined) {
    const value = args.sceneId === null ? undefined : args.sceneId;
    if (value !== undefined && !isStr(value)) {
      throw new EditorError("invalid_input", "replaceClip.sceneId must be a string or null.");
    }
    if (next.sceneId !== value) {
      next.sceneId = value;
      changed = true;
    }
  }
  if (!changed) return NOOP(timeline);
  const clips = timeline.clips.map((c) => (c.id === clip.id ? next : cloneClip(c)));
  return { timeline: rebuild(clips, timeline.version), changed: true };
}

export interface ReorderClipArgs {
  clipId: string;
  /** Destination track (defaults to the clip's current track). */
  trackId?: TrackId;
  /** Requested destination start (ms, clamped at 0). */
  startMs: number;
}

/**
 * The drag-and-drop / reorder primitive: move a clip to (trackId, startMs)
 * keeping its span. See the module header for the overlap policy:
 * sequential tracks snap forward to the first free slot that fits,
 * overlay tracks honour the requested position exactly.
 */
export function reorderClip(timeline: Timeline, args: ReorderClipArgs): OpResult {
  const clip = requireClip(timeline, args.clipId);
  if (!isNum(args.startMs)) {
    throw new EditorError("invalid_input", "reorderClip.startMs must be a finite number.");
  }
  const targetTrack = args.trackId === undefined ? clip.trackId : requireTrack(args.trackId);
  const span = clip.endMs - clip.startMs;
  const others = timeline.clips.filter((c) => c.id !== clip.id);
  const start = placeClip(others, targetTrack, args.startMs, span);
  if (targetTrack === clip.trackId && start === clip.startMs) return NOOP(timeline);
  const moved: Clip = { ...clip, trackId: targetTrack, startMs: start, endMs: start + span };
  return {
    timeline: rebuild([...others.map(cloneClip), moved], timeline.version),
    changed: true,
  };
}

export interface ChangeDurationArgs {
  clipId: string;
  /** New clip duration (ms). Negative → invalid_duration. */
  durationMs: number;
}

/** Set a clip's duration, keeping its start. Clamped up to MIN_CLIP_MS. */
export function changeDuration(timeline: Timeline, args: ChangeDurationArgs): OpResult {
  const clip = requireClip(timeline, args.clipId);
  if (!isNum(args.durationMs)) {
    throw new EditorError("invalid_input", "changeDuration.durationMs must be a finite number.");
  }
  if (args.durationMs < 0) {
    throw new EditorError("invalid_duration", "Clip duration cannot be negative.");
  }
  const duration = Math.max(MIN_CLIP_MS, r(args.durationMs));
  const end = clip.startMs + duration;
  if (end === clip.endMs) return NOOP(timeline);
  const clips = timeline.clips.map((c) => (c.id === clip.id ? { ...c, endMs: end } : cloneClip(c)));
  return { timeline: rebuild(clips, timeline.version), changed: true };
}

export interface AdjustVolumeArgs {
  clipId: string;
  /** 0-1, clamped. Ignored (no-op) on non-audio tracks. */
  gain: number;
}

/**
 * Set an audio clip's gain, clamped to 0-1 (rounded to 3 decimals).
 * Clips on non-audio tracks (video, b-roll, subtitles, images, text,
 * graphics) are a documented NO-OP: `changed: false`, timeline untouched.
 */
export function adjustVolume(timeline: Timeline, args: AdjustVolumeArgs): OpResult {
  const clip = requireClip(timeline, args.clipId);
  if (!isNum(args.gain)) {
    throw new EditorError("invalid_input", "adjustVolume.gain must be a finite number.");
  }
  if (!isAudioTrack(clip.trackId)) return NOOP(timeline);
  const gain = Math.round(Math.min(1, Math.max(0, args.gain)) * 1000) / 1000;
  if (clip.gain === gain) return NOOP(timeline);
  const clips = timeline.clips.map((c) => (c.id === clip.id ? { ...c, gain } : cloneClip(c)));
  return { timeline: rebuild(clips, timeline.version), changed: true };
}

export interface AddSceneArgs {
  scene: SceneInput;
  /** Where to insert. Default: appended at the end of the timeline. */
  atMs?: number;
}

/**
 * Add one scene's clips to the timeline: video (always) + voice (when the
 * scene has narration) + subtitles placeholder, over one shared span on the
 * scene-derived sequential tracks. Scene ids already present → duplicate_clip.
 */
export function addScene(timeline: Timeline, args: AddSceneArgs): OpResult {
  const scene = args.scene;
  if (!scene || !isStr(scene.id) || !scene.id.trim()) {
    throw new EditorError("invalid_input", "addScene.scene.id must be a non-empty string.");
  }
  if (hasScene(timeline, scene.id) || timeline.clips.some((c) => c.id === `sc-${scene.id}-video`)) {
    throw new EditorError("duplicate_clip", `Scene "${scene.id}" is already on the timeline.`);
  }
  if (args.atMs !== undefined && !isNum(args.atMs)) {
    throw new EditorError("invalid_input", "addScene.atMs must be a finite number.");
  }
  const span = sceneDurationMs(scene);
  const label = isStr(scene.title) && scene.title.trim() ? scene.title.trim() : `Scene ${sceneCount(timeline) + 1}`;
  const desired = args.atMs === undefined ? timelineDurationMs(timeline) : args.atMs;
  const start = placeClip(timeline.clips, "video", desired, span);
  const end = start + span;
  const added: Clip[] = [
    {
      id: nextClipId(timeline, `sc-${scene.id}-video`),
      name: label,
      trackId: "video",
      sceneId: scene.id,
      startMs: start,
      endMs: end,
      sourceRef: `scene:${scene.id}`,
      transition: null,
    },
  ];
  if (isStr(scene.narration) && scene.narration.trim()) {
    added.push({
      id: nextClipId(timeline, `sc-${scene.id}-voice`),
      name: `Voice — ${label}`,
      trackId: "voice",
      sceneId: scene.id,
      startMs: start,
      endMs: end,
      sourceRef: "voice:auto",
    });
  }
  added.push({
    id: nextClipId(timeline, `sc-${scene.id}-subtitles`),
    name: `Subtitles — ${label}`,
    trackId: "subtitles",
    sceneId: scene.id,
    startMs: start,
    endMs: end,
    sourceRef: "subtitle:auto",
  });
  return {
    timeline: rebuild([...timeline.clips.map(cloneClip), ...added], timeline.version),
    changed: true,
  };
}

export interface RemoveSceneArgs {
  sceneId: string;
}

/**
 * Remove every clip derived from a scene. The rest of the timeline is left
 * exactly where it is (gaps are legal — durationMs is derived from clips),
 * so the result is always a valid timeline. Unknown scene → scene_not_found.
 */
export function removeScene(timeline: Timeline, args: RemoveSceneArgs): OpResult {
  if (!isStr(args.sceneId) || !args.sceneId.trim()) {
    throw new EditorError("invalid_input", "removeScene.sceneId must be a non-empty string.");
  }
  const doomed = timeline.clips.filter((c) => c.sceneId === args.sceneId);
  if (doomed.length === 0) {
    throw new EditorError("scene_not_found", `No clips for scene "${args.sceneId}".`);
  }
  const ids = new Set(doomed.map((c) => c.id));
  return {
    timeline: rebuild(
      timeline.clips.filter((c) => !ids.has(c.id)).map(cloneClip),
      timeline.version,
    ),
    changed: true,
  };
}

export interface AddClipArgs {
  name: string;
  trackId: TrackId;
  startMs: number;
  /** Provide one of durationMs / endMs (durationMs wins; default 5 s). */
  durationMs?: number;
  endMs?: number;
  id?: string;
  sceneId?: string;
  sourceRef?: string;
  gain?: number;
}

/** Add a manual clip (music bed, SFX cue, image overlay, text card, …). */
export function addClip(timeline: Timeline, args: AddClipArgs): OpResult {
  if (!isStr(args.name) || !args.name.trim()) {
    throw new EditorError("invalid_input", "addClip.name must be a non-empty string.");
  }
  const track = requireTrack(args.trackId);
  if (!isNum(args.startMs)) {
    throw new EditorError("invalid_input", "addClip.startMs must be a finite number.");
  }
  let span = DEFAULT_SCENE_SECONDS * 1000;
  if (args.durationMs !== undefined) {
    if (!isNum(args.durationMs) || args.durationMs < 0) {
      throw new EditorError("invalid_duration", "addClip.durationMs must be a finite, non-negative number.");
    }
    span = Math.max(MIN_CLIP_MS, r(args.durationMs));
  }
  if (args.id !== undefined && (!isStr(args.id) || !args.id.trim())) {
    throw new EditorError("invalid_input", "addClip.id must be a non-empty string when provided.");
  }
  if (args.id && timeline.clips.some((c) => c.id === args.id)) {
    throw new EditorError("duplicate_clip", `Clip id "${args.id}" already exists.`);
  }
  if (args.gain !== undefined && !isNum(args.gain)) {
    throw new EditorError("invalid_input", "addClip.gain must be a finite number.");
  }
  const start = placeClip(timeline.clips, track, args.startMs, span);
  const end = args.endMs !== undefined && args.durationMs === undefined ? Math.max(start + MIN_CLIP_MS, r(args.endMs)) : start + span;
  const clip: Clip = {
    id: args.id ?? nextClipId(timeline, `clip-${track}-${timeline.clips.length + 1}`),
    name: args.name.trim(),
    trackId: track,
    startMs: start,
    endMs: end,
    sourceRef: args.sourceRef,
    gain: isAudioTrack(track) && args.gain !== undefined ? Math.round(Math.min(1, Math.max(0, args.gain)) * 1000) / 1000 : undefined,
    sceneId: args.sceneId,
    transition: null,
  };
  return {
    timeline: rebuild([...timeline.clips.map(cloneClip), clip], timeline.version),
    changed: true,
  };
}

function sceneCount(timeline: Timeline): number {
  const ids = new Set<string>();
  for (const c of timeline.clips) if (c.sceneId) ids.add(c.sceneId);
  return ids.size;
}
