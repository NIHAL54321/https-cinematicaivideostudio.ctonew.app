/**
 * Phase 7 Block 5 — the quality checker's hard parts.
 *
 * What is proved here:
 *   - the catalogue is seventeen named checks and their weights sum to 100;
 *   - a check with no input is NOT MEASURED and never a pass, on every one of the
 *     seventeen, and names the missing input;
 *   - the score is REFUSED when nothing is measured, and is arithmetic over the
 *     measured checks when some are — recomputed by hand in the test;
 *   - a deliberately failing input really fails: an overlapping cue, a cue past the
 *     timeline, a declared-aspect mismatch, a frame size below the delivery frame,
 *     a failed export job, an empty narration, a chapter with no scene, a subtitle
 *     track with no timecodes;
 *   - the honesty audit still catches a metric-shaped key and an app-authored
 *     banned claim INSIDE the new section;
 *   - the Creator Studio view over the new section passes its own audit.
 */
import { describe, expect, test } from "bun:test";
import { auditPublishingPackage } from "../audit";
import { buildPublishingPackage } from "../package";
import {
  QUALITY_CHECK_CATALOGUE,
  buildQualityPlan,
  computeQualityScore,
  parseSrtCues,
  type FileProbeOutcome,
  type LoudnessOutcome,
  type ProbedFileFacts,
  type QualityPlan,
} from "../quality";
import { measureProducedFile, parseEbur128, parseFfprobeJson, parseRate, probeProducedFile } from "../media-probe";
import { assertCreatorStudioViewHonest, buildCreatorStudioView, type StudioView } from "../studio-view";
import type { PublishingSource } from "../types";

const NOW = new Date("2026-10-16T12:00:00.000Z");

const CLEAN_SRT = [
  "1",
  "00:00:00,000 --> 00:00:02,500",
  "Carthage refused",
  "",
  "2",
  "00:00:03,000 --> 00:00:05,500",
  "and the city burned",
].join("\n");

/** Two chapters, three scenes, real durations (120 + 180 + 300 = 600 s). */
function baseSource(over: Partial<PublishingSource> = {}): PublishingSource {
  return {
    project: {
      id: "proj_q",
      title: "The Fall of Carthage",
      description: "A cinematic retelling of the last years of Carthage.",
      targetAspectRatio: "SIXTEEN_NINE",
      targetDurationSeconds: 600,
      updatedAt: "2026-10-16T09:00:00.000Z",
    },
    settings: null,
    script: null,
    chapters: [
      {
        id: "ch_1",
        scriptId: "scr_1",
        order: 1,
        title: "The Second Punic War",
        summary: null,
        scenes: [
          { id: "sc_1", order: 1, title: null, narration: "Rome demanded that Carthage disarm.", durationSeconds: 120, status: "READY" },
          { id: "sc_2", order: 2, title: null, narration: "Carthage refused, and the siege began.", durationSeconds: 180, status: "READY" },
        ],
      },
      {
        id: "ch_2",
        scriptId: "scr_1",
        order: 2,
        title: "The siege",
        summary: null,
        scenes: [
          { id: "sc_3", order: 1, title: null, narration: "For three years the walls held.", durationSeconds: 300, status: "READY" },
        ],
      },
    ],
    assets: [],
    subtitleTracks: [],
    audioTracks: [],
    exportJobs: [],
    subtitleDefaults: null,
    request: {},
    ...over,
  };
}

function withSubtitle(text: string, over: Partial<PublishingSource> = {}): PublishingSource {
  return baseSource({
    subtitleTracks: [
      { subtitleId: "sub_1", assetId: "as_sub", language: "en", format: "SRT", text, assetDurationSeconds: 5, metadataStyleId: "minimal" },
    ],
    ...over,
  });
}

const THUMBNAILS = { totalConcepts: 6, minimumRequested: 5, maximumAllowed: 10 };

function facts(over: Partial<ProbedFileFacts> = {}): FileProbeOutcome {
  return {
    state: "probed",
    facts: {
      path: "/tmp/produced.mp4",
      sizeBytes: 12_345_678,
      widthPx: 1920,
      heightPx: 1080,
      frameRateAvg: 30,
      frameRateDeclared: 30,
      durationSeconds: 600,
      videoBitrateKbps: 8000,
      overallBitrateKbps: 8250,
      videoCodec: "h264",
      audioStreams: [{ index: 1, codec: "aac", channels: 2, sampleRateHz: 48_000 }],
      tool: "ffprobe version 6.1.1",
      ...over,
    },
  };
}

const LOUD_OK: LoudnessOutcome = {
  state: "measured",
  facts: { integratedLufs: -14.2, truePeakDbfs: -1.4, tool: "ffmpeg version 6.1.1" },
};

function completedJob(over: Partial<PublishingSource["exportJobs"] extends (infer T)[] | undefined ? T : never> = {}) {
  return {
    id: "job_1",
    status: "COMPLETED",
    resolution: "1920×1080",
    errorMessage: null,
    outputUrl: "/tmp/produced.mp4",
    s3Key: null,
    createdAt: "2026-10-16T10:00:00.000Z",
    completedAt: "2026-10-16T10:05:00.000Z",
    ...over,
  };
}

function plan(source: PublishingSource, opts: { file?: FileProbeOutcome; loudness?: LoudnessOutcome; thumbnails?: typeof THUMBNAILS | null } = {}): QualityPlan {
  return buildQualityPlan({
    source,
    file: opts.file,
    loudness: opts.loudness,
    thumbnails: opts.thumbnails === undefined ? THUMBNAILS : opts.thumbnails,
  });
}

function byId(p: QualityPlan, id: string) {
  const found = p.checks.find((c) => c.id === id);
  if (!found) throw new Error(`no check ${id}`);
  return found;
}

describe("the catalogue", () => {
  test("seventeen named checks, weights summing to 100, ids unique", () => {
    expect(QUALITY_CHECK_CATALOGUE.length).toBe(17);
    expect(new Set(QUALITY_CHECK_CATALOGUE.map((c) => c.id)).size).toBe(17);
    expect(QUALITY_CHECK_CATALOGUE.reduce((s, c) => s + c.weight, 0)).toBe(100);
    for (const check of QUALITY_CHECK_CATALOGUE) {
      expect(check.threshold.length).toBeGreaterThan(0);
      expect(check.thresholdSource.length).toBeGreaterThan(0);
    }
  });

  test("a plan always carries all seventeen, in catalogue order", () => {
    const p = plan(baseSource());
    expect(p.checks.map((c) => c.id)).toEqual(QUALITY_CHECK_CATALOGUE.map((c) => c.id));
  });
});

describe("no input is NOT MEASURED, never a pass", () => {
  test("a project with nothing to read measures nothing and produces no score", () => {
    const bare: PublishingSource = {
      project: {
        id: "proj_bare",
        title: "Untitled",
        description: null,
        targetAspectRatio: null,
        targetDurationSeconds: null,
        updatedAt: "2026-10-16T09:00:00.000Z",
      },
      settings: null,
      script: null,
      chapters: [],
      assets: [],
      request: {},
    };
    const p = plan(bare, { thumbnails: null });
    expect(p.checks.every((c) => c.state === "not_measured")).toBe(true);
    expect(p.checks.filter((c) => c.state === "pass").length).toBe(0);
    for (const check of p.checks) {
      expect(check.missingInputs.length).toBeGreaterThan(0);
      expect(check.measurement.length).toBeGreaterThan(40);
    }
    // The score is REFUSED: no value, an empty-with-reason field, and no zero.
    expect(p.score.score.state).toBe("empty_no_input");
    if (p.score.score.state !== "empty_no_input") throw new Error("unreachable");
    expect(p.score.score.value).toBeNull();
    expect(p.score.score.reason).toContain("No check could be measured");
    expect(p.score.score.requires.length).toBeGreaterThan(0);
    expect(p.score.measuredChecks).toBe(0);
    expect(p.score.basis).toContain("No score is shown");
    expect(p.score.arithmetic).toContain("not defined");
  });

  test("with no produced file the seven file checks are not measured and name the file", () => {
    const p = plan(baseSource());
    const fileChecks = p.checks.filter((c) => c.area === "file");
    expect(fileChecks.length).toBe(7);
    for (const check of fileChecks) {
      expect(check.state).toBe("not_measured");
      expect(check.measurement.toLowerCase()).toContain("not")
      expect(check.missingInputs.join(" ")).toMatch(/produced video file|ffprobe|file/);
    }
  });
});

describe("the score is arithmetic over measured checks", () => {
  test("passing measured checks give 100 over the measured weight, not over 100 of weight", () => {
    const p = plan(withSubtitle(CLEAN_SRT));
    const measured = p.checks.filter((c) => c.state !== "not_measured");
    expect(measured.length).toBeGreaterThan(3);
    const measuredWeight = measured.reduce((s, c) => s + c.weight, 0);
    const passingWeight = measured.filter((c) => c.state === "pass").reduce((s, c) => s + c.weight, 0);
    const expected = Math.round((passingWeight / measuredWeight) * 100);
    expect(p.score.score.state).toBe("derived");
    if (p.score.score.state !== "derived") throw new Error("unreachable");
    expect(p.score.score.value).toBe(expected);
    expect(p.score.measuredWeight).toBe(measuredWeight);
    expect(p.score.totalWeight).toBe(100);
    expect(p.score.basis).toContain(`${measured.length} of 17`);
    expect(p.score.basis).toContain("not counted as passes");
    expect(p.score.notAPrediction).toContain("not a prediction");
  });

  test("a failing measured check lowers the score by exactly its weight", () => {
    const failing = withSubtitle(["1", "00:00:00,000 --> 00:00:04,000", "one", "", "2", "00:00:02,000 --> 00:00:06,000", "two"].join("\n"));
    const p = plan(failing);
    expect(byId(p, "subtitle_overlap").state).toBe("fail");
    const measured = p.checks.filter((c) => c.state !== "not_measured");
    const measuredWeight = measured.reduce((s, c) => s + c.weight, 0);
    const passingWeight = measured.filter((c) => c.state === "pass").reduce((s, c) => s + c.weight, 0);
    if (p.score.score.state !== "derived") throw new Error("expected a score");
    expect(p.score.score.value).toBe(Math.round((passingWeight / measuredWeight) * 100));
    expect(p.score.score.value).toBeLessThan(100);
    expect(p.score.failedChecks).toBeGreaterThanOrEqual(1);
  });

  test("computeQualityScore with no measured check returns no value", () => {
    const p = plan(baseSource(), { thumbnails: null });
    const score = computeQualityScore(p.checks.filter((c) => c.state === "not_measured"));
    expect(score.score.state).toBe("empty_no_input");
    expect(score.measuredWeight).toBe(0);
  });
});

describe("deliberately failing inputs really fail", () => {
  test("an overlapping cue fails the overlap check and names the collision", () => {
    const p = plan(withSubtitle(["1", "00:00:00,000 --> 00:00:04,000", "one", "", "2", "00:00:02,000 --> 00:00:06,000", "two"].join("\n")));
    const overlap = byId(p, "subtitle_overlap");
    expect(overlap.state).toBe("fail");
    expect(overlap.measurement).toContain("1 overlapping pair(s)");
    expect(overlap.measurement).toContain("overlapping pair(s)");
    expect(overlap.measurement).toContain("cue 1");
  });

  test("a cue that runs past the timeline fails the timing check", () => {
    const p = plan(withSubtitle(["1", "00:00:00,000 --> 00:20:00,000", "past the end"].join("\n")));
    const timing = byId(p, "subtitle_cue_timing");
    expect(timing.state).toBe("fail");
    expect(timing.measurement).toContain("past the timeline");
  });

  test("a cue that ends before it starts fails", () => {
    const p = plan(withSubtitle(["1", "00:00:05,000 --> 00:00:02,000", "backwards"].join("\n")));
    expect(byId(p, "subtitle_cue_timing").state).toBe("fail");
  });

  test("a declared aspect mismatch fails, with the arithmetic in the sentence", () => {
    const source = baseSource({ exportJobs: [completedJob()] });
    const p = plan(source, { file: facts({ widthPx: 1080, heightPx: 1920 }), loudness: LOUD_OK });
    const aspect = byId(p, "aspect_ratio");
    const resolution = byId(p, "resolution");
    expect(aspect.state).toBe("fail");
    expect(aspect.measurement).toContain("0.5625");
    expect(aspect.measurement).toContain("outside");
    expect(resolution.state).toBe("fail");
    expect(byId(p, "frame_rate").state).toBe("pass");
    expect(byId(p, "audio_stream").state).toBe("pass");
    expect(byId(p, "loudness").state).toBe("pass");
    expect(byId(p, "produced_file").state).toBe("pass");
  });

  test("a frame size below the delivery frame fails the resolution check", () => {
    const source = baseSource({ exportJobs: [completedJob()] });
    const p = plan(source, { file: facts({ widthPx: 1280, heightPx: 720 }), loudness: LOUD_OK });
    expect(byId(p, "resolution").state).toBe("fail");
    expect(byId(p, "resolution").measurement).toContain("1280×720");
  });

  test("a failed export job fails the render check with its own error message", () => {
    const p = plan(baseSource({ exportJobs: [completedJob({ status: "FAILED", errorMessage: "encoder exited with code 1", outputUrl: null })] }));
    const render = byId(p, "render_errors");
    expect(render.state).toBe("fail");
    expect(render.measurement).toContain("encoder exited with code 1");
  });

  test("a still-running export job is not measured, and a clean completed one passes", () => {
    const running = plan(baseSource({ exportJobs: [completedJob({ status: "PROCESSING" })] }));
    expect(byId(running, "render_errors").state).toBe("not_measured");
    expect(byId(running, "render_errors").missingInputs.length).toBeGreaterThan(0);
    const done = plan(baseSource({ exportJobs: [completedJob()] }));
    expect(byId(done, "render_errors").state).toBe("pass");
  });

  test("a scene with no stored duration withdraws the timeline, so coverage and cue timing are not measured", () => {
    const source = withSubtitle(CLEAN_SRT, {
      chapters: [
        {
          id: "ch_1",
          scriptId: "scr_1",
          order: 1,
          title: "Only chapter",
          summary: null,
          scenes: [
            { id: "sc_1", order: 1, title: null, narration: "spoken", durationSeconds: 120, status: "READY" },
            { id: "sc_2", order: 2, title: null, narration: "spoken", durationSeconds: null, status: "READY" },
          ],
        },
      ],
    });
    const p = plan(source);
    expect(byId(p, "chapter_coverage").state).toBe("not_measured");
    expect(byId(p, "chapter_coverage").missingInputs.join(" ")).toContain("durationSeconds");
    expect(byId(p, "subtitle_cue_timing").state).toBe("not_measured");
    // The overlap check needs no timeline, so it is still measured.
    expect(byId(p, "subtitle_overlap").state).toBe("pass");
    expect(p.timeline.total).toBeNull();
  });

  test("a scene with no narration fails the spoken-text check", () => {
    const source = baseSource({
      chapters: [
        {
          id: "ch_1",
          scriptId: "scr_1",
          order: 1,
          title: "Only chapter",
          summary: null,
          scenes: [
            { id: "sc_1", order: 1, title: null, narration: "spoken", durationSeconds: 600, status: "READY" },
            { id: "sc_2", order: 2, title: null, narration: "   ", durationSeconds: 0, status: "DRAFT" },
          ],
        },
      ],
    });
    const p = plan(source);
    expect(byId(p, "scene_narration").state).toBe("fail");
    expect(byId(p, "scene_narration").measurement).toContain("sc_2");
  });

  test("a chapter with no scene fails the coverage check", () => {
    const source = baseSource({
      chapters: [
        { id: "ch_1", scriptId: "scr_1", order: 1, title: "Full", summary: null, scenes: [{ id: "sc_1", order: 1, title: null, narration: "x", durationSeconds: 600, status: "READY" }] },
        { id: "ch_2", scriptId: "scr_1", order: 2, title: "Empty", summary: null, scenes: [] },
      ],
    });
    const p = plan(source);
    expect(byId(p, "chapter_coverage").state).toBe("fail");
    expect(byId(p, "chapter_coverage").measurement).toContain("ch_2");
  });

  test("a subtitle track with no timecodes fails the track check instead of inventing cues", () => {
    const p = plan(withSubtitle("Three years the walls held, but no timecodes were stored."));
    expect(parseSrtCues("Three years the walls held, but no timecodes were stored.").length).toBe(0);
    expect(byId(p, "subtitle_track").state).toBe("fail");
    expect(byId(p, "subtitle_track").measurement).toContain("0 cue(s)");
  });

  test("a track that exists with clean cues passes track, timing and overlap", () => {
    const p = plan(withSubtitle(CLEAN_SRT));
    expect(byId(p, "subtitle_track").state).toBe("pass");
    expect(byId(p, "subtitle_cue_timing").state).toBe("pass");
    expect(byId(p, "subtitle_overlap").state).toBe("pass");
    // The safe area needs a stored style + anchor and a measured frame: not measured here.
    expect(byId(p, "subtitle_safe_area").state).toBe("not_measured");
    expect(byId(p, "subtitle_safe_area").missingInputs.join(" ")).toContain("subtitleDefaults");
  });
});

describe("SRT parsing", () => {
  test("reads timecodes, line counts and order", () => {
    const cues = parseSrtCues(CLEAN_SRT);
    expect(cues.length).toBe(2);
    expect(cues[0]!.startMs).toBe(0);
    expect(cues[0]!.endMs).toBe(2500);
    expect(cues[1]!.startMs).toBe(3000);
    expect(cues[1]!.text).toBe("and the city burned");
  });
  test("a short fraction is read as tenths of a second", () => {
    expect(parseSrtCues("1\n00:00:01,5 --> 00:00:02,25\nx").length).toBe(1);
  });
});

describe("the probe layer", () => {
  const FFPROBE_JSON = JSON.stringify({
    streams: [
      { index: 0, codec_type: "video", codec_name: "h264", width: 1920, height: 1080, avg_frame_rate: "30/1", r_frame_rate: "30/1", bit_rate: "8041000" },
      { index: 1, codec_type: "audio", codec_name: "aac", channels: 2, sample_rate: "48000" },
    ],
    format: { duration: "600.500000", bit_rate: "8250000" },
  });

  test("parseRate reads rational and plain rates", () => {
    expect(parseRate("30000/1001")).toBeCloseTo(29.97, 2);
    expect(parseRate("30")).toBe(30);
    expect(parseRate("0/0")).toBeNull();
    expect(parseRate(undefined)).toBeNull();
  });

  test("parseFfprobeJson reports what the tool reported and null for what it did not", () => {
    const parsed = parseFfprobeJson(FFPROBE_JSON);
    expect(parsed.widthPx).toBe(1920);
    expect(parsed.heightPx).toBe(1080);
    expect(parsed.frameRateAvg).toBe(30);
    expect(parsed.durationSeconds).toBeCloseTo(600.5, 3);
    expect(parsed.videoBitrateKbps).toBe(8041);
    expect(parsed.overallBitrateKbps).toBe(8250);
    expect(parsed.audioStreams.length).toBe(1);
    expect(parsed.audioStreams[0]!.channels).toBe(2);
  });

  test("a stream with no dimensions yields null, not zero", () => {
    const parsed = parseFfprobeJson(JSON.stringify({ streams: [{ index: 0, codec_type: "video" }], format: {} }));
    expect(parsed.widthPx).toBeNull();
    expect(parsed.heightPx).toBeNull();
    expect(parsed.frameRateAvg).toBeNull();
  });

  test("parseEbur128 reads the summary's two figures", () => {
    const output = [
      "  Stream #0:1: Audio: aac",
      "    Summary:",
      "",
      "  Integrated loudness:",
      "    I:         -14.2 LUFS",
      "    Threshold: -24.7 LUFS",
      "",
      "  Loudness range:",
      "    LRA:         1.9 LU",
      "",
      "  True peak:",
      "    Peak:       -1.2 dBFS",
    ].join("\n");
    const parsed = parseEbur128(output);
    expect(parsed.integratedLufs).toBe(-14.2);
    expect(parsed.truePeakDbfs).toBe(-1.2);
  });

  test("no produced file, and a file with no probe tool, are both NOT a measurement", () => {
    const absent = probeProducedFile(null, { toolVersion: () => null });
    expect(absent.state).toBe("absent");
    const failed = probeProducedFile("/tmp/produced.mp4", {
      fileExists: () => true,
      fileSize: () => 1024,
      toolVersion: () => null,
    });
    expect(failed.state).toBe("failed");
    if (failed.state !== "failed") throw new Error("unreachable");
    expect(failed.reason).toContain("no ffprobe binary");
  });

  test("no file AND no probe tool names BOTH facts, because they are two different fixes", () => {
    const absent = probeProducedFile(null, { toolVersion: () => null });
    if (absent.state !== "absent") throw new Error("unreachable");
    expect(absent.reason).toContain("no ffprobe binary");
    expect(absent.requires.length).toBe(2);
    expect(absent.requires.join(" | ")).toContain("a produced video file");
    expect(absent.requires.join(" | ")).toContain("an ffprobe binary");
    // …and no false claim in the other direction: with the tool present, only the
    // file is named as missing.
    const onlyFile = probeProducedFile(null, { toolVersion: () => "ffprobe version 6.1.1" });
    if (onlyFile.state !== "absent") throw new Error("unreachable");
    expect(onlyFile.requires.length).toBe(1);
    expect(onlyFile.requires.join(" ")).toContain("a produced video file");
    expect(onlyFile.reason).not.toContain("no ffprobe binary");
  });

  test("the seven file checks' sentences carry both missing inputs through to the plan", () => {
    // The service's real path: no export job, and no probe binary on the machine.
    const measured = measureProducedFile(baseSource(), { toolVersion: () => null });
    expect(measured.file.state).toBe("absent");
    const p = plan(baseSource(), { file: measured.file, loudness: measured.loudness });
    const fileChecks = p.checks.filter((c) => c.area === "file");
    expect(fileChecks.length).toBe(7);
    for (const check of fileChecks) {
      expect(check.state).toBe("not_measured");
      expect(check.measurement).toContain("produced video file");
      expect(check.measurement).toMatch(/ffprobe|ffmpeg/);
      expect(check.missingInputs.join(" | ")).toMatch(/produced video file/);
    }
    // Both facts are visible on the plan itself, not only inside each check.
    expect(p.fileMeasurement.requires.join(" | ")).toContain("produced video file");
    expect(p.fileMeasurement.requires.join(" | ")).toContain("ffprobe binary");
  });

  test("with a file and an injected tool the probe returns the tool's facts", () => {
    const outcome = probeProducedFile("/tmp/produced.mp4", {
      fileExists: () => true,
      fileSize: () => 2048,
      toolVersion: () => "ffprobe version 6.1.1",
      run: () => FFPROBE_JSON,
    });
    expect(outcome.state).toBe("probed");
    if (outcome.state !== "probed") throw new Error("unreachable");
    expect(outcome.facts.sizeBytes).toBe(2048);
    expect(outcome.facts.widthPx).toBe(1920);
    expect(outcome.facts.tool).toBe("ffprobe version 6.1.1");
  });
});

describe("inside the package and the view", () => {
  function packageWithQuality() {
    const source = withSubtitle(CLEAN_SRT, { exportJobs: [completedJob()] });
    return buildPublishingPackage(source, {
      now: NOW,
      modelCopyEnvNames: ["OPENAI_API_KEY"],
      qualityMeasurement: { file: facts(), loudness: LOUD_OK },
    });
  }

  test("the package carries the plan, passes its own audit and counts the checks", () => {
    const pkg = packageWithQuality();
    expect(pkg.quality.checks.length).toBe(17);
    expect(pkg.selfAudit.ok).toBe(true);
    expect(pkg.summary.qualityChecks).toBe(17);
    expect(pkg.summary.qualityChecksPassed + pkg.summary.qualityChecksFailed + pkg.summary.qualityChecksNotMeasured).toBe(17);
    expect(pkg.summary.qualityScore).not.toBeNull();
    expect(pkg.format).toBe("cavs.publishing-package/v4");
  });

  test("a metric-shaped key inside the quality plan is still a violation", () => {
    const pkg = packageWithQuality();
    const polluted = JSON.parse(JSON.stringify(pkg)) as Record<string, unknown>;
    const quality = polluted.quality as Record<string, unknown>;
    quality.monthlySearchVolume = 1200;
    const audit = auditPublishingPackage(polluted);
    expect(audit.ok).toBe(false);
    expect(audit.violations.some((v) => v.kind === "forbidden_metric_key")).toBe(true);
  });

  test("a banned claim in an app-authored quality sentence is still a violation", () => {
    const pkg = packageWithQuality();
    const polluted = JSON.parse(JSON.stringify(pkg)) as Record<string, unknown>;
    const quality = polluted.quality as Record<string, unknown>;
    const checks = quality.checks as { measurement: string }[];
    checks[0]!.measurement = "This render is guaranteed to rank higher.";
    const audit = auditPublishingPackage(polluted);
    expect(audit.ok).toBe(false);
    expect(audit.violations.some((v) => v.kind === "banned_claim")).toBe(true);
  });

  test("the Creator Studio view renders the quality section and passes its own audit", () => {
    const pkg = packageWithQuality();
    const view = buildCreatorStudioView({
      projectId: pkg.projectId,
      package: pkg,
      version: 1,
      savedPackageId: "sp_1",
      payloadBytes: 8192,
      versions: [],
      reAudit: null,
    });
    expect(view.kind).toBe("package");
    if (view.kind !== "package") throw new Error("unreachable");
    const typed = view as StudioView;
    assertCreatorStudioViewHonest(typed);
    const section = typed.sections.find((s) => s.id === "quality");
    expect(section).toBeDefined();
    const checkRows = section!.rows.filter((r) => r.kind === "quality_check");
    expect(checkRows.length).toBe(17);
    // Every check's state and measurement are on the surface.
    for (const row of checkRows) {
      const labels = row.values.map((v) => v.label);
      expect(labels).toContain("State");
      expect(labels).toContain("The measurement behind this state");
    }
    const states = checkRows.map((r) => r.values.find((v) => v.label === "State")?.value);
    expect(states).toContain("Pass");
    expect(states).toContain("Not measured");
    // A not-measured check carries its missing input as a requires list.
    const notMeasured = checkRows.find((r) => r.values.some((v) => v.label === "State" && v.value === "Not measured"))!;
    const missing = notMeasured.values.find((v) => v.label === "Missing input")!;
    expect(missing.state).toBe("empty_no_input");
    expect(missing.requires.length).toBeGreaterThan(0);
    // The score and its basis are on the surface.
    const score = section!.values.find((v) => v.label === "The score")!;
    expect(score.state).toBe("derived");
    expect(typeof score.value).toBe("number");
    expect(section!.values.some((v) => v.label === "What this score is over")).toBe(true);
    expect(section!.values.some((v) => v.label === "What this score is not")).toBe(true);
  });
});
