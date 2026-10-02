import { describe, expect, test } from "bun:test";
import {
  EditorError,
  MIN_CLIP_MS,
  TIMELINE_VERSION,
  addScene,
  adjustVolume,
  changeDuration,
  clipById,
  clipsAt,
  deleteClip,
  duplicateClip,
  formatMs,
  isAudioTrack,
  isSequentialTrack,
  removeScene,
  reorderClip,
  replaceClip,
  sceneDurationMs,
  splitClip,
  timelineDurationMs,
  timelinesEqual,
  trimClip,
  buildTimelineFromScenes,
  type SceneInput,
  type Timeline,
  type TrackId,
} from "../timeline";

/**
 * Phase 5 Block 1 — timeline engine tests.
 *
 * The engine is pure: every op returns `{ timeline, changed }`, never mutates
 * its input, and throws a typed `EditorError` on invalid input. These tests pin
 * those invariants down plus the documented defaults (5 s scene clips, derived
 * voice/subtitle lanes, sequential overlap snapping).
 */

const ONE_SCENE: SceneInput[] = [{ id: "s1", title: "Intro", narration: "Hello world", durationSeconds: 5 }];

function withNarration(): Timeline {
  return buildTimelineFromScenes(ONE_SCENE);
}

function codeOf(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    return err instanceof EditorError ? err.code : `not-editor-error:${String(err)}`;
  }
  return "no-error";
}

describe("buildTimelineFromScenes — documented defaults", () => {
  test("one scene → video clip of durationSeconds + voice + subtitle clips", () => {
    const timeline = withNarration();
    expect(timeline.version).toBe(TIMELINE_VERSION);
    expect(timeline.durationMs).toBe(5000);
    expect(timeline.clips.length).toBe(3);

    const video = clipsAt(timeline, "video");
    expect(video.length).toBe(1);
    expect(video[0].id).toBe("sc-s1-video");
    expect(video[0].name).toBe("Intro");
    expect(video[0].startMs).toBe(0);
    expect(video[0].endMs).toBe(5000);
    expect(video[0].sceneId).toBe("s1");
    expect(video[0].sourceRef).toBe("scene:s1");

    const voice = clipsAt(timeline, "voice");
    expect(voice.length).toBe(1);
    expect(voice[0].id).toBe("sc-s1-voice");
    expect(voice[0].sourceRef).toBe("voice:auto");
    expect(voice[0].startMs).toBe(0);
    expect(voice[0].endMs).toBe(5000);

    const subtitles = clipsAt(timeline, "subtitles");
    expect(subtitles.length).toBe(1);
    expect(subtitles[0].id).toBe("sc-s1-subtitles");
    expect(subtitles[0].sourceRef).toBe("subtitle:auto");
  });

  test("scenes are laid out back-to-back; a scene without narration gets no voice clip", () => {
    const timeline = buildTimelineFromScenes([
      { id: "s1", title: "Intro", narration: "spoken", durationSeconds: 4 },
      { id: "s2", title: "Silent", narration: null, durationSeconds: null },
    ]);
    const video = clipsAt(timeline, "video");
    expect(video.map((c) => [c.startMs, c.endMs])).toEqual([
      [0, 4000],
      [4000, 9000],
    ]);
    expect(timeline.durationMs).toBe(9000);
    expect(clipsAt(timeline, "voice").map((c) => c.id)).toEqual(["sc-s1-voice"]);
    expect(clipsAt(timeline, "subtitles").length).toBe(2);
  });

  test("missing/zero durationSeconds falls back to 5 s and building twice is deterministic", () => {
    expect(sceneDurationMs({ id: "x" })).toBe(5000);
    expect(sceneDurationMs({ id: "x", durationSeconds: 0 })).toBe(5000);
    expect(sceneDurationMs({ id: "x", durationSeconds: -3 })).toBe(5000);
    expect(sceneDurationMs({ id: "x", durationSeconds: 2 })).toBe(2000);
    const scenes: SceneInput[] = [
      { id: "a", title: "A", narration: "n", durationSeconds: 2 },
      { id: "b" },
    ];
    expect(timelinesEqual(buildTimelineFromScenes(scenes), buildTimelineFromScenes(scenes))).toBe(true);
    expect(clipsAt(buildTimelineFromScenes(scenes), "video")[1].name).toBe("Scene 2");
  });

  test("duplicate scene ids are rejected", () => {
    expect(codeOf(() => buildTimelineFromScenes([{ id: "s1" }, { id: "s1" }]))).toBe("invalid_input");
    expect(codeOf(() => buildTimelineFromScenes([{ id: "  " }]))).toBe("invalid_input");
  });
});

describe("trimClip", () => {
  test("sets absolute in/out points and never mutates the input timeline", () => {
    const timeline = withNarration();
    const before = JSON.stringify(timeline);
    const result = trimClip(timeline, { clipId: "sc-s1-video", startMs: 1000, endMs: 3000 });
    expect(result.changed).toBe(true);
    const clip = clipById(result.timeline, "sc-s1-video")!;
    expect(clip.startMs).toBe(1000);
    expect(clip.endMs).toBe(3000);
    // the input timeline is untouched (same object graph as before)
    expect(JSON.stringify(timeline)).toBe(before);
    expect(clipById(timeline, "sc-s1-video")!.startMs).toBe(0);
    expect(clipById(timeline, "sc-s1-video")!.endMs).toBe(5000);
    // derived duration follows the clips
    expect(result.timeline.durationMs).toBe(timelineDurationMs(result.timeline));
  });

  test("clamps to at least MIN_CLIP_MS instead of inverting the clip", () => {
    const timeline = withNarration();
    const result = trimClip(timeline, { clipId: "sc-s1-video", startMs: 99_999, endMs: -50 });
    const clip = clipById(result.timeline, "sc-s1-video")!;
    expect(clip.startMs).toBe(5000 - MIN_CLIP_MS);
    expect(clip.endMs).toBe(5000);
    expect(clip.endMs - clip.startMs).toBe(MIN_CLIP_MS);
    expect(clip.endMs).toBeGreaterThan(clip.startMs);
  });

  test("a trim that changes nothing is a no-op returning the same timeline", () => {
    const timeline = withNarration();
    const result = trimClip(timeline, { clipId: "sc-s1-video" });
    expect(result.changed).toBe(false);
    expect(result.timeline).toBe(timeline);
  });
});

describe("splitClip", () => {
  test("produces two adjacent clips covering the original span", () => {
    const timeline = withNarration();
    const before = JSON.stringify(timeline);
    const result = splitClip(timeline, { clipId: "sc-s1-video", atMs: 2000 });
    const first = clipById(result.timeline, "sc-s1-video")!;
    const second = clipById(result.timeline, "sc-s1-video-b")!;
    expect(first.startMs).toBe(0);
    expect(first.endMs).toBe(2000);
    expect(second.startMs).toBe(2000);
    expect(second.endMs).toBe(5000);
    expect(second.name).toBe("Intro (2)");
    expect(second.trackId).toBe("video");
    expect(clipsAt(result.timeline, "video").length).toBe(2);
    expect(result.timeline.clips.length).toBe(timeline.clips.length + 1);
    expect(JSON.stringify(timeline)).toBe(before);
  });

  test("a split point on (or beyond) an edge is invalid_split_point", () => {
    const timeline = withNarration();
    expect(codeOf(() => splitClip(timeline, { clipId: "sc-s1-video", atMs: 0 }))).toBe("invalid_split_point");
    expect(codeOf(() => splitClip(timeline, { clipId: "sc-s1-video", atMs: 5000 }))).toBe("invalid_split_point");
    expect(codeOf(() => splitClip(timeline, { clipId: "sc-s1-video", atMs: 9000 }))).toBe("invalid_split_point");
  });
});

describe("deleteClip / duplicateClip / replaceClip", () => {
  test("deleteClip removes the clip and rebuilds the duration", () => {
    const timeline = withNarration();
    const result = deleteClip(timeline, { clipId: "sc-s1-video" });
    expect(result.changed).toBe(true);
    expect(clipById(result.timeline, "sc-s1-video")).toBeNull();
    expect(result.timeline.clips.length).toBe(timeline.clips.length - 1);
    expect(clipsAt(result.timeline, "video").length).toBe(0);
  });

  test("duplicateClip copies the clip with a NEW id and the same span", () => {
    const timeline = withNarration();
    const source = clipById(timeline, "sc-s1-video")!;
    const result = duplicateClip(timeline, { clipId: source.id });
    const copy = clipById(result.timeline, "sc-s1-video-copy")!;
    expect(copy).not.toBeNull();
    expect(copy.id).not.toBe(source.id);
    expect(copy.name).toBe(`${source.name} copy`);
    expect(copy.trackId).toBe(source.trackId);
    expect(copy.endMs - copy.startMs).toBe(source.endMs - source.startMs);
    expect(copy.startMs).toBe(source.endMs); // default: placed right after the source
    expect(result.timeline.clips.length).toBe(timeline.clips.length + 1);
    // duplicating the copy gets a deterministic colliding-safe id
    const second = duplicateClip(result.timeline, { clipId: copy.id });
    expect(clipById(second.timeline, "sc-s1-video-copy-copy")).not.toBeNull();
  });

  test("replaceClip preserves id, track and span while swapping content", () => {
    const timeline = withNarration();
    const source = clipById(timeline, "sc-s1-video")!;
    const result = replaceClip(timeline, {
      clipId: source.id,
      name: "Opening shot",
      sourceRef: "asset:abc",
    });
    const clip = clipById(result.timeline, source.id)!;
    expect(clip.id).toBe(source.id);
    expect(clip.trackId).toBe(source.trackId);
    expect(clip.startMs).toBe(source.startMs);
    expect(clip.endMs).toBe(source.endMs);
    expect(clip.sceneId).toBe(source.sceneId);
    expect(clip.name).toBe("Opening shot");
    expect(clip.sourceRef).toBe("asset:abc");
    // an empty name is rejected
    expect(codeOf(() => replaceClip(timeline, { clipId: source.id, name: "   " }))).toBe("invalid_input");
  });
});

describe("reorderClip", () => {
  test("moves a clip to another (overlay) track at the requested position", () => {
    const timeline = withNarration();
    const result = reorderClip(timeline, { clipId: "sc-s1-video", trackId: "broll", startMs: 1234 });
    const clip = clipById(result.timeline, "sc-s1-video")!;
    expect(clip.trackId).toBe("broll");
    expect(clip.startMs).toBe(1234);
    expect(clip.endMs).toBe(1234 + 5000);
    expect(clipsAt(result.timeline, "broll").length).toBe(1);
    expect(clipsAt(result.timeline, "video").length).toBe(0);
    expect(timeline.clips.length).toBe(result.timeline.clips.length);
  });

  test("sequential tracks snap the clip forward to the first free slot", () => {
    const timeline = buildTimelineFromScenes([
      { id: "s1", title: "One", narration: "a", durationSeconds: 5 },
      { id: "s2", title: "Two", narration: "b", durationSeconds: 5 },
    ]);
    // move s1's voice clip onto the occupied start of the voice lane
    const result = reorderClip(timeline, { clipId: "sc-s1-voice", trackId: "voice", startMs: 3000 });
    const clip = clipById(result.timeline, "sc-s1-voice")!;
    expect(clip.trackId).toBe("voice");
    expect(clip.startMs).toBe(10_000); // pushed after the 5000-10000 voice clip
    expect(clip.endMs).toBe(15_000);
    expect(clipsAt(result.timeline, "voice").map((c) => [c.startMs, c.endMs])).toEqual([
      [5000, 10_000],
      [10_000, 15_000],
    ]);
    expect(isSequentialTrack("voice")).toBe(true);
    expect(isSequentialTrack("music")).toBe(false);
  });

  test("moving a clip to where it already is does nothing", () => {
    const timeline = withNarration();
    const result = reorderClip(timeline, { clipId: "sc-s1-video", trackId: "video", startMs: 0 });
    expect(result.changed).toBe(false);
    expect(result.timeline).toBe(timeline);
  });

  test("negative positions are clamped to 0", () => {
    const timeline = withNarration();
    const result = reorderClip(timeline, { clipId: "sc-s1-video", trackId: "images", startMs: -900 });
    expect(clipById(result.timeline, "sc-s1-video")!.startMs).toBe(0);
  });
});

describe("changeDuration", () => {
  test("keeps the start and moves the end", () => {
    const timeline = withNarration();
    const result = changeDuration(timeline, { clipId: "sc-s1-video", durationMs: 2500 });
    const clip = clipById(result.timeline, "sc-s1-video")!;
    expect(clip.startMs).toBe(0);
    expect(clip.endMs).toBe(2500);
    expect(result.timeline.durationMs).toBe(timelineDurationMs(result.timeline));
  });

  test("rejects a negative duration and clamps 0 up to MIN_CLIP_MS", () => {
    const timeline = withNarration();
    expect(codeOf(() => changeDuration(timeline, { clipId: "sc-s1-video", durationMs: -1 }))).toBe("invalid_duration");
    const zero = changeDuration(timeline, { clipId: "sc-s1-video", durationMs: 0 });
    const clip = clipById(zero.timeline, "sc-s1-video")!;
    expect(clip.endMs - clip.startMs).toBe(MIN_CLIP_MS);
  });
});

describe("adjustVolume", () => {
  test("clamps gain to 0-1 on audio tracks", () => {
    const timeline = withNarration();
    const mid = adjustVolume(timeline, { clipId: "sc-s1-voice", gain: 0.5 });
    expect(mid.changed).toBe(true);
    expect(clipById(mid.timeline, "sc-s1-voice")!.gain).toBe(0.5);

    const loud = adjustVolume(mid.timeline, { clipId: "sc-s1-voice", gain: 9 });
    expect(clipById(loud.timeline, "sc-s1-voice")!.gain).toBe(1);

    const quiet = adjustVolume(loud.timeline, { clipId: "sc-s1-voice", gain: -4 });
    expect(clipById(quiet.timeline, "sc-s1-voice")!.gain).toBe(0);

    expect(isAudioTrack("music")).toBe(true);
    expect(isAudioTrack("video")).toBe(false);
  });

  test("is a documented no-op on non-audio tracks", () => {
    const timeline = withNarration();
    const result = adjustVolume(timeline, { clipId: "sc-s1-video", gain: 0.2 });
    expect(result.changed).toBe(false);
    expect(result.timeline).toBe(timeline);
    expect(clipById(result.timeline, "sc-s1-video")!.gain).toBeUndefined();
  });
});

describe("addScene / removeScene", () => {
  test("addScene appends a scene's clips after the existing content", () => {
    const timeline = withNarration();
    const result = addScene(timeline, { scene: { id: "s2", title: "Second", narration: "more", durationSeconds: 3 } });
    expect(result.changed).toBe(true);
    expect(result.timeline.clips.length).toBe(timeline.clips.length + 3);
    const video = clipById(result.timeline, "sc-s2-video")!;
    expect(video.startMs).toBe(5000);
    expect(video.endMs).toBe(8000);
    expect(video.sceneId).toBe("s2");
    expect(clipById(result.timeline, "sc-s2-voice")).not.toBeNull();
    expect(clipById(result.timeline, "sc-s2-subtitles")).not.toBeNull();
  });

  test("a scene without narration adds 2 clips; a duplicate scene is rejected", () => {
    const timeline = withNarration();
    const result = addScene(timeline, { scene: { id: "s3", durationSeconds: 2 } });
    expect(result.timeline.clips.length).toBe(timeline.clips.length + 2);
    expect(clipById(result.timeline, "sc-s3-voice")).toBeNull();
    expect(codeOf(() => addScene(timeline, { scene: { id: "s1" } }))).toBe("duplicate_clip");
  });

  test("removeScene drops every clip derived from the scene", () => {
    const timeline = buildTimelineFromScenes([
      { id: "s1", title: "One", narration: "a", durationSeconds: 5 },
      { id: "s2", title: "Two", narration: "b", durationSeconds: 3 },
    ]);
    const result = removeScene(timeline, { sceneId: "s1" });
    expect(result.changed).toBe(true);
    expect(result.timeline.clips.some((c) => c.sceneId === "s1")).toBe(false);
    expect(clipById(result.timeline, "sc-s2-video")).not.toBeNull();
    // the remaining clips keep their positions (gaps are legal)
    expect(clipById(result.timeline, "sc-s2-video")!.startMs).toBe(5000);
    expect(codeOf(() => removeScene(timeline, { sceneId: "nope" }))).toBe("scene_not_found");
  });
});

describe("typed errors", () => {
  test("unknown clip and unknown track report machine-readable codes", () => {
    const timeline = withNarration();
    expect(codeOf(() => trimClip(timeline, { clipId: "nope", startMs: 0 }))).toBe("clip_not_found");
    expect(codeOf(() => deleteClip(timeline, { clipId: "nope" }))).toBe("clip_not_found");
    expect(codeOf(() => changeDuration(timeline, { clipId: "nope", durationMs: 10 }))).toBe("clip_not_found");
    expect(codeOf(() => clipsAt(timeline, "nope" as TrackId))).toBe("unknown_track");
    expect(codeOf(() => reorderClip(timeline, { clipId: "sc-s1-video", trackId: "nope" as TrackId, startMs: 0 }))).toBe(
      "unknown_track",
    );
    try {
      trimClip(timeline, { clipId: "nope", startMs: 0 });
    } catch (err) {
      expect(err).toBeInstanceOf(EditorError);
      expect((err as EditorError).name).toBe("EditorError");
    }
  });

  test("formatMs is a plain timecode helper", () => {
    expect(formatMs(0)).toBe("0:00.000");
    expect(formatMs(65_250)).toBe("1:05.250");
  });
});
