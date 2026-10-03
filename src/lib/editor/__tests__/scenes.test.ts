import { describe, expect, test } from "bun:test";
import { capabilityEnvHint } from "../../ai/providers/capability-env";
import {
  COLOR_GRADE_HINTS,
  MUSIC_MOODS,
  SCENE_CONTROLS,
  applySceneControl,
  changeMusic,
  changeSubtitle,
  changeTransition,
  energyToGain,
  energyToPace,
  estimateNarrationMs,
  regenerateScene,
  regenerateVisual,
  regenerateVoice,
  restyleScene,
  type SceneControlResult,
} from "../scenes";
import { SUBTITLE_STYLES } from "../../subtitles";
import {
  EditorError,
  buildTimelineFromScenes,
  clipById,
  clipsAt,
  clipsForScene,
  timelinesEqual,
  type SceneInput,
  type Timeline,
} from "../timeline";

/**
 * Phase 5 Block 2 — the seven scene controls.
 *
 * What matters here (and is asserted below):
 *   - every deterministic plan is real, pure and byte-identical for equal input,
 *   - the changelist says exactly what changed,
 *   - every AI-backed control carries an HONEST provider gate
 *     (connected:false + the env var NAMES, never values, never fake media),
 *   - an unknown sceneId is a typed error, not a silent no-op.
 */

const SCENES: SceneInput[] = [
  {
    id: "s1",
    title: "Cold open",
    narration: "This is the opening narration of the film.", // 8 words → 3200ms
    durationSeconds: 5,
    visualPrompt: "A slow dolly over a rain-soaked city at night",
  },
  { id: "s2", title: "The problem", narration: "Now the difficulty appears.", durationSeconds: 6 },
  { id: "s3", title: "The payoff", narration: null, durationSeconds: 4 },
];

/** Two rows share the id space with the timeline, plus one row that does not. */
const ROWS: SceneInput[] = [
  ...SCENES,
  { id: "s9", title: "Only a row", narration: "Not on the timeline yet.", durationSeconds: 3 },
];

function baseTimeline(): Timeline {
  return buildTimelineFromScenes(SCENES);
}

function assertEnvelope(result: SceneControlResult, control: string): void {
  expect(result.control).toBe(control);
  expect(typeof result.sceneId).toBe("string");
  expect(typeof result.changed).toBe("boolean");
  expect(Array.isArray(result.changelist)).toBe(true);
  for (const line of result.changelist) expect(typeof line).toBe("string");
}

describe("scenes — regenerateScene", () => {
  test("re-derives the clips from the Scene row (duration + narration)", () => {
    const t = baseTimeline();
    const longer: SceneInput = { ...SCENES[0], durationSeconds: 9 };
    const res = regenerateScene(t, { sceneId: "s1", scene: longer });
    assertEnvelope(res, "regenerateScene");
    expect(res.changed).toBe(true);
    const video = clipById(res.timeline!, "sc-s1-video")!;
    expect([video.startMs, video.endMs]).toEqual([0, 9000]);
    const voice = clipById(res.timeline!, "sc-s1-voice")!;
    expect([voice.startMs, voice.endMs]).toEqual([0, 9000]);
    // scene 2 is untouched (it starts where scene 1 ends in the ORIGINAL timeline)
    expect(clipById(res.timeline!, "sc-s2-video")!.startMs).toBe(5000);
    expect(res.changelist.some((line) => line.includes("re-timed"))).toBe(true);
  });

  test("adds a voice clip when the narration appears, removes it when it is cleared", () => {
    const t = baseTimeline();
    const added = regenerateScene(t, { sceneId: "s3", scene: { ...SCENES[2], narration: "A brand new line of narration." } });
    expect(added.changed).toBe(true);
    const voice = clipById(added.timeline!, "sc-s3-voice")!;
    expect(voice.trackId).toBe("voice");
    expect(added.changelist.some((line) => line.includes("added sc-s3-voice"))).toBe(true);

    const removed = regenerateScene(added.timeline!, { sceneId: "s3", scene: { ...SCENES[2], narration: "   " } });
    expect(removed.changed).toBe(true);
    expect(clipById(removed.timeline!, "sc-s3-voice")).toBeNull();
    expect(removed.changelist.some((line) => line.includes("removed"))).toBe(true);
  });

  test("is a no-op when the scene already matches its row", () => {
    const t = baseTimeline();
    const res = regenerateScene(t, { sceneId: "s2", scene: SCENES[1] });
    expect(res.changed).toBe(false);
    expect(res.changelist).toEqual([]);
    expect(timelinesEqual(res.timeline!, t)).toBe(true);
  });

  test("unknown sceneId → typed scene_not_found error", () => {
    expect(() => regenerateScene(baseTimeline(), { sceneId: "ghost", scene: ROWS[3] })).toThrow(EditorError);
    try {
      regenerateScene(baseTimeline(), { sceneId: "ghost" });
    } catch (err) {
      expect((err as EditorError).code).toBe("scene_not_found");
    }
  });
});

describe("scenes — AI-backed controls carry honest provider gates", () => {
  test("regenerateVisual: plan only, provider not connected, env var names listed", () => {
    const res = regenerateVisual(baseTimeline(), { sceneId: "s1", scene: SCENES[0] });
    assertEnvelope(res, "regenerateVisual");
    expect(res.changed).toBe(false);
    expect(res.timeline).toBeUndefined();
    expect(res.provider!.capability).toBe("image_generation");
    expect(res.provider!.connected).toBe(false);
    expect(res.provider!.requiredEnv.length).toBeGreaterThan(0);
    // The hint is the engine's derived phrasing for the capability.
    expect(res.provider!.envHint).toBe(capabilityEnvHint("image_generation"));
    expect(res.plan!.applied).toBe(false);
    expect(String(res.plan!.visualPrompt)).toContain("rain-soaked city");
    expect(res.changelist[0]).toContain("sc-s1-video");
    expect(res.note).toContain("Provider Not Connected");
  });

  test("regenerateVoice: timing really applied, audio honestly gated", () => {
    const t = baseTimeline();
    const res = regenerateVoice(t, { sceneId: "s1", scene: SCENES[0] });
    assertEnvelope(res, "regenerateVoice");
    const expected = estimateNarrationMs(SCENES[0].narration); // 8 words @150wpm = 3200ms
    expect(expected).toBe(3200);
    const voice = clipById(res.timeline!, "sc-s1-voice")!;
    expect(voice.endMs - voice.startMs).toBe(expected);
    expect(voice.sceneId).toBe("s1");
    expect(res.provider!.capability).toBe("voice_generation");
    expect(res.provider!.connected).toBe(false);
    expect(res.provider!.requiredEnv).toContain("ELEVENLABS_API_KEY");
    expect(res.note).toContain("no speech was synthesized");
  });

  test("changeMusic: deterministic selection + honest music_generation gate", () => {
    const res = changeMusic(baseTimeline(), { sceneId: "s2", scene: SCENES[1], mood: "epic", energy: 80 });
    assertEnvelope(res, "changeMusic");
    expect(res.selection!.mood).toBe("epic");
    expect(res.selection!.energy).toBe(80);
    expect(res.selection!.pace).toBe("fast");
    expect(res.selection!.gain).toBe(energyToGain(80));
    const music = clipsAt(res.timeline!, "music").find((c) => c.sceneId === "s2")!;
    expect(music.sourceRef).toBe(`music-category:${res.selection!.categoryId}`);
    expect(music.gain).toBe(energyToGain(80));
    expect([music.startMs, music.endMs]).toEqual([5000, 11_000]);
    expect(res.provider!.capability).toBe("music_generation");
    expect(res.provider!.connected).toBe(false);
    expect(res.provider!.requiredEnv.length).toBeGreaterThan(0);
    // The honest gate: the plan/changelist says synthesis is pending, the note
    // says plainly that no audio was synthesized.
    expect(res.changelist.join(" ")).toContain("synthesis pending");
    expect(res.note).toContain("nothing was synthesized");
    expect(res.note).toContain("music provider");
  });

  test("no gate ever leaks a secret value or claims a connection", () => {
    const results = [
      regenerateVisual(baseTimeline(), { sceneId: "s1", scene: SCENES[0] }),
      regenerateVoice(baseTimeline(), { sceneId: "s1", scene: SCENES[0] }),
      changeMusic(baseTimeline(), { sceneId: "s1", scene: SCENES[0], mood: "calm", energy: 20 }),
    ];
    for (const res of results) {
      const json = JSON.stringify(res);
      expect(res.provider!.connected).toBe(false);
      // env NAMES only — no "=" assignment, no long opaque token-like values
      for (const name of res.provider!.requiredEnv) {
        expect(name).toMatch(/^[A-Z0-9_]+$/);
      }
      expect(json).not.toContain("sk-");
      expect(json).not.toMatch(/api[_-]?key["']?\s*[:=]\s*["'][^"']{12,}/i);
    }
  });

  test("deterministic: identical input produces byte-identical output", () => {
    const a = changeMusic(baseTimeline(), { sceneId: "s2", scene: SCENES[1], mood: "epic", energy: 80 });
    const b = changeMusic(baseTimeline(), { sceneId: "s2", scene: SCENES[1], mood: "epic", energy: 80 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    const c = regenerateScene(baseTimeline(), { sceneId: "s1", scene: { ...SCENES[0], durationSeconds: 7 } });
    const d = regenerateScene(baseTimeline(), { sceneId: "s1", scene: { ...SCENES[0], durationSeconds: 7 } });
    expect(JSON.stringify(c)).toBe(JSON.stringify(d));
  });

  test("energy mapping helpers are documented and clamped", () => {
    expect(energyToPace(0)).toBe("slow");
    expect(energyToPace(39)).toBe("slow");
    expect(energyToPace(40)).toBe("medium");
    expect(energyToPace(70)).toBe("fast");
    expect(energyToGain(-20)).toBe(0.2);
    expect(energyToGain(100)).toBe(0.5);
    expect(energyToGain(150)).toBe(0.5);
  });
});

describe("scenes — pure (no-gate) controls", () => {
  test("changeTransition applies to the scene's outgoing clip", () => {
    const res = changeTransition(baseTimeline(), { sceneId: "s1", kind: "dissolve" });
    assertEnvelope(res, "changeTransition");
    expect(res.changed).toBe(true);
    expect(res.provider).toBeUndefined();
    expect(clipById(res.timeline!, "sc-s1-video")!.transition).toEqual({ kind: "dissolve", durationMs: 450 });
    expect(res.changelist[0]).toContain("sc-s1-video");
    // an explicit duration is clamped into the catalog range
    const zoom = changeTransition(baseTimeline(), { sceneId: "s2", kind: "zoom", durationMs: 999 });
    expect(clipById(zoom.timeline!, "sc-s2-video")!.transition).toEqual({ kind: "zoom", durationMs: 600 });
    // repeating the same kind is an honest no-op
    const again = changeTransition(res.timeline!, { sceneId: "s1", kind: "dissolve" });
    expect(again.changed).toBe(false);
    expect(again.changelist).toEqual([]);
  });

  test("changeTransition rejects unknown kinds and unknown scenes with typed errors", () => {
    try {
      changeTransition(baseTimeline(), { sceneId: "s1", kind: "star-wipe" });
    } catch (err) {
      expect((err as EditorError).code).toBe("invalid_input");
    }
    try {
      changeTransition(baseTimeline(), { sceneId: "ghost", kind: "zoom" });
    } catch (err) {
      expect((err as EditorError).code).toBe("scene_not_found");
    }
  });

  test("changeSubtitle stores one of the 8 styles on the scene's caption clips", () => {
    const res = changeSubtitle(baseTimeline(), { sceneId: "s2", styleId: "cinematic" });
    assertEnvelope(res, "changeSubtitle");
    expect(res.changed).toBe(true);
    const caption = clipById(res.timeline!, "sc-s2-subtitles")!;
    expect(caption.subtitleStyle).toBe("cinematic");
    // other scenes keep the default
    expect(clipById(res.timeline!, "sc-s1-subtitles")!.subtitleStyle ?? null).toBeNull();
    expect(res.note).toContain("Deterministic");
    expect(res.provider).toBeUndefined();
  });

  test("changeSubtitle accepts the auto choice and validates manual ids", () => {
    const res = changeSubtitle(baseTimeline(), { sceneId: "s1", styleId: "auto", mood: "energetic" });
    const caption = clipById(res.timeline!, "sc-s1-subtitles")!;
    expect(SUBTITLE_STYLES.map((s) => s.id)).toContain(caption.subtitleStyle!);
    expect(caption.subtitleStyle).toBe("yellow"); // energetic → high-contrast (Phase 4 rule)
    try {
      changeSubtitle(baseTimeline(), { sceneId: "s1", styleId: "comic-sans" });
    } catch (err) {
      expect((err as EditorError).code).toBe("invalid_input");
    }
  });

  test("restyleScene records the grade on the visual clips", () => {
    const res = restyleScene(baseTimeline(), { sceneId: "s2", grade: "noir" });
    assertEnvelope(res, "restyleScene");
    expect(res.changed).toBe(true);
    expect(clipById(res.timeline!, "sc-s2-video")!.grade).toBe("noir");
    expect(res.changelist.length).toBe(1);
    expect(res.changelist[0]).toContain("grade: sc-s2-video none → noir");
    expect(res.plan!.applied).toBe(true);
    expect(res.note).toContain("Block 4");
    // idempotent
    expect(restyleScene(res.timeline!, { sceneId: "s2", grade: "noir" }).changed).toBe(false);
    expect(COLOR_GRADE_HINTS).toContain("noir");
    try {
      restyleScene(baseTimeline(), { sceneId: "s2", grade: "  " });
    } catch (err) {
      expect((err as EditorError).code).toBe("invalid_input");
    }
  });

  test("the pure ops never mutate the input timeline", () => {
    const t = baseTimeline();
    const snapshot = JSON.stringify(t);
    changeTransition(t, { sceneId: "s1", kind: "fade" });
    changeSubtitle(t, { sceneId: "s1", styleId: "bold" });
    restyleScene(t, { sceneId: "s1", grade: "teal-orange" });
    expect(JSON.stringify(t)).toBe(snapshot);
  });

  test("a control on a scene that is only on the timeline (no Scene row) still works", () => {
    const t = baseTimeline();
    const res = changeTransition(t, { sceneId: "s3", kind: "cut" });
    expect(res.changed).toBe(true);
    expect(clipById(res.timeline!, "sc-s3-video")!.transition).toEqual({ kind: "cut", durationMs: 0 });
  });
});

describe("scenes — dispatcher envelope", () => {
  test("every control is reachable through applySceneControl and returns the shared envelope", () => {
    const t = baseTimeline();
    const scene = SCENES[0];
    const calls: [string, Record<string, unknown>][] = [
      ["regenerateScene", { sceneId: "s1", scene }],
      ["regenerateVisual", { sceneId: "s1", scene }],
      ["regenerateVoice", { sceneId: "s1", scene }],
      ["changeMusic", { sceneId: "s1", scene, mood: "calm", energy: 30 }],
      ["changeTransition", { sceneId: "s1", kind: "zoom" }],
      ["changeSubtitle", { sceneId: "s1", styleId: "minimal" }],
      ["restyleScene", { sceneId: "s1", grade: "neutral" }],
    ];
    for (const [control, args] of calls) {
      const res = applySceneControl(t, control as (typeof SCENE_CONTROLS)[number], args as never);
      assertEnvelope(res, control);
      // a control that changed something always returns its timeline
      if (res.changed) expect(res.timeline).toBeDefined();
      if (res.timeline) {
        // the returned timeline is a valid timeline for its own clips
        expect(clipsForScene(res.timeline, "s1").length).toBeGreaterThan(0);
      }
    }
    expect(SCENE_CONTROLS.length).toBe(7);
    expect(MUSIC_MOODS).toContain("epic");
  });

  test("missing required arguments are typed errors that name the field", () => {
    const t = baseTimeline();
    try {
      applySceneControl(t, "changeTransition", { sceneId: "s1" });
    } catch (err) {
      expect((err as EditorError).code).toBe("invalid_input");
      expect((err as EditorError).message).toContain("kind");
    }
    try {
      applySceneControl(t, "changeSubtitle", { sceneId: "s1" });
    } catch (err) {
      expect((err as Error).message).toContain("styleId");
    }
    try {
      applySceneControl(t, "restyleScene", { sceneId: "s1" });
    } catch (err) {
      expect((err as Error).message).toContain("grade");
    }
  });

  test("an unknown sceneId is a 404-worthy scene_not_found for every control", () => {
    const t = baseTimeline();
    for (const [control, args] of [
      ["regenerateScene", { sceneId: "ghost" }],
      ["regenerateVisual", { sceneId: "ghost" }],
      ["regenerateVoice", { sceneId: "ghost" }],
      ["changeMusic", { sceneId: "ghost" }],
      ["changeTransition", { sceneId: "ghost", kind: "zoom" }],
      ["changeSubtitle", { sceneId: "ghost", styleId: "minimal" }],
      ["restyleScene", { sceneId: "ghost", grade: "noir" }],
    ] as const) {
      let code = "";
      try {
        applySceneControl(t, control, args as never);
      } catch (err) {
        code = err instanceof EditorError ? err.code : "not-editor-error";
      }
      expect(code).toBe("scene_not_found");
    }
  });

  test("timelines produced by the controls survive a structural re-read", () => {
    const res = changeSubtitle(regenerateScene(baseTimeline(), { sceneId: "s1", scene: { ...SCENES[0], durationSeconds: 7 } }).timeline!, {
      sceneId: "s1",
      styleId: "karaoke",
    });
    expect(clipById(res.timeline!, "sc-s1-subtitles")!.subtitleStyle).toBe("karaoke");
    expect(timelinesEqual(res.timeline!, JSON.parse(JSON.stringify(res.timeline!)))).toBe(true);
  });
});
