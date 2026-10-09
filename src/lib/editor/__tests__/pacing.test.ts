import { describe, expect, test } from "bun:test";
import {
  CADENCE_FAST_MS,
  CADENCE_SLOW_MS,
  PACE_BANDS,
  PACE_DIMENSIONS,
  PACE_WEIGHTS,
  analyzePacing,
  cadenceBandOf,
  paceBandOf,
} from "../pacing";
import {
  addClip,
  buildTimelineFromScenes,
  clipsAt,
  type SceneInput,
  type Timeline,
} from "../timeline";

/**
 * Phase 5 Block 3 — the pacing read.
 *
 * What matters here (and is asserted below):
 *   - five dimensions, each honestly scored 0-100 with a label + a reason,
 *   - the numbers come from REAL timeline data: a faster cadence raises
 *     sceneChange, a voice-heavy timeline raises narration, a music bed raises
 *     music,
 *   - `overall` is the documented weighted blend and PACE_BANDS classifies it,
 *   - the note is honest about the fact that nothing was AI-refined.
 */

const NARRATED: SceneInput[] = [
  { id: "s1", title: "Cold open", narration: "This is the opening narration of the film.", durationSeconds: 5 },
  { id: "s2", title: "The problem", narration: "Now the difficulty appears.", durationSeconds: 5 },
  { id: "s3", title: "The payoff", narration: "The resolution lands here.", durationSeconds: 5 },
];

function timelineOf(durationSeconds: number, count = 4, narration: string | null = "A line of narration here."): {
  scenes: SceneInput[];
  timeline: Timeline;
} {
  const scenes: SceneInput[] = Array.from({ length: count }, (_, index) => ({
    id: `s${index + 1}`,
    title: `Scene ${index + 1}`,
    narration,
    durationSeconds,
  }));
  return { scenes, timeline: buildTimelineFromScenes(scenes) };
}

function assertScores(analysis: ReturnType<typeof analyzePacing>): void {
  for (const id of PACE_DIMENSIONS) {
    const dimension = analysis.dimensions[id];
    expect(typeof dimension.score).toBe("number");
    expect(Number.isInteger(dimension.score)).toBe(true);
    expect(dimension.score).toBeGreaterThanOrEqual(0);
    expect(dimension.score).toBeLessThanOrEqual(100);
    expect(dimension.label.length).toBeGreaterThan(0);
    expect(dimension.reason.length).toBeGreaterThan(0);
  }
  expect(Number.isInteger(analysis.overall)).toBe(true);
  expect(analysis.overall).toBeGreaterThanOrEqual(0);
  expect(analysis.overall).toBeLessThanOrEqual(100);
  expect(typeof analysis.note).toBe("string");
  expect(analysis.note.length).toBeGreaterThan(0);
}

describe("pacing — the five dimensions", () => {
  test("scores every dimension 0-100 with a label and a reason", () => {
    const { scenes, timeline } = timelineOf(5);
    const analysis = analyzePacing(timeline, scenes);
    assertScores(analysis);
    expect(Object.keys(analysis.dimensions)).toEqual([...PACE_DIMENSIONS]);
    const weights = PACE_DIMENSIONS.reduce((sum, id) => sum + PACE_WEIGHTS[id], 0);
    expect(Math.round(weights * 100) / 100).toBe(1);
  });

  test("is deterministic and never mutates the timeline", () => {
    const { scenes, timeline } = timelineOf(4);
    const snapshot = JSON.stringify(timeline);
    const a = analyzePacing(timeline, scenes);
    const b = analyzePacing(timeline, scenes);
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(JSON.stringify(timeline)).toBe(snapshot);
  });

  test("an empty timeline reads zeros and says so honestly", () => {
    const timeline = buildTimelineFromScenes([]);
    const analysis = analyzePacing(timeline, []);
    assertScores(analysis);
    for (const id of PACE_DIMENSIONS) expect(analysis.dimensions[id].score).toBe(0);
    expect(analysis.overall).toBe(0);
    expect(analysis.dimensions.narration.reason).toContain("No voice clip");
    expect(analysis.note).toContain("empty");
  });
});

describe("pacing — narration", () => {
  test("a voice-heavy timeline scores higher than an unnarrated one", () => {
    const narrated = timelineOf(5);
    const silent = timelineOf(5, 4, null);
    expect(clipsAt(narrated.timeline, "voice").length).toBe(4);
    expect(clipsAt(silent.timeline, "voice").length).toBe(0);
    const heavy = analyzePacing(narrated.timeline, narrated.scenes);
    const none = analyzePacing(silent.timeline, silent.scenes);
    expect(heavy.dimensions.narration.score).toBeGreaterThan(none.dimensions.narration.score);
    expect(none.dimensions.narration.score).toBe(0);
    expect(none.dimensions.narration.label).toBe("silent");
    expect(heavy.dimensions.narration.reason).toContain("cover 100%");
  });

  test("narration text without a voice clip is called out in the reason", () => {
    const { scenes, timeline } = timelineOf(5, 2);
    const edited: Timeline = {
      ...timeline,
      clips: timeline.clips.filter((clip) => clip.trackId !== "voice"),
    };
    const analysis = analyzePacing(edited, scenes);
    expect(analysis.dimensions.narration.reason).toContain("have narration text but no voice clip");
  });
});

describe("pacing — sceneChange (cadence)", () => {
  test("a faster cadence scores higher", () => {
    const fast = timelineOf(2);
    const slow = timelineOf(10);
    const fastAnalysis = analyzePacing(fast.timeline, fast.scenes);
    const slowAnalysis = analyzePacing(slow.timeline, slow.scenes);
    expect(fastAnalysis.dimensions.sceneChange.score).toBeGreaterThan(slowAnalysis.dimensions.sceneChange.score);
    expect(fastAnalysis.dimensions.sceneChange.score).toBe(100); // 2s average = CADENCE_FAST_MS
    expect(slowAnalysis.dimensions.sceneChange.score).toBe(0); // 10s average = CADENCE_SLOW_MS
    expect(fastAnalysis.dimensions.sceneChange.reason).toContain(`average ${CADENCE_FAST_MS}ms`);
    expect(slowAnalysis.dimensions.sceneChange.reason).toContain(`average ${CADENCE_SLOW_MS}ms`);
    expect(fastAnalysis.overall).toBeGreaterThan(slowAnalysis.overall);
  });

  test("the attention dimension pays a bonus for a short opening shot", () => {
    const quick = timelineOf(2, 3);
    const long = timelineOf(12, 3);
    expect(analyzePacing(quick.timeline, quick.scenes).dimensions.attention.reason).toContain("hook bonus");
    expect(analyzePacing(long.timeline, long.scenes).dimensions.attention.reason).toContain("+0 hook bonus");
  });
});

describe("pacing — visual and music", () => {
  test("b-roll support raises the visual score", () => {
    const { scenes, timeline } = timelineOf(5);
    const before = analyzePacing(timeline, scenes).dimensions.visual.score;
    const withBroll = addClip(timeline, { name: "B-roll", trackId: "broll", startMs: 0, durationMs: 2000 });
    const withMoreBroll = addClip(withBroll.timeline, { name: "B-roll", trackId: "broll", startMs: 6000, durationMs: 2000 });
    const after = analyzePacing(withMoreBroll.timeline, scenes).dimensions.visual;
    expect(after.score).toBeGreaterThan(before);
    expect(after.reason).toContain("b-roll");
  });

  test("the music dimension follows the bed's coverage and gain", () => {
    const { scenes, timeline } = timelineOf(5);
    const none = analyzePacing(timeline, scenes).dimensions.music;
    expect(none.score).toBe(0);
    expect(none.label).toBe("no music");
    expect(none.reason).toContain("no music-bed clip");

    const bed = addClip(timeline, { name: "Music", trackId: "music", startMs: 0, durationMs: timeline.durationMs, gain: 0.3 });
    const withMusic = analyzePacing(bed.timeline, scenes).dimensions.music;
    expect(withMusic.score).toBeGreaterThan(0);
    expect(withMusic.reason).toContain("average gain of 0.3");
    expect(analyzePacing(timeline, scenes).dimensions.music.score).toBe(0); // unchanged input
  });
});

describe("pacing — bands and the overall reading", () => {
  test("PACE_BANDS covers 0-100 with the three spec bands", () => {
    expect(PACE_BANDS.map((b) => b.band)).toEqual(["too slow", "balanced", "too fast"]);
    let cursor = 0;
    for (const entry of PACE_BANDS) {
      expect(entry.scoreMin).toBe(cursor);
      expect(entry.scoreMax).toBeGreaterThanOrEqual(entry.scoreMin);
      expect(entry.hint.length).toBeGreaterThan(0);
      cursor = entry.scoreMax + 1;
    }
    expect(cursor).toBe(101);
    expect(paceBandOf(0)).toBe("too slow");
    expect(paceBandOf(50)).toBe("balanced");
    expect(paceBandOf(100)).toBe("too fast");
  });

  test("cadenceBandOf reads the average clip length", () => {
    expect(cadenceBandOf(CADENCE_FAST_MS)).toBe("too fast");
    expect(cadenceBandOf(5000)).toBe("balanced");
    expect(cadenceBandOf(CADENCE_SLOW_MS)).toBe("too slow");
    expect(cadenceBandOf(null)).toBe("too slow");
  });

  test("the overall band matches paceBandOf and the note states no AI refinement happened", () => {
    const { scenes, timeline } = timelineOf(5);
    const analysis = analyzePacing(timeline, scenes);
    expect(paceBandOf(analysis.overall)).toBe(
      analysis.overall >= 75 ? "too fast" : analysis.overall >= 40 ? "balanced" : "too slow",
    );
    // BLOCK 9 — the provider half of the note is DERIVED now (see
    // pacing-provider-note.test.ts for the two-direction proof): the sentence
    // here must state what an AI pass would REQUIRE and what the live registry
    // says, never a fixed claim about this server's keys.
    expect(analysis.note).toContain("would need a provider that is configured AND wired");
    expect(analysis.note).toContain("no code path that dispatches to a provider");
    expect(analysis.note).not.toContain("none is connected");
    // the weak dimensions are named honestly
    expect(analysis.note).toContain("music (0)");
  });
});
