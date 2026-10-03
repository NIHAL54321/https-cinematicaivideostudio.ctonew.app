/**
 * Phase 6 Block 3 — sidecar deliverables: timecode correctness (SRT and
 * WebVTT), the real cue/duration counts, the three honest content states, and the
 * per-platform metadata limits. Nothing here may ever invent content.
 */
import { describe, expect, test } from "bun:test";
import type { SubtitleCue, SubtitlePlan } from "../../subtitles/engine";
import {
  MAX_SIDECAR_CHARS,
  SIDECAR_KINDS,
  SIDECAR_TIME_FORMATS,
  buildMetadataSidecar,
  buildSidecarManifest,
  buildSubtitleSidecar,
  byteLength,
  formatVttTime,
  toVtt,
} from "../sidecars";
import type { ChapterBeat } from "../chapters";
import { capabilityEnvHint } from "../../ai/providers/capability-env";

function cue(index: number, startMs: number, endMs: number, text: string): SubtitleCue {
  return { index, startMs, endMs, text, words: [] };
}

function planOf(cues: SubtitleCue[]): SubtitlePlan {
  return {
    cues,
    language: "en",
    style: "minimal",
    maxLineLength: 42,
    safeMargins: { x: 48, y: 48 },
    timingModel: "EXPLICIT: segment startMs/endMs supplied by the caller.",
  };
}

const THIRTY: ChapterBeat = { sceneId: "s1", title: "Intro", startMs: 0, endMs: 30_000 };
const SIXTY: ChapterBeat = { sceneId: "s2", title: "Body", startMs: 30_000, endMs: 60_000 };
const NINETY: ChapterBeat = { sceneId: "s3", title: "Outro", startMs: 60_000, endMs: 90_000 };

describe("sidecar formats", () => {
  test("the declared timecode formats are the real SRT and WebVTT formats", () => {
    expect(SIDECAR_TIME_FORMATS.srt).toBe("HH:MM:SS,mmm");
    expect(SIDECAR_TIME_FORMATS.vtt).toBe("HH:MM:SS.mmm");
    expect(SIDECAR_KINDS).toEqual(["subtitles-srt", "subtitles-vtt", "chapters", "thumbnail", "metadata"]);
  });
  test("WebVTT timecode is the SRT one with a period instead of a comma", () => {
    expect(formatVttTime(0)).toBe("00:00:00.000");
    expect(formatVttTime(2_500)).toBe("00:00:02.500");
    expect(formatVttTime(3_725_000)).toBe("01:02:05.000");
    expect(formatVttTime(-5)).toBe("00:00:00.000");
  });
  test("byteLength counts UTF-8 bytes, not characters", () => {
    expect(byteLength("abc")).toBe(3);
    expect(byteLength("é")).toBe(2);
    expect(byteLength("→")).toBe(3);
  });
  test("a cue-less WebVTT is a real document with its header and nothing else", () => {
    expect(toVtt(planOf([]))).toBe("WEBVTT\n");
  });
});

describe("subtitle sidecar — the single-cue and no-cue cases", () => {
  test("one cue renders a real SRT and a real WebVTT with the same cue", () => {
    const sidecar = buildSubtitleSidecar({
      plan: planOf([cue(1, 0, 2_500, "Hello")]),
      timelineDurationMs: 10_000,
      cueSource: "1 narrated scene",
    });
    expect(sidecar.cueCount).toBe(1);
    expect(sidecar.hasCues).toBe(true);
    expect(sidecar.srt).toBe("1\n00:00:00,000 --> 00:00:02,500\nHello\n");
    expect(sidecar.vtt).toBe("WEBVTT\n\n1\n00:00:00.000 --> 00:00:02.500\nHello\n");
    expect(sidecar.totalCueDurationMs).toBe(2_500);
    expect(sidecar.firstCueStartMs).toBe(0);
    expect(sidecar.lastCueEndMs).toBe(2_500);
    expect(sidecar.spanMs).toBe(2_500);
    expect(sidecar.coveredFractionOfTimeline).toBe(0.25);
    expect(sidecar.srtBytes).toBe(byteLength(sidecar.srt));
    expect(sidecar.outsideTimeline).toBe(0);
  });

  test("zero cues is a real answer: an empty SRT, a header-only VTT, and the reason stated", () => {
    const sidecar = buildSubtitleSidecar({
      plan: planOf([]),
      timelineDurationMs: 90_000,
      cueSource: "0 of 3 scene(s) on the timeline carry narration",
    });
    expect(sidecar.cueCount).toBe(0);
    expect(sidecar.hasCues).toBe(false);
    expect(sidecar.srt).toBe("");
    expect(sidecar.vtt).toBe("WEBVTT\n");
    expect(sidecar.srtBytes).toBe(0);
    expect(sidecar.firstCueStartMs).toBeNull();
    expect(sidecar.lastCueEndMs).toBeNull();
    expect(sidecar.spanMs).toBe(0);
    expect(sidecar.coveredFractionOfTimeline).toBe(0);
    expect(sidecar.note).toContain("No cues");
    expect(sidecar.note).toContain("not a failure");
  });

  test("with no timeline there is no coverage fraction to claim", () => {
    const sidecar = buildSubtitleSidecar({ plan: planOf([cue(1, 0, 1_000, "Hi")]), timelineDurationMs: 0, cueSource: "x" });
    expect(sidecar.coveredFractionOfTimeline).toBeNull();
    expect(sidecar.timelineDurationMs).toBe(0);
  });

  test("cues are reported in time order and cues past the end of the video are counted", () => {
    const sidecar = buildSubtitleSidecar({
      plan: planOf([cue(2, 5_000, 7_000, "Second"), cue(1, 0, 2_000, "First"), cue(3, 9_500, 12_000, "Past the end")]),
      timelineDurationMs: 10_000,
      cueSource: "3 narrated scenes",
    });
    expect(sidecar.firstCueStartMs).toBe(0);
    expect(sidecar.lastCueEndMs).toBe(12_000);
    expect(sidecar.outsideTimeline).toBe(1);
    expect(sidecar.srt.indexOf("First")).toBeLessThan(sidecar.srt.indexOf("Second"));
  });

  test("multi-line cue text is preserved verbatim in both formats", () => {
    const sidecar = buildSubtitleSidecar({
      plan: planOf([cue(1, 0, 1_000, "line one\nline two")]),
      timelineDurationMs: 1_000,
      cueSource: "x",
    });
    expect(sidecar.srt).toContain("line one\nline two");
    expect(sidecar.vtt).toContain("line one\nline two");
  });
});

describe("metadata sidecar — the project's own text and the stated limits", () => {
  test("all three fields present: real counts, no generation required", () => {
    const meta = buildMetadataSidecar({
      title: "A Title",
      description: "A description.",
      tags: ["one", "two"],
      titleSource: "the project's own title field",
      descriptionSource: "the project's own description field",
      tagsSource: "ProjectSettings.seoDefaults.tags",
    });
    expect(meta.title).toBe("A Title");
    expect(meta.counts.titleChars).toBe(7);
    expect(meta.counts.tagCount).toBe(2);
    expect(meta.counts.tagChars).toBe(6);
    expect(meta.hashtags).toEqual(["#one", "#two"]);
    expect(meta.note).toContain("no metadata was generated");
    expect(JSON.parse(meta.json).title).toBe("A Title");
  });

  test("absent fields stay null and are reported as needing generation", () => {
    const meta = buildMetadataSidecar({
      title: null,
      description: null,
      tags: null,
      titleSource: "none",
      descriptionSource: "nothing stored",
      tagsSource: "nothing stored",
    });
    expect(meta.title).toBeNull();
    expect(meta.counts.titleChars).toBeNull();
    expect(meta.tags).toBeNull();
    expect(meta.note).toContain("no title, no description, no tags");
    expect(JSON.parse(meta.json).title).toBeNull();
  });

  test("whitespace-only text is treated as absent, not as content", () => {
    const meta = buildMetadataSidecar({
      title: "   ",
      description: "\n",
      tags: [],
      titleSource: "x",
      descriptionSource: "x",
      tagsSource: "x",
    });
    expect(meta.title).toBeNull();
    expect(meta.description).toBeNull();
    expect(meta.tags).toBeNull();
  });

  test("every platform's published limits are stated verbatim, with their basis", () => {
    const meta = buildMetadataSidecar({ title: "T", description: "D", tags: ["t"], titleSource: "x", descriptionSource: "x", tagsSource: "x" });
    expect(meta.limits.length).toBe(6);
    const youtube = meta.limits.find((l) => l.targetId === "youtube-long-form")!;
    expect(youtube.limits.titleMax).toBe(100);
    expect(youtube.limits.descriptionMax).toBe(5_000);
    expect(youtube.limits.tagsMaxChars).toBe(500);
    expect(youtube.limits.basis).toContain("YouTube's published limits");
    const reels = meta.limits.find((l) => l.targetId === "instagram-reels")!;
    expect(reels.limits.descriptionMax).toBe(2_200);
    expect(reels.limits.tagsMaxCount).toBe(30);
    // A surface with no title field says so instead of inventing a limit.
    expect(reels.limits.titleMax).toBeNull();
    const tiktok = meta.limits.find((l) => l.targetId === "tiktok")!;
    expect(tiktok.limits.titleMax).toBe(2_200);
    expect(tiktok.limits.tagsMaxChars).toBeNull();
  });

  test("the limit CHECKS cover exactly the stated character limits", () => {
    const meta = buildMetadataSidecar({
      title: "T",
      description: "D",
      tags: ["t"],
      titleSource: "x",
      descriptionSource: "x",
      tagsSource: "x",
    });
    // title: 3 targets publish a checkable title limit (YouTube long-form + Shorts share one
    // field, TikTok has a caption) — Instagram publishes NO title field, so nothing is checked
    // there rather than inventing a limit · description: all 6 · tags: 2 publish a length.
    // 3 + 6 + 2 = 11 checks. The count is what the catalogue really states, not a round number.
    expect(meta.checks.length).toBe(11);
    expect(meta.checks.every((c) => c.status === "pass")).toBe(true);
    const over = buildMetadataSidecar({
      title: "x".repeat(101),
      description: "D",
      tags: ["t"],
      titleSource: "x",
      descriptionSource: "x",
      tagsSource: "x",
    });
    const failing = over.checks.filter((c) => c.status === "fail");
    expect(failing.length).toBe(2); // youtube long-form + shorts, both titleMax 100
    expect(failing.every((c) => c.field === "title")).toBe(true);
    expect(failing[0].value).toBe(101);
  });

  test("an absent field reports 'absent' rather than a pass it did not earn", () => {
    const meta = buildMetadataSidecar({ title: null, description: "D", tags: null, titleSource: "x", descriptionSource: "x", tagsSource: "x" });
    const titleChecks = meta.checks.filter((c) => c.field === "title");
    expect(titleChecks.every((c) => c.status === "absent")).toBe(true);
  });
});

describe("the sidecar manifest — three honest content states", () => {
  const metadata = { title: "My Video", description: null, tags: null, titleSource: "the project's own title field", descriptionSource: "nothing stored", tagsSource: "nothing stored" };

  test("a fully-populated project: cue files and chapters EXIST, the thumbnail does not", () => {
    const manifest = buildSidecarManifest({
      projectId: "p1",
      projectTitle: "My Video",
      slug: "my-video",
      durationSeconds: 90,
      plan: planOf([cue(1, 0, 30_000, "Intro talk"), cue(2, 30_000, 60_000, "Body talk")]),
      cueSource: "3 narrated scenes",
      timelineDurationMs: 90_000,
      beats: [THIRTY, SIXTY, NINETY],
      thumbnail: { present: false, assetId: null, name: null, widthPx: null, heightPx: null, status: null },
      metadata,
    });
    expect(manifest.fileCount).toBe(5);
    expect(manifest.counts.exists).toBe(4); // srt, vtt, chapters, metadata
    expect(manifest.counts.requiresGeneration).toBe(1); // thumbnail
    expect(manifest.counts.empty).toBe(0);
    expect(manifest.filesProduced).toBe(0);
    expect(manifest.produced).toBe(false);
    expect(manifest.notProduced.some((n) => n.includes("0 bytes were written"))).toBe(true);
    const srt = manifest.files.find((f) => f.id === "subtitles-srt")!;
    expect(srt.fileName).toBe("my-video.srt");
    expect(srt.contentState).toBe("exists");
    expect(srt.requires).toBeNull();
    expect(srt.produced).toBe(false);
    expect(srt.content).toContain("00:00:00,000 --> 00:00:30,000");
    expect(srt.detail.cueCount).toBe(2);
    const vtt = manifest.files.find((f) => f.id === "subtitles-vtt")!;
    expect(vtt.fileName).toBe("my-video.vtt");
    expect(vtt.content).toContain("WEBVTT");
    expect(vtt.content).toContain("00:00:00.000 --> 00:00:30.000");
    const chapters = manifest.files.find((f) => f.id === "chapters")!;
    expect(chapters.fileName).toBe("my-video-chapters.txt");
    expect(chapters.content).toBe("0:00 Intro\n0:30 Body\n1:00 Outro");
    expect(chapters.detail.meetsYoutubeRequirements).toBe(true);
    const thumb = manifest.files.find((f) => f.id === "thumbnail")!;
    expect(thumb.contentState).toBe("requires-generation");
    expect(thumb.fileName).toBeNull();
    expect(thumb.content).toBeNull();
    // The name(s) come from the engine's derivation for the capability that
    // would generate it (thumbnail_generation), never from a literal here.
    expect(thumb.requiresEnv).toBe(capabilityEnvHint("thumbnail_generation"));
    expect(String(thumb.requiresEnv)).toContain("OPENAI_API_KEY");
    expect(String(thumb.requiresEnv)).not.toContain("IMAGE_PROVIDER_API_KEY");
    expect(thumb.note).toContain("NO THUMBNAIL SELECTED");
    const meta = manifest.files.find((f) => f.id === "metadata")!;
    expect(meta.fileName).toBe("my-video-metadata.json");
    expect(meta.contentState).toBe("exists");
    expect(JSON.parse(String(meta.content)).title).toBe("My Video");
    expect(meta.detail.limitCount).toBe(6);
  });

  test("a project with no narration and no thumbnail: EMPTY cue and chapter slots, not fabricated ones", () => {
    const manifest = buildSidecarManifest({
      projectId: "p1",
      projectTitle: "My Video",
      slug: "my-video",
      durationSeconds: 0,
      plan: planOf([]),
      cueSource: "0 of 0 scene(s) on the timeline carry narration",
      timelineDurationMs: 0,
      beats: [],
      thumbnail: { present: false, assetId: null, name: null, widthPx: null, heightPx: null, status: null },
      metadata,
    });
    const srt = manifest.files.find((f) => f.id === "subtitles-srt")!;
    expect(srt.contentState).toBe("empty");
    expect(srt.content).toBeNull();
    expect(srt.bytes).toBeNull();
    expect(srt.requires).toContain("Narration");
    expect(srt.requiresEnv).toBe(capabilityEnvHint("speech_recognition"));
    expect(String(srt.requiresEnv)).toContain("ELEVENLABS_API_KEY");
    expect(String(srt.requiresEnv)).not.toContain("TRANSCRIPTION_API_KEY");
    const chapters = manifest.files.find((f) => f.id === "chapters")!;
    expect(chapters.contentState).toBe("empty");
    expect(chapters.fileName).toBeNull();
    expect(chapters.requiresEnv).toBeNull();
    expect(manifest.counts.empty).toBe(3); // srt, vtt, chapters
    expect(manifest.counts.exists).toBe(1); // the title alone
    expect(manifest.counts.requiresGeneration).toBe(1); // the thumbnail
    expect(manifest.note).toContain("no content was invented");
  });
  test("a half-filled metadata slot is reported PARTIAL, not rounded up to 'exists'", () => {
    const manifest = buildSidecarManifest({
      projectId: "p1",
      projectTitle: "My Video",
      slug: "my-video",
      durationSeconds: 0,
      plan: planOf([]),
      cueSource: "0 narrated scenes",
      timelineDurationMs: 0,
      beats: [],
      thumbnail: { present: false, assetId: null, name: null, widthPx: null, heightPx: null, status: null },
      metadata: {
        title: "My Video",
        description: null,
        tags: null,
        titleSource: "Project.title",
        descriptionSource: "none — nothing stored",
        tagsSource: "none — nothing stored",
      },
    });
    const meta = manifest.files.find((f) => f.id === "metadata")!;
    // The JSON it carries is real, so the slot is not "empty" — but the two fields
    // the project does not hold are named as needing generation rather than ignored.
    expect(meta.contentState).toBe("exists");
    expect(meta.detail.partial).toBe(true);
    expect(meta.detail.missingFields).toEqual(["description", "tags"]);
    expect(meta.requires).not.toBeNull();
    expect(String(meta.requires)).toContain("PARTIAL");
    expect(meta.requiresEnv).toBe(capabilityEnvHint("seo_generation"));
    expect(String(meta.requiresEnv)).toContain("OPENAI_API_KEY");
    expect(String(meta.requiresEnv)).not.toContain("LLM_PROVIDER_API_KEY");
    expect(meta.note).toContain("PARTIAL");
    expect(manifest.note).toContain("PARTIAL");
    // Nothing was written and no field was invented to fill the gap.
    expect(JSON.parse(String(meta.content)).description).toBeNull();
    expect(meta.produced).toBe(false);
  });

  test("a thumbnail the project owns is a real deliverable and nothing is generated", () => {
    const manifest = buildSidecarManifest({
      projectId: "p1",
      projectTitle: "My Video",
      slug: "my-video",
      durationSeconds: 30,
      plan: planOf([cue(1, 0, 30_000, "Talk")]),
      cueSource: "1 narrated scene",
      timelineDurationMs: 30_000,
      beats: [THIRTY],
      thumbnail: { present: true, assetId: "a1", name: "cover.png", widthPx: 1280, heightPx: 720, status: "READY" },
      metadata,
    });
    const thumb = manifest.files.find((f) => f.id === "thumbnail")!;
    expect(thumb.contentState).toBe("exists");
    expect(thumb.requires).toBeNull();
    expect(thumb.requiresEnv).toBeNull();
    expect(thumb.note).toContain("cover.png");
    expect(thumb.note).toContain("No image was generated");
    expect((manifest.thumbnail as Record<string, unknown>).assetId).toBe("a1");
  });

  test("an oversized render is reported with its real length and truncated honestly", () => {
    const long = "x".repeat(MAX_SIDECAR_CHARS + 100);
    const manifest = buildSidecarManifest({
      projectId: "p1",
      projectTitle: "My Video",
      slug: "my-video",
      durationSeconds: 30,
      plan: planOf([cue(1, 0, 30_000, long)]),
      cueSource: "1 narrated scene",
      timelineDurationMs: 30_000,
      beats: [THIRTY],
      thumbnail: { present: true, assetId: "a1", name: "c.png", widthPx: 1, heightPx: 1, status: "READY" },
      metadata,
    });
    const srt = manifest.files.find((f) => f.id === "subtitles-srt")!;
    expect(srt.truncated).toBe(true);
    expect(String(srt.content)).toContain("[...truncated:");
    expect(srt.bytes).toBeGreaterThan(MAX_SIDECAR_CHARS);
  });

  test("the same input always yields the same manifest", () => {
    const input = {
      projectId: "p1",
      projectTitle: "My Video",
      slug: "my-video",
      durationSeconds: 90,
      plan: planOf([cue(1, 0, 30_000, "Intro")]),
      cueSource: "1 narrated scene",
      timelineDurationMs: 90_000,
      beats: [THIRTY, SIXTY, NINETY] as ChapterBeat[],
      thumbnail: { present: false, assetId: null, name: null, widthPx: null, heightPx: null, status: null },
      metadata,
    };
    expect(JSON.stringify(buildSidecarManifest(input))).toBe(JSON.stringify(buildSidecarManifest(input)));
  });
});
