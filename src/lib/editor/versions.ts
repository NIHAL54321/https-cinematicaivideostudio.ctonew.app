/**
 * Phase 5 Block 1 — Timeline serialisation / validation (pure, no IO).
 *
 * Snapshots are stored in `ProjectVersion.snapshot` (Json) and the working
 * timeline in `ProjectSettings.extra.editorTimeline` (Json) — no schema
 * migration in Block 1. Everything here is JSON-safe and round-trips
 * losslessly:
 *
 *   restoreTimeline(serializeTimeline(t))  deep-equals  t
 *   validateTimelineShape(toSnapshot(t))   →  { ok: true, timeline deep-equals t }
 *
 * `validateTimelineShape` is the lightweight structural check the editor API
 * uses on every save: it canonicalises ms values, drops malformed clips
 * (reporting how many) and rejects anything that is not a timeline at all.
 */
import {
  AUDIO_TRACK_IDS,
  EditorError,
  MIN_CLIP_MS,
  TIMELINE_VERSION,
  TRACK_IDS,
  isTrackId,
  timelinesEqual,
  type Clip,
  type ClipTransition,
  type Timeline,
  type TrackId,
} from "./timeline";

export const EDITOR_TIMELINE_FORMAT = "cavis.editor.timeline";

/** Hard cap so a hostile payload cannot blow up the DB / the browser. */
export const MAX_CLIPS = 5000;

export interface EditorTimelineSnapshot {
  format: typeof EDITOR_TIMELINE_FORMAT;
  version: number;
  /** Derived, duplicated for cheap list views. */
  clipCount: number;
  durationMs: number;
  timeline: Timeline;
  createdAt?: string;
  note?: string;
}

export interface ValidationOk {
  ok: true;
  timeline: Timeline;
  /** Clips that could not be understood and were dropped. */
  dropped: number;
}

export interface ValidationFail {
  ok: false;
  error: string;
  code: string;
}

export type ValidationResult = ValidationOk | ValidationFail;

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function parseTransition(v: unknown): ClipTransition | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (isObj(v) && typeof v.kind === "string" && isNum(v.durationMs)) {
    return { kind: v.kind, durationMs: Math.round(v.durationMs) };
  }
  return null;
}

function normaliseClip(raw: unknown): Clip | null {
  if (!isObj(raw)) return null;
  const { id, name, trackId } = raw;
  if (typeof id !== "string" || !id.trim()) return null;
  if (typeof name !== "string" || !name.trim()) return null;
  if (!isTrackId(trackId)) return null;
  const startMs = raw.startMs;
  const endMs = raw.endMs;
  if (!isNum(startMs) || !isNum(endMs)) return null;
  const start = Math.max(0, Math.round(startMs));
  const end = Math.round(endMs);
  if (end - start < MIN_CLIP_MS) return null;
  const clip: Clip = { id: id.trim(), name: name.trim(), trackId, startMs: start, endMs: end };
  if (typeof raw.sceneId === "string" && raw.sceneId.trim()) clip.sceneId = raw.sceneId.trim();
  if (typeof raw.sourceRef === "string" && raw.sourceRef.trim()) clip.sourceRef = raw.sourceRef.trim();
  if (isNum(raw.gain) && (AUDIO_TRACK_IDS as readonly string[]).includes(trackId as TrackId)) {
    clip.gain = Math.round(Math.min(1, Math.max(0, raw.gain)) * 1000) / 1000;
  }
  const transition = parseTransition(raw.transition);
  if (transition !== undefined) clip.transition = transition;
  // Block 2 optional fields — carried through save/load so a saved timeline keeps
  // the subtitle style and colour grade the user picked (both are plain ids).
  const subtitleStyle = nullableId(raw.subtitleStyle);
  if (subtitleStyle !== undefined) clip.subtitleStyle = subtitleStyle;
  const grade = nullableId(raw.grade);
  if (grade !== undefined) clip.grade = grade;
  return clip;
}

/** `undefined` keeps the field absent; null clears it; a blank string is ignored. */
function nullableId(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "string") return v.trim() ? v.trim() : null;
  return undefined;
}

function trackIndex(id: TrackId): number {
  return (TRACK_IDS as readonly string[]).indexOf(id);
}

/** Canonical, JSON-safe form of a timeline (integers, canonical clip order). */
export function canonicalTimeline(timeline: Timeline): Timeline {
  const clips = timeline.clips
    .map((c) => {
      const clip: Clip = {
        ...c,
        startMs: Math.max(0, Math.round(c.startMs)),
        endMs: Math.round(c.endMs),
      };
      if (clip.gain !== undefined) clip.gain = Math.round(Math.min(1, Math.max(0, clip.gain)) * 1000) / 1000;
      return clip;
    })
    .sort(
      (a, b) =>
        trackIndex(a.trackId) - trackIndex(b.trackId) ||
        a.startMs - b.startMs ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  const durationMs = clips.reduce((max, c) => (c.endMs > max ? c.endMs : max), 0);
  return { version: timeline.version || TIMELINE_VERSION, durationMs, clips };
}

/**
 * Lightweight structural validation + normalisation.
 * Not a timeline object at all, an empty/oversized clip list or a missing
 * timeline key → `{ ok: false }`; otherwise the canonical timeline plus the
 * number of malformed clips that were dropped.
 */
export function validateTimelineShape(value: unknown): ValidationResult {
  let candidate = value;
  // Accept a full snapshot envelope as well as a bare timeline.
  if (isObj(candidate) && candidate.format === EDITOR_TIMELINE_FORMAT) candidate = candidate.timeline;
  if (!isObj(candidate)) {
    return { ok: false, error: "Timeline must be an object.", code: "invalid_timeline" };
  }
  const clips = candidate.clips;
  if (!Array.isArray(clips)) {
    return { ok: false, error: "Timeline.clips must be an array.", code: "invalid_timeline" };
  }
  if (clips.length > MAX_CLIPS) {
    return { ok: false, error: `Timeline exceeds the ${MAX_CLIPS}-clip limit.`, code: "timeline_too_large" };
  }
  const kept: Clip[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const raw of clips) {
    const clip = normaliseClip(raw);
    if (!clip || seen.has(clip.id)) {
      dropped += 1;
      continue;
    }
    seen.add(clip.id);
    kept.push(clip);
  }
  if (clips.length > 0 && kept.length === 0) {
    return { ok: false, error: "Every clip in the timeline is malformed.", code: "invalid_timeline" };
  }
  const version = isNum(candidate.version) ? Math.round(candidate.version) : TIMELINE_VERSION;
  return { ok: true, timeline: canonicalTimeline({ version, durationMs: 0, clips: kept }), dropped };
}

/* ------------------------------------------------------------------ */
/* Serialisation                                                       */
/* ------------------------------------------------------------------ */

/** Timeline → JSON string. `restoreTimeline` is the exact inverse. */
export function serializeTimeline(timeline: Timeline): string {
  return JSON.stringify(canonicalTimeline(timeline));
}

/** JSON string → Timeline. Throws EditorError("invalid_input") on garbage. */
export function restoreTimeline(json: string): Timeline {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new EditorError("invalid_input", "Timeline JSON could not be parsed.");
  }
  const check = validateTimelineShape(parsed);
  if (!check.ok) throw new EditorError("invalid_input", check.error);
  return check.timeline;
}

/** Timeline → the exact object stored in ProjectVersion.snapshot. */
export function toSnapshot(
  timeline: Timeline,
  meta: { note?: string; createdAt?: string } = {},
): EditorTimelineSnapshot {
  const canonical = canonicalTimeline(timeline);
  const snapshot: EditorTimelineSnapshot = {
    format: EDITOR_TIMELINE_FORMAT,
    version: TIMELINE_VERSION,
    clipCount: canonical.clips.length,
    durationMs: canonical.durationMs,
    timeline: canonical,
  };
  if (meta.note) snapshot.note = meta.note;
  if (meta.createdAt) snapshot.createdAt = meta.createdAt;
  return snapshot;
}

/** Snapshot (or bare timeline) → Timeline, or null when unreadable. */
export function fromSnapshot(value: unknown): Timeline | null {
  const check = validateTimelineShape(value);
  return check.ok ? check.timeline : null;
}

export function isEditorSnapshot(value: unknown): boolean {
  return isObj(value) && value.format === EDITOR_TIMELINE_FORMAT && isObj(value.timeline);
}

/** Size in bytes of the stored JSON — used by the versions list (no payload). */
export function snapshotBytes(snapshot: unknown): number {
  try {
    return JSON.stringify(snapshot ?? null).length;
  } catch {
    return 0;
  }
}

/** Scene count present on a timeline (for summaries). */
export function snapshotSceneCount(timeline: Timeline): number {
  const ids = new Set<string>();
  for (const c of timeline.clips) if (c.sceneId) ids.add(c.sceneId);
  return ids.size;
}

/** Round-trip assertion helper (used by tests and the API smoke path). */
export function roundTrips(timeline: Timeline): boolean {
  try {
    return timelinesEqual(timeline, restoreTimeline(serializeTimeline(timeline)));
  } catch {
    return false;
  }
}
