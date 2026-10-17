/**
 * Phase 7 Block 1 — the publishing package's source shapes and the shape of the
 * package's own building blocks.
 *
 * These are deliberately PLAIN ROW SHAPES (dates as ISO strings, enums as
 * strings): the derivation modules are pure, client-safe and testable without a
 * database, and the Prisma read lives in ./store. A row that the database cannot
 * give us is `null`, never a substituted default.
 */
import type { Field } from "./provenance";

/** One Scene row, reduced to what a publishing package may derive from. */
export interface PublishingSceneRow {
  id: string;
  order: number;
  title: string | null;
  /** The spoken text for the scene — the richest source of the project's words. */
  narration: string | null;
  /** Intended length in seconds. null = this row does not carry a duration. */
  durationSeconds: number | null;
  status: string;
}

/** One Chapter row with its scenes, in the project's narrative order. */
export interface PublishingChapterRow {
  id: string;
  scriptId: string;
  order: number;
  title: string;
  summary: string | null;
  scenes: PublishingSceneRow[];
}

/** One LicensingMetadata row. Every column is optional except the type. */
export interface PublishingLicensingRow {
  id: string;
  licenseType: string;
  source: string | null;
  attribution: string | null;
  licenseUrl: string | null;
  purchasedAt: string | null;
  expiresAt: string | null;
}

/** One Asset row (not soft-deleted) with its licence row, when one exists. */
export interface PublishingAssetRow {
  id: string;
  name: string;
  kind: string;
  status: string;
  mimeType: string | null;
  createdAt: string;
  /** P7-5: Asset.durationSeconds, read so an audio track's own length can be compared with the timeline. */
  durationSeconds?: number | null;
  licensing: PublishingLicensingRow | null;
}

/**
 * P7-5: one Subtitle row with the text it stores. The cue timings the quality
 * checker reads live INSIDE `text` (the subtitle engine's own SRT), so a track with
 * no text has no cues — which is a fact about the row, not a missing feature.
 */
export interface PublishingSubtitleRow {
  subtitleId: string;
  assetId: string;
  language: string | null;
  format: string | null;
  /** The stored SRT/caption text. Null when the row stores only a file key. */
  text: string | null;
  /** Asset.durationSeconds for the subtitle asset, when the asset carries one. */
  assetDurationSeconds: number | null;
  /** Asset.metadata, which is where this app records the style a track was built with. */
  metadataStyleId: string | null;
}

/** P7-5: one audio asset the timeline checks can compare with the timeline. */
export interface PublishingAudioTrackRow {
  assetId: string;
  /** AssetKind, e.g. VOICEOVER / MUSIC / AUDIO. */
  kind: string;
  name: string;
  durationSeconds: number | null;
  status: string;
}

/** P7-5: one export job, reduced to what the render check reads. */
export interface PublishingExportJobRow {
  id: string;
  status: string;
  resolution: string | null;
  errorMessage: string | null;
  outputUrl: string | null;
  s3Key: string | null;
  createdAt: string;
  completedAt: string | null;
  /** Present only when a caller resolved one; the export job row stores no preset column. */
  presetId?: string | null;
}

/** P7-5: the stored subtitle style and anchor the safe-area check is computed FROM. */
export interface PublishingSubtitleDefaultsRow {
  styleId: string | null;
  position: string | null;
}

/** The project row itself. */
export interface PublishingProjectRow {
  id: string;
  title: string;
  description: string | null;
  targetAspectRatio: string | null;
  targetDurationSeconds: number | null;
  updatedAt: string;
}

/** ProjectSettings, reduced leniently — a non-string value is reported absent. */
export interface PublishingSettingsRow {
  /** ProjectSettings.seoDefaults.description, only when it really is a string. */
  seoDefaultsDescription: string | null;
  language: string | null;
  tone: string | null;
  style: string | null;
  targetAudience: string | null;
}

/** The project's Script row, when the project has one. */
export interface PublishingScriptRow {
  id: string;
  title: string | null;
  logline: string | null;
  language: string | null;
  tone: string | null;
  style: string | null;
  targetAudience: string | null;
}

/** Everything a package is derived from. Nothing else is read, ever. */
export interface PublishingSource {
  project: PublishingProjectRow;
  settings: PublishingSettingsRow | null;
  script: PublishingScriptRow | null;
  chapters: PublishingChapterRow[];
  assets: PublishingAssetRow[];
  /**
   * P7-5: the quality checker's own inputs. Each is a real row family, read by the
   * store and by nothing else. An empty array is "this project has none of these
   * rows", which is exactly what the checks report — never a hidden default.
   */
  subtitleTracks?: PublishingSubtitleRow[];
  audioTracks?: PublishingAudioTrackRow[];
  exportJobs?: PublishingExportJobRow[];
  /**
   * ProjectSettings.subtitleDefaults, reduced to the two strings a safe area needs.
   * Optional so a source built before P7-5 stays readable; the checker reads a
   * missing row as "this project has no stored subtitle defaults" and says so.
   */
  subtitleDefaults?: PublishingSubtitleDefaultsRow | null;
  /** A caller-supplied slot — the ONLY value that does not come from a row. */
  request?: { callToAction?: string | null };
}

/** The derivation timestamp, plus the fingerprint of the rows above. */
export interface PublishingOrigin {
  derivedAt: string;
  sourceFingerprint: string;
}

/** A named, honest grouping of values. */
export interface NamedNote {
  id: string;
  note: string;
}

export type PublishingField<T> = Field<T>;
