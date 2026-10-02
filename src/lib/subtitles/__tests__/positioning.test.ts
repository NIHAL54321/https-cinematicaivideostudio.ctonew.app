import { describe, expect, test } from "bun:test";
import { avoidRegions, SUBTITLE_SAFE_MARGINS, CAPTION_LINE_HEIGHT_PX, type Region } from "../positioning";

/**
 * Phase 4 Block 3 — Smart subtitle positioning tests (deterministic layer).
 * Rules under test: default placements sit at bottom-center within safe
 * margins; a face/text/chart/subject region at the default spot forces a move
 * (never placing the cue over the region); safe-margin fallback when every
 * slot is blocked.
 */

const W = 1920;
const H = 1080;
const WIDTH = 1920 - 2 * SUBTITLE_SAFE_MARGINS.x; // 1824
const DEFAULT_Y = H - SUBTITLE_SAFE_MARGINS.y - 128; // 904

function intersects(r: Region, x: number, y: number, w: number, h: number): boolean {
  return r.x < x + w && r.x + r.w > x && r.y < y + h && r.y + r.h > y;
}

describe("default placement", () => {
  test("no regions → bottom-center within safe margins, reason default", () => {
    const out = avoidRegions({ cueTexts: ["Hello world."], regions: [], videoWidth: W, videoHeight: H });
    expect(out.length).toBe(1);
    expect(out[0].reason).toBe("default");
    expect(out[0].y).toBe(DEFAULT_Y);
    expect(out[0].x).toBe(Math.round((W - WIDTH) / 2));
    expect(out[0].width).toBe(WIDTH);
    expect(out[0].maxLines).toBeGreaterThanOrEqual(1);
  });

  test("one placement per cue text, deterministic", () => {
    const a = avoidRegions({ cueTexts: ["one", "two", "three"], regions: [], videoWidth: W, videoHeight: H });
    const b = avoidRegions({ cueTexts: ["one", "two", "three"], regions: [], videoWidth: W, videoHeight: H });
    expect(a.length).toBe(3);
    expect(a).toEqual(b);
  });
});

describe("region avoidance", () => {
  test("a face region at bottom-center forces a move upward", () => {
    const region: Region = { label: "face", x: 700, y: 760, w: 420, h: 260 };
    const out = avoidRegions({ cueTexts: ["Subtitles here please."], regions: [region], videoWidth: W, videoHeight: H });
    expect(out[0].reason).toContain("avoided:");
    expect(out[0].y).toBeLessThan(DEFAULT_Y);
    // The chosen spot never intersects the face region (cue rendered at its
    // actual height — the engine models height as LINE_HEIGHT * maxLines).
    expect(intersects(region, out[0].x, out[0].y, out[0].width, CAPTION_LINE_HEIGHT_PX * out[0].maxLines)).toBe(false);
  });

  test("a chart region at the default spot is avoided too", () => {
    const region: Region = { label: "chart", x: 500, y: 800, w: 900, h: 220 };
    const out = avoidRegions({ cueTexts: ["Numbers keep coming in."], regions: [region], videoWidth: W, videoHeight: H });
    expect(out[0].reason).toBe("avoided:chart");
    expect(intersects(region, out[0].x, out[0].y, out[0].width, CAPTION_LINE_HEIGHT_PX * out[0].maxLines)).toBe(false);
  });

  test("never places a cue over any supplied region", () => {
    const regions: Region[] = [
      { label: "text", x: 300, y: 820, w: 500, h: 160 },
      { label: "subject", x: 1400, y: 700, w: 300, h: 300 },
      { label: "face", x: 800, y: 200, w: 400, h: 300 },
    ];
    const out = avoidRegions({
      cueTexts: Array(8).fill("A subtitle line that is reasonably long for wrapping."),
      regions,
      videoWidth: W,
      videoHeight: H,
    });
    for (const p of out) {
      expect(p.y).toBeGreaterThanOrEqual(SUBTITLE_SAFE_MARGINS.y);
      for (const r of regions) {
        expect(intersects(r, p.x, p.y, p.width, CAPTION_LINE_HEIGHT_PX * p.maxLines)).toBe(false);
      }
    }
  });

  test("keeps the substring label in the reason", () => {
    const out = avoidRegions({
      cueTexts: ["one"],
      regions: [{ label: "text", x: 0, y: 700, w: 1920, h: 380 }],
      videoWidth: W,
      videoHeight: H,
    });
    expect(out[0].reason.startsWith("avoided:")).toBe(true);
  });
});

describe("safe-margin fallback", () => {
  test("a region covering the whole frame falls back to a safe-margin position", () => {
    const region: Region = { label: "face", x: 0, y: 0, w: 1920, h: 1080 };
    const out = avoidRegions({ cueTexts: ["Blocked everywhere."], regions: [region], videoWidth: W, videoHeight: H });
    expect(out[0].reason).toBe("safe-margin");
    expect(out[0].y).toBe(SUBTITLE_SAFE_MARGINS.y); // top of the safe area
  });

  test("full-screen text region also falls back gracefully", () => {
    const region: Region = { label: "text", x: 0, y: 0, w: 1920, h: 1080 };
    const out = avoidRegions({ cueTexts: ["x"], regions: [region], videoWidth: W, videoHeight: H });
    expect(out[0].reason).toBe("safe-margin");
  });

  test("invalid regions are ignored (never blow up, default placement)", () => {
    const out = avoidRegions({
      cueTexts: ["fine"],
      regions: [
        { label: "face", x: 0, y: 0, w: 0, h: 100 }, // zero-size → ignored
        { label: "???" as Region["label"], x: 0, y: 0, w: 100, h: 100 }, // bad label → ignored
      ],
      videoWidth: W,
      videoHeight: H,
    });
    expect(out[0].reason).toBe("default");
  });
});

describe("safe margins", () => {
  test("constant exposes the 1080p base margins", () => {
    expect(SUBTITLE_SAFE_MARGINS).toEqual({ x: 48, y: 48 });
  });

  test("placements respect horizontal margin on small frames", () => {
    const out = avoidRegions({ cueTexts: ["slim"], regions: [], videoWidth: 320, videoHeight: 240 });
    expect(out[0].x).toBeGreaterThanOrEqual(0);
    expect(out[0].width).toBe(320 - 2 * SUBTITLE_SAFE_MARGINS.x);
  });
});