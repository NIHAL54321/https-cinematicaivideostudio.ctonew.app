import { describe, expect, test } from "bun:test";
import {
  MUSIC_CATEGORIES,
  findMusicCategory,
  scoreGenreMatch,
  selectMusic,
} from "../engine";

/**
 * Phase 4 Block 2 — Music selection engine tests (deterministic layer).
 */
describe("music categories", () => {
  test("catalog has the 15 licensed categories with valid fields", () => {
    expect(MUSIC_CATEGORIES.length).toBe(15);
    const ids = new Set(MUSIC_CATEGORIES.map((c) => c.id));
    expect(ids.size).toBe(15);
    for (const c of MUSIC_CATEGORIES) {
      expect(c.name.length).toBeGreaterThan(0);
      expect(c.moods.length).toBeGreaterThan(0);
      expect(c.energyRange[0]).toBeLessThan(c.energyRange[1]);
      expect(c.typicalBpm).toBeGreaterThan(0);
    }
  });

  test("findMusicCategory resolves by id and by name", () => {
    expect(findMusicCategory("technology")?.name).toBe("Technology");
    expect(findMusicCategory("Technology")?.name).toBe("Technology");
    expect(findMusicCategory("epic")?.typicalBpm).toBe(140);
    expect(findMusicCategory("nope")).toBeNull();
    expect(findMusicCategory(undefined)).toBeNull();
  });
});

describe("scoreGenreMatch", () => {
  test("exact category id/name scores highest", () => {
    expect(scoreGenreMatch("cinematic", MUSIC_CATEGORIES[0])).toBe(30);
    expect(scoreGenreMatch("Cinematic", MUSIC_CATEGORIES[0])).toBe(30);
  });

  test("mood-word and keyword matches score half / two-thirds", () => {
    expect(scoreGenreMatch("tense", MUSIC_CATEGORIES.find((c) => c.id === "dramatic")!)).toBe(15);
    expect(scoreGenreMatch("startup", MUSIC_CATEGORIES.find((c) => c.id === "corporate")!)).toBe(20);
  });

  test("no affinity scores 0", () => {
    expect(scoreGenreMatch("cinematic", MUSIC_CATEGORIES.find((c) => c.id === "technology")!)).toBe(0);
    expect(scoreGenreMatch(undefined, MUSIC_CATEGORIES[0])).toBe(0);
    expect(scoreGenreMatch("  ", MUSIC_CATEGORIES[0])).toBe(0);
  });
});

describe("selectMusic", () => {
  test("topic technology + emotion focused ranks technology top with corporate near top", () => {
    const { ranked, top } = selectMusic({ topic: "technology", emotion: "focused" });
    expect(top.categoryId).toBe("technology");
    expect(top.score).toBeGreaterThan(10);
    const top3 = ranked.slice(0, 3).map((r) => r.categoryId);
    expect(top3).toContain("corporate");
    // Deterministic tiebreak: descending score, ascending id.
    for (let i = 1; i < ranked.length; i++) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    }
  });

  test("explicit genre can override the heuristic top pick", () => {
    const { top } = selectMusic({ topic: "technology", emotion: "focused", genre: "corporate" });
    expect(top.categoryId).toBe("corporate");
  });

  test("scene type finale favors epic/cinematic", () => {
    const { top } = selectMusic({ sceneType: "finale", emotion: "epic" });
    expect(["epic", "cinematic", "inspirational"]).toContain(top.categoryId);
  });

  test("selection is deterministic for identical inputs", () => {
    const a = selectMusic({ topic: "travel vlog", emotion: "happy", pace: "fast" });
    const b = selectMusic({ topic: "travel vlog", emotion: "happy", pace: "fast" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.ranked.length).toBe(15);
    expect(a.top).toEqual(b.top);
  });

  test("every ranked entry has a reason and a numeric score", () => {
    const { ranked } = selectMusic({ topic: "deep sea mystery", emotion: "tense", pace: "slow" });
    for (const r of ranked) {
      expect(typeof r.score).toBe("number");
      expect(r.reason.length).toBeGreaterThan(0);
      expect(r.categoryId.length).toBeGreaterThan(0);
    }
  });
});