/**
 * Phase 6 Block 1 — DELIVERABLE MANIFEST (pure, client-safe).
 *
 * For a project + a chosen set of presets + a duration, this lists the output
 * files that WOULD be produced — one per preset: name, resolution, codec,
 * container and estimated size — and states plainly what is NOT produced.
 *
 * It is a manifest of intent, not a directory listing: `filesProduced: 0` and
 * `produced: false` are part of the shape, and `NOT_PRODUCED` names every
 * artifact a reader might otherwise assume exists (the media files themselves,
 * thumbnails, subtitle files, HDR metadata authoring, uploads).
 */
import { SIZE_FORMULA, estimateSize, humanBytes, humanDuration, type SizeEstimate } from "./sizing";
import { EXPORT_PRESET_IDS, findExportPreset, orderPresetIds, type ExportPresetId, type ExportPresetSpec } from "./presets";
import type { SidecarManifest } from "./sidecars";

export const EXPORT_MANIFEST_FORMAT = "cavis.export.manifest";
export const EXPORT_MANIFEST_VERSION = 1;

/** "My Great Video!" → "my-great-video" — stable, filesystem-safe, no surprises. */
export function slugifyProjectTitle(title: string | null | undefined): string {
  const base = (title ?? "").normalize("NFKD").toLowerCase();
  const slug = base
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "project";
}

/** The file name an output would carry. Deterministic from title + preset id. */
export function outputFileName(projectTitle: string | null | undefined, preset: ExportPresetSpec): string {
  return `${slugifyProjectTitle(projectTitle)}-${preset.id}.${preset.container}`;
}

/** Everything the manifest states is NOT produced. */
export const NOT_PRODUCED = [
  "the video files themselves — no frame was decoded, edited, reframed, graded or encoded",
  "the audio files — no voice, music, SFX or mix was rendered or loudness-measured",
  "subtitle / timed-text files — no cue file was generated or muxed",
  "thumbnails and cover art",
  "HDR mastering metadata authoring (MaxCLL / MaxFALL and mastering-display volume are declared, not authored)",
  "platform uploads, publish URLs or share links",
  "any file on disk, in object storage or in the export queue — 0 bytes were written",
];

export interface ManifestOutput {
  presetId: ExportPresetId;
  label: string;
  platform: string;
  fileName: string;
  resolution: string;
  widthPx: number;
  heightPx: number;
  aspect: string;
  formatId: string;
  container: string;
  videoCodec: string;
  videoProfile: string;
  videoBitrateKbps: number;
  frameRate: number;
  audioCodec: string;
  audioBitrateKbps: number;
  sampleRateHz: number;
  channelLayout: string;
  loudnessTargetLufs: number;
  colour: { display: string; standard: string; transfer: string; maxCLL: number | null };
  estimatedSize: SizeEstimate;
}

export interface DeliverableManifest {
  format: string;
  version: number;
  projectId: string;
  projectTitle: string | null;
  durationSeconds: number;
  durationHuman: string;
  durationSource: string;
  outputs: ManifestOutput[];
  fileCount: number;
  totalEstimatedBytes: number;
  totalEstimatedHuman: string;
  /** This is a specification. Nothing was produced. */
  filesProduced: 0;
  produced: false;
  formula: string;
  notProduced: string[];
  /**
   * Block 3 — the SIDECAR deliverables that ship alongside these outputs
   * (subtitle cue file, chapter markers, thumbnail, metadata). null only when
   * the caller did not assemble them; the API always does.
   */
  sidecars: SidecarManifest | null;
  note: string;
}

export function buildManifestOutput(
  preset: ExportPresetSpec,
  projectTitle: string | null | undefined,
  durationSeconds: number,
): ManifestOutput {
  const size = estimateSize({
    videoBitrateKbps: preset.video.rateControl.targetVideoBitrateKbps,
    audioBitrateKbps: preset.audio.audioBitrateKbps,
    durationSeconds,
  });
  return {
    presetId: preset.id,
    label: preset.label,
    platform: preset.platform,
    fileName: outputFileName(projectTitle, preset),
    resolution: preset.resolution,
    widthPx: preset.widthPx,
    heightPx: preset.heightPx,
    aspect: preset.aspect,
    formatId: preset.formatId,
    container: preset.container,
    videoCodec: preset.video.codec,
    videoProfile: preset.video.profile,
    videoBitrateKbps: preset.video.rateControl.targetVideoBitrateKbps,
    frameRate: preset.video.frameRate,
    audioCodec: preset.audio.codec,
    audioBitrateKbps: preset.audio.audioBitrateKbps,
    sampleRateHz: preset.audio.sampleRateHz,
    channelLayout: preset.audio.channelLayout,
    loudnessTargetLufs: preset.audio.loudnessTargetLufs,
    colour: {
      display: preset.colour.display,
      standard: preset.colour.standard,
      transfer: preset.colour.transfer,
      maxCLL: preset.colour.maxCLL,
    },
    estimatedSize: size,
  };
}

export interface ManifestInput {
  projectId: string;
  projectTitle: string | null | undefined;
  durationSeconds: number;
  /** The presets to enumerate, in canonical catalogue order. */
  presetIds: readonly ExportPresetId[];
  /** Where the duration came from (reported, never guessed). */
  durationSource: string;
  /**
   * Block 3 — the sidecar deliverables to attach. Optional so a caller that
   * only needs the video-file manifest (and its tests) stays valid; when it is
   * omitted the manifest says so with `sidecars: null`.
   */
  sidecars?: SidecarManifest | null;
}

/** The manifest for a chosen set of presets and a duration. Throws SizeError on a bad duration. */
export function buildDeliverableManifest(input: ManifestInput): DeliverableManifest {
  const presetIds = orderPresetIds(input.presetIds);
  const outputs = presetIds
    .map((id) => findExportPreset(id))
    .filter((p): p is ExportPresetSpec => p !== null)
    .map((preset) => buildManifestOutput(preset, input.projectTitle, input.durationSeconds));

  const totalEstimatedBytes = outputs.reduce((sum, o) => sum + o.estimatedSize.bytes, 0);

  return {
    format: EXPORT_MANIFEST_FORMAT,
    version: EXPORT_MANIFEST_VERSION,
    projectId: input.projectId,
    projectTitle: input.projectTitle ?? null,
    durationSeconds: input.durationSeconds,
    durationHuman: humanDuration(input.durationSeconds),
    durationSource: input.durationSource,
    outputs,
    fileCount: outputs.length,
    totalEstimatedBytes,
    totalEstimatedHuman: humanBytes(totalEstimatedBytes),
    filesProduced: 0,
    produced: false,
    formula: outputs.length > 0 ? outputs[0].estimatedSize.formula : SIZE_FORMULA,
    notProduced: [...NOT_PRODUCED],
    sidecars: input.sidecars ?? null,
    note:
      `This manifest lists ${outputs.length} output file${outputs.length === 1 ? "" : "s"} that WOULD be produced, with each ` +
      "file's resolution, codec, container and ESTIMATED size from the stated formula" +
      (input.sidecars ? `, plus the ${input.sidecars.fileCount} sidecar deliverable(s) that ship with it` : "") +
      ". No file exists: nothing was encoded, " +
      "muxed, tone-mapped, muxed with subtitles or uploaded, and no byte count here is a measurement of a real file.",
  };
}

/** Every preset, as a manifest — the "no selection" case. */
export function allPresetIds(): ExportPresetId[] {
  return [...EXPORT_PRESET_IDS];
}
