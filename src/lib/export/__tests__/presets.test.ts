/**
 * Phase 6 Block 1 — export preset catalogue tests (no database, no IO).
 *
 * These assert that every preset is a COMPLETE, COHERENT spec, that its geometry
 * is the Phase 5 framing engine's geometry (not a second, drifting copy), and
 * that its colour tagging is the Phase 5 colour system's own numbers — with the
 * SDR and HDR metadata paired correctly (an SDR master must never carry CLL
 * metadata; an HDR master must never claim Rec.709 / BT.1886).
 */
import { describe, expect, test } from "bun:test";
import {
  EXPORT_CHANNEL_LAYOUT,
  EXPORT_CHANNELS,
  EXPORT_CONTAINER,
  EXPORT_LOUDNESS_TARGET_LUFS,
  EXPORT_PRESETS,
  EXPORT_PRESET_IDS,
  EXPORT_SAMPLE_RATE_HZ,
  EXPORT_TRUE_PEAK_DBFS,
  findExportPreset,
  isExportPresetId,
  listExportPresetViews,
  orderPresetIds,
  presetView,
} from "../presets";
import { DEFAULT_LOUDNESS_TARGET_LUFS, PEAK_CEILING } from "../../mix/engine";
import { FRAME_FORMAT_SPECS } from "../../framing/formats";
import { HDR_PQ_1000, SDR_709 } from "../../color/presets";

describe("export presets — catalogue completeness", () => {
  test("the catalogue has the seven required targets, each id unique", () => {
    expect(EXPORT_PRESET_IDS.length).toBe(7);
    expect(new Set(EXPORT_PRESET_IDS).size).toBe(7);
    expect(EXPORT_PRESETS.length).toBe(7);
  });

  test("the required platform targets are all present", () => {
    // Phase 8 block 2a: the catalogue is seven. TikTok's delivery specification is
    // identical to Reels' on every axis of the export matrix, so the TikTok publish
    // target now reuses the 9:16 preset instead of a second preset that resolved to
    // the same numbers.
    for (const id of ["youtube-2160p", "youtube-1080p", "youtube-shorts", "instagram-reels", "square-1080", "portrait-4x5"]) {
      expect(isExportPresetId(id), id).toBe(true);
      expect(findExportPreset(id), id).not.toBeNull();
    }
    // ...plus the HDR10 long-form target, so both colour pairings are exercised.
    expect(isExportPresetId("youtube-2160p-hdr")).toBe(true);
    expect(EXPORT_PRESETS.filter((p) => p.colour.display === "HDR").length).toBe(1);
  });

  test("every preset states a complete spec with real, positive numbers", () => {
    for (const p of EXPORT_PRESETS) {
      expect(p.container, p.id).toBe(EXPORT_CONTAINER);
      expect(p.resolution, p.id).toBe(`${p.widthPx}×${p.heightPx}`);
      expect(p.widthPx > 0 && p.heightPx > 0, p.id).toBe(true);
      expect(Number.isInteger(p.video.frameRate) && p.video.frameRate > 0, p.id).toBe(true);
      expect(Number.isFinite(p.video.rateControl.targetVideoBitrateKbps) && p.video.rateControl.targetVideoBitrateKbps > 0, p.id).toBe(true);
      expect(p.video.rateControl.basis.length, p.id).toBeGreaterThan(20);
      expect(p.video.codec.length, p.id).toBeGreaterThan(0);
      expect(p.video.profile.length, p.id).toBeGreaterThan(0);
      expect(p.audio.codec, p.id).toBe("AAC-LC");
      expect(p.audio.sampleRateHz, p.id).toBe(EXPORT_SAMPLE_RATE_HZ);
      expect(p.audio.channels, p.id).toBe(EXPORT_CHANNELS);
      expect(p.audio.channelLayout, p.id).toBe(EXPORT_CHANNEL_LAYOUT);
      expect(p.audio.audioBitrateKbps > 0, p.id).toBe(true);
      expect(p.audio.loudnessTargetLufs, p.id).toBe(EXPORT_LOUDNESS_TARGET_LUFS);
      expect(p.colour.note.length, p.id).toBeGreaterThan(50);
      expect(p.deliveryNotes.length, p.id).toBeGreaterThan(0);
      expect(p.subtitleTrack.included, p.id).toBe(false);
    }
  });

  test("the exact required delivery targets are covered at the right resolutions", () => {
    const byId = Object.fromEntries(EXPORT_PRESETS.map((p) => [p.id, p]));
    expect([byId["youtube-2160p"].widthPx, byId["youtube-2160p"].heightPx]).toEqual([3840, 2160]);
    expect([byId["youtube-1080p"].widthPx, byId["youtube-1080p"].heightPx]).toEqual([1920, 1080]);
    for (const id of ["youtube-shorts", "instagram-reels"] as const) {
      expect([byId[id].widthPx, byId[id].heightPx, byId[id].aspect], id).toEqual([1080, 1920, "9:16"]);
    }
    expect([byId["square-1080"].widthPx, byId["square-1080"].heightPx, byId["square-1080"].aspect]).toEqual([1080, 1080, "1:1"]);
    expect([byId["portrait-4x5"].widthPx, byId["portrait-4x5"].heightPx, byId["portrait-4x5"].aspect]).toEqual([1080, 1350, "4:5"]);
    expect([byId["youtube-2160p-hdr"].widthPx, byId["youtube-2160p-hdr"].heightPx]).toEqual([3840, 2160]);
  });

  test("aspect ratios and resolutions match the Phase 5 framing formats exactly", () => {
    for (const p of EXPORT_PRESETS) {
      const framing = FRAME_FORMAT_SPECS[p.formatId];
      expect(p.aspect, p.id).toBe(framing.aspect);
      expect(p.aspectValue, p.id).toBeCloseTo(framing.aspectValue, 10);
      // 16:9 long-form is allowed the UHD frame the framing notes name; the
      // narrow formats must use the framing engine's delivery frame verbatim.
      if (p.formatId === "16:9") {
        expect([[1920, 1080], [3840, 2160]], p.id).toContainEqual([p.widthPx, p.heightPx]);
      } else {
        expect([p.widthPx, p.heightPx], p.id).toEqual([framing.widthPx, framing.heightPx]);
      }
    }
  });
});

describe("export presets — colour tagging (SDR vs HDR pairings)", () => {
  const sdr = EXPORT_PRESETS.filter((p) => p.colour.display === "SDR");
  const hdr = EXPORT_PRESETS.filter((p) => p.colour.display === "HDR");

  test("SDR presets reuse the colour system's SDR target: Rec.709 / BT.1886 / 100 nits, no CLL", () => {
    expect(sdr.length).toBe(6);
    for (const p of sdr) {
      expect(p.colour.standard, p.id).toBe("Rec.709");
      expect(p.colour.standard, p.id).toBe(SDR_709.standard);
      expect(p.colour.transfer, p.id).toBe("BT.1886");
      expect(p.colour.transfer, p.id).toBe(SDR_709.transfer);
      expect(p.colour.peakNits, p.id).toBe(100);
      expect(p.colour.referenceWhiteNits, p.id).toBe(SDR_709.referenceWhiteNits);
      expect(p.colour.maxCLL, p.id).toBeNull();
      expect(p.colour.maxFALL, p.id).toBeNull();
      expect(p.colour.masteringDisplay, p.id).toBeNull();
      expect(p.colour.h273, p.id).toEqual({
        colourPrimaries: 1,
        primariesName: "bt709",
        transferCharacteristics: 1,
        transferName: "bt709",
        matrixCoefficients: 1,
        matrixName: "bt709",
      });
    }
  });

  test("HDR presets reuse the colour system's HDR10 target: Rec.2020 / PQ / 1000 nits with CLL metadata", () => {
    expect(hdr.length).toBe(1);
    for (const p of hdr) {
      expect(p.colour.standard, p.id).toBe("Rec.2020");
      expect(p.colour.standard, p.id).toBe(HDR_PQ_1000.standard);
      expect(p.colour.transfer, p.id).toBe("PQ (SMPTE ST 2084)");
      expect(p.colour.transfer, p.id).toBe(HDR_PQ_1000.transfer);
      expect(p.colour.peakNits, p.id).toBe(1000);
      expect(p.colour.referenceWhiteNits, p.id).toBe(203);
      expect(p.colour.maxCLL, p.id).toBe(1000);
      expect(p.colour.maxFALL, p.id).toBe(400);
      expect(p.colour.masteringDisplay).toEqual({ maxNits: 1000, minNits: 0.0001 });
      expect(p.colour.h273).toEqual({
        colourPrimaries: 9,
        primariesName: "bt2020",
        transferCharacteristics: 16,
        transferName: "smpte2084 (PQ)",
        matrixCoefficients: 9,
        matrixName: "bt2020nc",
      });
      expect(p.video.profile, p.id).toBe("Main10");
      expect(p.video.pixelFormat, p.id).toBe("yuv420p10le");
      expect(p.colour.delivery.bitDepth, p.id).toBe(10);
    }
  });

  test("the master's bit depth / chroma is the colour system's, and the delivery difference is stated", () => {
    for (const p of EXPORT_PRESETS) {
      const source = p.colour.display === "HDR" ? HDR_PQ_1000 : SDR_709;
      expect(p.colour.master, p.id).toEqual({ bitDepth: source.bitDepth, chromaSubsampling: source.chromaSubsampling });
      expect(p.colour.delivery.chromaSubsampling, p.id).toBe("4:2:0");
      if (p.colour.display === "SDR") expect(p.video.pixelFormat, p.id).toBe("yuv420p");
      // The stated relationship, not a silent one.
      expect(p.colour.note, p.id).toContain("mastered at 10-bit 4:2:2");
    }
  });

  test("no preset mixes SDR and HDR metadata", () => {
    for (const p of EXPORT_PRESETS) {
      if (p.colour.display === "SDR") {
        expect(p.colour.h273.colourPrimaries, p.id).not.toBe(9);
        expect(p.colour.h273.transferCharacteristics, p.id).not.toBe(16);
        expect(p.colour.maxCLL, p.id).toBeNull();
      } else {
        expect(p.colour.h273.colourPrimaries, p.id).toBe(9);
        expect(p.colour.h273.transferCharacteristics, p.id).toBe(16);
        expect(p.colour.maxCLL, p.id).not.toBeNull();
        expect(p.colour.peakNits, p.id).toBeGreaterThan(100);
      }
    }
  });
});

describe("export presets — audio and loudness come from the mix engine", () => {
  test("the loudness target is the final-mix engine's own constant", () => {
    expect(EXPORT_LOUDNESS_TARGET_LUFS).toBe(DEFAULT_LOUDNESS_TARGET_LUFS);
    expect(EXPORT_LOUDNESS_TARGET_LUFS).toBe(-14);
  });

  test("the true-peak ceiling is derived from the mix engine's PEAK_CEILING, not hand-typed", () => {
    const derived = Math.round(20 * Math.log10(PEAK_CEILING) * 100) / 100;
    expect(EXPORT_TRUE_PEAK_DBFS).toBe(derived);
    expect(EXPORT_TRUE_PEAK_DBFS).toBe(-1);
    expect(PEAK_CEILING).toBeCloseTo(0.891, 3);
  });

  test("audio bitrates use the YouTube figure for long-form and the social figure for short-form", () => {
    const byId = Object.fromEntries(EXPORT_PRESETS.map((p) => [p.id, p]));
    for (const id of ["youtube-2160p", "youtube-2160p-hdr", "youtube-1080p", "youtube-shorts"] as const) {
      expect(byId[id].audio.audioBitrateKbps, id).toBe(384);
      expect(byId[id].audio.bitrateBasis, id).toContain("YouTube");
    }
    for (const id of ["instagram-reels", "square-1080", "portrait-4x5"] as const) {
      expect(byId[id].audio.audioBitrateKbps, id).toBe(128);
      expect(byId[id].audio.bitrateBasis, id).toContain("Instagram");
    }
  });

  test("every video bitrate carries a stated basis, and the published figures are the ones used", () => {
    const byId = Object.fromEntries(EXPORT_PRESETS.map((p) => [p.id, p]));
    expect(byId["youtube-2160p"].video.rateControl.targetVideoBitrateKbps).toBe(45_000);
    expect(byId["youtube-2160p"].video.rateControl.basis).toContain("35-45 Mbps");
    expect(byId["youtube-2160p-hdr"].video.rateControl.targetVideoBitrateKbps).toBe(56_000);
    expect(byId["youtube-2160p-hdr"].video.rateControl.basis).toContain("44-56 Mbps");
    expect(byId["youtube-1080p"].video.rateControl.targetVideoBitrateKbps).toBe(8_000);
    expect(byId["youtube-1080p"].video.rateControl.basis).toContain("8 Mbps");
    for (const p of EXPORT_PRESETS) expect(p.video.rateControl.basis.length, p.id).toBeGreaterThan(20);
  });
});

describe("export presets — ids, ordering and views", () => {
  test("isExportPresetId / findExportPreset reject anything unknown", () => {
    expect(isExportPresetId("legacy-tv")).toBe(false);
    expect(isExportPresetId(42)).toBe(false);
    expect(isExportPresetId(null)).toBe(false);
    expect(findExportPreset("legacy-tv")).toBeNull();
    expect(findExportPreset("youtube-1080p")?.id).toBe("youtube-1080p");
  });

  test("orderPresetIds dedupes and returns canonical catalogue order", () => {
    expect(orderPresetIds(["instagram-reels", "youtube-1080p", "instagram-reels", "nope"])).toEqual([
      "youtube-1080p",
      "instagram-reels",
    ]);
    expect(orderPresetIds("not an array")).toEqual([]);
    expect(orderPresetIds([])).toEqual([]);
  });

  test("presetView exposes every declared number and the catalogue view is complete", () => {
    const view = presetView(EXPORT_PRESETS[1]) as Record<string, any>;
    expect(view.id).toBe("youtube-2160p-hdr");
    expect(view.resolution).toBe("3840×2160");
    expect(view.container).toBe("mp4");
    expect(view.video.codec).toBe("H.265/HEVC");
    expect(view.video.bitrateKbps).toBe(56_000);
    expect(view.video.rateControl.basis).toContain("44-56 Mbps");
    expect(view.audio.sampleRateHz).toBe(48_000);
    expect(view.audio.channelLayout).toBe("stereo");
    expect(view.audio.loudnessTargetLufs).toBe(-14);
    expect(view.colour.maxCLL).toBe(1000);
    expect(view.colour.h273.transferCharacteristics).toBe(16);
    expect(view.subtitleTrack.included).toBe(false);
    expect(listExportPresetViews().length).toBe(7);
    for (const v of listExportPresetViews()) {
      expect(typeof (v as Record<string, unknown>).resolution).toBe("string");
      expect((v as Record<string, any>).video.rateControl.basis.length).toBeGreaterThan(20);
    }
  });

  test("presetView returns copies — mutating a view cannot change the catalogue", () => {
    const view = presetView(EXPORT_PRESETS[0]) as Record<string, any>;
    view.deliveryNotes.push("tampered");
    expect(EXPORT_PRESETS[0].deliveryNotes).not.toContain("tampered");
  });
});
