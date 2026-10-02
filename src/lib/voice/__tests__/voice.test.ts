import { describe, expect, test } from "bun:test";
import {
  VOICE_CATALOG,
  listVoices,
  findVoice,
  voicesByPersona,
  voicePersonas,
  getVoiceRecommendation,
} from "../catalog";
import { SUPPORTED_LANGUAGES, findLanguage, isSupportedLanguage } from "../languages";
import {
  wordToPhoneticHint,
  normalizeSpokenText,
  buildPronunciationLexicon,
  validatePronunciations,
  numberToWords,
} from "../pronunciation";
import { directVoice, computeTiming, splitSegments, extractEmphasis } from "../director";

describe("voice catalog", () => {
  test("covers all Phase 4 personas", () => {
    for (const p of ["male", "female", "young", "mature", "documentary", "narrator", "energetic", "calm", "emotional", "professional", "conversational"]) {
      expect(voicesByPersona(p).length).toBeGreaterThan(0);
    }
  });
  test("catalog has 15-20+ voices with valid ranges", () => {
    expect(VOICE_CATALOG.length).toBeGreaterThanOrEqual(15);
    for (const v of VOICE_CATALOG) {
      expect(v.recommendedPitch).toBeGreaterThanOrEqual(0);
      expect(v.recommendedPitch).toBeLessThanOrEqual(2);
      expect(v.recommendedSpeed).toBeGreaterThanOrEqual(0.5);
      expect(v.recommendedSpeed).toBeLessThanOrEqual(1.5);
    }
  });
  test("listVoices/findVoice round-trip", () => {
    expect(listVoices().length).toBe(VOICE_CATALOG.length);
    expect(findVoice("marcus-deep")?.name).toBe("Marcus");
    expect(findVoice("nope")).toBeNull();
  });
  test("recommendation heuristic is deterministic", () => {
    const a = getVoiceRecommendation({ scriptTone: "documentary history" });
    const b = getVoiceRecommendation({ scriptTone: "documentary history" });
    expect(a.id).toBe(b.id);
    expect(a.persona).toBe("documentary");
    expect(getVoiceRecommendation({ sceneType: "energetic hook" }).persona).toBe("energetic");
    expect(getVoiceRecommendation({ sceneType: "calm sleep story" }).persona).toBe("calm");
    expect(voicePersonas().length).toBeGreaterThan(5);
  });
  test("languages list is modest and additive", () => {
    expect(SUPPORTED_LANGUAGES.length).toBeGreaterThanOrEqual(15);
    expect(isSupportedLanguage("en")).toBe(true);
    expect(findLanguage("JA")?.name).toBe("Japanese");
    expect(isSupportedLanguage("xx")).toBe(false);
  });
});

describe("pronunciation engine", () => {
  test("known tokens return hints, unknown returns null", () => {
    expect(wordToPhoneticHint("NASA")).toContain("N.A.S.A.");
    expect(wordToPhoneticHint("Tesla")).toBeTruthy();
    expect(wordToPhoneticHint("2024")).toBe("twenty twenty four");
    expect(wordToPhoneticHint("$99.99")).toContain("dollars");
    expect(wordToPhoneticHint("banana")).toBeNull();
    expect(wordToPhoneticHint("")).toBeNull();
  });
  test("currency expansion", () => {
    expect(normalizeSpokenText("$1,250")).toBe("one thousand two hundred fifty dollars");
    expect(normalizeSpokenText("due €10,000")).toContain("ten thousand euros");
  });
  test("percentages, years, abbreviations", () => {
    expect(normalizeSpokenText("10%")).toBe("ten percent");
    expect(normalizeSpokenText("In 2024, NASA announced")).toBe("In twenty twenty four, NASA announced");
    expect(normalizeSpokenText("Dr. Smith")).toContain("doctor");
  });
  test("corrections override everything", () => {
    expect(normalizeSpokenText("Read the docs", { docs: "documents" })).toBe("Read the documents");
  });
  test("lexicon build + validation", () => {
    const lex = buildPronunciationLexicon({ companies: ["Tesla"], corrections: { docs: "documents" } });
    expect(lex.find((e) => e.token === "Tesla")?.phoneticHint).toBeTruthy();
    expect(lex.find((e) => e.token === "docs")?.phoneticHint).toBe("documents");
    expect(validatePronunciations({ ok: "fine" })).toEqual([]);
    expect(validatePronunciations({ "": "x" }).length).toBe(1);
    expect(validatePronunciations({ x: "" }).length).toBe(1);
  });
  test("numberToWords sanity", () => {
    expect(numberToWords(0)).toBe("zero");
    expect(numberToWords(1000)).toBe("one thousand");
    expect(numberToWords(3.14)).toBe("three");
  });
});

describe("voice director", () => {
  const SCRIPT = "In 2024, NASA announced a breakthrough. This is huge — it will change everything!";
  test("segments with direction detection + determinism", () => {
    const a = directVoice(SCRIPT, { voiceId: "marcus-deep" });
    const b = directVoice(SCRIPT, { voiceId: "marcus-deep" });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.segments.length).toBe(2);
    expect(a.segments[1].direction).toBe("dramatic");
    expect(a.voice).toBe("marcus-deep");
  });
  test("emphasis extraction finds proper nouns + numbers", () => {
    const e = extractEmphasis("In 2024, NASA announced a breakthrough.");
    expect(e.join(" ")).toMatch(/NASA/);
  });
  test("pause insertion on strong endings", () => {
    const plan = directVoice("Calm down. Wow!");
    expect(plan.segments[1].pauseAfterMs).toBeGreaterThanOrEqual(700);
  });
  test("energy curve + spoken text", () => {
    const plan = directVoice(SCRIPT);
    expect(plan.energy).toBeGreaterThan(0);
    expect(plan.segments[0].spokenText).toContain("twenty twenty four");
    expect(plan.timingModel).toMatch(/ESTIMATE/);
  });
  test("splitSegments handles empty input", () => {
    expect(splitSegments("")).toEqual([]);
    expect(directVoice("").segments).toEqual([]);
    expect(directVoice("").energy).toBe(0);
  });
  test("computeTiming sanity", () => {
    const t = computeTiming({ text: "hello world", speakingRate: 1, pauseBeforeMs: 100, pauseAfterMs: 200 });
    expect(t.durationMs).toBeGreaterThan(300);
    expect(t.model).toBe("ESTIMATE");
  });
});
