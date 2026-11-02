/**
 * `resolveMediaType` — what the caller asked for is what gets searched.
 *
 * The bug these tests pin: the function could not return "video" for an
 * explicit request. `?mediaType=video` was silently ignored, so the video-only
 * Pixabay adapter (which supports `video` and nothing else) was skipped on
 * every request the route built.
 *
 * The rule under test, in one line: an EXPLICIT request wins; a missing or
 * unrecognised value keeps the documented default (image — the broadest stock
 * inventory); nothing is ever guessed from text.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSemanticQuery, resolveMediaType } from "../semantic";

describe("resolveMediaType: an explicit video request wins", () => {
  test('"video" (lower case) resolves to video', () => {
    expect(resolveMediaType("video")).toBe("video");
  });
  test('"VIDEO" (upper case) resolves to video', () => {
    expect(resolveMediaType("VIDEO")).toBe("video");
  });
  test("mixed case and surrounding whitespace resolve to video", () => {
    expect(resolveMediaType("  Video ")).toBe("video");
  });
  test('"AI_VIDEO" — the one scene media type that means motion — resolves to video', () => {
    expect(resolveMediaType("AI_VIDEO")).toBe("video");
  });
});

describe("resolveMediaType: explicit still-image types keep resolving to image", () => {
  for (const explicit of ["STOCK", "AI_IMAGE", "ANIMATION", "IMAGE"]) {
    test(`"${explicit}" resolves to image`, () => {
      expect(resolveMediaType(explicit)).toBe("image");
    });
  }
  test("the same values are case-insensitive", () => {
    expect(resolveMediaType("stock")).toBe("image");
    expect(resolveMediaType("ai_image")).toBe("image");
    expect(resolveMediaType("animation")).toBe("image");
  });
});

describe("resolveMediaType: a missing or unknown value keeps the documented default", () => {
  test("undefined → image", () => {
    expect(resolveMediaType(undefined)).toBe("image");
  });
  test("null → image", () => {
    expect(resolveMediaType(null)).toBe("image");
  });
  test("empty / whitespace-only → image", () => {
    expect(resolveMediaType("")).toBe("image");
    expect(resolveMediaType("   ")).toBe("image");
  });
  test("unknown scene media types → image, never promoted to video", () => {
    for (const unknown of ["CHART", "INFOGRAPHIC", "MAP", "TIMELINE", "TEXT_ANIMATION", "SCREEN_SIMULATION"]) {
      expect({ unknown, resolved: resolveMediaType(unknown) }).toEqual({ unknown, resolved: "image" });
    }
  });
  test("a typo or free text is not guessed as video", () => {
    expect(resolveMediaType("vidio")).toBe("image");
    expect(resolveMediaType("footage of a city at night")).toBe("image");
  });
});

describe("the query builder threads the resolved type through", () => {
  test("an explicit video hint reaches the provider-facing query", () => {
    const q = buildSemanticQuery({ narration: "a city at night", mediaType: "video" });
    expect(q.mediaType).toBe("video");
  });
  test("no hint still asks for images", () => {
    const q = buildSemanticQuery({ narration: "a city at night" });
    expect(q.mediaType).toBe("image");
  });
  test("the resolution is reported in the query's own rationale", () => {
    const askedVideo = buildSemanticQuery({ narration: "a city at night", mediaType: "VIDEO" });
    expect(askedVideo.rationale.mediaType).toContain("searching video");
    const askedNothing = buildSemanticQuery({ narration: "a city at night" });
    expect(askedNothing.rationale.mediaType).toContain("searching image");
    expect(askedNothing.rationale.mediaType).toContain("documented default");
  });
});

describe("the route's standalone q= form forwards the same hint", () => {
  test("the direct branch reads ?mediaType= rather than dropping it", () => {
    const src = readFileSync(join(import.meta.dir, "../../../app/api/media/route.ts"), "utf8");
    const branch = src.slice(src.indexOf("} else if (direct) {"), src.indexOf("} else {", src.indexOf("} else if (direct) {")));
    expect(branch).toContain('mediaType: str(sp.get("mediaType"))');
  });
});
