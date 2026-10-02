import { describe, expect, test } from "bun:test";
import {
  buildSubtitles,
  chunkIntoPieces,
  DEFAULT_MAX_LINE_LENGTH,
  DEFAULT_SAFE_MARGINS,
  formatSrtTime,
  toSrt,
  wrapLines,
  type SegmentTimingView,
  type SubtitlePlan,
} from "../engine";

/**
 * Phase 4 Block 3 — Subtitle engine tests (deterministic layer).
 * Rules under test: monotonic ESTIMATE word timing inside segment boundaries,
 * line breaks ≤ maxLineLength without mid-word splits, emphasis from the
 * voice plan + keyword dictionary, explicit timing honored, dynamic captions,
 * and a real SRT render.
 */

const SAMPLE = "Welcome to the future. This changes everything — you will remember this moment.";

/** Strip surrounding punctuation — matches the engine's own clean-token identity. */
function cleanToken(word: string): string {
  return word.replace(/^[(""'`]+|[)"''`.,!?:;…]+$/g, "");
}

describe("pure-text path (voice director fallback)", () => {
  test("produces cues with per-word timing", () => {
    const plan = buildSubtitles({ text: SAMPLE });
    expect(plan.cues.length).toBeGreaterThan(0);
    for (const cue of plan.cues) {
      expect(cue.words.length).toBeGreaterThan(0);
      cue.words.forEach((w) => {
        expect(w.startMs).toBeGreaterThanOrEqual(cue.startMs);
        expect(w.endMs).toBeLessThanOrEqual(cue.endMs);
      });
    }
  });

  test("timing model is labeled ESTIMATE", () => {
    const plan = buildSubtitles({ text: SAMPLE });
    expect(plan.timingModel).toContain("ESTIMATE");
  });

  test("word timing is monotonic and non-overlapping, last word ends the cue", () => {
    const plan = buildSubtitles({ text: SAMPLE });
    for (const cue of plan.cues) {
      for (let i = 1; i < cue.words.length; i++) {
        expect(cue.words[i].startMs).toBeGreaterThanOrEqual(cue.words[i - 1].endMs);
      }
      expect(cue.words[cue.words.length - 1].endMs).toBe(cue.endMs);
      expect(cue.words[0].startMs).toBe(cue.startMs);
    }
  });

  test("keyword emphasis marks future / everything (deterministic dictionary)", () => {
    const plan = buildSubtitles({ text: SAMPLE });
    const emphasized = plan.cues.flatMap((c) =>
      c.words.filter((w) => w.emphasis).map((w) => cleanToken(w.word).toLowerCase()),
    );
    expect(emphasized).toContain("future");
    expect(emphasized).toContain("everything");
  });

  test("defaults: maxLineLength 42, safe margins 48/48, language en, style minimal", () => {
    const plan = buildSubtitles({ text: "Hello world." });
    expect(plan.maxLineLength).toBe(DEFAULT_MAX_LINE_LENGTH);
    expect(plan.safeMargins.x).toBe(DEFAULT_SAFE_MARGINS.x);
    expect(plan.safeMargins.y).toBe(DEFAULT_SAFE_MARGINS.y);
    expect(plan.language).toBe("en");
    expect(plan.style).toBe("minimal");
  });
});

describe("line breaking", () => {
  test("every wrapped line stays ≤ maxLineLength", () => {
    const plan = buildSubtitles({ text: SAMPLE });
    for (const cue of plan.cues) {
      for (const line of cue.text.split("\n")) {
        expect(line.length).toBeLessThanOrEqual(plan.maxLineLength);
      }
    }
  });

  test("custom maxLineLength is honored", () => {
    const plan = buildSubtitles({ text: "One two three four five six seven eight.", maxLineLength: 12 });
    for (const cue of plan.cues) {
      for (const line of cue.text.split("\n")) {
        expect(line.length).toBeLessThanOrEqual(12);
      }
    }
  });

  test("wrapLines never splits a word and is deterministic", () => {
    const lines = wrapLines("The quick brown fox jumps over the lazy dog", 10);
    expect(lines.join(" ").replace(/\s+/g, " ")).toBe("The quick brown fox jumps over the lazy dog");
    expect(wrapLines("The quick brown fox jumps over the lazy dog", 10)).toEqual(lines);
  });
});

describe("dynamic captions", () => {
  test("long text splits into multiple on-screen pieces of ≤ 2 lines", () => {
    const long =
      "This is a very long caption sentence that contains a great many words and will definitely " +
      "need to be split into multiple on-screen pieces so that viewers can read it comfortably " +
      "on a mobile phone without squinting.";
    const plan = buildSubtitles({ text: long });
    expect(plan.cues.length).toBeGreaterThan(1);
    for (const cue of plan.cues) {
      expect(cue.text.split("\n").length).toBeLessThanOrEqual(2);
    }
  });
});

describe("voice plan segments", () => {
  const directorSegments = [
    {
      startIndex: 0,
      endIndex: 21,
      text: "Welcome to the future.",
      spokenText: "Welcome to the future.",
      direction: "narrative" as const,
      pace: "normal" as const,
      emotion: "neutral",
      intensity: 40,
      emphasis: ["Welcome", "future"],
      pauseBeforeMs: 400,
      pauseAfterMs: 500,
      speakingRate: 1,
    },
    {
      startIndex: 22,
      endIndex: 56,
      text: "This changes everything.",
      spokenText: "This changes everything.",
      direction: "dramatic" as const,
      pace: "normal" as const,
      emotion: "intense",
      intensity: 80,
      emphasis: ["everything"],
      pauseBeforeMs: 700,
      pauseAfterMs: 800,
      speakingRate: 1,
    },
  ];

  test("emphasis from the voice plan marks plan words", () => {
    const plan = buildSubtitles({ text: "Welcome to the future. This changes everything.", segments: directorSegments });
    const emphasized = plan.cues.flatMap((c) =>
      c.words.filter((w) => w.emphasis).map((w) => cleanToken(w.word).toLowerCase()),
    );
    expect(emphasized).toContain("welcome");
    expect(emphasized).toContain("future");
    expect(emphasized).toContain("everything");
  });

  test("sentence timing derives from segment boundaries (startIndex segments placed sequentially)", () => {
    const plan = buildSubtitles({ text: "Welcome to the future. This changes everything.", segments: directorSegments });
    expect(plan.cues.length).toBe(2);
    // Segments are placed sequentially: each starts after the previous speech
    // ends, at cursor + its own pauseBeforeMs, where cursor already advanced by
    // the previous segment's pauseAfterMs — the same model the music ducking
    // engine uses, so subtitle boundaries agree with the ducking timeline.
    expect(plan.cues[0].startMs).toBe(directorSegments[0].pauseBeforeMs); // 400
    expect(plan.cues[1].startMs).toBe(
      plan.cues[0].endMs + directorSegments[0].pauseAfterMs + directorSegments[1].pauseBeforeMs,
    );
  });
});

describe("explicit timing view", () => {
  const timedSegments: SegmentTimingView[] = [
    { startMs: 1000, endMs: 4000, text: "First sentence here." },
    { startMs: 4500, endMs: 8500, text: "Second sentence follows." },
  ];

  test("cue boundaries equal the explicit startMs/endMs", () => {
    const plan: SubtitlePlan = buildSubtitles({ segments: timedSegments });
    expect(plan.cues.length).toBe(2);
    expect(plan.timingModel).toContain("EXPLICIT");
    expect(plan.cues[0].startMs).toBe(1000);
    expect(plan.cues[0].endMs).toBe(4000);
    expect(plan.cues[1].startMs).toBe(4500);
    expect(plan.cues[1].endMs).toBe(8500);
  });

  test("explicit segment words stay inside the explicit window", () => {
    const plan = buildSubtitles({ segments: timedSegments });
    expect(plan.cues[0].words[0].startMs).toBeGreaterThanOrEqual(1000);
    expect(plan.cues[0].words[plan.cues[0].words.length - 1].endMs).toBeLessThanOrEqual(4000);
  });
});

describe("SRT rendering", () => {
  test("toSrt produces a real, parseable SRT string from the plan", () => {
    const plan = buildSubtitles({ text: SAMPLE });
    const srt = toSrt(plan);
    expect(srt).toContain("1\n00:00:");
    expect(srt).toContain("-->");
    expect(srt).toContain("Welcome to the future.");
    const cues = srt.split("\n\n").filter(Boolean);
    expect(cues.length).toBe(plan.cues.length);
    // Every timestamp matches SRT's HH:MM:SS,mmm format.
    expect(srt).toMatch(/\d{2}:\d{2}:\d{2},\d{3} --> \d{2}:\d{2}:\d{2},\d{3}/);
  });

  test("formatSrtTime pads correctly", () => {
    expect(formatSrtTime(0)).toBe("00:00:00,000");
    expect(formatSrtTime(61_500)).toBe("00:01:01,500");
    expect(formatSrtTime(3_661_234)).toBe("01:01:01,234");
  });

  test("empty input produces zero cues and an informative model", () => {
    const plan = buildSubtitles({});
    expect(plan.cues).toEqual([]);
    expect(plan.timingModel).toContain("No text or segments");
  });
});

describe("chunkIntoPieces helper", () => {
  test("groups lines into ≤ 2-line pieces", () => {
    const pieces = chunkIntoPieces(["a", "b", "c", "d", "e"], [
      { word: "a", startMs: 0, endMs: 100, emphasis: false },
      { word: "b", startMs: 100, endMs: 200, emphasis: false },
      { word: "c", startMs: 200, endMs: 300, emphasis: false },
      { word: "d", startMs: 300, endMs: 400, emphasis: false },
      { word: "e", startMs: 400, endMs: 500, emphasis: false },
    ]);
    expect(pieces.length).toBe(3);
    expect(pieces[0].text).toBe("a\nb");
    expect(pieces[1].text).toBe("c\nd");
    expect(pieces[2].text).toBe("e");
  });
});