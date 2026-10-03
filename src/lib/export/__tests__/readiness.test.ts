/**
 * Phase 6 Block 3 — the publish-readiness rules. Every rule must have a pass
 * path, a fail path and — where the app genuinely cannot check it — an honest
 * UNKNOWN path. No rule may ever return a scored or estimated result.
 */
import { describe, expect, test } from "bun:test";
import {
  PUBLISH_TARGET_IDS,
  PUBLISH_TARGETS,
  READINESS_MEDIA_ANALYSIS_ENV,
  checkPublishReadiness,
  checkTargetReadiness,
  findPublishTarget,
  isPublishTargetId,
  orderPublishTargetIds,
  readinessMediaAnalysisGate,
  readinessVerdict,
  unknownPublishTargetIds,
  type ReadinessInput,
  type RuleResult,
} from "../readiness";
import { EXPORT_PRESET_IDS } from "../presets";
import { DEFAULT_LOUDNESS_TARGET_LUFS } from "../../mix/engine";

/** A project that satisfies every checkable rule for YouTube long-form. */
function readyInput(overrides: Partial<ReadinessInput> = {}): ReadinessInput {
  return {
    durationSeconds: 720,
    durationSource: "timeline",
    targetAspect: "SIXTEEN_NINE",
    appliedPresetIds: ["youtube-1080p"],
    cueCount: 12,
    captionSource: "3 narrated scenes",
    mix: { estimateLufs: DEFAULT_LOUDNESS_TARGET_LUFS, targetLufs: DEFAULT_LOUDNESS_TARGET_LUFS, hasAudioClips: true, model: "ESTIMATE" },
    thumbnail: { present: true, assetName: "cover.png", detail: "thumbnail asset" },
    metadata: {
      title: "A good title",
      description: "A description well inside the limit.",
      tags: ["one", "two"],
      titleSource: "the project's own title field",
      descriptionSource: "the project's own description field",
      tagsSource: "ProjectSettings.seoDefaults.tags",
    },
    ...overrides,
  };
}

function ruleOf(rules: RuleResult[], id: string): RuleResult {
  const found = rules.find((r) => r.id === id);
  if (!found) throw new Error(`no rule ${id} in ${rules.map((r) => r.id).join(", ")}`);
  return found;
}

const LONG_FORM = findPublishTarget("youtube-long-form")!;

describe("the target catalogue", () => {
  test("six targets, in canonical order, each with a real preset and format", () => {
    expect(PUBLISH_TARGET_IDS).toEqual(["youtube-long-form", "youtube-shorts", "instagram-reels", "tiktok", "square", "portrait"]);
    expect(PUBLISH_TARGETS.length).toBe(6);
    for (const t of PUBLISH_TARGETS) {
      expect(isPublishTargetId(t.id)).toBe(true);
      for (const id of t.requiredPresetIds) expect(EXPORT_PRESET_IDS).toContain(id);
      expect(t.requiredPresetIds).toContain(t.preferredPresetId);
      expect(t.duration.maxSeconds).toBeGreaterThan(0);
      expect(t.duration.basis.length).toBeGreaterThan(20);
      expect(t.text.basis.length).toBeGreaterThan(20);
      expect(t.loudness.targetLufs).toBe(DEFAULT_LOUDNESS_TARGET_LUFS);
    }
  });
  test("the published duration limits are the real ones", () => {
    expect(findPublishTarget("youtube-shorts")!.duration.maxSeconds).toBe(180);
    expect(findPublishTarget("instagram-reels")!.duration.maxSeconds).toBe(180);
    expect(findPublishTarget("tiktok")!.duration.maxSeconds).toBe(600);
    expect(findPublishTarget("youtube-long-form")!.duration.maxSeconds).toBe(43_200);
    expect(findPublishTarget("square")!.duration.maxSeconds).toBe(3_600);
  });
  test("target ids are validated, ordered and never silently dropped", () => {
    expect(isPublishTargetId("tiktok")).toBe(true);
    expect(isPublishTargetId("vimeo")).toBe(false);
    expect(orderPublishTargetIds(["tiktok", "youtube-shorts", "tiktok"])).toEqual(["youtube-shorts", "tiktok"]);
    expect(orderPublishTargetIds("nope")).toEqual([]);
    expect(unknownPublishTargetIds(["tiktok", "vimeo"])).toEqual(["vimeo"]);
    expect(findPublishTarget("vimeo")).toBeNull();
  });
});

describe("rule: duration within the platform limit", () => {
  const check = (seconds: number, source = "timeline") => {
    const report = checkTargetReadiness(LONG_FORM, readyInput({ durationSeconds: seconds, durationSource: source }));
    return ruleOf(report.rules, "duration_within_limit");
  };
  test("pass inside the limit, with the headroom stated", () => {
    const r = check(720);
    expect(r.status).toBe("pass");
    expect(r.actual).toContain("12m 00s");
    expect(r.actual).toContain("from timeline");
    expect(r.detail).toContain("Inside the limit by");
    expect(r.severity).toBe("required");
  });
  test("fail over the limit, with the overshoot stated", () => {
    const r = check(43_201);
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("Over the limit by");
  });
  test("unknown when there is no duration at all", () => {
    const r = check(0, "none");
    expect(r.status).toBe("unknown");
    expect(r.actual).toBe("no duration available");
    expect(r.detail).toContain("cannot be checked");
  });
  test("a Shorts-sized limit fails a 15-minute video", () => {
    const shorts = findPublishTarget("youtube-shorts")!;
    const r = ruleOf(checkTargetReadiness(shorts, readyInput({ durationSeconds: 900 })).rules, "duration_within_limit");
    expect(r.status).toBe("fail");
    expect(r.rule).toContain("3m 00s");
  });
});

describe("rule: aspect ratio matches the target", () => {
  const check = (aspect: string | null, target = LONG_FORM) =>
    ruleOf(checkTargetReadiness(target, readyInput({ targetAspect: aspect })).rules, "aspect_ratio_match");
  test("pass when the declared aspect maps to the target's format", () => {
    const r = check("SIXTEEN_NINE");
    expect(r.status).toBe("pass");
    expect(r.actual).toContain("16:9");
  });
  test("fail when the declared aspect is a different delivery format", () => {
    const r = check("NINE_SIXTEEN");
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("mismatch");
  });
  test("unknown when the project declares no target aspect", () => {
    const r = check(null);
    expect(r.status).toBe("unknown");
    expect(r.actual).toContain("no target aspect declared");
  });
  test("a 4:3 declaration is a stated fallback, not a silent guess", () => {
    const r = check("FOUR_THREE");
    expect(r.actual).toContain("stated, not guessed");
    expect(r.status).toBe("pass");
  });
  test("9:16 passes for the vertical targets and fails for the square one", () => {
    expect(check("NINE_SIXTEEN", findPublishTarget("tiktok")!).status).toBe("pass");
    expect(check("NINE_SIXTEEN", findPublishTarget("square")!).status).toBe("fail");
  });
});

describe("rule: required export preset applied", () => {
  const check = (applied: ReadinessInput["appliedPresetIds"], target = LONG_FORM) =>
    ruleOf(checkTargetReadiness(target, readyInput({ appliedPresetIds: applied })).rules, "export_preset_applied");
  test("pass when one of the target's presets is applied", () => {
    expect(check(["youtube-2160p"]).status).toBe("pass");
    expect(check(["youtube-1080p"]).status).toBe("pass");
    expect(check(["square-1080", "youtube-2160p-hdr"]).status).toBe("pass");
  });
  test("fail when presets are applied but none matches the target", () => {
    const r = check(["square-1080"]);
    expect(r.status).toBe("fail");
    expect(r.actual).toContain("applied: square-1080");
    expect(r.detail).toContain("re-exporting");
  });
  test("unknown when nothing is applied — the delivery spec is undecided", () => {
    const r = check([]);
    expect(r.status).toBe("unknown");
    expect(r.actual).toContain("no delivery preset is applied");
  });
  test("each vertical target needs its own preset", () => {
    expect(check(["instagram-reels"], findPublishTarget("tiktok")!).status).toBe("fail");
    expect(check(["tiktok"], findPublishTarget("tiktok")!).status).toBe("pass");
  });
});

describe("rule: final mix meets the loudness target", () => {
  const check = (mix: ReadinessInput["mix"]) =>
    ruleOf(checkTargetReadiness(LONG_FORM, readyInput({ mix })).rules, "loudness_target_met");
  test("pass inside the tolerance window", () => {
    const r = check({ estimateLufs: -14.5, targetLufs: -14, hasAudioClips: true, model: "ESTIMATE" });
    expect(r.status).toBe("pass");
    expect(r.actual).toContain("-14.5 LUFS");
    expect(r.detail).toContain("ESTIMATE");
  });
  test("fail outside the tolerance window, naming the renderer work that would fix it", () => {
    const r = check({ estimateLufs: -11.91, targetLufs: -14, hasAudioClips: true, model: "ESTIMATE" });
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("provider work");
    expect(r.detail).toContain("ESTIMATE");
  });
  test("unknown with no mix at all", () => {
    const r = check(null);
    expect(r.status).toBe("unknown");
    expect(r.actual).toContain("no mix");
  });
  test("unknown when the timeline carries no audio clips", () => {
    const r = check({ estimateLufs: -14, targetLufs: -14, hasAudioClips: false, model: "ESTIMATE" });
    expect(r.status).toBe("unknown");
    expect(r.actual).toContain("no voice, music or SFX clips");
  });
});

describe("rules: captions and thumbnail", () => {
  test("captions pass with cues and fail with an honest zero", () => {
    const pass = ruleOf(checkTargetReadiness(LONG_FORM, readyInput()).rules, "captions_present");
    expect(pass.status).toBe("pass");
    expect(pass.actual).toContain("12 cue(s)");
    const fail = ruleOf(checkTargetReadiness(LONG_FORM, readyInput({ cueCount: 0 })).rules, "captions_present");
    expect(fail.status).toBe("fail");
    expect(fail.actual).toContain("0 cue(s)");
    expect(fail.detail).toContain("Zero is a real answer");
  });
  test("captions are a REQUIRED app policy on the vertical targets", () => {
    const shorts = findPublishTarget("youtube-shorts")!;
    expect(ruleOf(checkTargetReadiness(shorts, readyInput()).rules, "captions_present").severity).toBe("required");
    expect(ruleOf(checkTargetReadiness(LONG_FORM, readyInput()).rules, "captions_present").severity).toBe("recommended");
  });
  test("the thumbnail rule passes on a real asset and fails on an honest none", () => {
    const pass = ruleOf(checkTargetReadiness(LONG_FORM, readyInput()).rules, "thumbnail_present");
    expect(pass.status).toBe("pass");
    expect(pass.actual).toContain("cover.png");
    expect(pass.detail).toContain("no image was generated");
    const fail = ruleOf(
      checkTargetReadiness(LONG_FORM, readyInput({ thumbnail: { present: false, assetName: null, detail: "no thumbnail asset exists for this project" } })).rules,
      "thumbnail_present",
    );
    expect(fail.status).toBe("fail");
    expect(fail.actual).toBe("none selected");
    expect(fail.detail).toContain("Nothing was fabricated");
  });
});

describe("rules: title, description and tags against the published limits", () => {
  const rulesFor = (metadata: Partial<ReadinessInput["metadata"]>, target = LONG_FORM) =>
    checkTargetReadiness(target, readyInput({ metadata: { ...readyInput().metadata, ...metadata } })).rules;

  test("a title inside the limit passes both title rules", () => {
    expect(ruleOf(rulesFor({}), "title_present").status).toBe("pass");
    const within = ruleOf(rulesFor({}), "title_within_limit");
    expect(within.status).toBe("pass");
    expect(within.actual).toContain("/ 100 characters");
  });
  test("a 101-character title fails the limit (the platform truncates)", () => {
    const r = ruleOf(rulesFor({ title: "x".repeat(101) }), "title_within_limit");
    expect(r.status).toBe("fail");
    expect(r.detail).toContain("Over by 1 character");
  });
  test("no title fails 'present' and reports the LIMIT as unknown, not as a pass", () => {
    expect(ruleOf(rulesFor({ title: null }), "title_present").status).toBe("fail");
    const within = ruleOf(rulesFor({ title: null }), "title_within_limit");
    expect(within.status).toBe("unknown");
    expect(within.actual).toContain("no title text exists");
  });
  test("an over-long description fails; a missing one is unknown for the limit and a warning for presence", () => {
    expect(ruleOf(rulesFor({ description: "d".repeat(5_001) }), "description_within_limit").status).toBe("fail");
    const missing = ruleOf(rulesFor({ description: null }), "description_within_limit");
    expect(missing.status).toBe("unknown");
    expect(ruleOf(rulesFor({ description: null }), "description_present").status).toBe("fail");
    expect(ruleOf(rulesFor({ description: null }), "description_present").severity).toBe("recommended");
  });
  test("tags over YouTube's 500-character total fail the limit", () => {
    const over = ruleOf(rulesFor({ tags: ["t".repeat(300), "t".repeat(300)] }), "tags_within_limit");
    expect(over.status).toBe("fail");
    expect(over.actual).toContain("/ 500 characters");
    expect(ruleOf(rulesFor({ tags: ["one"] }), "tags_within_limit").status).toBe("pass");
  });
  test("tags count is checked where the platform publishes one (Instagram's 30)", () => {
    const reels = findPublishTarget("instagram-reels")!;
    const many = Array.from({ length: 31 }, (_, i) => `t${i}`);
    const r = ruleOf(rulesFor({ tags: many }, reels), "tags_within_limit");
    expect(r.status).toBe("fail");
    expect(r.actual).toContain("31 / 30 tags");
  });
  test("a target with no tag limit the app can verify reports unknown", () => {
    const tiktok = findPublishTarget("tiktok")!;
    const r = ruleOf(rulesFor({ tags: ["one"] }, tiktok), "tags_within_limit");
    expect(r.status).toBe("unknown");
    expect(r.detail).toContain("no tag length or tag count limit this app can verify");
  });
  test("a surface with no title field reports the title limit as not verifiable", () => {
    const reels = findPublishTarget("instagram-reels")!;
    const rules = rulesFor({}, reels);
    expect(rules.some((r) => r.id === "title_present")).toBe(false);
    const r = ruleOf(rules, "title_within_limit");
    expect(r.status).toBe("unknown");
    expect(r.actual).toContain("not verifiable on this surface");
  });
});

describe("rule: platform policy, quality and duplicate content (gated)", () => {
  test("always UNKNOWN, carrying the honest gate and naming the env var (name only)", () => {
    const r = ruleOf(checkTargetReadiness(LONG_FORM, readyInput()).rules, "policy_and_quality");
    expect(r.status).toBe("unknown");
    expect(r.gate).toBeDefined();
    expect(r.gate!.connected).toBe(false);
    expect(r.gate!.capability).toBe("media_analysis");
    expect(r.gate!.requiredEnv).toEqual([READINESS_MEDIA_ANALYSIS_ENV]);
    expect(r.gate!.envHint).toBe("MEDIA_ANALYSIS_API_KEY");
    expect(r.gate!.note).toContain("MEDIA_ANALYSIS_API_KEY");
    expect(r.detail).toContain("not wired");
    expect(JSON.stringify(r)).not.toContain("sk-");
  });
  test("it is recommended, so it never blocks a verdict on its own", () => {
    expect(ruleOf(checkTargetReadiness(LONG_FORM, readyInput()).rules, "policy_and_quality").severity).toBe("recommended");
  });
  test("the gate names no secret value anywhere", () => {
    const gate = readinessMediaAnalysisGate("Checking a thing");
    expect(gate.requiredEnv).toEqual(["MEDIA_ANALYSIS_API_KEY"]);
    expect(gate.envHint).toBe("MEDIA_ANALYSIS_API_KEY");
  });
});

describe("the verdict — states, never scores", () => {
  test("every required rule passing is 'ready'", () => {
    const report = checkTargetReadiness(LONG_FORM, readyInput());
    expect(report.verdict).toBe("ready");
    expect(report.blockingFailures).toEqual([]);
    expect(report.unknownRequired).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(report.counts.total).toBe(report.rules.length);
    expect(report.counts.pass + report.counts.fail + report.counts.unknown).toBe(report.rules.length);
  });
  test("a failed required rule is 'not_ready' and is named", () => {
    const report = checkTargetReadiness(findPublishTarget("youtube-shorts")!, readyInput({ durationSeconds: 900 }));
    expect(report.verdict).toBe("not_ready");
    expect(report.blockingFailures).toContain("duration_within_limit");
  });
  test("an unknown required rule is 'indeterminate', never 'ready'", () => {
    const report = checkTargetReadiness(LONG_FORM, readyInput({ appliedPresetIds: [] }));
    expect(report.verdict).toBe("indeterminate");
    expect(report.unknownRequired).toContain("export_preset_applied");
  });
  test("only recommended rules failing is 'ready_with_warnings'", () => {
    const report = checkTargetReadiness(
      LONG_FORM,
      readyInput({ thumbnail: { present: false, assetName: null, detail: "no thumbnail asset exists for this project" } }),
    );
    expect(report.verdict).toBe("ready_with_warnings");
    expect(report.warnings).toContain("thumbnail_present");
  });
  test("a blocking failure outranks an unknown", () => {
    const report = checkTargetReadiness(LONG_FORM, readyInput({ appliedPresetIds: [], durationSeconds: 43_201 }));
    expect(report.verdict).toBe("not_ready");
    expect(report.blockingFailures).toContain("duration_within_limit");
    expect(report.unknownRequired).toContain("export_preset_applied");
  });
  test("readinessVerdict is a pure function of the rules", () => {
    const rules: RuleResult[] = [];
    expect(readinessVerdict(rules).verdict).toBe("ready");
  });
  test("no report carries a percentage, score or confidence field", () => {
    const report = checkTargetReadiness(LONG_FORM, readyInput({ durationSeconds: 43_201 }));
    const keys = Object.keys(report);
    for (const forbidden of ["score", "percentage", "confidence", "rating", "grade"]) {
      expect(keys).not.toContain(forbidden);
    }
    expect(JSON.stringify(report)).not.toMatch(/"(score|percentage|confidence|rating)":/);
  });
});

describe("checkPublishReadiness across targets", () => {
  test("one report per requested target, in canonical order", () => {
    const reports = checkPublishReadiness(["tiktok", "youtube-long-form"], readyInput());
    expect(reports.map((r) => r.targetId)).toEqual(["youtube-long-form", "tiktok"]);
  });
  test("the same project reads differently per target — the check is per platform", () => {
    const reports = checkPublishReadiness(["youtube-long-form", "tiktok"], readyInput());
    const long = reports.find((r) => r.targetId === "youtube-long-form")!;
    const tiktok = reports.find((r) => r.targetId === "tiktok")!;
    expect(long.verdict).toBe("ready");
    expect(tiktok.blockingFailures).toContain("aspect_ratio_match");
    expect(tiktok.blockingFailures).toContain("export_preset_applied");
    expect(tiktok.verdict).toBe("not_ready");
  });
  test("an unknown target id is simply not reported (the service rejects it with a 400 first)", () => {
    expect(checkPublishReadiness(["vimeo"] as never, readyInput())).toEqual([]);
  });
});
