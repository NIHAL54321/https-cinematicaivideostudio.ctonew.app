import { describe, expect, test } from "bun:test";
import { autoSubtitleStyle, findSubtitleStyle, SUBTITLE_STYLES } from "../styles";

/**
 * Phase 4 Block 3 — Subtitle styles tests (deterministic layer).
 * Rules under test: 8 styles with all spec fields; auto-choice is
 * deterministic and scoped to the expectations in the brief
 * (documentary→Minimal, emotional→Cinematic, tech→Modern,
 * creator/energetic→Creator/Bold, shorts→Yellow, karaoke for lyrics).
 */

describe("style catalog", () => {
  test("exposes exactly the 8 spec styles with unique ids", () => {
    expect(SUBTITLE_STYLES.length).toBe(8);
    const ids = new Set(SUBTITLE_STYLES.map((s) => s.id));
    expect(ids.size).toBe(8);
  });

  test("every style carries the full spec field set", () => {
    for (const s of SUBTITLE_STYLES) {
      expect(typeof s.name).toBe("string");
      expect(typeof s.font).toBe("string");
      expect(typeof s.size).toBe("number");
      expect(typeof s.color).toBe("string");
      expect(typeof s.highlightColor).toBe("string");
      expect(typeof s.background).toBe("string");
      expect(["bottom", "center", "top"]).toContain(s.position);
      expect(typeof s.uppercase).toBe("boolean");
      expect(typeof s.outline.width).toBe("number");
      expect(typeof s.shadow.blur).toBe("number");
      expect(typeof s.karaoke).toBe("boolean");
    }
  });

  test("only the karaoke style has karaoke: true", () => {
    expect(SUBTITLE_STYLES.filter((s) => s.karaoke).map((s) => s.id)).toEqual(["karaoke"]);
  });

  test("findSubtitleStyle resolves by id and name", () => {
    expect(findSubtitleStyle("minimal")?.name).toBe("Minimal");
    expect(findSubtitleStyle("Yellow")?.id).toBe("yellow");
    expect(findSubtitleStyle("nope")).toBeNull();
  });
});

describe("autoSubtitleStyle", () => {
  test("is deterministic — same input yields same style + reason", () => {
    const a = autoSubtitleStyle({ topic: "documentary on history" });
    const b = autoSubtitleStyle({ topic: "documentary on history" });
    expect(a.style.id).toBe(b.style.id);
    expect(a.reason).toBe(b.reason);
  });

  test("no input → Minimal with a reason", () => {
    const r = autoSubtitleStyle({});
    expect(r.style.id).toBe("minimal");
    expect(r.reason.length).toBeGreaterThan(0);
  });

  test("documentary topic → Minimal", () => {
    const r = autoSubtitleStyle({ topic: "documentary on deep sea life" });
    expect(r.style.id).toBe("minimal");
    expect(r.reason.toLowerCase()).toContain("documentary");
  });

  test("shorts format → Yellow (high-contrast mobile captions)", () => {
    const r = autoSubtitleStyle({ videoKind: "shorts" });
    expect(["yellow", "bold"]).toContain(r.style.id);
  });

  test("emotional tone → Cinematic", () => {
    const r = autoSubtitleStyle({ emotion: "emotional" });
    expect(r.style.id).toBe("cinematic");
    expect(r.reason.toLowerCase()).toContain("emotional");
  });

  test("technology topic → Modern", () => {
    const r = autoSubtitleStyle({ topic: "AI technology explained" });
    expect(r.style.id).toBe("modern");
  });

  test("creator / energetic input → Creator", () => {
    const r = autoSubtitleStyle({ emotion: "creator" });
    expect(r.style.id).toBe("creator");
  });

  test("karaoke / lyrics input → Karaoke", () => {
    const r = autoSubtitleStyle({ topic: "karaoke lyrics of old love songs" });
    expect(r.style.id).toBe("karaoke");
  });

  test("motivational energy → Bold", () => {
    const r = autoSubtitleStyle({ emotion: "motivational" });
    expect(r.style.id).toBe("bold");
  });
});