import { describe, expect, test } from "bun:test";
import { STRUCTURES, selectStructure, getStructure, DEFAULT_STRUCTURE_ID } from "../structures";
import { VIDEO_FORMATS } from "../types";

describe("structures library", () => {
  test("has 10 structures with typed beats", () => {
    expect(STRUCTURES.length).toBe(10);
    for (const s of STRUCTURES) {
      expect(s.beats.length).toBeGreaterThanOrEqual(2);
      for (const b of s.beats) {
        expect(b.name.length).toBeGreaterThan(0);
        expect(b.purpose.length).toBeGreaterThan(0);
        expect(b.share).toBeGreaterThan(0);
        expect(["hook", "body", "ending"]).toContain(b.role);
      }
      // first beat is a hook, last is an ending
      expect(s.beats[0].role).toBe("hook");
      expect(s.beats[s.beats.length - 1].role).toBe("ending");
      // ids unique
      expect(new Set(s.beats.map((b) => b.id)).size).toBe(s.beats.length);
    }
  });

  test("spec structures exist with the exact beat names", () => {
    const spec1 = getStructure("hook-problem-solution")!;
    expect(spec1.beats.map((b) => b.name)).toEqual([
      "Hook",
      "Problem",
      "Explanation",
      "Evidence",
      "Example",
      "Solution",
      "Conclusion",
    ]);
    const spec2 = getStructure("hook-story-conflict")!;
    expect(spec2.beats.map((b) => b.name)).toEqual(["Hook", "Story", "Conflict", "Discovery", "Resolution"]);
  });

  test("getStructure returns undefined for unknown id", () => {
    expect(getStructure("nope")).toBeUndefined();
  });

  test("selectStructure is deterministic", () => {
    for (const format of VIDEO_FORMATS) {
      const a = selectStructure(format, "The history of coffee and its evolution over the decades");
      const b = selectStructure(format, "The history of coffee and its evolution over the decades");
      expect(a.structure.id).toBe(b.structure.id);
      expect(a.score).toBe(b.score);
    }
  });

  test("keyword heuristics pick the right structure", () => {
    expect(selectStructure("LONG", "top 10 best ways to save money fast").structure.id).toBe("listicle");
    expect(selectStructure("LONG", "the rise and fall of rome — a full timeline").structure.id).toBe("timeline");
    expect(selectStructure("SHORT", "the mystery nobody solved").structure.id).toBe("mystery");
    expect(selectStructure("LONG", "how to fix a leaking pipe — the pain and the solution").structure.id).toBe(
      "hook-problem-solution",
    );
  });

  test("defaults are stable", () => {
    expect(DEFAULT_STRUCTURE_ID).toBe("hook-problem-solution");
    expect(selectStructure("LONG", "").structure.id).toBe(DEFAULT_STRUCTURE_ID);
    expect(selectStructure("SHORT", "").structure.id).toBe("question-answer");
    expect(selectStructure("SOCIAL", "").structure.id).toBe("listicle");
  });
});
