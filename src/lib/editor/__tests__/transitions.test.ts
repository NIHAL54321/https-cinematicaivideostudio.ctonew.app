import { describe, expect, test } from "bun:test";
import {
  ACT_BREAK_GAP_MS,
  BEAT_GAP_MS,
  CUT,
  DRAMA_MIN_CUTS,
  DRAMATIC_TRANSITIONS,
  TRANSITIONS,
  TRANSITION_KINDS,
  autoSelectTransitions,
  clampDurationMs,
  defaultDurationMs,
  isDramatic,
  isTransitionKind,
  planAutoTransitions,
  removeTransition,
  setTransition,
  transitionDef,
  transitionSummary,
  validateTransition,
  type TransitionKind,
} from "../transitions";
import {
  EditorError,
  buildTimelineFromScenes,
  clipById,
  clipsAt,
  timelinesEqual,
  rebuildTimeline,
  type Clip,
  type Timeline,
  type TrackId,
} from "../timeline";

/**
 * Phase 5 Block 2 — transitions engine (pure, deterministic).
 *
 * The policy assertions here ARE the spec's "do not use excessive transitions"
 * requirement: conservative auto-selection, no transition inside a scene, no
 * transition on the first clip, a drama budget of one accent per ~3 cuts.
 */

const SPEC_KINDS: TransitionKind[] = ["cut", "fade", "dissolve", "crossfade", "zoom", "slide", "wipe", "cinematic"];

/** Build a one-lane timeline (video by default) from explicit spans. */
function lane(
  entries: { id: string; sceneId?: string; startMs: number; endMs: number }[],
  trackId: TrackId = "video",
): Timeline {
  const clips: Clip[] = entries.map((e) => ({
    id: e.id,
    name: e.id,
    trackId,
    ...(e.sceneId ? { sceneId: e.sceneId } : {}),
    startMs: e.startMs,
    endMs: e.endMs,
    transition: null,
  }));
  return rebuildTimeline(clips);
}

function sceneTimeline(count: number, durationSeconds = 5, narration = true): Timeline {
  return buildTimelineFromScenes(
    Array.from({ length: count }, (_, i) => ({
      id: `s${i + 1}`,
      title: `Scene ${i + 1}`,
      narration: narration ? `Narration for scene ${i + 1}.` : null,
      durationSeconds,
    })),
  );
}

const auto = (t: Timeline): Clip[] => clipsAt(autoSelectTransitions(t), "video");

describe("transitions — catalog", () => {
  test("holds exactly the 8 spec kinds", () => {
    expect(TRANSITIONS.length).toBe(8);
    expect(new Set(TRANSITION_KINDS)).toEqual(new Set(SPEC_KINDS));
    for (const kind of SPEC_KINDS) {
      const def = transitionDef(kind);
      expect(def.kind).toBe(kind);
      expect(def.label.length).toBeGreaterThan(1);
      expect(def.description.length).toBeGreaterThan(10);
      expect(typeof def.audioCrossfade).toBe("boolean");
      expect(def.durationMsMin).toBeLessThanOrEqual(def.durationMsMax);
    }
  });

  test("uses the documented durations: cut 0ms, soft 300-600ms, cinematic 700-1200ms", () => {
    expect(transitionDef("cut").durationMsMin).toBe(0);
    expect(transitionDef("cut").durationMsMax).toBe(0);
    for (const kind of ["fade", "dissolve", "crossfade", "zoom", "slide", "wipe"] as TransitionKind[]) {
      expect(transitionDef(kind).durationMsMin).toBe(300);
      expect(transitionDef(kind).durationMsMax).toBe(600);
    }
    expect(transitionDef("cinematic").durationMsMin).toBe(700);
    expect(transitionDef("cinematic").durationMsMax).toBe(1200);
  });

  test("classifies dramatic kinds and clamps durations to the catalog", () => {
    expect(DRAMATIC_TRANSITIONS).toEqual(["zoom", "slide", "wipe", "cinematic"]);
    expect(isDramatic("cinematic")).toBe(true);
    expect(isDramatic("dissolve")).toBe(false);
    expect(defaultDurationMs("zoom")).toBe(450);
    expect(defaultDurationMs("cinematic")).toBe(950);
    expect(clampDurationMs("zoom", 5000)).toBe(600);
    expect(clampDurationMs("zoom", 10)).toBe(300);
    expect(clampDurationMs("cut", 400)).toBe(0);
    expect(isTransitionKind("dissolve")).toBe(true);
    expect(isTransitionKind("star-wipe")).toBe(false);
  });
});

describe("transitions — conservative auto policy", () => {
  test("never opens on a transition and keeps the first clip untouched", () => {
    const t = autoSelectTransitions(sceneTimeline(6));
    const first = auto(t)[0];
    expect(first.transition ?? null).toBeNull();
  });

  test("a 6-scene timeline gets at most 3 non-cut transitions (spec: no excess)", () => {
    const t = sceneTimeline(6);
    const report = planAutoTransitions(t);
    expect(report.edges).toBe(5);
    expect(report.nonCut).toBeLessThanOrEqual(3);
    expect(report.nonCut).toBeGreaterThanOrEqual(1);
    // every non-cut transition sits on a scene boundary
    for (const placed of report.placed) {
      const clip = clipById(t, placed.clipId)!;
      const next = clipsAt(t, "video").find((c) => c.startMs >= clip.endMs)!;
      expect(clip.sceneId).not.toBe(next.sceneId);
      expect(isDramatic(placed.kind) || placed.kind === "dissolve" || placed.kind === "crossfade").toBe(true);
    }
    // ... and the counters add up honestly
    expect(report.cuts + report.nonCut).toBe(report.edges);
  });

  test("never places a transition between two clips of the same scene", () => {
    const t = lane([
      { id: "a", sceneId: "s1", startMs: 0, endMs: 4000 },
      { id: "b", sceneId: "s1", startMs: 4000, endMs: 8000 },
      { id: "c", sceneId: "s2", startMs: 8000, endMs: 12_000 },
      { id: "d", sceneId: "s2", startMs: 12_000, endMs: 16_000 },
      { id: "e", sceneId: "s3", startMs: 16_000, endMs: 20_000 },
    ]);
    const clips = auto(t);
    const byId = new Map(clips.map((c) => [c.id, c]));
    // the first clip never carries a transition record
    expect(byId.get("a")!.transition ?? null).toBeNull();
    // same-scene edge c→d is a hard cut
    expect(byId.get("c")!.transition).toEqual(CUT);
    // b→c is a scene boundary with budget available → a soft blend.
    expect(["dissolve", "crossfade"]).toContain(byId.get("b")!.transition!.kind);
    // inside a scene (edge i >= 1) nothing is ever blended
    for (let i = 1; i < clips.length - 1; i += 1) {
      const clip = clips[i];
      const next = clips[i + 1];
      if (clip.sceneId && clip.sceneId === next.sceneId) expect(clip.transition!.kind).toBe("cut");
    }
  });

  test("spends the drama budget: ~1 dramatic accent per 3 cuts, never more", () => {
    // 10 shots separated by 1.5s act-break gaps → the strongest kind is eligible
    const entries = Array.from({ length: 10 }, (_, i) => ({
      id: `v${i + 1}`,
      sceneId: `s${i + 1}`,
      startMs: i * 5500,
      endMs: i * 5500 + 4000,
    }));
    const t = lane(entries);
    const report = planAutoTransitions(t);
    expect(report.edges).toBe(9);
    expect(report.dramatic).toBeLessThanOrEqual(Math.ceil(report.edges / DRAMA_MIN_CUTS));
    expect(report.dramatic).toBeGreaterThanOrEqual(1);
    for (const placed of report.placed) expect(placed.kind).toBe("cinematic");
    // act-break length is the cinematic range
    for (const placed of report.placed) {
      expect(placed.durationMs).toBeGreaterThanOrEqual(700);
      expect(placed.durationMs).toBeLessThanOrEqual(1200);
    }
  });

  test("beat gaps (>=500ms) between scenes use the dramatic rotation, not the long blend", () => {
    const entries = Array.from({ length: 8 }, (_, i) => ({
      id: `v${i + 1}`,
      sceneId: `s${i + 1}`,
      startMs: i * 4600,
      endMs: i * 4600 + 4000,
    }));
    const t = lane(entries);
    const report = planAutoTransitions(t);
    expect(report.nonCut).toBeGreaterThanOrEqual(1);
    for (const placed of report.placed) {
      expect(["zoom", "slide", "wipe"]).toContain(placed.kind);
      expect(isDramatic(placed.kind)).toBe(true);
    }
    expect(report.edges).toBe(7);
    expect(report.dramatic).toBeLessThanOrEqual(Math.ceil(report.edges / DRAMA_MIN_CUTS));
  });

  test("clips that are too short for a blend degrade to a cut — never an overlapping effect", () => {
    // 200ms shots: even the 300ms minimum cannot fit inside half a shot.
    const t = lane([
      { id: "a", sceneId: "s1", startMs: 0, endMs: 200 },
      { id: "b", sceneId: "s2", startMs: 800, endMs: 1000 },
      { id: "c", sceneId: "s3", startMs: 1600, endMs: 1800 },
    ]);
    const report = planAutoTransitions(t);
    expect(report.nonCut).toBe(0);
    for (const clip of report.timeline.clips) {
      expect(["cut", null]).toContain(clip.transition?.kind ?? null);
    }
    expect(validateTransition(report.timeline)).toEqual([]);
  });

  test("is deterministic and idempotent", () => {
    const t = sceneTimeline(6);
    const once = autoSelectTransitions(t);
    const twice = autoSelectTransitions(t);
    expect(timelinesEqual(once, twice)).toBe(true);
    expect(timelinesEqual(autoSelectTransitions(once), once)).toBe(true);
    // the input timeline is never mutated
    expect(t.clips.every((c) => c.transition === null || c.transition === undefined)).toBe(true);
  });

  test("owns the video lane only and clears stale transitions everywhere", () => {
    const messy = rebuildTimeline(
      sceneTimeline(3).clips.map((c) => ({ ...c, transition: { kind: "cinematic", durationMs: 900 } })),
    );
    const cleaned = autoSelectTransitions(messy);
    for (const clip of clipsAt(cleaned, "voice")) expect(clip.transition ?? null).toBeNull();
    for (const clip of clipsAt(cleaned, "subtitles")) expect(clip.transition ?? null).toBeNull();
    expect(autoSelectTransitions(messy).clips[0].transition ?? null).toBeNull();
  });

  test("the auto policy produces a timeline with no validation violations", () => {
    for (const count of [1, 2, 3, 6, 12]) {
      expect(validateTransition(autoSelectTransitions(sceneTimeline(count)))).toEqual([]);
    }
  });

  test("an empty timeline is a no-op", () => {
    const empty: Timeline = { version: 1, durationMs: 0, clips: [] };
    expect(transitionsOn(empty)).toEqual([]);
    expect(autoSelectTransitions(empty)).toEqual(empty);
  });

  test("constants match the documented policy", () => {
    expect(BEAT_GAP_MS).toBe(500);
    expect(ACT_BREAK_GAP_MS).toBe(1200);
    expect(DRAMA_MIN_CUTS).toBe(3);
  });
});

function transitionsOn(timeline: Timeline): Clip[] {
  return timeline.clips.filter((c) => c.transition != null);
}

describe("transitions — manual override + removal", () => {
  test("setTransition on one clip overrides just that clip", () => {
    const t = sceneTimeline(3);
    const res = setTransition(t, { clipId: "sc-s1-video", kind: "zoom" });
    expect(res.changed).toBe(true);
    expect(clipById(res.timeline, "sc-s1-video")!.transition).toEqual({ kind: "zoom", durationMs: 450 });
    // other clips are untouched
    expect(clipById(res.timeline, "sc-s2-video")!.transition).toBeNull();
    expect(clipById(res.timeline, "sc-s2-voice")!.transition).toBeUndefined();
    // the input timeline keeps its own values
    expect(clipById(t, "sc-s1-video")!.transition).toBeNull();
  });

  test("setTransition clamps the duration into the kind's catalog range", () => {
    const t = sceneTimeline(2);
    expect(clipById(setTransition(t, { clipId: "sc-s1-video", kind: "slide", durationMs: 99 }).timeline, "sc-s1-video")!.transition)
      .toEqual({ kind: "slide", durationMs: 300 });
    expect(clipById(setTransition(t, { clipId: "sc-s1-video", kind: "cinematic", durationMs: 5000 }).timeline, "sc-s1-video")!.transition)
      .toEqual({ kind: "cinematic", durationMs: 1200 });
    expect(clipById(setTransition(t, { clipId: "sc-s1-video", kind: "cut", durationMs: 400 }).timeline, "sc-s1-video")!.transition)
      .toEqual({ kind: "cut", durationMs: 0 });
  });

  test("setTransition by sceneId targets the scene's OUTGOING edge clip", () => {
    // Split the second scene's video clip so it has two video clips.
    const t = rebuildTimeline([
      { id: "sc-s1-video", name: "S1", trackId: "video", sceneId: "s1", startMs: 0, endMs: 5000, transition: null },
      { id: "sc-s2-video", name: "S2a", trackId: "video", sceneId: "s2", startMs: 5000, endMs: 8000, transition: null },
      { id: "sc-s2-video-b", name: "S2b", trackId: "video", sceneId: "s2", startMs: 8000, endMs: 12_000, transition: null },
    ]);
    const res = setTransition(t, { sceneId: "s2", kind: "wipe" });
    expect(res.changed).toBe(true);
    expect(clipById(res.timeline, "sc-s2-video-b")!.transition).toEqual({ kind: "wipe", durationMs: 450 });
    expect(clipById(res.timeline, "sc-s2-video")!.transition).toBeNull();
  });

  test("setTransition is a no-op when the value is identical", () => {
    const t = setTransition(sceneTimeline(2), { clipId: "sc-s1-video", kind: "dissolve" }).timeline;
    const again = setTransition(t, { clipId: "sc-s1-video", kind: "dissolve" });
    expect(again.changed).toBe(false);
    expect(again.timeline).toBe(t);
  });

  test("removeTransition clears a clip and reports a no-op when already clear", () => {
    const t = setTransition(sceneTimeline(2), { clipId: "sc-s1-video", kind: "fade" }).timeline;
    const cleared = removeTransition(t, { clipId: "sc-s1-video" });
    expect(cleared.changed).toBe(true);
    expect(clipById(cleared.timeline, "sc-s1-video")!.transition).toBeNull();
    expect(removeTransition(cleared.timeline, { clipId: "sc-s1-video" }).changed).toBe(false);
  });

  test("invalid targets and kinds raise typed EditorErrors", () => {
    const t = sceneTimeline(2);
    expect(() => setTransition(t, { kind: "zoom" })).toThrow(EditorError);
    expect(() => setTransition(t, { clipId: "sc-s1-video", sceneId: "s1", kind: "zoom" })).toThrow(EditorError);
    expect(() => setTransition(t, { clipId: "nope", kind: "zoom" })).toThrow(EditorError);
    expect(() => setTransition(t, { clipId: "sc-s1-video", kind: "star-wipe" as TransitionKind })).toThrow(EditorError);
    expect(() => setTransition(t, { clipId: "sc-s1-video", kind: "zoom", durationMs: -5 })).toThrow(EditorError);
    expect(() => setTransition(t, { sceneId: "ghost", kind: "zoom" })).toThrow(EditorError);
    try {
      setTransition(t, { clipId: "nope", kind: "zoom" });
    } catch (err) {
      expect((err as EditorError).code).toBe("clip_not_found");
    }
    try {
      setTransition(t, { sceneId: "ghost", kind: "zoom" });
    } catch (err) {
      expect((err as EditorError).code).toBe("scene_not_found");
    }
    expect(() => removeTransition(t, { clipId: "nope" })).toThrow(EditorError);
  });
});

describe("transitions — validation helper", () => {
  test("flags a transition longer than its clip", () => {
    const t = sceneTimeline(2, 0.5); // 500ms shots
    const withTransition = setTransition(t, { clipId: "sc-s1-video", kind: "cinematic" }).timeline;
    const violations = validateTransition(withTransition);
    const codes = violations.map((v) => v.code);
    expect(codes).toContain("transition_longer_than_clip");
    expect(violations[0].clipId).toBe("sc-s1-video");
  });

  test("flags a non-cut transition on the first clip of a lane", () => {
    const t = setTransition(sceneTimeline(2), { clipId: "sc-s1-video", kind: "fade" }).timeline;
    expect(validateTransition(t).map((v) => v.code)).toContain("transition_on_first_clip");
    // ... but a plain cut on the first clip is not a violation (it is the default)
    const cut = setTransition(sceneTimeline(2), { clipId: "sc-s1-video", kind: "cut" }).timeline;
    expect(validateTransition(cut).map((v) => v.code)).not.toContain("transition_on_first_clip");
  });

  test("flags unusable kinds / durations coming from outside the engine", () => {
    const t = sceneTimeline(2);
    const broken: Timeline = rebuildTimeline(
      t.clips.map((c) =>
        c.id === "sc-s1-video"
          ? { ...c, transition: { kind: "star-wipe", durationMs: 400 } }
          : c.id === "sc-s2-video"
            ? { ...c, transition: { kind: "zoom", durationMs: -20 } }
            : c,
      ),
    );
    const codes = validateTransition(broken).map((v) => v.code);
    expect(codes).toContain("unknown_transition_kind");
    expect(codes).toContain("invalid_transition_duration");
  });

  test("flags a transition that eats more than half of its clip", () => {
    const t = sceneTimeline(2, 1); // 1000ms shots
    const withTransition = setTransition(t, { clipId: "sc-s1-video", kind: "cinematic", durationMs: 900 }).timeline;
    const violations = validateTransition(withTransition);
    expect(violations.map((v) => v.code)).toContain("transition_exceeds_half_clip");
    expect(violations.map((v) => v.code)).not.toContain("transition_longer_than_clip");
  });

  test("a timeline without transitions is clean and summaries are honest", () => {
    const t = sceneTimeline(2);
    expect(validateTransition(t)).toEqual([]);
    const summary = transitionSummary(t);
    expect(summary).toEqual({ total: 0, nonCut: 0, dramatic: 0, cuts: 0, violations: [] });
    const selected = transitionSummary(autoSelectTransitions(sceneTimeline(6)));
    expect(selected.total).toBe(selected.nonCut + selected.cuts);
    expect(selected.violations).toEqual([]);
  });
});
