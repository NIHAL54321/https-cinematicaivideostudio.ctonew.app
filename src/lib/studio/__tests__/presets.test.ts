import { describe, expect, test } from "bun:test";
import { CINEMATIC_PRESETS, getPreset, applyPreset, PRESET_IDS, composePresetPrompt } from "../presets";
import { CAMERA_MOVES, pickCamera, applyCameraToPrompt, getCameraMove } from "../camera";
import { VISUAL_EFFECTS, applyEffects } from "../effects";
import { restyle, resolvePreset } from "../restyle";

describe("presets: catalog", () => {
  test("has all 27 required preset ids", () => {
    const required = [
      "cinematic", "filmic", "theatrical", "cinematographic", "anamorphic", "hollywood",
      "documentary", "photorealistic", "hyperrealistic", "ultrarealistic", "lifelike",
      "immersive", "vivid", "premium", "studio", "broadcast", "moody", "atmospheric",
      "luxury", "futuristic", "vintage", "news", "corporate", "infographic", "animated",
      "3d", "illustration",
    ];
    expect(PRESET_IDS.length).toBe(27);
    for (const id of required) expect(CINEMATIC_PRESETS[id], `missing ${id}`).toBeDefined();
  });

  test("getPreset falls back to cinematic default", () => {
    expect(getPreset("nope").id).toBe("cinematic");
    expect(getPreset()).toBe(CINEMATIC_PRESETS.cinematic);
    expect(getPreset("futuristic").id).toBe("futuristic");
  });

  test("applyPreset appends descriptors, tokens, lighting, grading", () => {
    const p = applyPreset(CINEMATIC_PRESETS.futuristic, "a neon city");
    expect(p.startsWith("a neon city")).toBe(true);
    expect(p).toContain("neon cyan and magenta");
    expect(p).toContain("futuristic sci-fi aesthetic");
  });

  test("deterministic: same input -> same output", () => {
    const a = applyPreset(CINEMATIC_PRESETS.moody, "a rainy alley");
    const b = applyPreset(CINEMATIC_PRESETS.moody, "a rainy alley");
    expect(a).toBe(b);
  });

  test("composePresetPrompt produces a full pipeline prompt", () => {
    const out = composePresetPrompt(CINEMATIC_PRESETS.cinematic, { subject: "an explorer" });
    expect(out).toContain("an explorer");
    expect(out.toLowerCase()).toContain("lighting");
    expect(out.length).toBeGreaterThan(10);
  });
});

describe("camera engine", () => {
  test("has all 13 moves", () => {
    const moves = [
      "wide establishing", "medium", "close-up", "macro", "pov", "drone", "tracking",
      "dolly", "crane", "aerial", "rack focus", "slow motion", "time-lapse",
    ];
    expect(CAMERA_MOVES.length).toBe(13);
    for (const m of moves) expect(getCameraMove(m).move, `missing ${m}`).toBe(m);
  });

  test("deterministic picker maps a scene to a move + shot + rationale", () => {
    const a = pickCamera({ beatName: "journey", mediaType: "AI_VIDEO" });
    const b = pickCamera({ beatName: "journey", mediaType: "AI_VIDEO" });
    expect(a.move.move).toBe(b.move.move);
    expect(a.shot.id).toBeTruthy();
    expect(a.rationale).toContain(a.move.move);
  });

  test("explicit move override wins", () => {
    const pick = pickCamera({ move: "aerial" });
    expect(pick.move.move).toBe("aerial");
  });

  test("applyCameraToPrompt appends motion + DOF", () => {
    const pick = pickCamera({ move: "dolly", beatName: "turning-point" });
    const out = applyCameraToPrompt("a scene", pick);
    expect(out).toContain("camera move: dolly");
    expect(out).toContain("motion:");
  });
});

describe("visual effects", () => {
  test("catalog has 10 effects", () => {
    const ids = [
      "zoom", "pan", "ken-burns", "depth-of-field", "light-leak", "film-grain",
      "blur", "motion-blur", "color-grade", "vignette",
    ];
    expect(Object.keys(VISUAL_EFFECTS).length).toBe(10);
    for (const id of ids) expect(VISUAL_EFFECTS[id]).toBeDefined();
  });

  test("applyEffects joins valid suffixes, ignores unknown, dedupes", () => {
    const out = applyEffects("base", ["zoom", "zoom", "nope"]);
    expect(out).toContain("base");
    expect(out).toContain("push-in zoom");
    const none = applyEffects("base", []);
    expect(none).toBe("base");
  });
});

describe("restyle engine", () => {
  test("preserves story/timing but swaps visual look", () => {
    const scene = {
      id: "s1",
      title: "The turning point",
      narration: "Everything changes here.",
      order: 4,
      durationSeconds: 12,
      visualPrompt: "cinematic wide shot of a city at dusk",
    };
    const { scene: restyled, restylePrompt } = restyle(scene, "cinematic", "futuristic");
    expect(restyled.narration).toBe("Everything changes here.");
    expect(restyled.order).toBe(4);
    expect(restyled.durationSeconds).toBe(12);
    expect(restyled.title).toBe("The turning point");
    expect(restyled.visualPrompt).not.toBe(scene.visualPrompt);
    expect(restylePrompt).toContain("futuristic sci-fi aesthetic");
    expect(restyled.visualPrompt).toBe(restylePrompt);
  });

  test("spec aliases resolve: Realistic -> hyperrealistic, Dark cinematic -> moody, Modern premium -> premium", () => {
    expect(resolvePreset("Realistic").id).toBe("hyperrealistic");
    expect(resolvePreset("Realistic").name.length).toBeGreaterThan(0);
    expect(resolvePreset("Dark cinematic").id).toBe("moody");
    expect(resolvePreset("Modern premium").id).toBe("premium");
    expect(resolvePreset("Corporate").id).toBe("corporate");
  });

  test("documentary -> luxury preserves narration", () => {
    const { scene, preset } = restyle(
      { title: "A daily ritual", narration: "Every morning begins the same.", visualPrompt: "documentary shot of a kitchen" },
      "documentary",
      "luxury",
    );
    expect(scene.narration).toBe("Every morning begins the same.");
    expect(preset.id).toBe("luxury");
  });

  test("deterministic", () => {
    const base = { visualPrompt: "a quiet forest" };
    const a = restyle(base, "cinematic", "moody");
    const b = restyle(base, "cinematic", "moody");
    expect(a.restylePrompt).toBe(b.restylePrompt);
  });
});
