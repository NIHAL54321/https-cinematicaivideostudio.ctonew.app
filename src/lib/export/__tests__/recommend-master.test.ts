/**
 * Phase 8 block 2a — the smart recommendation and the YouTube delivery master.
 *
 * Two jobs here:
 *   1. the recommendation picks a preset from MEASURED facts, prints its reasons,
 *      and says it is on a partial basis when a fact it needed is not measurable;
 *   2. the master's copy and every exported payload are scanned for the claims
 *      this product must never make — a particular codec being used by the
 *      platform, a ranking, a reach, a guarantee, a search-volume figure — with
 *      negative controls proving the scan actually fires.
 */
import { describe, expect, test } from "bun:test";
import {
  RECOMMENDATION_NOT_CLAIMED,
  recommendPreset,
  recommendationView,
  type ProjectMeasurement,
} from "../recommend";
import {
  FORBIDDEN_MASTER_CLAIMS,
  KEYFRAME_INTERVAL_SECONDS,
  YOUTUBE_MASTER_BOUNDARY,
  encodeCommandPlan,
  masterChoices,
  masterView,
  scanForbiddenClaims,
} from "../youtube-master";
import { EXPORT_PRESETS, findExportPreset, listExportPresetViews } from "../presets";

function measurement(over: Partial<ProjectMeasurement> = {}): ProjectMeasurement {
  return {
    projectId: "p1",
    title: "The Future of Artificial Intelligence",
    targetPlatform: null,
    durationSeconds: 600,
    targetDurationSeconds: null,
    sceneCount: 8,
    aspect: "16:9",
    aspectSource: "Project.targetAspectRatio",
    assetCount: 8,
    assetMaxWidthPx: 1920,
    assetMaxHeightPx: 1080,
    measuredAt: "2026-10-24T00:00:00.000Z",
    ...over,
  };
}

describe("recommendation — from measured facts, with reasons", () => {
  test("a 1080p 16:9 project is recommended 1080p, and the source resolution is the reason", () => {
    const r = recommendPreset(measurement());
    expect(r.presetId).toBe("youtube-1080p");
    expect(r.basis.complete).toBe(true);
    const source = r.reasons.find((x) => x.fact === "source resolution");
    expect(source).toBeDefined();
    expect(source!.reading).toContain("1920×1080");
    expect(source!.why).toContain("upscale of pixels that do not exist");
  });

  test("a 2160-line source is recommended 2160p — and only for that reason", () => {
    const r = recommendPreset(measurement({ assetMaxWidthPx: 3840, assetMaxHeightPx: 2160 }));
    expect(r.presetId).toBe("youtube-2160p");
    expect(r.reasons.some((x) => x.why.includes("not an upscale"))).toBe(true);
  });

  test("each aspect picks the preset that delivers that frame", () => {
    expect(recommendPreset(measurement({ aspect: "9:16" })).presetId).toBe("youtube-shorts");
    expect(recommendPreset(measurement({ aspect: "1:1" })).presetId).toBe("square-1080");
    expect(recommendPreset(measurement({ aspect: "4:5" })).presetId).toBe("portrait-4x5");
  });

  test("an explicit target platform decides the preset, and says so", () => {
    const r = recommendPreset(measurement({ targetPlatform: "youtube-shorts" }));
    expect(r.presetId).toBe("youtube-shorts");
    expect(r.reasons[0].fact).toContain("target platform");
  });

  test("every recommendation prints the reasons it chose, and what it does not claim", () => {
    const r = recommendPreset(measurement());
    expect(r.reasons.length).toBeGreaterThanOrEqual(3);
    for (const x of r.reasons) {
      expect(x.fact.length).toBeGreaterThan(3);
      expect(x.reading.length).toBeGreaterThan(3);
      expect(x.why.length).toBeGreaterThan(20);
    }
    expect(r.notClaimed).toEqual([...RECOMMENDATION_NOT_CLAIMED]);
    expect(r.producedOnThisBuild).toBe(false);
    expect(r.headline).toContain("no file is produced on this build");
  });
});

describe("recommendation — partial basis when a fact is not measurable", () => {
  test("no asset carries pixel dimensions → partial basis, 1080p, and the gap is named", () => {
    const r = recommendPreset(measurement({ assetCount: 3, assetMaxWidthPx: null, assetMaxHeightPx: null }));
    expect(r.basis.complete).toBe(false);
    expect(r.presetId).toBe("youtube-1080p");
    expect(r.basis.statement).toContain("PARTIAL BASIS");
    const missing = r.basis.missing.find((m) => m.fact === "the source resolution");
    expect(missing).toBeDefined();
    expect(missing!.instead).toContain("did NOT");
    expect(missing!.instead).toContain("partial basis");
  });

  test("no declared scene duration → the duration gap is named and nothing is invented", () => {
    const r = recommendPreset(measurement({ durationSeconds: null }));
    expect(r.basis.complete).toBe(false);
    expect(r.basis.missing.some((m) => m.fact === "the duration")).toBe(true);
  });

  test("no aspect declared → the app's default is used AND said to be a default", () => {
    const r = recommendPreset(measurement({ aspect: null }));
    expect(r.basis.complete).toBe(false);
    expect(r.basis.missing.some((m) => m.fact === "the project's aspect ratio")).toBe(true);
    expect(r.reasons.some((x) => x.reading.includes("16:9"))).toBe(true);
  });

  test("a complete measurement says it rests on measurement alone", () => {
    const r = recommendPreset(measurement());
    expect(r.basis.statement).toContain("measurable");
    expect(r.basis.missing).toEqual([]);
  });
});

describe("YouTube delivery master — the twelve choices", () => {
  test("every preset yields twelve choices, each with a reason", () => {
    for (const spec of EXPORT_PRESETS) {
      const choices = masterChoices(spec);
      expect(choices.length, spec.id).toBe(12);
      for (const c of choices) {
        expect(c.reason.length, `${spec.id}/${c.id}`).toBeGreaterThan(30);
        expect(c.value.length, `${spec.id}/${c.id}`).toBeGreaterThan(2);
        expect(["computed", "gated"], `${spec.id}/${c.id}`).toContain(c.truth);
        expect(c.producedOnThisBuild).toBe(false);
      }
    }
  });

  test("the choices are derived from the resolved spec, not typed a second time", () => {
    const spec = findExportPreset("youtube-2160p")!;
    const choices = masterChoices(spec);
    const gop = choices.find((c) => c.id === "keyframeCadence")!;
    expect(gop.value).toContain(String(spec.video.frameRate * KEYFRAME_INTERVAL_SECONDS));
    const loud = choices.find((c) => c.id === "loudness")!;
    expect(loud.value).toContain(String(spec.audio.loudnessTargetLufs));
    expect(loud.value).toContain(String(spec.audio.truePeakDbfs));
    const audio = choices.find((c) => c.id === "audioBitrate")!;
    expect(audio.value).toContain(String(spec.audio.audioBitrateKbps));
    expect(audio.reason).toContain(spec.audio.bitrateBasis.slice(0, 20));
  });

  test("the command plan names the missing binary and produces nothing", () => {
    const plan = encodeCommandPlan(findExportPreset("youtube-2160p")!);
    expect(plan.binary).toBe("ffmpeg");
    expect(plan.missingInput).toContain("ffmpeg");
    expect(plan.producesFileOnThisBuild).toBe(false);
    expect(plan.args.join(" ")).toContain("+faststart");
    expect(plan.args.join(" ")).toContain("-g 60");
    expect(plan.args.join(" ")).toContain("-maxrate 68000k");
    expect(plan.argReasons.length).toBeGreaterThan(8);
  });

  // Phase 8 block 2b defect fix. The plan used to push `-colorspace <primaries>` as
  // well as `<matrix>`, so the flag appeared twice and the LAST one won. No shipped
  // preset has primaries ≠ matrix, so it was invisible — a spec that does would
  // have been told the wrong primaries.
  test("each H.273 colour flag appears exactly once, with the right code point", () => {
    const count = (hay: string[], flag: string) => hay.filter((a) => a === flag).length;
    for (const spec of EXPORT_PRESETS) {
      const { args } = encodeCommandPlan(spec);
      expect({ preset: spec.id, flag: "-colorspace", n: count(args, "-colorspace") }).toEqual({
        preset: spec.id,
        flag: "-colorspace",
        n: 1,
      });
      expect({ preset: spec.id, flag: "-color_primaries", n: count(args, "-color_primaries") }).toEqual({
        preset: spec.id,
        flag: "-color_primaries",
        n: 1,
      });
      expect({ preset: spec.id, flag: "-color_trc", n: count(args, "-color_trc") }).toEqual({
        preset: spec.id,
        flag: "-color_trc",
        n: 1,
      });
      // The token after each flag is that code point, not one borrowed from another.
      expect(args[args.indexOf("-color_primaries") + 1]).toBe(spec.colour.h273.primariesName);
      expect(args[args.indexOf("-color_trc") + 1]).toBe(spec.colour.h273.transferName);
      expect(args[args.indexOf("-colorspace") + 1]).toBe(spec.colour.h273.matrixName);
    }
  });

  test("a spec whose primaries differ from its matrix keeps both tokens — the case the old duplication would have broken", () => {
    // No SHIPPED preset has primaries ≠ matrix today (they all resolve bt709/bt709),
    // which is exactly why the duplicated flag was invisible. This is a SYNTHETIC
    // spec derived from a real preset's resolved core with only the matrix changed:
    // it proves the fix generically and claims nothing about the catalogue.
    const base = findExportPreset("youtube-2160p")!;
    const differing = { ...base, colour: { ...base.colour, h273: { ...base.colour.h273, matrixName: "bt2020nc" } } };
    const { args } = encodeCommandPlan(differing);
    expect(args.filter((a) => a === "-colorspace")).toHaveLength(1);
    expect(args[args.indexOf("-color_primaries") + 1]).toBe(base.colour.h273.primariesName);
    expect(args[args.indexOf("-colorspace") + 1]).toBe("bt2020nc");
    // The old argv, reconstructed, is what this test would have caught: two flags,
    // the matrix silently overwriting the primaries.
    const oldArgv = [...args.slice(0, args.indexOf("-color_primaries")), "-colorspace", base.colour.h273.primariesName, ...args.slice(args.indexOf("-color_primaries"))];
    expect(oldArgv.filter((a) => a === "-colorspace")).toHaveLength(2);
  });

  test("the boundary sentences are present and are the product's own words", () => {
    expect(YOUTUBE_MASTER_BOUNDARY.length).toBeGreaterThanOrEqual(4);
    const all = YOUTUBE_MASTER_BOUNDARY.join(" ");
    expect(all).toContain("We do not claim YouTube will use any particular codec");
    expect(all).toContain("no claim about ranking, reach, recommendation, discovery or performance");
  });
});

describe("guard — no claim this product must never make", () => {
  const IGNORE = [...YOUTUBE_MASTER_BOUNDARY, ...RECOMMENDATION_NOT_CLAIMED];

  test("the master payload for every preset is clean", () => {
    for (const spec of EXPORT_PRESETS) {
      const hits = scanForbiddenClaims(masterView(spec), IGNORE);
      expect(hits, `${spec.id}: ${JSON.stringify(hits)}`).toEqual([]);
    }
  });

  test("the preset payloads and the recommendation payloads are clean", () => {
    expect(scanForbiddenClaims(listExportPresetViews(), IGNORE)).toEqual([]);
    const m = measurement();
    expect(scanForbiddenClaims(recommendationView(m, recommendPreset(m)), IGNORE)).toEqual([]);
  });

  test("the guard has teeth — every forbidden rule fires on a real claim", () => {
    const claims = [
      "YouTube will serve H.264 from this master.",
      "This master will be served as HEVC.",
      "This preset ranks your video higher.",
      "It increases reach and impressions.",
      "The thumbnail is viral.",
      "Built for the algorithm.",
      "A search volume of 40,000 per month.",
      "Guaranteed to grow your channel.",
      "Optimized for views.",
      "It will boost your views by 300%.",
    ];
    const found = new Set<string>();
    for (const text of claims) {
      const hits = scanForbiddenClaims({ text });
      expect(hits.length, text).toBeGreaterThan(0);
      for (const h of hits) found.add(h.id);
    }
    for (const rule of FORBIDDEN_MASTER_CLAIMS) {
      expect(found.has(rule.id), `rule ${rule.id} never fired`).toBe(true);
    }
  });

  test("every ignored disclaimer that NAMES a claim would itself trip a rule — that is why it is ignored", () => {
    // A boundary sentence that names the claim it refuses ("we do not claim
    // YouTube will use any particular codec") trips the guard on its own words.
    // The test requires that for every such sentence, which is what proves the
    // guard would catch it the moment the sentence became an assertion. A
    // sentence that names no claim at all is allowed to be clean.
    const namesAClaim = /youtube|rank|reach|guarantee|algorithm|viral|search volume|optimi/i;
    let named = 0;
    for (const sentence of IGNORE) {
      if (!namesAClaim.test(sentence)) continue;
      named += 1;
      const hits = scanForbiddenClaims({ text: sentence });
      expect(hits.length, sentence).toBeGreaterThan(0);
    }
    expect(named).toBeGreaterThanOrEqual(4);
  });

  test("the guard reads nested payloads, not just top-level strings", () => {
    const nested = { a: [{ b: [{ c: "this guarantees ranking" }] }] };
    expect(scanForbiddenClaims(nested).length).toBeGreaterThan(0);
  });
});
