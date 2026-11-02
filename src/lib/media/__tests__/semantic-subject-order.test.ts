/**
 * The SUBJECT half of the stock query — visual prompt first, narration last.
 *
 * The bug these tests pin is a real product bug, not a fixture detail. The
 * builder concatenated narration + visualPrompt + title and took the first 8
 * tokens, so the narration — prose about what is SAID — consumed the whole
 * budget and the concrete subject never reached the provider. On the 9-scene
 * fixture project, scene 2 (title "Reading the scale", visual prompt "Close on
 * an engraved brass scale, fingers holding a pencil") queried
 *
 *     scale engraved feet metres reader writes both down cinematic
 *
 * — every term from the narration, none of `brass`, `fingers` or `pencil` — and
 * the provider answered with a clip of STAIRS AND FEET.
 *
 * The rule under test, in one line: the visual prompt names the thing on screen,
 * so it leads and keeps the largest share of the cap; the title is next; the
 * narration comes last and keeps one guaranteed term. Nothing is dropped
 * silently: unused share rolls forward.
 */
import { describe, expect, test } from "bun:test";
import { buildSemanticQuery, SUBJECT_TERM_CAP } from "../semantic";

/** The exact scene 2 row from the fixture project. */
const SCALE_SCENE = {
  title: "Reading the scale",
  visualPrompt: "Close on an engraved brass scale, fingers holding a pencil",
  narration:
    "The scale is engraved in feet and metres. The reader writes both down, because the harbour board asks for feet and the survey asks for metres.",
  mediaType: "video",
};

describe("the regression: a reading in the narration must not swallow the brass scale", () => {
  const q = buildSemanticQuery(SCALE_SCENE);

  test("the engraved scale reaches the provider", () => {
    expect(q.subject).toContain("scale");
    expect(q.subject).toContain("engraved");
    expect(q.subject).toContain("brass");
  });

  test("the visual prompt's own terms lead the subject", () => {
    // The first three terms come from "Close on an engraved brass scale…", not
    // from the narration's opening words.
    expect(q.subject.slice(0, 3)).toEqual(["close", "engraved", "brass"]);
  });

  test("the query is not the old narration-only string", () => {
    expect(q.keywords).not.toBe("scale engraved feet metres. reader writes both down cinematic");
    expect(q.keywords.startsWith("scale engraved feet")).toBe(false);
  });

  test("narration still contributes — it is last, not dropped", () => {
    // One guaranteed term from the narration survives the cap.
    expect(q.subject).toContain("feet");
  });

  test("the subject never exceeds the documented cap", () => {
    expect(q.subject.length).toBeLessThanOrEqual(SUBJECT_TERM_CAP);
  });

  test("the rationale says which field led, so a reader can check the rule", () => {
    expect(q.rationale.subject).toContain("visual prompt first");
    expect(q.rationale.subject).toContain("narration");
  });
});

describe("ordering holds for every combination of supplied fields", () => {
  test("visual prompt alone is used, in its own order", () => {
    const q = buildSemanticQuery({ visualPrompt: "brass scale pencil", mediaType: "video" });
    expect(q.subject).toEqual(["brass", "scale", "pencil"]);
  });

  test("title alone is used when there is no visual prompt", () => {
    const q = buildSemanticQuery({ title: "Reading the scale", mediaType: "video" });
    expect(q.subject).toEqual(["reading", "scale"]);
  });

  test("narration alone is used when it is all there is", () => {
    const q = buildSemanticQuery({ narration: "a brass scale engraved in feet", mediaType: "video" });
    expect(q.subject[0]).toBe("brass");
    expect(q.subject).toContain("scale");
  });

  test("a term repeated across fields appears once", () => {
    const q = buildSemanticQuery({
      visualPrompt: "harbour wall storm",
      title: "storm",
      narration: "the storm came over the harbour wall",
      mediaType: "video",
    });
    expect(q.subject.filter((t) => t === "storm")).toHaveLength(1);
    expect(q.subject.filter((t) => t === "harbour")).toHaveLength(1);
  });

  test("a long visual prompt still leaves the title a share", () => {
    const q = buildSemanticQuery({
      visualPrompt: "one two three four five six seven eight nine ten",
      title: "titleword",
      narration: "narrationword",
      mediaType: "video",
    });
    expect(q.subject).toContain("titleword");
    expect(q.subject).toHaveLength(SUBJECT_TERM_CAP);
  });

  test("no text at all is an empty subject, not an invented one", () => {
    const q = buildSemanticQuery({ mediaType: "video" });
    expect(q.subject).toEqual([]);
    expect(q.rationale.subject).toContain("empty subject");
  });
});

describe("a term never carries sentence punctuation into the query", () => {
  test("a sentence-final word is the word, without its full stop", () => {
    const q = buildSemanticQuery({
      visualPrompt: "brass scale",
      narration: "The reader writes both down.",
      mediaType: "video",
    });
    expect(q.subject).toContain("down");
    expect(q.subject.some((t) => t.endsWith("."))).toBe(false);
  });

  test("internal punctuation that is part of a word is kept", () => {
    const q = buildSemanticQuery({ visualPrompt: "a storm-strewn quay, time-lapse", mediaType: "video" });
    expect(q.subject).toContain("storm-strewn");
    expect(q.subject).toContain("time-lapse");
  });
});

describe("the builder stays pure and deterministic", () => {
  test("the same scene always yields the same query", () => {
    const a = buildSemanticQuery(SCALE_SCENE);
    const b = buildSemanticQuery(SCALE_SCENE);
    expect(a.keywords).toBe(b.keywords);
    expect(a.subject).toEqual(b.subject);
  });

  test("the caller's input object is not mutated", () => {
    const input = { ...SCALE_SCENE };
    const before = JSON.stringify(input);
    buildSemanticQuery(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
