/**
 * Phase 8 block 2a — the export specification matrix.
 *
 * What these assert:
 *   - every axis is populated and every option's id is unique within its axis,
 *   - EVERY option carries a provenance whose truth is one of exactly three
 *     values, and whose missing input / capability is present exactly when its
 *     truth says it should be,
 *   - no option is ever described as produced on this build,
 *   - the level arithmetic is the published table's, not a tuned number,
 *   - the combination rules REJECT illegal pairings — each negative control below
 *     is a real combination a hand-written preset could have contained.
 */
import { describe, expect, test } from "bun:test";
import {
  AUDIO_BITRATES,
  AUDIO_CODECS,
  AUDIO_SAMPLE_RATES,
  CHANNEL_LAYOUTS,
  CODECS,
  COLOUR_TARGETS,
  CONTAINERS,
  FFMPEG_MISSING,
  FRAME_RATES,
  IllegalCombinationError,
  PIXEL_FORMATS,
  QUALITY_TIERS,
  RATE_MODES,
  RESOLUTIONS,
  SPEC_AXIS_LABELS,
  SPEC_DELIVERY_STATEMENT,
  SPEC_MATRIX,
  SPEC_MATRIX_VERSION,
  UPSCALE_MODES,
  assertLegal,
  checkCombination,
  matrixView,
  requiredLevel,
  type Combination,
  type SpecAxis,
} from "../spec-matrix";

/** A combination that is legal on every axis — the base the negatives mutate. */
function legalBase(): Combination {
  return {
    resolutionId: "fhd-1080p",
    containerId: "mp4",
    codecId: "h264",
    profileName: "High",
    level: "4.0",
    frameRateId: "30",
    rateModeId: "vbr",
    qualityId: "high",
    colourId: "sdr-rec709",
    pixelFormatId: "yuv420p",
    audioCodecId: "aac-lc",
    audioSampleRateId: "48000",
    audioBitrateId: "384",
    channelLayoutId: "stereo",
    upscaleId: "none",
    targetVideoBitrateKbps: 8_000,
    maxVideoBitrateKbps: 16_000,
    crf: null,
  };
}

const AXES = Object.keys(SPEC_AXIS_LABELS) as SpecAxis[];

describe("export spec matrix — shape", () => {
  test("every declared axis is populated, and every id is unique inside its axis", () => {
    expect(AXES.length).toBe(13);
    for (const axis of AXES) {
      const options = SPEC_MATRIX[axis] as readonly { id: string }[];
      expect(options.length, axis).toBeGreaterThan(0);
      const ids = options.map((o) => o.id);
      expect(new Set(ids).size, axis).toBe(ids.length);
    }
  });

  test("the axis counts are the ones the surface prints", () => {
    expect(RESOLUTIONS.length).toBe(10);
    expect(CONTAINERS.length).toBe(4);
    expect(CODECS.length).toBe(4);
    expect(FRAME_RATES.length).toBe(5);
    expect(RATE_MODES.length).toBe(3);
    expect(QUALITY_TIERS.length).toBe(5);
    expect(COLOUR_TARGETS.length).toBe(2);
    expect(PIXEL_FORMATS.length).toBe(4);
    expect(AUDIO_CODECS.length).toBe(2);
    expect(AUDIO_SAMPLE_RATES.length).toBe(2);
    expect(AUDIO_BITRATES.length).toBe(4);
    expect(CHANNEL_LAYOUTS.length).toBe(2);
    expect(UPSCALE_MODES.length).toBe(3);
  });

  test("2160p and the 9:16 shorts shape are both declared resolutions", () => {
    const uhd = RESOLUTIONS.find((r) => r.id === "uhd-2160p")!;
    expect([uhd.widthPx, uhd.heightPx, uhd.aspect]).toEqual([3840, 2160, "16:9"]);
    const vertical = RESOLUTIONS.find((r) => r.id === "fhd-1080p-vertical")!;
    expect([vertical.widthPx, vertical.heightPx, vertical.aspect, vertical.portrait]).toEqual([1080, 1920, "9:16", true]);
  });
});

describe("export spec matrix — every option says where its truth comes from", () => {
  test("the truth is one of exactly three values, and nothing is delivered here", () => {
    for (const axis of AXES) {
      for (const option of SPEC_MATRIX[axis] as readonly { id: string; provenance: Record<string, unknown> }[]) {
        const p = option.provenance;
        expect(["computed", "gated", "provider"], `${axis}/${option.id}`).toContain(p.truth as string);
        expect(p.producedOnThisBuild, `${axis}/${option.id}`).toBe(false);
        expect(typeof p.source, `${axis}/${option.id}`).toBe("string");
        expect((p.source as string).length, `${axis}/${option.id}`).toBeGreaterThan(3);
        expect((p.basis as string).length, `${axis}/${option.id}`).toBeGreaterThan(20);
      }
    }
  });

  test("a gated option NAMES its missing input; computed and provider options do not", () => {
    for (const axis of AXES) {
      for (const option of SPEC_MATRIX[axis] as readonly { id: string; provenance: Record<string, unknown> }[]) {
        const p = option.provenance;
        if (p.truth === "gated") {
          expect(typeof p.missingInput, `${axis}/${option.id}`).toBe("string");
          expect((p.missingInput as string).length, `${axis}/${option.id}`).toBeGreaterThan(10);
          expect(p.capability, `${axis}/${option.id}`).toBeNull();
        } else if (p.truth === "computed") {
          expect(p.missingInput, `${axis}/${option.id}`).toBeNull();
          expect(p.capability, `${axis}/${option.id}`).toBeNull();
        } else {
          expect(typeof p.capability, `${axis}/${option.id}`).toBe("string");
          expect(p.missingInput, `${axis}/${option.id}`).toBeNull();
        }
      }
    }
  });

  test("every gated ENCODE option names the ffmpeg binary, in the same words", () => {
    for (const option of [...CONTAINERS, ...CODECS, ...PIXEL_FORMATS, ...AUDIO_CODECS, ...RATE_MODES, ...QUALITY_TIERS]) {
      expect(option.provenance.truth, option.id).toBe("gated");
      expect(option.provenance.missingInput, option.id).toBe(FFMPEG_MISSING);
      expect(option.provenance.missingInput, option.id).toContain("ffmpeg");
    }
  });

  test("exactly one option is provider-backed, and it names the capability", () => {
    const provider = UPSCALE_MODES.filter((u) => u.provenance.truth === "provider");
    expect(provider.length).toBe(1);
    expect(provider[0].id).toBe("ai-provider");
    expect(provider[0].provenance.capability).toBe("video_enhancement");
  });

  test("the delivery statement says nothing is delivered, in the product's own words", () => {
    expect(SPEC_DELIVERY_STATEMENT).toContain("No option in this matrix is delivered on this build");
    expect(SPEC_DELIVERY_STATEMENT).toContain("ffmpeg");
  });
});

describe("export spec matrix — level arithmetic is computed, not chosen", () => {
  test("H.264 1080p30 needs 4.0; 2160p30 needs 5.1; 1080p60 needs 4.2", () => {
    expect(requiredLevel("h264", 1920, 1080, 30).minimumLevel).toBe("4.0");
    expect(requiredLevel("h264", 3840, 2160, 30).minimumLevel).toBe("5.1");
    expect(requiredLevel("h264", 1920, 1080, 60).minimumLevel).toBe("4.2");
    expect(requiredLevel("h264", 1280, 720, 30).minimumLevel).toBe("3.1");
  });

  test("HEVC 2160p30 needs 5.0; 2160p60 needs 5.1", () => {
    expect(requiredLevel("hevc", 3840, 2160, 30).minimumLevel).toBe("5.0");
    expect(requiredLevel("hevc", 3840, 2160, 60).minimumLevel).toBe("5.1");
    expect(requiredLevel("hevc", 1920, 1080, 30).minimumLevel).toBe("4.0");
  });

  test("the arithmetic is printed with both limits, so it can be checked by hand", () => {
    const r = requiredLevel("h264", 1920, 1080, 30);
    expect(r.lumaSamples).toBe(2_073_600);
    expect(r.lumaSamplesPerSecond).toBe(62_208_000);
    expect(r.arithmetic).toContain("2073600");
    expect(r.arithmetic).toContain("62208000");
    expect(r.covered).toBe(true);
  });
});

describe("export spec matrix — combination rules reject what they should", () => {
  test("the base combination is legal", () => {
    const check = checkCombination(legalBase());
    expect(check.violations).toEqual([]);
    expect(check.legal).toBe(true);
  });

  // ---- negative controls: each one is a pairing a typed preset could have had ----

  test("R2: H.264 cannot live in WebM", () => {
    const c = checkCombination({ ...legalBase(), containerId: "webm" });
    expect(c.legal).toBe(false);
    expect(c.violations.map((v) => v.ruleId)).toContain("R2");
  });

  test("R5: level 4.0 cannot carry 3840×2160 at 30 fps", () => {
    const c = checkCombination({
      ...legalBase(),
      codecId: "hevc",
      profileName: "Main",
      resolutionId: "uhd-2160p",
      level: "4.0",
    });
    expect(c.legal).toBe(false);
    expect(c.violations.some((v) => v.ruleId === "R5")).toBe(true);
  });

  test("R6: an 8-bit profile cannot carry the HDR10 target", () => {
    const c = checkCombination({ ...legalBase(), colourId: "hdr10-pq" });
    expect(c.legal).toBe(false);
    expect(c.violations.map((v) => v.ruleId)).toContain("R6");
  });

  test("R7: CBR with a cap that is not the target is rejected", () => {
    const c = checkCombination({ ...legalBase(), rateModeId: "cbr", targetVideoBitrateKbps: 8_000, maxVideoBitrateKbps: 16_000 });
    expect(c.legal).toBe(false);
    expect(c.violations.map((v) => v.ruleId)).toContain("R7");
  });

  test("R7: VBR with a cap below its target is rejected", () => {
    const c = checkCombination({ ...legalBase(), targetVideoBitrateKbps: 20_000, maxVideoBitrateKbps: 10_000 });
    expect(c.legal).toBe(false);
    expect(c.violations.map((v) => v.ruleId)).toContain("R7");
  });

  test("R7: CRF must be the quality tier's own number for that codec", () => {
    const c = checkCombination({ ...legalBase(), rateModeId: "crf", crf: 30, maxVideoBitrateKbps: null });
    expect(c.legal).toBe(false);
    expect(c.violations.map((v) => v.ruleId)).toContain("R7");
    const ok = checkCombination({ ...legalBase(), rateModeId: "crf", crf: 18, maxVideoBitrateKbps: null });
    expect(ok.legal).toBe(true);
  });

  test("R9: Opus cannot live in MP4", () => {
    const c = checkCombination({ ...legalBase(), audioCodecId: "opus" });
    expect(c.legal).toBe(false);
    expect(c.violations.map((v) => v.ruleId)).toContain("R9");
  });

  test("R12: an MP4 AAC-LC delivery at 44.1 kHz is rejected", () => {
    const c = checkCombination({ ...legalBase(), audioSampleRateId: "44100" });
    expect(c.legal).toBe(false);
    expect(c.violations.map((v) => v.ruleId)).toContain("R12");
  });

  test("R1: an id the matrix does not declare is rejected, never defaulted", () => {
    const c = checkCombination({ ...legalBase(), resolutionId: "uhd-8k" });
    expect(c.legal).toBe(false);
    expect(c.violations.map((v) => v.ruleId)).toContain("R1");
    expect(c.violations.some((v) => v.message.includes("uhd-8k"))).toBe(true);
  });

  test("assertLegal THROWS on an illegal combination instead of emitting it", () => {
    expect(() => assertLegal({ ...legalBase(), containerId: "webm" })).toThrow(IllegalCombinationError);
    try {
      assertLegal({ ...legalBase(), colourId: "hdr10-pq" });
      throw new Error("assertLegal did not throw");
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalCombinationError);
      const e = err as IllegalCombinationError;
      expect(e.violations.length).toBeGreaterThan(0);
      expect(e.message).toContain("Illegal export combination");
    }
  });

  test("assertLegal RETURNS the level arithmetic for a legal combination", () => {
    const check = assertLegal(legalBase());
    expect(check.level.minimumLevel).toBe("4.0");
    expect(check.level.arithmetic.length).toBeGreaterThan(40);
  });
});

describe("export spec matrix — the view", () => {
  test("the view reports every axis, its count, and the provenance tally", () => {
    const view = matrixView();
    expect(view.version).toBe(SPEC_MATRIX_VERSION);
    const axes = view.axes as Array<{ axis: string; count: number }>;
    expect(axes.length).toBe(13);
    const counts = view.counts as Record<string, number>;
    expect(counts.resolutions).toBe(10);
    expect(counts.upscaleModes).toBe(3);
    const tally = view.truthTally as { computed: number; gated: number; provider: number };
    expect(tally.provider).toBe(1);
    expect(tally.computed + tally.gated + tally.provider).toBe(view.optionCount as number);
    expect(view.producedOnThisBuild).toBe(false);
  });
});
