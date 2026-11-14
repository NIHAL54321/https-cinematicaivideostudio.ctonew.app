/**
 * parseScenePatch — the scene PATCH body validator.
 *
 * The Phase 8 Scenes panel edits a scene's visual prompt through this route,
 * because the prompt is what the stock search is built from. These tests hold
 * the two halves of that: the new `visualPrompt` field is validated and capped
 * like its siblings, and every pre-existing field still behaves exactly as it
 * did (a panel is no reason to loosen a validator).
 */
import { describe, expect, test } from "bun:test";
import { parseScenePatch } from "../storyboard";

describe("parseScenePatch — visualPrompt", () => {
  test("accepts and trims a visual prompt", () => {
    expect(parseScenePatch({ visualPrompt: "  a laptop keyboard, macro  " })).toEqual({
      visualPrompt: "a laptop keyboard, macro",
    });
  });

  test("null clears the prompt", () => {
    expect(parseScenePatch({ visualPrompt: null })).toEqual({ visualPrompt: null });
  });

  test("an empty string clears the prompt rather than storing whitespace", () => {
    expect(parseScenePatch({ visualPrompt: "   " })).toEqual({ visualPrompt: null });
  });

  test("caps the prompt at 4000 characters, like its siblings are capped", () => {
    const long = "x".repeat(5000);
    const out = parseScenePatch({ visualPrompt: long });
    expect(out.visualPrompt).toHaveLength(4000);
  });

  test("a non-string prompt is a typed 400, not a coercion", () => {
    expect(() => parseScenePatch({ visualPrompt: 42 })).toThrow(/visualPrompt must be a string or null/);
    expect(() => parseScenePatch({ visualPrompt: { text: "x" } })).toThrow(/visualPrompt must be a string or null/);
  });

  test("a body with no known field is a 400 that names visualPrompt too", () => {
    expect(() => parseScenePatch({})).toThrow(/Nothing to update/);
    expect(() => parseScenePatch({})).toThrow(/visualPrompt/);
  });
});

describe("parseScenePatch — the fields that were already there", () => {
  test("title is trimmed, capped at 200 and cannot be emptied", () => {
    expect(parseScenePatch({ title: "  Opening shot " })).toEqual({ title: "Opening shot" });
    expect(parseScenePatch({ title: "y".repeat(500) }).title).toHaveLength(200);
    expect(() => parseScenePatch({ title: "   " })).toThrow(/title cannot be empty/);
  });

  test("narration may be cleared with null and is trimmed", () => {
    expect(parseScenePatch({ narration: null })).toEqual({ narration: null });
    expect(parseScenePatch({ narration: "  spoken words  " })).toEqual({ narration: "spoken words" });
  });

  test("durationSeconds must be a whole number between 1 and 7200", () => {
    expect(parseScenePatch({ durationSeconds: 20 })).toEqual({ durationSeconds: 20 });
    expect(() => parseScenePatch({ durationSeconds: 0 })).toThrow(/between 1 and 7200/);
    expect(() => parseScenePatch({ durationSeconds: 12.5 })).toThrow(/between 1 and 7200/);
    expect(() => parseScenePatch({ durationSeconds: 7201 })).toThrow(/between 1 and 7200/);
  });

  test("several fields may be patched together", () => {
    expect(
      parseScenePatch({ title: "New", narration: "words", durationSeconds: 30, visualPrompt: "a lens" }),
    ).toEqual({ title: "New", narration: "words", durationSeconds: 30, visualPrompt: "a lens" });
  });
});
