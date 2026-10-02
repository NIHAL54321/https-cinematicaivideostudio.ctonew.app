/**
 * Phase 5 Block 1 — Editor undo/redo history (pure, no IO).
 *
 * EditorHistory is the classic three-stack shape:
 *   past[]   — older timelines, most recent LAST
 *   present  — the timeline currently shown
 *   future[] — undone timelines, NEXT REDO FIRST (future[0])
 *
 * Every function is pure: the input history object is never mutated.
 * `commit` after an `undo` clears `future` (standard linear history).
 * `past` is capped at `limit` entries (oldest dropped first).
 */
import { timelinesEqual, type Timeline } from "./timeline";

export const DEFAULT_HISTORY_LIMIT = 50;

export interface EditorHistory {
  past: Timeline[];
  present: Timeline;
  future: Timeline[];
  limit: number;
}

export function createHistory(present: Timeline, limit = DEFAULT_HISTORY_LIMIT): EditorHistory {
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error("History limit must be a positive integer.");
  }
  return { past: [], present, future: [], limit: Math.floor(limit) };
}

export function canUndo(history: EditorHistory): boolean {
  return history.past.length > 0;
}

export function canRedo(history: EditorHistory): boolean {
  return history.future.length > 0;
}

/**
 * Record a new present. A commit that would not change anything (same
 * reference, or a structurally equal timeline) is ignored — the same history
 * object is returned and `future` is preserved.
 */
export function commit(history: EditorHistory, next: Timeline): EditorHistory {
  if (next === history.present || timelinesEqual(history.present, next)) return history;
  const past = [...history.past, history.present];
  const overflow = past.length - history.limit;
  return {
    past: overflow > 0 ? past.slice(overflow) : past,
    present: next,
    future: [],
    limit: history.limit,
  };
}

/** Step back one edit. No-op (same object) when there is nothing to undo. */
export function undo(history: EditorHistory): EditorHistory {
  if (history.past.length === 0) return history;
  const past = history.past.slice(0, -1);
  const previous = history.past[history.past.length - 1];
  return {
    past,
    present: previous,
    future: [history.present, ...history.future],
    limit: history.limit,
  };
}

/** Replay the next undone edit. No-op (same object) when there is none. */
export function redo(history: EditorHistory): EditorHistory {
  if (history.future.length === 0) return history;
  const [next, ...rest] = history.future;
  return {
    past: [...history.past, history.present],
    present: next,
    future: rest,
    limit: history.limit,
  };
}

/** Drop all history and start again from `present` (e.g. after a restore). */
export function reset(history: EditorHistory, present: Timeline): EditorHistory {
  return { past: [], present, future: [], limit: history.limit };
}

/** Convenience for UI rendering. */
export function historyState(history: EditorHistory): {
  canUndo: boolean;
  canRedo: boolean;
  depth: number;
  futureDepth: number;
} {
  return {
    canUndo: canUndo(history),
    canRedo: canRedo(history),
    depth: history.past.length,
    futureDepth: history.future.length,
  };
}
