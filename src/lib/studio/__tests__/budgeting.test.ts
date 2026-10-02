import { describe, expect, test } from "bun:test";
import { buildPlan, validateDurationForFormat, validatePlan, sceneSum, clipSum, allowedDurationOptions } from "../budgeting";
import { STRUCTURES } from "../structures";
import { VIDEO_FORMATS, DURATION_OPTIONS, type VideoFormat } from "../types";

const FORMAT_RANGES: Record<VideoFormat, [number, number]> = {
  LONG: [60, 7200],
  SHORT: [15, 180],
  SOCIAL: [15, 300],
};

describe("budgeting: exact-sum property", () => {
  for (const format of VIDEO_FORMATS) {
    for (const duration of DURATION_OPTIONS) {
      const [min, max] = FORMAT_RANGES[format];
      if (duration < min || duration > max) continue;
      test(`sum is exactly ${duration}s for ${format} at ${duration}s across all structures`, () => {
        for (const s of STRUCTURES) {
          const plan = buildPlan({ durationSeconds: duration, format, structureId: s.id });
          expect(plan.totalDurationSeconds).toBe(duration);
          expect(sceneSum(plan)).toBe(duration);
          expect(validatePlan(plan).ok).toBe(true);
          // chapter durations sum to total too
          const chSum = plan.chapters.reduce((a, c) => a + c.durationSeconds, 0);
          expect(chSum).toBe(duration);
          // every scene's clips sum to the scene duration
          for (const ch of plan.chapters) {
            for (const sc of ch.scenes) {
              expect(clipSum(sc)).toBe(sc.durationSeconds);
              expect(sc.durationSeconds).toBeGreaterThanOrEqual(1);
            }
          }
          // hook beat opens, ending/CTA closes
          expect(plan.chapters[0].beatIds).toContain(plan.structure.beats[0].id);
          expect(plan.chapters[plan.chapters.length - 1].beatIds).toContain(
            plan.structure.beats[plan.structure.beats.length - 1].id,
          );
        }
      });
    }
  }
});

describe("budgeting: validation", () => {
  test("rejects out-of-range durations per format", () => {
    expect(validateDurationForFormat(15, "LONG").ok).toBe(false);
    expect(validateDurationForFormat(300, "SHORT").ok).toBe(false);
    expect(validateDurationForFormat(600, "SOCIAL").ok).toBe(false);
    expect(validateDurationForFormat(60, "LONG").ok).toBe(true);
    expect(validateDurationForFormat(180, "SHORT").ok).toBe(true);
    expect(validateDurationForFormat(300, "SOCIAL").ok).toBe(true);
    expect(validateDurationForFormat(12.5, "SOCIAL").ok).toBe(false);
  });

  test("allowed duration options match format ranges", () => {
    for (const format of VIDEO_FORMATS) {
      const [min, max] = FORMAT_RANGES[format];
      for (const d of allowedDurationOptions(format)) {
        expect(d).toBeGreaterThanOrEqual(min);
        expect(d).toBeLessThanOrEqual(max);
      }
    }
    expect(allowedDurationOptions("LONG")).not.toContain(15);
    expect(allowedDurationOptions("LONG")).toContain(7200);
    expect(allowedDurationOptions("SHORT")).toContain(15);
    expect(allowedDurationOptions("SHORT")).not.toContain(300);
  });

  test("buildPlan throws on invalid duration", () => {
    expect(() => buildPlan({ durationSeconds: 15, format: "LONG" })).toThrow();
    expect(() => buildPlan({ durationSeconds: 99999, format: "SOCIAL" })).toThrow();
  });
});

describe("budgeting: structure shape", () => {
  test("short videos get compressed arcs but keep hook + ending", () => {
    const plan = buildPlan({ durationSeconds: 15, format: "SHORT", structureId: "hook-problem-solution" });
    expect(plan.chapterCount).toBeGreaterThanOrEqual(1);
    const hookBeatId = plan.structure.beats[0].id;
    const endingBeatId = plan.structure.beats[plan.structure.beats.length - 1].id;
    expect(plan.chapters[0].beatIds).toContain(hookBeatId);
    expect(plan.chapters[plan.chapters.length - 1].beatIds).toContain(endingBeatId);
    // 15s compressed arc: fewer beats than the full structure.
    const allBeatIds = plan.chapters.flatMap((c) => c.beatIds);
    expect(allBeatIds.length).toBeLessThan(plan.structure.beats.length);
  });

  test("long videos keep all beats", () => {
    const plan = buildPlan({ durationSeconds: 3600, format: "LONG", structureId: "hook-problem-solution" });
    expect(plan.chapterCount).toBe(plan.structure.beats.length);
  });

  test("heuristic structure selection works without an explicit id", () => {
    const plan = buildPlan({ durationSeconds: 300, format: "LONG", topic: "top 10 ways to save money" });
    expect(plan.structure.id).toBe("listicle");
    const plan2 = buildPlan({ durationSeconds: 300, format: "LONG", topic: "the history of the roman empire" });
    expect(plan2.structure.id).toBe("timeline");
  });

  test("deterministic: same input → same plan", () => {
    const a = buildPlan({ durationSeconds: 600, format: "LONG", structureId: "mystery" });
    const b = buildPlan({ durationSeconds: 600, format: "LONG", structureId: "mystery" });
    expect(a).toEqual(b);
  });
});
