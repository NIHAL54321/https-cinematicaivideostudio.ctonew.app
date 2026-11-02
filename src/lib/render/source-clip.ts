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
  /** One sentence, printed in the stage record. */
  statement: string;
}

export interface NormalisationPlan {
  argv: string[];
  videoFilter: string;
  audio: AudioDecision;
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
 */
export function planClipNormalisation(input: {
  inputPath: string;
  outputPath: string;
  target: TimelineTarget;
  sourceHasAudio: boolean;
}): NormalisationPlan {
  const { inputPath, outputPath, target, sourceHasAudio } = input;
  const filter = timelineVideoFilter(target);
  const gop = timelineGopFrames(target);
  const channelLayout = target.channels === 1 ? "mono" : "stereo";
  const audioArgs = sourceHasAudio
    ? ["-c:a", "aac", "-b:a", "192k", "-ar", String(target.sampleRateHz), "-ac", String(target.channels)]
    : ["-c:a", "aac", "-b:a", "192k", "-ar", String(target.sampleRateHz), "-ac", String(target.channels)];

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
    // The silent track is longer than the picture unless it is cut to it.
    ...(sourceHasAudio ? [] : ["-shortest"]),
    "-movflags",
    "+faststart",
    "-f",
    "mp4",
    outputPath,
  ];

  return {
    argv,
    videoFilter: filter,
    audio: {
      sourceHasAudio,
      plan: sourceHasAudio ? "clip-audio-kept" : "silent-track-added",
      args: audioArgs,
      statement: sourceHasAudio
        ? `the clip carries an audio stream; it is re-encoded to AAC ${target.sampleRateHz} Hz ${channelLayout} so the segment matches the timeline's stream layout`
        : `the clip carries NO audio stream, so a silent AAC ${target.sampleRateHz} Hz ${channelLayout} track was generated (anullsrc) and cut to the picture with -shortest — a segment without an audio stream would break concatenation, and claiming sound the clip does not have would be worse`,
    },
    reasons: [
      { arg: `-vf ${filter}`, reason: `fit the clip inside ${target.widthPx}×${target.heightPx} without cropping (letterbox), square pixels, ${target.frameRate} fps, ${target.pixelFormat} — every number taken from the preset` },
      { arg: "-c:v libx264 -preset veryfast -crf 18", reason: "an intermediate close to the source, so the delivery encode's quality is the preset's, not this step's" },
      { arg: `-g ${gop} -keyint_min ${gop} -sc_threshold 0`, reason: "the preset's keyframe cadence, so the delivery encode does not have to move keyframes" },
      { arg: `-color_primaries ${target.colourPrimaries} -color_trc ${target.colourTransfer} -colorspace ${target.colourMatrix}`, reason: "the preset's H.273 code points on the intermediate as well" },
      { arg: audioArgs.join(" "), reason: "AAC at the preset's layout for both cases, so the concat segments agree" },
    ],
  };
}
