/**
 * A SEGMENT IS THE LENGTH ITS SCENE DECLARES (Phase 8, block 8).
 *
 * Until this block every clip was concatenated in full, so the master's length was
 * whatever the providers happened to serve. These tests pin the three cases, the
 * tolerance that separates "rounding" from "a different length", and the exact
 * encoder arguments each case produces — including the ones that must NOT appear
 * (a held segment must not get `-shortest`, which would cut it back to the clip).
 */
import { describe, expect, test } from "bun:test";
import {
  TRIM_TOLERANCE_SECONDS,
  planClipNormalisation,
  planSegmentTrim,
  timelineTargetFromSpec,
  type TimelineTarget,
} from "../source-clip";
import { findExportPreset } from "@/lib/export/presets";

const preset = findExportPreset("youtube-1080p");
if (!preset) throw new Error("youtube-1080p preset is missing — the tests below are meaningless without it");
const target: TimelineTarget = timelineTargetFromSpec(preset);

describe("planSegmentTrim", () => {
  test("a clip longer than its scene is CUT at the scene's duration, and the cut is stated", () => {
    const trim = planSegmentTrim({ sceneDurationSeconds: 20, sourceDurationSeconds: 31.5 });
    expect(trim.policy).toBe("trimmed-to-scene-duration");
    expect(trim.outputLimitSeconds).toBe(20);
    expect(trim.trimmedSeconds).toBe(11.5);
    expect(trim.heldSeconds).toBe(0);
    expect(trim.basis).toContain("CUT at 20 s");
    expect(trim.basis).toContain("11.5 s of the clip's tail is not in the film");
  });

  test("a clip shorter than its scene has its LAST FRAME HELD for exactly the shortfall", () => {
    const trim = planSegmentTrim({ sceneDurationSeconds: 20, sourceDurationSeconds: 8.312 });
    expect(trim.policy).toBe("last-frame-held-to-scene-duration");
    expect(trim.outputLimitSeconds).toBe(20);
    expect(trim.heldSeconds).toBe(11.688);
    expect(trim.trimmedSeconds).toBe(0);
    expect(trim.basis).toContain("LAST FRAME is held");
    expect(trim.basis).toContain("nothing is filled with black");
  });

  test("a clip that already matches its scene is neither cut nor held", () => {
    const trim = planSegmentTrim({ sceneDurationSeconds: 20, sourceDurationSeconds: 20.02 });
    expect(trim.policy).toBe("clip-in-full-no-declared-duration");
    expect(trim.trimmedSeconds).toBe(0);
    expect(trim.heldSeconds).toBe(0);
    // `-t` is still written, so the segment is the scene's number rather than a
    // consequence of what the provider served.
    expect(trim.outputLimitSeconds).toBe(20);
    expect(trim.basis).toContain(`agree within ${TRIM_TOLERANCE_SECONDS} s`);
  });

  test("a scene that declares no duration plays the clip in full and says so", () => {
    const trim = planSegmentTrim({ sceneDurationSeconds: null, sourceDurationSeconds: 12 });
    expect(trim.policy).toBe("clip-in-full-no-declared-duration");
    expect(trim.outputLimitSeconds).toBeNull();
    expect(trim.segmentDurationSeconds).toBe(12);
    expect(trim.basis).toContain("declares no duration");
  });

  test("an unmeasurable clip is cut to the scene and the unknown amount is not claimed", () => {
    const trim = planSegmentTrim({ sceneDurationSeconds: 20, sourceDurationSeconds: null });
    expect(trim.policy).toBe("trimmed-to-scene-duration");
    expect(trim.outputLimitSeconds).toBe(20);
    expect(trim.trimmedSeconds).toBe(0);
    expect(trim.basis).toContain("could not be measured");
    expect(trim.basis).toContain("is not claimed");
  });
});

describe("planClipNormalisation — the arguments each case writes", () => {
  const base = { inputPath: "/tmp/in.mp4", outputPath: "/tmp/out.mp4", target };

  const args = (argv: string[]) => argv.join(" ");

  test("a trimmed segment carries -t with the scene's own duration", () => {
    const plan = planClipNormalisation({ ...base, sourceHasAudio: true, sceneDurationSeconds: 20, sourceDurationSeconds: 45 });
    expect(plan.argv).toContain("-t");
    expect(plan.argv[plan.argv.indexOf("-t") + 1]).toBe("20");
    expect(plan.videoFilter).not.toContain("tpad");
    expect(plan.trim.policy).toBe("trimmed-to-scene-duration");
  });

  test("a held segment gets tpad stop_mode=clone for the shortfall and NO -shortest", () => {
    const plan = planClipNormalisation({ ...base, sourceHasAudio: false, sceneDurationSeconds: 20, sourceDurationSeconds: 5 });
    expect(plan.videoFilter).toContain("tpad=stop_mode=clone:stop_duration=15");
    // `-shortest` would end the file at the first stream that runs out — the 5 s
    // clip — and silently undo the hold.
    expect(plan.argv).not.toContain("-shortest");
    expect(plan.audio.plan).toBe("silent-track-added");
    expect(plan.audio.statement).toContain("NO audio stream");
  });

  test("a clip WITH audio whose last frame is held gets apad, and the tail is called SILENCE", () => {
    const plan = planClipNormalisation({ ...base, sourceHasAudio: true, sceneDurationSeconds: 20, sourceDurationSeconds: 6 });
    expect(plan.argv).toContain("-af");
    expect(args(plan.argv)).toContain("-af apad");
    expect(plan.audio.paddedWithSilence).toBe(true);
    expect(plan.audio.statement).toContain("SILENCE appended by apad");
    expect(plan.audio.statement).toContain("not the clip's sound continued");
  });

  test("a scene with no declared duration keeps -shortest for a generated silent track", () => {
    const plan = planClipNormalisation({ ...base, sourceHasAudio: false, sceneDurationSeconds: null, sourceDurationSeconds: 5 });
    expect(plan.argv).toContain("-shortest");
    expect(plan.argv).not.toContain("-t");
    expect(plan.trim.outputLimitSeconds).toBeNull();
  });

  test("the reasons list names -t and quotes the trim basis", () => {
    const plan = planClipNormalisation({ ...base, sourceHasAudio: true, sceneDurationSeconds: 20, sourceDurationSeconds: 44 });
    const t = plan.reasons.find((r) => r.arg.startsWith("-t"));
    expect(t).toBeDefined();
    expect(t?.reason).toContain("24 s of the clip's tail is not in the film");
  });
});
