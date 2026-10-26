/**
 * THE EXPORT SPECIFICATION MATRIX — one declaration, and the only one
 * (Phase 8, block 2a).
 *
 * WHAT THIS FILE IS
 * Every axis of a delivery specification the owner listed — resolution,
 * container, video codec, frame rate, bitrate mode, quality tier, colour,
 * audio — is declared here ONCE, as a list of named options. A preset does not
 * carry values; it carries the IDS of options in this matrix, and the resolver
 * in ./presets turns those ids into numbers. That is what makes "a preset holds
 * a value that is not in the matrix" impossible to ship: there is nowhere to put
 * such a value.
 *
 * WHERE EVERY OPTION'S TRUTH COMES FROM (the rule the whole product keeps)
 * An option's status is never a typed box that can be edited to say anything.
 * Each option carries a `provenance` with exactly one of three `truth` values:
 *
 *   - `computed`  — the value is arithmetic or a declared table IN THIS REPO,
 *                   evaluated now: a resolution from the Phase 5 framing engine,
 *                   a level computed from the pixel rate, the final-mix engine's
 *                   own loudness constant, a true-peak ceiling derived from its
 *                   linear peak ceiling. Real today, checkable by hand.
 *   - `gated`     — the option is a real choice whose PRODUCTION needs an input
 *                   this build does not have, and `missingInput` NAMES it
 *                   ("the ffmpeg binary"). A gated option is a specification the
 *                   app can compute, never a file it has produced.
 *   - `provider`  — the option is handed to a keyed AI provider; `capability`
 *                   names which, and the live key state is attached at RESPONSE
 *                   time by ./spec-status (server-side), never baked in here.
 *
 * NOTHING IN THIS MATRIX IS DELIVERED ON THIS BUILD. `producedOnThisBuild` is
 * false on every option and there is no code path here that writes a byte:
 * this machine has no `ffmpeg` and no `ffprobe`. The encode, mux and checksum
 * stages of the render pipeline are BLOCKED and name that binary.
 *
 * COMBINATION RULES
 * The axes are not independent — a codec cannot live in every container, an
 * HDR target cannot be carried by an 8-bit profile, a level has to cover the
 * pixel rate, CBR has to name one bitrate rather than two. Those rules are
 * declared once below, `checkCombination()` reports every violation, and
 * `assertLegal()` THROWS rather than emitting an illegal combination.
 *
 * Pure and client-safe: constants, arithmetic and pure functions only. It reads
 * no env var, opens no file and imports nothing server-only.
 */
import { HDR_PQ_1000, SDR_709 } from "../color/presets";
import { DEFAULT_LOUDNESS_TARGET_LUFS, PEAK_CEILING } from "../mix/engine";
import { FRAME_FORMAT_SPECS, type FrameFormatId } from "../framing/formats";

/** Bumped when an option is added, removed or its meaning changes. */
export const SPEC_MATRIX_VERSION = "export-spec-matrix/1";

/* ------------------------------------------------------------------ */
/* Provenance — the three, and only three, sources of truth            */
/* ------------------------------------------------------------------ */

export type SpecTruth = "computed" | "gated" | "provider";

export interface SpecProvenance {
  /** Where this option's truth comes from. One of exactly three values. */
  truth: SpecTruth;
  /** The module/constant the value is computed from, or the input it waits on. */
  source: string;
  /** Why the option exists and what it means, in the product's own words. */
  basis: string;
  /** The NAMED missing input when truth === "gated"; null otherwise. */
  missingInput: string | null;
  /** The AI capability when truth === "provider"; null otherwise. */
  capability: string | null;
  /**
   * Always false on this build. Kept as a field rather than a sentence so a
   * reader can filter on it: an option is a specification, not a file.
   */
  producedOnThisBuild: false;
}

/**
 * The missing input every encode-side option names. One string, one machine.
 *
 * WHAT CHANGED IN BLOCK 2b, AND WHY THIS SENTENCE IS NARROWER, NOT WIDER:
 * `ffmpeg` IS now installed on this machine and the render pipeline's encode
 * stage HAS produced real files — from a declared synthetic source, at
 * 1920×1080. What does not exist, and cannot on this machine, is a PROJECT's
 * video: a real project has no source media without a media provider, and
 * 3840×2160 was killed by the memory ceiling. So the gate below no longer names
 * a missing binary (which would now be false); it names the missing project
 * video. Runnability itself is decided per render by a live probe
 * (src/lib/render/probes.ts) and the recorded facts live in
 * src/lib/render/encoder-facts.ts.
 */
export const ENCODER_GATE_MISSING =
  "a project video — an encoder is installed on this build (ffmpeg 7.0.2) and its encode stage has produced files from a declared synthetic source, " +
  "but no project's video has been produced: no source media exists for a real project without a media provider";

/** @deprecated Block 2b renamed this: the gate is a missing project video, not a missing binary. Kept as an alias for existing call sites. */
export const FFMPEG_MISSING = ENCODER_GATE_MISSING;

function computed(source: string, basis: string): SpecProvenance {
  return { truth: "computed", source, basis, missingInput: null, capability: null, producedOnThisBuild: false };
}

function gated(source: string, basis: string, missingInput: string = FFMPEG_MISSING): SpecProvenance {
  return { truth: "gated", source, basis, missingInput, capability: null, producedOnThisBuild: false };
}

function provider(source: string, basis: string, capability: string): SpecProvenance {
  return { truth: "provider", source, basis, missingInput: null, capability, producedOnThisBuild: false };
}

/** The sentence the surface prints above the matrix, in the product's words. */
export const SPEC_DELIVERY_STATEMENT =
  "No option in this matrix is delivered as a file for a project on this build. An encoder is installed (ffmpeg 7.0.2) and the render " +
  "pipeline's own encode stage has produced real files from a DECLARED SYNTHETIC SOURCE at 1920×1080. No project's video has been produced: " +
  "no source media exists for a real project without a media provider, and 3840×2160 was killed by this machine's memory ceiling. Every gated " +
  "option is still a specification the app computes, not a file it has produced, and every computed option is a number the app evaluates " +
  "today — also not a file.";

/* ------------------------------------------------------------------ */
/* Axis 1 — resolutions                                                */
/* ------------------------------------------------------------------ */

export const RESOLUTION_IDS = [
  "uhd-2160p",
  "uhd-2160p-vertical",
  "qhd-1440p",
  "fhd-1080p",
  "fhd-1080p-vertical",
  "square-1080p",
  "portrait-1080p",
  "hd-720p",
  "hd-720p-vertical",
  "sd-480p",
] as const;
export type ResolutionId = (typeof RESOLUTION_IDS)[number];

export interface ResolutionOption {
  id: ResolutionId;
  label: string;
  widthPx: number;
  heightPx: number;
  /** The Phase 5 delivery frame this resolution belongs to. */
  formatId: FrameFormatId;
  aspect: string;
  aspectValue: number;
  /** True when the frame is taller than it is wide. */
  portrait: boolean;
  provenance: SpecProvenance;
}

const FRAMING = "src/lib/framing/formats.ts FRAME_FORMAT_SPECS";
const RESOLUTION_BASIS =
  "A delivery frame the Phase 5 framing engine plans crops and safe areas for. The pixel count is the engine's own " +
  "delivery size (or, for the UHD frames, the 3840×2160 / 2160×3840 sizes the framing notes name), never a number " +
  "typed here.";

function res(
  id: ResolutionId,
  label: string,
  formatId: FrameFormatId,
  widthPx: number,
  heightPx: number,
  basisNote?: string,
): ResolutionOption {
  const spec = FRAME_FORMAT_SPECS[formatId];
  return {
    id,
    label,
    widthPx,
    heightPx,
    formatId,
    aspect: spec.aspect,
    aspectValue: spec.aspectValue,
    portrait: heightPx > widthPx,
    provenance: computed(FRAMING, basisNote ? `${RESOLUTION_BASIS} ${basisNote}` : RESOLUTION_BASIS),
  };
}

const FHD = FRAME_FORMAT_SPECS["16:9"];
const VERTICAL = FRAME_FORMAT_SPECS["9:16"];
const SQUARE = FRAME_FORMAT_SPECS["1:1"];
const PORTRAIT = FRAME_FORMAT_SPECS["4:5"];

export const RESOLUTIONS: readonly ResolutionOption[] = [
  res("uhd-2160p", "UHD 4K 3840×2160", "16:9", 3840, 2160, "The UHD frame the framing notes name for 16:9."),
  res("uhd-2160p-vertical", "UHD 4K vertical 2160×3840", "9:16", 2160, 3840, "The 9:16 shape at UHD height — declared, not used by a preset today."),
  res("qhd-1440p", "QHD 2560×1440", "16:9", 2560, 1440, "Declared as a legal 16:9 size; no preset delivers it today."),
  res("fhd-1080p", "FHD 1920×1080", "16:9", FHD.widthPx, FHD.heightPx),
  res("fhd-1080p-vertical", "Vertical 1080×1920", "9:16", VERTICAL.widthPx, VERTICAL.heightPx),
  res("square-1080p", "Square 1080×1080", "1:1", SQUARE.widthPx, SQUARE.heightPx),
  res("portrait-1080p", "Portrait 1080×1350", "4:5", PORTRAIT.widthPx, PORTRAIT.heightPx),
  res("hd-720p", "HD 1280×720", "16:9", 1280, 720, "Declared as a legal 16:9 size; no preset delivers it today."),
  res("hd-720p-vertical", "Vertical 720×1280", "9:16", 720, 1280, "Declared as a legal 9:16 size; no preset delivers it today."),
  res("sd-480p", "SD 854×480", "16:9", 854, 480, "Declared as a legal 16:9 size; no preset delivers it today."),
];

/* ------------------------------------------------------------------ */
/* Axis 2 — containers                                                 */
/* ------------------------------------------------------------------ */

export const CONTAINER_IDS = ["mp4", "mov", "mkv", "webm"] as const;
export type ContainerId = (typeof CONTAINER_IDS)[number];

export interface ContainerOption {
  id: ContainerId;
  label: string;
  /** The ISO/Matroska family the muxer writes. */
  family: string;
  /** Whether the muxer can place the index (moov) before the media data. */
  supportsFaststart: boolean;
  provenance: SpecProvenance;
}

export const CONTAINERS: readonly ContainerOption[] = [
  {
    id: "mp4",
    label: "MP4 (ISO/IEC 14496-12)",
    family: "ISO BMFF",
    supportsFaststart: true,
    provenance: gated(
      "the muxer step of the render pipeline (container-mux)",
      "The container the delivery presets write: one file, index first, the shape the long-form and short-form platforms " +
        "accept for upload. Writing it is a mux operation, which needs the encoder this build does not have.",
    ),
  },
  {
    id: "mov",
    label: "QuickTime MOV",
    family: "ISO BMFF",
    supportsFaststart: true,
    provenance: gated(
      "the muxer step of the render pipeline (container-mux)",
      "Declared as a legal container for the intermediate/ProRes route. No preset delivers MOV today.",
    ),
  },
  {
    id: "mkv",
    label: "Matroska",
    family: "Matroska",
    supportsFaststart: false,
    provenance: gated(
      "the muxer step of the render pipeline (container-mux)",
      "Declared as a legal archival container: it carries any codec in this matrix. Matroska has no faststart flag — its " +
        "index is written at the end — so an option that needs index-first placement cannot use it.",
    ),
  },
  {
    id: "webm",
    label: "WebM",
    family: "Matroska",
    supportsFaststart: false,
    provenance: gated(
      "the muxer step of the render pipeline (container-mux)",
      "Declared for the royalty-free codecs only (VP9, AV1). WebM rejects H.264, HEVC and ProRes — that rule is enforced " +
        "below rather than left to the muxer to refuse.",
    ),
  },
];

/* ------------------------------------------------------------------ */
/* Axis 3 — video codecs, with their real level tables                 */
/* ------------------------------------------------------------------ */

export const CODEC_IDS = ["h264", "hevc", "av1", "vp9"] as const;
export type CodecId = (typeof CODEC_IDS)[number];

/** One level, with the published limits that decide whether it covers a frame. */
export interface CodecLevel {
  level: string;
  /** Max luma samples in one frame (MaxFS / MaxLumaPs). */
  maxLumaSamples: number;
  /** Max luma samples per second (MaxMBPS / MaxLumaSr). */
  maxLumaSamplesPerSecond: number;
}

export interface CodecProfile {
  name: string;
  bitDepth: number;
  /** The pixel format this profile encodes. */
  pixelFormat: string;
}

export interface CodecOption {
  id: CodecId;
  label: string;
  family: CodecId;
  /** Profiles this codec declares; a preset names one. */
  profiles: CodecProfile[];
  /** Levels this codec declares, ascending. A preset names one that covers the frame. */
  levels: readonly CodecLevel[];
  /** Container ids this codec may live in. */
  containers: readonly ContainerId[];
  provenance: SpecProvenance;
}

/**
 * H.264 (ITU-T H.264 Table A-1) and HEVC (Table A.8) level limits, in luma
 * samples. These are the published numbers, not tuned here; the resolver
 * multiplies width × height by the frame rate and picks the lowest level whose
 * two limits both cover it, so a level is COMPUTED rather than chosen.
 */
const H264_LEVELS: readonly CodecLevel[] = [
  // H.264 Table A-1 publishes MaxFS and MaxMBPS in MACROBLOCKS (16x16 = 256 luma
  // samples each). They are converted here so every codec is compared in the
  // same unit as HEVC's MaxLumaPs / MaxLumaSr — a luma sample.
  { level: "3.1", maxLumaSamples: 3600 * 256, maxLumaSamplesPerSecond: 108000 * 256 },
  { level: "4.0", maxLumaSamples: 8192 * 256, maxLumaSamplesPerSecond: 245760 * 256 },
  { level: "4.1", maxLumaSamples: 8192 * 256, maxLumaSamplesPerSecond: 245760 * 256 },
  { level: "4.2", maxLumaSamples: 8704 * 256, maxLumaSamplesPerSecond: 522240 * 256 },
  { level: "5.0", maxLumaSamples: 22080 * 256, maxLumaSamplesPerSecond: 589824 * 256 },
  { level: "5.1", maxLumaSamples: 36864 * 256, maxLumaSamplesPerSecond: 983040 * 256 },
  { level: "5.2", maxLumaSamples: 36864 * 256, maxLumaSamplesPerSecond: 2073600 * 256 },
  { level: "6.0", maxLumaSamples: 139264 * 256, maxLumaSamplesPerSecond: 4177920 * 256 },
];

const HEVC_LEVELS: readonly CodecLevel[] = [
  { level: "4.0", maxLumaSamples: 2228224, maxLumaSamplesPerSecond: 66846720 },
  { level: "4.1", maxLumaSamples: 2228224, maxLumaSamplesPerSecond: 133693440 },
  { level: "5.0", maxLumaSamples: 8912896, maxLumaSamplesPerSecond: 267386880 },
  { level: "5.1", maxLumaSamples: 8912896, maxLumaSamplesPerSecond: 534773760 },
  { level: "5.2", maxLumaSamples: 8912896, maxLumaSamplesPerSecond: 1069547520 },
  { level: "6.0", maxLumaSamples: 35651584, maxLumaSamplesPerSecond: 2139095040 },
];

const AV1_LEVELS: readonly CodecLevel[] = [
  { level: "4.0", maxLumaSamples: 2228224, maxLumaSamplesPerSecond: 66846720 },
  { level: "5.0", maxLumaSamples: 8912896, maxLumaSamplesPerSecond: 267386880 },
  { level: "5.1", maxLumaSamples: 8912896, maxLumaSamplesPerSecond: 534773760 },
  { level: "5.2", maxLumaSamples: 8912896, maxLumaSamplesPerSecond: 1069547520 },
];

const VP9_LEVELS: readonly CodecLevel[] = [
  { level: "4.0", maxLumaSamples: 2228224, maxLumaSamplesPerSecond: 66846720 },
  { level: "5.0", maxLumaSamples: 8912896, maxLumaSamplesPerSecond: 267386880 },
  { level: "5.1", maxLumaSamples: 8912896, maxLumaSamplesPerSecond: 534773760 },
];

export const CODECS: readonly CodecOption[] = [
  {
    id: "h264",
    label: "H.264/AVC",
    family: "h264",
    profiles: [
      { name: "High", bitDepth: 8, pixelFormat: "yuv420p" },
      { name: "Main", bitDepth: 8, pixelFormat: "yuv420p" },
    ],
    levels: H264_LEVELS,
    containers: ["mp4", "mov", "mkv"],
    provenance: gated(
      "the encode stage of the render pipeline (encode-master)",
      "The most widely decodable delivery codec, and the one every platform in the readiness catalogue accepts. 8-bit 4:2:0 " +
        "only: H.264 cannot carry the 10-bit HDR target, which the combination rules enforce.",
    ),
  },
  {
    id: "hevc",
    label: "H.265/HEVC",
    family: "hevc",
    profiles: [
      { name: "Main", bitDepth: 8, pixelFormat: "yuv420p" },
      { name: "Main10", bitDepth: 10, pixelFormat: "yuv420p10le" },
    ],
    levels: HEVC_LEVELS,
    containers: ["mp4", "mov", "mkv"],
    provenance: gated(
      "the encode stage of the render pipeline (encode-master)",
      "Roughly half the bitrate of H.264 for the same picture, and the only codec in this matrix that carries both the " +
        "8-bit SDR and the 10-bit HDR profile inside MP4. A 4K delivery that wants to stay under a size ceiling uses it.",
    ),
  },
  {
    id: "av1",
    label: "AV1",
    family: "av1",
    profiles: [
      { name: "Main", bitDepth: 10, pixelFormat: "yuv420p10le" },
      { name: "Main8", bitDepth: 8, pixelFormat: "yuv420p" },
    ],
    levels: AV1_LEVELS,
    containers: ["mp4", "webm", "mkv"],
    provenance: gated(
      "the encode stage of the render pipeline (encode-master)",
      "Declared as a legal royalty-free codec for both MP4 and WebM. No preset delivers AV1 today: its encode time is the " +
        "reason the presets do not choose it on a machine with no encoder at all.",
    ),
  },
  {
    id: "vp9",
    label: "VP9",
    family: "vp9",
    profiles: [
      { name: "Profile 0", bitDepth: 8, pixelFormat: "yuv420p" },
      { name: "Profile 2", bitDepth: 10, pixelFormat: "yuv420p10le" },
    ],
    levels: VP9_LEVELS,
    containers: ["webm", "mkv"],
    provenance: gated(
      "the encode stage of the render pipeline (encode-master)",
      "Declared for the WebM route only. No preset delivers VP9 today.",
    ),
  },
];

/* ------------------------------------------------------------------ */
/* Axis 4 — frame rates                                                */
/* ------------------------------------------------------------------ */

export const FRAME_RATE_IDS = ["24", "25", "30", "50", "60"] as const;
export type FrameRateId = (typeof FRAME_RATE_IDS)[number];

export interface FrameRateOption {
  id: FrameRateId;
  fps: number;
  label: string;
  provenance: SpecProvenance;
}

export const FRAME_RATES: readonly FrameRateOption[] = FRAME_RATE_IDS.map((id) => ({
  id,
  fps: Number(id),
  label: `${id} fps`,
  provenance: computed(
    "declared cadence (this matrix) × the level table's MaxLumaSr",
    `${id} fps is a declared delivery cadence. Whether a codec level covers it is arithmetic — width × height × fps is ` +
      "compared with the level's published luma-sample rate — so a cadence is never assumed to fit.",
  ),
}));

/* ------------------------------------------------------------------ */
/* Axis 5 — bitrate modes (CBR / VBR / CRF)                            */
/* ------------------------------------------------------------------ */

export const RATE_MODE_IDS = ["cbr", "vbr", "crf"] as const;
export type RateModeId = (typeof RATE_MODE_IDS)[number];

export interface RateModeOption {
  id: RateModeId;
  label: string;
  /** True when the mode names ONE bitrate rather than a target and a cap. */
  singleBitrate: boolean;
  /** True when the mode needs a CRF value. */
  needsCrf: boolean;
  provenance: SpecProvenance;
}

export const RATE_MODES: readonly RateModeOption[] = [
  {
    id: "cbr",
    label: "CBR — constant bitrate",
    singleBitrate: true,
    needsCrf: false,
    provenance: gated(
      "the encoder's rate-control flags (encode stage)",
      "One bitrate for every second. Chosen only where a predictable upload throughput matters more than the last few " +
        "percent of quality: the target and the cap are the same number, which the rules enforce.",
    ),
  },
  {
    id: "vbr",
    label: "VBR — variable bitrate with a cap",
    singleBitrate: false,
    needsCrf: false,
    provenance: gated(
      "the encoder's rate-control flags (encode stage)",
      "An average target with a ceiling: quiet passages spend less, busy ones more, and the cap keeps the file inside a " +
        "size budget. This is what the long-form presets use, with the platform's published average as the target.",
    ),
  },
  {
    id: "crf",
    label: "CRF — constant quality",
    singleBitrate: false,
    needsCrf: true,
    provenance: gated(
      "the encoder's rate-control flags (encode stage)",
      "The encoder is told a quality level, not a bitrate, and spends what the picture needs. The preset still prints a " +
        "target bitrate, but it is a STATED PLANNING EQUIVALENT used for the size estimate — it is not an instruction to " +
        "the encoder, and the surface says so wherever the number appears.",
    ),
  },
];

/* ------------------------------------------------------------------ */
/* Axis 6 — quality tiers                                              */
/* ------------------------------------------------------------------ */

export const QUALITY_IDS = ["draft", "standard", "high", "master", "archive"] as const;
export type QualityId = (typeof QUALITY_IDS)[number];

export interface QualityOption {
  id: QualityId;
  label: string;
  /** The CRF this tier means for each codec family (null where the codec has none). */
  crfByCodec: Record<CodecId, number>;
  provenance: SpecProvenance;
}

export const QUALITY_TIERS: readonly QualityOption[] = [
  {
    id: "draft",
    label: "Draft — review copy",
    crfByCodec: { h264: 28, hevc: 30, av1: 40, vp9: 40 },
    provenance: gated("the encoder's quality parameter (encode stage)", "A review copy: fastest to encode, visibly softer."),
  },
  {
    id: "standard",
    label: "Standard",
    crfByCodec: { h264: 23, hevc: 26, av1: 34, vp9: 34 },
    provenance: gated("the encoder's quality parameter (encode stage)", "The usual web default: a good picture at a moderate bitrate."),
  },
  {
    id: "high",
    label: "High — delivery",
    crfByCodec: { h264: 18, hevc: 20, av1: 28, vp9: 30 },
    provenance: gated(
      "the encoder's quality parameter (encode stage)",
      "The tier the delivery presets use: visually transparent for most content at a bitrate a platform accepts.",
    ),
  },
  {
    id: "master",
    label: "Master — archive headroom",
    crfByCodec: { h264: 16, hevc: 18, av1: 24, vp9: 26 },
    provenance: gated("the encoder's quality parameter (encode stage)", "More headroom than delivery needs; larger files."),
  },
  {
    id: "archive",
    label: "Archive — near-lossless",
    crfByCodec: { h264: 12, hevc: 14, av1: 18, vp9: 20 },
    provenance: gated("the encoder's quality parameter (encode stage)", "A preservation copy, not an upload."),
  },
];

/* ------------------------------------------------------------------ */
/* Axis 7 — colour targets                                             */
/* ------------------------------------------------------------------ */

export const COLOUR_IDS = ["sdr-rec709", "hdr10-pq"] as const;
export type ColourId = (typeof COLOUR_IDS)[number];

export interface ColourOption {
  id: ColourId;
  label: string;
  display: "SDR" | "HDR";
  standard: string;
  transfer: string;
  peakNits: number;
  /** The bit depth a bitstream must carry to hold this target. */
  requiredBitDepth: number;
  provenance: SpecProvenance;
}

export const COLOUR_TARGETS: readonly ColourOption[] = [
  {
    id: "sdr-rec709",
    label: "SDR — Rec.709 / BT.1886 / 100 nits",
    display: SDR_709.display,
    standard: SDR_709.standard,
    transfer: SDR_709.transfer,
    peakNits: SDR_709.peakNits,
    requiredBitDepth: 8,
    provenance: computed(
      "src/lib/color/presets.ts SDR_709",
      "The Phase 5 colour system's SDR delivery target, reused verbatim: Rec.709 primaries, BT.1886 display gamma, a " +
        "100-nit peak. The tagging numbers are computed from that constant; writing them into a bitstream is gated.",
    ),
  },
  {
    id: "hdr10-pq",
    label: "HDR10 — Rec.2020 / PQ / 1000 nits",
    display: HDR_PQ_1000.display,
    standard: HDR_PQ_1000.standard,
    transfer: HDR_PQ_1000.transfer,
    peakNits: HDR_PQ_1000.peakNits,
    requiredBitDepth: 10,
    provenance: computed(
      "src/lib/color/presets.ts HDR_PQ_1000",
      "The Phase 5 colour system's HDR10 target, reused verbatim: Rec.2020 primaries, SMPTE ST 2084 (PQ) transfer, a " +
        "1000-nit peak with MaxCLL/MaxFALL. It needs a 10-bit profile, which the rules enforce — an 8-bit H.264 stream " +
        "cannot carry it.",
    ),
  },
];

/* ------------------------------------------------------------------ */
/* Axis 8 — pixel formats                                              */
/* ------------------------------------------------------------------ */

export const PIXEL_FORMAT_IDS = ["yuv420p", "yuv420p10le", "yuv422p10le", "yuv444p"] as const;
export type PixelFormatId = (typeof PIXEL_FORMAT_IDS)[number];

export interface PixelFormatOption {
  id: PixelFormatId;
  label: string;
  bitDepth: number;
  chromaSubsampling: string;
  provenance: SpecProvenance;
}

export const PIXEL_FORMATS: readonly PixelFormatOption[] = [
  {
    id: "yuv420p",
    label: "4:2:0 8-bit",
    bitDepth: 8,
    chromaSubsampling: "4:2:0",
    provenance: gated(
      "the encoder's pixel-format flag (encode stage)",
      "What every delivery preset encodes: 8-bit 4:2:0, the chroma layout the delivery platforms accept. The graded master " +
        "is 10-bit 4:2:2 — that difference is stated on the preset, not hidden.",
    ),
  },
  {
    id: "yuv420p10le",
    label: "4:2:0 10-bit",
    bitDepth: 10,
    chromaSubsampling: "4:2:0",
    provenance: gated(
      "the encoder's pixel-format flag (encode stage)",
      "The HDR delivery layout: 10-bit 4:2:0, which is what carries Rec.2020/PQ without banding.",
    ),
  },
  {
    id: "yuv422p10le",
    label: "4:2:2 10-bit",
    bitDepth: 10,
    chromaSubsampling: "4:2:2",
    provenance: gated(
      "the encoder's pixel-format flag (encode stage)",
      "The graded master's own 10-bit 4:2:2 layout. Declared for completeness: no codec profile in this matrix encodes " +
        "it, so no combination using it is legal today and the surface says so.",
    ),
  },
  {
    id: "yuv444p",
    label: "4:4:4 8-bit",
    bitDepth: 8,
    chromaSubsampling: "4:4:4",
    provenance: gated(
      "the encoder's pixel-format flag (encode stage)",
      "Declared for completeness: no codec profile in this matrix encodes 4:4:4, so no combination using it is legal " +
        "today and no platform in the readiness catalogue asks for it.",
    ),
  },
];

/* ------------------------------------------------------------------ */
/* Axis 9 — audio                                                      */
/* ------------------------------------------------------------------ */

export const AUDIO_CODEC_IDS = ["aac-lc", "opus"] as const;
export type AudioCodecId = (typeof AUDIO_CODEC_IDS)[number];

export interface AudioCodecOption {
  id: AudioCodecId;
  label: string;
  containers: readonly ContainerId[];
  provenance: SpecProvenance;
}

export const AUDIO_CODECS: readonly AudioCodecOption[] = [
  {
    id: "aac-lc",
    label: "AAC-LC",
    containers: ["mp4", "mov", "mkv"],
    provenance: gated(
      "the audio encode step of the mux stage",
      "The audio codec every delivery preset uses: the one the platforms' published upload guidance names for stereo " +
        "programme audio.",
    ),
  },
  {
    id: "opus",
    label: "Opus",
    containers: ["webm", "mkv"],
    provenance: gated(
      "the audio encode step of the mux stage",
      "Declared for the WebM route. No preset delivers Opus today.",
    ),
  },
];

export const AUDIO_SAMPLE_RATE_IDS = ["44100", "48000"] as const;
export type AudioSampleRateId = (typeof AUDIO_SAMPLE_RATE_IDS)[number];

export interface AudioSampleRateOption {
  id: AudioSampleRateId;
  hz: number;
  label: string;
  provenance: SpecProvenance;
}

export const AUDIO_SAMPLE_RATES: readonly AudioSampleRateOption[] = AUDIO_SAMPLE_RATE_IDS.map((id) => ({
  id,
  hz: Number(id),
  label: `${Number(id) / 1000} kHz`,
  provenance: computed(
    "declared sample rate (this matrix)",
    `${Number(id)} Hz is a declared sample rate. 48 kHz is the rate every preset delivers at — the rate the platforms' ` +
      "published audio guidance names and the rate the mix engine plans in; 44.1 kHz is declared as legal for the routes " +
      "that need it.",
  ),
}));

export const AUDIO_BITRATE_IDS = ["128", "192", "256", "384"] as const;
export type AudioBitrateId = (typeof AUDIO_BITRATE_IDS)[number];

export interface AudioBitrateOption {
  id: AudioBitrateId;
  kbps: number;
  label: string;
  provenance: SpecProvenance;
}

export const AUDIO_BITRATES: readonly AudioBitrateOption[] = AUDIO_BITRATE_IDS.map((id) => ({
  id,
  kbps: Number(id),
  label: `${id} kbps`,
  provenance: computed(
    "declared audio bitrate (this matrix), chosen per platform family",
    `${id} kbps is a declared stereo audio bitrate. Each preset states which published platform figure it took; nothing ` +
      "is chosen silently.",
  ),
}));

export const CHANNEL_LAYOUT_IDS = ["stereo", "mono"] as const;
export type ChannelLayoutId = (typeof CHANNEL_LAYOUT_IDS)[number];

export interface ChannelLayoutOption {
  id: ChannelLayoutId;
  channels: number;
  label: string;
  provenance: SpecProvenance;
}

export const CHANNEL_LAYOUTS: readonly ChannelLayoutOption[] = [
  {
    id: "stereo",
    label: "Stereo (2.0)",
    channels: 2,
    provenance: computed(
      "src/lib/mix/engine.ts (the final mix plans stereo)",
      "The layout the final-mix engine plans and every preset delivers: two channels.",
    ),
  },
  {
    id: "mono",
    label: "Mono (1.0)",
    channels: 1,
    provenance: computed(
      "declared layout (this matrix)",
      "Declared as a legal layout for a single-voice delivery; no preset delivers mono today.",
    ),
  },
];

/* ------------------------------------------------------------------ */
/* Axis 10 — upscaling (the provider-backed axis)                      */
/* ------------------------------------------------------------------ */

export const UPSCALE_IDS = ["none", "encoder-scale", "ai-provider"] as const;
export type UpscaleId = (typeof UPSCALE_IDS)[number];

export interface UpscaleOption {
  id: UpscaleId;
  label: string;
  provenance: SpecProvenance;
}

export const UPSCALE_MODES: readonly UpscaleOption[] = [
  {
    id: "none",
    label: "No upscale — deliver at the source frame",
    provenance: computed(
      "the framing plan's per-clip upscale factor",
      "The preset delivers at a frame the source already fills. The framing plan reports the factor per clip, so 'none' " +
        "is a statement about the source, not a promise the app makes.",
    ),
  },
  {
    id: "encoder-scale",
    label: "Encoder scaling (Lanczos)",
    provenance: gated(
      "the encoder's scaler (encode stage)",
      "The encoder resamples to the delivery frame. Real interpolation, no invented detail — the framing plan prints the " +
        "factor it would apply.",
    ),
  },
  {
    id: "ai-provider",
    label: "AI upscale (keyed provider)",
    provenance: provider(
      "src/lib/ai/providers/replicate.ts — capability video_enhancement",
      "An AI upscale is handed to the keyed provider for the video_enhancement capability. Its key state is read at " +
        "response time from the provider registry, never typed here; with no key the option is gated and the surface says " +
        "which env var names would enable it.",
      "video_enhancement",
    ),
  },
];

/* ------------------------------------------------------------------ */
/* The matrix, as one object                                           */
/* ------------------------------------------------------------------ */

export const SPEC_MATRIX = {
  version: SPEC_MATRIX_VERSION,
  resolutions: RESOLUTIONS,
  containers: CONTAINERS,
  videoCodecs: CODECS,
  frameRates: FRAME_RATES,
  rateModes: RATE_MODES,
  qualityTiers: QUALITY_TIERS,
  colourTargets: COLOUR_TARGETS,
  pixelFormats: PIXEL_FORMATS,
  audioCodecs: AUDIO_CODECS,
  audioSampleRates: AUDIO_SAMPLE_RATES,
  audioBitrates: AUDIO_BITRATES,
  channelLayouts: CHANNEL_LAYOUTS,
  upscaleModes: UPSCALE_MODES,
} as const;

export type SpecAxis = keyof Omit<typeof SPEC_MATRIX, "version">;

export const SPEC_AXIS_LABELS: Record<SpecAxis, string> = {
  resolutions: "Resolutions",
  containers: "Containers",
  videoCodecs: "Video codecs",
  frameRates: "Frame rates",
  rateModes: "Bitrate modes",
  qualityTiers: "Quality tiers",
  colourTargets: "Colour targets",
  pixelFormats: "Pixel formats",
  audioCodecs: "Audio codecs",
  audioSampleRates: "Audio sample rates",
  audioBitrates: "Audio bitrates",
  channelLayouts: "Channel layouts",
  upscaleModes: "Upscaling",
};

/* ------------------------------------------------------------------ */
/* Lookups                                                             */
/* ------------------------------------------------------------------ */

export function resolutionById(id: string): ResolutionOption | null {
  return RESOLUTIONS.find((r) => r.id === id) ?? null;
}
export function containerById(id: string): ContainerOption | null {
  return CONTAINERS.find((c) => c.id === id) ?? null;
}
export function codecById(id: string): CodecOption | null {
  return CODECS.find((c) => c.id === id) ?? null;
}
export function frameRateById(id: string): FrameRateOption | null {
  return FRAME_RATES.find((f) => f.id === id) ?? null;
}
export function rateModeById(id: string): RateModeOption | null {
  return RATE_MODES.find((r) => r.id === id) ?? null;
}
export function qualityById(id: string): QualityOption | null {
  return QUALITY_TIERS.find((q) => q.id === id) ?? null;
}
export function colourById(id: string): ColourOption | null {
  return COLOUR_TARGETS.find((c) => c.id === id) ?? null;
}
export function pixelFormatById(id: string): PixelFormatOption | null {
  return PIXEL_FORMATS.find((p) => p.id === id) ?? null;
}
export function audioCodecById(id: string): AudioCodecOption | null {
  return AUDIO_CODECS.find((a) => a.id === id) ?? null;
}
export function audioSampleRateById(id: string): AudioSampleRateOption | null {
  return AUDIO_SAMPLE_RATES.find((a) => a.id === id) ?? null;
}
export function audioBitrateById(id: string): AudioBitrateOption | null {
  return AUDIO_BITRATES.find((a) => a.id === id) ?? null;
}
export function channelLayoutById(id: string): ChannelLayoutOption | null {
  return CHANNEL_LAYOUTS.find((c) => c.id === id) ?? null;
}
export function upscaleById(id: string): UpscaleOption | null {
  return UPSCALE_MODES.find((u) => u.id === id) ?? null;
}

/* ------------------------------------------------------------------ */
/* Level arithmetic — COMPUTED, not chosen                             */
/* ------------------------------------------------------------------ */

export interface LevelRequirement {
  /** The lowest declared level whose frame and rate limits both cover the frame. */
  minimumLevel: string | null;
  /** width × height — compared with the level's MaxFS / MaxLumaPs. */
  lumaSamples: number;
  /** width × height × fps — compared with the level's MaxMBPS / MaxLumaSr. */
  lumaSamplesPerSecond: number;
  /** The arithmetic, printed so it can be checked by hand. */
  arithmetic: string;
  /** True when no declared level covers it — the combination is then illegal. */
  covered: boolean;
}

/**
 * The lowest level of `codec` that covers this frame rate and pixel count.
 * Both published limits must hold: a frame that fits MaxFS can still exceed
 * MaxMBPS, which is exactly why 2160p60 needs a higher level than 2160p30.
 */
export function requiredLevel(codec: CodecId, widthPx: number, heightPx: number, fps: number): LevelRequirement {
  const option = codecById(codec);
  const lumaSamples = widthPx * heightPx;
  const lumaSamplesPerSecond = lumaSamples * fps;
  if (!option || option.levels.length === 0) {
    return {
      minimumLevel: null,
      lumaSamples,
      lumaSamplesPerSecond,
      arithmetic:
        `${codec} declares no levels (an intra-only intermediate is defined by profile and bit depth), so no level is ` +
        `computed for ${widthPx}×${heightPx} @ ${fps} fps.`,
      covered: true,
    };
  }
  const hit = option.levels.find(
    (l) => lumaSamples <= l.maxLumaSamples && lumaSamplesPerSecond <= l.maxLumaSamplesPerSecond,
  );
  return {
    minimumLevel: hit?.level ?? null,
    lumaSamples,
    lumaSamplesPerSecond,
    arithmetic:
      `${widthPx}×${heightPx} = ${lumaSamples} luma samples per frame; × ${fps} fps = ${lumaSamplesPerSecond} luma ` +
      `samples per second. Lowest ${codec.toUpperCase()} level whose limits cover both: ${hit?.level ?? "none — no declared level covers this frame"}.`,
    covered: Boolean(hit),
  };
}

/** The index of a level within a codec's declared list (null when absent). */
export function levelIndex(codec: CodecId, level: string): number | null {
  const option = codecById(codec);
  if (!option) return null;
  const i = option.levels.findIndex((l) => l.level === level);
  return i < 0 ? null : i;
}

/* ------------------------------------------------------------------ */
/* Combination rules — and a THROW, not a warning                      */
/* ------------------------------------------------------------------ */

export interface Combination {
  resolutionId: string;
  containerId: string;
  codecId: string;
  profileName: string;
  level: string | null;
  frameRateId: string;
  rateModeId: string;
  qualityId: string;
  colourId: string;
  pixelFormatId: string;
  audioCodecId: string;
  audioSampleRateId: string;
  audioBitrateId: string;
  channelLayoutId: string;
  upscaleId: string;
  /** The rate-control numbers the preset declares. */
  targetVideoBitrateKbps: number | null;
  maxVideoBitrateKbps: number | null;
  crf: number | null;
}

export interface RuleViolation {
  ruleId: string;
  axis: string;
  message: string;
}

export interface CombinationCheck {
  legal: boolean;
  violations: RuleViolation[];
  /** The level arithmetic, always printed — legal or not. */
  level: LevelRequirement;
}

export class IllegalCombinationError extends Error {
  readonly violations: RuleViolation[];
  constructor(violations: RuleViolation[]) {
    super(
      `Illegal export combination (${violations.length} violation${violations.length === 1 ? "" : "s"}): ` +
        violations.map((v) => `[${v.ruleId}] ${v.message}`).join(" | "),
    );
    this.name = "IllegalCombinationError";
    this.violations = violations;
  }
}

/**
 * Every rule the axes impose on each other. Each one names the axis it governs
 * and says WHY, so a violation message is a sentence a person can act on rather
 * than a code.
 */
export function checkCombination(c: Combination): CombinationCheck {
  const v: RuleViolation[] = [];
  const resolution = resolutionById(c.resolutionId);
  const container = containerById(c.containerId);
  const codec = codecById(c.codecId);
  const frameRate = frameRateById(c.frameRateId);
  const rateMode = rateModeById(c.rateModeId);
  const quality = qualityById(c.qualityId);
  const colour = colourById(c.colourId);
  const pixelFormat = pixelFormatById(c.pixelFormatId);
  const audioCodec = audioCodecById(c.audioCodecId);
  const audioSampleRate = audioSampleRateById(c.audioSampleRateId);
  const audioBitrate = audioBitrateById(c.audioBitrateId);
  const channelLayout = channelLayoutById(c.channelLayoutId);
  const upscale = upscaleById(c.upscaleId);

  // R1 — every id must be an option the matrix declares.
  const unknown: Array<[string, string]> = [
    ["resolution", c.resolutionId],
    ["container", c.containerId],
    ["videoCodec", c.codecId],
    ["frameRate", c.frameRateId],
    ["rateMode", c.rateModeId],
    ["quality", c.qualityId],
    ["colour", c.colourId],
    ["pixelFormat", c.pixelFormatId],
    ["audioCodec", c.audioCodecId],
    ["audioSampleRate", c.audioSampleRateId],
    ["audioBitrate", c.audioBitrateId],
    ["channelLayout", c.channelLayoutId],
    ["upscale", c.upscaleId],
  ];
  for (const [axis, id] of unknown) {
    if (!id) v.push({ ruleId: "R1", axis, message: `${axis} is empty — every axis must name an option in the matrix.` });
  }
  if (!resolution) v.push({ ruleId: "R1", axis: "resolution", message: `resolution "${c.resolutionId}" is not in the matrix.` });
  if (!container) v.push({ ruleId: "R1", axis: "container", message: `container "${c.containerId}" is not in the matrix.` });
  if (!codec) v.push({ ruleId: "R1", axis: "videoCodec", message: `codec "${c.codecId}" is not in the matrix.` });
  if (!frameRate) v.push({ ruleId: "R1", axis: "frameRate", message: `frame rate "${c.frameRateId}" is not in the matrix.` });
  if (!rateMode) v.push({ ruleId: "R1", axis: "rateMode", message: `rate mode "${c.rateModeId}" is not in the matrix.` });
  if (!quality) v.push({ ruleId: "R1", axis: "quality", message: `quality tier "${c.qualityId}" is not in the matrix.` });
  if (!colour) v.push({ ruleId: "R1", axis: "colour", message: `colour target "${c.colourId}" is not in the matrix.` });
  if (!pixelFormat) v.push({ ruleId: "R1", axis: "pixelFormat", message: `pixel format "${c.pixelFormatId}" is not in the matrix.` });
  if (!audioCodec) v.push({ ruleId: "R1", axis: "audioCodec", message: `audio codec "${c.audioCodecId}" is not in the matrix.` });
  if (!audioSampleRate)
    v.push({ ruleId: "R1", axis: "audioSampleRate", message: `audio sample rate "${c.audioSampleRateId}" is not in the matrix.` });
  if (!audioBitrate) v.push({ ruleId: "R1", axis: "audioBitrate", message: `audio bitrate "${c.audioBitrateId}" is not in the matrix.` });
  if (!channelLayout)
    v.push({ ruleId: "R1", axis: "channelLayout", message: `channel layout "${c.channelLayoutId}" is not in the matrix.` });
  if (!upscale) v.push({ ruleId: "R1", axis: "upscale", message: `upscale mode "${c.upscaleId}" is not in the matrix.` });

  const level = requiredLevel(c.codecId as CodecId, resolution?.widthPx ?? 0, resolution?.heightPx ?? 0, frameRate?.fps ?? 0);

  if (resolution && container && codec && frameRate && rateMode && quality && colour && pixelFormat && audioCodec && audioSampleRate && audioBitrate && channelLayout && upscale) {
    // R2 — codec ↔ container.
    if (!codec.containers.includes(container.id)) {
      v.push({
        ruleId: "R2",
        axis: "container",
        message: `${codec.label} cannot live in ${container.label}. Legal containers for it: ${codec.containers.join(", ")}.`,
      });
    }
    // R3 — profile must be one the codec declares.
    const profile = codec.profiles.find((p) => p.name === c.profileName);
    if (!profile) {
      v.push({
        ruleId: "R3",
        axis: "profile",
        message: `${codec.label} does not declare a "${c.profileName}" profile. Declared: ${codec.profiles.map((p) => p.name).join(", ")}.`,
      });
    }
    // R4 — the pixel format must be the profile's, and the profile's bit depth must be the format's.
    if (profile && profile.pixelFormat !== pixelFormat.id) {
      v.push({
        ruleId: "R4",
        axis: "pixelFormat",
        message: `${codec.label} profile ${profile.name} encodes ${profile.pixelFormat}; the combination names ${pixelFormat.id}.`,
      });
    }
    // R5 — the level must cover the frame rate and pixel count.
    if (codec.levels.length > 0) {
      if (!level.covered) {
        v.push({
          ruleId: "R5",
          axis: "level",
          message: `No declared ${codec.label} level covers ${resolution.widthPx}×${resolution.heightPx} at ${frameRate.fps} fps (${level.arithmetic}).`,
        });
      } else if (c.level === null) {
        v.push({ ruleId: "R5", axis: "level", message: `${codec.label} requires a level; none was named.` });
      } else {
        const declared = levelIndex(codec.id, c.level);
        const needed = level.minimumLevel ? levelIndex(codec.id, level.minimumLevel) : null;
        if (declared === null) {
          v.push({
            ruleId: "R5",
            axis: "level",
            message: `"${c.level}" is not a declared ${codec.label} level (${codec.levels.map((l) => l.level).join(", ")}).`,
          });
        } else if (needed !== null && declared < needed) {
          v.push({
            ruleId: "R5",
            axis: "level",
            message: `Level ${c.level} does not cover ${resolution.widthPx}×${resolution.heightPx} at ${frameRate.fps} fps — the computed minimum is ${level.minimumLevel} (${level.arithmetic}).`,
          });
        }
      }
    } else if (c.level !== null) {
      v.push({
        ruleId: "R5",
        axis: "level",
        message: `${codec.label} declares no levels; a level cannot be named for it.`,
      });
    }
    // R6 — HDR needs a bit depth that can hold it.
    if (colour.requiredBitDepth > pixelFormat.bitDepth) {
      v.push({
        ruleId: "R6",
        axis: "colour",
        message: `${colour.label} needs a ${colour.requiredBitDepth}-bit bitstream; ${pixelFormat.label} is ${pixelFormat.bitDepth}-bit. An 8-bit profile cannot carry this target.`,
      });
    }
    // R7 — rate-control coherence.
    if (rateMode.singleBitrate) {
      if (c.targetVideoBitrateKbps === null) {
        v.push({ ruleId: "R7", axis: "rateControl", message: `${rateMode.label} must name one bitrate; the target is null.` });
      }
      if (c.maxVideoBitrateKbps !== c.targetVideoBitrateKbps) {
        v.push({
          ruleId: "R7",
          axis: "rateControl",
          message: `CBR means one bitrate: target ${c.targetVideoBitrateKbps} and cap ${c.maxVideoBitrateKbps} must be the same number.`,
        });
      }
      if (c.crf !== null) {
        v.push({ ruleId: "R7", axis: "rateControl", message: `CBR has no quality parameter; CRF ${c.crf} cannot be set with it.` });
      }
    }
    if (rateMode.id === "vbr") {
      if (c.targetVideoBitrateKbps === null) {
        v.push({ ruleId: "R7", axis: "rateControl", message: "VBR needs an average target bitrate; it is null." });
      }
      if (c.maxVideoBitrateKbps !== null && c.targetVideoBitrateKbps !== null && c.maxVideoBitrateKbps < c.targetVideoBitrateKbps) {
        v.push({
          ruleId: "R7",
          axis: "rateControl",
          message: `VBR's cap (${c.maxVideoBitrateKbps}) is below its target (${c.targetVideoBitrateKbps}) — the target could never be reached.`,
        });
      }
      if (c.crf !== null) {
        v.push({ ruleId: "R7", axis: "rateControl", message: `VBR is a bitrate mode; a CRF value (${c.crf}) belongs to CRF mode.` });
      }
    }
    if (rateMode.id === "crf") {
      const expected = quality.crfByCodec[codec.id];
      if (expected === null) {
        v.push({ ruleId: "R7", axis: "rateControl", message: `${codec.label} has no CRF (${quality.label} declares none for it).` });
      } else if (c.crf !== expected) {
        v.push({
          ruleId: "R7",
          axis: "rateControl",
          message: `Quality tier ${quality.label} means CRF ${expected} for ${codec.label}; the combination names CRF ${c.crf}.`,
        });
      }
      if (c.targetVideoBitrateKbps === null) {
        v.push({
          ruleId: "R7",
          axis: "rateControl",
          message: "CRF still prints a planning-equivalent bitrate for the size estimate; it is null.",
        });
      }
    }
    // R9 — audio codec ↔ container.
    if (!audioCodec.containers.includes(container.id)) {
      v.push({
        ruleId: "R9",
        axis: "audioCodec",
        message: `${audioCodec.label} cannot live in ${container.label}. Legal containers for it: ${audioCodec.containers.join(", ")}.`,
      });
    }
    // R11 — the presets' audio is stereo or mono; a bitrate below 128 kbps is refused as a delivery figure.
    if (audioBitrate.kbps < 128) {
      v.push({ ruleId: "R11", axis: "audioBitrate", message: `Audio bitrate ${audioBitrate.kbps} kbps is below the lowest declared delivery figure (128 kbps).` });
    }
    if (channelLayout.channels > 2) {
      v.push({ ruleId: "R11", axis: "channelLayout", message: `${channelLayout.label} is beyond the stereo plan the mix engine produces.` });
    }
    // R12 — MP4 + AAC-LC is delivered at 48 kHz; 44.1 kHz is for the other routes.
    if (container.id === "mp4" && audioCodec.id === "aac-lc" && audioSampleRate.hz !== 48_000) {
      v.push({
        ruleId: "R12",
        axis: "audioSampleRate",
        message: `An MP4 AAC-LC delivery is 48 kHz here; ${audioSampleRate.hz} Hz is declared for the other routes.`,
      });
    }
    // R14 — the frame's orientation must match the resolution's own.
    if (resolution.portrait && resolution.aspect !== "9:16" && resolution.aspect !== "4:5") {
      v.push({ ruleId: "R14", axis: "resolution", message: `${resolution.label} declares portrait geometry with aspect ${resolution.aspect}.` });
    }
  }

  return { legal: v.length === 0, violations: v, level };
}

/** Reject an illegal combination by THROWING. Never emits one. */
export function assertLegal(c: Combination): CombinationCheck {
  const check = checkCombination(c);
  if (!check.legal) throw new IllegalCombinationError(check.violations);
  return check;
}

/* ------------------------------------------------------------------ */
/* Views                                                               */
/* ------------------------------------------------------------------ */

/** Every option in the matrix, with its provenance — the API's own shape. */
export function matrixView(): Record<string, unknown> {
  const axes = Object.keys(SPEC_AXIS_LABELS) as SpecAxis[];
  const counts: Record<string, number> = {};
  for (const axis of axes) {
    counts[axis] = (SPEC_MATRIX[axis] as readonly unknown[]).length;
  }
  const all = axes.flatMap((axis) =>
    (SPEC_MATRIX[axis] as readonly unknown[]).map((o) => o as { id: string; provenance: SpecProvenance }),
  );
  const truthTally = { computed: 0, gated: 0, provider: 0 };
  for (const option of all) truthTally[option.provenance.truth] += 1;
  return {
    version: SPEC_MATRIX_VERSION,
    statement: SPEC_DELIVERY_STATEMENT,
    axes: axes.map((axis) => ({
      axis,
      label: SPEC_AXIS_LABELS[axis],
      count: counts[axis],
      options: (SPEC_MATRIX[axis] as readonly unknown[]).map((o) => {
        const option = o as Record<string, unknown> & { provenance: SpecProvenance };
        return { ...option, provenance: { ...option.provenance } };
      }),
    })),
    counts,
    optionCount: all.length,
    truthTally,
    producedOnThisBuild: false,
    loudnessTargetLufs: DEFAULT_LOUDNESS_TARGET_LUFS,
    truePeakDbfs: Math.round(20 * Math.log10(PEAK_CEILING) * 100) / 100,
  };
}

/** The true-peak ceiling, DERIVED from the mix engine's linear peak ceiling. */
export const SPEC_TRUE_PEAK_DBFS = Math.round(20 * Math.log10(PEAK_CEILING) * 100) / 100;

/** The loudness target every preset delivers at — the mix engine's own constant. */
export const SPEC_LOUDNESS_TARGET_LUFS = DEFAULT_LOUDNESS_TARGET_LUFS;
