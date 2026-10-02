import { describe, expect, test } from "bun:test";
import { buildDuckingSchedule, voicePlanToTiming } from "../ducking";
import { directVoice } from "../../voice/director";

/**
 * Phase 4 Block 2 — Music ducking scheduler tests (deterministic layer).
 * Rules under test: narration active → music lowered (-duckedDepthDb dB);
 * narration pause → music rises to 0 dB; music-only regions labelled.
 */
describe("ducking mix defaults", () => {
  test("mix defaults: volume 0.7, depth 6 dB, fades set", () => {
    const s = buildDuckingSchedule({ voicePlan: { segments: [{ startMs: 0, endMs: 1000 }] } });
    expect(s.mix.musicVolume).toBe(0.7);
    expect(s.mix.duckedDepthDb).toBe(6);
    expect(s.mix.fadeInMs).toBe(600);
    expect(s.mix.fadeOutMs).toBe(1200);
  });

  test("custom depth, volume and fades are honored", () => {
    const s = buildDuckingSchedule({
      voicePlan: { segments: [{ startMs: 0, endMs: 1000 }] },
      musicVolume: 0.4,
      duckedDepthDb: 10,
      fadeInMs: 200,
      fadeOutMs: 900,
    });
    expect(s.mix.musicVolume).toBe(0.4);
    expect(s.mix.duckedDepthDb).toBe(10);
    expect(s.mix.fadeInMs).toBe(200);
    expect(s.mix.fadeOutMs).toBe(900);
  });

  test("depth is clamped into a sane range", () => {
    const s = buildDuckingSchedule({
      voicePlan: { segments: [{ startMs: 0, endMs: 1000 }] },
      duckedDepthDb: -99,
    });
    expect(Math.abs(s.mix.duckedDepthDb)).toBeGreaterThanOrEqual(3);
    expect(Math.abs(s.mix.duckedDepthDb)).toBeLessThanOrEqual(20);
  });
});

describe("ducking reasons", () => {
  test("narrating lowers music to -duckedDepthDb dB", () => {
    const s = buildDuckingSchedule({
      voicePlan: { segments: [{ startMs: 0, endMs: 3000 }] },
      musicSegments: [{ startMs: 0, endMs: 5000 }],
    });
    const narrating = s.ducking.find((e) => e.reason === "narrating");
    expect(narrating).toBeDefined();
    expect(narrating!.dB).toBe(-6);
    expect(narrating!.startMs).toBe(0);
    expect(narrating!.endMs).toBe(3000);
  });

  test("gap between voice segments raises music to 0 dB (pause)", () => {
    const s = buildDuckingSchedule({
      voicePlan: { segments: [{ startMs: 0, endMs: 3000 }, { startMs: 4000, endMs: 7000 }] },
      musicSegments: [{ startMs: 0, endMs: 8000 }],
    });
    const pause = s.ducking.find((e) => e.reason === "pause");
    expect(pause).toBeDefined();
    expect(pause!.dB).toBe(0);
    expect(pause!.startMs).toBe(3000);
    expect(pause!.endMs).toBe(4000);
  });

  test("music continuing past the last narration block is music-only at 0 dB", () => {
    const s = buildDuckingSchedule({
      voicePlan: { segments: [{ startMs: 0, endMs: 3000 }] },
      musicSegments: [{ startMs: 0, endMs: 8000 }],
    });
    const only = s.ducking.find((e) => e.reason === "music-only");
    expect(only).toBeDefined();
    expect(only!.dB).toBe(0);
    expect(only!.startMs).toBe(3000);
    expect(only!.endMs).toBe(8000);
  });

  test("full-timeline default bed yields narrating + music-only from 0", () => {
    const s = buildDuckingSchedule({ voicePlan: { segments: [{ startMs: 1000, endMs: 4000 }] } });
    expect(s.ducking[0].reason).toBe("music-only");
    expect(s.ducking[0].startMs).toBe(0);
    expect(s.ducking[0].endMs).toBe(1000);
    const reasons = s.ducking.map((e) => e.reason);
    expect(reasons).toContain("narrating");
  });

  test("silent regions (no voice, no music) emit no entry", () => {
    const s = buildDuckingSchedule({
      voicePlan: { segments: [{ startMs: 0, endMs: 3000 }] },
      musicSegments: [{ startMs: 0, endMs: 2000 }, { startMs: 6000, endMs: 9000 }],
    });
    expect(s.ducking.some((e) => e.startMs >= 3000 && e.endMs <= 6000)).toBe(false);
    // The music-only tail still appears after 6000.
    expect(s.ducking.some((e) => e.reason === "music-only" && e.startMs === 6000)).toBe(true);
  });

  test("adjacent voice segments merge into one narrating region (no phantom pause)", () => {
    const s = buildDuckingSchedule({
      voicePlan: { segments: [{ startMs: 0, endMs: 3000 }, { startMs: 3000, endMs: 6000 }] },
    });
    expect(s.ducking.filter((e) => e.reason === "narrating")).toHaveLength(1);
    expect(s.ducking.filter((e) => e.reason === "pause")).toHaveLength(0);
  });
});

describe("ducking with a DirectedVoicePlan", () => {
  test("voicePlanToTiming places segments sequentially with pause gaps", () => {
    const plan = directVoice("Welcome back. This discovery is absolutely huge!");
    const { segments, totalMs } = voicePlanToTiming(plan);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    expect(totalMs).toBeGreaterThan(segments[segments.length - 1].endMs);
    for (const seg of segments) {
      expect(seg.endMs).toBeGreaterThan(seg.startMs);
      expect(seg.startMs).toBeGreaterThanOrEqual(0);
    }
  });

  test("director-derived schedule contains narrating + pause", () => {
    const plan = directVoice("Ready. Set. Launch the mission now!");
    const s = buildDuckingSchedule({ voicePlan: plan });
    const reasons = s.ducking.map((e) => e.reason);
    expect(reasons).toContain("narrating");
    expect(reasons).toContain("pause");
    expect(s.timingModel).toContain("ESTIMATE");
  });

  test("explicit timing labels the model EXPLICIT", () => {
    const s = buildDuckingSchedule({ voicePlan: { segments: [{ startMs: 0, endMs: 1000 }] } });
    expect(s.timingModel).toContain("EXPLICIT");
  });
});

describe("ducking determinism & shape", () => {
  test("identical input yields identical schedule", () => {
    const input = {
      voicePlan: { segments: [{ startMs: 0, endMs: 3000 }, { startMs: 4000, endMs: 7000 }] },
      musicSegments: [{ startMs: 0, endMs: 9000 }],
      duckedDepthDb: 8,
    };
    expect(JSON.stringify(buildDuckingSchedule(input))).toBe(JSON.stringify(buildDuckingSchedule(input)));
  });

  test("events are chronological and non-overlapping", () => {
    const s = buildDuckingSchedule({
      voicePlan: { segments: [{ startMs: 1000, endMs: 2500 }, { startMs: 3000, endMs: 5000 }] },
      musicSegments: [{ startMs: 0, endMs: 8000 }],
    });
    for (let i = 1; i < s.ducking.length; i++) {
      expect(s.ducking[i].startMs).toBeGreaterThanOrEqual(s.ducking[i - 1].endMs);
      expect(s.ducking[i].startMs).toBeGreaterThanOrEqual(s.ducking[i - 1].startMs);
    }
    expect(s.ducking.length).toBeGreaterThanOrEqual(3); // lead, narrating×2, pause, tail
  });

  test("empty voice plan produces an empty schedule", () => {
    const s = buildDuckingSchedule({ voicePlan: { segments: [] } });
    expect(s.ducking).toEqual([]);
    expect(s.mix.duckedDepthDb).toBe(6);
  });
});