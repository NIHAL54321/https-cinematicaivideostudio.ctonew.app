/**
 * THE YOUTUBE DELIVERY MASTER — what we actually choose, and why
 * (Phase 8, block 2a).
 *
 * THE TERM, DEFINED RATHER THAN REPEATED
 * The brief for this block calls this a "YouTube-optimised master". This module
 * defines that term instead of trading on it: it means exactly the twelve
 * concrete, checkable choices below — container, video codec, profile and level,
 * pixel format, frame cadence, audio codec, audio bitrate, audio sample rate,
 * faststart placement, keyframe cadence, loudness and colour tagging — each with
 * the reason it was chosen, all derived from a preset resolved from
 * ./spec-matrix. Nothing here is a prediction.
 *
 * WHAT IT DOES NOT CLAIM, EVER
 * We prepare a master for a reliable upload and for processing we can predict.
 * We do NOT claim that YouTube will use any particular codec: a platform
 * re-encodes what it is given, on its own terms, and what it serves afterwards
 * is its decision, not ours. We make no claim about ranking, reach,
 * recommendation, discovery or performance of any kind. There is no number in
 * this file about how many people will see anything, because no such number can
 * be measured here. `YOUTUBE_MASTER_BOUNDARY` states this in the product's own
 * words, and a test fails the build if the copy or the exported payloads start
 * claiming otherwise.
 *
 * NO BYTES ARE WRITTEN HERE
 * `encodeCommandPlan()` prints the exact argv the encode stage spawns. Since
 * block 2b an encoder IS installed (ffmpeg 7.0.2) and the stage has produced
 * real files from a declared synthetic source at 1920×1080 — but nothing here
 * chooses to run, and `producedOnThisBuild` stays false for every choice
 * because no PROJECT's video has been produced: a real project has no source
 * media without a media provider. The recorded facts live in
 * ../render/encoder-facts.ts.
 *
 * Pure and client-safe: no env var, no file, no process.
 */
import { FRAME_FORMAT_SPECS } from "../framing/formats";
import type { ExportPresetSpec } from "./presets";
import { FFMPEG_MISSING } from "./spec-matrix";

/** The keyframe cadence every delivery master is prepared at. */
export const KEYFRAME_INTERVAL_SECONDS = 2;

/** The bitrate buffer the encoder would be given, as a multiple of the cap. */
export const RATE_BUFFER_MULTIPLE = 2;

export type MasterChoiceId =
  | "container"
  | "videoCodec"
  | "profileLevel"
  | "pixelFormat"
  | "frameRate"
  | "audioCodec"
  | "audioBitrate"
  | "audioSampleRate"
  | "faststart"
  | "keyframeCadence"
  | "loudness"
  | "colourTagging";

export interface MasterChoice {
  id: MasterChoiceId;
  label: string;
  /** The value this master is prepared with, as a person reads it. */
  value: string;
  /** Why THIS choice, in the product's own words. Never a prediction. */
  reason: string;
  /** Where the choice's truth comes from — computed today, or gated on an input. */
  truth: "computed" | "gated";
  /** The named missing input when the choice cannot be carried out on this build. */
  missingInput: string | null;
  producedOnThisBuild: false;
}

/** The sentences that bound every claim this master makes. */
export const YOUTUBE_MASTER_BOUNDARY: readonly string[] = [
  "We prepare the master for a reliable upload and for processing whose shape we can predict. That is the whole of it.",
  "We do not claim YouTube will use any particular codec: a platform re-encodes what it is given on its own terms, and what it serves afterwards is its decision, not ours.",
  "We make no claim about ranking, reach, recommendation, discovery or performance. No number about how many people will see this video exists anywhere in this product, because none can be measured here.",
  "Every value below is a choice this app computes and prints. None of it is a file for a project: an encoder is installed on this build " +
    "(ffmpeg 7.0.2) and the encode stage has produced real files from a declared synthetic source at 1920×1080, but no project's video has been " +
    "produced — a real project has no source media without a media provider, and 3840×2160 was killed by this machine's memory ceiling.",
];

/**
 * The twelve choices, derived from one resolved preset. Every number comes from
 * the spec — nothing is typed a second time here.
 */
export function masterChoices(spec: ExportPresetSpec): MasterChoice[] {
  const gopFrames = spec.video.frameRate * KEYFRAME_INTERVAL_SECONDS;
  const capped = spec.video.rateControl.maxVideoBitrateKbps;
  const bufferKbps = capped !== null ? capped * RATE_BUFFER_MULTIPLE : null;
  return [
    {
      id: "container",
      label: "Container",
      value: `${spec.container.toUpperCase()} — ISO/IEC 14496-12 (ISO BMFF)`,
      reason:
        "One file with an index a player can read from the front, and the container every platform in the readiness " +
        "catalogue accepts for upload. A single self-contained file is also the only shape an upload endpoint reliably " +
        "takes.",
      truth: "gated",
      missingInput: FFMPEG_MISSING,
      producedOnThisBuild: false,
    },
    {
      id: "videoCodec",
      label: "Video codec",
      value: `${spec.video.codec} (${spec.video.codecFamily})`,
      reason:
        "The codec the preset resolved to. For 4K it is HEVC, which spends roughly half the bitrate of H.264 for the same " +
        "picture; for 1080p and the vertical presets it is H.264, which decodes everywhere. This is a choice about our " +
        "file — it is not a statement about what the platform will serve.",
      truth: "gated",
      missingInput: FFMPEG_MISSING,
      producedOnThisBuild: false,
    },
    {
      id: "profileLevel",
      label: "Profile / level",
      value: `${spec.video.profile}${spec.video.level ? ` @ level ${spec.video.level}` : " (no level declared)"}`,
      reason:
        "The profile is the bit depth and chroma the target needs; the level is the frame and rate the stream can carry, " +
        `computed from width × height × fps against the codec's published table (${spec.levelArithmetic}). A decoder ` +
        "reads both from the bitstream, so a wrong level is a real playback failure rather than a cosmetic detail.",
      truth: "computed",
      missingInput: null,
      producedOnThisBuild: false,
    },
    {
      id: "pixelFormat",
      label: "Pixel format",
      value: `${spec.video.pixelFormat} (${spec.colour.delivery.bitDepth}-bit, ${spec.colour.delivery.chromaSubsampling})`,
      reason:
        "4:2:0 at the bit depth the colour target needs — 8-bit for SDR, 10-bit for HDR10. The graded master is 10-bit " +
        "4:2:2; the delivery profile is what the platforms accept, and that difference is printed on the preset rather " +
        "than smoothed over.",
      truth: "gated",
      missingInput: FFMPEG_MISSING,
      producedOnThisBuild: false,
    },
    {
      id: "frameRate",
      label: "Frame rate",
      value: `${spec.video.frameRate} fps, constant`,
      reason:
        "A constant cadence, because a variable one forces the decoder to re-time the stream and makes any frame-accurate " +
        "seek unreliable. The cadence itself is the one the published bitrate figure for this resolution is stated at.",
      truth: "gated",
      missingInput: FFMPEG_MISSING,
      producedOnThisBuild: false,
    },
    {
      id: "audioCodec",
      label: "Audio codec",
      value: `${spec.audio.codec}, ${spec.audio.channelLayout}`,
      reason:
        "AAC-LC stereo: the codec the platforms' published audio guidance names, and the layout the final-mix engine " +
        "plans. Nothing is upmixed.",
      truth: "gated",
      missingInput: FFMPEG_MISSING,
      producedOnThisBuild: false,
    },
    {
      id: "audioBitrate",
      label: "Audio bitrate",
      value: `${spec.audio.audioBitrateKbps} kbps`,
      reason: `The preset's stated figure: ${spec.audio.bitrateBasis}`,
      truth: "gated",
      missingInput: FFMPEG_MISSING,
      producedOnThisBuild: false,
    },
    {
      id: "audioSampleRate",
      label: "Audio sample rate",
      value: `${spec.audio.sampleRateHz} Hz`,
      reason:
        "48 kHz — the rate the mix engine plans in and the rate the published audio guidance names. Resampling a 48 kHz " +
        "mix to 44.1 kHz would lose quality for no gain.",
      truth: "gated",
      missingInput: FFMPEG_MISSING,
      producedOnThisBuild: false,
    },
    {
      id: "faststart",
      label: "Faststart / index placement",
      value: "moov box written before mdat (+faststart)",
      reason:
        "With the index at the front, a reader can start playing before it has the whole file, and an upload or transfer " +
        "that is interrupted has still delivered something parseable. With the index at the end — the encoder's default — " +
        "a partial file is unreadable. This is a fact about the file we write, not a claim about the platform's ingest.",
      truth: "gated",
      missingInput: FFMPEG_MISSING,
      producedOnThisBuild: false,
    },
    {
      id: "keyframeCadence",
      label: "Keyframe cadence / GOP",
      value: `closed GOP, a keyframe every ${KEYFRAME_INTERVAL_SECONDS} s (${gopFrames} frames at ${spec.video.frameRate} fps), scene-cut keyframes allowed`,
      reason:
        "A two-second keyframe cadence bounds how much stream a player must decode before it can show a seek target, " +
        "which is what makes scrubbing predictable, and it keeps segment boundaries at a regular interval. A closed GOP " +
        "means a segment can be decoded without the one before it.",
      truth: "gated",
      missingInput: FFMPEG_MISSING,
      producedOnThisBuild: false,
    },
    {
      id: "loudness",
      label: "Loudness",
      value: `${spec.audio.loudnessTargetLufs} LUFS integrated, true peak ${spec.audio.truePeakDbfs} dBFS`,
      reason:
        "The final-mix engine's own target and its derived true-peak ceiling — reused, not invented a second time here. " +
        "A master at the level the platforms normalize to arrives with nothing to correct, and the true-peak ceiling " +
        "keeps inter-sample peaks from clipping after lossy coding.",
      truth: "computed",
      missingInput: null,
      producedOnThisBuild: false,
    },
    {
      id: "colourTagging",
      label: "Colour tagging",
      value: `${spec.colour.standard} / ${spec.colour.transfer} — H.273 primaries ${spec.colour.h273.colourPrimaries}, transfer ${spec.colour.h273.transferCharacteristics}, matrix ${spec.colour.h273.matrixCoefficients}`,
      reason:
        "The code points are written into the bitstream so a player is told what the pixels mean instead of guessing. " +
        "Without them a bt709 master can be displayed as something else and the picture shifts.",
      truth: "gated",
      missingInput: FFMPEG_MISSING,
      producedOnThisBuild: false,
    },
  ];
}

/**
 * The exact argv the encode stage would spawn, with the reason for each flag.
 * Printed on a BLOCKED encode row so the gate says what it WOULD run — while
 * still naming the binary it does not have.
 */
export interface EncodeCommandPlan {
  binary: string;
  args: string[];
  /** One entry per arg (or arg pair), with why it is there. */
  argReasons: Array<{ arg: string; reason: string }>;
  /** The named missing input. The gate is not weakened by this plan: it names it. */
  missingInput: string;
  /** Always false here. */
  producesFileOnThisBuild: false;
  /** The stage of the pipeline each part of the command belongs to. */
  stageAttribution: { encode: string[]; mux: string[] };
  note: string;
}

export function encodeCommandPlan(spec: ExportPresetSpec): EncodeCommandPlan {
  const rc = spec.video.rateControl;
  const gopFrames = spec.video.frameRate * KEYFRAME_INTERVAL_SECONDS;
  const encoder = spec.video.codecFamily === "hevc" ? "libx265" : spec.video.codecFamily === "av1" ? "libaom-av1" : spec.video.codecFamily === "vp9" ? "libvpx-vp9" : "libx264";

  const encode: string[] = [
    "-c:v", encoder,
    "-profile:v", spec.video.profile.toLowerCase(),
    "-pix_fmt", spec.video.pixelFormat,
    "-r", String(spec.video.frameRate),
  ];
  if (spec.video.level) encode.push("-level", spec.video.level);
  if (rc.mode === "crf" && rc.crf !== null) {
    encode.push("-crf", String(rc.crf));
  } else {
    encode.push("-b:v", `${rc.targetVideoBitrateKbps}k`);
    if (rc.maxVideoBitrateKbps !== null) {
      encode.push("-maxrate", `${rc.maxVideoBitrateKbps}k`);
      encode.push("-bufsize", `${rc.maxVideoBitrateKbps * RATE_BUFFER_MULTIPLE}k`);
    }
    if (rc.mode === "cbr") encode.push("-minrate", `${rc.targetVideoBitrateKbps}k`, "-x264-params", "nal-hrd=cbr");
  }
  encode.push("-g", String(gopFrames), "-keyint_min", String(gopFrames), "-sc_threshold", "0");
  encode.push(
    // ffmpeg's three H.273 options are DISTINCT and each takes one code point:
    //   -color_primaries (colour primaries) · -color_trc (transfer characteristics)
    //   -colorspace (matrix coefficients — despite the name, this is the matrix)
    // An earlier version pushed `-colorspace <primariesName>` as well, so the flag
    // appeared TWICE and the last one won. It was invisible on today's catalogue
    // because every shipped preset resolves primaries == matrix, so both tokens
    // were the same string; but the moment a preset carries primaries ≠ matrix
    // (bt2020 primaries with a bt2020nc matrix is the standard such pair) the
    // duplicated flag would have told the encoder the wrong primaries. One flag
    // per code point now, and a test pins it for a spec whose two differ.
    "-color_primaries", spec.colour.h273.primariesName,
    "-color_trc", spec.colour.h273.transferName,
    "-colorspace", spec.colour.h273.matrixName,
  );
  const mux: string[] = [
    "-c:a", "aac",
    "-b:a", `${spec.audio.audioBitrateKbps}k`,
    "-ar", String(spec.audio.sampleRateHz),
    "-ac", String(spec.audio.channels),
    "-movflags", "+faststart",
    "-f", spec.container,
  ];

  return {
    binary: "ffmpeg",
    args: [...encode, ...mux],
    argReasons: [
      { arg: `-c:v ${encoder}`, reason: `the encoder for ${spec.video.codec} (${spec.video.codecFamily})` },
      { arg: `-profile:v ${spec.video.profile.toLowerCase()}`, reason: "the profile the colour target and platform need" },
      { arg: `-pix_fmt ${spec.video.pixelFormat}`, reason: "the bit depth and chroma of the delivery profile" },
      { arg: `-r ${spec.video.frameRate}`, reason: "a constant cadence, so seeking is frame-accurate" },
      ...(spec.video.level ? [{ arg: `-level ${spec.video.level}`, reason: "the level computed from width × height × fps" }] : []),
      {
        arg: rc.mode === "crf" ? `-crf ${rc.crf}` : `-b:v ${rc.targetVideoBitrateKbps}k`,
        reason:
          rc.mode === "crf"
            ? "constant quality: the encoder is told a quality level, not a bitrate"
            : "the preset's average target bitrate",
      },
      ...(rc.mode !== "crf" && rc.maxVideoBitrateKbps !== null
        ? [{ arg: `-maxrate ${rc.maxVideoBitrateKbps}k -bufsize ${rc.maxVideoBitrateKbps * RATE_BUFFER_MULTIPLE}k`, reason: "the cap, and a buffer two cap-lengths deep" }]
        : []),
      { arg: `-g ${gopFrames} -keyint_min ${gopFrames} -sc_threshold 0`, reason: `a keyframe every ${KEYFRAME_INTERVAL_SECONDS} s, at fixed positions` },
      { arg: `-color_primaries ${spec.colour.h273.primariesName} -color_trc ${spec.colour.h273.transferName} -colorspace ${spec.colour.h273.matrixName}`, reason: "the H.273 code points written into the bitstream: primaries, transfer, matrix — one flag each, no duplicates" },
      { arg: `-c:a aac -b:a ${spec.audio.audioBitrateKbps}k -ar ${spec.audio.sampleRateHz} -ac ${spec.audio.channels}`, reason: "AAC-LC at the preset's bitrate, 48 kHz stereo" },
      { arg: "-movflags +faststart", reason: "the index before the media data, so a partial file is still parseable" },
      { arg: `-f ${spec.container}`, reason: "the container the preset resolved to" },
    ],
    missingInput: FFMPEG_MISSING,
    producesFileOnThisBuild: false,
    stageAttribution: { encode, mux },
    note:
      "This is the argv the encode and mux stages WOULD spawn. Nothing ran: the binary is not installed, so the job's " +
      "encode stage is BLOCKED and says so. Printing the command makes the gate more informative — it does not make it " +
      "pass.",
  };
}

/** The whole master, as one payload the surface and the API return. */
export function masterView(spec: ExportPresetSpec): Record<string, unknown> {
  const choices = masterChoices(spec);
  return {
    presetId: spec.id,
    presetLabel: spec.label,
    definition:
      "What this product means by a master prepared for YouTube: the concrete, checkable choices below, each with its " +
      "reason. It is a specification the app computes — no file is produced on this build.",
    choices,
    boundary: [...YOUTUBE_MASTER_BOUNDARY],
    command: encodeCommandPlan(spec),
    producedOnThisBuild: false,
  };
}

/**
 * The phrases that would turn this honest definition into a promise. A test
 * applies every one of them to the copy above and to every exported payload; a
 * match fails the build.
 */
export const FORBIDDEN_MASTER_CLAIMS: ReadonlyArray<{ id: string; pattern: RegExp; why: string }> = [
  {
    id: "codec-claim",
    pattern: /\byoutube\s+(will|is going to|is set to|uses|serves|streams)\b/i,
    why: "we never claim the platform will use a particular codec — it re-encodes on its own terms",
  },
  {
    id: "codec-claim-passive",
    pattern: /\b(will|going to)\s+be\s+(served|streamed|encoded|transcoded)\b/i,
    why: "a statement about what the platform will serve is not ours to make",
  },
  {
    id: "ranking",
    pattern: /\b(rank|ranks|ranked|ranking|rankings)\b/i,
    why: "no ranking claim of any kind",
  },
  {
    id: "reach",
    pattern: /\b(reach|reached|reaches|audience size|impressions)\b/i,
    why: "no reach claim — nothing here measures it",
  },
  {
    id: "virality",
    pattern: /\b(viral|virality|go viral)\b/i,
    why: "no virality claim",
  },
  {
    id: "algorithm",
    pattern: /\bthe algorithm\b|\balgorithm-friendly\b|\bbeat the algorithm\b/i,
    why: "there is no algorithm to befriend and no claim is made about one",
  },
  {
    id: "search-volume",
    pattern: /\bsearch volume\b|\bmonthly searches\b|\bdifficulty score\b|\bestimated traffic\b/i,
    why: "no search-volume, difficulty or traffic number exists in this product",
  },
  {
    id: "guarantee",
    pattern: /\bguarantee[ds]?\b|\bguaranteed\b/i,
    why: "nothing here is guaranteed",
  },
  {
    id: "optimised-for-outcome",
    pattern: /\boptimi[sz]ed for (youtube|views|search|the algorithm|discovery|ranking)\b/i,
    why: "we prepare a master for upload and processing; we do not claim an outcome",
  },
  {
    id: "performance-promise",
    pattern: /\b(more|boost|increase|grow|maximi[sz]e)\b[^.]{0,24}\b(views|watch time|subscribers|engagement)\b/i,
    why: "no claim about how many people watch or engage",
  },
];

/** Every string in a payload, at any depth — what the guard test scans. */
export function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (Array.isArray(value)) for (const v of value) collectStrings(v, out);
  else if (value && typeof value === "object") for (const v of Object.values(value as Record<string, unknown>)) collectStrings(v, out);
  return out;
}

/**
 * Scan a payload for a forbidden claim. Returns the hits — empty means clean.
 *
 * `ignore` is for the DISCLAIMER sentences only: a boundary statement has to
 * name the claim it refuses to make ("we do not claim YouTube will use any
 * particular codec"), so scanning it literally would fire on the refusal itself.
 * The test that uses this asserts two things: the claim-bearing payload is clean,
 * and every ignored sentence, scanned on its own, DOES trip a rule — which is
 * what proves the guard would catch it if the sentence ever became an assertion.
 */
export function scanForbiddenClaims(
  payload: unknown,
  ignore: readonly string[] = [],
): Array<{ id: string; why: string; text: string }> {
  const skip = new Set(ignore);
  const hits: Array<{ id: string; why: string; text: string }> = [];
  for (const text of collectStrings(payload)) {
    if (skip.has(text)) continue;
    for (const rule of FORBIDDEN_MASTER_CLAIMS) {
      if (rule.pattern.test(text)) hits.push({ id: rule.id, why: rule.why, text });
    }
  }
  return hits;
}

/** The delivery frames this master is defined for — re-exported for the surface. */
export const MASTER_FORMATS = FRAME_FORMAT_SPECS;
