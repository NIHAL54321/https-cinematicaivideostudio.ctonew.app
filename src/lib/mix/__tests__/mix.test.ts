import { describe, expect, test } from "bun:test";
import { blendWithDucking, buildMix, DEFAULT_LOUDNESS_TARGET_LUFS, PEAK_CEILING } from "../engine";
import { buildDuckingSchedule } from "../../music/ducking";

/**
 * Phase 4 Block 3 — Final audio mix engine tests (deterministic layer).
 * Rules under test: exactly the 4 spec tracks (voice/music/sfx/ambient) with
 * independent gains; deterministic gain staging keeps the worst-case peak sum
 * ≤ -1 dBFS and reports positive headroom; loudness estimate + normalized
 * flag; blendWithDucking lowers music during narration and restores it in
 * pauses without mutating the input plan.
 */

describe("track model", () => {
  test("buildMix always returns exactly the 4 spec tracks", () => {
    const mix = buildMix();
    expect(mix.tracks.map((t) => t.id).sort()).toEqual(["ambient", "music", "sfx", "voice"]);
  });

  test("defaults apply when input is empty", () => {
    const mix = buildMix();
    const voice = mix.tracks.find((t) => t.id === "voice")!;
    const music = mix.tracks.find((t) => t.id === "music")!;
    const sfx = mix.tracks.find((t) => t.id === "sfx")!;
    const ambient = mix.tracks.find((t) => t.id === "ambient")!;
    // Defaults are voice 1.0 / music 0.7 / sfx 0.8 / ambient 0.5 — summed they
    // exceed -1 dBFS, so gain staging scales them down proportionally.
    expect(voice.gain).toBeGreaterThan(ambient.gain);
    expect(music.gain).toBeGreaterThan(ambient.gain);
    const [v, m, s, a] = [voice.gain, music.gain, sfx.gain, ambient.gain];
    expect(v + m + s + a).toBeLessThanOrEqual(PEAK_CEILING + 0.001);
  });

  test("independent 0-1 gains are honored and staged", () => {
    const mix = buildMix({ voice: { gain: 1 }, music: { gain: 0.8 }, sfx: {}, ambient: { gain: 0.2 } });
    const voice = mix.tracks.find((t) => t.id === "voice")!.gain;
    const music = mix.tracks.find((t) => t.id === "music")!.gain;
    const ambient = mix.tracks.find((t) => t.id === "ambient")!.gain;
    expect(voice).toBeGreaterThan(music);
    expect(music).toBeGreaterThan(ambient);
  });
});

describe("clipping prevention", () => {
  test("summed peaks above 1.0 → gain staging scales the sum to ≤ -1 dBFS", () => {
    const mix = buildMix({ voice: { gain: 1 }, music: { gain: 0.8 }, sfx: {}, ambient: { gain: 0.2 } });
    const sum = mix.tracks.reduce((total, t) => total + t.gain, 0);
    expect(sum).toBeLessThanOrEqual(PEAK_CEILING + 0.001);
    expect(mix.clipping.prevented).toBe(true);
    expect(mix.clipping.method).toBe("gain-staging");
    expect(mix.clipping.headroomDb).toBeGreaterThan(0);
  });

  test("headroom is positive and roughly 1 dB when staging kicks in", () => {
    const mix = buildMix({ voice: { gain: 1 }, music: { gain: 0.7 }, ambient: { gain: 0.5 } });
    expect(mix.clipping.headroomDb).toBeGreaterThan(0.9);
    expect(mix.clipping.headroomDb).toBeLessThan(1.1);
  });

  test("quiet mixes are untouched (prevented false) with positive headroom", () => {
    // Explicitly zero the other tracks: the engine applies default gains to
    // absent tracks, so a true quiet mix must state zeros for music/sfx/ambient.
    const mix = buildMix({ voice: { gain: 0.2 }, music: { gain: 0 }, sfx: { gain: 0 }, ambient: { gain: 0 } });
    expect(mix.clipping.prevented).toBe(false);
    expect(mix.clipping.headroomDb).toBeGreaterThan(0);
    expect(mix.tracks.find((t) => t.id === "voice")!.gain).toBe(0.2);
  });

  test("extreme input (all four maxed) never exceeds -1 dBFS", () => {
    const mix = buildMix({ voice: { gain: 1 }, music: { gain: 1 }, sfx: { cues: [] }, ambient: { gain: 1 } });
    const sum = mix.tracks.reduce((total, t) => total + t.gain, 0);
    expect(sum).toBeLessThanOrEqual(PEAK_CEILING + 0.001);
    expect(mix.clipping.prevented).toBe(true);
  });
});

describe("loudness", () => {
  test("default target is -14 LUFS with a finite estimate and normalized: true", () => {
    const mix = buildMix({ voice: { gain: 1 }, music: { gain: 0.8 }, sfx: {}, ambient: { gain: 0.2 } });
    expect(mix.loudness.targetLufs).toBe(DEFAULT_LOUDNESS_TARGET_LUFS);
    expect(Number.isFinite(mix.loudness.measuredEstimateLufs)).toBe(true);
    expect(mix.loudness.normalized).toBe(true);
    expect(mix.loudness.model).toContain("ESTIMATE");
  });

  test("custom loudness target is honored", () => {
    const mix = buildMix({ loudnessTarget: -16 });
    expect(mix.loudness.targetLufs).toBe(-16);
  });

  test("louder mixes estimate louder than quieter mixes", () => {
    const hot = buildMix({ voice: { gain: 1 }, music: { gain: 1 }, sfx: { gain: 0.8 }, ambient: { gain: 1 } });
    // Quiet must explicitly zero the other tracks (defaults apply otherwise).
    const quiet = buildMix({ voice: { gain: 0.2 }, music: { gain: 0 }, sfx: { gain: 0 }, ambient: { gain: 0 } });
    expect(hot.loudness.measuredEstimateLufs).toBeGreaterThan(quiet.loudness.measuredEstimateLufs);
  });
});

describe("blendWithDucking", () => {
  function narrationSchedule() {
    return buildDuckingSchedule({
      voicePlan: { segments: [{ startMs: 0, endMs: 3000 }, { startMs: 4000, endMs: 7000 }] },
      musicSegments: [{ startMs: 0, endMs: 8000 }],
      musicVolume: 0.7,
      duckedDepthDb: 6,
    });
  }

  test("lowers music gain during narrating spans and restores it in pauses", () => {
    const mix = buildMix({ music: { gain: 0.7 } });
    const ducked = blendWithDucking(mix, narrationSchedule());
    const music = ducked.tracks.find((t) => t.id === "music")!;
    expect(music.events).toBeDefined();
    const narrating = music.events!.find((e) => e.type === "narrating")!;
    const pause = music.events!.find((e) => e.type === "pause");
    expect(narrating).toBeDefined();
    expect(narrating.gain).toBeLessThan(music.gain);
    const expectedDucked = Math.round(music.gain * Math.pow(10, -6 / 20) * 1000) / 1000;
    expect(narrating.gain).toBeCloseTo(expectedDucked, 3);
    if (pause) expect(pause.gain).toBe(music.gain);
  });

  test("returns a new plan and never mutates the input", () => {
    const mix = buildMix({ music: { gain: 0.7 } });
    const snapshot = JSON.stringify(mix);
    const ducked = blendWithDucking(mix, narrationSchedule());
    expect(JSON.stringify(mix)).toBe(snapshot);
    expect(ducked).not.toBe(mix);
    expect(mix.tracks.find((t) => t.id === "music")!.events).toBeUndefined();
    expect(ducked.tracks.find((t) => t.id === "music")!.events!.length).toBeGreaterThan(0);
  });

  test("with no schedule the plan is returned unchanged", () => {
    const mix = buildMix();
    const out = blendWithDucking(mix);
    expect(out.tracks.map((t) => t.gain)).toEqual(mix.tracks.map((t) => t.gain));
  });

  test("all four track ids survive the blend", () => {
    const mix = buildMix();
    const ducked = blendWithDucking(mix, narrationSchedule());
    expect(ducked.tracks.map((t) => t.id).sort()).toEqual(["ambient", "music", "sfx", "voice"]);
  });
});

describe("summary", () => {
  test("carries an honest message about Phase 5 rendering", () => {
    const mix = buildMix({ voice: { gain: 1 }, music: { gain: 0.8 }, ambient: { gain: 0.2 } });
    expect(mix.summary).toContain("Phase 5");
    expect(mix.summary).toContain("clipping prevented");
  });
});