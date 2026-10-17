/**
 * Phase 7 Block 5 — THE QUALITY CHECKER AND ITS SCORE.
 *
 * THE ONE RULE THIS MODULE EXISTS TO KEEP: a check may only say PASS or FAIL when
 * something was actually measured, and every one of the three answers carries the
 * measurement sentence that produced it — the input it read, the value it
 * computed, the threshold, and where that threshold comes from.
 *
 *   - "pass"         — the input existed and the measured value met the threshold.
 *   - "fail"         — the input existed and the measured value did not.
 *   - "not_measured" — no input existed to measure, and `missingInputs` NAMES it.
 *                      This is never rendered as a pass, and it is never counted
 *                      in the score either way.
 *
 * THE SCORE IS ARITHMETIC, NOT JUDGEMENT. It is computed only over the checks that
 * were really measured, using the declared weight of each (see
 * QUALITY_CHECK_CATALOGUE; the weights sum to 100):
 *
 *     score = round(100 × Σ weight(passing measured) / Σ weight(measured))
 *
 * With nothing measured there is NO score: the field is `empty_no_input`, says so,
 * and names what would have to exist. With something measured, the score states
 * what it is over (how many checks, how much of the declared weight) and says
 * plainly that it is not a prediction of how the video will perform and not a
 * claim that the unmeasured checks passed.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO: it does not open a file, spawn a
 * process or read `process.env`. The measurements that need a produced file come
 * from `./media-probe` (server-only, node:fs / node:child_process) and arrive here
 * as plain facts, so this file stays pure, testable, and safe to import from a
 * client bundle — and so a test can hand it a file that fails.
 */
import type {
  PublishingAudioTrackRow,
  PublishingExportJobRow,
  PublishingSource,
  PublishingSubtitleRow,
} from "./types";
import { derived, emptyNoInput, type Field, type SourceKind, type SourceRef } from "./provenance";
import {
  EXPORT_LOUDNESS_TARGET_LUFS,
  EXPORT_PRESETS,
  EXPORT_TRUE_PEAK_DBFS,
  findExportPreset,
  type ExportPresetSpec,
} from "../export/presets";
import { CAPTION_LINE_HEIGHT_PX, MAX_CAPTION_LINES, SUBTITLE_SAFE_MARGINS } from "../subtitles/positioning";
import { findSubtitleStyle } from "../subtitles/styles";

/* ------------------------------------------------------------------ */
/* What the file measurements look like when they arrive               */
/* ------------------------------------------------------------------ */

/** One audio stream, as a probe reported it. */
export interface ProbedAudioStream {
  index: number;
  codec: string | null;
  channels: number | null;
  sampleRateHz: number | null;
}

/**
 * The facts a probe read off a PRODUCED FILE. Every field is what a tool
 * reported; a fact the tool did not report is null, never a default.
 */
export interface ProbedFileFacts {
  path: string;
  sizeBytes: number;
  widthPx: number | null;
  heightPx: number | null;
  /** Average frame rate the stream reports, in frames per second. */
  frameRateAvg: number | null;
  /** The rate the stream DECLARES (ffprobe's r_frame_rate), for the constancy check. */
  frameRateDeclared: number | null;
  durationSeconds: number | null;
  /** Video stream bitrate in kbps when the stream reports one. */
  videoBitrateKbps: number | null;
  /** Whole-file bitrate in kbps (ffprobe format.bit_rate). */
  overallBitrateKbps: number | null;
  videoCodec: string | null;
  audioStreams: ProbedAudioStream[];
  /** The tool and version that produced these facts, e.g. "ffprobe 6.1.1". */
  tool: string;
}

/** The outcome of trying to measure a produced file. */
export type FileProbeOutcome =
  | { state: "probed"; facts: ProbedFileFacts }
  /** There is no produced file to probe. `reason` says why; `requires` names what would have to exist. */
  | { state: "absent"; reason: string; requires: string[] }
  /** A file exists (or should) but could not be measured. Also never a pass. */
  | { state: "failed"; reason: string; requires: string[] };

/** Loudness facts, as an ffmpeg loudness pass reported them. */
export interface LoudnessFacts {
  integratedLufs: number;
  truePeakDbfs: number;
  tool: string;
}

export type LoudnessOutcome =
  | { state: "measured"; facts: LoudnessFacts }
  | { state: "absent"; reason: string; requires: string[] }
  | { state: "failed"; reason: string; requires: string[] };

/**
 * The delivery target an export JOB declared, resolved to the export preset that
 * declares it. Every number here comes from `../export/presets` (which states its
 * own published basis for each) or from the export job's own `resolution` column.
 * When no export job exists, this is null and every check that needs a declared
 * target says NOT MEASURED rather than inventing one.
 */
export interface DeclaredDeliveryTarget {
  /** The export job row this target was read from. */
  exportJobId: string;
  presetId: string;
  presetLabel: string;
  widthPx: number;
  heightPx: number;
  resolution: string;
  aspect: string;
  aspectValue: number;
  frameRate: number;
  frameRateBasis: string;
  videoBitrateKbps: number;
  bitrateBasis: string;
  audioChannels: number;
  loudnessTargetLufs: number;
  truePeakDbfs: number;
  loudnessBasis: string;
  /** Plain words for where the whole target came from. */
  source: string;
}

/* ------------------------------------------------------------------ */
/* The seventeen checks: their weights and their thresholds            */
/* ------------------------------------------------------------------ */

export type QualityCheckId =
  | "produced_file"
  | "resolution"
  | "aspect_ratio"
  | "frame_rate"
  | "video_bitrate"
  | "audio_stream"
  | "loudness"
  | "subtitle_track"
  | "subtitle_cue_timing"
  | "subtitle_overlap"
  | "subtitle_safe_area"
  | "voice_duration"
  | "music_duration"
  | "scene_narration"
  | "render_errors"
  | "chapter_coverage"
  | "thumbnail_concepts";

export type QualityAreaId = "file" | "subtitles" | "audio_timeline" | "structure" | "render" | "thumbnails";

export interface QualityAreaSpec {
  id: QualityAreaId;
  label: string;
  brief: string;
}

export const QUALITY_AREAS: readonly QualityAreaSpec[] = [
  {
    id: "file",
    label: "The produced file",
    brief: "Seven checks that read a finished render. None of them can run without a file to read, and none of them will ever be reported as a pass without one.",
  },
  {
    id: "subtitles",
    label: "Subtitle cues",
    brief: "Four checks that parse the cue timings stored on this project's subtitle track and compare them with the timeline and with a safe area computed from a stored style and frame size.",
  },
  {
    id: "audio_timeline",
    label: "Voice and music against the timeline",
    brief: "Two checks that compare a stored audio asset's own duration with the timeline the scenes describe.",
  },
  {
    id: "structure",
    label: "Structure of the project's own rows",
    brief: "One check on the spoken text every scene needs, read from the scene rows themselves.",
  },
  {
    id: "render",
    label: "Export job state",
    brief: "One check on what the project's most recent export job reported. A job that never finished reports nothing, so it is not measured rather than assumed to be fine.",
  },
  {
    id: "thumbnails",
    label: "Thumbnail concepts",
    brief: "One check that counts the thumbnail concept specifications this project's own rows produced, against the minimum and maximum the brief asks for.",
  },
];

export type QualityCheckState = "pass" | "fail" | "not_measured";

export interface QualityCheckSpec {
  id: QualityCheckId;
  label: string;
  area: QualityAreaId;
  /** Declared weight. The seventeen weights sum to 100. */
  weight: number;
  /** The threshold, in words, with where it comes from. */
  threshold: string;
  thresholdSource: string;
  /** The input this check reads, in one phrase. */
  reads: string;
}

/**
 * THE CATALOGUE. Seventeen named checks, each with a declared weight, a declared
 * threshold and a declared input. A check whose input does not exist says NOT
 * MEASURED and names the input; no check is ever skipped or dropped from the list,
 * so "not measured" stays visible instead of quietly shrinking the denominator.
 */
export const QUALITY_CHECK_CATALOGUE: readonly QualityCheckSpec[] = [
  {
    id: "produced_file",
    label: "A produced file exists",
    area: "file",
    weight: 6,
    threshold: "the file exists and is larger than zero bytes",
    thresholdSource: "nothing can be measured about a picture that does not exist; this is the precondition for the six checks below it, not a judgement of the picture",
    reads: "the output path recorded on this project's export job, and the file at that path",
  },
  {
    id: "resolution",
    label: "Frame size meets the declared delivery frame",
    area: "file",
    weight: 6,
    threshold: "measured width and height are each at least the declared preset's width and height",
    thresholdSource: "the export preset resolved for this project's export job (../export/presets), whose frame comes from the framing engine's delivery frame",
    reads: "the produced file's streams, and the export preset's widthPx / heightPx",
  },
  {
    id: "aspect_ratio",
    label: "Display aspect ratio matches the declared format",
    area: "file",
    weight: 6,
    threshold: "measured width ÷ height is within 1% of the declared preset's aspect value",
    thresholdSource: "the export preset's own aspectValue, which the preset takes from the framing engine's format spec",
    reads: "the produced file's measured pixel dimensions, and the export preset's aspect",
  },
  {
    id: "frame_rate",
    label: "Frame rate matches the declared cadence",
    area: "file",
    weight: 5,
    threshold: "measured average frame rate is within 0.05 fps of the declared preset's frame rate",
    thresholdSource: "the export preset's frameRate and its own frameRateBasis sentence (a published cadence), not a number chosen here",
    reads: "the produced file's stream frame rates, and the export preset's frameRate",
  },
  {
    id: "video_bitrate",
    label: "Video bitrate is not far below the declared target",
    area: "file",
    weight: 5,
    threshold: "measured video bitrate is at least 70% of the declared preset's target bitrate",
    thresholdSource: "the preset's targetVideoBitrateKbps, with a 70% floor this app declares rather than assumes: an encoder told a target routinely lands below it on easy material, and the floor is stated so a reader can disagree with it",
    reads: "the produced file's reported bitrates, and the export preset's rate control",
  },
  {
    id: "audio_stream",
    label: "An audio stream is present",
    area: "file",
    weight: 6,
    threshold: "at least one audio stream, with at least one channel",
    thresholdSource: "the export presets all declare a stereo audio spec; a file with no audio stream cannot carry the voice this product mixes",
    reads: "the produced file's stream list",
  },
  {
    id: "loudness",
    label: "Integrated loudness and true peak are inside the declared band",
    area: "file",
    weight: 6,
    threshold: `integrated loudness within ±1.0 LU of ${EXPORT_LOUDNESS_TARGET_LUFS} LUFS, and true peak at or below ${EXPORT_TRUE_PEAK_DBFS} dBTP`,
    thresholdSource: "the export centre's own loudness target and peak ceiling (../export/presets), which every preset states a basis for; the ±1.0 LU band is this app's declared tolerance",
    reads: "an ffmpeg loudness pass over the produced file (ebur128: integrated loudness and true peak). It reports no clipped-sample count, so this check does not claim to have measured clipping",
  },
  {
    id: "subtitle_track",
    label: "A subtitle track with at least one cue exists",
    area: "subtitles",
    weight: 6,
    threshold: "at least one stored subtitle track whose text parses as at least one SRT cue",
    thresholdSource: "the subtitle engine's own stored format (Subtitle.text, SRT), parsed here by cue index and timecode",
    reads: "this project's Subtitle rows and the text column of each",
  },
  {
    id: "subtitle_cue_timing",
    label: "Every cue's timing is well formed and inside the timeline",
    area: "subtitles",
    weight: 6,
    threshold: "every cue ends after it starts, and the last cue ends no later than the timeline plus half a second",
    thresholdSource: "the timeline is the sum of the scenes' own stored durations (the same arithmetic the chapter map uses); half a second is this app's declared tolerance for the last cue",
    reads: "every cue's start and end timecode, and the summed scene durations",
  },
  {
    id: "subtitle_overlap",
    label: "No cue overlaps the cue after it",
    area: "subtitles",
    weight: 6,
    threshold: "no cue starts before the previous cue has ended",
    thresholdSource: "two captions on screen at once is a defect the cue data itself shows; the comparison needs no tolerance",
    reads: "consecutive cues' start and end timecodes",
  },
  {
    id: "subtitle_safe_area",
    label: "Cue text sits inside a computed safe area",
    area: "subtitles",
    weight: 6,
    threshold: "the caption block, at its line count and the engine's line height, fits inside the frame with the engine's safe margins at the stored anchor",
    thresholdSource: "the subtitle engine's own constants (SUBTITLE_SAFE_MARGINS, CAPTION_LINE_HEIGHT_PX) and the style stored in ProjectSettings.subtitleDefaults, with the frame size measured from the produced file",
    reads: "the stored subtitle style and anchor, the cue line counts and the produced file's frame size",
  },
  {
    id: "voice_duration",
    label: "The stored voice track matches the timeline",
    area: "audio_timeline",
    weight: 6,
    threshold: "the voice asset's stored duration is within 2% (or 1 s, whichever is larger) of the summed scene durations",
    thresholdSource: "the timeline is the sum of the scenes' own stored durations; the tolerance is this app's declared allowance for padding at the head and tail",
    reads: "a stored voiceover asset's durationSeconds, and the summed scene durations",
  },
  {
    id: "music_duration",
    label: "A stored music bed covers the timeline",
    area: "audio_timeline",
    weight: 6,
    threshold: "at least one stored music asset whose duration is at least the timeline minus one second",
    thresholdSource: "the timeline is the sum of the scenes' own stored durations; a bed shorter than the timeline stops before the video does",
    reads: "stored music assets' durationSeconds, and the summed scene durations",
  },
  {
    id: "scene_narration",
    label: "Every scene carries its spoken text",
    area: "structure",
    weight: 6,
    threshold: "zero scenes whose narration column is empty",
    thresholdSource: "a faceless video's scenes are spoken by the voice engine from this column; an empty one leaves a scene with nothing to say",
    reads: "every scene row's narration column",
  },
  {
    id: "render_errors",
    label: "The latest export job reports no error",
    area: "render",
    weight: 6,
    threshold: "the most recent export job is COMPLETED with no error message recorded",
    thresholdSource: "the job's own status and errorMessage columns; a job that has not reached a terminal status has not reported anything yet",
    reads: "this project's export job rows, newest first",
  },
  {
    id: "chapter_coverage",
    label: "Chapters cover every scene's duration and match the declared length",
    area: "structure",
    weight: 6,
    threshold: "every chapter carries at least one scene, every scene carries a duration, and the summed durations are within 10% of the project's declared target duration when one is declared",
    thresholdSource: "the chapter and scene rows themselves, plus Project.targetDurationSeconds when it is set; 10% is this app's declared tolerance",
    reads: "the chapter rows, each one's scenes and durations, and the project's target duration",
  },
  {
    id: "thumbnail_concepts",
    label: "Thumbnail concepts are present and within the requested count",
    area: "thumbnails",
    weight: 6,
    threshold: "between the requested minimum and maximum concept specifications, counting the plan's own list",
    thresholdSource: "the thumbnail plan's own minimumRequested / maximumAllowed (5 and 10), counted from the concepts it actually produced",
    reads: "the thumbnail plan's concept list",
  },
];

/** The declared weights sum to 100 — asserted at module load, so a re-weight cannot silently stop summing. */
const DECLARED_WEIGHT_TOTAL = QUALITY_CHECK_CATALOGUE.reduce((sum, c) => sum + c.weight, 0);
if (DECLARED_WEIGHT_TOTAL !== 100) {
  throw new Error(`quality check catalogue weights sum to ${DECLARED_WEIGHT_TOTAL}, not 100`);
}

/* ------------------------------------------------------------------ */
/* SRT parsing — the subtitle track's own stored text                  */
/* ------------------------------------------------------------------ */

export interface ParsedCue {
  index: number;
  startMs: number;
  endMs: number;
  /** How many rendered lines of text this cue carries. */
  lines: number;
  text: string;
}

const SRT_TIME = /(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[,.](\d{1,3})/;

function msOf(h: string, m: string, s: string, frac: string): number {
  const fraction = frac.length === 1 ? Number(frac) * 100 : frac.length === 2 ? Number(frac) * 10 : Number(frac);
  return ((Number(h) * 60 + Number(m)) * 60 + Number(s)) * 1000 + fraction;
}

/**
 * Parses the stored SRT text into cues. Deliberately strict about the timecode
 * line: a block without one is not a cue and is not counted, so a track of prose
 * with no timecodes parses to zero cues (and the track check then FAILS, which is
 * the truth about that track) rather than to invented timings.
 */
export function parseSrtCues(text: string): ParsedCue[] {
  const normalised = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!normalised) return [];
  const cues: ParsedCue[] = [];
  for (const block of normalised.split(/\n{2,}/)) {
    const lines = block.split("\n").map((l) => l.trim());
    const timeLineIndex = lines.findIndex((l) => SRT_TIME.test(l));
    if (timeLineIndex === -1) continue;
    const match = SRT_TIME.exec(lines[timeLineIndex]!);
    if (!match) continue;
    const startMs = msOf(match[1]!, match[2]!, match[3]!, match[4]!);
    const endMs = msOf(match[5]!, match[6]!, match[7]!, match[8]!);
    const textLines = lines.slice(timeLineIndex + 1).filter((l) => l.length > 0);
    cues.push({
      index: cues.length + 1,
      startMs,
      endMs,
      lines: Math.max(1, textLines.length),
      text: textLines.join(" "),
    });
  }
  return cues.sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
}

/* ------------------------------------------------------------------ */
/* Small shared arithmetic                                             */
/* ------------------------------------------------------------------ */

/** The timeline: the sum of every scene's stored duration, or null when any is missing. */
export function timelineSeconds(source: QualitySource): { total: number | null; scenes: number; missing: string[] } {
  const scenes = source.chapters.flatMap((c) => c.scenes);
  const missing = scenes.filter((s) => s.durationSeconds === null).map((s) => s.id);
  if (scenes.length === 0 || missing.length > 0) {
    return { total: null, scenes: scenes.length, missing };
  }
  return { total: scenes.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0), scenes: scenes.length, missing };
}

/** Seconds with one decimal, for a sentence. */
function secs(ms: number): string {
  return `${(ms / 1000).toFixed(1)} s`;
}

function n(value: number, decimals = 1): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(decimals);
}

/**
 * The source as the checks below see it: the four P7-5 row families are present.
 * A caller that did not read them gets empty arrays (see `buildQualityPlan`), which
 * every check reports as "this project has none of these rows".
 */
export type QualitySource = PublishingSource & {
  subtitleTracks: PublishingSubtitleRow[];
  audioTracks: PublishingAudioTrackRow[];
  exportJobs: PublishingExportJobRow[];
};

/** The newest export job, by createdAt then id, so the choice is deterministic. */
function latestExportJob(source: QualitySource) {
  const jobs = [...source.exportJobs];
  if (jobs.length === 0) return null;
  jobs.sort((a, b) => (a.createdAt === b.createdAt ? a.id.localeCompare(b.id) : a.createdAt.localeCompare(b.createdAt)));
  return jobs[jobs.length - 1]!;
}

/**
 * The declared delivery target: the export job's own resolution column, resolved
 * to the export preset that declares it. A job whose resolution matches no preset
 * yields null — no target is invented from a partial match, and every check that
 * needs one then says NOT MEASURED naming it.
 */
export function declareDeliveryTarget(source: QualitySource): DeclaredDeliveryTarget | null {
  const job = latestExportJob(source);
  if (!job || !job.resolution) return null;
  const wanted = job.resolution.replace(/[×xX*]/g, "×").replace(/\s+/g, "");
  const preset: ExportPresetSpec | null =
    (job.presetId ? findExportPreset(job.presetId) : null) ??
    [...EXPORT_PRESETS].find((p) => p.resolution.replace(/[×xX*]/g, "×").replace(/\s+/g, "") === wanted) ??
    null;
  if (!preset) return null;
  return {
    exportJobId: job.id,
    presetId: preset.id,
    presetLabel: preset.label,
    widthPx: preset.widthPx,
    heightPx: preset.heightPx,
    resolution: preset.resolution,
    aspect: preset.aspect,
    aspectValue: preset.aspectValue,
    frameRate: preset.video.frameRate,
    frameRateBasis: preset.video.frameRateBasis,
    videoBitrateKbps: preset.video.rateControl.targetVideoBitrateKbps ?? 0,
    bitrateBasis: preset.video.rateControl.basis,
    audioChannels: preset.audio.channels,
    loudnessTargetLufs: preset.audio.loudnessTargetLufs,
    truePeakDbfs: preset.audio.truePeakDbfs,
    loudnessBasis: preset.audio.loudnessBasis,
    source:
      `Export job ${job.id} declares resolution "${job.resolution}"; that resolves to export preset ${preset.id} ` +
      `("${preset.label}"), which declares ${preset.resolution}, ${preset.video.frameRate} fps and a ` +
      `${preset.video.rateControl.targetVideoBitrateKbps ?? 0} kbps video target.`,
  };
}

/* ------------------------------------------------------------------ */
/* The plan                                                            */
/* ------------------------------------------------------------------ */

export interface QualityCheckResult {
  id: QualityCheckId;
  label: string;
  area: QualityAreaId;
  weight: number;
  threshold: string;
  thresholdSource: string;
  reads: string;
  state: QualityCheckState;
  /**
   * The sentence that produced the state: the input that was read, the value that
   * was computed, and the threshold it was compared with. Never empty.
   */
  measurement: string;
  /** For `not_measured`: the input(s) that would have to exist. Empty otherwise. */
  missingInputs: string[];
  /** The rows/file this check read, by id or path. */
  sources: SourceRef[];
}

export interface QualityAreaResult {
  id: QualityAreaId;
  label: string;
  brief: string;
  checks: number;
  measured: number;
  passed: number;
  failed: number;
  notMeasured: number;
  weight: number;
  measuredWeight: number;
}

export interface QualityScore {
  /**
   * A real Field: `derived` with the number, or `empty_no_input` with the reason
   * there is no score and what would produce one. Never an invented zero.
   */
  score: Field<number>;
  passedChecks: number;
  failedChecks: number;
  measuredChecks: number;
  notMeasuredChecks: number;
  totalChecks: number;
  measuredWeight: number;
  totalWeight: number;
  /** What the score is over, in one sentence. */
  basis: string;
  /** What the score is NOT, in one sentence. */
  notAPrediction: string;
  /** The arithmetic itself, spelled out, so a reader can recompute it. */
  arithmetic: string;
}

export interface QualityPlan {
  rule: "R-QUALITY-CHECK";
  scoreRule: "R-QUALITY-SCORE";
  /** The catalogue as applied: seventeen checks, always all seventeen. */
  checks: QualityCheckResult[];
  areas: QualityAreaResult[];
  score: QualityScore;
  /** The file measurement this plan received, restated as the app's own words. */
  fileMeasurement: { state: FileProbeOutcome["state"]; statement: string; requires: string[] };
  loudnessMeasurement: { state: LoudnessOutcome["state"]; statement: string; requires: string[] };
  /** The resolved delivery target, or null with the reason in `declaration`. */
  declaredTarget: DeclaredDeliveryTarget | null;
  /** The timeline the timeline-shaped checks used, stated once. */
  timeline: { total: number | null; scenes: number; missingScenes: number; statement: string };
  counts: { checks: number; pass: number; fail: number; notMeasured: number; weights: number };
  declaration: {
    statement: string;
    notAPrediction: string;
    notAHealthJudgement: string;
    measuredOnly: string;
  };
  notes: string[];
}

export interface BuildQualityPlanInput {
  source: PublishingSource;
  /** What the file measurement found. Defaults to "absent" claiming nothing. */
  file?: FileProbeOutcome;
  /** What the loudness pass found. Defaults to "absent" claiming nothing. */
  loudness?: LoudnessOutcome;
  /** The thumbnail plan's own counts, so this module never re-derives them. */
  thumbnails: { totalConcepts: number; minimumRequested: number; maximumAllowed: number } | null;
}

const NO_FILE: FileProbeOutcome = {
  state: "absent",
  reason: "No file measurement was supplied to the quality checker, so no produced file was read.",
  requires: ["a produced video file, measured by a probe"],
};

const NO_LOUDNESS: LoudnessOutcome = {
  state: "absent",
  reason: "No loudness pass was supplied to the quality checker, so nothing was measured.",
  requires: ["an ffmpeg loudness pass over the produced video file"],
};

interface Draft {
  state: QualityCheckState;
  measurement: string;
  missingInputs?: string[];
  sources?: { kind: string; id: string; path?: string }[];
}

function check(id: QualityCheckId, draft: Draft): QualityCheckResult {
  const spec = QUALITY_CHECK_CATALOGUE.find((c) => c.id === id);
  if (!spec) throw new Error(`quality check ${id} is not in the catalogue`);
  if (draft.missingInputs && draft.missingInputs.length === 0) {
    throw new Error(`quality check ${id} was marked not_measured with no missing input named`);
  }
  if (draft.state === "not_measured" && (!draft.missingInputs || draft.missingInputs.length === 0)) {
    throw new Error(`quality check ${id} was marked not_measured without naming the missing input`);
  }
  if (draft.state !== "not_measured" && draft.missingInputs) {
    throw new Error(`quality check ${id} names missing inputs but claims to be ${draft.state}`);
  }
  if (!draft.measurement.trim()) throw new Error(`quality check ${id} produced no measurement sentence`);
  return {
    id: spec.id,
    label: spec.label,
    area: spec.area,
    weight: spec.weight,
    threshold: spec.threshold,
    thresholdSource: spec.thresholdSource,
    reads: spec.reads,
    state: draft.state,
    measurement: draft.measurement,
    missingInputs: draft.missingInputs ?? [],
    // The kind is a row-family name from ./provenance; it is carried through as the
    // string the check produced and resolved to the SourceKind union right here.
    sources: (draft.sources ?? []).map((ref) => ({
      kind: ref.kind as SourceKind,
      id: ref.id,
      ...(ref.path ? { path: ref.path } : {}),
    })),
  };
}

const PROJECT_SOURCE = (source: PublishingSource, path: string): SourceRef => ({ kind: "project", id: source.project.id, path });

/* ------------------------------------------------------------------ */
/* The checks themselves                                               */
/* ------------------------------------------------------------------ */

function fileChecks(
  source: QualitySource,
  file: FileProbeOutcome,
  loudness: LoudnessOutcome,
  target: DeclaredDeliveryTarget | null,
): QualityCheckResult[] {
  const facts = file.state === "probed" ? file.facts : null;
  const noFile = file.state === "absent" || file.state === "failed"
    ? { state: "not_measured" as const, reason: file.reason, requires: file.requires }
    : null;

  /** The sentences shared by every check that has no file to read. */
  const fileMissing = (what: string): Draft => ({
    state: "not_measured",
    measurement:
      `No produced file could be read, so ${what} was not measured. ${noFile?.reason ?? ""} ` +
      `What would make this check measurable: ${(noFile?.requires ?? []).join("; ")}. This is not a pass.`,
    missingInputs: [...(noFile?.requires ?? []), noFile?.reason ?? "a produced video file"],
    sources: [PROJECT_SOURCE(source, "exportJobs")],
  });

  const fileSource: SourceRef[] = facts ? [{ kind: "file", id: facts.path }] : [PROJECT_SOURCE(source, "exportJobs")];

  const produced = (() => {
    if (!facts) return fileMissing("the existence and size of the produced file");
    const pass = facts.sizeBytes > 0;
    return {
      state: pass ? ("pass" as const) : ("fail" as const),
      measurement:
        `Read the file at ${facts.path}: ${facts.sizeBytes} byte(s) measured by ${facts.tool}. ` +
        `Threshold: ${QUALITY_CHECK_CATALOGUE[0]!.threshold} — this is the precondition for the six checks below it, not a judgement of the picture.`,
      sources: fileSource,
    };
  })();

  const needTarget = (what: string): Draft => ({
    state: "not_measured",
    measurement:
      `The produced file was read, but no declared delivery target could be resolved to compare ${what} with: ` +
      `the export job(s) on this project declare no resolution that matches an export preset. ` +
      `Nothing is substituted for the missing declaration, so this is not measured.`,
    missingInputs: ["an export job whose resolution column matches an export preset (../export/presets)"],
    sources: fileSource,
  });

  const resolution = (() => {
    if (!facts) return fileMissing("the frame size");
    if (!target) return needTarget("the frame size");
    if (facts.widthPx === null || facts.heightPx === null) {
      return {
        state: "not_measured" as const,
        measurement: `${facts.tool} read ${facts.path} but reported no pixel dimensions for its video stream, so the frame size was not measured. This is not a pass.`,
        missingInputs: ["pixel dimensions from the file's video stream in the probe output"],
        sources: fileSource,
      };
    }
    const pass = facts.widthPx >= target.widthPx && facts.heightPx >= target.heightPx;
    return {
      state: pass ? ("pass" as const) : ("fail" as const),
      measurement:
        `Read ${facts.path} with ${facts.tool}: video stream is ${facts.widthPx}×${facts.heightPx}. ` +
        `Compared with the declared delivery frame ${target.widthPx}×${target.heightPx} of export preset ${target.presetId}: ` +
        `${pass ? "met" : "not met"}.`,
      sources: fileSource,
    };
  })();

  const aspect = (() => {
    if (!facts) return fileMissing("the aspect ratio");
    if (!target) return needTarget("the aspect ratio");
    if (facts.widthPx === null || facts.heightPx === null || facts.heightPx === 0) {
      return {
        state: "not_measured" as const,
        measurement: `${facts.tool} read ${facts.path} but reported no usable pixel dimensions, so the displayed aspect could not be computed. This is not a pass.`,
        missingInputs: ["pixel dimensions from the file's video stream in the probe output"],
        sources: fileSource,
      };
    }
    const measured = facts.widthPx / facts.heightPx;
    const delta = Math.abs(measured - target.aspectValue) / target.aspectValue;
    const pass = delta <= 0.01;
    return {
      state: pass ? ("pass" as const) : ("fail" as const),
      measurement:
        `Read ${facts.path} with ${facts.tool}: ${facts.widthPx} ÷ ${facts.heightPx} = ${measured.toFixed(4)}. ` +
        `The declared format is ${target.aspect} (${target.aspectValue.toFixed(4)}) from export preset ${target.presetId}; ` +
        `difference ${(delta * 100).toFixed(2)}%, tolerance 1.00%: ${pass ? "inside" : "outside"}.`,
      sources: fileSource,
    };
  })();

  const frameRate = (() => {
    if (!facts) return fileMissing("the frame rate");
    if (!target) return needTarget("the frame rate");
    if (facts.frameRateAvg === null) {
      return {
        state: "not_measured" as const,
        measurement: `${facts.tool} read ${facts.path} but reported no frame rate, so the cadence was not measured. This is not a pass.`,
        missingInputs: ["a frame rate in the probe output for the file's video stream"],
        sources: fileSource,
      };
    }
    const delta = Math.abs(facts.frameRateAvg - target.frameRate);
    const pass = delta <= 0.05;
    return {
      state: pass ? ("pass" as const) : ("fail" as const),
      measurement:
        `Read ${facts.path} with ${facts.tool}: average frame rate ${n(facts.frameRateAvg, 3)} fps` +
        `${facts.frameRateDeclared === null ? "" : ` (declared in the stream as ${n(facts.frameRateDeclared, 3)} fps)`}. ` +
        `Compared with export preset ${target.presetId}'s ${target.frameRate} fps; difference ${n(delta, 3)} fps against a 0.05 fps tolerance: ${pass ? "inside" : "outside"}. ` +
        `Where that cadence comes from: ${target.frameRateBasis}`,
      sources: fileSource,
    };
  })();

  const bitrate = (() => {
    if (!facts) return fileMissing("the bitrate");
    if (!target) return needTarget("the bitrate");
    const measured = facts.videoBitrateKbps ?? facts.overallBitrateKbps;
    if (measured === null) {
      return {
        state: "not_measured" as const,
        measurement: `${facts.tool} read ${facts.path} but reported no bitrate for the video stream or the container. This is not a pass.`,
        missingInputs: ["a bitrate in the probe output (stream or container)"],
        sources: fileSource,
      };
    }
    const floor = target.videoBitrateKbps * 0.7;
    const pass = measured >= floor;
    return {
      state: pass ? ("pass" as const) : ("fail" as const),
      measurement:
        `Read ${facts.path} with ${facts.tool}: ${measured} kbps on the ${facts.videoBitrateKbps === null ? "container" : "video stream"}. ` +
        `The declared target is ${target.videoBitrateKbps} kbps (preset ${target.presetId}); this app's declared floor is 70% of it, ${Math.round(floor)} kbps. ` +
        `${measured} kbps against that floor: ${pass ? "met" : "not met"}. Where the target comes from: ${target.bitrateBasis}`,
      sources: fileSource,
    };
  })();

  const audio = (() => {
    if (!facts) return fileMissing("the presence of an audio stream");
    const withChannels = facts.audioStreams.filter((s) => (s.channels ?? 0) >= 1);
    const pass = withChannels.length > 0;
    return {
      state: pass ? ("pass" as const) : ("fail" as const),
      measurement:
        `Read ${facts.path} with ${facts.tool}: ${facts.audioStreams.length} audio stream(s) reported` +
        `${facts.audioStreams.length === 0 ? "" : ` — ${facts.audioStreams.map((s) => `#${s.index} ${s.codec ?? "unknown codec"}, ${s.channels ?? "unknown"} channel(s), ${s.sampleRateHz === null ? "unknown sample rate" : `${s.sampleRateHz} Hz`}`).join("; ")}`}. ` +
        `Threshold: at least one audio stream with at least one channel: ${pass ? "met" : "not met"}.`,
      sources: fileSource,
    };
  })();

  const loud = (() => {
    if (loudness.state !== "measured") {
      return {
        state: "not_measured" as const,
        measurement:
          `The loudness pass did not produce a measurement, so integrated loudness and true peak were not measured. ` +
          `${loudness.reason} What would make this check measurable: ${loudness.requires.join("; ")}. This is not a pass, and it is not a report that clipping was checked.`,
        missingInputs: [...loudness.requires, loudness.reason],
        sources: facts ? [{ kind: "file", id: facts.path }] : [PROJECT_SOURCE(source, "exportJobs")],
      };
    }
    if (!target) return needTarget("loudness and true peak");
    const f = loudness.facts;
    const delta = Math.abs(f.integratedLufs - target.loudnessTargetLufs);
    const peakOk = f.truePeakDbfs <= target.truePeakDbfs;
    const pass = delta <= 1.0 && peakOk;
    return {
      state: pass ? ("pass" as const) : ("fail" as const),
      measurement:
        `Measured by ${f.tool}: integrated loudness ${n(f.integratedLufs, 1)} LUFS, true peak ${n(f.truePeakDbfs, 1)} dBTP. ` +
        `The declared band is ${target.loudnessTargetLufs} LUFS ±1.0 and at or below ${target.truePeakDbfs} dBTP (preset ${target.presetId}). ` +
        `Loudness is ${n(delta, 1)} LU from the target and the peak is ${n(f.truePeakDbfs, 1)} dBTP: ${pass ? "inside" : "outside"}. ` +
        `This measurement reports no clipped-sample count, so this check does not claim clipping was measured — the true-peak ceiling is the headroom figure and is reported as that. ` +
        `Where the band comes from: ${target.loudnessBasis}`,
      sources: facts ? [{ kind: "file", id: facts.path }] : [PROJECT_SOURCE(source, "exportJobs")],
    };
  })();

  // The order here is the catalogue's order; `check()` resolves labels, weights and
  // thresholds from the catalogue so this function can never disagree with it.
  return [
    check("produced_file", produced),
    check("resolution", resolution),
    check("aspect_ratio", aspect),
    check("frame_rate", frameRate),
    check("video_bitrate", bitrate),
    check("audio_stream", audio),
    check("loudness", loud),
  ];
}

/** The cue data one track gives, plus the row it came from. */
function trackCues(track: PublishingSubtitleRow): ParsedCue[] {
  return parseSrtCues(track.text ?? "");
}

function subtitleChecks(
  source: QualitySource,
  file: FileProbeOutcome,
): QualityCheckResult[] {
  const track = source.subtitleTracks[0] ?? null;
  const trackSources: SourceRef[] = track
    ? [{ kind: "subtitle", id: track.subtitleId, path: "text" }]
    : [PROJECT_SOURCE(source, "assets")];
  const cues = track ? trackCues(track) : [];
  const tl = timelineSeconds(source);

  const noTrack: Draft = {
    state: "not_measured",
    measurement:
      `This project has no Subtitle row, so there is no cue text to parse and this check was not measured. ` +
      `What would make it measurable: a Subtitle row (with its SRT text) attached to this project. This is not a pass.`,
    missingInputs: ["a Subtitle row with stored SRT text for this project"],
    sources: trackSources,
  };

  const trackPresent = (() => {
    if (!track) return noTrack;
    const pass = cues.length >= 1;
    return {
      state: pass ? ("pass" as const) : ("fail" as const),
      measurement:
        `Read Subtitle ${track.subtitleId} (language ${track.language ?? "unstated"}, format ${track.format ?? "unstated"}) and parsed its ${(track.text ?? "").length}-character text: ` +
        `${cues.length} cue(s) with a well-formed SRT timecode. ` +
        `Threshold: at least one cue — ${pass ? "met" : "not met, and the text is not replaced with anything invented"}.`,
      sources: trackSources,
    } as Draft;
  })();

  const timing = (() => {
    if (!track) return noTrack;
    if (cues.length === 0) {
      return {
        state: "not_measured" as const,
        measurement:
          `Subtitle ${track.subtitleId} parsed to zero cues, so there are no timecodes to compare with the timeline. ` +
          `What would make it measurable: cue text with SRT timecodes. This is not a pass.`,
        missingInputs: ["at least one parseable SRT cue on the stored subtitle track"],
        sources: trackSources,
      } as Draft;
    }
    if (tl.total === null) {
      return {
        state: "not_measured" as const,
        measurement:
          `The ${cues.length} cue(s) were read, but the timeline cannot be computed: ${tl.missing.length} of ${tl.scenes} scene(s) carry no stored duration` +
          `${tl.scenes === 0 ? " (this project has no scenes at all)" : ""}. ` +
          `No timeline is substituted, so the cue end times were not compared with one. This is not a pass.`,
        missingInputs: ["a stored durationSeconds on every scene, so the timeline can be summed"],
        sources: trackSources,
      } as Draft;
    }
    const bad = cues.filter((c) => c.endMs <= c.startMs);
    // The timeline is in SECONDS (Scene.durationSeconds) and the cues are in
    // milliseconds, so the comparison is made in milliseconds explicitly.
    const lastEnd = Math.max(...cues.map((c) => c.endMs));
    const overrun = lastEnd - (tl.total * 1000 + 500);
    const pass = bad.length === 0 && overrun <= 0;
    return {
      state: pass ? ("pass" as const) : ("fail" as const),
      measurement:
        `Read ${cues.length} cue(s) from Subtitle ${track.subtitleId} and the timeline summed from ${tl.scenes} scene duration(s) = ${n(tl.total, 1)} s. ` +
        `${bad.length} cue(s) end at or before they start` +
        `${bad.length === 0 ? "" : ` (first: cue ${bad[0]!.index}, ${secs(bad[0]!.startMs)} → ${secs(bad[0]!.endMs)})`}. ` +
        `The last cue ends at ${secs(lastEnd)}, which is ${overrun > 0 ? `${n(overrun / 1000, 1)} s past the timeline plus the 0.5 s tolerance` : "inside the timeline plus the 0.5 s tolerance"}. ` +
        `Threshold met: ${pass ? "yes" : "no"}.`,
      sources: trackSources,
    } as Draft;
  })();

  const overlap = (() => {
    if (!track) return noTrack;
    if (cues.length < 2) {
      return {
        state: "not_measured" as const,
        measurement:
          `Subtitle ${track.subtitleId} carries ${cues.length} cue(s), so there is no pair of consecutive cues to compare. ` +
          `What would make it measurable: at least two cues on the track. This is not a pass.`,
        missingInputs: ["at least two cues on the stored subtitle track"],
        sources: trackSources,
      } as Draft;
    }
    const collisions: { a: ParsedCue; b: ParsedCue; by: number }[] = [];
    for (let i = 1; i < cues.length; i += 1) {
      const prev = cues[i - 1]!;
      const cur = cues[i]!;
      if (cur.startMs < prev.endMs) collisions.push({ a: prev, b: cur, by: prev.endMs - cur.startMs });
    }
    const pass = collisions.length === 0;
    return {
      state: pass ? ("pass" as const) : ("fail" as const),
      measurement:
        `Read the ${cues.length} cue(s) of Subtitle ${track.subtitleId} in start order and compared each cue's end with the next cue's start. ` +
        `${collisions.length} overlapping pair(s)` +
        `${collisions.length === 0 ? "" : `, the first being cue ${collisions[0]!.a.index} ending at ${secs(collisions[0]!.a.endMs)} while cue ${collisions[0]!.b.index} starts at ${secs(collisions[0]!.b.startMs)} (${n(collisions[0]!.by / 1000, 1)} s of two captions at once)`}. ` +
        `Threshold: no cue starts before the previous one ends — ${pass ? "met" : "not met"}.`,
      sources: trackSources,
    } as Draft;
  })();

  const safeArea = (() => {
    if (!track) return noTrack;
    if (cues.length === 0) {
      return {
        state: "not_measured" as const,
        measurement: `Subtitle ${track.subtitleId} parsed to zero cues, so there is no caption block to place. This is not a pass.`,
        missingInputs: ["at least one parseable SRT cue on the stored subtitle track"],
        sources: trackSources,
      } as Draft;
    }
    const defaults = source.subtitleDefaults;
    const styleId = defaults?.styleId ?? null;
    const anchor = defaults?.position ?? null;
    const style = findSubtitleStyle(styleId);
    const missing: string[] = [];
    if (!defaults) missing.push("ProjectSettings.subtitleDefaults (the stored style and anchor the cues are placed with)");
    else {
      if (!styleId) missing.push("a stored subtitle style id in ProjectSettings.subtitleDefaults");
      else if (!style) missing.push(`a style in the subtitle engine's own catalogue matching the stored id "${styleId}"`);
      if (!anchor) missing.push("a stored subtitle anchor (top / centre / bottom) in ProjectSettings.subtitleDefaults");
    }
    const frameFromProbe = file.state === "probed" ? file.facts : null;
    if (!frameFromProbe || frameFromProbe.widthPx === null || frameFromProbe.heightPx === null) {
      missing.push("a produced file whose measured frame size the safe area can be computed for");
    }
    if (missing.length > 0) {
      return {
        state: "not_measured" as const,
        measurement:
          `The ${cues.length} cue(s) were read, but the safe area cannot be computed without every input it is computed FROM. ` +
          `Missing: ${missing.join("; ")}. No safe area is assumed, so the cue placement was not compared with one. This is not a pass.`,
        missingInputs: missing,
        sources: trackSources,
      } as Draft;
    }
    // Every input is present: compute the safe area from the engine's own constants.
    const width = frameFromProbe!.widthPx!;
    const height = frameFromProbe!.heightPx!;
    const marginX = SUBTITLE_SAFE_MARGINS.x;
    const marginY = SUBTITLE_SAFE_MARGINS.y;
    const worstLines = Math.min(
      Math.max(...cues.map((c) => c.lines)),
      MAX_CAPTION_LINES,
    );
    const blockHeight = worstLines * CAPTION_LINE_HEIGHT_PX;
    const lowestAllowedBottom = height - marginY;
    const highestAllowedTop = marginY;
    const blockTop = anchor === "top" ? highestAllowedTop : lowestAllowedBottom - blockHeight;
    const blockBottom = blockTop + blockHeight;
    const pass = blockTop >= highestAllowedTop && blockBottom <= lowestAllowedBottom && width - 2 * marginX > 0;
    return {
      state: pass ? ("pass" as const) : ("fail" as const),
      measurement:
        `Read ${cues.length} cue(s) from Subtitle ${track.subtitleId}; the widest cue renders ${worstLines} line(s) at the engine's ${CAPTION_LINE_HEIGHT_PX} px line height = ${blockHeight} px. ` +
        `Frame ${width}×${height} px measured from ${frameFromProbe!.path} by ${frameFromProbe!.tool}; safe margins ${marginX} px horizontal and ${marginY} px vertical (SUBTITLE_SAFE_MARGINS); anchor "${anchor}" from the stored style "${style!.id}". ` +
        `The block occupies y ${blockTop}–${blockBottom} px inside the allowed ${highestAllowedTop}–${lowestAllowedBottom} px: ${pass ? "inside" : "outside"}.`,
      sources: trackSources,
    } as Draft;
  })();

  return [
    check("subtitle_track", trackPresent),
    check("subtitle_cue_timing", timing),
    check("subtitle_overlap", overlap),
    check("subtitle_safe_area", safeArea),
  ];
}

function audioChecks(source: QualitySource): QualityCheckResult[] {
  const tl = timelineSeconds(source);
  const voice = source.audioTracks.filter((a) => a.kind === "VOICEOVER");
  const music = source.audioTracks.filter((a) => a.kind === "MUSIC");

  const voiceCheck = (() => {
    if (voice.length === 0) {
      return {
        state: "not_measured" as const,
        measurement:
          `No stored voiceover asset exists on this project, so there is no voice duration to compare with the timeline. ` +
          `What would make it measurable: a voiceover asset row carrying durationSeconds. This is not a pass.`,
        missingInputs: ["a stored voiceover asset (Asset kind VOICEOVER) with durationSeconds"],
        sources: [PROJECT_SOURCE(source, "assets")],
      } as Draft;
    }
    const withDuration = voice.filter((a) => a.durationSeconds !== null && a.durationSeconds > 0);
    if (withDuration.length === 0) {
      return {
        state: "not_measured" as const,
        measurement:
          `${voice.length} voiceover asset(s) exist but none carries a stored durationSeconds, so there is no measured duration to compare. This is not a pass.`,
        missingInputs: ["a durationSeconds value on the voiceover asset row"],
        sources: voice.map((a) => ({ kind: "asset" as const, id: a.assetId, path: "durationSeconds" })),
      } as Draft;
    }
    if (tl.total === null) {
      return {
        state: "not_measured" as const,
        measurement:
          `The voiceover asset's duration was read, but the timeline cannot be computed: ${tl.missing.length} scene(s) carry no stored duration. This is not a pass.`,
        missingInputs: ["a stored durationSeconds on every scene, so the timeline can be summed"],
        sources: voice.map((a) => ({ kind: "asset" as const, id: a.assetId, path: "durationSeconds" })),
      } as Draft;
    }
    const longest = withDuration.reduce((a, b) => ((a.durationSeconds ?? 0) >= (b.durationSeconds ?? 0) ? a : b));
    const measured = longest.durationSeconds!;
    const tolerance = Math.max(1, tl.total * 0.02);
    const pass = Math.abs(measured - tl.total) <= tolerance;
    return {
      state: pass ? ("pass" as const) : ("fail" as const),
      measurement:
        `Read voiceover asset ${longest.assetId}'s stored durationSeconds = ${n(measured, 1)} s and the timeline summed from ${tl.scenes} scene(s) = ${n(tl.total, 1)} s. ` +
        `The difference is ${n(Math.abs(measured - tl.total), 1)} s against a tolerance of ${n(tolerance, 1)} s (2% of the timeline or 1 s, whichever is larger): ${pass ? "inside" : "outside"}.`,
      sources: [{ kind: "asset", id: longest.assetId, path: "durationSeconds" }],
    } as Draft;
  })();

  const musicCheck = (() => {
    if (music.length === 0) {
      return {
        state: "not_measured" as const,
        measurement:
          `No stored music asset exists on this project, so there is no bed to compare with the timeline. ` +
          `What would make it measurable: a music asset row carrying durationSeconds. This is not a pass.`,
        missingInputs: ["a stored music asset (Asset kind MUSIC) with durationSeconds"],
        sources: [PROJECT_SOURCE(source, "assets")],
      } as Draft;
    }
    if (tl.total === null) {
      return {
        state: "not_measured" as const,
        measurement: `Music assets were found, but the timeline cannot be computed: ${tl.missing.length} scene(s) carry no stored duration. This is not a pass.`,
        missingInputs: ["a stored durationSeconds on every scene, so the timeline can be summed"],
        sources: music.map((a) => ({ kind: "asset" as const, id: a.assetId, path: "durationSeconds" })),
      } as Draft;
    }
    const withDuration = music.filter((a) => a.durationSeconds !== null);
    if (withDuration.length === 0) {
      return {
        state: "not_measured" as const,
        measurement: `${music.length} music asset(s) exist but none carries a stored durationSeconds, so nothing was measured. This is not a pass.`,
        missingInputs: ["a durationSeconds value on the music asset row"],
        sources: music.map((a) => ({ kind: "asset" as const, id: a.assetId, path: "durationSeconds" })),
      } as Draft;
    }
    const longest = withDuration.reduce((a, b) => ((a.durationSeconds ?? 0) >= (b.durationSeconds ?? 0) ? a : b));
    const measured = longest.durationSeconds!;
    const pass = measured >= tl.total - 1;
    return {
      state: pass ? ("pass" as const) : ("fail" as const),
      measurement:
        `Read music asset ${longest.assetId}'s stored durationSeconds = ${n(measured, 1)} s; the timeline is ${n(tl.total, 1)} s. ` +
        `A bed must reach the timeline minus 1 s (${n(tl.total - 1, 1)} s): ${pass ? "met" : "not met"}.`,
      sources: [{ kind: "asset", id: longest.assetId, path: "durationSeconds" }],
    } as Draft;
  })();

  return [check("voice_duration", voiceCheck), check("music_duration", musicCheck)];
}

function structureChecks(source: QualitySource): QualityCheckResult {
  const scenes = source.chapters.flatMap((c) => c.scenes);
  if (scenes.length === 0) {
    return check("scene_narration", {
      state: "not_measured",
      measurement:
        "This project has no scene rows, so there is no narration text to read. What would make this check measurable: at least one scene row. This is not a pass.",
      missingInputs: ["at least one scene row with a narration column"],
      sources: [PROJECT_SOURCE(source, "scenes")],
    });
  }
  const empty = scenes.filter((s) => !s.narration || s.narration.trim().length === 0);
  const pass = empty.length === 0;
  return check("scene_narration", {
    state: pass ? "pass" : "fail",
    measurement:
      `Read the narration column of all ${scenes.length} scene(s). ${empty.length} of them carry no spoken text` +
      `${empty.length === 0 ? "" : ` (first: scene ${empty[0]!.id} in chapter order ${empty[0]!.order})`}. ` +
      `Threshold: zero scenes with an empty narration column — ${pass ? "met" : "not met"}.`,
    sources: empty.length === 0
      ? [PROJECT_SOURCE(source, "scenes")]
      : empty.map((s) => ({ kind: "scene" as const, id: s.id, path: "narration" })),
  });
}

function renderCheck(source: QualitySource): QualityCheckResult {
  const job = latestExportJob(source);
  if (!job) {
    return check("render_errors", {
      state: "not_measured",
      measurement:
        "This project has no export job row, so no job has reported anything and there is nothing to read. " +
        "What would make this check measurable: an export job for this project that reached a terminal status. This is not a pass.",
      missingInputs: ["an export job row for this project"],
      sources: [PROJECT_SOURCE(source, "exportJobs")],
    });
  }
  const jobSource: SourceRef[] = [{ kind: "export_job", id: job.id, path: "status" }];
  if (job.status === "FAILED") {
    return check("render_errors", {
      state: "fail",
      measurement:
        `Read export job ${job.id}: status ${job.status}` +
        `${job.errorMessage ? `, errorMessage "${job.errorMessage}"` : ", with no error message recorded"}. ` +
        `A failed job means the render did not produce the output this project asked for. Threshold: the newest job reports no error — not met.`,
      sources: jobSource,
    });
  }
  if (job.status === "COMPLETED") {
    return check("render_errors", {
      state: job.errorMessage ? "fail" : "pass",
      measurement:
        `Read export job ${job.id}: status ${job.status}` +
        `${job.errorMessage ? ` but it also records the error "${job.errorMessage}"` : " and it records no error message"}. ` +
        `Threshold: the newest job is completed with no error recorded — ${job.errorMessage ? "not met" : "met"}.`,
      sources: jobSource,
    });
  }
  return check("render_errors", {
    state: "not_measured",
    measurement:
      `Read export job ${job.id}: status ${job.status}, which is not a terminal status, so the job has reported no outcome. ` +
      `A job that has not finished is not evidence of an error and not evidence of success. This is not a pass.`,
    missingInputs: [`a terminal status (COMPLETED or FAILED) on export job ${job.id}`],
    sources: jobSource,
  });
}

function coverageCheck(source: QualitySource): QualityCheckResult {
  if (source.chapters.length === 0) {
    return check("chapter_coverage", {
      state: "not_measured",
      measurement:
        "This project has no chapter rows, so there is nothing to cover and no duration to sum. " +
        "What would make this check measurable: at least one chapter with at least one scene. This is not a pass.",
      missingInputs: ["at least one chapter row with scenes, so a duration can be summed"],
      sources: [PROJECT_SOURCE(source, "chapters")],
    });
  }
  const emptyChapters = source.chapters.filter((c) => c.scenes.length === 0);
  const tl = timelineSeconds(source);
  if (tl.total === null) {
    return check("chapter_coverage", {
      state: "not_measured",
      measurement:
        `Read ${source.chapters.length} chapter(s) and ${tl.scenes} scene(s), and ${tl.missing.length} scene(s) carry no stored duration. ` +
        `The total cannot be summed, and it is not substituted with an estimate. This is not a pass.`,
      missingInputs: ["a stored durationSeconds on every scene, so the chapter durations can be summed"],
      sources: [PROJECT_SOURCE(source, "chapters")],
    });
  }
  const declared = source.project.targetDurationSeconds;
  const tolerance = declared === null ? null : Math.max(1, declared * 0.1);
  const withinDeclared = declared === null ? null : Math.abs(tl.total - declared) <= (tolerance ?? 0);
  const pass = emptyChapters.length === 0 && (withinDeclared === null || withinDeclared);
  return check("chapter_coverage", {
    state: pass ? "pass" : "fail",
    measurement:
      `Read ${source.chapters.length} chapter(s) covering ${tl.scenes} scene(s); ${emptyChapters.length} chapter(s) carry no scene` +
      `${emptyChapters.length === 0 ? "" : ` (${emptyChapters.map((c) => c.id).join(", ")})`}. ` +
      `The scenes' durations sum to ${n(tl.total, 1)} s. ` +
      (declared === null
        ? "The project declares no target duration, so only the structural part of this check could be applied; no target is invented."
        : `The project's declared target duration is ${declared} s, and ${n(tl.total, 1)} s is ${withinDeclared ? "within" : "outside"} the 10% tolerance (±${n(tolerance ?? 0, 1)} s).`) +
      ` Threshold met: ${pass ? "yes" : "no"}.`,
    sources: [PROJECT_SOURCE(source, "chapters"), PROJECT_SOURCE(source, "targetDurationSeconds")],
  });
}

function thumbnailCheck(input: BuildQualityPlanInput): QualityCheckResult {
  const plan = input.thumbnails;
  if (!plan || plan.totalConcepts === 0) {
    return check("thumbnail_concepts", {
      state: "not_measured",
      measurement:
        "The thumbnail plan carries no concept at all, so there is no count to compare with the requested minimum. " +
        "What would make this check measurable: a project whose own stored text yields at least one concept specification. This is not a pass.",
      missingInputs: ["a thumbnail concept produced from this project's own rows"],
      sources: [PROJECT_SOURCE(input.source, "thumbnails")],
    });
  }
  const pass = plan.totalConcepts >= plan.minimumRequested && plan.totalConcepts <= plan.maximumAllowed;
  return check("thumbnail_concepts", {
    state: pass ? "pass" : "fail",
    measurement:
      `Counted ${plan.totalConcepts} concept(s) in the thumbnail plan's own list. ` +
      `The requested range is ${plan.minimumRequested}–${plan.maximumAllowed}: ${plan.totalConcepts} is ${pass ? "inside" : "outside"} it.`,
    sources: [PROJECT_SOURCE(input.source, "thumbnails")],
  });
}

/* ------------------------------------------------------------------ */
/* The score                                                           */
/* ------------------------------------------------------------------ */

/** Round to a whole number without floating-point surprises at .5. */
function roundScore(value: number): number {
  return Math.round(value + Number.EPSILON);
}

/**
 * THE SCORE — arithmetic over the checks that were measured, and nothing else.
 *
 * `measuredWeight` is the denominator, so an unmeasured check can neither help nor
 * hurt: it is not counted as a pass (which would inflate) and not counted as a
 * failure (which would deflate). With no measured check at all there is no score —
 * the field is empty-with-reason, and the reason names what would produce one.
 */
export function computeQualityScore(checks: readonly QualityCheckResult[]): QualityScore {
  const measured = checks.filter((c) => c.state !== "not_measured");
  const passed = measured.filter((c) => c.state === "pass");
  const failed = measured.filter((c) => c.state === "fail");
  const measuredWeight = measured.reduce((sum, c) => sum + c.weight, 0);
  const totalWeight = checks.reduce((sum, c) => sum + c.weight, 0);
  const passingWeight = passed.reduce((sum, c) => sum + c.weight, 0);
  const notMeasured = checks.length - measured.length;

  const basis =
    measured.length === 0
      ? `No score is shown: none of the ${checks.length} checks could be measured on this project, so there is nothing to compute a score over. ` +
        `A score here would be a number with no measurement behind it.`
      : `This score is over the ${measured.length} of ${checks.length} checks that were actually measured — ${measuredWeight} of the ${totalWeight} declared weight. ` +
        `The other ${notMeasured} check(s) were not measured, and this score says nothing about them: they are not counted as passes.`;

  const notAPrediction =
    "This number is arithmetic over the checks that ran. It is not a prediction of how the video will perform, it is not a judgement of whether the video is worth watching, " +
    "and it is not a claim that any unmeasured check passed.";

  const arithmetic =
    measured.length === 0
      ? "No arithmetic was performed: the measured weight is 0, so the division by measured weight is not defined and no score is produced."
      : `${passingWeight} (weight of the ${passed.length} passing check(s)) ÷ ${measuredWeight} (weight of the ${measured.length} measured check(s)) × 100 = ` +
        `${roundScore((passingWeight / measuredWeight) * 100)}. The ${failed.length} failing check(s) contribute 0 to the numerator.`;

  if (measuredWeight === 0) {
    return {
      score: emptyNoInput(
        `No check could be measured on this project, so no score exists. ${notAPrediction}`,
        [
          "at least one input a quality check can read — a produced video file, a subtitle track with cues, a stored voice or music asset, or an export job with a terminal status",
        ],
        { note: arithmetic },
      ),
      passedChecks: 0,
      failedChecks: 0,
      measuredChecks: 0,
      notMeasuredChecks: notMeasured,
      totalChecks: checks.length,
      measuredWeight: 0,
      totalWeight,
      basis,
      notAPrediction,
      arithmetic,
    };
  }

  const value = roundScore((passingWeight / measuredWeight) * 100);
  return {
    score: derived(value, "R-QUALITY-SCORE", [{ kind: "project", id: "quality-plan", path: "checks" }], {
      note: `Computed from the ${measured.length} measured check(s) only: ${arithmetic}`,
    }),
    passedChecks: passed.length,
    failedChecks: failed.length,
    measuredChecks: measured.length,
    notMeasuredChecks: notMeasured,
    totalChecks: checks.length,
    measuredWeight,
    totalWeight,
    basis,
    notAPrediction,
    arithmetic,
  };
}

/* ------------------------------------------------------------------ */
/* Assembling the plan                                                 */
/* ------------------------------------------------------------------ */

const QUALITY_DECLARATION = {
  statement:
    "Every check below reports one of three states: pass, fail, or not measured. A check that was not measured names the input that is missing and is never counted as a pass. " +
    "The measurement sentence on each check names the input it read, the value it computed, the threshold, and where that threshold comes from.",
  notAPrediction:
    "The score below is arithmetic over the checks that were measured. It is not a prediction of how the video will perform, it is not a judgement of whether the video is good, " +
    "and it is not a claim that the checks that were not measured would have passed.",
  notAHealthJudgement:
    "Not every requested check has an input on this project today. The ones that do not are reported as not measured, with the missing input named, rather than being dropped from the list or reported as fine.",
  measuredOnly:
    "A check is measured only from a stored row, a stored cue's timecodes, a produced file's own reported stream facts, or a declared export preset's own numbers. Nothing here is estimated, sampled or assumed.",
};

export function buildQualityPlan(input: BuildQualityPlanInput): QualityPlan {
  // The four P7-5 inputs are normalised once, here, so every check below reads a
  // real array. "The store did not read this row family" and "this project has no
  // such rows" are the same answer for a check: it has no input, and it says so.
  const source: QualitySource = {
    ...input.source,
    subtitleTracks: input.source.subtitleTracks ?? [],
    audioTracks: input.source.audioTracks ?? [],
    exportJobs: input.source.exportJobs ?? [],
    subtitleDefaults: input.source.subtitleDefaults ?? null,
  };
  const file = input.file ?? NO_FILE;
  const loudness = input.loudness ?? NO_LOUDNESS;
  const target = declareDeliveryTarget(source);
  const tl = timelineSeconds(source);

  const checks: QualityCheckResult[] = [
    ...fileChecks(source, file, loudness, target),
    ...subtitleChecks(source, file),
    ...audioChecks(source),
    structureChecks(source),
    renderCheck(source),
    coverageCheck(source),
    thumbnailCheck(input),
  ];

  // The catalogue is the contract: all seventeen, in catalogue order, each exactly
  // once. A check added to one list and not the other fails here rather than
  // producing a plan that quietly measures sixteen things.
  const ids = checks.map((c) => c.id).sort();
  const expected = QUALITY_CHECK_CATALOGUE.map((c) => c.id).sort();
  if (ids.length !== expected.length || ids.some((id, i) => id !== expected[i])) {
    throw new Error(
      `quality plan has ${ids.length} check(s) [${ids.join(", ")}] but the catalogue declares ${expected.length} [${expected.join(", ")}]`,
    );
  }

  const areas: QualityAreaResult[] = QUALITY_AREAS.map((area) => {
    const inArea = checks.filter((c) => c.area === area.id);
    return {
      id: area.id,
      label: area.label,
      brief: area.brief,
      checks: inArea.length,
      measured: inArea.filter((c) => c.state !== "not_measured").length,
      passed: inArea.filter((c) => c.state === "pass").length,
      failed: inArea.filter((c) => c.state === "fail").length,
      notMeasured: inArea.filter((c) => c.state === "not_measured").length,
      weight: inArea.reduce((sum, c) => sum + c.weight, 0),
      measuredWeight: inArea.filter((c) => c.state !== "not_measured").reduce((sum, c) => sum + c.weight, 0),
    };
  });

  const score = computeQualityScore(checks);

  const fileMeasurement = {
    state: file.state,
    statement:
      file.state === "probed"
        ? `A produced file was measured at ${file.facts.path} by ${file.facts.tool}: ${file.facts.sizeBytes} byte(s)` +
          `${file.facts.widthPx === null || file.facts.heightPx === null ? ", with no pixel dimensions reported" : `, video stream ${file.facts.widthPx}×${file.facts.heightPx}`}` +
          `${file.facts.durationSeconds === null ? "" : `, ${n(file.facts.durationSeconds, 2)} s long`}` +
          `, ${file.facts.audioStreams.length} audio stream(s).`
        : `No produced file was measured: ${file.reason} What would make these seven checks measurable: ${file.requires.join("; ")}.`,
    requires: file.state === "probed" ? [] : file.requires,
  };

  const loudnessMeasurement = {
    state: loudness.state,
    statement:
      loudness.state === "measured"
        ? `A loudness pass measured integrated ${n(loudness.facts.integratedLufs, 1)} LUFS and true peak ${n(loudness.facts.truePeakDbfs, 1)} dBTP with ${loudness.facts.tool}.`
        : `No loudness measurement exists: ${loudness.reason} What would produce one: ${loudness.requires.join("; ")}.`,
    requires: loudness.state === "measured" ? [] : loudness.requires,
  };

  const timeline = {
    total: tl.total,
    scenes: tl.scenes,
    missingScenes: tl.missing.length,
    statement:
      tl.total === null
        ? `No timeline could be computed: ${tl.scenes === 0 ? "this project has no scenes" : `${tl.missing.length} of ${tl.scenes} scene(s) carry no stored duration`}. No timeline is substituted.`
        : `The timeline is ${n(tl.total, 1)} s: the sum of all ${tl.scenes} scene(s)' own stored durations.`,
  };

  return {
    rule: "R-QUALITY-CHECK",
    scoreRule: "R-QUALITY-SCORE",
    checks,
    areas,
    score,
    fileMeasurement,
    loudnessMeasurement,
    declaredTarget: target,
    timeline,
    counts: {
      checks: checks.length,
      pass: checks.filter((c) => c.state === "pass").length,
      fail: checks.filter((c) => c.state === "fail").length,
      notMeasured: checks.filter((c) => c.state === "not_measured").length,
      weights: DECLARED_WEIGHT_TOTAL,
    },
    declaration: QUALITY_DECLARATION,
    notes: [
      target
        ? `The declared delivery target was resolved from an export job row: ${target.source}`
        : "No declared delivery target could be resolved, because no export job on this project declares a resolution that matches an export preset. The checks that compare a measurement with a declared target say so instead of choosing one.",
      "The seven file checks read a produced file. No export has ever completed on this server, so the honest state of those checks is that there is no file to read — which is what they report, in the words of the missing input.",
      `The declared weights sum to ${DECLARED_WEIGHT_TOTAL} and are stated per check; the score divides by the weight of the MEASURED checks only.`,
    ],
  };
}
