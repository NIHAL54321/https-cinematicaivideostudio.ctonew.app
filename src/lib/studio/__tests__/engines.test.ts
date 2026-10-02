import { describe, expect, test } from "bun:test";
import { generateHookOptions, replaceHook, HOOK_TYPES } from "../hooks";
import { selectDescriptors, CINEMATIC_DESCRIPTORS } from "../cinematic";
import { pickCamera, SHOT_TYPES } from "../cameras";
import { decideSceneMedia, MEDIA_TYPES } from "../scene-intelligence";
import { assembleVisualPrompt } from "../visual-prompts";
import { analyzeRetention } from "../retention";
import { TONES } from "../tones";

describe("hooks: template honesty", () => {
  test("generates options across all 8 types, labeled template", () => {
    const opts = generateHookOptions({ topic: "cooking pasta", tone: "friendly" });
    expect(opts.length).toBe(16);
    expect(new Set(opts.map((o) => o.type)).size).toBe(8);
    for (const o of opts) {
      expect(o.labeled).toBe("template");
      expect(o.text).toContain("cooking pasta");
      expect(o.note.length).toBeGreaterThan(0);
    }
  });

  test("statistics hook uses placeholder unless real data is supplied", () => {
    const without = generateHookOptions({ topic: "coffee", maxOptions: 2 }).filter((o) => o.type === "statistics");
    for (const o of without) expect(o.text).toContain("[verified statistic]");

    const withData = generateHookOptions({
      topic: "coffee",
      maxOptions: 2,
      statistics: [{ value: "72% of adults drink coffee daily", source: "National Coffee Survey 2024" }],
    }).filter((o) => o.type === "statistics");
    for (const o of withData) {
      expect(o.text).toContain("72% of adults drink coffee daily");
      expect(o.text).toContain("National Coffee Survey 2024");
      expect(o.statistic?.source).toBe("National Coffee Survey 2024");
    }
  });

  test("replaceHook rotates to a fresh template", () => {
    const first = generateHookOptions({ topic: "space", maxOptions: 8 });
    const next = replaceHook({ topic: "space" }, first);
    expect(first.some((o) => o.templateId === next.templateId)).toBe(false);
    expect(next.labeled).toBe("template");
    expect(next.text).toContain("space");
  });

  test("tone changes rotate templates deterministically", () => {
    const a = generateHookOptions({ topic: "money", tone: "calm" });
    const b = generateHookOptions({ topic: "money", tone: "calm" });
    expect(a.map((o) => o.templateId)).toEqual(b.map((o) => o.templateId));
  });

  test("every hook type is in the spec list", () => {
    const ids = HOOK_TYPES.map((t) => t.id);
    expect(ids).toEqual([
      "curiosity",
      "shock",
      "question",
      "story",
      "statistics",
      "controversy",
      "emotional",
      "problem",
    ]);
  });
});

describe("cinematic descriptors", () => {
  test("library has all 23 spec descriptors", () => {
    expect(CINEMATIC_DESCRIPTORS.length).toBe(23);
    const labels = CINEMATIC_DESCRIPTORS.map((d) => d.label);
    for (const l of [
      "Cinematic",
      "Filmic",
      "Theatrical",
      "Cinematographic",
      "Anamorphic",
      "Hollywood-style",
      "Director's-cut",
      "Lifelike",
      "Hyper-realistic",
      "Ultra-realistic",
      "Photorealistic",
      "Immersive",
      "Vivid",
      "True-to-life",
      "Studio-quality",
      "Broadcast-ready",
      "Atmospheric",
      "Moody",
      "Luminous",
      "Vibrant",
      "Rich tones",
      "Color-accurate",
      "Breathtaking",
    ]) {
      expect(labels).toContain(l);
    }
  });

  test("selectDescriptors returns a small subset, never all", () => {
    for (const tone of ["cinematic", "calm", "educational", "mysterious"]) {
      const subset = selectDescriptors({ tone, mediaType: "AI_VIDEO" });
      expect(subset.length).toBeLessThanOrEqual(6);
      expect(subset.length).toBeGreaterThanOrEqual(3);
      // at least one realism and one quality descriptor
      expect(subset.some((d) => d.category === "realism")).toBe(true);
      expect(subset.some((d) => d.category === "quality")).toBe(true);
      // no duplicates
      expect(new Set(subset.map((d) => d.id)).size).toBe(subset.length);
    }
  });
});

describe("cameras", () => {
  test("all 15 spec shot types exist", () => {
    const names = SHOT_TYPES.map((s) => s.name);
    for (const n of [
      "Wide",
      "Establishing",
      "Medium",
      "Close-up",
      "Extreme close-up",
      "Macro",
      "POV",
      "Tracking",
      "Dolly",
      "Crane",
      "Drone",
      "Aerial",
      "Rack focus",
      "Slow motion",
      "Time lapse",
    ]) {
      expect(names).toContain(n);
    }
  });

  test("pickCamera returns a shot with rationale, deterministically", () => {
    const a = pickCamera({ beatId: "hook", mediaType: "STOCK" });
    const b = pickCamera({ beatId: "hook", mediaType: "STOCK" });
    expect(a.shot.id).toBe(b.shot.id);
    expect(a.rationale.length).toBeGreaterThan(10);
    expect(pickCamera({ beatId: "reveal", mediaType: "AI_VIDEO" }).shot.id).toBe("rack-focus");
    expect(pickCamera({ mediaType: "MAP" }).shot.id).toBe("aerial");
  });
});

describe("scene intelligence", () => {
  test("decides a media type with rationale for any scene", () => {
    for (const ctx of [
      { beatId: "hook", topic: "amazing places", format: "LONG" },
      { beatId: "evidence", topic: "revenue grew 20%", format: "LONG" },
      { beatId: "timeline", topic: "the 1990s", format: "LONG" },
      { beatId: "cta", topic: "subscribe", format: "SHORT" },
      { beatId: "story", topic: "how the app works", style: "faceless-creator" },
    ]) {
      const d = decideSceneMedia(ctx);
      expect(MEDIA_TYPES).toContain(d.mediaType);
      expect(d.rationale.length).toBeGreaterThan(0);
      expect(d.confidence).toBeGreaterThan(0);
      expect(d.confidence).toBeLessThanOrEqual(1);
    }
  });
});

describe("visual prompts", () => {
  test("assembles a deterministic, structured prompt", () => {
    const a = assembleVisualPrompt({
      subject: "a lighthouse",
      environment: "a stormy coast",
      tone: "dramatic",
      format: "LONG",
      descriptors: selectDescriptors({ tone: "dramatic", mediaType: "AI_VIDEO" }),
    });
    const b = assembleVisualPrompt({
      subject: "a lighthouse",
      environment: "a stormy coast",
      tone: "dramatic",
      format: "LONG",
      descriptors: selectDescriptors({ tone: "dramatic", mediaType: "AI_VIDEO" }),
    });
    expect(a).toBe(b);
    expect(a).toContain("a lighthouse");
    expect(a).toContain("lighting:");
    expect(a).toContain("widescreen 16:9 framing");
  });

  test("short format gets vertical framing", () => {
    const p = assembleVisualPrompt({ subject: "x", format: "SHORT" });
    expect(p).toContain("vertical 9:16 framing");
  });
});

describe("tones", () => {
  test("all 13 spec tones exist", () => {
    const names = TONES.map((t) => t.name);
    for (const n of [
      "Cinematic",
      "Inspirational",
      "Emotional",
      "Dramatic",
      "Professional",
      "Educational",
      "Friendly",
      "Authoritative",
      "Energetic",
      "Calm",
      "Mysterious",
      "Serious",
      "Conversational",
    ]) {
      expect(names).toContain(n);
    }
  });
});

describe("retention", () => {
  test("flags weak hooks and endings honestly", () => {
    const a = analyzeRetention({
      structureId: "hook-problem-solution",
      totalDurationSeconds: 60,
      chapterCount: 3,
      sceneCount: 3,
      hookSeconds: 10,
      beatNames: ["Hook", "Problem", "Conclusion"],
    });
    expect(a.riskScore).toBeGreaterThanOrEqual(0);
    expect(a.riskScore).toBeLessThanOrEqual(100);
    // No hook type chosen → weak_hook risk present.
    expect(a.risks.some((r) => r.factor === "weak_hook")).toBe(true);
    // A proper ending beat name → no weak_ending flag.
    expect(a.risks.some((r) => r.factor === "weak_ending")).toBe(false);
    expect(a.recommendations.length).toBeGreaterThan(0);
    expect(a.honestNote).toContain("Heuristic");
  });

  test("a chosen hook type clears the weak-hook flag", () => {
    const a = analyzeRetention({
      structureId: "hook-problem-solution",
      hookType: "question",
      totalDurationSeconds: 60,
      chapterCount: 3,
      sceneCount: 3,
      hookSeconds: 8,
      beatNames: ["Hook", "Problem", "Conclusion"],
    });
    expect(a.risks.some((r) => r.factor === "weak_hook")).toBe(false);
  });

  test("reports no fabricated statistics", () => {
    const a = analyzeRetention({ totalDurationSeconds: 120, chapterCount: 2, sceneCount: 4 });
    const text = JSON.stringify(a).toLowerCase();
    expect(text).not.toContain("% of viewers");
    expect(text).not.toMatch(/retention rate/i);
  });
});
