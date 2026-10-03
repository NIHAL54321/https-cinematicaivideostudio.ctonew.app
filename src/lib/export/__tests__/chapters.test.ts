/**
 * Phase 6 Block 3 — chapter markers: the timecode format, the merge rule, and
 * every published requirement the plan must state (met or not).
 */
import { describe, expect, test } from "bun:test";
import {
  CHAPTER_FIRST_START_MS,
  CHAPTER_MIN_COUNT,
  CHAPTER_MIN_SECONDS,
  buildChapterPlan,
  formatChapterTimecode,
  mergeBeatsIntoChapters,
  renderChapterBlock,
  type ChapterBeat,
} from "../chapters";

function beat(startMs: number, endMs: number, title: string | null, sceneId = `s${startMs}`): ChapterBeat {
  return { sceneId, title, startMs, endMs };
}

const THIRTY = 30_000;

describe("chapter timecode", () => {
  test("M:SS under an hour, H:MM:SS at an hour or longer", () => {
    expect(formatChapterTimecode(0)).toBe("0:00");
    expect(formatChapterTimecode(5_000)).toBe("0:05");
    expect(formatChapterTimecode(65_000)).toBe("1:05");
    expect(formatChapterTimecode(600_000)).toBe("10:00");
    expect(formatChapterTimecode(3_599_000)).toBe("59:59");
    expect(formatChapterTimecode(3_600_000)).toBe("1:00:00");
    expect(formatChapterTimecode(3_725_000)).toBe("1:02:05");
  });
  test("whole seconds are floored, never rounded up", () => {
    expect(formatChapterTimecode(999)).toBe("0:00");
    expect(formatChapterTimecode(1_999)).toBe("0:01");
  });
  test("negative and non-finite input degrade to 0:00 rather than throwing", () => {
    expect(formatChapterTimecode(-1)).toBe("0:00");
    expect(formatChapterTimecode(Number.NaN)).toBe("0:00");
    expect(formatChapterTimecode(Number.POSITIVE_INFINITY)).toBe("0:00");
  });
});

describe("chapter merging", () => {
  test("a chapter closes as soon as it reaches the minimum", () => {
    const { chapters, ignoredBeats } = mergeBeatsIntoChapters([
      beat(0, 5_000, "A"),
      beat(5_000, 10_000, "B"),
      beat(10_000, 15_000, "C"),
      beat(15_000, 20_000, "D"),
    ]);
    expect(ignoredBeats).toBe(0);
    expect(chapters.length).toBe(2);
    expect(chapters[0].durationSeconds).toBe(10);
    expect(chapters[1].durationSeconds).toBe(10);
    expect(chapters[0].mergedSceneIds.length).toBe(1);
    expect(chapters[0].mergedSceneCount).toBe(1);
    expect(chapters[0].sceneIds).toEqual(["s0", "s5000"]);
  });
  test("a chapter runs until the next one starts (no gaps, no overlaps)", () => {
    const plan = buildChapterPlan([beat(0, 30_000, "One"), beat(30_000, 60_000, "Two"), beat(60_000, 64_000, "Tail")]);
    expect(plan.chapters[0].endMs).toBe(30_000);
    expect(plan.chapters[1].endMs).toBe(60_000);
    // The last chapter ends where the last beat ends.
    expect(plan.chapters[2].endMs).toBe(64_000);
    expect(plan.chapters[0].endMs).toBe(plan.chapters[1].startMs);
  });
  test("beats are taken in timeline order regardless of input order", () => {
    const plan = buildChapterPlan([beat(30_000, 60_000, "Second"), beat(0, 30_000, "First")]);
    expect(plan.chapters.map((c) => c.title)).toEqual(["First", "Second"]);
    expect(plan.firstStartsAtZero).toBe(true);
  });
  test("a beat with no usable span is ignored and counted, never merged", () => {
    const plan = buildChapterPlan([
      beat(0, 0, "Zero"),
      beat(0, 30_000, "One"),
      beat(30_000, 60_000, "Two"),
      beat(60_000, 90_000, "Three"),
    ]);
    expect(plan.ignoredBeats).toBe(1);
    expect(plan.beatCount).toBe(4);
    expect(plan.chapters.length).toBe(3);
    expect(plan.meetsYoutubeRequirements).toBe(false);
    expect(plan.blockers.some((b) => b.includes("no usable span"))).toBe(true);
  });
});

describe("chapter plan — the published requirements", () => {
  test("three 30-second scenes meet every requirement", () => {
    const plan = buildChapterPlan([beat(0, THIRTY, "Intro"), beat(THIRTY, 2 * THIRTY, "Body"), beat(2 * THIRTY, 3 * THIRTY, "Outro")]);
    expect(plan.count).toBe(3);
    expect(plan.firstStartsAtZero).toBe(true);
    expect(plan.tooShort).toEqual([]);
    expect(plan.blockers).toEqual([]);
    expect(plan.meetsYoutubeRequirements).toBe(true);
    expect(plan.coveredSeconds).toBe(90);
    expect(plan.rules.minChapterSeconds).toBe(CHAPTER_MIN_SECONDS);
    expect(plan.rules.minChapterCount).toBe(CHAPTER_MIN_COUNT);
    expect(plan.rules.firstChapterAtMs).toBe(CHAPTER_FIRST_START_MS);
    expect(plan.rules.basis).toContain("YouTube");
  });

  test("the block is the platform's own format: one line per chapter, M:SS Title", () => {
    const plan = buildChapterPlan([beat(0, THIRTY, "Intro"), beat(THIRTY, 2 * THIRTY, "Body"), beat(2 * THIRTY, 3 * THIRTY, "Outro")]);
    expect(plan.block).toBe("0:00 Intro\n0:30 Body\n1:00 Outro");
    expect(renderChapterBlock(plan.chapters)).toBe(plan.block);
  });

  test("fewer than three chapters is a stated blocker, not a rounded-up list", () => {
    const plan = buildChapterPlan([beat(0, THIRTY, "Intro"), beat(THIRTY, 2 * THIRTY, "Body")]);
    expect(plan.count).toBe(2);
    expect(plan.meetsYoutubeRequirements).toBe(false);
    expect(plan.blockers.some((b) => b.includes(`at least ${CHAPTER_MIN_COUNT}`))).toBe(true);
  });

  test("a trailing chapter under the minimum is reported too short, never padded or dropped", () => {
    const plan = buildChapterPlan([beat(0, THIRTY, "Intro"), beat(THIRTY, 2 * THIRTY, "Body"), beat(2 * THIRTY, 2 * THIRTY + 4_000, "Tail")]);
    expect(plan.count).toBe(3);
    expect(plan.tooShort).toEqual([{ index: 3, title: "Tail", seconds: 4 }]);
    expect(plan.meetsYoutubeRequirements).toBe(false);
    expect(plan.blockers.some((b) => b.includes("shorter than 10 s"))).toBe(true);
  });

  test("a first chapter that does not start at 00:00 is reported", () => {
    const plan = buildChapterPlan([beat(5_000, 35_000, "Late"), beat(35_000, 65_000, "Later"), beat(65_000, 95_000, "Last")]);
    expect(plan.firstStartsAtZero).toBe(false);
    expect(plan.meetsYoutubeRequirements).toBe(false);
    expect(plan.blockers.some((b) => b.includes("first chapter at 00:00"))).toBe(true);
  });

  test("a scene with no title gets a POSITIONAL label and says so", () => {
    const plan = buildChapterPlan([beat(0, THIRTY, null), beat(THIRTY, 2 * THIRTY, "Body"), beat(2 * THIRTY, 3 * THIRTY, null)]);
    expect(plan.chapters[0].title).toBe("Scene 1");
    expect(plan.chapters[0].titleSource).toBe("positional");
    expect(plan.chapters[1].titleSource).toBe("scene");
    expect(plan.chapters[2].title).toBe("Scene 3");
  });

  test("no beats at all is an honest zero, with the reason", () => {
    const plan = buildChapterPlan([]);
    expect(plan.count).toBe(0);
    expect(plan.block).toBe("");
    expect(plan.coveredSeconds).toBe(0);
    expect(plan.meetsYoutubeRequirements).toBe(false);
    expect(plan.blockers.some((b) => b.includes("nothing to chapter"))).toBe(true);
    expect(plan.note).toContain("no scene beats");
  });

  test("the same beats always produce the same plan", () => {
    const beats = [beat(0, THIRTY, "A"), beat(THIRTY, 60_000, "B"), beat(60_000, 90_000, "C")];
    expect(buildChapterPlan(beats).block).toBe(buildChapterPlan(beats).block);
  });
});
