import { describe, expect, test } from "bun:test";
import {
  MOMENT_BASIS,
  MOMENT_KINDS,
  MOMENT_LABELS,
  MIN_MOMENT_SCORE,
  analyzeMoments,
  momentUnits,
  numeralsOf,
  sentencesOf,
} from "../moments";
import {
  CLIP_KINDS,
  DEFAULT_TARGETS,
  PLATFORM_TARGETS,
  defaultTargetConfig,
  momentsForTarget,
  targetConfigsEqual,
  validateTargetConfig,
} from "../targets";
import { buildClipPlan, clipStats, clipWindow, flattenClips, planSummary } from "../clips";
import { buildTimelineFromScenes, type SceneInput } from "../../editor/timeline";
import { capabilityConnectivity } from "../../ai/providers/capability-connectivity";

/**
 * Phase 5 Block 5a — the deterministic repurposing ENGINE.
 *
 * Moments, targets and clips are pure, so this file exercises them directly. The
 * invariants that matter:
 *   - the same input always produces byte-identical output, in a stable order;
 *   - every score is the sum of its stated signals (nothing random, nothing
 *     hard-coded per moment) and every candidate says it read the SCRIPT, not
 *     the footage;
 *   - a config really changes counts / durations / selection, and a bad config is
 *     refused with a typed error.
 */

const SCENES: SceneInput[] = [
  {
    id: "s1",
    title: "Intro",
    durationSeconds: 6,
    narration:
      "Why do 90% of documentaries fail in the first minute? You are about to see the method that changed everything.",
  },
  {
    id: "s2",
    title: "Setup",
    durationSeconds: 6,
    narration: "Most creators begin with the wrong question. They write a script and hope the footage follows.",
  },
  {
    id: "s3",
    title: "Discovery",
    durationSeconds: 10,
    narration: "But here is what nobody told you: I lost 40 hours on the first edit, and the reason was simple.",
  },
  {
    id: "s4",
    title: "Quote",
    durationSeconds: 10,
    narration: '"The edit is the film," the editor said. It was the best advice I ever received.',
  },
  {
    id: "s5",
    title: "Numbers",
    durationSeconds: 10,
    narration:
      "We cut the runtime by 62 percent and the retention increased by 3.5 times. It took 1,200 frames of work.",
  },
  {
    id: "s6",
    title: "How to",
    durationSeconds: 10,
    narration:
      "First, map the story beats. Second, learn the pacing rule, because the process means nothing without it.",
  },
];

const TIMELINE = buildTimelineFromScenes(SCENES);

describe("moment analysis — determinism", () => {
  test("identical timeline + scenes produce byte-identical output in a stable order", () => {
    const a = analyzeMoments(TIMELINE, SCENES);
    const b = analyzeMoments(buildTimelineFromScenes(SCENES), SCENES);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // order: score desc, then startMs asc, then id asc
    for (let i = 1; i < a.candidates.length; i += 1) {
      const prev = a.candidates[i - 1];
      const cur = a.candidates[i];
      const ordered =
        prev.score > cur.score ||
        (prev.score === cur.score && prev.startMs < cur.startMs) ||
        (prev.score === cur.score && prev.startMs === cur.startMs && prev.id < cur.id);
      expect(ordered).toBe(true);
    }
  });

  test("the unit list follows the video lane in narrative order", () => {
    const units = momentUnits(TIMELINE, SCENES);
    expect(units.map((u) => u.sceneId)).toEqual(["s1", "s2", "s3", "s4", "s5", "s6"]);
    expect(units[0].startMs).toBe(0);
    expect(units[0].endMs).toBe(6000);
    expect(units[5].endMs).toBe(TIMELINE.durationMs);
    expect(units.every((u) => u.hasNarration)).toBe(true);
    expect(units.every((u) => u.hasVoice)).toBe(true);
  });
});

describe("moment analysis — scores are the sum of their stated signals", () => {
  test("every candidate's score is the clamped sum of its signal points", () => {
    const analysis = analyzeMoments(TIMELINE, SCENES);
    expect(analysis.candidates.length).toBeGreaterThan(0);
    for (const c of analysis.candidates) {
      const sum = c.signals.reduce((n, s) => n + s.points, 0);
      expect(c.score).toBe(Math.min(100, sum));
      expect(c.score).toBeGreaterThanOrEqual(MIN_MOMENT_SCORE);
      expect(c.score).toBeLessThanOrEqual(100);
      for (const s of c.signals) {
        expect(s.points).toBeGreaterThan(0);
        expect(s.signal.length).toBeGreaterThan(0);
        expect(s.detail.length).toBeGreaterThan(0);
        expect(c.reason).toContain(s.detail);
      }
    }
  });

  test("every candidate is honest about its basis and never claims to have watched the footage", () => {
    const analysis = analyzeMoments(TIMELINE, SCENES);
    for (const c of analysis.candidates) {
      expect(c.watchedFootage).toBe(false);
      expect(c.basis).toBe(MOMENT_BASIS);
      expect(c.reason).toContain(MOMENT_BASIS);
      expect(c.reason).toContain("no statistic was invented");
      expect(c.reason).toContain(`${c.score}/100`);
    }
    expect(analysis.basis).toBe(MOMENT_BASIS);
    expect(analysis.note).toContain("no transcript");
    /*
     * The note's provider half is DERIVED, not a fixed claim about this server:
     * it must carry the live registry reason for both capabilities a real
     * analysis would need, and must never print the old hard-coded sentence
     * (which could contradict /api/ai/status on a keyed server).
     */
    expect(analysis.note).toContain(capabilityConnectivity("speech_recognition").reason);
    expect(analysis.note).toContain(capabilityConnectivity("scene_detection").reason);
    expect(analysis.note).not.toContain("no provider is connected");
    expect(analysis.note).not.toContain("no provider key is set");
  });

  test("the scores are computed from the script: different text moves the numbers", () => {
    const quiet: SceneInput[] = [
      { id: "q1", title: "Quiet", durationSeconds: 10, narration: "The room was quiet and nothing happened at all." },
      { id: "q2", title: "Quiet 2", durationSeconds: 10, narration: "Then the afternoon continued without any event." },
    ];
    const loud: SceneInput[] = [
      { id: "q1", title: "Loud", durationSeconds: 10, narration: "We cut it by 62% — I lost 40 hours, and I was terrified." },
      { id: "q2", title: "Loud 2", durationSeconds: 10, narration: "But nobody told you: it was the best decision ever!" },
    ];
    const quietAnalysis = analyzeMoments(buildTimelineFromScenes(quiet), quiet);
    const loudAnalysis = analyzeMoments(buildTimelineFromScenes(loud), loud);
    const quietTop = quietAnalysis.candidates[0]?.score ?? 0;
    const loudTop = loudAnalysis.candidates[0]?.score ?? 0;
    expect(loudTop).toBeGreaterThan(quietTop);

    const statCandidate = loudAnalysis.candidates.find((c) => c.kind === "stat");
    expect(statCandidate).toBeDefined();
    // The exact numeral from the script is quoted in the reason.
    expect(statCandidate?.reason).toContain("62");
    expect(statCandidate?.reason).toContain("percentage");
  });

  test("a timeline with no narration still yields structural candidates only, and never invents text", () => {
    const silent: SceneInput[] = [
      { id: "n1", title: "Silent", durationSeconds: 5, narration: null },
      { id: "n2", title: "Silent 2", durationSeconds: 5, narration: "" },
    ];
    const analysis = analyzeMoments(buildTimelineFromScenes(silent), silent);
    expect(analysis.totals.structuralOnlyUnits).toBe(2);
    expect(analysis.totals.narratedUnits).toBe(0);
    for (const c of analysis.candidates) {
      expect(c.kind).toBe("hook"); // only the structural kind can fire without text
      expect(c.text).toBe("");
    }
  });

  test("an empty timeline reports zero candidates and says why", () => {
    const analysis = analyzeMoments({ version: 1, durationMs: 0, clips: [] }, []);
    expect(analysis.candidates).toEqual([]);
    expect(analysis.candidateCount).toBe(0);
    expect(analysis.note).toContain("video lane is empty");
  });
});

describe("moment analysis — classification", () => {
  test("all six kinds are found in a script that really contains them", () => {
    const analysis = analyzeMoments(TIMELINE, SCENES);
    const kinds = new Set(analysis.candidates.map((c) => c.kind));
    for (const kind of MOMENT_KINDS) expect(kinds.has(kind)).toBe(true);
    for (const kind of MOMENT_KINDS) expect(analysis.countsByKind[kind]).toBeGreaterThan(0);
    expect(Object.keys(MOMENT_LABELS).sort()).toEqual([...MOMENT_KINDS].sort());
  });

  test("a hook candidate can only sit in the opening window", () => {
    const analysis = analyzeMoments(TIMELINE, SCENES);
    const hooks = analysis.candidates.filter((c) => c.kind === "hook");
    expect(hooks.length).toBeGreaterThan(0);
    for (const hook of hooks) {
      expect(hook.startMs).toBeLessThanOrEqual(TIMELINE.durationMs * 0.2 + 1);
    }
    // The stat moment is in scene 5 and must never be classified as a hook.
    expect(analysis.candidates.some((c) => c.kind === "stat" && c.sceneId === "s5")).toBe(true);
  });

  test("the quote kind is driven by real quotation marks and attribution", () => {
    const analysis = analyzeMoments(TIMELINE, SCENES);
    const quote = analysis.candidates.find((c) => c.kind === "quote");
    expect(quote).toBeDefined();
    expect(quote?.sceneId).toBe("s4");
    const signals = (quote?.signals ?? []).map((s) => s.signal);
    expect(signals).toContain("quoted-text");
    expect(signals).toContain("attribution");
  });

  test("the candidate limit is reported honestly when it bites", () => {
    const analysis = analyzeMoments(TIMELINE, SCENES);
    expect(analysis.candidates.length).toBeLessThanOrEqual(40); // MOMENT_CANDIDATE_LIMIT
    expect(analysis.candidateCount).toBeGreaterThanOrEqual(analysis.candidates.length);
  });

  test("helpers do what the reasons claim", () => {
    expect(numeralsOf("62 percent of 1,200 frames in 3.5 times")).toEqual(["62", "1,200", "3.5"]);
    expect(sentencesOf("One. Two! Three? Four")).toEqual(["One.", "Two!", "Three?", "Four"]);
  });
});

/* ------------------------------------------------------------------ */
/* Platform targets + clip windows                                     */
/* ------------------------------------------------------------------ */

describe("platform targets — defaults, validation, application", () => {
  test("the defaults are the plan's shape: 10 shorts / 5 reels / 5 tiktoks", () => {
    const config = defaultTargetConfig();
    expect(config.targets.shorts.count).toBe(10);
    expect(config.targets.reels.count).toBe(5);
    expect(config.targets.tiktoks.count).toBe(5);
    for (const target of PLATFORM_TARGETS) {
      expect(config.targets[target].enabled).toBe(true);
      expect(config.targets[target].maxSeconds).toBeGreaterThan(config.targets[target].minSeconds);
      expect(config.targets[target].kinds.length).toBeGreaterThan(0);
    }
    expect(DEFAULT_TARGETS.shorts.count).toBe(10);
  });

  test("a partial config merges over the defaults and reports which targets were supplied", () => {
    const result = validateTargetConfig({ shorts: { count: 3, minSeconds: 30, maxSeconds: 45 } });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.supplied).toEqual(["shorts"]);
    expect(result.config.targets.shorts.count).toBe(3);
    expect(result.config.targets.shorts.minSeconds).toBe(30);
    expect(result.config.targets.shorts.maxSeconds).toBe(45);
    expect(result.config.targets.reels.count).toBe(5); // untouched default
  });

  test("bad configs are refused with typed errors naming what was expected", () => {
    const cases: { input: unknown; code: string }[] = [
      { input: { youtube: { count: 3 } }, code: "unknown_target" },
      { input: { shorts: { count: 0 } }, code: "invalid_count" },
      { input: { shorts: { count: 2.5 } }, code: "invalid_count" },
      { input: { shorts: { count: 999 } }, code: "invalid_count" },
      { input: { shorts: { minSeconds: 60, maxSeconds: 30 } }, code: "invalid_duration_window" },
      { input: { shorts: { minSeconds: 1 } }, code: "invalid_duration_window" },
      { input: { shorts: { maxSeconds: 5000 } }, code: "invalid_duration_window" },
      { input: { shorts: { kinds: [] } }, code: "invalid_kinds" },
      { input: { shorts: { kinds: ["funny"] } }, code: "unknown_clip_kind" },
      { input: { shorts: "nope" }, code: "invalid_config" },
      { input: [], code: "invalid_config" },
    ];
    for (const { input, code } of cases) {
      const result = validateTargetConfig(input);
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.code).toBe(code);
      expect(result.error.length).toBeGreaterThan(0);
      expect(result.note.length).toBeGreaterThan(0);
    }
    // A valid config is accepted, and an absent one falls back to the defaults.
    expect(validateTargetConfig({ tiktoks: { count: 4, kinds: ["educational"] } }).ok).toBe(true);
    const none = validateTargetConfig(undefined);
    expect(none.ok).toBe(true);
    if (none.ok) expect(targetConfigsEqual(none.config, defaultTargetConfig())).toBe(true);
  });

  test("clip kinds map onto the moment kinds explicitly", () => {
    expect(momentsForTarget(DEFAULT_TARGETS.shorts)).toEqual([
      "hook",
      "emotional",
      "surprise",
      "quote",
      "stat",
      "informative",
    ]);
    expect(momentsForTarget({ enabled: true, count: 2, minSeconds: 5, maxSeconds: 30, kinds: ["quote"] })).toEqual(["quote"]);
    expect(CLIP_KINDS).toEqual(["quote", "highlight", "educational"]);
  });
});

describe("clip candidates — windows, selection, config sensitivity", () => {
  const config = defaultTargetConfig();
  const moments = analyzeMoments(TIMELINE, SCENES).candidates;

  test("identical inputs give an identical plan", () => {
    const a = buildClipPlan(moments, TIMELINE, config);
    const b = buildClipPlan(analyzeMoments(TIMELINE, SCENES).candidates, TIMELINE, defaultTargetConfig());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.totalClips).toBeGreaterThan(0);
    expect(planSummary(a).length).toBe(3);
  });

  test("every clip is a real, whole-second window inside the timeline", () => {
    const plan = buildClipPlan(moments, TIMELINE, config);
    for (const target of plan.targets) {
      for (const clip of target.clips) {
        expect(clip.startMs).toBeGreaterThanOrEqual(0);
        expect(clip.endMs).toBeLessThanOrEqual(TIMELINE.durationMs);
        expect(clip.startMs % 1000).toBe(0);
        expect(clip.durationMs).toBe(clip.endMs - clip.startMs);
        expect(clip.durationMs).toBeGreaterThanOrEqual(target.minSeconds * 1000);
        expect(clip.durationMs).toBeLessThanOrEqual(target.maxSeconds * 1000);
        expect(clip.aspect).toBe("9:16");
        expect(clip.reason).toContain("no statistic was invented");
        expect(clip.label.length).toBeGreaterThan(0);
        expect(Number.isInteger(clip.sourceClips)).toBe(true);
        expect(clip.scenes.every((s) => SCENES.some((scene) => scene.id === s))).toBe(true);
      }
      // no two clips in a target overlap
      for (let i = 0; i < target.clips.length; i += 1) {
        for (let j = i + 1; j < target.clips.length; j += 1) {
          const a = target.clips[i];
          const b = target.clips[j];
          expect(a.startMs < b.endMs && b.startMs < a.endMs).toBe(false);
        }
      }
      expect(target.clips.length).toBeLessThanOrEqual(target.count);
    }
  });

  test("a real config change changes the counts, the durations and the selection", () => {
    // The 52s TIMELINE above is genuinely too short to hold two non-overlapping
    // 30-40s windows, so the config-sensitivity assertions run against a
    // long-form source (6 × 30s = 180s — the shape this feature exists for).
    const longScenes: SceneInput[] = SCENES.map((s) => ({ ...s, durationSeconds: 30 }));
    const longTimeline = buildTimelineFromScenes(longScenes);
    expect(longTimeline.durationMs).toBe(180_000);
    const longMoments = analyzeMoments(longTimeline, longScenes).candidates;

    const wide = buildClipPlan(longMoments, longTimeline, config);
    const narrowRequest = validateTargetConfig({
      shorts: { count: 2, minSeconds: 30, maxSeconds: 40 },
      reels: { enabled: false },
      tiktoks: { count: 1, minSeconds: 9, maxSeconds: 12, kinds: ["educational"] },
    });
    expect(narrowRequest.ok).toBe(true);
    if (!narrowRequest.ok) return;
    const narrow = buildClipPlan(longMoments, longTimeline, narrowRequest.config);

    const wideShorts = wide.targets.find((t) => t.target === "shorts");
    const narrowShorts = narrow.targets.find((t) => t.target === "shorts");
    expect(narrowShorts?.count).toBe(2);
    expect(narrowShorts?.produced).toBe(2); // the count is honoured when the window fits
    expect(narrowShorts?.produced).toBeLessThan(wideShorts?.produced as number);
    expect(wideShorts?.produced).toBeGreaterThan(2);
    for (const clip of narrowShorts?.clips ?? []) {
      expect(clip.durationMs).toBeGreaterThanOrEqual(30_000);
      expect(clip.durationMs).toBeLessThanOrEqual(40_000);
    }
    // A disabled target produces nothing and says so.
    const narrowReels = narrow.targets.find((t) => t.target === "reels");
    expect(narrowReels?.enabled).toBe(false);
    expect(narrowReels?.produced).toBe(0);
    // A kinds filter restricts the selection to the educational moment kinds.
    const narrowTiktok = narrow.targets.find((t) => t.target === "tiktoks");
    expect(narrowTiktok?.kinds).toEqual(["educational"]);
    expect(narrowTiktok?.produced).toBe(1);
    for (const clip of narrowTiktok?.clips ?? []) {
      expect(["stat", "informative"]).toContain(clip.momentKind);
      expect(clip.clipKind).toBe("educational");
      expect(clip.durationMs).toBeGreaterThanOrEqual(9_000);
      expect(clip.durationMs).toBeLessThanOrEqual(12_000);
    }
    expect(wide.totalClips).toBeGreaterThan(narrow.totalClips);
  });

  test("a window too wide for the timeline is reported as a shortfall, never overlapped", () => {
    // 52s of footage cannot hold two non-overlapping 30-40s clips. The engine
    // returns one and COUNTS the candidates it skipped — it never overlaps
    // windows to reach the requested count.
    const request = validateTargetConfig({ shorts: { count: 2, minSeconds: 30, maxSeconds: 40 } });
    if (!request.ok) throw new Error("fixture config must be valid");
    const plan = buildClipPlan(moments, TIMELINE, request.config);
    const shorts = plan.targets.find((t) => t.target === "shorts");
    expect(shorts?.count).toBe(2);
    expect(shorts?.produced).toBe(1);
    expect(shorts?.skippedOverlap).toBeGreaterThan(0);
    expect(shorts?.note).toContain("skipped");
    expect(shorts?.note).toContain("1/2 clip(s) selected");
    // The one clip it did produce is a real whole-second window in the window.
    const clip = shorts?.clips[0];
    expect(clip?.startMs).toBe(0);
    expect(clip?.endMs).toBe(30_000);
    expect(clip?.durationMs).toBeGreaterThanOrEqual(30_000);
    expect(clip?.durationMs).toBeLessThanOrEqual(40_000);
  });

  test("clipWindow centres on the moment, honours the window and stays inside the timeline", () => {
    const moment = moments.find((m) => m.kind === "stat") ?? moments[0];
    const spec = { enabled: true, count: 1, minSeconds: 30, maxSeconds: 40, kinds: ["educational"] as const };
    const window = clipWindow(moment, { ...spec, kinds: [...spec.kinds] }, TIMELINE.durationMs);
    expect(window.durationMs).toBeGreaterThanOrEqual(30_000);
    expect(window.durationMs).toBeLessThanOrEqual(40_000);
    expect(window.startMs).toBeGreaterThanOrEqual(0);
    expect(window.endMs).toBeLessThanOrEqual(TIMELINE.durationMs);

    // A moment at the very start clamps to 0 rather than going negative.
    const first = { ...moment, startMs: 0, endMs: 1000, durationMs: 1000 };
    const atStart = clipWindow(first, { ...spec, kinds: [...spec.kinds] }, TIMELINE.durationMs);
    expect(atStart.startMs).toBe(0);

    // A timeline shorter than the wanted window uses the whole timeline.
    const short = clipWindow(first, { ...spec, kinds: [...spec.kinds] }, 5000);
    expect(short.startMs).toBe(0);
    expect(short.endMs).toBe(5000);
  });

  test("flatten and stats agree with the per-target plans", () => {
    const plan = buildClipPlan(moments, TIMELINE, config);
    const flat = flattenClips(plan);
    expect(flat.length).toBe(plan.totalClips);
    const stats = clipStats(flat);
    expect(stats.total).toBe(flat.length);
    expect(Object.values(stats.byTarget).reduce((a, b) => a + b, 0)).toBe(flat.length);
    expect(stats.totalMs).toBe(flat.reduce((n, c) => n + c.durationMs, 0));
  });
});
