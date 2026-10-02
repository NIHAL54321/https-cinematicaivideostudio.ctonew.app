import { describe, expect, test } from "bun:test";
import {
  buildPronunciationLexicon,
  directVoice,
  listVoices,
  normalizeSpokenText,
  validatePronunciations,
  voicePersonas,
} from "@/lib/voice";

/**
 * Phase 4 Block 1 — Voice Studio API contract (deterministic layer).
 * Exercises the same lib calls the route uses so the contract holds even
 * when no TTS provider is connected.
 */
describe("voice studio contract", () => {
  test("catalog returns voices + personas", () => {
    const voices = listVoices();
    const personas = voicePersonas();
    expect(voices.length).toBeGreaterThan(0);
    expect(personas.length).toBeGreaterThan(0);
    expect(voices.every((v) => v.id && v.name && v.persona)).toBe(true);
  });

  test("direct plan has dramatic/energetic segments + spoken year", () => {
    const script = "In 2024, NASA announced a breakthrough. This is huge — it will change everything!";
    const plan = directVoice(script, { language: "en", corrections: {} });
    const spoken = normalizeSpokenText(script, {});
    expect(spoken).toContain("twenty twenty four");
    expect(plan.segments.length).toBeGreaterThanOrEqual(2);
    const dirs = plan.segments.map((s) => s.direction);
    expect(dirs.some((d) => d === "dramatic" || d === "energetic")).toBe(true);
    expect(plan.estimatedDurationMs).toBeGreaterThan(0);
    for (const s of plan.segments) {
      expect(s.pauseBeforeMs).toBeGreaterThanOrEqual(0);
      expect(s.pauseAfterMs).toBeGreaterThanOrEqual(0);
      expect(s.speakingRate).toBeGreaterThanOrEqual(0.5);
    }
  });

  test("pronounce normalizes currency + builds lexicon", () => {
    const text = "$1,250 for the Tesla Model S, due €10,000";
    const corrections = { Tesla: "TESS-luh", NASA: "Nasa" };
    const spoken = normalizeSpokenText(text, corrections);
    expect(spoken).not.toContain("$1,250");
    expect(spoken).not.toContain("€10,000");
    expect(spoken).toContain("TESS-luh");
    const lexicon = buildPronunciationLexicon({ corrections });
    expect(lexicon.find((l) => l.token === "Tesla")?.phoneticHint).toBe("TESS-luh");
    expect(validatePronunciations(corrections)).toEqual([]);
    expect(validatePronunciations({ "": "x" }).length).toBeGreaterThan(0);
  });
});
