/**
 * Phase 6 Block 1 — size arithmetic + deliverable manifest tests.
 *
 * The arithmetic is checked by hand, including the long-form 120-minute case, and
 * every edge case is checked to be a TYPED error rather than a silent number. The
 * manifest tests assert the shape and — as importantly — that the manifest says
 * it produced nothing.
 */
import { describe, expect, test } from "bun:test";
import {
  MAX_EXPORT_DURATION_SECONDS,
  SIZE_EXCLUDES,
  SIZE_FORMULA,
  SizeError,
  estimateSize,
  humanBytes,
  humanDuration,
  isValidSizeInput,
} from "../sizing";
import { NOT_PRODUCED, buildDeliverableManifest, outputFileName, slugifyProjectTitle } from "../manifest";
import { EXPORT_PRESETS, findExportPreset } from "../presets";

describe("size arithmetic — the formula, in stated units", () => {
  test("the formula is visible and the units are stated", () => {
    expect(SIZE_FORMULA).toBe("size = (video bitrate + audio bitrate) × duration ÷ 8");
    const estimate = estimateSize({ videoBitrateKbps: 8_000, audioBitrateKbps: 384, durationSeconds: 60 });
    expect(estimate.formula).toBe(SIZE_FORMULA);
    expect(estimate.units.bitrate).toContain("kbps");
    expect(estimate.units.duration).toBe("seconds");
    expect(estimate.units.size).toContain("bytes");
  });

  test("60 s at 8000 + 384 kbps = 62,880,000 bytes (= 8384 × 60 × 1000 ÷ 8)", () => {
    const estimate = estimateSize({ videoBitrateKbps: 8_000, audioBitrateKbps: 384, durationSeconds: 60 });
    expect(estimate.totalBitrateKbps).toBe(8_384);
    expect(estimate.bits).toBe(8384 * 1000 * 60);
    expect(estimate.bytes).toBe(62_880_000);
    expect(estimate.megabytes).toBe(62.88);
    expect(estimate.substituted).toContain("8000 kbps + 384 kbps");
    expect(estimate.substituted).toContain("= 62880000 bytes");
  });

  test("the long-form 120-minute (7200 s) cases add up for 1080p, 4K SDR and 4K HDR", () => {
    const fhd = estimateSize({ videoBitrateKbps: 8_000, audioBitrateKbps: 384, durationSeconds: 7_200 });
    expect(fhd.durationMinutes).toBe(120);
    expect(fhd.durationHuman).toBe("2h 00m 00s");
    expect(fhd.bytes).toBe(7_545_600_000);
    expect(fhd.gibibytes).toBeCloseTo(7.028, 2);
    expect(fhd.human).toBe("7.03 GiB");

    const uhd = estimateSize({ videoBitrateKbps: 45_000, audioBitrateKbps: 384, durationSeconds: 7_200 });
    expect(uhd.bytes).toBe(40_845_600_000);
    expect(uhd.gibibytes).toBeCloseTo(38.04, 1);

    // (56000 + 384) × 1000 × 7200 ÷ 8
    const hdr = estimateSize({ videoBitrateKbps: 56_000, audioBitrateKbps: 384, durationSeconds: 7_200 });
    expect(hdr.bytes).toBe(50_745_600_000);
  });

  test("the estimate is honest about being an estimate and about what it excludes", () => {
    const estimate = estimateSize({ videoBitrateKbps: 8_000, audioBitrateKbps: 384, durationSeconds: 60 });
    expect(estimate.estimate).toBe(true);
    expect(estimate.produced).toBe(false);
    expect(estimate.excludes).toEqual([...SIZE_EXCLUDES]);
    expect(estimate.excludes.some((e) => e.includes("container"))).toBe(true);
  });

  test("the arithmetic is linear and monotonic in both inputs", () => {
    const base = estimateSize({ videoBitrateKbps: 8_000, audioBitrateKbps: 384, durationSeconds: 60 }).bytes;
    const longer = estimateSize({ videoBitrateKbps: 8_000, audioBitrateKbps: 384, durationSeconds: 120 }).bytes;
    const faster = estimateSize({ videoBitrateKbps: 16_000, audioBitrateKbps: 384, durationSeconds: 60 }).bytes;
    expect(longer).toBe(base * 2);
    expect(faster).toBeGreaterThan(base);
    // Video + audio are both counted: dropping the audio track would shrink it.
    const noAudio = estimateSize({ videoBitrateKbps: 8_000, audioBitrateKbps: 1, durationSeconds: 60 }).bytes;
    expect(base).toBeGreaterThan(noAudio);
  });
});

describe("size arithmetic — edge cases are typed errors, never silent numbers", () => {
  test("zero, negative, NaN and infinite durations are refused", () => {
    for (const durationSeconds of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      let caught: unknown = null;
      try {
        estimateSize({ videoBitrateKbps: 8_000, audioBitrateKbps: 384, durationSeconds });
      } catch (err) {
        caught = err;
      }
      expect(caught, String(durationSeconds)).toBeInstanceOf(SizeError);
      expect((caught as SizeError).code).toBe("invalid_duration");
    }
  });

  test("the exactly-120-minute case is allowed; one second more is refused", () => {
    expect(MAX_EXPORT_DURATION_SECONDS).toBe(7_200);
    expect(() => estimateSize({ videoBitrateKbps: 8_000, audioBitrateKbps: 384, durationSeconds: 7_200 })).not.toThrow();
    let caught: unknown = null;
    try {
      estimateSize({ videoBitrateKbps: 8_000, audioBitrateKbps: 384, durationSeconds: 7_201 });
    } catch (err) {
      caught = err;
    }
    expect((caught as SizeError).code).toBe("duration_out_of_range");
  });

  test("non-positive or non-finite bitrates are refused, with the right code each", () => {
    const cases: { videoBitrateKbps: number; audioBitrateKbps: number; code: string }[] = [
      { videoBitrateKbps: 0, audioBitrateKbps: 384, code: "invalid_video_bitrate" },
      { videoBitrateKbps: -1, audioBitrateKbps: 384, code: "invalid_video_bitrate" },
      { videoBitrateKbps: Number.NaN, audioBitrateKbps: 384, code: "invalid_video_bitrate" },
      { videoBitrateKbps: 8_000, audioBitrateKbps: 0, code: "invalid_audio_bitrate" },
      { videoBitrateKbps: 8_000, audioBitrateKbps: -5, code: "invalid_audio_bitrate" },
    ];
    for (const c of cases) {
      let caught: unknown = null;
      try {
        estimateSize({ ...c, durationSeconds: 60 });
      } catch (err) {
        caught = err;
      }
      expect(caught, JSON.stringify(c)).toBeInstanceOf(SizeError);
      expect((caught as SizeError).code, JSON.stringify(c)).toBe(c.code);
    }
  });

  test("isValidSizeInput mirrors the same bounds", () => {
    expect(isValidSizeInput({ videoBitrateKbps: 8_000, audioBitrateKbps: 384, durationSeconds: 7_200 })).toBe(true);
    expect(isValidSizeInput({ videoBitrateKbps: 8_000, audioBitrateKbps: 384, durationSeconds: 0 })).toBe(false);
    expect(isValidSizeInput({ videoBitrateKbps: 0, audioBitrateKbps: 384, durationSeconds: 60 })).toBe(false);
    expect(isValidSizeInput({ videoBitrateKbps: "8000", audioBitrateKbps: 384, durationSeconds: 60 })).toBe(false);
  });

  test("human formatting is binary and labelled, and handles the small cases", () => {
    expect(humanBytes(512)).toBe("512 B");
    expect(humanBytes(2048)).toBe("2 KiB");
    expect(humanBytes(5 * 1024 * 1024)).toBe("5 MiB");
    expect(humanBytes(1024 ** 3)).toBe("1 GiB");
    expect(humanBytes(-1)).toBe("n/a");
    expect(humanDuration(59)).toBe("0m 59s");
    expect(humanDuration(60)).toBe("1m 00s");
    expect(humanDuration(3_599)).toBe("59m 59s");
    expect(humanDuration(3_600)).toBe("1h 00m 00s");
  });
});

describe("deliverable manifest — shape and honesty", () => {
  const title = "My Great Video!";
  const manifest = buildDeliverableManifest({
    projectId: "p1",
    projectTitle: title,
    durationSeconds: 7_200,
    presetIds: ["youtube-1080p", "youtube-shorts"],
    durationSource: "request",
  });

  test("file names are deterministic slugs of the project title plus the preset id", () => {
    expect(slugifyProjectTitle(title)).toBe("my-great-video");
    expect(slugifyProjectTitle(null)).toBe("project");
    expect(slugifyProjectTitle("   ")).toBe("project");
    expect(slugifyProjectTitle("Ä Ö — 2026")).toBe("a-o-2026");
    expect(outputFileName(title, findExportPreset("youtube-1080p")!)).toBe("my-great-video-youtube-1080p.mp4");
    expect(manifest.outputs.map((o) => o.fileName)).toEqual(["my-great-video-youtube-1080p.mp4", "my-great-video-youtube-shorts.mp4"]);
  });

  test("each output carries resolution, codec, container and its own estimated size", () => {
    expect(manifest.fileCount).toBe(2);
    const fhd = manifest.outputs[0];
    expect(fhd.resolution).toBe("1920×1080");
    expect(fhd.videoCodec).toBe("H.264/AVC");
    expect(fhd.container).toBe("mp4");
    expect(fhd.estimatedSize.bytes).toBe((8_000 + 384) * 1000 * 7_200 / 8);
    const shorts = manifest.outputs[1];
    expect(shorts.resolution).toBe("1080×1920");
    expect(shorts.estimatedSize.bytes).toBe((8_000 + 384) * 1000 * 7_200 / 8);
  });

  test("the total is the sum of the per-output estimates", () => {
    const sum = manifest.outputs.reduce((acc, o) => acc + o.estimatedSize.bytes, 0);
    expect(manifest.totalEstimatedBytes).toBe(sum);
    expect(manifest.totalEstimatedHuman).toBe(humanBytes(sum));
  });

  test("the manifest says plainly that nothing was produced", () => {
    expect(manifest.filesProduced).toBe(0);
    expect(manifest.produced).toBe(false);
    expect(manifest.notProduced).toEqual([...NOT_PRODUCED]);
    expect(manifest.notProduced.some((n) => n.includes("0 bytes were written"))).toBe(true);
    expect(manifest.notProduced.some((n) => n.includes("no frame was decoded"))).toBe(true);
    expect(manifest.note).toContain("No file exists");
    expect(manifest.formula).toBe(SIZE_FORMULA);
    expect(manifest.format).toBe("cavis.export.manifest");
    expect(manifest.durationHuman).toBe("2h 00m 00s");
    expect(manifest.durationSource).toBe("request");
  });

  test("a manifest over the whole catalogue enumerates every preset exactly once", () => {
    const all = buildDeliverableManifest({
      projectId: "p1",
      projectTitle: title,
      durationSeconds: 600,
      presetIds: EXPORT_PRESETS.map((p) => p.id),
      durationSource: "timeline",
    });
    expect(all.fileCount).toBe(7);
    expect(new Set(all.outputs.map((o) => o.presetId)).size).toBe(7);
    for (const output of all.outputs) {
      expect(output.estimatedSize.bytes).toBe((output.videoBitrateKbps + output.audioBitrateKbps) * 1000 * 600 / 8);
    }
  });

  test("a bad duration throws the typed SizeError rather than emitting a manifest", () => {
    expect(() =>
      buildDeliverableManifest({
        projectId: "p1",
        projectTitle: title,
        durationSeconds: 0,
        presetIds: ["youtube-1080p"],
        durationSource: "request",
      }),
    ).toThrow(SizeError);
  });
});
