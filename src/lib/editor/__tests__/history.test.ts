import { describe, expect, test } from "bun:test";
import { DEFAULT_HISTORY_LIMIT, canRedo, canUndo, commit, createHistory, historyState, redo, reset, undo } from "../history";
import { buildTimelineFromScenes, timelinesEqual, trimClip, type Timeline } from "../timeline";

/**
 * Phase 5 Block 1 — undo/redo history tests.
 *
 * Classic three-stack semantics: commits push onto `past`, undo/redo move
 * between stacks, and a NEW commit after an undo clears the `future`.
 */

function timeline(): Timeline {
  return buildTimelineFromScenes([{ id: "s1", title: "Intro", narration: "hi", durationSeconds: 5 }]);
}

describe("EditorHistory", () => {
  test("starts empty: nothing to undo or redo", () => {
    const t = timeline();
    const history = createHistory(t);
    expect(history.present).toBe(t);
    expect(history.past.length).toBe(0);
    expect(history.future.length).toBe(0);
    expect(history.limit).toBe(DEFAULT_HISTORY_LIMIT);
    expect(canUndo(history)).toBe(false);
    expect(canRedo(history)).toBe(false);
    expect(undo(history)).toBe(history);
    expect(redo(history)).toBe(history);
  });

  test("commit/undo/redo walk back and forward through edits", () => {
    const t0 = timeline();
    const t1 = trimClip(t0, { clipId: "sc-s1-video", endMs: 4000 }).timeline;
    const t2 = trimClip(t1, { clipId: "sc-s1-video", endMs: 3000 }).timeline;

    const h1 = commit(createHistory(t0), t1);
    expect(canUndo(h1)).toBe(true);
    expect(canRedo(h1)).toBe(false);
    expect(h1.present).toBe(t1);

    const h2 = commit(h1, t2);
    expect(h2.past.length).toBe(2);
    expect(h2.present).toBe(t2);

    const back = undo(h2);
    expect(back.present).toBe(t1);
    expect(canRedo(back)).toBe(true);
    expect(timelinesEqual(back.present, t1)).toBe(true);

    const back2 = undo(back);
    expect(back2.present).toBe(t0);
    expect(canUndo(back2)).toBe(false);

    const forward = redo(back2);
    expect(forward.present).toBe(t1);
    expect(redo(forward).present).toBe(t2);
    expect(canRedo(redo(forward))).toBe(false);
  });

  test("a new commit clears the redo future", () => {
    const t0 = timeline();
    const t1 = trimClip(t0, { clipId: "sc-s1-video", endMs: 4000 }).timeline;
    const t2 = trimClip(t1, { clipId: "sc-s1-video", endMs: 3000 }).timeline;
    const t3 = trimClip(t0, { clipId: "sc-s1-video", startMs: 1000 }).timeline;

    const undone = undo(commit(commit(createHistory(t0), t1), t2));
    expect(canRedo(undone)).toBe(true);

    const branched = commit(undone, t3);
    expect(branched.present).toBe(t3);
    expect(canRedo(branched)).toBe(false);
    expect(branched.future.length).toBe(0);
    expect(branched.past.length).toBe(2); // t0, t1
  });

  test("committing an equal (or identical) timeline is ignored", () => {
    const t0 = timeline();
    const t1 = trimClip(t0, { clipId: "sc-s1-video", endMs: 4000 }).timeline;
    const h = commit(createHistory(t0), t1);
    expect(commit(h, t1)).toBe(h);
    // a structurally identical but freshly parsed timeline is also "no change"
    expect(commit(h, JSON.parse(JSON.stringify(t1)) as Timeline)).toBe(h);
  });

  test("past is capped at the limit, dropping the oldest entry first", () => {
    let current = timeline();
    let history = createHistory(current, 3);
    for (let i = 0; i < 6; i += 1) {
      current = trimClip(current, { clipId: "sc-s1-video", endMs: 4000 - i * 100 }).timeline;
      history = commit(history, current);
    }
    expect(history.limit).toBe(3);
    expect(history.past.length).toBe(3);
    expect(historyState(history).depth).toBe(3);
    // oldest retained state is the 4th one, not the very first
    expect(history.past[0].clips[0].endMs).toBe(4000 - 2 * 100);
  });

  test("reset drops history and restores from a fresh timeline", () => {
    const t0 = timeline();
    const t1 = trimClip(t0, { clipId: "sc-s1-video", endMs: 4000 }).timeline;
    const h = commit(createHistory(t0), t1);
    const restored = reset(h, t0);
    expect(restored.present).toBe(t0);
    expect(restored.past.length).toBe(0);
    expect(restored.future.length).toBe(0);
    expect(restored.limit).toBe(h.limit);
  });

  test("historyState reports both depths", () => {
    const t0 = timeline();
    const t1 = trimClip(t0, { clipId: "sc-s1-video", endMs: 4000 }).timeline;
    const state = historyState(undo(commit(createHistory(t0), t1)));
    expect(state).toEqual({ canUndo: false, canRedo: true, depth: 0, futureDepth: 1 });
  });
});
