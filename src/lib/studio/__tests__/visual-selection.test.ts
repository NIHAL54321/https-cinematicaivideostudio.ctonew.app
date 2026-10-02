import { describe, expect, test } from "bun:test";
import {
  rankVisualsForScene,
  pickPrimaryVisual,
  type VisualScene,
  type VisualCandidate,
} from "../visual-selection";
import { extractContinuity, augmentScenesWithContinuity } from "../continuity";
import { assignVisualsToStoryboard } from "../visual-assignment";

function scene(over: Partial<VisualScene> & { id: string }): VisualScene {
  return {
    order: Number(over.id.replace(/\D/g, "")) || 1,
    title: "Maria enters the glass tower lobby",
    narration: "Maria walks into the towering glass lobby downtown.",
    visualPrompt: "wide shot of Maria in the glass tower lobby",
    mediaType: "STOCK",
    camera: "wide",
    tone: "cinematic",
    aspectRatio: "SIXTEEN_NINE",
    ...over,
  };
}

describe("rankVisualsForScene", () => {
  test("produces a scored, sorted, non-empty spread with rationales", () => {
    const s = scene({ id: "s1" });
    const ranked = rankVisualsForScene(s, { presetId: "cinematic", format: "LONG" });

    expect(ranked.length).toBeGreaterThanOrEqual(5);
    // sorted descending by mScore
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].mScore).toBeGreaterThanOrEqual(ranked[i].mScore);
    }
    // every candidate has a rationale and a bounded deterministic score
    for (const c of ranked) {
      expect(typeof c.rationale).toBe("string");
      expect(c.rationale.length).toBeGreaterThan(10);
      expect(c.mScore).toBeGreaterThanOrEqual(0);
      expect(c.mScore).toBeLessThanOrEqual(100);
    }
    // honest spread — not all identical, not random drift between runs
    const distinct = new Set(ranked.map((c) => c.mScore));
    expect(distinct.size).toBeGreaterThan(1);
    const run2 = rankVisualsForScene(s, { presetId: "cinematic", format: "LONG" });
    expect(ranked.map((c) => c.id)).toEqual(run2.map((c) => c.id));
    expect(ranked.map((c) => c.mScore)).toEqual(run2.map((c) => c.mScore));
  });

  test("primary is the highest-scoring candidate", () => {
    const ranked = rankVisualsForScene(scene({ id: "s9" }), { presetId: "moody", format: "LONG" });
    const { primary } = pickPrimaryVisual(scene({ id: "s9" }), { presetId: "moody", format: "LONG" });
    expect(primary.mScore).toBe(ranked[0].mScore);
    expect(primary.id).toBe(ranked[0].id);
    expect(primary.rationale.length).toBeGreaterThan(10);
  });

  test("selection is scene-aware: the primary prompt reflects the scene subject", () => {
    const a = pickPrimaryVisual(scene({ id: "s2", title: "storm over the ocean", narration: "A violent storm rages over the open ocean." }), { presetId: "cinematic" });
    const b = pickPrimaryVisual(scene({ id: "s3", title: "futuristic city at night", narration: "Neon lights flicker across the futuristic city skyline." }), { presetId: "cinematic" });
    expect(a.primary.prompt?.toLowerCase()).toContain("storm");
    expect(b.primary.prompt?.toLowerCase()).toContain("futuristic");
    expect(a.primary.id).not.toBe(b.primary.id);
  });
});

describe("extractContinuity + augmentScenesWithContinuity", () => {
  const scenes: VisualScene[] = [
    scene({ id: "s1", narration: "Maria arrives at the glass tower lobby." }),
    scene({ id: "s2", narration: "Maria sits near the lobby window." }),
    scene({ id: "s3", title: "ocean", narration: "The story turns to the open ocean.", visualPrompt: "aerial view of the endless ocean" }),
  ];

  test("finds recurring characters and locations", () => {
    const state = extractContinuity(scenes, { presetId: "cinematic" });
    expect(state.characters.some((c) => c.name === "maria")).toBe(true);
    expect(state.locations.some((l) => l.name === "lobby" || l.name === "tower")).toBe(true);
    expect(state.stylePreset).toBe("cinematic");
    expect(state.source).toBe("continuity-heuristic");
  });

  test("augmentation preserves narration, titles and timing", () => {
    const state = extractContinuity(scenes, { presetId: "cinematic" });
    const before = scenes.map((s) => s);
    const augmented = augmentScenesWithContinuity(scenes, state);

    expect(augmented.length).toBe(scenes.length);
    augmented.forEach((s, i) => {
      expect(s.narration).toBe(before[i].narration);
      expect(s.title).toBe(before[i].title);
      expect(s.order).toBe(before[i].order);
      expect(s.durationSeconds).toBe(before[i].durationSeconds);
      expect(s.id).toBe(before[i].id);
    });
    // scenes mentioning a recurring character get an anchor; the ocean scene does not
    expect(augmented[0].visualPrompt).toContain("[continuity:");
    expect(augmented[0].visualPrompt?.toLowerCase()).toContain("maria");
    expect(augmented[2].visualPrompt).toBe(scenes[2].visualPrompt);
  });

  test("augmentation is idempotent (no double anchors)", () => {
    const state = extractContinuity(scenes, { presetId: "cinematic" });
    const once = augmentScenesWithContinuity(scenes, state);
    const twice = augmentScenesWithContinuity(once, state);
    expect((once[0].visualPrompt?.match(/\[continuity:/g) ?? []).length).toBe(1);
    expect(twice[0].visualPrompt?.match(/\[continuity:/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(twice[0].visualPrompt).toBe(once[0].visualPrompt);
  });
});

describe("assignVisualsToStoryboard", () => {
  const existing: VisualCandidate = { id: "s1-generated-0", kind: "generated", label: "Existing choice", mScore: 99, rationale: "user-picked" };

  test("attaches a chosen + alternates per scene without dropping fields", () => {
    const scenes: VisualScene[] = [
      scene({ id: "s1", chosen: existing }),
      scene({ id: "s2", narration: "Maria walks home through the rain.", title: "Maria leaves" }),
    ];
    const result = assignVisualsToStoryboard(scenes, { presetId: "cinematic", format: "LONG" });

    expect(result.assignments.length).toBe(2);
    expect(result.continuity).not.toBeNull();
    // existing choice is kept (re-matched to a freshly-ranked candidate)
    expect(result.assignments[0].chosen).not.toBeNull();
    expect(result.assignments[0].alternates.length).toBeGreaterThan(0);
    for (const a of result.assignments) {
      expect(typeof a.chosen.mScore).toBe("number");
      expect(a.chosen.rationale.length).toBeGreaterThan(0);
      expect(Array.isArray(a.alternates)).toBe(true);
      expect(Array.isArray(a.continuityNotes)).toBe(true);
    }
    // storyboard fields preserved on the returned (augmented) scenes
    const aug = result.scenes;
    expect(aug.length).toBe(2);
    expect(aug.map((s) => s.id)).toEqual(["s1", "s2"]);
    expect(aug[0].narration).toBe(scenes[0].narration);
    expect(aug[1].title).toBe("Maria leaves");
    expect(aug[1].durationSeconds).toBe(scenes[1].durationSeconds);
  });

  test("empty input yields empty assignments and a default continuity", () => {
    const r = assignVisualsToStoryboard([], { presetId: "cinematic" });
    expect(r.assignments).toEqual([]);
    expect(r.scenes).toEqual([]);
    expect(r.continuity).not.toBeNull();
  });
});
