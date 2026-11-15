import { describe, expect, test } from "bun:test";
import { formatSrtTime, formatVttTime, toSrt, toVtt } from "../engine";
import { clockLabel, deriveSceneSubtitles, resolveStyle, type SceneSource } from "../from-scenes";

/**
 * Phase 8 Audio/Subtitle/Thumbnail block — captions derived from a project's own
 * scenes. Rules under test: cues come from the scene narration through the
 * shared engine, in scene order, grouped per scene with one continuous cue
 * numbering; a recorded durationSeconds is an EXPLICIT window and a missing one
 * is the engine's ESTIMATE; a scene with no narration produces no cue and says
 * why; and the SRT and VTT files describe the same cues.
 */

const SCENES: SceneSource[] = [
  { id: "s1", number: 1, title: "Opening", narration: "Welcome to the future. This changes everything.", durationSeconds: 6 },
  { id: "s2", number: 2, title: "Middle", narration: "You will remember this moment.", durationSeconds: 4 },
  { id: "s3", number: 3, title: "Silent", narration: null, durationSeconds: 3 },
];

describe("deriveSceneSubtitles — from the project's own scenes", () => {
  test("groups cues per scene in order, with one continuous cue numbering", () => {
    const d = deriveSceneSubtitles(SCENES, { style: "minimal" });
    expect(d.groups).toHaveLength(3);
    expect(d.groups[0].cues.length).toBeGreaterThan(0);
    expect(d.groups[1].cues.length).toBeGreaterThan(0);
    expect(d.groups[2].cues).toHaveLength(0);
    expect(d.cueCount).toBe(d.groups[0].cues.length + d.groups[1].cues.length);
    expect(d.scenesWithCues).toBe(2);
    expect(d.scenesWithoutNarration).toBe(1);
    // File-wide numbering 1..N, no repeats, no gaps.
    expect(d.plan.cues.map((c) => c.index)).toEqual(Array.from({ length: d.cueCount }, (_, i) => i + 1));
  });

  test("a recorded durationSeconds is an explicit window; scene 2 starts where scene 1 ended", () => {
    const d = deriveSceneSubtitles(SCENES, { style: "minimal" });
    expect(d.timingBasis).toBe("explicit");
    expect(d.groups[0].startMs).toBe(0);
    expect(d.groups[0].endMs).toBe(6000);
    expect(d.groups[1].startMs).toBe(6000);
    expect(d.groups[1].endMs).toBe(10000);
    for (const cue of d.plan.cues) {
      expect(cue.startMs).toBeGreaterThanOrEqual(0);
      expect(cue.endMs).toBeLessThanOrEqual(10000);
    }
  });

  test("a scene with no recorded duration falls back to the engine's estimate and says so", () => {
    const scenes: SceneSource[] = [
      { id: "a", number: 1, title: "A", narration: "First line of narration here.", durationSeconds: null },
      { id: "b", number: 2, title: "B", narration: "Second line of narration here.", durationSeconds: null },
    ];
    const d = deriveSceneSubtitles(scenes, { style: "minimal" });
    expect(d.timingBasis).toBe("estimate");
    expect(d.timingSentence).toContain("ESTIMATE");
    // Sequential, not overlapping: scene 2 begins at or after scene 1 ends.
    expect(d.groups[1].startMs!).toBeGreaterThanOrEqual(d.groups[0].endMs!);
  });

  test("mixed timing names both bases", () => {
    const scenes: SceneSource[] = [
      { id: "a", number: 1, title: "A", narration: "Recorded duration scene.", durationSeconds: 5 },
      { id: "b", number: 2, title: "B", narration: "No recorded duration scene.", durationSeconds: null },
    ];
    const d = deriveSceneSubtitles(scenes, { style: "minimal" });
    expect(d.timingBasis).toBe("mixed");
    expect(d.timingSentence).toContain("MIXED");
  });

  test("a scene with no narration yields no cue and the reason names it", () => {
    const d = deriveSceneSubtitles(SCENES, { style: "minimal" });
    const silent = d.groups[2];
    expect(silent.cues).toHaveLength(0);
    expect(silent.missing).toContain("no narration text");
    expect(silent.startMs).toBeNull();
  });

  test("a project with no scenes is empty and says why", () => {
    const d = deriveSceneSubtitles([], { style: "minimal" });
    expect(d.empty).toBe(true);
    expect(d.emptyReason).toContain("no Scene rows");
    expect(toSrt(d.plan)).toBe("");
  });

  test("scenes but no narration anywhere is empty and says why", () => {
    const d = deriveSceneSubtitles([{ id: "x", number: 1, title: "X", narration: "  ", durationSeconds: 2 }]);
    expect(d.empty).toBe(true);
    expect(d.emptyReason).toContain("none carries narration");
  });

  test("the style is the catalog's, and an unknown id is not silently reported as itself", () => {
    expect(resolveStyle("bold").id).toBe("bold");
    expect(resolveStyle("auto").id).toBe(resolveStyle(undefined).id);
    expect(resolveStyle("no-such-style").id).toBe("minimal");
  });
});

describe("SRT and VTT from the same plan", () => {
  test("the two files carry the same cues and times", () => {
    const d = deriveSceneSubtitles(SCENES, { style: "cinematic" });
    const srt = toSrt(d.plan);
    const vtt = toVtt(d.plan);
    expect(vtt.startsWith("WEBVTT\n\n")).toBe(true);
    for (const cue of d.plan.cues) {
      const s = formatSrtTime(cue.startMs);
      const v = formatVttTime(cue.startMs);
      expect(v).toBe(s.replace(",", "."));
      expect(srt).toContain(`${s} --> ${formatSrtTime(cue.endMs)}`);
      expect(vtt).toContain(`${v} --> ${formatVttTime(cue.endMs)}`);
    }
    expect(srt).toContain(d.plan.cues[0].text);
    expect(vtt).toContain(d.plan.cues[0].text);
  });

  test("clockLabel reads m:ss.mmm", () => {
    expect(clockLabel(0)).toBe("0:00.000");
    expect(clockLabel(65_250)).toBe("1:05.250");
  });
});
