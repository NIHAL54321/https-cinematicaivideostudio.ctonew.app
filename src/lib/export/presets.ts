/**
 * THE DELIVERY PRESETS — resolved from the specification matrix, never typed
 * (Phase 8, block 2a).
 *
 * WHAT CHANGED, AND WHY IT MATTERS
 * Until this block a preset was a hand-written object literal: eight of them,
 * each carrying its own copy of a resolution, a codec, a level, a bitrate. A
 * literal can hold any value at all — including one the matrix does not declare,
 * or a combination the matrix calls illegal — and nothing would notice.
 *
 * Now a preset carries only the IDS of options in ./spec-matrix, plus the two
 * rate-control numbers and the sentence saying WHY each choice was made. The
 * resolver below looks every id up, computes what can be computed (the level
 * from the pixel rate, the CRF from the quality tier, the true-peak ceiling from
 * the mix engine's linear ceiling), and calls `assertLegal()`. A preset holding a
 * value outside the matrix therefore cannot be constructed: there is nowhere to
 * put it, and `assertLegal` throws before an illegal combination is emitted.
 *
 * WHAT A PRESET IS — AND IS NOT
 * A preset is a SPECIFICATION THE APP CAN COMPUTE. It is not a file the app has
 * produced: this build has no `ffmpeg`, so the encode, mux and checksum stages
 * of the render pipeline are blocked and name that binary. Every resolved spec
 * says so in its own words (`producedOnThisBuild: false`, `deliveredStatement`),
 * and nothing here writes a byte anywhere.
 *
 * REPRODUCIBILITY
 * A job records the resolved spec it ran with (`resolvedSpecCore`), so the
 * numbers stay attached to the job even if a preset is edited later. The digest
 * of that core is computed server-side (node:crypto) — this module stays pure
 * and client-safe, because the editor's export panel imports it.
 *
 * Pure and client-safe: no env var, no file, no network.
 */
import { HDR_PQ_1000, SDR_709, type GradeTarget } from "../color/presets";
import { DEFAULT_LOUDNESS_TARGET_LUFS, PEAK_CEILING } from "../mix/engine";
import { FRAME_FORMAT_SPECS, type FrameFormatId } from "../framing/formats";
import {
  COLOUR_TARGETS,
  SPEC_DELIVERY_STATEMENT,
  SPEC_MATRIX_VERSION,
  assertLegal,
  audioBitrateById,
  audioCodecById,
  audioSampleRateById,
  channelLayoutById,
  codecById,
  colourById,
  containerById,
  frameRateById,
  pixelFormatById,
  qualityById,
  rateModeById,
  requiredLevel,
  resolutionById,
  upscaleById,
  type CodecId,
  type ColourId,
  type Combination,
  type RateModeId,
  type SpecTruth,
  type SpecProvenance,
  type UpscaleId,
} from "./spec-matrix";

/* ------------------------------------------------------------------ */
/* Reused app values (no second copy of any number)                    */
/* ------------------------------------------------------------------ */

/** The four delivery formats the framing engine plans in. */
export const EXPORT_FORMATS = ["16:9", "9:16", "1:1", "4:5"] as const;

/**
 * The final-mix engine's own loudness target, re-exported by name so the export
 * surface states which constant it is using rather than repeating the number.
 */
export const EXPORT_LOUDNESS_TARGET_LUFS = DEFAULT_LOUDNESS_TARGET_LUFS;

/**
 * True-peak ceiling in dBFS, DERIVED from the mix engine's linear peak ceiling
 * (PEAK_CEILING = 0.891 ≈ -1 dBFS). 20·log10(0.891) = -1.0025 dBFS, reported to
 * two decimals: -1.00 dBFS. Derived, never hand-typed.
 */
export const EXPORT_TRUE_PEAK_DBFS = Math.round(20 * Math.log10(PEAK_CEILING) * 100) / 100;

/** The audio the whole surface delivers in (48 kHz stereo — see each preset). */
export const EXPORT_SAMPLE_RATE_HZ = 48_000;
export const EXPORT_CHANNELS = 2;
export const EXPORT_CHANNEL_LAYOUT = "stereo";

/** The one container every preset uses. */
export const EXPORT_CONTAINER = "mp4";

/* ------------------------------------------------------------------ */
/* Shapes the rest of the app already consumes                         */
/* ------------------------------------------------------------------ */

/** Where a preset's bitrate number comes from. Always a stated basis. */
export interface RateControl {
  /**
   * "cbr" → one bitrate for every second. "vbr" → an average target with a cap.
   * "crf" → constant quality; the target is then a STATED planning equivalent,
   * not an encoder instruction.
   */
  mode: "cbr" | "vbr" | "crf";
  /** The bitrate the size estimate multiplies, in kbps. Always present. */
  targetVideoBitrateKbps: number;
  /** Optional rate cap the muxer would carry, in kbps (null = uncapped). */
  maxVideoBitrateKbps: number | null;
  /** The CRF the encoder would use when the mode is "crf" (null otherwise). */
  crf: number | null;
  /** Where this number comes from. Required — no silent values. */
  basis: string;
  /** True when the target is a planning equivalent rather than an instruction. */
  targetIsPlanningEquivalent: boolean;
}

/** H.273 code points + the metadata a player reads from the container. */
export interface ColourTag {
  display: "SDR" | "HDR";
  standard: string;
  transfer: string;
  peakNits: number;
  referenceWhiteNits: number;
  /** HDR static metadata, null on an SDR master (from the colour system). */
  maxCLL: number | null;
  maxFALL: number | null;
  /** H.273 (ISO/IEC 23091-2) code points written into the bitstream. */
  h273: {
    colourPrimaries: number;
    primariesName: string;
    transferCharacteristics: number;
    transferName: string;
    matrixCoefficients: number;
    matrixName: string;
  };
  /** HDR mastering-display colour volume, null on an SDR master. */
  masteringDisplay: { maxNits: number; minNits: number } | null;
  /** What the colour system MASTERS at (its own GradeTarget values). */
  master: { bitDepth: number; chromaSubsampling: string };
  /** What THIS preset encodes (the platform-accepted delivery profile). */
  delivery: { bitDepth: number; chromaSubsampling: string };
  note: string;
}

export interface ExportAudioSpec {
  codec: string;
  sampleRateHz: number;
  channels: number;
  channelLayout: string;
  audioBitrateKbps: number;
  loudnessTargetLufs: number;
  truePeakDbfs: number;
  loudnessBasis: string;
  bitrateBasis: string;
}

export interface ExportVideoSpec {
  codec: string;
  codecFamily: string;
  profile: string;
  level: string | null;
  pixelFormat: string;
  frameRate: number;
  frameRateBasis: string;
  rateControl: RateControl;
}

/** One axis of the resolved spec, with where its truth comes from. */
export interface ResolvedAxis {
  axis: string;
  optionId: string;
  label: string;
  /** The value as it appears in the resolved spec. */
  value: string | number | null;
  /** Why THIS preset chose it, in the preset's own words. */
  reason: string;
  /** Where the option's truth comes from: computed, gated or provider. */
  truth: SpecTruth;
  source: string;
  /** The named missing input when gated; the capability when provider. */
  missingInput: string | null;
  capability: string | null;
  producedOnThisBuild: false;
}

export interface ExportPresetSpec {
  id: ExportPresetId;
  label: string;
  platform: string;
  /** The Phase 5 delivery format this preset delivers in. */
  formatId: FrameFormatId;
  aspect: string;
  aspectValue: number;
  widthPx: number;
  heightPx: number;
  resolution: string;
  container: string;
  video: ExportVideoSpec;
  audio: ExportAudioSpec;
  colour: ColourTag;
  /** How the subtitle engine's cues would travel with this output. */
  subtitleTrack: { included: false; container: string; note: string };
  deliveryNotes: string[];

  /* ---- Phase 8 block 2a: the resolution trail ---- */
  /** The matrix version this spec was resolved against. */
  specVersion: string;
  /** The option ids this preset resolved from — its whole definition. */
  choices: PresetChoiceIds;
  /** Every axis, with its value, its reason and where its truth comes from. */
  axes: ResolvedAxis[];
  /** The level arithmetic, printed: width×height, ×fps, against the level table. */
  levelArithmetic: string;
  /** The upsell/upscale mode this preset would use, and its truth. */
  upscale: { id: UpscaleId; label: string; truth: SpecTruth; missingInput: string | null; capability: string | null };
  /** Always false on this build — a preset is a specification, not a file. */
  producedOnThisBuild: false;
  /** The sentence the surface prints under the preset. */
  deliveredStatement: string;
}

/* ------------------------------------------------------------------ */
/* A preset is a CHOICE SET, not a value set                           */
/* ------------------------------------------------------------------ */

export interface PresetChoiceIds {
  resolutionId: string;
  containerId: string;
  codecId: string;
  profileName: string;
  /** null only for a codec that declares no levels (none does today). */
  level: string | null;
  frameRateId: string;
  rateModeId: RateModeId;
  qualityId: string;
  colourId: ColourId;
  pixelFormatId: string;
  audioCodecId: string;
  audioSampleRateId: string;
  audioBitrateId: string;
  channelLayoutId: string;
  upscaleId: UpscaleId;
}

export interface PresetChoice {
  id: ExportPresetId;
  label: string;
  platform: string;
  choice: PresetChoiceIds;
  /** The two rate-control numbers, with the published figure they come from. */
  rateControl: {
    targetVideoBitrateKbps: number;
    maxVideoBitrateKbps: number | null;
    basis: string;
  };
  /** Why each axis was chosen — the preset's own words, printed on the surface. */
  reasons: Record<AxisKey, string>;
  subtitleTrackNote: string;
  deliveryNotes: string[];
  /** Where the audio bitrate figure comes from. */
  audioBitrateBasis: string;
  /** Why this frame rate. */
  frameRateBasis: string;
}

export type AxisKey =
  | "resolution"
  | "container"
  | "codec"
  | "profile"
  | "level"
  | "frameRate"
  | "rateControl"
  | "quality"
  | "colour"
  | "pixelFormat"
  | "audioCodec"
  | "audioSampleRate"
  | "audioBitrate"
  | "channelLayout"
  | "upscale";

/* ------------------------------------------------------------------ */
/* The catalogue                                                       */
/* ------------------------------------------------------------------ */

export const EXPORT_PRESET_IDS = [
  "youtube-2160p",
  "youtube-2160p-hdr",
  "youtube-1080p",
  "youtube-shorts",
  "instagram-reels",
  "square-1080",
  "portrait-4x5",
] as const;

export type ExportPresetId = (typeof EXPORT_PRESET_IDS)[number];

export function isExportPresetId(v: unknown): v is ExportPresetId {
  return typeof v === "string" && (EXPORT_PRESET_IDS as readonly string[]).includes(v);
}

const YOUTUBE_AUDIO_BASIS =
  "YouTube's published recommended audio encoding settings: AAC-LC, 48 kHz, stereo, 384 kbps.";

const SOCIAL_AUDIO_BASIS =
  "Instagram's published upload guidance for stereo audio: AAC-LC, 48 kHz, 128 kbps.";

const YT_1080_BASIS =
  "YouTube's published recommended upload bitrate for 1080p SDR at 30 fps: 8 Mbps. The preset takes that published figure.";

const VERTICAL_BASIS =
  "The published 1080p SDR 30 fps figure (8 Mbps) applied unchanged: the vertical / square / portrait presets are also " +
  "1080 pixels wide at 30 fps, so the same cadence and pixel count the figure is published for. A stated planning " +
  "baseline, not a platform-mandated number.";

const YT_2160_BASIS =
  "YouTube's published recommended upload bitrate for 2160p (4K) SDR at 30 fps: 35-45 Mbps. The preset takes the top of " +
  "that published range (45 Mbps); the same table gives 53-68 Mbps at 60 fps.";

const YT_2160_HDR_BASIS =
  "YouTube's published recommended upload bitrate for 2160p HDR at 30 fps: 44-56 Mbps. The preset takes the top of that " +
  "published range (56 Mbps); the same table gives 66-85 Mbps at 60 fps.";

const MAX_2160 = 68_000;

/** Shared reasons: the axes where every preset makes the same call for the same reason. */
const COMMON = {
  container:
    "MP4 (ISO/IEC 14496-12): one file, an index a player can read from the front, and the container every platform in " +
    "the readiness catalogue accepts for upload. Declared gated: writing it is a mux operation and this build has no muxer.",
  audioCodec:
    "AAC-LC: the audio codec the platforms' published upload guidance names for stereo programme audio, and the one every " +
    "delivery preset uses. Declared gated: encoding it is part of the mux stage.",
  audioSampleRate:
    "48 kHz: the rate the published audio guidance names and the rate the final-mix engine plans in. A 44.1 kHz rate " +
    "would mean resampling a 48 kHz mix for no benefit.",
  channelLayout: "Stereo (2.0): the layout the final-mix engine plans, two channels, nothing invented.",
  quality:
    "The delivery tier: visually transparent for most content at a bitrate the platform accepts. Its CRF is read from the " +
    "quality table for the codec in use, not typed here.",
} as const;

export const PRESET_CHOICES: readonly PresetChoice[] = [
  {
    id: "youtube-2160p",
    label: "YouTube 4K (2160p SDR)",
    platform: "YouTube long-form",
    choice: {
      resolutionId: "uhd-2160p",
      containerId: "mp4",
      codecId: "hevc",
      profileName: "Main",
      level: "5.1",
      frameRateId: "30",
      rateModeId: "vbr",
      qualityId: "high",
      colourId: "sdr-rec709",
      pixelFormatId: "yuv420p",
      audioCodecId: "aac-lc",
      audioSampleRateId: "48000",
      audioBitrateId: "384",
      channelLayoutId: "stereo",
      upscaleId: "encoder-scale",
    },
    rateControl: { targetVideoBitrateKbps: 45_000, maxVideoBitrateKbps: MAX_2160, basis: YT_2160_BASIS },
    reasons: {
      resolution:
        "3840×2160 — the UHD delivery frame the framing engine names for 16:9. From a 1080p source this needs an upscale, " +
        "and the framing plan reports the factor per clip rather than assuming 4K footage.",
      container: COMMON.container,
      codec:
        "H.265/HEVC: roughly half the bitrate of H.264 for the same 4K picture, and the codec that keeps a 4K master inside " +
        "a sane upload size.",
      profile:
        "Main (8-bit) because this is the SDR preset: 8-bit 4:2:0 is the profile the platform accepts for a 4K SDR upload. " +
        "The graded master is 10-bit 4:2:2 — that difference is stated, not hidden.",
      level:
        "Level 5.1 is declared and the matrix COMPUTES the minimum the frame needs (5.0 for 3840×2160 at 30 fps). 5.1 is " +
        "the conventional delivery level for 4K HEVC and it covers the frame; the computed minimum is printed beside it so " +
        "the choice can be checked.",
      frameRate:
        "30 fps — the cadence the published 4K bitrate table is stated at. 60 fps needs 53-68 Mbps by the same table, which " +
        "is a different preset's size budget.",
      rateControl:
        "VBR with a 45 Mbps average (the top of the published 4K SDR range at 30 fps) and a 68 Mbps cap. Variable rate " +
        "spends less on quiet scenes and more on busy ones; the cap keeps the file inside a size budget.",
      quality: COMMON.quality,
      colour:
        "SDR, Rec.709 / BT.1886 / 100 nits — the colour system's own SDR delivery target. The grade is mastered at 10-bit " +
        "4:2:2 and delivered at 8-bit 4:2:0, which is the profile the platform accepts.",
      pixelFormat: "4:2:0 8-bit: the chroma layout the delivery platforms accept for an SDR upload.",
      audioCodec: COMMON.audioCodec,
      audioSampleRate: COMMON.audioSampleRate,
      audioBitrate:
        "384 kbps: the figure YouTube's published audio guidance names for stereo. The final-mix engine's -14 LUFS " +
        "integrated target and its derived -1.00 dBFS true-peak ceiling travel with it.",
      channelLayout: COMMON.channelLayout,
      upscale:
        "Encoder scaling (Lanczos) when the source is smaller than 3840×2160: real interpolation, no invented detail. The " +
        "AI upscale route exists in the matrix and is gated on the keyed provider — this preset does not pretend to it.",
    },
    subtitleTrackNote:
      "The subtitle engine's cues would be muxed as a timed-text track. No cue file exists for this project, so the " +
      "preset declares the track format only and nothing is muxed.",
    deliveryNotes: [
      "The 3840×2160 frame is the UHD delivery frame the framing engine names for 16:9; from a 1920×1080 source this needs an upscale, and the framing plan reports that factor per clip rather than assuming 4K footage.",
      "H.265/HEVC Main 8-bit 4:2:0 delivery of a 10-bit 4:2:2 graded master — the profile the platform accepts for a 4K upload.",
    ],
    audioBitrateBasis: YOUTUBE_AUDIO_BASIS,
    frameRateBasis:
      "30 fps is the cadence YouTube's published bitrate table is stated at; 60 fps needs 53-68 Mbps by the same table.",
  },
  {
    id: "youtube-2160p-hdr",
    label: "YouTube 4K HDR10 (2160p)",
    platform: "YouTube long-form HDR",
    choice: {
      resolutionId: "uhd-2160p",
      containerId: "mp4",
      codecId: "hevc",
      profileName: "Main10",
      level: "5.1",
      frameRateId: "30",
      rateModeId: "vbr",
      qualityId: "high",
      colourId: "hdr10-pq",
      pixelFormatId: "yuv420p10le",
      audioCodecId: "aac-lc",
      audioSampleRateId: "48000",
      audioBitrateId: "384",
      channelLayoutId: "stereo",
      upscaleId: "encoder-scale",
    },
    rateControl: { targetVideoBitrateKbps: 56_000, maxVideoBitrateKbps: MAX_2160, basis: YT_2160_HDR_BASIS },
    reasons: {
      resolution: "3840×2160 — the same UHD frame as the SDR 4K preset; only the colour target differs.",
      container: COMMON.container,
      codec:
        "H.265/HEVC is the only codec in the matrix that carries a 10-bit HDR profile inside MP4; H.264 cannot, and the " +
        "combination rules refuse that pairing outright.",
      profile: "Main10 — the 10-bit profile the HDR10 target needs. An 8-bit profile cannot hold Rec.2020/PQ without banding.",
      level:
        "Level 5.1 is declared and the matrix computes the minimum the frame needs (5.0 for 3840×2160 at 30 fps). 5.1 " +
        "covers it and is the conventional delivery level for 4K HEVC.",
      frameRate: "30 fps — the cadence the published HDR bitrate table is stated at; 60 fps needs 66-85 Mbps by the same table.",
      rateControl:
        "VBR with a 56 Mbps average (the top of the published 4K HDR range at 30 fps) and the same 68 Mbps cap as the SDR " +
        "4K preset. HDR carries more bit depth, so the published figure is higher.",
      quality: COMMON.quality,
      colour:
        "HDR10, Rec.2020 / PQ / 1000 nits with MaxCLL 1000 and MaxFALL 400 — the colour system's own HDR target. This is " +
        "the only preset valid ONLY for footage graded with an HDR target.",
      pixelFormat: "4:2:0 10-bit: what carries Rec.2020/PQ without banding, and what the Main10 profile encodes.",
      audioCodec: COMMON.audioCodec,
      audioSampleRate: COMMON.audioSampleRate,
      audioBitrate: "384 kbps — the same published stereo figure as the SDR long-form preset.",
      channelLayout: COMMON.channelLayout,
      upscale:
        "Encoder scaling when the source is smaller than the delivery frame. The AI upscale route is gated on the keyed " +
        "provider and is not used here.",
    },
    subtitleTrackNote: "Same timed-text track declaration as the SDR long-form preset; nothing is muxed.",
    deliveryNotes: [
      "The only preset that is valid ONLY for footage graded with an HDR target: the Phase 5 colour system marks HDR-only grades (hdrOnly) and reports when PQ tone-mapping would be needed.",
      "MaxCLL/MaxFALL and mastering-display colour volume are declared metadata; authoring them is provider work and is gated.",
    ],
    audioBitrateBasis: YOUTUBE_AUDIO_BASIS,
    frameRateBasis: "30 fps is the cadence YouTube's HDR bitrate table is stated at; 60 fps needs 66-85 Mbps by the same table.",
  },
  {
    id: "youtube-1080p",
    label: "YouTube 1080p (FHD SDR)",
    platform: "YouTube long-form",
    choice: {
      resolutionId: "fhd-1080p",
      containerId: "mp4",
      codecId: "h264",
      profileName: "High",
      level: "4.0",
      frameRateId: "30",
      rateModeId: "vbr",
      qualityId: "high",
      colourId: "sdr-rec709",
      pixelFormatId: "yuv420p",
      audioCodecId: "aac-lc",
      audioSampleRateId: "48000",
      audioBitrateId: "384",
      channelLayoutId: "stereo",
      upscaleId: "none",
    },
    rateControl: { targetVideoBitrateKbps: 8_000, maxVideoBitrateKbps: 16_000, basis: YT_1080_BASIS },
    reasons: {
      resolution:
        "1920×1080 — the framing engine's 16:9 delivery frame exactly. A 1080p source is a straight 1.0 pass: no crop and " +
        "no upscale, which is why this preset declares the 'no upscale' mode.",
      container: COMMON.container,
      codec: "H.264/AVC High: the most widely decodable delivery codec, and enough for 1080p at a platform-accepted bitrate.",
      profile: "High — the profile every 1080p delivery uses; 8-bit 4:2:0 is what the SDR target needs.",
      level:
        "Level 4.0 — and this one is the matrix's COMPUTED minimum for 1920×1080 at 30 fps, not a convention: 2,073,600 " +
        "luma samples per frame against 4.0's 2,097,152, and 62,208,000 per second against its 62,914,560.",
      frameRate: "30 fps — the cadence the published 1080p bitrate table is stated at; 60 fps needs 12 Mbps by the same table.",
      rateControl:
        "VBR with an 8 Mbps average (YouTube's published 1080p SDR figure at 30 fps) and a 16 Mbps cap — twice the target, " +
        "so a busy scene can spend more without the file running away.",
      quality: COMMON.quality,
      colour: "SDR, Rec.709 / BT.1886 / 100 nits — the colour system's SDR delivery target, reused verbatim.",
      pixelFormat: "4:2:0 8-bit: the profile High encodes and the layout the platform accepts.",
      audioCodec: COMMON.audioCodec,
      audioSampleRate: COMMON.audioSampleRate,
      audioBitrate: "384 kbps — the published stereo figure for a YouTube upload.",
      channelLayout: COMMON.channelLayout,
      upscale: "No upscale: a 1080p source fills this frame exactly. A smaller source would be reported by the framing plan.",
    },
    subtitleTrackNote: "Same timed-text track declaration; nothing is muxed.",
    deliveryNotes: [
      "The 1920×1080 frame matches the framing engine's 16:9 delivery format exactly: a 16:9 source is a straight 1.0 pass, no crop and no upscale.",
      "The long-form default when the source is 1080p — the 4K preset would need a real upscale.",
    ],
    audioBitrateBasis: YOUTUBE_AUDIO_BASIS,
    frameRateBasis: "30 fps is the cadence YouTube's bitrate table is stated at; 60 fps needs 12 Mbps by the same table.",
  },
  {
    id: "youtube-shorts",
    label: "YouTube Shorts (9:16)",
    platform: "YouTube Shorts",
    choice: {
      resolutionId: "fhd-1080p-vertical",
      containerId: "mp4",
      codecId: "h264",
      profileName: "High",
      level: "4.0",
      frameRateId: "30",
      rateModeId: "cbr",
      qualityId: "high",
      colourId: "sdr-rec709",
      pixelFormatId: "yuv420p",
      audioCodecId: "aac-lc",
      audioSampleRateId: "48000",
      audioBitrateId: "384",
      channelLayoutId: "stereo",
      upscaleId: "encoder-scale",
    },
    rateControl: { targetVideoBitrateKbps: 8_000, maxVideoBitrateKbps: 8_000, basis: VERTICAL_BASIS },
    reasons: {
      resolution:
        "1080×1920 — the framing engine's 9:16 delivery frame. From a 16:9 master the kept columns are upscaled, and the " +
        "framing plan reports the factor per clip (608×1080 @ 1.7778× for a 1080p source) before this preset is honest " +
        "about delivering 1080p.",
      container: COMMON.container,
      codec: "H.264/AVC High: decodable everywhere a phone is, which is where a Short is watched.",
      profile: "High, 8-bit 4:2:0 — the SDR delivery profile.",
      level:
        "Level 4.0 is the matrix's computed minimum for 1080×1920 at 30 fps (2,073,600 luma samples per frame, 62,208,000 " +
        "per second) — the same arithmetic as the landscape 1080p preset, because the pixel count is the same.",
      frameRate: "30 fps; Shorts also accepts 60 fps (12 Mbps by YouTube's 1080p table).",
      rateControl:
        "CBR at 8 Mbps — one bitrate for every second. A short vertical upload usually leaves a phone over a mobile " +
        "network, and a constant rate makes the upload time predictable and removes the peak a variable-rate encode can " +
        "produce. The target and the cap are the same number because CBR means one bitrate.",
      quality: COMMON.quality,
      colour: "SDR, Rec.709 / BT.1886 / 100 nits.",
      pixelFormat: "4:2:0 8-bit — the layout the profile encodes and the platform accepts.",
      audioCodec: COMMON.audioCodec,
      audioSampleRate: COMMON.audioSampleRate,
      audioBitrate: "384 kbps — the published YouTube stereo figure; a Short is still a YouTube upload.",
      channelLayout: COMMON.channelLayout,
      upscale: "Encoder scaling: a 16:9 source does not fill 1080×1920 without it, and the framing plan prints the factor.",
    },
    subtitleTrackNote: "Same timed-text track declaration; nothing is muxed.",
    deliveryNotes: [
      "1080×1920 is the framing engine's 9:16 delivery frame. From a 16:9 master the kept columns are upscaled — the framing plan reports the upscale factor per clip (608×1080 @ 1.7778× for a 1080p source) before this preset is honest about delivering 1080p.",
      "This preset is the same 9:16 delivery frame as the Reels preset; only the platform guidance and audio bitrate differ.",
    ],
    audioBitrateBasis: YOUTUBE_AUDIO_BASIS,
    frameRateBasis: "30 fps; Shorts also accepts 60 fps (12 Mbps by YouTube's 1080p table).",
  },
  {
    id: "instagram-reels",
    label: "Instagram Reels (9:16)",
    platform: "Instagram Reels",
    choice: {
      resolutionId: "fhd-1080p-vertical",
      containerId: "mp4",
      codecId: "h264",
      profileName: "High",
      level: "4.0",
      frameRateId: "30",
      rateModeId: "crf",
      qualityId: "high",
      colourId: "sdr-rec709",
      pixelFormatId: "yuv420p",
      audioCodecId: "aac-lc",
      audioSampleRateId: "48000",
      audioBitrateId: "128",
      channelLayoutId: "stereo",
      upscaleId: "encoder-scale",
    },
    rateControl: { targetVideoBitrateKbps: 8_000, maxVideoBitrateKbps: null, basis: VERTICAL_BASIS },
    reasons: {
      resolution: "1080×1920 — the same 9:16 delivery frame as the Shorts preset; one geometry, two platform presets.",
      container: COMMON.container,
      codec: "H.264/AVC High — the codec a phone decodes without help.",
      profile: "High, 8-bit 4:2:0 — the SDR delivery profile for this frame.",
      level: "Level 4.0 — the matrix's computed minimum for 1080×1920 at 30 fps — the cadence the published figures for this frame are stated at.",
      frameRate: "30 fps — Reels' published recommended cadence (24-60 fps accepted).",
      rateControl:
        "CRF 18 from the 'High — delivery' quality tier: the encoder is told a quality level rather than a bitrate and " +
        "spends what the picture needs. The 8 Mbps target printed beside it is a STATED PLANNING EQUIVALENT used by the " +
        "size estimate — it is not an instruction to the encoder, and there is no cap.",
      quality: COMMON.quality,
      colour: "SDR, Rec.709 / BT.1886 / 100 nits.",
      pixelFormat: "4:2:0 8-bit — the layout the profile encodes and the platform accepts.",
      audioCodec: COMMON.audioCodec,
      audioSampleRate: COMMON.audioSampleRate,
      audioBitrate: "128 kbps — the figure the published social upload guidance names for stereo.",
      channelLayout: COMMON.channelLayout,
      upscale: "Encoder scaling; the framing plan prints the factor for a 16:9 source.",
    },
    subtitleTrackNote: "Reels' own caption layer is authored in the app; the container track is declared but nothing is muxed.",
    deliveryNotes: [
      "Same 1080×1920 frame as the Shorts preset — one geometry, two platform presets.",
      "Reels is a 1080p-class delivery: the framing plan's upscale factor decides whether a 16:9 source really fills 1080p.",
    ],
    audioBitrateBasis: SOCIAL_AUDIO_BASIS,
    frameRateBasis: "30 fps — Instagram Reels' published recommended cadence (24-60 fps accepted).",
  },
  {
    id: "square-1080",
    label: "Square 1:1 (1080)",
    platform: "feed posts (Instagram / LinkedIn / X)",
    choice: {
      resolutionId: "square-1080p",
      containerId: "mp4",
      codecId: "h264",
      profileName: "High",
      level: "4.0",
      frameRateId: "30",
      rateModeId: "crf",
      qualityId: "high",
      colourId: "sdr-rec709",
      pixelFormatId: "yuv420p",
      audioCodecId: "aac-lc",
      audioSampleRateId: "48000",
      audioBitrateId: "128",
      channelLayoutId: "stereo",
      upscaleId: "encoder-scale",
    },
    rateControl: { targetVideoBitrateKbps: 8_000, maxVideoBitrateKbps: null, basis: VERTICAL_BASIS },
    reasons: {
      resolution:
        "1080×1080 — the framing engine's 1:1 delivery frame, the least destructive narrow crop of a 16:9 master (full " +
        "height, 56% of the width at 1080p).",
      container: COMMON.container,
      codec: "H.264/AVC High — decodable wherever a phone is, and enough for a feed-sized frame.",
      profile: "High, 8-bit 4:2:0 — the SDR delivery profile for this frame.",
      level: "Level 4.0 — the matrix's computed minimum for 1080×1080 at 30 fps — the cadence the published figures for this frame are stated at.",
      frameRate: "30 fps — the feed cadence the published figures are stated at.",
      rateControl:
        "CRF 18 from the 'High — delivery' quality tier, with the 8 Mbps planning equivalent printed beside it and no cap.",
      quality: COMMON.quality,
      colour: "SDR, Rec.709 / BT.1886 / 100 nits.",
      pixelFormat: "4:2:0 8-bit — the layout the profile encodes and the platform accepts.",
      audioCodec: COMMON.audioCodec,
      audioSampleRate: COMMON.audioSampleRate,
      audioBitrate: "128 kbps — the published social stereo figure.",
      channelLayout: COMMON.channelLayout,
      upscale: "Encoder scaling from a 16:9 master; the framing plan prints the crop and the factor.",
    },
    subtitleTrackNote: "Same declaration; nothing is muxed.",
    deliveryNotes: [
      "1080×1080 is the framing engine's 1:1 delivery frame — the least destructive narrow crop of a 16:9 master (full height, 56% of the width at 1080p).",
    ],
    audioBitrateBasis: SOCIAL_AUDIO_BASIS,
    frameRateBasis: "30 fps — the cadence the published figures for this frame are stated at.",
  },
  {
    id: "portrait-4x5",
    label: "Portrait 4:5 (1080×1350)",
    platform: "feed portrait (Instagram / Facebook)",
    choice: {
      resolutionId: "portrait-1080p",
      containerId: "mp4",
      codecId: "h264",
      profileName: "High",
      level: "4.0",
      frameRateId: "30",
      rateModeId: "crf",
      qualityId: "high",
      colourId: "sdr-rec709",
      pixelFormatId: "yuv420p",
      audioCodecId: "aac-lc",
      audioSampleRateId: "48000",
      audioBitrateId: "128",
      channelLayoutId: "stereo",
      upscaleId: "encoder-scale",
    },
    rateControl: { targetVideoBitrateKbps: 8_000, maxVideoBitrateKbps: null, basis: VERTICAL_BASIS },
    reasons: {
      resolution:
        "1080×1350 — the framing engine's 4:5 delivery frame: taller than square, shorter than 9:16, and the feed " +
        "portrait Instagram actually renders.",
      container: COMMON.container,
      codec: "H.264/AVC High — decodable wherever a phone is, and enough for a feed-sized frame.",
      profile: "High, 8-bit 4:2:0 — the SDR delivery profile for this frame.",
      level: "Level 4.0 — the matrix's computed minimum for 1080×1350 at 30 fps — the cadence the published figures for this frame are stated at.",
      frameRate: "30 fps — the cadence the published figures for this frame are stated at.",
      rateControl: "CRF 18 from the 'High — delivery' quality tier, with the 8 Mbps planning equivalent printed beside it and no cap.",
      quality: COMMON.quality,
      colour: "SDR, Rec.709 / BT.1886 / 100 nits.",
      pixelFormat: "4:2:0 8-bit — the layout the profile encodes and the platform accepts.",
      audioCodec: COMMON.audioCodec,
      audioSampleRate: COMMON.audioSampleRate,
      audioBitrate: "128 kbps — the published social stereo figure.",
      channelLayout: COMMON.channelLayout,
      upscale: "Encoder scaling from a 16:9 master; the framing plan prints the crop and the factor.",
    },
    subtitleTrackNote: "Same declaration; nothing is muxed.",
    deliveryNotes: [
      "1080×1350 is the framing engine's 4:5 delivery frame — taller than square, shorter than 9:16, and the feed portrait Instagram actually renders.",
    ],
    audioBitrateBasis: SOCIAL_AUDIO_BASIS,
    frameRateBasis: "30 fps — the cadence the published figures for this frame are stated at.",
  },
];

/* ------------------------------------------------------------------ */
/* Colour tagging — built from the colour system's own targets          */
/* ------------------------------------------------------------------ */

function bitDepthOf(target: GradeTarget): number {
  return target.bitDepth;
}

/** SDR tagging: Rec.709 / BT.1886 / 100 nits, coded as bt709 in the bitstream. */
function sdrColour(): ColourTag {
  return {
    display: SDR_709.display,
    standard: SDR_709.standard,
    transfer: SDR_709.transfer,
    peakNits: SDR_709.peakNits,
    referenceWhiteNits: SDR_709.referenceWhiteNits,
    maxCLL: SDR_709.maxCLL,
    maxFALL: SDR_709.maxFALL,
    h273: {
      colourPrimaries: 1,
      primariesName: "bt709",
      transferCharacteristics: 1,
      transferName: "bt709",
      matrixCoefficients: 1,
      matrixName: "bt709",
    },
    masteringDisplay: null,
    master: { bitDepth: bitDepthOf(SDR_709), chromaSubsampling: SDR_709.chromaSubsampling },
    delivery: { bitDepth: 8, chromaSubsampling: "4:2:0" },
    note:
      "Rec.709 primaries, BT.1886 display gamma, 100-nit peak: the Phase 5 colour system's SDR delivery target " +
      "(SDR_709 in src/lib/color/presets.ts), reused verbatim. BT.1886 is the EOTF a 100-nit SDR display applies to a " +
      "bt709-coded master, so the coded transfer_characteristics in the container stays bt709 (H.273 code 1). " +
      "The grade is mastered at 10-bit 4:2:2; this delivery preset encodes 8-bit 4:2:0, the profile the platform accepts — " +
      "the difference is stated, not hidden.",
  };
}

/** HDR10 tagging: Rec.2020 / PQ / 1000 nits with CLL metadata. */
function hdrColour(): ColourTag {
  return {
    display: HDR_PQ_1000.display,
    standard: HDR_PQ_1000.standard,
    transfer: HDR_PQ_1000.transfer,
    peakNits: HDR_PQ_1000.peakNits,
    referenceWhiteNits: HDR_PQ_1000.referenceWhiteNits,
    maxCLL: HDR_PQ_1000.maxCLL,
    maxFALL: HDR_PQ_1000.maxFALL,
    h273: {
      colourPrimaries: 9,
      primariesName: "bt2020",
      transferCharacteristics: 16,
      transferName: "smpte2084 (PQ)",
      matrixCoefficients: 9,
      matrixName: "bt2020nc",
    },
    masteringDisplay: { maxNits: HDR_PQ_1000.peakNits, minNits: 0.0001 },
    master: { bitDepth: bitDepthOf(HDR_PQ_1000), chromaSubsampling: HDR_PQ_1000.chromaSubsampling },
    delivery: { bitDepth: 10, chromaSubsampling: "4:2:0" },
    note:
      "Rec.2020 primaries, SMPTE ST 2084 (PQ) transfer, a 100-nit diffuse white raised to a 203-nit PQ graphics white and " +
      "headroom to a 1000-nit peak with CLL metadata — the Phase 5 colour system's HDR10 target (HDR_PQ_1000 in " +
      "src/lib/color/presets.ts), reused verbatim. The container would carry mastering-display colour volume " +
      "(1000 nits / 0.0001 nits) plus MaxCLL " +
      `${HDR_PQ_1000.maxCLL} and MaxFALL ${HDR_PQ_1000.maxFALL}. ` +
      "The grade is mastered at 10-bit 4:2:2; this delivery preset encodes 10-bit 4:2:0 (HEVC Main10), so the bit depth " +
      "matches the master and only the chroma subsampling is reduced. Nothing is tone-mapped here: the HDR preset is only " +
      "valid for footage graded with an HDR target, and the colour system reports when a grade needs it.",
  };
}

/* ------------------------------------------------------------------ */
/* The resolver                                                        */
/* ------------------------------------------------------------------ */

function axis(
  name: string,
  optionId: string,
  label: string,
  value: string | number | null,
  reason: string,
  provenance: SpecProvenance,
): ResolvedAxis {
  return {
    axis: name,
    optionId,
    label,
    value,
    reason,
    truth: provenance.truth,
    source: provenance.source,
    missingInput: provenance.missingInput,
    capability: provenance.capability,
    producedOnThisBuild: false,
  };
}

/** Everything a preset needs to be turned into a legal combination. */
export function combinationOf(p: PresetChoice): Combination {
  const quality = qualityById(p.choice.qualityId);
  const codec = codecById(p.choice.codecId);
  const crf = p.choice.rateModeId === "crf" && quality && codec ? quality.crfByCodec[codec.id] : null;
  return {
    ...p.choice,
    rateModeId: p.choice.rateModeId,
    qualityId: p.choice.qualityId,
    targetVideoBitrateKbps: p.rateControl.targetVideoBitrateKbps,
    maxVideoBitrateKbps: p.rateControl.maxVideoBitrateKbps,
    crf,
  };
}

/**
 * Resolve one choice set into a complete specification.
 *
 * Every axis is looked up in the matrix; anything missing is a thrown error, not
 * a default. The level is COMPUTED and checked; the CRF comes from the quality
 * tier; the legality check runs before the spec is returned.
 */
export function resolvePreset(p: PresetChoice): ExportPresetSpec {
  const resolution = resolutionById(p.choice.resolutionId);
  const container = containerById(p.choice.containerId);
  const codec = codecById(p.choice.codecId);
  const profile = codec?.profiles.find((x) => x.name === p.choice.profileName);
  const frameRate = frameRateById(p.choice.frameRateId);
  const rateMode = rateModeById(p.choice.rateModeId);
  const quality = qualityById(p.choice.qualityId);
  const colour = colourById(p.choice.colourId);
  const pixelFormat = pixelFormatById(p.choice.pixelFormatId);
  const audioCodec = audioCodecById(p.choice.audioCodecId);
  const audioSampleRate = audioSampleRateById(p.choice.audioSampleRateId);
  const audioBitrate = audioBitrateById(p.choice.audioBitrateId);
  const channelLayout = channelLayoutById(p.choice.channelLayoutId);
  const upscale = upscaleById(p.choice.upscaleId);

  const missing: string[] = [];
  const need = (v: unknown, what: string) => {
    if (!v) missing.push(what);
  };
  need(resolution, `resolution "${p.choice.resolutionId}"`);
  need(container, `container "${p.choice.containerId}"`);
  need(codec, `codec "${p.choice.codecId}"`);
  need(profile, `profile "${p.choice.profileName}" of codec "${p.choice.codecId}"`);
  need(frameRate, `frame rate "${p.choice.frameRateId}"`);
  need(rateMode, `rate mode "${p.choice.rateModeId}"`);
  need(quality, `quality tier "${p.choice.qualityId}"`);
  need(colour, `colour target "${p.choice.colourId}"`);
  need(pixelFormat, `pixel format "${p.choice.pixelFormatId}"`);
  need(audioCodec, `audio codec "${p.choice.audioCodecId}"`);
  need(audioSampleRate, `audio sample rate "${p.choice.audioSampleRateId}"`);
  need(audioBitrate, `audio bitrate "${p.choice.audioBitrateId}"`);
  need(channelLayout, `channel layout "${p.choice.channelLayoutId}"`);
  need(upscale, `upscale mode "${p.choice.upscaleId}"`);
  if (missing.length > 0) {
    throw new Error(`preset "${p.id}" names options the matrix does not declare: ${missing.join(", ")}`);
  }

  const combination = combinationOf(p);
  // THROWS on an illegal combination — a preset is never emitted un-checked.
  const check = assertLegal(combination);

  const crf = combination.crf;
  const level = requiredLevel(codec!.id as CodecId, resolution!.widthPx, resolution!.heightPx, frameRate!.fps);

  const rateControl: RateControl = {
    mode: p.choice.rateModeId,
    targetVideoBitrateKbps: p.rateControl.targetVideoBitrateKbps,
    maxVideoBitrateKbps: p.rateControl.maxVideoBitrateKbps,
    crf,
    basis: p.rateControl.basis,
    targetIsPlanningEquivalent: p.choice.rateModeId === "crf",
  };

  const audio: ExportAudioSpec = {
    codec: audioCodec!.label,
    sampleRateHz: audioSampleRate!.hz,
    channels: channelLayout!.channels,
    channelLayout: channelLayout!.id,
    audioBitrateKbps: audioBitrate!.kbps,
    loudnessTargetLufs: EXPORT_LOUDNESS_TARGET_LUFS,
    truePeakDbfs: EXPORT_TRUE_PEAK_DBFS,
    loudnessBasis:
      `The final-mix engine's own target (DEFAULT_LOUDNESS_TARGET_LUFS = ${DEFAULT_LOUDNESS_TARGET_LUFS} LUFS integrated in ` +
      "src/lib/mix/engine.ts) — the value the Phase 4/5 mixer normalizes to, and the level YouTube and Instagram " +
      "normalize playback to. True peak is DERIVED from the same engine's PEAK_CEILING (0.891 linear): " +
      `20·log10(0.891) = ${EXPORT_TRUE_PEAK_DBFS} dBFS.`,
    bitrateBasis: p.audioBitrateBasis,
  };

  const axes: ResolvedAxis[] = [
    axis("resolution", resolution!.id, resolution!.label, `${resolution!.widthPx}×${resolution!.heightPx}`, p.reasons.resolution, resolution!.provenance),
    axis("container", container!.id, container!.label, container!.id, p.reasons.container, container!.provenance),
    axis("codec", codec!.id, codec!.label, codec!.label, p.reasons.codec, codec!.provenance),
    axis("profile", `${codec!.id}/${profile!.name}`, `${codec!.label} ${profile!.name}`, profile!.name, p.reasons.profile, codec!.provenance),
    axis(
      "level",
      `${codec!.id}/${p.choice.level ?? "none"}`,
      p.choice.level ? `Level ${p.choice.level}` : "no level",
      p.choice.level,
      p.reasons.level,
      {
        truth: "computed",
        source: "the codec's published level table in ./spec-matrix, compared with width × height × fps",
        basis: level.arithmetic,
        missingInput: null,
        capability: null,
        producedOnThisBuild: false,
      },
    ),
    axis("frameRate", frameRate!.id, frameRate!.label, frameRate!.fps, p.reasons.frameRate, frameRate!.provenance),
    axis("rateControl", rateMode!.id, rateMode!.label, rateControl.mode, p.reasons.rateControl, rateMode!.provenance),
    axis("quality", quality!.id, quality!.label, crf, p.reasons.quality, quality!.provenance),
    axis("colour", colour!.id, colour!.label, colour!.standard, p.reasons.colour, colour!.provenance),
    axis("pixelFormat", pixelFormat!.id, pixelFormat!.label, pixelFormat!.id, p.reasons.pixelFormat, pixelFormat!.provenance),
    axis("audioCodec", audioCodec!.id, audioCodec!.label, audioCodec!.label, p.reasons.audioCodec, audioCodec!.provenance),
    axis("audioSampleRate", audioSampleRate!.id, audioSampleRate!.label, audioSampleRate!.hz, p.reasons.audioSampleRate, audioSampleRate!.provenance),
    axis("audioBitrate", audioBitrate!.id, audioBitrate!.label, audioBitrate!.kbps, p.reasons.audioBitrate, audioBitrate!.provenance),
    axis("channelLayout", channelLayout!.id, channelLayout!.label, channelLayout!.channels, p.reasons.channelLayout, channelLayout!.provenance),
    axis("upscale", upscale!.id, upscale!.label, upscale!.id, p.reasons.upscale, upscale!.provenance),
  ];

  return {
    id: p.id,
    label: p.label,
    platform: p.platform,
    formatId: resolution!.formatId,
    aspect: resolution!.aspect,
    aspectValue: resolution!.aspectValue,
    widthPx: resolution!.widthPx,
    heightPx: resolution!.heightPx,
    resolution: `${resolution!.widthPx}×${resolution!.heightPx}`,
    container: container!.id,
    video: {
      codec: codec!.label,
      codecFamily: codec!.id,
      profile: profile!.name,
      level: p.choice.level,
      pixelFormat: pixelFormat!.id,
      frameRate: frameRate!.fps,
      frameRateBasis: p.frameRateBasis,
      rateControl,
    },
    audio,
    colour: colour!.id === "hdr10-pq" ? hdrColour() : sdrColour(),
    subtitleTrack: { included: false, container: "mp4 timed text (tx3g / mov_text)", note: p.subtitleTrackNote },
    deliveryNotes: [...p.deliveryNotes],
    specVersion: SPEC_MATRIX_VERSION,
    choices: { ...p.choice },
    axes,
    levelArithmetic: check.level.arithmetic,
    upscale: {
      id: upscale!.id,
      label: upscale!.label,
      truth: upscale!.provenance.truth,
      missingInput: upscale!.provenance.missingInput,
      capability: upscale!.provenance.capability,
    },
    producedOnThisBuild: false,
    deliveredStatement:
      "This is a specification the app computes, not a file it has produced for a project. An encoder is installed on this build " +
      "(ffmpeg 7.0.2) and the render pipeline's own encode stage has produced real files from a DECLARED SYNTHETIC SOURCE, measured with " +
      "ffprobe at 1920×1080 (H.264 High level 4.0, 30 fps, 2.005 s) and at 3840×2160 (HEVC Main, 30 fps, 2.005 s — under encoder settings " +
      "declared for that proof attempt only; the preset's own default settings were killed by this machine's memory ceiling). No project's video " +
      "has been produced: no source media exists for a real project without a media provider.",
  };
}

/** Every preset, resolved at module load. An illegal one throws here, not later. */
export const EXPORT_PRESETS: readonly ExportPresetSpec[] = PRESET_CHOICES.map(resolvePreset);

const PRESET_INDEX = new Map<ExportPresetId, ExportPresetSpec>(EXPORT_PRESETS.map((p) => [p.id, p]));
const CHOICE_INDEX = new Map<ExportPresetId, PresetChoice>(PRESET_CHOICES.map((p) => [p.id, p]));

export function findExportPreset(id: unknown): ExportPresetSpec | null {
  if (!isExportPresetId(id)) return null;
  return PRESET_INDEX.get(id) ?? null;
}

/** The choice set behind a preset — the ids, not the resolved numbers. */
export function findPresetChoice(id: unknown): PresetChoice | null {
  if (!isExportPresetId(id)) return null;
  return CHOICE_INDEX.get(id) ?? null;
}

/** Presets in canonical catalogue order (the order IDs are always reported in). */
export function orderPresetIds(ids: unknown): ExportPresetId[] {
  if (!Array.isArray(ids)) return [];
  const wanted = new Set(ids.filter((id): id is ExportPresetId => isExportPresetId(id)));
  return EXPORT_PRESET_IDS.filter((id) => wanted.has(id));
}

/* ------------------------------------------------------------------ */
/* Reproducibility — the payload a job records                         */
/* ------------------------------------------------------------------ */

/**
 * The exact, reproducible core of a resolved spec: every number a render would
 * run with, and nothing that could drift (no prose that a later copy edit
 * changes the meaning of). A job stores THIS, so the job's numbers stay the
 * job's numbers even if the preset catalogue is edited afterwards. The digest of
 * this payload is computed server-side (node:crypto sha256 over canonical JSON).
 */
export function resolvedSpecCore(spec: ExportPresetSpec): Record<string, unknown> {
  return {
    specVersion: spec.specVersion,
    presetId: spec.id,
    presetLabel: spec.label,
    platform: spec.platform,
    formatId: spec.formatId,
    resolution: {
      widthPx: spec.widthPx,
      heightPx: spec.heightPx,
      aspect: spec.aspect,
      aspectValue: spec.aspectValue,
      resolutionId: spec.choices.resolutionId,
    },
    container: { id: spec.container, containerId: spec.choices.containerId },
    video: {
      codecId: spec.choices.codecId,
      codec: spec.video.codec,
      profile: spec.video.profile,
      level: spec.video.level,
      pixelFormat: spec.video.pixelFormat,
      frameRate: spec.video.frameRate,
      rateControl: {
        mode: spec.video.rateControl.mode,
        targetVideoBitrateKbps: spec.video.rateControl.targetVideoBitrateKbps,
        maxVideoBitrateKbps: spec.video.rateControl.maxVideoBitrateKbps,
        crf: spec.video.rateControl.crf,
        targetIsPlanningEquivalent: spec.video.rateControl.targetIsPlanningEquivalent,
      },
      qualityId: spec.choices.qualityId,
    },
    colour: {
      colourId: spec.choices.colourId,
      display: spec.colour.display,
      standard: spec.colour.standard,
      transfer: spec.colour.transfer,
      peakNits: spec.colour.peakNits,
      maxCLL: spec.colour.maxCLL,
      maxFALL: spec.colour.maxFALL,
      h273: spec.colour.h273,
      delivery: spec.colour.delivery,
    },
    audio: {
      codec: spec.audio.codec,
      sampleRateHz: spec.audio.sampleRateHz,
      channels: spec.audio.channels,
      channelLayout: spec.audio.channelLayout,
      audioBitrateKbps: spec.audio.audioBitrateKbps,
      loudnessTargetLufs: spec.audio.loudnessTargetLufs,
      truePeakDbfs: spec.audio.truePeakDbfs,
    },
    upscale: { id: spec.upscale.id, truth: spec.upscale.truth },
    producedOnThisBuild: false,
  };
}

/** Every distinct provenance in a spec, for the surface's provenance tally. */
export function specProvenanceTally(spec: ExportPresetSpec): Record<SpecTruth, number> {
  const tally: Record<SpecTruth, number> = { computed: 0, gated: 0, provider: 0 };
  for (const a of spec.axes) tally[a.truth] += 1;
  return tally;
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

/** One preset exactly as the API returns it: every declared number, no prose lost. */
export function presetView(spec: ExportPresetSpec): Record<string, unknown> {
  return {
    id: spec.id,
    label: spec.label,
    platform: spec.platform,
    formatId: spec.formatId,
    aspect: spec.aspect,
    aspectValue: Math.round(spec.aspectValue * 10000) / 10000,
    widthPx: spec.widthPx,
    heightPx: spec.heightPx,
    resolution: spec.resolution,
    container: spec.container,
    video: {
      codec: spec.video.codec,
      codecFamily: spec.video.codecFamily,
      profile: spec.video.profile,
      level: spec.video.level,
      pixelFormat: spec.video.pixelFormat,
      frameRate: spec.video.frameRate,
      frameRateBasis: spec.video.frameRateBasis,
      bitrateKbps: spec.video.rateControl.targetVideoBitrateKbps,
      maxBitrateKbps: spec.video.rateControl.maxVideoBitrateKbps,
      rateControl: {
        mode: spec.video.rateControl.mode,
        crf: spec.video.rateControl.crf,
        targetIsPlanningEquivalent: spec.video.rateControl.targetIsPlanningEquivalent,
        basis: spec.video.rateControl.basis,
      },
    },
    audio: {
      codec: spec.audio.codec,
      sampleRateHz: spec.audio.sampleRateHz,
      channels: spec.audio.channels,
      channelLayout: spec.audio.channelLayout,
      bitrateKbps: spec.audio.audioBitrateKbps,
      loudnessTargetLufs: spec.audio.loudnessTargetLufs,
      truePeakDbfs: spec.audio.truePeakDbfs,
      loudnessBasis: spec.audio.loudnessBasis,
      bitrateBasis: spec.audio.bitrateBasis,
    },
    colour: {
      display: spec.colour.display,
      standard: spec.colour.standard,
      transfer: spec.colour.transfer,
      peakNits: spec.colour.peakNits,
      referenceWhiteNits: spec.colour.referenceWhiteNits,
      maxCLL: spec.colour.maxCLL,
      maxFALL: spec.colour.maxFALL,
      h273: { ...spec.colour.h273 },
      masteringDisplay: spec.colour.masteringDisplay ? { ...spec.colour.masteringDisplay } : null,
      master: { ...spec.colour.master },
      delivery: { ...spec.colour.delivery },
      note: spec.colour.note,
    },
    subtitleTrack: { ...spec.subtitleTrack },
    deliveryNotes: [...spec.deliveryNotes],

    /* Phase 8 block 2a — the resolution trail, on the same view */
    specVersion: spec.specVersion,
    choices: { ...spec.choices },
    levelArithmetic: spec.levelArithmetic,
    axes: spec.axes.map((a) => ({ ...a })),
    provenanceTally: specProvenanceTally(spec),
    upscale: { ...spec.upscale },
    producedOnThisBuild: false,
    deliveredStatement: spec.deliveredStatement,
  };
}

export function listExportPresetViews(): Record<string, unknown>[] {
  return EXPORT_PRESETS.map(presetView);
}

/** The matrix's colour targets, re-exported so a caller need not import two modules. */
export { COLOUR_TARGETS, SPEC_DELIVERY_STATEMENT, SPEC_MATRIX_VERSION };
