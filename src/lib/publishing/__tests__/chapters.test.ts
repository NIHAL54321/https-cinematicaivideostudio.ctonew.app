import { describe, expect, test } from "bun:test";
import { buildChapters, NO_CHAPTER_DATA } from "../chapters";
import { emptySource, richSource, textOnlySource } from "./fixtures";

describe("chapters — derived from real Chapter/Scene rows", () => {
  test("every entry names the Chapter row it came from", () => {
    const plan = buildChapters(richSource());
    expect(plan.chapterCount).toBe(2);
    expect(plan.sceneCount).toBe(3);
    expect(plan.entries.map((e) => e.chapterId)).toEqual(["ch_1", "ch_2"]);
    expect(plan.entries.map((e) => e.scriptId)).toEqual(["scr_rich", "scr_rich"]);
    expect(plan.entries[0].scenes.map((s) => s.sceneId)).toEqual(["sc_1", "sc_2"]);
  });

  test("titles and summaries are the rows' own text, with row+path provenance", () => {
    const plan = buildChapters(richSource());
    const first = plan.entries[0];
    expect(first.title.state).toBe("derived");
    expect(first.title.state === "derived" && first.title.value).toBe("The Second Punic War");
    expect(first.title.state === "derived" && first.title.rule).toBe("R-CH-TITLE");
    expect(first.title.sources).toEqual([{ kind: "chapter", id: "ch_1", path: "title" }]);

    const second = plan.entries[1];
    expect(second.summary.state).toBe("empty_no_input");
    if (second.summary.state === "empty_no_input") {
      expect(second.summary.reason).toContain("no summary stored");
      expect(second.summary.requires).toContain("Chapter.summary on this row");
    }
  });

  test("timings are the summed scene durations and nothing else", () => {
    const plan = buildChapters(richSource());
    expect(plan.timingsAvailable).toBe(true);
    const [a, b] = plan.entries;
    expect(a.startSeconds.state === "derived" && a.startSeconds.value).toBe(0);
    expect(a.durationSeconds.state === "derived" && a.durationSeconds.value).toBe(300);
    expect(a.startTimecode.state === "derived" && a.startTimecode.value).toBe("0:00");
    expect(b.startSeconds.state === "derived" && b.startSeconds.value).toBe(300);
    expect(b.startTimecode.state === "derived" && b.startTimecode.value).toBe("5:00");
    expect(b.durationSeconds.state === "derived" && b.durationSeconds.value).toBe(240);
    expect(plan.coveredSeconds).toBe(540);
    expect(plan.coveredHuman).toBe("9m 00s");
  });

  test("a scene with no duration removes ALL timings instead of guessing them", () => {
    const source = richSource();
    source.chapters[1].scenes[0].durationSeconds = null;
    const plan = buildChapters(source);
    expect(plan.timingsAvailable).toBe(false);
    expect(plan.scenesWithoutDuration).toBe(1);
    for (const entry of plan.entries) {
      expect(entry.startSeconds.state).toBe("empty_no_input");
      expect(entry.durationSeconds.state).toBe("empty_no_input");
      expect(entry.startTimecode.state).toBe("empty_no_input");
    }
    expect(plan.block.state).toBe("empty_no_input");
    if (plan.block.state === "empty_no_input") {
      expect(plan.block.reason).toContain("1 of 3");
    }
    // The titles are still real; only the arithmetic is refused.
    expect(plan.entries[0].title.state).toBe("derived");
  });

  test("the chapter block is one line per chapter, from the rows", () => {
    const plan = buildChapters(richSource());
    expect(plan.block.state).toBe("derived");
    if (plan.block.state === "derived") {
      expect(plan.block.value).toBe("0:00 The Second Punic War\n5:00 The Third Punic War");
      expect(plan.block.textOrigin).toBe("source_verbatim");
    }
  });

  test("no chapter rows at all: the package says exactly that and invents nothing", () => {
    const plan = buildChapters(emptySource());
    expect(plan.chapterCount).toBe(0);
    expect(plan.entries).toEqual([]);
    expect(plan.block.state).toBe("empty_no_input");
    if (plan.block.state === "empty_no_input") {
      expect(plan.block.reason).toContain(NO_CHAPTER_DATA);
      expect(plan.block.value).toBeNull();
    }
    expect(plan.notes.join(" ")).toContain(NO_CHAPTER_DATA);
    // No positional label, no fabricated structure: nothing is derived at all.
    expect(plan.timingsAvailable).toBe(false);
    expect(plan.coveredSeconds).toBeNull();
    expect(plan.timingBasis).toContain("Nothing is assumed");
  });

  test("chapters but no scenes: titles are real, timings are empty with a reason", () => {
    const source = richSource();
    source.chapters = source.chapters.map((c) => ({ ...c, scenes: [] }));
    const plan = buildChapters(source);
    expect(plan.chapterCount).toBe(2);
    expect(plan.sceneCount).toBe(0);
    expect(plan.timingsAvailable).toBe(false);
    expect(plan.block.state).toBe("empty_no_input");
    if (plan.block.state === "empty_no_input") {
      expect(plan.block.reason).toContain("no Scene rows");
    }
    expect(plan.entries[0].durationSeconds.state).toBe("empty_no_input");
  });

  test("a blank chapter title is empty-with-reason, never a positional label", () => {
    const source = richSource();
    source.chapters[0].title = "   ";
    const plan = buildChapters(source);
    expect(plan.entries[0].title.state).toBe("empty_no_input");
    if (plan.entries[0].title.state === "empty_no_input") {
      expect(plan.entries[0].title.reason).toContain("blank title column");
    }
    // The block cannot be written for an untitled chapter, so it is refused.
    expect(plan.block.state).toBe("empty_no_input");
    // The only place the word "Chapter" appears is the REASON that describes
    // which row is blank — never as a derived title value.
    expect(plan.entries[0].title.value).toBeNull();
    expect(plan.entries.every((e) => e.title.value === null || typeof e.title.value === "string")).toBe(true);
    const derivedTitles = plan.entries.filter((e) => e.title.state === "derived");
    expect(derivedTitles.length).toBe(1);
    expect(derivedTitles[0].chapterId).toBe("ch_2");
  });

  test("chapters are ordered by their own order column, not by row order", () => {
    const source = richSource();
    source.chapters = [source.chapters[1], source.chapters[0]];
    const plan = buildChapters(source);
    expect(plan.entries.map((e) => e.chapterId)).toEqual(["ch_1", "ch_2"]);
    expect(plan.entries.map((e) => e.index)).toEqual([1, 2]);
  });

  test("a text-only project derives no chapters and no timings", () => {
    const plan = buildChapters(textOnlySource());
    expect(plan.chapterCount).toBe(0);
    expect(plan.timingsAvailable).toBe(false);
  });
});
