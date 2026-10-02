/**
 * Phase 5 Block 5b — geometry / formats / policy unit tests (pure, no IO).
 *
 * These assert the NUMBERS, not the prose: a 16:9 → 9:16 cover crop of a
 * 1920×1080 frame really keeps 608 of 1920 columns and all 1080 rows at a
 * 1.7778× scale, the safe areas really land on those pixel rects, and the caption
 * band really is the subtitle engine's own geometry scaled to the frame. If the
 * arithmetic drifts, these fail.
 */
import { describe, expect, test } from "bun:test";
import {
  ACTION_SAFE_FRACTION,
  FRAME_FORMATS,
  FRAME_FORMAT_SPECS,
  TITLE_SAFE_FRACTION,
  captionBand,
  formatForAspectValue,
  isFrameFormatId,
  listFormatViews,
  safeAreas,
  sourceAspectSpec,
} from "../formats";
import {
  bestWindowFor,
  buildKeyframes,
  clampInside,
  coverCrop,
  cropsEqual,
  intersectRect,
  keyframeTimes,
  mapSourceRectToTarget,
  retainedAreaRatio,
} from "../geometry";
import { anchorCheck, decideFramingPolicy, isFramingPolicyId, sourceActionSafeRect, FRAMING_POLICIES } from "../policies";
import { CAPTION_LINE_HEIGHT_PX, MAX_CAPTION_LINES, SUBTITLE_SAFE_MARGINS } from "../../subtitles/positioning";

const LANDSCAPE = { widthPx: 1920, heightPx: 1080, aspect: "16:9", aspectValue: 16 / 9 };
const VERTICAL = { widthPx: 1080, heightPx: 1920, aspect: "9:16", aspectValue: 9 / 16 };
const TARGET_9x16 = { widthPx: 1080, heightPx: 1920, aspect: "9:16", aspectValue: 9 / 16 };
const TARGET_16x9 = { widthPx: 1920, heightPx: 1080, aspect: "16:9", aspectValue: 16 / 9 };
const TARGET_SQUARE = { widthPx: 1080, heightPx: 1080, aspect: "1:1", aspectValue: 1 };

describe("framing formats — the delivery catalogue", () => {
  test("lists exactly the four formats with real resolutions", () => {
    expect(FRAME_FORMATS).toEqual(["16:9", "9:16", "1:1", "4:5"]);
    expect(FRAME_FORMAT_SPECS["16:9"].widthPx).toBe(1920);
    expect(FRAME_FORMAT_SPECS["16:9"].heightPx).toBe(1080);
    expect(FRAME_FORMAT_SPECS["9:16"].widthPx).toBe(1080);
    expect(FRAME_FORMAT_SPECS["9:16"].heightPx).toBe(1920);
    expect(FRAME_FORMAT_SPECS["1:1"].widthPx).toBe(1080);
    expect(FRAME_FORMAT_SPECS["1:1"].heightPx).toBe(1080);
    expect(FRAME_FORMAT_SPECS["4:5"].widthPx).toBe(1080);
    expect(FRAME_FORMAT_SPECS["4:5"].heightPx).toBe(1350);
  });

  test("each format's view carries its safe areas and delivery notes", () => {
    const views = listFormatViews();
    expect(views.length).toBe(4);
    const vertical = views.find((v) => v["id"] === "9:16") as Record<string, unknown>;
    expect(vertical["resolution"]).toBe("1080×1920");
    expect(vertical["orientation"]).toBe("portrait");
    const safe = vertical["safeAreas"] as Record<string, Record<string, unknown>>;
    expect(safe["actionSafe"]["fraction"]).toBe(ACTION_SAFE_FRACTION);
    expect(safe["titleSafe"]["fraction"]).toBe(TITLE_SAFE_FRACTION);
    // 1080×1920 → action-safe 1004×1786 at (38, 67); title-safe 972×1728 at (54, 96)
    expect(safe["actionSafe"]["width"]).toBe(1004);
    expect(safe["actionSafe"]["height"]).toBe(1786);
    expect(safe["actionSafe"]["x"]).toBe(38);
    expect(safe["actionSafe"]["y"]).toBe(67);
    expect(safe["titleSafe"]["width"]).toBe(972);
    expect(safe["titleSafe"]["height"]).toBe(1728);
    expect((vertical["deliveryNotes"] as string[]).length).toBeGreaterThan(0);
  });

  test("safe areas are the conventional insets of the frame", () => {
    const safe = safeAreas(LANDSCAPE);
    expect(safe.actionSafe).toEqual({ x: 67, y: 38, width: 1786, height: 1004 });
    expect(safe.titleSafe).toEqual({ x: 96, y: 54, width: 1728, height: 972 });
  });

  test("the caption band is the subtitle engine's own geometry, scaled", () => {
    const cap = captionBand(LANDSCAPE);
    expect(cap.marginX).toBe(SUBTITLE_SAFE_MARGINS.x);
    expect(cap.marginY).toBe(SUBTITLE_SAFE_MARGINS.y);
    expect(cap.lineHeight).toBe(CAPTION_LINE_HEIGHT_PX);
    expect(cap.maxLines).toBe(MAX_CAPTION_LINES);
    // bottom-centre: y = height - marginY - lineHeight*maxLines
    expect(cap.rect).toEqual({ x: 48, y: 904, width: 1824, height: 128 });
    expect(cap.basis).toContain("subtitle engine");

    const vertical = captionBand(VERTICAL);
    // scale = 1920/1080 = 1.7778 → margins 85 / 85, line height 114, band 228
    expect(vertical.marginX).toBe(85);
    expect(vertical.marginY).toBe(85);
    expect(vertical.lineHeight).toBe(114);
    expect(vertical.rect.height).toBe(228);
    expect(vertical.rect.y).toBe(1920 - 85 - 228);
    expect(safeAreas(VERTICAL).captionSafe).toEqual(vertical.rect);
  });

  test("source aspects map to real enum values and stated fallbacks", () => {
    expect(sourceAspectSpec("SIXTEEN_NINE")?.widthPx).toBe(1920);
    expect(sourceAspectSpec("NINE_SIXTEEN")?.heightPx).toBe(1920);
    expect(sourceAspectSpec("TWENTY_ONE_NINE")?.aspectValue).toBeCloseTo(2.3333, 4);
    expect(sourceAspectSpec("NOT_A_REAL_ENUM")).toBeNull();
    expect(sourceAspectSpec(null)).toBeNull();

    const sixteenNine = formatForAspectValue(16 / 9);
    expect(sixteenNine.id).toBe("16:9");
    expect(sixteenNine.exact).toBe(true);
    expect(formatForAspectValue(9 / 16).id).toBe("9:16");
    expect(formatForAspectValue(1).id).toBe("1:1");
    expect(formatForAspectValue(4 / 5).id).toBe("4:5");
    // 4:3 and 21:9 have no exact format: the fallback is STATED, not silent.
    const fourThree = formatForAspectValue(4 / 3);
    expect(fourThree.id).toBe("16:9");
    expect(fourThree.exact).toBe(false);
    expect(fourThree.note).toContain("stated, not guessed");
    expect(isFrameFormatId("9:16")).toBe(true);
    expect(isFrameFormatId("21:9")).toBe(false);
  });
});

describe("cover crop — the geometry a format change really produces", () => {
  test("16:9 → 9:16 keeps the centre columns and the full height", () => {
    const crop = coverCrop(LANDSCAPE, TARGET_9x16, { x: 0.5, y: 0.5 });
    expect(crop.scale).toBe(1.7778);
    expect(crop.crop).toEqual({ x: 656, y: 0, width: 608, height: 1080 });
    expect(crop.travelPx).toEqual({ x: 1312, y: 0 });
    expect(crop.retained.widthFraction).toBe(0.3167);
    expect(crop.retained.heightFraction).toBe(1);
    expect(crop.retained.areaFraction).toBe(0.3167);
    expect(crop.cropNormalized.width).toBeCloseTo(0.3167, 4);
    expect(crop.anchorOffsetPx).toEqual({ x: 0, y: 0 });
  });

  test("the source's action-safe rect survives only partly, and the numbers say how much", () => {
    const safe = sourceActionSafeRect(LANDSCAPE);
    expect(safe).toEqual({ x: 67, y: 38, width: 1786, height: 1004 });
    const crop = coverCrop(LANDSCAPE, TARGET_9x16, { x: 0.5, y: 0.5 }, safe);
    expect(crop.sourceActionSafeRetained.xFraction).toBe(0.3404);
    expect(crop.sourceActionSafeRetained.yFraction).toBe(1);
  });

  test("16:9 → 1:1 crops the sides and keeps the full height", () => {
    const crop = coverCrop(LANDSCAPE, TARGET_SQUARE, { x: 0.5, y: 0.5 });
    expect(crop.scale).toBe(1);
    expect(crop.crop).toEqual({ x: 420, y: 0, width: 1080, height: 1080 });
    expect(crop.retained.widthFraction).toBe(0.5625);
    expect(crop.retained.heightFraction).toBe(1);
  });

  test("16:9 → 16:9 crops nothing at all", () => {
    const crop = coverCrop(LANDSCAPE, TARGET_16x9, { x: 0.5, y: 0.5 });
    expect(crop.scale).toBe(1);
    expect(crop.crop).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(crop.travelPx).toEqual({ x: 0, y: 0 });
    expect(crop.retained.areaFraction).toBe(1);
  });

  test("9:16 → 16:9 is a HEIGHT crop with real vertical travel", () => {
    const crop = coverCrop(VERTICAL, TARGET_16x9, { x: 0.5, y: 0.5 });
    expect(crop.crop).toEqual({ x: 0, y: 656, width: 1080, height: 608 });
    expect(crop.travelPx).toEqual({ x: 0, y: 1312 });
    expect(crop.retained.heightFraction).toBe(0.3167);
  });

  test("the anchor really moves the window (and never leaves the source)", () => {
    const top = coverCrop(VERTICAL, TARGET_16x9, { x: 0.5, y: 0 });
    expect(top.crop.y).toBe(0);
    const bottom = coverCrop(VERTICAL, TARGET_16x9, { x: 0.5, y: 1 });
    expect(bottom.crop.y).toBe(1312); // 1920 - 608
    const offCentre = coverCrop(LANDSCAPE, TARGET_9x16, { x: 0, y: 0.5 });
    expect(offCentre.crop.x).toBe(0);
    expect(offCentre.anchorOffsetPx.x).toBe(304); // window centre 304 vs anchor 0
    // Any anchor keeps the window inside the frame.
    for (const a of [0, 0.25, 0.5, 0.75, 1]) {
      const c = coverCrop(LANDSCAPE, TARGET_9x16, { x: a, y: a });
      expect(c.crop.x).toBeGreaterThanOrEqual(0);
      expect(c.crop.x + c.crop.width).toBeLessThanOrEqual(1920);
      expect(c.crop.y + c.crop.height).toBeLessThanOrEqual(1080);
    }
  });

  test("a 21:9 source into 9:16 keeps only a fifth of its columns", () => {
    const wide = { widthPx: 2560, heightPx: 1080, aspect: "21:9", aspectValue: 21 / 9 };
    const crop = coverCrop(wide, TARGET_9x16, { x: 0.5, y: 0.5 });
    expect(crop.crop).toEqual({ x: 976, y: 0, width: 608, height: 1080 });
    expect(crop.retained.widthFraction).toBe(0.2375);
    expect(crop.scale).toBe(1.7778);
  });
});

describe("rect helpers", () => {
  test("intersection, retention and source→target mapping", () => {
    expect(intersectRect({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toEqual({
      x: 5,
      y: 5,
      width: 5,
      height: 5,
    });
    expect(intersectRect({ x: 0, y: 0, width: 10, height: 10 }, { x: 20, y: 20, width: 5, height: 5 })).toEqual({
      x: 20,
      y: 20,
      width: 0,
      height: 0,
    });
    expect(retainedAreaRatio({ x: 0, y: 0, width: 100, height: 100 }, { x: 50, y: 50, width: 100, height: 100 })).toBe(0.25);
    expect(retainedAreaRatio({ x: 0, y: 0, width: 0, height: 0 }, { x: 0, y: 0, width: 10, height: 10 })).toBe(0);
    const mapped = mapSourceRectToTarget({ x: 48, y: 904, width: 1824, height: 128 }, { x: 656, y: 0, width: 608, height: 1080 }, 1.7778);
    expect(mapped.x).toBe(Math.round((48 - 656) * 1.7778));
    expect(mapped.width).toBe(Math.round(1824 * 1.7778));
  });

  test("clamping reports what it actually moved", () => {
    const out = clampInside({ x: 0, y: 0, width: 608, height: 1080 }, { x: 67, y: 38, width: 1786, height: 1004 });
    expect(out.crop.x).toBe(67);
    expect(out.applied.x).toBe(true);
    // the window (1080 tall) is taller than the bound (1004): y is NOT clamped
    expect(out.applied.y).toBe(false);
    expect(out.note).toContain("not clamped");
  });

  test("bestWindowFor keeps the most of a band and is deterministic", () => {
    const band = { x: 85, y: 1607, width: 910, height: 228 };
    const once = bestWindowFor({ x: 0, y: 656, width: 1080, height: 608 }, VERTICAL, band, "y");
    const twice = bestWindowFor({ x: 0, y: 656, width: 1080, height: 608 }, VERTICAL, band, "y");
    expect(once).toEqual(twice);
    expect(once.retained).toBe(1);
    expect(once.crop.height).toBe(608); // the window size never changes
    expect(once.crop.y).toBe(1227); // 1607 + 228 - 608 — the lowest position keeping the whole band
  });
});

describe("keyframe paths", () => {
  test("keyframe times always include both ends", () => {
    expect(keyframeTimes(6000, 3)).toEqual([0, 3000, 6000]);
    expect(keyframeTimes(6000, 5)).toEqual([0, 1500, 3000, 4500, 6000]);
    expect(keyframeTimes(0, 3)).toEqual([0]);
  });

  test("a hold produces identical keyframes and a pan interpolates linearly", () => {
    const hold = buildKeyframes({
      timesMs: [0, 500, 1000],
      cropStart: { x: 656, y: 0, width: 608, height: 1080 },
      cropEnd: { x: 656, y: 0, width: 608, height: 1080 },
      scale: 1.7778,
      source: LANDSCAPE,
    });
    expect(hold.length).toBe(3);
    expect(hold[0].crop).toEqual(hold[2].crop);
    expect(cropsEqual(hold[0].crop, hold[1].crop)).toBe(true);
    expect(hold[2].relative).toBe(1);
    expect(hold[0].note).toContain("first keyframe");

    const pan = buildKeyframes({
      timesMs: [0, 500, 1000],
      cropStart: { x: 0, y: 0, width: 608, height: 1080 },
      cropEnd: { x: 1312, y: 0, width: 608, height: 1080 },
      scale: 1.7778,
      source: LANDSCAPE,
    });
    expect(pan[0].crop.x).toBe(0);
    expect(pan[1].crop.x).toBe(656);
    expect(pan[2].crop.x).toBe(1312);
    expect(pan[1].cropNormalized.x).toBeCloseTo(656 / 1920, 4);
  });
});

describe("framing policies — stated rules and data-cited selection", () => {
  test("the catalogue has the four policies with their rules verbatim", () => {
    expect(FRAMING_POLICIES).toEqual(["centre-cover", "upper-third-bias", "caption-safe-hold", "pan-across-travel"]);
    expect(isFramingPolicyId("centre-cover")).toBe(true);
    expect(isFramingPolicyId("magic-framing")).toBe(false);
  });

  test("16:9 → 9:16 with captions: the centre fallback, and the band keeps its rows", () => {
    const band = captionBand(LANDSCAPE).rect;
    const decision = decideFramingPolicy(
      {
        source: LANDSCAPE,
        target: TARGET_9x16,
        captionsPresent: true,
        caption: { band, basis: "test" },
        narrationBeared: true,
        sceneAspectDeclared: "SIXTEEN_NINE",
        requested: null,
        requestedAnchor: null,
      },
      safeAreas(TARGET_9x16).captionSafe,
    );
    expect(decision.engineDefault).toBe("centre-cover");
    expect(decision.policy.id).toBe("centre-cover");
    expect(decision.crop.crop).toEqual({ x: 656, y: 0, width: 608, height: 1080 });
    expect(decision.caption.verticalFraction).toBe(1);
    expect(decision.caption.horizontalFraction).toBe(0.3333);
    expect(decision.selectedBecause).toContain("caption band occupies");
    expect(decision.signals.some((s) => s.signal === "travel")).toBe(true);
    expect(decision.motion.kind).toBe("hold");
    expect(decision.motion.basis).toBe("no-motion-data");
  });

  test("9:16 → 16:9 with captions: caption-safe-hold really slides the window", () => {
    const band = captionBand(VERTICAL).rect;
    const decision = decideFramingPolicy(
      {
        source: VERTICAL,
        target: TARGET_16x9,
        captionsPresent: true,
        caption: { band, basis: "test" },
        narrationBeared: false,
        sceneAspectDeclared: null,
        requested: null,
        requestedAnchor: null,
      },
      safeAreas(TARGET_16x9).captionSafe,
    );
    expect(decision.engineDefault).toBe("caption-safe-hold");
    expect(decision.baseCrop.crop.y).toBe(656); // centred: cuts the whole band away
    expect(decision.crop.crop.y).toBe(1227); // slid down to keep it
    expect(decision.caption.verticalFraction).toBe(1);
    expect(decision.selectedBecause).toContain("must not be cropped out");
    expect(decision.signals.some((s) => s.signal === "caption slide")).toBe(true);
  });

  test("narration-bearing vertical-travel clips get the upper-third rule, with the caveat stated", () => {
    const decision = decideFramingPolicy(
      {
        source: VERTICAL,
        target: TARGET_16x9,
        captionsPresent: false,
        caption: null,
        narrationBeared: true,
        sceneAspectDeclared: "NINE_SIXTEEN",
        requested: null,
        requestedAnchor: null,
      },
      safeAreas(TARGET_16x9).captionSafe,
    );
    expect(decision.engineDefault).toBe("upper-third-bias");
    expect(decision.crop.crop.y).toBe(336); // round(1920/3) - 304 = 640-304
    expect(decision.selectedBecause).toContain("not a measurement");
    expect(decision.alternatives.some((a) => a.policy === "centre-cover")).toBe(true);
  });

  test("no captions and no narration: the honest centre fallback", () => {
    const decision = decideFramingPolicy(
      {
        source: LANDSCAPE,
        target: TARGET_9x16,
        captionsPresent: false,
        caption: null,
        narrationBeared: false,
        sceneAspectDeclared: null,
        requested: null,
        requestedAnchor: null,
      },
      safeAreas(TARGET_9x16).captionSafe,
    );
    expect(decision.engineDefault).toBe("centre-cover");
    expect(decision.policy.requested).toBe(false);
    expect(decision.caption.present).toBe(false);
    expect(decision.caption.note).toContain("no captions clip");
    expect(decision.selectedBecause).toContain("nothing locates a subject");
  });

  test("explicit policies and anchors are honoured, and the engine's own choice is still reported", () => {
    const pan = decideFramingPolicy(
      {
        source: LANDSCAPE,
        target: TARGET_9x16,
        captionsPresent: false,
        caption: null,
        narrationBeared: false,
        sceneAspectDeclared: null,
        requested: "pan-across-travel",
        requestedAnchor: null,
      },
      safeAreas(TARGET_9x16).captionSafe,
    );
    expect(pan.policy.requested).toBe(true);
    expect(pan.motion.kind).toBe("pan");
    expect(pan.motion.travelPx).toBe(1312);
    expect(pan.motion.basis).toBe("stated-rule");
    expect(pan.panStart.x).toBe(0);
    expect(pan.panEnd.x).toBe(1312);
    expect(pan.selectedBecause).toContain("requested explicitly");

    const anchored = decideFramingPolicy(
      {
        source: LANDSCAPE,
        target: TARGET_9x16,
        captionsPresent: false,
        caption: null,
        narrationBeared: false,
        sceneAspectDeclared: null,
        requested: null,
        requestedAnchor: { x: 0.25, y: 0.5 },
      },
      safeAreas(TARGET_9x16).captionSafe,
    );
    expect(anchored.policy.anchor).toEqual({ x: 0.25, y: 0.5 });
    expect(anchored.policy.anchorSource).toBe("override-anchor");
    expect(anchored.crop.crop.x).toBe(176); // 0.25*1920 - 304
    // The action-safe invariant then reports honestly what it did (or did not) do.
    expect(typeof anchored.safeAreaClamp.applied).toBe("boolean");
  });

  test("the action-safe invariant reports real numbers when it does not need to move", () => {
    const decision = decideFramingPolicy(
      {
        source: LANDSCAPE,
        target: TARGET_9x16,
        captionsPresent: false,
        caption: null,
        narrationBeared: false,
        sceneAspectDeclared: null,
        requested: null,
        requestedAnchor: null,
      },
      safeAreas(TARGET_9x16).captionSafe,
    );
    expect(decision.safeAreaClamp.applied).toBe(false);
    expect(decision.safeAreaClamp.bounds).toEqual({ x: 67, y: 38, width: 1786, height: 1004 });
    expect(decision.safeAreaClamp.note).toContain("No shift was needed");
  });

  test("anchorCheck is honest: no field locates a subject, and it says which were checked", () => {
    const check = anchorCheck();
    expect(check.known).toBe(false);
    expect(check.anchorKind).toBe("rule-position");
    expect(check.checked.length).toBeGreaterThanOrEqual(6);
    expect(check.checked.every((f) => f.locatesSubject === false)).toBe(true);
    const fields = check.checked.map((f) => f.field);
    expect(fields).toContain("Asset.width / Asset.height");
    expect(fields).toContain("Asset.metadata (Json)");
    expect(fields).toContain("subtitles.avoidRegions()");
    expect(check.reason).toContain("UNKNOWN");
    expect(check.reason).toContain("never invents a subject position");
  });
});
