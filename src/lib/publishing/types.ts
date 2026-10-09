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
  licensing: PublishingLicensingRow | null;
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
