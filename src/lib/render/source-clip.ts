/**
 * TURNING A SCENE'S SOURCE INTO SOMETHING THE CONCAT DEMUXER CAN TAKE
 * (Phase 8, block 7b — the first render whose input is real footage).
 *
 * Two things stand between a scene's asset row and a working
 * `-f concat -safe 0 -i timeline.ffconcat`:
 *
 *   1. WHERE THE BYTES ARE. `Asset.s3Key` is an object key in S3-compatible
 *      storage, not a path on this filesystem, and ffmpeg cannot open
 *      `footage/<user>/<id>-<digest>.mp4`. So the encode stage MATERIALISES the
 *      object into its own stage directory and digests what came back. A key is
 *      durable (a machine reset does not lose it); the stage directory is a
 *      cache.
 *   2. WHETHER THE SEGMENTS MATCH. The concat demuxer stitches streams that must
 *      share codec parameters. Stock clips arrive in whatever the provider
 *      serves — a different resolution, a different frame rate, sometimes no
 *      audio track at all. So each clip is normalised to the JOB'S OWN resolved
 *      preset first, and the plan for that normalisation is built from the
 *      preset's numbers rather than typed into an argv here.
 *
 * Nothing in this file decides what the picture should look like. The target
 * comes from `ExportPresetSpec`; the filter string is derived from it and the
 * derived string is recorded, so a reader can check the arithmetic.
 */
import type { ExportPresetSpec } from "@/lib/export/presets";

/** How a `sourcePath` is to be read. */
export type SourcePathKind = "object-key" | "local-path" | "url";

/**
 * `s3Key` is an object key, `url` is a provider address, and the synthetic
 * proof's declared source is an absolute path. The three are not
 * interchangeable, so the stage says which one it has instead of guessing.
 */
export function sourcePathKind(path: string): SourcePathKind {
  if (/^https?:\/\//i.test(path)) return "url";
  if (path.startsWith("/")) return "local-path";
  return "object-key";
}

/** The numbers a timeline segment must share, all taken from the job's preset. */
export interface TimelineTarget {
  widthPx: number;
  heightPx: number;
  frameRate: number;
  pixelFormat: string;
  sampleRateHz: number;
  channels: number;
  /** ffmpeg's `-profile:v` value for the delivery codec, so segments are prepared for it. */
  profile: string;
  /** H.273 names, written on the intermediate too so the final encode is not retagging. */
  colourPrimaries: string;
  colourTransfer: string;
  colourMatrix: string;
  /** Where every number came from, in one sentence per number. */
  basis: Array<{ field: string; value: string | number; from: string }>;
}

export function timelineTargetFromSpec(spec: ExportPresetSpec): TimelineTarget {
  return {
    widthPx: spec.widthPx,
    heightPx: spec.heightPx,
    frameRate: spec.video.frameRate,
    pixelFormat: spec.video.pixelFormat,
    sampleRateHz: spec.audio.sampleRateHz,
    channels: spec.audio.channels,
    profile: spec.video.profile,
    colourPrimaries: spec.colour.h273.primariesName,
    colourTransfer: spec.colour.h273.transferName,
    colourMatrix: spec.colour.h273.matrixName,
    basis: [
      { field: "widthPx", value: spec.widthPx, from: `preset ${spec.id} resolution ${spec.resolution}` },
      { field: "heightPx", value: spec.heightPx, from: `preset ${spec.id} resolution ${spec.resolution}` },
      { field: "frameRate", value: spec.video.frameRate, from: `preset ${spec.id} video.frameRate` },
      { field: "pixelFormat", value: spec.video.pixelFormat, from: `preset ${spec.id} video.pixelFormat` },
      { field: "sampleRateHz", value: spec.audio.sampleRateHz, from: `preset ${spec.id} audio.sampleRateHz` },
      { field: "channels", value: spec.audio.channels, from: `preset ${spec.id} audio.channels` },
      { field: "profile", value: spec.video.profile, from: `preset ${spec.id} video.profile` },
      { field: "colour", value: `${spec.colour.h273.primariesName}/${spec.colour.h273.transferName}/${spec.colour.h273.matrixName}`, from: `preset ${spec.id} colour.h273` },
    ],
  };
}

/**
 * The video filter that makes one clip fit the timeline: fit inside the frame
 * WITHOUT cropping (letterbox/pillarbox), square pixels, the preset's cadence,
 * the preset's pixel format.
 *
 * `force_original_aspect_ratio=decrease` + `pad` is chosen over `crop` on
 * purpose: cropping a stock clip to the delivery aspect would throw away the
 * edges of somebody else's shot, and this build has no framing decision to
 * justify it. A reader can see the whole frame the provider served.
 */
export function timelineVideoFilter(target: TimelineTarget): string {
  const { widthPx: w, heightPx: h } = target;
  return [
    `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos`,
    `pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black`,
    "setsar=1",
    `fps=${target.frameRate}`,
    `format=${target.pixelFormat}`,
  ].join(",");
}

/** The keyframe interval the preset asks for, in frames. Same arithmetic as the delivery encode. */
export function timelineGopFrames(target: TimelineTarget): number {
  return Math.max(1, Math.round(target.frameRate * 2));
}

export interface AudioDecision {
  /** What the clip itself carried. */
  sourceHasAudio: boolean;
  /** What the normalised segment will carry. */
  plan: "clip-audio-kept" | "silent-track-added";
  args: string[];
  /** True when silence was appended because the clip's own sound is shorter than the segment. */
  paddedWithSilence: boolean;
  /** One sentence, printed in the stage record. */
  statement: string;
}

/**
 * HOW A SCENE'S DECLARED DURATION GOVERNS ITS SEGMENT (Phase 8, block 8).
 *
 * Until this block every clip was concatenated IN FULL, so the master's length was
 * the sum of whatever the providers happened to serve — a 600-second script could
 * come out as a 200-second film and nothing said so. A scene's `durationSeconds`
 * is the project's own statement about that scene, so it now decides the segment:
 *
 *   clip LONGER than the scene  → the segment is cut at the scene's duration
 *                                 (`-t`), and the cut amount is recorded;
 *   clip SHORTER than the scene → the last frame is HELD (tpad stop_mode=clone)
 *                                 for exactly the shortfall, and the held amount
 *                                 is recorded. No black, no loop, no invented
 *                                 picture: the same frame stays on screen and the
 *                                 record says for how long;
 *   no declared duration        → the clip plays in full and the record says the
 *                                 scene declared nothing to hold it to.
 *
 * `-t` is written for both cases, so the segment's length is the scene's number
 * rather than a consequence of what the clip happened to be.
 */
export interface SegmentTrim {
  policy: "trimmed-to-scene-duration" | "last-frame-held-to-scene-duration" | "clip-in-full-no-declared-duration";
  /** The scene's own declared duration, or null when it declared none. */
  sceneDurationSeconds: number | null;
  /** What the clip measured before anything was done to it. */
  sourceDurationSeconds: number | null;
  /** What the segment will be, in seconds. */
  segmentDurationSeconds: number;
  /** Seconds cut off the end of the clip (0 when nothing was cut). */
  trimmedSeconds: number;
  /** Seconds the last frame is held (0 when the clip fills the scene on its own). */
  heldSeconds: number;
  /** The exact `-t` value written to the encoder, or null when the segment is untimed. */
  outputLimitSeconds: number | null;
  /** One sentence, in the record, saying what happened and why. */
  basis: string;
}

/** A tenth of a frame at 30 fps — below this a "difference" is rounding, not a trim. */
export const TRIM_TOLERANCE_SECONDS = 0.034;

export function planSegmentTrim(input: {
  sceneDurationSeconds: number | null;
  sourceDurationSeconds: number | null;
}): SegmentTrim {
  const scene = input.sceneDurationSeconds;
  const source = input.sourceDurationSeconds;
  const round = (n: number) => Math.round(n * 1000) / 1000;

  if (scene === null || !Number.isFinite(scene) || scene <= 0) {
    return {
      policy: "clip-in-full-no-declared-duration",
      sceneDurationSeconds: scene,
      sourceDurationSeconds: source,
      segmentDurationSeconds: source ?? 0,
      trimmedSeconds: 0,
      heldSeconds: 0,
      outputLimitSeconds: null,
      basis:
        "this scene declares no duration, so nothing holds the clip to a length and it plays in full — " +
        "the segment's length is whatever the provider served",
    };
  }
  if (source === null || !Number.isFinite(source) || source <= 0) {
    // The clip's length could not be measured, so the scene's duration is the only
    // number there is: the segment is cut to it and the record says the clip's own
    // length is unknown rather than pretending the two agreed.
    return {
      policy: "trimmed-to-scene-duration",
      sceneDurationSeconds: scene,
      sourceDurationSeconds: source,
      segmentDurationSeconds: scene,
      trimmedSeconds: 0,
      heldSeconds: 0,
      outputLimitSeconds: scene,
      basis:
        `the clip's own duration could not be measured, so the segment is cut to the scene's declared ` +
        `${scene} s; how much that removed is not known and is not claimed`,
    };
  }
  if (source > scene + TRIM_TOLERANCE_SECONDS) {
    return {
      policy: "trimmed-to-scene-duration",
      sceneDurationSeconds: scene,
      sourceDurationSeconds: source,
      segmentDurationSeconds: scene,
      trimmedSeconds: round(source - scene),
      heldSeconds: 0,
      outputLimitSeconds: scene,
      basis:
        `the clip is ${round(source)} s and the scene declares ${scene} s, so the segment is CUT at ${scene} s ` +
        `(-t ${scene}); ${round(source - scene)} s of the clip's tail is not in the film`,
    };
  }
  if (source < scene - TRIM_TOLERANCE_SECONDS) {
    return {
      policy: "last-frame-held-to-scene-duration",
      sceneDurationSeconds: scene,
      sourceDurationSeconds: source,
      segmentDurationSeconds: scene,
      trimmedSeconds: 0,
      heldSeconds: round(scene - source),
      outputLimitSeconds: scene,
      basis:
        `the clip is ${round(source)} s and the scene declares ${scene} s, so the clip's LAST FRAME is held for ` +
        `${round(scene - source)} s (tpad stop_mode=clone) to reach ${scene} s — the picture does not move and ` +
        `nothing is filled with black; the held time is stated rather than hidden`,
    };
  }
  return {
    policy: "clip-in-full-no-declared-duration",
    sceneDurationSeconds: scene,
    sourceDurationSeconds: source,
    segmentDurationSeconds: scene,
    trimmedSeconds: 0,
    heldSeconds: 0,
    outputLimitSeconds: scene,
    basis: `the clip is ${round(source)} s and the scene declares ${scene} s — they agree within ${TRIM_TOLERANCE_SECONDS} s, so nothing is cut or held`,
  };
}

export interface NormalisationPlan {
  argv: string[];
  videoFilter: string;
  audio: AudioDecision;
  /** How the scene's declared duration governs this segment. */
  trim: SegmentTrim;
  /** Every arg (or arg group) with the reason it is there. */
  reasons: Array<{ arg: string; reason: string }>;
}

/**
 * The normalisation argv for ONE clip.
 *
 * Audio presence is handled deliberately, not by hoping: a clip with no audio
 * track gets a silent AAC track of the preset's layout so every concat segment
 * has the same stream layout. Concatenating a segment with audio onto one
 * without is a real failure mode of the concat demuxer, and adding silence is
 * the difference between "this clip had no sound" and "this file's sound is
 * broken".
 *
 * LENGTH is handled the same way (block 8): the scene's own declared duration is
 * written to the encoder as `-t`, so the segment is the length the project says
 * the scene is — cut if the clip is longer, last frame held if it is shorter.
 * See `planSegmentTrim` for the three cases and the sentence each one records.
 */
export function planClipNormalisation(input: {
  inputPath: string;
  outputPath: string;
  target: TimelineTarget;
  sourceHasAudio: boolean;
  /** The scene's own `durationSeconds`, or null when it declares none. */
  sceneDurationSeconds?: number | null;
  /** What the clip measured before normalisation, or null when it could not be measured. */
  sourceDurationSeconds?: number | null;
}): NormalisationPlan {
  const { inputPath, outputPath, target, sourceHasAudio } = input;
  const trim = planSegmentTrim({
    sceneDurationSeconds: input.sceneDurationSeconds ?? null,
    sourceDurationSeconds: input.sourceDurationSeconds ?? null,
  });
  const holdFilter = trim.heldSeconds > 0 ? `,tpad=stop_mode=clone:stop_duration=${trim.heldSeconds}` : "";
  const filter = `${timelineVideoFilter(target)}${holdFilter}`;
  const gop = timelineGopFrames(target);
  const channelLayout = target.channels === 1 ? "mono" : "stereo";
  const audioArgs = sourceHasAudio
    ? ["-c:a", "aac", "-b:a", "192k", "-ar", String(target.sampleRateHz), "-ac", String(target.channels)]
    : ["-c:a", "aac", "-b:a", "192k", "-ar", String(target.sampleRateHz), "-ac", String(target.channels)];
  // The clip's own sound is shorter than the segment when the last frame is held:
  // the tail is SILENCE, appended by apad, and the record says so — it is not the
  // clip's sound continued.
  const padAudio = sourceHasAudio && trim.heldSeconds > 0;
  const limitArgs = trim.outputLimitSeconds !== null ? ["-t", String(trim.outputLimitSeconds)] : [];
  // `-shortest` is how an unbounded anullsrc track is cut to the picture. When an
  // explicit `-t` is written there is nothing left to cut, and `-shortest` would
  // fight it (it ends the file at the first stream that runs out).
  const shortestArgs = limitArgs.length === 0 && !sourceHasAudio ? ["-shortest"] : [];

  const argv = [
    "-y",
    "-hide_banner",
    "-i",
    inputPath,
    // A silent track of the preset's own layout, as a second input, when the
    // clip has none. `anullsrc` generates it; nothing is copied from elsewhere.
    ...(sourceHasAudio ? [] : ["-f", "lavfi", "-i", `anullsrc=channel_layout=${channelLayout}:sample_rate=${target.sampleRateHz}`]),
    "-map",
    "0:v:0",
    "-map",
    sourceHasAudio ? "0:a:0" : "1:a:0",
    "-vf",
    filter,
    "-c:v",
    "libx264",
    // An INTERMEDIATE, not the delivery. `veryfast` + CRF 18 keeps the picture
    // close to the source so the delivery encode's quality is attributable to
    // the preset's own settings, and the file small enough for this machine.
    "-preset",
    "veryfast",
    "-crf",
    "18",
    "-pix_fmt",
    target.pixelFormat,
    "-profile:v",
    target.profile.toLowerCase(),
    "-r",
    String(target.frameRate),
    "-g",
    String(gop),
    "-keyint_min",
    String(gop),
    "-sc_threshold",
    "0",
    "-color_primaries",
    target.colourPrimaries,
    "-color_trc",
    target.colourTransfer,
    "-colorspace",
    target.colourMatrix,
    ...audioArgs,
    ...(padAudio ? ["-af", "apad"] : []),
    ...limitArgs,
    ...shortestArgs,
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    outputPath,
  ];

  return {
    argv,
    videoFilter: filter,
    trim,
    audio: {
      sourceHasAudio,
      plan: sourceHasAudio ? "clip-audio-kept" : "silent-track-added",
      args: audioArgs,
      paddedWithSilence: padAudio,
      statement: sourceHasAudio
        ? `the clip carries an audio stream; it is re-encoded to AAC ${target.sampleRateHz} Hz ${channelLayout} so the segment matches the timeline's stream layout` +
          (padAudio
            ? `, and because the last frame is held for ${trim.heldSeconds} s the clip's own sound ends first and that tail is SILENCE appended by apad — it is not the clip's sound continued`
            : "")
        : `the clip carries NO audio stream, so a silent AAC ${target.sampleRateHz} Hz ${channelLayout} track was generated (anullsrc) and cut to the picture — a segment without an audio stream would break concatenation, and claiming sound the clip does not have would be worse`,
    },
    reasons: [
      { arg: `-vf ${filter}`, reason: `fit the clip inside ${target.widthPx}×${target.heightPx} without cropping (letterbox), square pixels, ${target.frameRate} fps, ${target.pixelFormat} — every number taken from the preset${holdFilter ? `; then hold the last frame for ${trim.heldSeconds} s to reach the scene's declared ${trim.sceneDurationSeconds} s` : ""}` },
      { arg: "-c:v libx264 -preset veryfast -crf 18", reason: "an intermediate close to the source, so the delivery encode's quality is the preset's, not this step's" },
      { arg: `-g ${gop} -keyint_min ${gop} -sc_threshold 0`, reason: "the preset's keyframe cadence, so the delivery encode does not have to move keyframes" },
      { arg: `-color_primaries ${target.colourPrimaries} -color_trc ${target.colourTransfer} -colorspace ${target.colourMatrix}`, reason: "the preset's H.273 code points on the intermediate as well" },
      { arg: audioArgs.join(" "), reason: "AAC at the preset's layout for both cases, so the concat segments agree" },
      ...(limitArgs.length ? [{ arg: limitArgs.join(" "), reason: trim.basis }] : []),
    ],
  };
}
