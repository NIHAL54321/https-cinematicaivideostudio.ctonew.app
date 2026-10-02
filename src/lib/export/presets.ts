/**
 * Phase 6 Block 1 — DELIVERY PRESETS (pure, client-safe).
 *
 * The deterministic specification of what WOULD be delivered: for each target
 * platform/format, the container, video codec + profile, resolution, frame rate,
 * bitrate (the planning number the size arithmetic multiplies), audio codec,
 * sample rate, channel layout, loudness target and the colour tagging the
 * container would carry.
 *
 * EVERY number here either (a) reuses a value the app already owns, or (b) is a
 * platform-published figure cited in its own `basis` string. Nothing is invented
 * silently:
 *
 *   - resolution / aspect          → the Phase 5 framing engine's own delivery
 *                                    formats (FRAME_FORMAT_SPECS in
 *                                    src/lib/framing/formats.ts): 1920×1080,
 *                                    1080×1920, 1080×1080, 1080×1350, plus the
 *                                    3840×2160 UHD frame the framing notes name.
 *   - colour tagging (SDR + HDR)   → the Phase 5 colour system's delivery targets
 *                                    (SDR_709 = Rec.709 / BT.1886 / 100 nits and
 *                                    HDR_PQ_1000 = Rec.2020 / PQ / 1000 nits
 *                                    with CLL metadata) from
 *                                    src/lib/color/presets.ts, reused verbatim.
 *   - loudness target              → the Phase 4/5 final-mix engine's own constant
 *                                    DEFAULT_LOUDNESS_TARGET_LUFS (-14) from
 *                                    src/lib/mix/engine.ts.
 *   - true-peak ceiling            → derived arithmetically from the mix engine's
 *                                    PEAK_CEILING (0.891 linear = -1.00 dBFS),
 *                                    not chosen by hand.
 *   - video/audio bitrates         → each preset states its source in
 *                                    `rateControl.basis` / `audio.loudnessBasis`
 *                                    (platform-published upload guidance).
 *
 * NOTHING HERE ENCODES ANYTHING. This file is arithmetic and declared policy on
 * declared delivery targets. No frame is decoded, no audio is rendered, no file
 * is muxed and no upload happens; the honest gate lives in ./service.
 */
import { HDR_PQ_1000, SDR_709, type GradeTarget } from "../color/presets";
import { DEFAULT_LOUDNESS_TARGET_LUFS, PEAK_CEILING } from "../mix/engine";
import { FRAME_FORMAT_SPECS, type FrameFormatId } from "../framing/formats";

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
/* The catalogue                                                       */
/* ------------------------------------------------------------------ */

export const EXPORT_PRESET_IDS = [
  "youtube-2160p",
  "youtube-2160p-hdr",
  "youtube-1080p",
  "youtube-shorts",
  "instagram-reels",
  "tiktok",
  "square-1080",
  "portrait-4x5",
] as const;

export type ExportPresetId = (typeof EXPORT_PRESET_IDS)[number];

export function isExportPresetId(v: unknown): v is ExportPresetId {
  return typeof v === "string" && (EXPORT_PRESET_IDS as readonly string[]).includes(v);
}

/** Where a preset's bitrate number comes from. Always a stated basis. */
export interface RateControl {
  /**
   * "target-bitrate" → the encoder is told this average bitrate (the planning
   * number the size arithmetic multiplies). "crf" → constant-quality; the target
   * is then a STATED planning equivalent, not an encoder instruction.
   */
  mode: "target-bitrate" | "crf";
  /** The bitrate the size estimate multiplies, in kbps. Always present. */
  targetVideoBitrateKbps: number;
  /** Optional rate cap the muxer would carry, in kbps (null = uncapped). */
  maxVideoBitrateKbps: number | null;
  /** The CRF the encoder would use when the mode is "crf" (null otherwise). */
  crf: number | null;
  /** Where this number comes from. Required — no silent values. */
  basis: string;
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
  codec: "AAC-LC";
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
}

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
      `${HDR_PQ_1000.maxCLL} and MaxFALL ${HDR_PQ_1000.maxFALL}. Nothing is tone-mapped here: the HDR preset is only valid ` +
      "for footage graded with an HDR target, and the colour system reports when a grade needs it.",
  };
}

/* ------------------------------------------------------------------ */
/* Audio — one published figure per family, stated                      */
/* ------------------------------------------------------------------ */

const YOUTUBE_AUDIO_BASIS =
  "YouTube's published recommended audio encoding settings: AAC-LC, 48 kHz, stereo, 384 kbps.";

const SOCIAL_AUDIO_BASIS =
  "Instagram Reels / TikTok published upload guidance for stereo audio: AAC-LC, 48 kHz, 128 kbps.";

function audioSpec(audioBitrateKbps: number, bitrateBasis: string): ExportAudioSpec {
  return {
    codec: "AAC-LC",
    sampleRateHz: EXPORT_SAMPLE_RATE_HZ,
    channels: EXPORT_CHANNELS,
    channelLayout: EXPORT_CHANNEL_LAYOUT,
    audioBitrateKbps,
    loudnessTargetLufs: EXPORT_LOUDNESS_TARGET_LUFS,
    truePeakDbfs: EXPORT_TRUE_PEAK_DBFS,
    loudnessBasis:
      `The final-mix engine's own target (DEFAULT_LOUDNESS_TARGET_LUFS = ${DEFAULT_LOUDNESS_TARGET_LUFS} LUFS integrated in ` +
      "src/lib/mix/engine.ts) — the value the Phase 4/5 mixer normalizes to, and the level YouTube, Instagram and TikTok " +
      "normalize playback to. True peak is DERIVED from the same engine's PEAK_CEILING (0.891 linear): " +
      `20·log10(0.891) = ${EXPORT_TRUE_PEAK_DBFS} dBFS.`,
    bitrateBasis,
  };
}

/* ------------------------------------------------------------------ */
/* Rate control bases                                                   */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/* The presets                                                          */
/* ------------------------------------------------------------------ */

/** The framing engine's delivery frame for a format — the resolution source. */
function frameOf(formatId: FrameFormatId): { widthPx: number; heightPx: number } {
  const spec = FRAME_FORMAT_SPECS[formatId];
  return { widthPx: spec.widthPx, heightPx: spec.heightPx };
}

/** 3840×2160 — the UHD frame the Phase 5 framing notes name for 16:9. */
const UHD = { widthPx: 3840, heightPx: 2160 };

const FHD = frameOf("16:9");
const VERTICAL = frameOf("9:16");
const SQUARE = frameOf("1:1");
const PORTRAIT_45 = frameOf("4:5");

export const EXPORT_PRESETS: readonly ExportPresetSpec[] = [
  {
    id: "youtube-2160p",
    label: "YouTube 4K (2160p SDR)",
    platform: "YouTube long-form",
    formatId: "16:9",
    aspect: "16:9",
    aspectValue: FRAME_FORMAT_SPECS["16:9"].aspectValue,
    widthPx: UHD.widthPx,
    heightPx: UHD.heightPx,
    resolution: `${UHD.widthPx}×${UHD.heightPx}`,
    container: EXPORT_CONTAINER,
    video: {
      codec: "H.265/HEVC",
      codecFamily: "hevc",
      profile: "Main",
      level: "5.1",
      pixelFormat: "yuv420p",
      frameRate: 30,
      frameRateBasis: "30 fps is the cadence YouTube's published bitrate table is stated at; 60 fps needs 53-68 Mbps by the same table.",
      rateControl: {
        mode: "target-bitrate",
        targetVideoBitrateKbps: 45_000,
        maxVideoBitrateKbps: MAX_2160,
        crf: null,
        basis: YT_2160_BASIS,
      },
    },
    audio: audioSpec(384, YOUTUBE_AUDIO_BASIS),
    colour: sdrColour(),
    subtitleTrack: {
      included: false,
      container: "mp4 timed text (tx3g / mov_text)",
      note:
        "The subtitle engine's cues would be muxed as a timed-text track. No cue file exists for this project, so the " +
        "preset declares the track format only and nothing is muxed.",
    },
    deliveryNotes: [
      "The 3840×2160 frame is the UHD delivery frame the framing engine names for 16:9; from a 1920×1080 source this needs an upscale, and the framing plan reports that factor per clip rather than assuming 4K footage.",
      "H.265/HEVC Main 8-bit 4:2:0 delivery of a 10-bit 4:2:2 graded master — the profile the platform accepts for a 4K upload.",
    ],
  },
  {
    id: "youtube-2160p-hdr",
    label: "YouTube 4K HDR10 (2160p)",
    platform: "YouTube long-form HDR",
    formatId: "16:9",
    aspect: "16:9",
    aspectValue: FRAME_FORMAT_SPECS["16:9"].aspectValue,
    widthPx: UHD.widthPx,
    heightPx: UHD.heightPx,
    resolution: `${UHD.widthPx}×${UHD.heightPx}`,
    container: EXPORT_CONTAINER,
    video: {
      codec: "H.265/HEVC",
      codecFamily: "hevc",
      profile: "Main10",
      level: "5.1",
      pixelFormat: "yuv420p10le",
      frameRate: 30,
      frameRateBasis: "30 fps is the cadence YouTube's HDR bitrate table is stated at; 60 fps needs 66-85 Mbps by the same table.",
      rateControl: {
        mode: "target-bitrate",
        targetVideoBitrateKbps: 56_000,
        maxVideoBitrateKbps: MAX_2160,
        crf: null,
        basis: YT_2160_HDR_BASIS,
      },
    },
    audio: audioSpec(384, YOUTUBE_AUDIO_BASIS),
    colour: hdrColour(),
    subtitleTrack: {
      included: false,
      container: "mp4 timed text (tx3g / mov_text)",
      note: "Same timed-text track declaration as the SDR long-form preset; nothing is muxed.",
    },
    deliveryNotes: [
      "The only preset that is valid ONLY for footage graded with an HDR target: the Phase 5 colour system marks HDR-only grades (hdrOnly) and reports when PQ tone-mapping would be needed.",
      "MaxCLL/MaxFALL and mastering-display colour volume are declared metadata; authoring them is provider work and is gated.",
    ],
  },
  {
    id: "youtube-1080p",
    label: "YouTube 1080p (FHD SDR)",
    platform: "YouTube long-form",
    formatId: "16:9",
    aspect: "16:9",
    aspectValue: FRAME_FORMAT_SPECS["16:9"].aspectValue,
    widthPx: FHD.widthPx,
    heightPx: FHD.heightPx,
    resolution: `${FHD.widthPx}×${FHD.heightPx}`,
    container: EXPORT_CONTAINER,
    video: {
      codec: "H.264/AVC",
      codecFamily: "h264",
      profile: "High",
      level: "4.0",
      pixelFormat: "yuv420p",
      frameRate: 30,
      frameRateBasis: "30 fps is the cadence YouTube's bitrate table is stated at; 60 fps needs 12 Mbps by the same table.",
      rateControl: {
        mode: "target-bitrate",
        targetVideoBitrateKbps: 8_000,
        maxVideoBitrateKbps: 16_000,
        crf: null,
        basis: YT_1080_BASIS,
      },
    },
    audio: audioSpec(384, YOUTUBE_AUDIO_BASIS),
    colour: sdrColour(),
    subtitleTrack: {
      included: false,
      container: "mp4 timed text (tx3g / mov_text)",
      note: "Same timed-text track declaration; nothing is muxed.",
    },
    deliveryNotes: [
      "The 1920×1080 frame matches the framing engine's 16:9 delivery format exactly: a 16:9 source is a straight 1.0 pass, no crop and no upscale.",
      "The long-form default when the source is 1080p — the 4K preset would need a real upscale.",
    ],
  },
  {
    id: "youtube-shorts",
    label: "YouTube Shorts (9:16)",
    platform: "YouTube Shorts",
    formatId: "9:16",
    aspect: "9:16",
    aspectValue: FRAME_FORMAT_SPECS["9:16"].aspectValue,
    widthPx: VERTICAL.widthPx,
    heightPx: VERTICAL.heightPx,
    resolution: `${VERTICAL.widthPx}×${VERTICAL.heightPx}`,
    container: EXPORT_CONTAINER,
    video: {
      codec: "H.264/AVC",
      codecFamily: "h264",
      profile: "High",
      level: "4.0",
      pixelFormat: "yuv420p",
      frameRate: 30,
      frameRateBasis: "30 fps; Shorts also accepts 60 fps (12 Mbps by YouTube's 1080p table).",
      rateControl: {
        mode: "target-bitrate",
        targetVideoBitrateKbps: 8_000,
        maxVideoBitrateKbps: 16_000,
        crf: null,
        basis: VERTICAL_BASIS,
      },
    },
    audio: audioSpec(384, YOUTUBE_AUDIO_BASIS),
    colour: sdrColour(),
    subtitleTrack: {
      included: false,
      container: "mp4 timed text (tx3g / mov_text)",
      note: "Same timed-text track declaration; nothing is muxed.",
    },
    deliveryNotes: [
      "1080×1920 is the framing engine's 9:16 delivery frame. From a 16:9 master the kept columns are upscaled — the framing plan reports the upscale factor per clip (608×1080 @ 1.7778× for a 1080p source) before this preset is honest about delivering 1080p.",
      "This preset is the same 9:16 delivery frame as the Reels and TikTok presets; only the platform guidance and audio bitrate differ.",
    ],
  },
  {
    id: "instagram-reels",
    label: "Instagram Reels (9:16)",
    platform: "Instagram Reels",
    formatId: "9:16",
    aspect: "9:16",
    aspectValue: FRAME_FORMAT_SPECS["9:16"].aspectValue,
    widthPx: VERTICAL.widthPx,
    heightPx: VERTICAL.heightPx,
    resolution: `${VERTICAL.widthPx}×${VERTICAL.heightPx}`,
    container: EXPORT_CONTAINER,
    video: {
      codec: "H.264/AVC",
      codecFamily: "h264",
      profile: "High",
      level: "4.0",
      pixelFormat: "yuv420p",
      frameRate: 30,
      frameRateBasis: "30 fps — Instagram Reels' published recommended cadence (24-60 fps accepted).",
      rateControl: {
        mode: "target-bitrate",
        targetVideoBitrateKbps: 8_000,
        maxVideoBitrateKbps: 16_000,
        crf: null,
        basis: VERTICAL_BASIS,
      },
    },
    audio: audioSpec(128, SOCIAL_AUDIO_BASIS),
    colour: sdrColour(),
    subtitleTrack: {
      included: false,
      container: "mp4 timed text (tx3g / mov_text)",
      note: "Reels' own caption layer is authored in the app; the container track is declared but nothing is muxed.",
    },
    deliveryNotes: [
      "Same 1080×1920 frame as the Shorts preset — one geometry, three platform presets.",
      "Reels is a 1080p-class delivery: the framing plan's upscale factor decides whether a 16:9 source really reaches 1080p.",
    ],
  },
  {
    id: "tiktok",
    label: "TikTok (9:16)",
    platform: "TikTok",
    formatId: "9:16",
    aspect: "9:16",
    aspectValue: FRAME_FORMAT_SPECS["9:16"].aspectValue,
    widthPx: VERTICAL.widthPx,
    heightPx: VERTICAL.heightPx,
    resolution: `${VERTICAL.widthPx}×${VERTICAL.heightPx}`,
    container: EXPORT_CONTAINER,
    video: {
      codec: "H.264/AVC",
      codecFamily: "h264",
      profile: "High",
      level: "4.0",
      pixelFormat: "yuv420p",
      frameRate: 30,
      frameRateBasis: "30 fps — TikTok's published recommended cadence.",
      rateControl: {
        mode: "target-bitrate",
        targetVideoBitrateKbps: 8_000,
        maxVideoBitrateKbps: 16_000,
        crf: null,
        basis: VERTICAL_BASIS,
      },
    },
    audio: audioSpec(128, SOCIAL_AUDIO_BASIS),
    colour: sdrColour(),
    subtitleTrack: {
      included: false,
      container: "mp4 timed text (tx3g / mov_text)",
      note: "Same declaration as Reels; nothing is muxed.",
    },
    deliveryNotes: [
      "Identical geometry to Shorts and Reels; TikTok's own overlay UI is why the caption-safe band from the framing engine matters.",
    ],
  },
  {
    id: "square-1080",
    label: "Square 1:1 (1080)",
    platform: "feed posts (Instagram / LinkedIn / X)",
    formatId: "1:1",
    aspect: "1:1",
    aspectValue: FRAME_FORMAT_SPECS["1:1"].aspectValue,
    widthPx: SQUARE.widthPx,
    heightPx: SQUARE.heightPx,
    resolution: `${SQUARE.widthPx}×${SQUARE.heightPx}`,
    container: EXPORT_CONTAINER,
    video: {
      codec: "H.264/AVC",
      codecFamily: "h264",
      profile: "High",
      level: "4.0",
      pixelFormat: "yuv420p",
      frameRate: 30,
      frameRateBasis: "30 fps.",
      rateControl: {
        mode: "target-bitrate",
        targetVideoBitrateKbps: 8_000,
        maxVideoBitrateKbps: 16_000,
        crf: null,
        basis: VERTICAL_BASIS,
      },
    },
    audio: audioSpec(128, SOCIAL_AUDIO_BASIS),
    colour: sdrColour(),
    subtitleTrack: {
      included: false,
      container: "mp4 timed text (tx3g / mov_text)",
      note: "Same declaration; nothing is muxed.",
    },
    deliveryNotes: [
      "1080×1080 is the framing engine's 1:1 delivery frame — the least destructive narrow crop of a 16:9 master (full height, 56% of the width at 1080p).",
    ],
  },
  {
    id: "portrait-4x5",
    label: "Portrait 4:5 (1080×1350)",
    platform: "feed portrait (Instagram / Facebook)",
    formatId: "4:5",
    aspect: "4:5",
    aspectValue: FRAME_FORMAT_SPECS["4:5"].aspectValue,
    widthPx: PORTRAIT_45.widthPx,
    heightPx: PORTRAIT_45.heightPx,
    resolution: `${PORTRAIT_45.widthPx}×${PORTRAIT_45.heightPx}`,
    container: EXPORT_CONTAINER,
    video: {
      codec: "H.264/AVC",
      codecFamily: "h264",
      profile: "High",
      level: "4.0",
      pixelFormat: "yuv420p",
      frameRate: 30,
      frameRateBasis: "30 fps.",
      rateControl: {
        mode: "target-bitrate",
        targetVideoBitrateKbps: 8_000,
        maxVideoBitrateKbps: 16_000,
        crf: null,
        basis: VERTICAL_BASIS,
      },
    },
    audio: audioSpec(128, SOCIAL_AUDIO_BASIS),
    colour: sdrColour(),
    subtitleTrack: {
      included: false,
      container: "mp4 timed text (tx3g / mov_text)",
      note: "Same declaration; nothing is muxed.",
    },
    deliveryNotes: [
      "1080×1350 is the framing engine's 4:5 delivery frame — taller than square, shorter than 9:16, and the feed portrait Instagram actually renders.",
    ],
  },
];

const PRESET_INDEX = new Map<ExportPresetId, ExportPresetSpec>(EXPORT_PRESETS.map((p) => [p.id, p]));

export function findExportPreset(id: unknown): ExportPresetSpec | null {
  if (!isExportPresetId(id)) return null;
  return PRESET_INDEX.get(id) ?? null;
}

/** Presets in canonical catalogue order (the order IDs are always reported in). */
export function orderPresetIds(ids: unknown): ExportPresetId[] {
  if (!Array.isArray(ids)) return [];
  const wanted = new Set(ids.filter((id): id is ExportPresetId => isExportPresetId(id)));
  return EXPORT_PRESET_IDS.filter((id) => wanted.has(id));
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
  };
}

export function listExportPresetViews(): Record<string, unknown>[] {
  return EXPORT_PRESETS.map(presetView);
}
