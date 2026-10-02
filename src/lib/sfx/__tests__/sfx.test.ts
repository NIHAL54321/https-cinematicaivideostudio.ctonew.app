import { describe, expect, test } from "bun:test";
import {
  SFX_LIBRARY,
  SFX_BY_ID,
  findSfx,
  placementPolicy,
  planSoundEffects,
  selectSfxForScene,
} from "../engine";

/**
 * Phase 4 Block 2 — Sound FX engine tests (deterministic, conservative).
 * Rules under test: ≤ 2 effects per scene; ≥ 1.5s gap between hits; whoosh
 * only on transition match; ambience only on keyword match; no SFX on plain
 * talking scenes; deterministic ranking.
 */
describe("SFX library", () => {
  test("14 licensed effects with valid fields", () => {
    expect(SFX_LIBRARY.length).toBe(14);
    const ids = new Set(SFX_LIBRARY.map((s) => s.id));
    expect(ids.size).toBe(14);
    for (const s of SFX_LIBRARY) {
      expect(["transition", "emphasis", "ambience", "ui"]).toContain(s.category);
      expect(s.weight).toBeGreaterThanOrEqual(0);
      expect(s.weight).toBeLessThanOrEqual(1);
      expect(s.typicallyShortMs).toBeGreaterThan(0);
      expect(s.description.length).toBeGreaterThan(0);
    }
  });

  test("findSfx resolves by id, null otherwise", () => {
    expect(findSfx("whoosh")?.name).toBe("Whoosh");
    expect(findSfx("nope")).toBeNull();
    expect(SFX_BY_ID["impact"].category).toBe("transition");
  });

  test("policy is conservative and enforced", () => {
    expect(placementPolicy).toEqual({ maxPerScene: 2, preferTransitions: true, minGapMs: 1500 });
  });
});

describe("selectSfxForScene", () => {
  test("whoosh appears ONLY when transitionType matches", () => {
    const without = selectSfxForScene({ text: "A dramatic whoosh through the air." });
    expect(without.some((c) => c.sfxId === "whoosh")).toBe(false);
    const withType = selectSfxForScene({ text: "A dramatic whoosh through the air.", transitionType: "whoosh" });
    expect(withType.some((c) => c.sfxId === "whoosh")).toBe(true);
  });

  test("impact appears ONLY when transitionType matches", () => {
    expect(selectSfxForScene({ text: "Massive impact! Boom!" }).some((c) => c.sfxId === "impact")).toBe(false);
    expect(
      selectSfxForScene({ text: "The impact lands.", transitionType: "impact" }).some((c) => c.sfxId === "impact"),
    ).toBe(true);
  });

  test("ambience only fires on keyword match", () => {
    const noMatch = selectSfxForScene({ text: "She explains the numbers calmly." });
    expect(noMatch.filter((c) => SFX_BY_ID[c.sfxId].category === "ambience")).toHaveLength(0);
    const matched = selectSfxForScene({ text: "The nature documentary shows forest birds in the wind." });
    expect(matched.some((c) => c.sfxId === "nature")).toBe(true);
  });

  test("ui/digital effects only fire on digital topics", () => {
    const noDigital = selectSfxForScene({ text: "Boom! Incredible reveal for everyone." });
    expect(noDigital.some((c) => SFX_BY_ID[c.sfxId].category === "ui")).toBe(false);
    const digital = selectSfxForScene({ text: "The app sends a notification on every message." });
    expect(digital.some((c) => c.sfxId === "notification")).toBe(true);
    expect(digital.some((c) => c.sfxId === "digital-effects")).toBe(true);
  });

  test("emphasis fires on exclamation and strong beats", () => {
    const hit = selectSfxForScene({ text: "Boom! The shockwave slams into the wall." });
    expect(hit.some((c) => c.sfxId === "camera" || c.sfxId === "door")).toBe(true);
  });

  test("ranking is deterministic and transition-preferred", () => {
    const input = { text: "Boom! A whoosh over the city skyline, camera snapping.", transitionType: "whoosh" };
    const a = selectSfxForScene(input);
    const b = selectSfxForScene(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.length).toBeGreaterThanOrEqual(2);
    expect(a[0].sfxId).toBe("whoosh");
    expect(a.every((c) => c.gain > 0 && c.gain <= 1 && c.reason.length > 0)).toBe(true);
  });

  test("empty text returns no candidates", () => {
    expect(selectSfxForScene({ text: "" })).toEqual([]);
  });
});

describe("planSoundEffects", () => {
  test("no SFX on plain talking scenes", () => {
    const plan = planSoundEffects({
      scenes: [{ text: "She explains the numbers calmly.", durationMs: 5000 }],
    });
    expect(plan.schedule).toEqual([]);
  });

  test("whoosh fires on transition scene while plain scene stays silent", () => {
    const plan = planSoundEffects({
      scenes: [
        { sceneId: "s1", text: "A dramatic whoosh as we enter the city at night.", transitionType: "whoosh" },
        { sceneId: "s2", text: "She explains the numbers calmly.", durationMs: 5000 },
      ],
    });
    const first = plan.schedule.filter((e) => e.sceneId === "s1");
    expect(first.some((e) => e.sfxId === "whoosh")).toBe(true);
    expect(plan.schedule.filter((e) => e.sceneId === "s2")).toHaveLength(0);
  });

  test("maxPerScene is enforced: 3 strong candidates collapse to 2", () => {
    const plan = planSoundEffects({
      scenes: [
        {
          sceneId: "s1",
          text: "Boom! A huge whoosh in the city with digital computers, camera clicking.",
          transitionType: "whoosh",
          durationMs: 8000,
        },
      ],
    });
    const sceneEvents = plan.schedule.filter((e) => e.sceneId === "s1");
    expect(sceneEvents.length).toBeLessThanOrEqual(2);
    expect(sceneEvents.length).toBe(2);
  });

  test("minGapMs is enforced between hits across scenes", () => {
    const plan = planSoundEffects({
      scenes: [
        { sceneId: "a", text: "Hard whoosh.", transitionType: "whoosh", durationMs: 2000 },
        { sceneId: "b", text: "Another whoosh!", transitionType: "whoosh", durationMs: 2000 },
      ],
    });
    expect(plan.schedule).toHaveLength(2);
    const [first, second] = plan.schedule;
    expect(second.startMs - first.endMs).toBeGreaterThanOrEqual(placementPolicy.minGapMs);
  });

  test("tiny scenes cannot host overflowing effects (skipped, not overlapped)", () => {
    const plan = planSoundEffects({
      scenes: [{ sceneId: "x", text: "Whoosh", transitionType: "whoosh", durationMs: 300 }],
    });
    // whoosh (150 + 700 = 850ms) cannot fit in a 300ms scene → skipped.
    expect(plan.schedule).toHaveLength(0);
  });

  test("calm tone suppresses emphasis effects", () => {
    const plan = planSoundEffects({
      scenes: [{ sceneId: "s1", text: "Boom! The huge impact shakes everything.", durationMs: 6000 }],
      tone: "calm",
    });
    expect(plan.schedule.filter((e) => SFX_BY_ID[e.sfxId].category === "emphasis")).toHaveLength(0);
  });

  test("schedule is deterministic and chronological", () => {
    const scenes = [
      { sceneId: "a", text: "Whoosh into the city at night.", transitionType: "whoosh" },
      { sceneId: "b", text: "The nature footage shows forest birds.", durationMs: 6000 },
    ];
    const a = planSoundEffects({ scenes });
    const b = planSoundEffects({ scenes });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    for (let i = 1; i < a.schedule.length; i++) {
      expect(a.schedule[i].startMs).toBeGreaterThanOrEqual(a.schedule[i - 1].startMs);
    }
  });

  test("plan exposes the enforced policy", () => {
    const plan = planSoundEffects({ scenes: [{ text: "Whoosh", transitionType: "whoosh", durationMs: 4000 }] });
    expect(plan.policy).toEqual(placementPolicy);
    expect(plan.timingModel.length).toBeGreaterThan(0);
  });
});