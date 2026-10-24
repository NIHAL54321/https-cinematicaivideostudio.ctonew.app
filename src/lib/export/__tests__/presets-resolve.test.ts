/**
 * Phase 8 block 2a — the seven presets, resolved from the matrix.
 *
 * THE CENTRAL TEST OF THIS BLOCK: a preset may not hold a value the matrix does
 * not declare, and may not hold a combination the matrix calls illegal. Both are
 * asserted twice — positively over the real catalogue, and negatively by
 * constructing a bad preset and requiring the resolver to throw.
 */
import { describe, expect, test } from "bun:test";
import {
  EXPORT_PRESETS,
  EXPORT_PRESET_IDS,
  PRESET_CHOICES,
  combinationOf,
  findExportPreset,
  findPresetChoice,
  isExportPresetId,
  listExportPresetViews,
  presetView,
  resolvePreset,
  resolvedSpecCore,
  specProvenanceTally,
  type PresetChoice,
} from "../presets";
import {
  AUDIO_BITRATES,
  AUDIO_CODECS,
  AUDIO_SAMPLE_RATES,
  CHANNEL_LAYOUTS,
  CODECS,
  COLOUR_TARGETS,
  CONTAINERS,
  FRAME_RATES,
  PIXEL_FORMATS,
  QUALITY_TIERS,
  RATE_MODES,
  RESOLUTIONS,
  UPSCALE_MODES,
  assertLegal,
  requiredLevel,
} from "../spec-matrix";
import { sha256OfJson, canonicalJsonString } from "../spec-fingerprint";

const ids = (xs: readonly { id: string }[]) => new Set(xs.map((x) => x.id));

describe("presets — seven of them, each unique", () => {
  test("the catalogue has exactly seven presets", () => {
    expect(EXPORT_PRESET_IDS.length).toBe(7);
    expect(new Set(EXPORT_PRESET_IDS).size).toBe(7);
    expect(EXPORT_PRESETS.length).toBe(7);
    expect(PRESET_CHOICES.length).toBe(7);
  });

  test("every preset id resolves, and an unknown one does not", () => {
    for (const id of EXPORT_PRESET_IDS) expect(findExportPreset(id)?.id).toBe(id);
    expect(findExportPreset("tiktok")).toBeNull();
    expect(findExportPreset("legacy-tv")).toBeNull();
    expect(isExportPresetId("tiktok")).toBe(false);
  });
});

describe("presets — nothing outside the matrix", () => {
  test("every choice id names an option the matrix declares", () => {
    for (const p of PRESET_CHOICES) {
      const c = p.choice;
      expect(ids(RESOLUTIONS).has(c.resolutionId), `${p.id} resolution`).toBe(true);
      expect(ids(CONTAINERS).has(c.containerId), `${p.id} container`).toBe(true);
      const codec = CODECS.find((x) => x.id === c.codecId);
      expect(codec, `${p.id} codec`).toBeDefined();
      expect(codec!.profiles.map((x) => x.name), `${p.id} profile`).toContain(c.profileName);
      if (c.level !== null) expect(codec!.levels.map((l) => l.level), `${p.id} level`).toContain(c.level);
      expect(ids(FRAME_RATES).has(c.frameRateId), `${p.id} frameRate`).toBe(true);
      expect(ids(RATE_MODES).has(c.rateModeId), `${p.id} rateMode`).toBe(true);
      expect(ids(QUALITY_TIERS).has(c.qualityId), `${p.id} quality`).toBe(true);
      expect(ids(COLOUR_TARGETS).has(c.colourId), `${p.id} colour`).toBe(true);
      expect(ids(PIXEL_FORMATS).has(c.pixelFormatId), `${p.id} pixelFormat`).toBe(true);
      expect(ids(AUDIO_CODECS).has(c.audioCodecId), `${p.id} audioCodec`).toBe(true);
      expect(ids(AUDIO_SAMPLE_RATES).has(c.audioSampleRateId), `${p.id} sampleRate`).toBe(true);
      expect(ids(AUDIO_BITRATES).has(c.audioBitrateId), `${p.id} audioBitrate`).toBe(true);
      expect(ids(CHANNEL_LAYOUTS).has(c.channelLayoutId), `${p.id} channelLayout`).toBe(true);
      expect(ids(UPSCALE_MODES).has(c.upscaleId), `${p.id} upscale`).toBe(true);
    }
  });

  test("every preset is a LEGAL combination — the resolver would have thrown otherwise", () => {
    for (const p of EXPORT_PRESETS) {
      const choice = findPresetChoice(p.id)!;
      expect(() => assertLegal(combinationOf(choice)), p.id).not.toThrow();
    }
  });

  test("the resolved values are the matrix's values, not a second copy", () => {
    for (const spec of EXPORT_PRESETS) {
      const res = RESOLUTIONS.find((r) => r.id === spec.choices.resolutionId)!;
      const codec = CODECS.find((c) => c.id === spec.choices.codecId)!;
      const rate = FRAME_RATES.find((f) => f.id === spec.choices.frameRateId)!;
      const quality = QUALITY_TIERS.find((q) => q.id === spec.choices.qualityId)!;
      const audio = AUDIO_BITRATES.find((a) => a.id === spec.choices.audioBitrateId)!;
      expect([spec.widthPx, spec.heightPx], spec.id).toEqual([res.widthPx, res.heightPx]);
      expect(spec.resolution, spec.id).toBe(`${res.widthPx}×${res.heightPx}`);
      expect(spec.video.codec, spec.id).toBe(codec.label);
      expect(spec.video.codecFamily, spec.id).toBe(codec.id);
      expect(spec.video.frameRate, spec.id).toBe(rate.fps);
      expect(spec.audio.audioBitrateKbps, spec.id).toBe(audio.kbps);
      if (spec.video.rateControl.mode === "crf") {
        expect(spec.video.rateControl.crf, spec.id).toBe(quality.crfByCodec[codec.id]);
      } else {
        expect(spec.video.rateControl.crf, spec.id).toBeNull();
      }
    }
  });

  test("the level each preset declares is at or above the COMPUTED minimum", () => {
    for (const spec of EXPORT_PRESETS) {
      const need = requiredLevel(spec.choices.codecId as never, spec.widthPx, spec.heightPx, spec.video.frameRate);
      expect(need.covered, spec.id).toBe(true);
      const declared = CODECS.find((c) => c.id === spec.choices.codecId)!.levels.map((l) => l.level);
      expect(declared.indexOf(spec.video.level!), spec.id).toBeGreaterThanOrEqual(declared.indexOf(need.minimumLevel!));
      expect(spec.levelArithmetic, spec.id).toContain(String(need.lumaSamples));
    }
  });
});

describe("presets — negative controls on the resolver", () => {
  test("a preset naming a resolution the matrix does not declare THROWS", () => {
    const bad: PresetChoice = {
      ...PRESET_CHOICES[0],
      id: "youtube-2160p",
      choice: { ...PRESET_CHOICES[0].choice, resolutionId: "uhd-8k" },
    };
    expect(() => resolvePreset(bad)).toThrow(/does not declare/);
  });

  test("a preset holding an ILLEGAL combination THROWS instead of resolving", () => {
    const hdrOnH264: PresetChoice = {
      ...PRESET_CHOICES[2],
      id: "youtube-1080p",
      choice: { ...PRESET_CHOICES[2].choice, colourId: "hdr10-pq" },
    };
    expect(() => resolvePreset(hdrOnH264)).toThrow();
  });

  test("a preset with a CBR cap that is not its target THROWS", () => {
    const bad: PresetChoice = {
      ...PRESET_CHOICES[3],
      id: "youtube-shorts",
      choice: { ...PRESET_CHOICES[3].choice, rateModeId: "cbr" },
      rateControl: { ...PRESET_CHOICES[3].rateControl, maxVideoBitrateKbps: 16_000 },
    };
    expect(() => resolvePreset(bad)).toThrow();
  });
});

describe("presets — every value prints its reason and its provenance", () => {
  test("each preset resolves all 15 axes, each with a real reason", () => {
    for (const spec of EXPORT_PRESETS) {
      expect(spec.axes.length, spec.id).toBe(15);
      for (const a of spec.axes) {
        expect(a.reason.length, `${spec.id}/${a.axis}`).toBeGreaterThan(20);
        expect(a.source.length, `${spec.id}/${a.axis}`).toBeGreaterThan(3);
        expect(["computed", "gated", "provider"], `${spec.id}/${a.axis}`).toContain(a.truth);
      }
      const tally = specProvenanceTally(spec);
      expect(tally.computed + tally.gated + tally.provider).toBe(15);
      expect(tally.gated, spec.id).toBeGreaterThan(0);
    }
  });

  test("no preset claims to have produced a file", () => {
    for (const spec of EXPORT_PRESETS) {
      expect(spec.producedOnThisBuild).toBe(false);
      expect(spec.deliveredStatement).toContain("not a file it has produced");
      expect(spec.subtitleTrack.included).toBe(false);
    }
  });
});

describe("presets — reproducibility", () => {
  test("the recorded core is deterministic and its digest is stable", () => {
    const spec = findExportPreset("youtube-2160p")!;
    const a = sha256OfJson(resolvedSpecCore(spec));
    const b = sha256OfJson(resolvedSpecCore(spec));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(canonicalJsonString(resolvedSpecCore(spec))).toBe(canonicalJsonString(resolvedSpecCore(spec)));
  });

  test("a different preset has a different digest — the digest is of the numbers", () => {
    const a = sha256OfJson(resolvedSpecCore(findExportPreset("youtube-2160p")!));
    const b = sha256OfJson(resolvedSpecCore(findExportPreset("youtube-1080p")!));
    expect(a).not.toBe(b);
  });

  test("the core carries the numbers a render would run with, and no prose that drifts", () => {
    const core = resolvedSpecCore(findExportPreset("youtube-2160p-hdr")!);
    expect(core.presetId).toBe("youtube-2160p-hdr");
    expect((core.video as Record<string, unknown>).codecId).toBe("hevc");
    expect((core.video as Record<string, unknown>).profile).toBe("Main10");
    expect((core.colour as Record<string, unknown>).colourId).toBe("hdr10-pq");
    expect((core.audio as Record<string, unknown>).loudnessTargetLufs).toBe(-14);
    expect(core.producedOnThisBuild).toBe(false);
  });
});

describe("presets — the views", () => {
  test("presetView exposes the resolution trail alongside the numbers", () => {
    const view = presetView(EXPORT_PRESETS[1]) as Record<string, any>;
    expect(view.id).toBe("youtube-2160p-hdr");
    expect(view.resolution).toBe("3840×2160");
    expect(view.video.codec).toBe("H.265/HEVC");
    expect(view.video.level).toBe("5.1");
    expect(view.choices.colourId).toBe("hdr10-pq");
    expect(view.axes.length).toBe(15);
    expect(view.provenanceTally.gated).toBeGreaterThan(0);
    expect(view.producedOnThisBuild).toBe(false);
    expect(view.levelArithmetic.length).toBeGreaterThan(40);
    expect(listExportPresetViews().length).toBe(7);
  });

  test("presetView returns copies — mutating a view cannot change the catalogue", () => {
    const view = presetView(EXPORT_PRESETS[0]) as Record<string, any>;
    view.deliveryNotes.push("tampered");
    view.axes[0].reason = "tampered";
    expect(EXPORT_PRESETS[0].deliveryNotes).not.toContain("tampered");
    expect(EXPORT_PRESETS[0].axes[0].reason).not.toBe("tampered");
  });
});
