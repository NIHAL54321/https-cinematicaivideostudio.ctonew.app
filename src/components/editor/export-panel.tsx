"use client";
/**
 * Phase 6 Blocks 2 & 4 — the EXPORT & FINISHING panel (client).
 *
 * Everything rendered here is the export engine's own output, read from
 * `POST /api/studio/editor` — all six of its actions, in the engine's own order:
 * `listExportPresets` / `planExport` / `applyExportPreset` / `clearExportPreset`
 * (Block 1 & 2) and `planSidecars` / `checkPublishReadiness` (Block 3 engine,
 * rendered here in Block 4).
 *
 * Block 4 adds the finishing half, again as a pure renderer:
 *   - the FIVE sidecar deliverables as cards — file name or none, one of the
 *     engine's three content states (`exists` / `requires-generation` / `empty`),
 *     PARTIAL for a half-filled metadata slot with its missing fields NAMED, what
 *     would produce the slot (including the env var NAME when that is a provider,
 *     and nothing when it is not) and `produced: false`. Slots that carry real
 *     content show a genuine preview: the first cues with their timecodes for the
 *     SRT/WebVTT and the chapter block as it would be pasted into a description.
 *     The thumbnail slot reads "NO THUMBNAIL SELECTED" when the project holds no
 *     thumbnail — no placeholder image and no greyed fake.
 *   - the SIX publish targets as a readiness matrix — per target its verdict
 *     (`ready_with_warnings` / `not_ready` / `indeterminate`) and per rule a
 *     PASS / FAIL / UNKNOWN badge with the rule's own text, its basis and the
 *     project's ACTUAL value; a failed rule shows what it overshot by, and an
 *     UNKNOWN rule is rendered with a dashed outline and a question mark so it can
 *     never read as a soft yes. Provider-gated rules render the env var NAME(S) the
 *     ENGINE returned (derived from the provider registry — never a literal in
 *     this component); a capability with no provider slot prints NO name at all
 *     and says so, because a name nothing reads would be a false instruction.
 *
 * Every number and every badge below is a field of the engine's response — none
 * is derived, counted or guessed here. Both Block 4 actions are READ-ONLY (the
 * engine reports `persisted: false`, `changed: false`, `filesProduced: 0`), so
 * the panel claims nothing was written and says so on screen.
 *
 * Block 7 fixes the duration read-out — the panel's one number that could describe a
 * DIFFERENT request than the one it was about to send. The line under the duration
 * input now prints a duration only from a read taken at exactly the duration the
 * next request would carry, prints the ENGINE's own source with it, and before such
 * a read exists it says plainly that no estimate has been taken at this duration yet
 * rather than printing a stale `0 s` that reads as a measurement. The plan, estimate
 * and manifest are marked stale the same way. Pinned by
 * src/lib/export/__tests__/panel-contract.test.ts.
 *
 * Block 1 & 2 (unchanged): the eight delivery presets with
 * their real container, codec, resolution, frame rate, bitrate, audio and
 * loudness numbers and their SDR-or-HDR colour tag (standard, transfer, peak
 * nits, MaxCLL/MaxFALL and the H.273 code points), the size ESTIMATE with the
 * formula and the substitution shown, the deliverable manifest (the files that
 * WOULD be produced, with resolution, codec, container and estimated size), and
 * the persisted per-project preset choice with its read-back and idempotency.
 *
 * Honest by construction: no file exists. `filesProduced` is 0, `produced` is
 * false, and every "would be produced" line says so. Nothing here decodes,
 * encodes, muxes, tone-maps, uploads or writes a byte, and no size on screen is
 * a measurement of a real file. Real encoding needs a video-processing provider,
 * so the panel carries the engine's gate verbatim: `connected: false` and the
 * env var NAME(S) the engine derived for `video_enhancement` — the registry
 * names `REPLICATE_API_TOKEN` / `RUNWAY_API_KEY` (names only — never values).
 *
 * It lives in its own file, and is mounted by the existing Phase 1
 * /export-center route (src/app/(app)/export-center/page.tsx) so there is ONE
 * export surface. It uses the same component kit and visual language as
 * AutoEditorPanel / PacingPanel / ColorGradingPanel / RepurposePanel /
 * FramingPanel.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  Captions,
  Check,
  CircleQuestionMark,
  CircleSlash,
  Clock,
  CloudUpload,
  FileText,
  Film,
  HardDriveDownload,
  Hash,
  ImageOff,
  Info,
  ListChecks,
  Loader2,
  Lock,
  PackageOpen,
  RefreshCw,
  Ruler,
  Send,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { Badge, Button, Card, Label } from "@/components/ui";
import { ProviderNotConnected } from "@/components/provider-not-connected";

/* ------------------------------------------------------------------ */
/* Response shapes — verbatim mirrors of src/lib/export                */
/* ------------------------------------------------------------------ */

/** The size arithmetic exactly as `estimateSize` returns it (sizing.ts). */
export interface SizeEstimateView {
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  totalBitrateKbps: number;
  durationSeconds: number;
  durationMinutes: number;
  durationHuman: string;
  bits: number;
  bytes: number;
  kilobytes: number;
  megabytes: number;
  mebibytes: number;
  gibibytes: number;
  human: string;
  formula: string;
  formulaUnits: string;
  substituted: string;
  units: { bitrate: string; duration: string; size: string };
  excludes: string[];
  estimate: true;
  produced: false;
}

/** The colour tagging the container would carry (ColourTag in presets.ts). */
export interface ColourTagView {
  display: "SDR" | "HDR";
  standard: string;
  transfer: string;
  peakNits: number;
  referenceWhiteNits: number;
  maxCLL: number | null;
  maxFALL: number | null;
  h273: {
    colourPrimaries: number;
    primariesName: string;
    transferCharacteristics: number;
    transferName: string;
    matrixCoefficients: number;
    matrixName: string;
  };
  masteringDisplay: { maxNits: number; minNits: number } | null;
  master: { bitDepth: number; chromaSubsampling: string };
  delivery: { bitDepth: number; chromaSubsampling: string };
  note: string;
}

/** One delivery preset exactly as `listExportPresets` returns it. */
export interface ExportPresetView {
  id: string;
  label: string;
  platform: string;
  formatId: string;
  aspect: string;
  aspectValue: number;
  widthPx: number;
  heightPx: number;
  resolution: string;
  container: string;
  video: {
    codec: string;
    codecFamily: string;
    profile: string;
    level: string | null;
    pixelFormat: string;
    frameRate: number;
    frameRateBasis: string;
    bitrateKbps: number;
    maxBitrateKbps: number | null;
    rateControl: { mode: string; crf: number | null; basis: string };
  };
  audio: {
    codec: string;
    sampleRateHz: number;
    channels: number;
    channelLayout: string;
    bitrateKbps: number;
    loudnessTargetLufs: number;
    truePeakDbfs: number;
    loudnessBasis: string;
    bitrateBasis: string;
  };
  colour: ColourTagView;
  subtitleTrack: { included: false; container: string; note: string };
  deliveryNotes: string[];
}

/** One per-preset size estimate (the catalogue's `estimates[]` rows). */
export interface ExportEstimateView {
  presetId: string;
  resolution: string;
  videoBitrateKbps: number;
  audioBitrateKbps: number;
  estimatedSize: SizeEstimateView;
}

/** One file the manifest says WOULD be produced. */
export interface ManifestOutputView {
  presetId: string;
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
  estimatedSize: SizeEstimateView;
}

export interface DeliverableManifestView {
  format: string;
  version: number;
  projectId: string;
  projectTitle: string | null;
  durationSeconds: number;
  durationHuman: string;
  durationSource: string;
  outputs: ManifestOutputView[];
  fileCount: number;
  totalEstimatedBytes: number;
  totalEstimatedHuman: string;
  filesProduced: 0;
  produced: false;
  formula: string;
  notProduced: string[];
  note: string;
}

export interface ExportAssignmentView {
  applied: boolean;
  count: number;
  presetIds: string[];
  appliedAt: string | null;
}

export interface ExportSizeModelView {
  formula: string;
  units: string;
  excludes: string[];
  estimate: true;
  produced: false;
  note: string;
}

/** The honest provider gate the API attaches (env var NAMES, never values). */
export interface ProviderGateView {
  capability: string;
  connected: boolean;
  requiredEnv: string[];
  envHint: string | null;
  note: string;
}

export interface ExportDurationView {
  seconds: number;
  human?: string | null;
  source: string;
  note?: string;
}

/* ------------------------------------------------------------------ */
/* Block 3/4 shapes — verbatim mirrors of ./sidecars and ./readiness   */
/* ------------------------------------------------------------------ */

/** The engine's three content states. Nothing else is ever rendered. */
export type SidecarContentStateView = "exists" | "requires-generation" | "empty";

/** One sidecar deliverable exactly as `planSidecars` returns it (sidecars.ts). */
export interface SidecarFileView {
  id: string;
  label: string;
  /** The file name that WOULD be written, or null when nothing exists to write. */
  fileName: string | null;
  mimeType: string;
  container: string;
  contentState: SidecarContentStateView;
  requires: string | null;
  /** The env var NAME a provider-backed generation needs, or null when no provider is involved. */
  requiresEnv: string | null;
  /** The rendered content, when it exists and fits the response. */
  content: string | null;
  bytes: number | null;
  truncated: boolean;
  /** This is a specification. Nothing was written. */
  produced: false;
  detail: Record<string, unknown>;
  note: string;
}

export interface SidecarMetadataCheckView {
  targetId: string;
  label: string;
  field: string;
  value: number | null;
  max: number | null;
  status: "pass" | "fail" | "unknown" | "absent";
  basis: string;
}

export interface SidecarManifestView {
  format: string;
  version: number;
  projectId: string;
  projectTitle: string | null;
  slug: string;
  durationSeconds: number;
  files: SidecarFileView[];
  fileCount: number;
  counts: { exists: number; requiresGeneration: number; empty: number };
  subtitles: {
    cueCount: number;
    hasCues: boolean;
    cueSource: string;
    totalCueDurationMs: number;
    totalCueDurationHuman: string;
    srtBytes: number;
    vttBytes: number;
    timecode: { srt: string; vtt: string; chapters: string };
    note: string;
  };
  chapters: {
    count: number;
    beatCount: number;
    block: string;
    firstStartsAtZero: boolean;
    meetsYoutubeRequirements: boolean;
    blockers: string[];
    rules: { minChapterSeconds: number; minChapterCount: number; basis: string; mergePolicy: string; timecodeBasis: string };
    note: string;
  };
  metadata: {
    title: string | null;
    description: string | null;
    tags: string[] | null;
    hashtags: string[];
    counts: { titleChars: number | null; descriptionChars: number | null; tagCount: number | null; tagChars: number | null };
    sources: { title: string; description: string; tags: string };
    limits: { targetId: string; label: string; aspect: string; limits: Record<string, unknown> }[];
    checks: SidecarMetadataCheckView[];
    bytes: number;
    note: string;
  };
  /** The project's own thumbnail selection, exactly as the engine reported it. */
  thumbnail: {
    selected?: boolean;
    assetId?: string | null;
    name?: string | null;
    widthPx?: number | null;
    heightPx?: number | null;
    status?: string | null;
  };
  filesProduced: 0;
  produced: false;
  notProduced: string[];
  note: string;
}

/** The honest gate a provider-dependent rule carries (env var NAMES only). */
export interface RuleGateView {
  capability: string;
  connected: boolean;
  requiredEnv: string[];
  envHint: string | null;
  note: string;
}

/** One rule exactly as `checkPublishReadiness` returns it (readiness.ts). */
export interface ReadinessRuleView {
  id: string;
  label: string;
  rule: string;
  basis: string;
  severity: "required" | "recommended";
  status: "pass" | "fail" | "unknown";
  /** The project's ACTUAL value for this rule, as text. */
  actual: string;
  detail: string;
  gate?: RuleGateView;
}

export interface PublishTargetReportView {
  targetId: string;
  label: string;
  platform: string;
  aspect: string;
  resolution: string;
  requiredPresetIds: string[];
  rules: ReadinessRuleView[];
  counts: { pass: number; fail: number; unknown: number; total: number };
  blockingFailures: string[];
  unknownRequired: string[];
  warnings: string[];
  verdict: "ready" | "ready_with_warnings" | "not_ready" | "indeterminate";
  notes: string[];
}

/** Counts of RULES — the engine states explicitly that this is not a score. */
export interface ReadinessSummaryView {
  targetCount: number;
  ready: number;
  readyWithWarnings: number;
  notReady: number;
  indeterminate: number;
  blocking: { targetId: string; rules: string[] }[];
  unknownRequired: { targetId: string; rules: string[] }[];
  warnings: { targetId: string; rules: string[] }[];
  note: string;
}

/** Block 5 — one state in the declared state model (`EXPORT_JOB_STATES`). */
export interface ExportJobStateView {
  state: string;
  label: string;
  terminal?: boolean;
  /**
   * STATIC: true when the state exists only while a provider is configured AND
   * wired for video_enhancement. Whether such a provider exists here is not this
   * flag's business — `states.connectivity` below reports the live answer, and
   * the server DERIVES the reachable/unreachable split from it. (Fixed
   * 2026-10-09: the split used to be hard-coded and told a keyed server it had
   * no key, contradicting /api/ai/status.)
   */
  requiresConnectedProvider?: boolean;
  /** What the state means, in the engine's words. */
  means?: string;
  /**
   * Why a state the server cannot reach is unreachable. The NAME is the engine's
   * wire name: `stateModelView()` (src/lib/export/job-service.ts) serialises the
   * live reason as `reason` on each `states.unreachable[]` entry.
   * Reading any other name renders "no reason reported" for a reason the engine
   * did report — proven in a browser on 2026-10-03 before this was corrected.
   */
  reason?: string | null;
}
/**
 * Block 5 — the live facts the reachable/unreachable split was derived from: the
 * capability's own status string and which provider slots are configured AND
 * wired. Carries provider ids only, never a key value.
 */
export interface ExportJobStateConnectivityView {
  capability: string;
  status: "connected" | "not_connected";
  connectedProviders: string[];
  candidateProviders: string[];
  note: string;
}
/** Block 5 — the state model as the response reports it; the split is derived. */
export interface ExportJobStatesView {
  reachable: ExportJobStateView[];
  unreachable: ExportJobStateView[];
  /** The fields only a provider could ever fill (null today). */
  providerOnlyFields: string[];
  /** Live connectivity the split was derived from (added 2026-10-09). */
  connectivity?: ExportJobStateConnectivityView;
  note: string;
}
/** Block 5 — the snapshot regime: what the snapshot is OF, and that it is frozen. */
export interface ExportJobSnapshotRegimeView {
  kind: string;
  immutable: boolean;
  of: string[];
  note: string;
}
/** Block 5 — one output inside a job snapshot (a SPEC, not a produced file). */
export interface ExportJobOutputView {
  presetId: string;
  label?: string;
  platform?: string;
  fileName: string;
  resolution: string;
  aspect?: string;
  container: string;
  video: { codec: string; profile: string; level: string; frameRate: number; bitrateKbps: number };
  audio: { codec: string; sampleRateHz: number; channelLayout: string; bitrateKbps: number; loudnessTargetLufs: number };
  estimatedSize: { bytes: number; human: string };
}
/** Block 5 — one sidecar slot inside a job snapshot. */
export interface ExportJobSidecarView {
  id: string;
  label: string;
  fileName: string | null;
  contentState: string;
  bytes: number | null;
  requires?: string | null;
  /** Env var NAME(S) any missing content would need, or null when none would. */
  requiresEnv?: string | null;
}
/** Block 5 — one publish-readiness verdict as it stood at snapshot time. */
export interface ExportJobReadinessView {
  targetId: string;
  label: string;
  platform?: string;
  verdict: string;
  counts: { pass: number; fail: number; unknown: number; total: number };
}
/** Block 5 — the stored request snapshot. */
export interface ExportJobSnapshotView {
  format?: string;
  version?: number;
  kind?: string;
  projectId?: string;
  projectTitle?: string | null;
  capturedAt: string;
  presetAssignment: { applied: boolean; count: number; presetIds: string[]; appliedAt?: string | null };
  duration: { seconds: number; human: string | null; source: string; note?: string };
  outputs: ExportJobOutputView[];
  sidecars: ExportJobSidecarView[];
  sidecarCounts?: Record<string, number>;
  readiness: ExportJobReadinessView[];
  cueCount: number;
  of?: string[];
  note?: string;
}
/** Block 5 — one job, whole, as `createExportJob` / `getExportJob` return it. */
export interface ExportJobDetailView {
  jobId: string;
  projectId?: string;
  state: string;
  stateLabel: string;
  createdAt: string;
  updatedAt?: string;
  requestKey?: string;
  snapshot: ExportJobSnapshotView;
  /** The REAL request handed to the AI Model Orchestrator, verbatim. */
  routerRequest: Record<string, unknown>;
  router: { status: string; error: string | null; requiredEnv?: string[] | null; provider?: string | null };
  statusHistory: { at: string; event: string; state: string; detail: string }[];
  droppedHistoryEntries?: number;
  filesProduced: number;
  progress: number | null;
  percentComplete: number | null;
  etaSeconds: number | null;
  completedAt: string | null;
  outputUrl: string | null;
  outputBytes: number | null;
  note?: string;
}
/** Block 5 — one summary row in `listExportJobs` (summaries only, no snapshot). */
export interface ExportJobSummaryView {
  jobId: string;
  projectId?: string;
  state: string;
  stateLabel: string;
  createdAt: string;
  updatedAt?: string;
  requestKey?: string;
  snapshotCapturedAt?: string;
  presetIds: string[];
  durationSeconds: number | null;
  durationSource: string | null;
  outputCount: number;
  estimatedTotalBytes: number | null;
  cueCount?: number;
  routerStatus: string | null;
  routerRequiredEnv?: string[] | null;
  historyCount?: number;
  lastHistoryEntry?: { at: string; event: string; state: string; detail: string } | null;
  filesProduced: number;
  progress: number | null;
  percentComplete: number | null;
  completedAt: string | null;
}
/** Block 5 — the job counts, including the two states nothing can be in today. */
export interface ExportJobCountsView {
  jobCount: number;
  blocked: number;
  queued: number;
  handedOff: number;
  providerFailed: number;
  filesProduced: number;
}

/** The Block 1 envelope — the shape the HTTP client really sees. */
export interface ExportResponse {
  action?: string;
  projectId?: string;
  projectTitle?: string;
  count?: number;
  presets?: ExportPresetView[];
  assignment?: ExportAssignmentView;
  appliedPresets?: ExportPresetView[];
  duration?: ExportDurationView;
  estimates?: ExportEstimateView[];
  sizeModel?: ExportSizeModelView;
  provider?: ProviderGateView;
  manifest?: DeliverableManifestView | null;
  presetIds?: string[];
  applied?: ExportPresetView[];
  previous?: ExportAssignmentView;
  changed?: boolean;
  persisted?: boolean;
  changelist?: string[];
  note?: string;
  unreadable?: boolean;
  droppedPresets?: string[];
  plan?: Record<string, unknown>;
  /** Block 3/4 — `planSidecars` (read-only, nothing written). */
  sidecars?: SidecarManifestView | null;
  timelineSource?: string;
  timelineDurationMs?: number;
  sceneCount?: number;
  beatCount?: number;
  cueSource?: string;
  requiresGeneration?: { count: number; envNames: string[]; note: string };
  /** Block 3/4 — `checkPublishReadiness` (read-only, nothing written). */
  requestedTargets?: string[];
  targets?: PublishTargetReportView[];
  summary?: ReadinessSummaryView;
  sidecarSummary?: { cueCount: number; chapterCount: number; thumbnail: string };
  /** Block 5 — the export JOB handoff (`createExportJob`/`listExportJobs`/`getExportJob`). */
  created?: boolean;
  deduplicated?: boolean;
  dedupe?: { key: string; basis: string; note: string };
  job?: ExportJobDetailView;
  jobs?: ExportJobSummaryView[];
  jobCounts?: ExportJobCountsView;
  counts?: ExportJobCountsView;
  state?: string;
  stateInfo?: ExportJobStateView | null;
  states?: ExportJobStatesView;
  snapshot?: ExportJobSnapshotView;
  snapshotRegime?: ExportJobSnapshotRegimeView;
  routerRequest?: Record<string, unknown>;
  router?: { status: string; error: string | null; requiredEnv?: string[] | null; provider?: string | null };
  statusHistory?: { at: string; event: string; state: string; detail: string }[];
  /** The fields the engine reports as null because only a provider could fill them. */
  progress?: number | null;
  percentComplete?: number | null;
  etaSeconds?: number | null;
  completedAt?: string | null;
  outputUrl?: string | null;
  outputBytes?: number | null;
  filesProduced?: number;
  envHint?: string | null;
  requiredEnv?: string[];
  envNote?: string;
  error?: string;
  code?: string;
}

/**
 * Every action the panel can post — the engine's own NINE, in the engine's own
 * order: the six finishing actions (Block 1/2/3/4: `listExportPresets`,
 * `planExport`, `applyExportPreset`, `clearExportPreset` from `EXPORT_ACTIONS` in
 * src/lib/export/service.ts, then `planSidecars`, `checkPublishReadiness`) and the
 * three export-JOB handoff actions `createExportJob`, `listExportJobs`,
 * `getExportJob` from `EXPORT_JOB_ACTIONS` in src/lib/export/jobs.ts — which is
 * also the order the editor surface advertises them in
 * (`EDITOR_ACTIONS`, src/lib/editor/service.ts). Asserted by
 * src/lib/export/__tests__/panel-contract.test.ts, so the UI can never advertise
 * an action the engine would reject with `unknown_action`.
 */
export const EXPORT_PANEL_ACTIONS = [
  "listExportPresets",
  "planExport",
  "applyExportPreset",
  "clearExportPreset",
  "planSidecars",
  "checkPublishReadiness",
  "createExportJob",
  "listExportJobs",
  "getExportJob",
] as const;
export type ExportPanelAction = (typeof EXPORT_PANEL_ACTIONS)[number];

/**
 * The six publish targets the readiness engine can report, in the engine's own
 * canonical order (`PUBLISH_TARGET_IDS` in src/lib/export/readiness.ts). The
 * panel renders these ids and their labels; the VERDICTS and every rule come from
 * the engine's response only.
 */
export const PUBLISH_TARGET_VIEWS: { id: string; label: string }[] = [
  { id: "youtube-long-form", label: "YouTube long-form" },
  { id: "youtube-shorts", label: "YouTube Shorts" },
  { id: "instagram-reels", label: "Instagram Reels" },
  { id: "tiktok", label: "TikTok" },
  { id: "square", label: "Square 1:1" },
  { id: "portrait", label: "Portrait 4:5" },
];

/** The rule-id → short label map used only to name blocking/unknown rules. */
function ruleLabels(report: PublishTargetReportView): Map<string, string> {
  return new Map(report.rules.map((r) => [r.id, r.label]));
}

/**
 * The Block 1 engine caps an export at 120 minutes and 12 outputs; the catalogue
 * is 8. The panel states the same limits the engine enforces (never its own).
 */
const MAX_DURATION_SECONDS = 7200;

/* ------------------------------------------------------------------ */
/* Block 7 — the duration the REQUEST carries, and the read-out of the  */
/* read on screen. ONE derivation, ONE gate, no stale number.          */
/* ------------------------------------------------------------------ */

/**
 * The ONE place this panel decides which duration a request carries. Every action
 * that can carry one (`listExportPresets`, `planExport`, `applyExportPreset`,
 * `clearExportPreset`, `createExportJob`) posts `durationSeconds` from this
 * function and from nowhere else — so the number in the payload and the number the
 * read-out below compares itself against cannot be derived two different ways.
 *
 * `null` means the panel omits `durationSeconds` entirely. The ENGINE then resolves
 * the duration from its own sources, in its own order (a duration in the request →
 * the saved editor timeline → the sum of the scene durations), and reports both the
 * number it resolved and the source it resolved it from; this panel never guesses
 * which of them it will be.
 */
export function requestDurationSeconds(durationInput: string): number | null {
  const seconds = Number(durationInput);
  if (durationInput.trim() === "" || !Number.isFinite(seconds) || seconds <= 0) return null;
  return seconds;
}

/**
 * The states the read-out can be in. `resolved` is the ONLY one that prints a
 * duration, and it prints one only when the read on screen was taken at exactly the
 * duration the next request would carry.
 */
export type DurationReadOutState = "not-read" | "read-at-another-duration" | "no-duration" | "resolved";

export interface DurationReadOut {
  state: DurationReadOutState;
  /** The line, exactly as it is rendered under the duration input. */
  text: string;
  /** The duration this line prints, or null when it prints no duration at all. */
  seconds: number | null;
}

export interface DurationReadOutInput {
  /** What the NEXT request would carry: `requestDurationSeconds(durationInput)`. */
  requestSeconds: number | null;
  /** The duration the read on screen was taken at (null = that request carried none). */
  readAtSeconds: number | null;
  /** The engine's OWN duration report from that read (`response.duration`). */
  reported: { seconds: number; human?: string | null; source: string; note?: string } | null;
}

/** The sentence every "this read is not for this duration" case starts with. */
export const NO_ESTIMATE_AT_THIS_DURATION = "no estimate has been taken at this duration yet";

/**
 * The read-out under the duration input — the line this block exists to fix.
 *
 * The defect it replaces (reproduced in a browser on 2026-10-04): the line printed
 * `duration <n> s · source: <s>` whenever the LAST RESPONSE carried a `duration`,
 * with no check that the response had been taken at the duration the request was
 * about to carry. A catalogue read taken with a blank input reports
 * `seconds: 0, source: "none"`, so typing 180 and pressing "Request export" showed
 *
 *     duration 0 s · source: none — No duration is available: …
 *
 * while the request itself (and the job snapshot it created) carried 180 s
 * (`source: request`). A number the engine had reported about a DIFFERENT request
 * was rendered as if it described this one.
 *
 * The rule now: a duration is printed only from a read taken at exactly the duration
 * the next request would carry, and it is the ENGINE's number with the ENGINE's
 * source — never a value this component derived. A duration of zero is never printed
 * as a measurement either; it is reported as what it is (the engine resolved none),
 * and before any read carries a duration the line says plainly that no estimate has
 * been taken at this duration yet.
 */
export function durationReadOut(input: DurationReadOutInput): DurationReadOut {
  const { requestSeconds, readAtSeconds, reported } = input;
  const next =
    requestSeconds === null
      ? "the next request would carry no duration, and the engine would resolve one from its own sources"
      : `the next request would carry the ${requestSeconds} s typed above`;
  const press = 'press "Estimate at this duration" and this line will show the duration the engine resolves, with its source';

  if (!reported) {
    return {
      state: "not-read",
      text: `no estimate has been taken yet — no duration has been read back for this project. ${next}; ${press}.`,
      seconds: null,
    };
  }
  if (readAtSeconds !== requestSeconds) {
    return {
      state: "read-at-another-duration",
      text: `${NO_ESTIMATE_AT_THIS_DURATION} — the read on screen was taken at a different duration, so no duration is printed from it. ${next}; ${press}.`,
      seconds: null,
    };
  }
  if (!(reported.seconds > 0)) {
    return {
      state: "no-duration",
      text: `no duration is available — the engine resolved none at this request (source: ${reported.source}).${
        reported.note ? ` ${reported.note}` : ""
      }`,
      seconds: null,
    };
  }
  return {
    state: "resolved",
    text:
      `duration ${reported.seconds} s${reported.human ? ` (${reported.human})` : ""} · source: ${reported.source}` +
      (reported.note ? ` — ${reported.note}` : ""),
    seconds: reported.seconds,
  };
}


/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

async function postEditor(payload: Record<string, unknown>): Promise<ExportResponse> {
  const res = await fetch("/api/studio/editor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let body: ExportResponse = {};
  try {
    body = (await res.json()) as ExportResponse;
  } catch {
    body = {};
  }
  if (!res.ok) {
    const message = typeof body.error === "string" ? body.error : `Request failed (${res.status})`;
    throw Object.assign(new Error(message), { status: res.status, code: body.code });
  }
  return body;
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

function int(n: number): string {
  return n.toLocaleString("en-US");
}

function mbit(kbps: number): string {
  return `${kbps / 1000} Mbps`;
}

/** `Rec.709 / BT.1886 / 100 nits / H.273 1 1 1` — one line per colour tag. */
function colourTagLine(c: ColourTagView): string {
  const cll = c.maxCLL !== null ? ` · maxCLL ${c.maxCLL} · maxFALL ${c.maxFALL}` : "";
  return (
    `${c.display} · ${c.standard} / ${c.transfer} / ${c.peakNits} nits` +
    cll +
    ` · H.273 ${c.h273.colourPrimaries} ${c.h273.transferCharacteristics} ${c.h273.matrixCoefficients}` +
    ` (${c.h273.primariesName} / ${c.h273.transferName} / ${c.h273.matrixName})`
  );
}

function ExportMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-line/70 bg-panel-2/50 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-0.5 font-mono text-[11px] text-ink-dim">{value}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* One preset card — every number is the engine's, none is derived     */
/* ------------------------------------------------------------------ */

function PresetCard({
  preset,
  selected,
  applied,
  estimate,
  busy,
  onToggle,
}: {
  preset: ExportPresetView;
  selected: boolean;
  applied: boolean;
  estimate: ExportEstimateView | null;
  busy: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      disabled={busy}
      onClick={onToggle}
      data-testid={`export-preset-${preset.id}`}
      aria-pressed={selected}
      className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
        selected ? "border-accent-line bg-accent-soft text-ink" : "border-line bg-panel-2/50 text-ink-dim hover:text-ink"
      }`}
    >
      <span className="flex items-center gap-1.5">
        <span className="font-mono text-[11px]">{preset.aspect}</span>
        {selected ? <Check size={11} /> : null}
        {applied ? <Badge tone="ok">applied</Badge> : null}
        <span className="ml-auto font-mono text-[10px] text-ink-faint">{preset.id}</span>
      </span>
      <span className="mt-0.5 block text-[11px] font-medium text-ink">{preset.label}</span>
      <span className="mt-0.5 block text-[10px] text-ink-faint">{preset.platform}</span>
      <span className="mt-1 block font-mono text-[10px] text-ink-dim">
        {preset.resolution} · {preset.container} · {preset.video.codec}
      </span>
      <span className="mt-0.5 block font-mono text-[10px] text-ink-faint">
        {preset.video.frameRate} fps · {int(preset.video.bitrateKbps)} kbps ({mbit(preset.video.bitrateKbps)}) +{" "}
        {int(preset.audio.bitrateKbps)} kbps
      </span>
      <span className="mt-0.5 block font-mono text-[10px] text-ink-faint">
        {preset.audio.codec} {preset.audio.sampleRateHz} Hz {preset.audio.channelLayout} ·{" "}
        {preset.audio.loudnessTargetLufs} LUFS · {preset.audio.truePeakDbfs} dBTP
      </span>
      <span className="mt-0.5 block text-[10px] text-ink-faint">
        <Badge tone={preset.colour.display === "HDR" ? "accent" : "neutral"}>{preset.colour.display}</Badge>{" "}
        {preset.colour.standard} / {preset.colour.transfer} / {preset.colour.peakNits} nits
        {preset.colour.maxCLL !== null ? ` · CLL ${preset.colour.maxCLL}/${preset.colour.maxFALL}` : ""}
      </span>
      <span className="mt-1 block font-mono text-[10px] text-ink-faint" data-testid={`export-preset-estimate-${preset.id}`}>
        {estimate ? `estimate ≈ ${estimate.estimatedSize.human} (${int(estimate.estimatedSize.bytes)} bytes)` : "estimate needs a duration"}
      </span>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Block 4 — sidecar deliverables                                      */
/* ------------------------------------------------------------------ */

function asString(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v : null;
}

function asNumber(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * A GENUINE preview of a slot that carries real content: the first cue blocks of
 * the rendered SRT/WebVTT exactly as they are (timecodes include), the chapter
 * block as it would be pasted into a description, or the head of the metadata
 * JSON. Nothing is reformatted into a prettier shape and nothing is invented for
 * a slot the engine left empty.
 */
function previewOf(file: SidecarFileView): { text: string; caption: string } | null {
  const content = file.content;
  if (typeof content !== "string" || content.length === 0) return null;
  if (file.id === "subtitles-srt" || file.id === "subtitles-vtt") {
    const body = file.id === "subtitles-vtt" ? content.replace(/^WEBVTT[^\n]*\n+/, "") : content;
    const blocks = body
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter(Boolean);
    const shown = blocks.slice(0, 3).join("\n\n");
    const cueCount = asNumber(file.detail["cueCount"]) ?? blocks.length;
    return {
      text: shown,
      caption: `first ${Math.min(3, blocks.length)} of ${cueCount} cue(s), byte-for-byte as the sidecar would carry them (timecodes include)`,
    };
  }
  if (file.id === "chapters") {
    return { text: content, caption: "the whole block, exactly as it would be pasted into a video description" };
  }
  const head = content.slice(0, 700);
  return {
    text: head + (content.length > head.length ? "\n…" : ""),
    caption: `first ${head.length} of ${content.length} characters of the exact JSON the sidecar would carry${
      file.truncated ? " (the engine's own render was already truncated)" : ""
    }`,
  };
}

function SidecarCard({ file }: { file: SidecarFileView }) {
  const preview = previewOf(file);
  const partial = file.detail["partial"] === true;
  const missing = Array.isArray(file.detail["missingFields"])
    ? (file.detail["missingFields"] as unknown[]).map(String)
    : [];
  const stateTone = file.contentState === "exists" ? "ok" : file.contentState === "requires-generation" ? "accent" : "neutral";
  const noThumbnail = file.id === "thumbnail" && file.fileName === null;
  const thumbnailSelected = file.detail["selected"] === true;

  return (
    <li className="rounded-lg border border-line/70 bg-panel-2/40 p-2.5" data-testid={`export-sidecar-${file.id}`}>
      <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-ink">
        <span className="font-mono text-[10px] text-ink-faint">{file.id}</span>
        {file.label}
        <span className="ml-auto flex items-center gap-1.5">
          <span data-testid={`export-sidecar-state-${file.id}`}>
            <Badge tone={stateTone}>{file.contentState.toUpperCase()}</Badge>
          </span>
          {partial ? (
            <span
              data-testid={`export-sidecar-partial-${file.id}`}
              className="inline-flex items-center gap-1 rounded-full border border-dashed border-accent-line bg-accent-soft px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent"
            >
              <AlertTriangle size={10} /> PARTIAL
            </span>
          ) : null}
          <span data-testid={`export-sidecar-produced-${file.id}`} className="text-[10px] uppercase tracking-wider text-ink-faint">
            produced {String(file.produced)}
          </span>
        </span>
      </p>

      <p className="mt-1 font-mono text-[10px] text-ink-dim" data-testid={`export-sidecar-file-${file.id}`}>
        {file.fileName ? file.fileName : "no file name — nothing exists to write"}
        {file.bytes !== null ? ` · ${int(file.bytes)} bytes` : ""}
        {file.truncated ? " · render truncated in the response" : ""}
      </p>
      <p className="mt-0.5 text-[10px] text-ink-faint">
        {file.mimeType} · {file.container}
      </p>

      {noThumbnail ? (
        <div
          className="mt-2 flex items-center gap-2 rounded border border-dashed border-line bg-void/40 px-2.5 py-2"
          data-testid="export-sidecar-thumbnail-none"
        >
          <ImageOff size={14} className="shrink-0 text-ink-faint" />
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-dim">NO THUMBNAIL SELECTED</p>
        </div>
      ) : null}
      {file.id === "thumbnail" && thumbnailSelected ? (
        <p className="mt-2 text-[10px] text-ink-dim" data-testid="export-sidecar-thumbnail-selected">
          the project&apos;s own asset would be delivered: {asString(file.detail["name"]) ?? "unnamed asset"}
          {asNumber(file.detail["widthPx"]) !== null && asNumber(file.detail["heightPx"]) !== null
            ? ` (${file.detail["widthPx"]}×${file.detail["heightPx"]}, status ${asString(file.detail["status"]) ?? "unknown"})`
            : ""}
        </p>
      ) : null}

      <p className="mt-2 text-[10px] text-ink-faint">
        <span className="uppercase tracking-wider">what would produce it:</span>{" "}
        {file.requires ? (
          file.requires
        ) : (
          <span className="text-ink-dim">nothing — the content above already exists in the project</span>
        )}
      </p>
      {file.requiresEnv ? (
        <p className="mt-0.5 text-[10px] text-ink-faint" data-testid={`export-sidecar-env-${file.id}`}>
          needs the server-side env var <span className="font-mono text-accent">{file.requiresEnv}</span> (name only, never a
          value) or a user-supplied asset.
        </p>
      ) : (
        <p className="mt-0.5 text-[10px] text-ink-faint" data-testid={`export-sidecar-env-${file.id}`}>
          no provider env var is involved for this slot.
        </p>
      )}
      {partial ? (
        <p className="mt-1 text-[10px] text-accent" data-testid={`export-sidecar-missing-${file.id}`}>
          missing field(s) the project does not hold: <span className="font-mono">{missing.join(", ") || "none"}</span> — reported
          as PARTIAL rather than rounded up to &quot;exists&quot;.
        </p>
      ) : null}

      {preview ? (
        <div className="mt-2" data-testid={`export-sidecar-preview-${file.id}`}>
          <p className="text-[10px] uppercase tracking-wider text-ink-faint">content preview</p>
          <pre className="mt-1 max-h-40 overflow-auto rounded border border-line/70 bg-void/60 p-2 font-mono text-[10px] leading-relaxed text-ink-dim">
            {preview.text}
          </pre>
          <p className="mt-1 text-[10px] text-ink-faint">{preview.caption}</p>
        </div>
      ) : (
        <p className="mt-2 text-[10px] text-ink-faint" data-testid={`export-sidecar-preview-${file.id}`}>
          no content to preview — the slot carries nothing.
        </p>
      )}

      <p className="mt-2 text-[10px] text-ink-faint">{file.note}</p>
    </li>
  );
}

function SidecarSection({ response, busy, onRun }: { response: ExportResponse | null; busy: boolean; onRun: () => void }) {
  const sidecars = response?.sidecars ?? null;
  return (
    <div className="rounded-lg border border-line bg-panel-3/40 p-2.5" data-testid="export-sidecars">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          <Captions size={12} /> Sidecar deliverables
          {sidecars ? (
            <>
              <Badge tone="ok">{sidecars.counts.exists} exists</Badge>
              <Badge tone="accent">{sidecars.counts.requiresGeneration} require generation</Badge>
              <Badge tone="neutral">{sidecars.counts.empty} empty</Badge>
              <Badge tone="danger">filesProduced {sidecars.filesProduced}</Badge>
            </>
          ) : null}
        </p>
        <Button size="sm" variant="outline" disabled={busy} onClick={onRun} data-testid="export-sidecars-run">
          {busy ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />} Plan sidecars
        </Button>
      </div>

      {!sidecars ? (
        <p className="mt-2 text-[11px] text-ink-faint" data-testid="export-sidecars-empty">
          No sidecar plan read yet. Nothing is persisted on the server — a reload or a project switch starts empty, and re-running
          reads the project&apos;s data again. This action never writes a file.
        </p>
      ) : (
        <>
          <p className="mt-2 text-[11px] text-ink-faint" data-testid="export-sidecars-note">
            {sidecars.note}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-faint">
            <Badge tone="neutral">read-only</Badge>
            <span data-testid="export-sidecars-readonly">
              persisted {String(response?.persisted ?? false)} · changed {String(response?.changed ?? false)} · written{" "}
              {String((response?.plan ?? {})["written"] ?? false)} · produced {String(sidecars.produced)}
            </span>
            <span className="font-mono">{sidecars.format} v{sidecars.version}</span>
            <span className="font-mono">duration {sidecars.durationSeconds} s</span>
          </p>
          <ul className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-2" data-testid="export-sidecar-grid">
            {sidecars.files.map((f) => (
              <SidecarCard key={f.id} file={f} />
            ))}
          </ul>

          <div className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-2">
            <div className="rounded border border-line/70 bg-panel-2/40 p-2" data-testid="export-sidecar-subtitles">
              <p className="text-[10px] uppercase tracking-wider text-ink-faint">Subtitle sidecars — the cue data behind both files</p>
              <p className="mt-1 font-mono text-[10px] text-ink-dim">
                {sidecars.subtitles.cueCount} cue(s) · {sidecars.subtitles.totalCueDurationHuman} of cue time · SRT{" "}
                {int(sidecars.subtitles.srtBytes)} bytes ({sidecars.subtitles.timecode.srt}) · VTT{" "}
                {int(sidecars.subtitles.vttBytes)} bytes ({sidecars.subtitles.timecode.vtt})
              </p>
              <p className="mt-1 text-[10px] text-ink-faint">cue source: {sidecars.subtitles.cueSource}</p>
            </div>
            <div className="rounded border border-line/70 bg-panel-2/40 p-2" data-testid="export-sidecar-chapters">
              <p className="text-[10px] uppercase tracking-wider text-ink-faint">Chapter markers — the rule they answer to</p>
              <p className="mt-1 font-mono text-[10px] text-ink-dim">
                {sidecars.chapters.count} chapter(s) from {sidecars.chapters.beatCount} scene beat(s) · first starts at zero{" "}
                {String(sidecars.chapters.firstStartsAtZero)} · published requirements met{" "}
                {String(sidecars.chapters.meetsYoutubeRequirements)}
              </p>
              <p className="mt-1 text-[10px] text-ink-faint">
                at least {sidecars.chapters.rules.minChapterCount} chapters of at least {sidecars.chapters.rules.minChapterSeconds}{" "}
                s each, timecodes {sidecars.chapters.rules.timecodeBasis}
              </p>
              {(sidecars.chapters.blockers ?? []).length > 0 ? (
                <ul className="mt-1 space-y-0.5" data-testid="export-sidecar-chapter-blockers">
                  {sidecars.chapters.blockers.map((b) => (
                    <li key={b} className="text-[10px] text-danger">
                      · blocker: {b}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>

          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            Not produced by this plan
          </p>
          <ul className="mt-1 space-y-0.5" data-testid="export-sidecars-not-produced">
            {sidecars.notProduced.map((n) => (
              <li key={n} className="text-[10px] text-ink-faint">
                · {n}
              </li>
            ))}
          </ul>
          {response?.requiresGeneration && response.requiresGeneration.envNames.length > 0 ? (
            <p className="mt-1 text-[10px] text-ink-faint" data-testid="export-sidecars-env-names">
              slots needing generation name{" "}
              <span className="font-mono text-accent">{response.requiresGeneration.envNames.join(", ")}</span> —{" "}
              {response.requiresGeneration.note}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Block 4 — publish readiness                                         */
/* ------------------------------------------------------------------ */

function RuleStatusBadge({ rule }: { rule: ReadinessRuleView }) {
  if (rule.status === "pass") {
    return (
      <span data-testid={`export-rule-status-${rule.id}`} data-rule-status="pass">
        <Badge tone="ok">PASS</Badge>
      </span>
    );
  }
  if (rule.status === "fail") {
    return (
      <span data-testid={`export-rule-status-${rule.id}`} data-rule-status="fail">
        <Badge tone="danger">
          <span className="inline-flex items-center gap-1">
            <ShieldAlert size={10} /> FAIL
          </span>
        </Badge>
      </span>
    );
  }
  // UNKNOWN is deliberately NOT a green badge and not a neutral one either: a
  // dashed outline, a question mark and the bare word, so it can never read as a
  // soft yes.
  return (
    <span
      data-testid={`export-rule-status-${rule.id}`}
      data-rule-status="unknown"
      className="inline-flex items-center gap-1 rounded-full border border-dashed border-info/70 bg-transparent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-info"
    >
      <CircleQuestionMark size={10} /> UNKNOWN
    </span>
  );
}

function VerdictBadge({ targetId, verdict }: { targetId: string; verdict: PublishTargetReportView["verdict"] }) {
  if (verdict === "indeterminate") {
    return (
      <span
        data-testid={`export-verdict-${targetId}`}
        data-verdict={verdict}
        className="inline-flex items-center gap-1 rounded-full border border-dashed border-info/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-info"
      >
        <CircleQuestionMark size={10} /> INDETERMINATE
      </span>
    );
  }
  const tone = verdict === "ready" ? "ok" : verdict === "ready_with_warnings" ? "accent" : "danger";
  return (
    <span data-testid={`export-verdict-${targetId}`} data-verdict={verdict}>
      <Badge tone={tone}>{verdict.replace(/_/g, " ").toUpperCase()}</Badge>
    </span>
  );
}

function TargetReportCard({ report }: { report: PublishTargetReportView }) {
  const labels = ruleLabels(report);
  const name = (id: string) => labels.get(id) ?? id;
  return (
    <li className="rounded-lg border border-line/70 bg-panel-2/40 p-2.5" data-testid={`export-readiness-${report.targetId}`}>
      <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-medium text-ink">
        {report.label}
        <span className="font-mono text-[10px] text-ink-faint">{report.targetId}</span>
        <span className="ml-auto">
          <VerdictBadge targetId={report.targetId} verdict={report.verdict} />
        </span>
      </p>
      <p className="mt-0.5 font-mono text-[10px] text-ink-faint">
        {report.platform} · {report.aspect} · {report.resolution} · presets {report.requiredPresetIds.join(", ") || "none"}
      </p>
      <p className="mt-1 font-mono text-[10px] text-ink-dim" data-testid={`export-readiness-counts-${report.targetId}`}>
        {report.counts.pass} pass · {report.counts.fail} fail · {report.counts.unknown} unknown · {report.counts.total} rule(s) —
        counts of RULES, not a score
      </p>

      {report.verdict === "indeterminate" ? (
        <p className="mt-1 text-[10px] text-info" data-testid={`export-readiness-why-${report.targetId}`}>
          Not &quot;ready&quot;: {report.unknownRequired.length} required rule(s) could not be checked at all —{" "}
          {report.unknownRequired.map(name).join(", ")}.
        </p>
      ) : null}
      {report.blockingFailures.length > 0 ? (
        <p className="mt-1 text-[10px] text-danger" data-testid={`export-readiness-blocking-${report.targetId}`}>
          Blocking failure(s): {report.blockingFailures.map(name).join(", ")} — a required rule FAILED, so this target is not
          ready.
        </p>
      ) : null}
      {report.warnings.length > 0 ? (
        <p className="mt-1 text-[10px] text-accent" data-testid={`export-readiness-warnings-${report.targetId}`}>
          Warning(s), recommended rules only: {report.warnings.map(name).join(", ")}.
        </p>
      ) : null}

      <ul className="mt-2 space-y-1.5">
        {report.rules.map((rule) => (
          <li
            key={rule.id}
            className={`rounded border p-1.5 ${
              rule.status === "fail"
                ? "border-danger/30 bg-danger/5"
                : rule.status === "unknown"
                  ? "border-dashed border-info/40"
                  : "border-line/60"
            }`}
            data-testid={`export-rule-${report.targetId}-${rule.id}`}
          >
            <p className="flex flex-wrap items-center gap-1.5 text-[10px] text-ink">
              <RuleStatusBadge rule={rule} />
              <span data-testid={`export-rule-severity-${report.targetId}-${rule.id}`}>
                <Badge tone={rule.severity === "required" ? "neutral" : "neutral"}>
                  {rule.severity === "required" ? "REQUIRED" : "RECOMMENDED"}
                </Badge>
              </span>
              <span className="font-medium">{rule.label}</span>
              <span className="ml-auto font-mono text-[10px] text-ink-faint">{rule.id}</span>
            </p>
            <p className="mt-1 text-[10px] text-ink-dim">rule: {rule.rule}</p>
            <p className="mt-0.5 text-[10px] text-ink-dim" data-testid={`export-rule-actual-${report.targetId}-${rule.id}`}>
              this project&apos;s actual value: <span className="font-mono">{rule.actual}</span>
            </p>
            {rule.detail ? (
              <p
                className={`mt-0.5 text-[10px] ${rule.status === "fail" ? "text-danger" : "text-ink-faint"}`}
                data-testid={`export-rule-detail-${report.targetId}-${rule.id}`}
              >
                {rule.detail}
              </p>
            ) : null}
            <p className="mt-0.5 text-[10px] text-ink-faint">basis: {rule.basis}</p>
            {rule.gate ? (
              <p className="mt-0.5 text-[10px] text-ink-faint" data-testid={`export-rule-gate-${report.targetId}-${rule.id}`}>
                gated on <span className="font-mono text-accent">{gateEnvLabel(rule.gate)}</span> —
                capability <span className="font-mono">{rule.gate.capability}</span>, connected{" "}
                <span className="font-mono">{String(rule.gate.connected)}</span>. {rule.gate.note}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
      {(report.notes ?? []).length > 0 ? (
        <ul className="mt-1.5 space-y-0.5">
          {report.notes.map((n) => (
            <li key={n} className="text-[10px] text-ink-faint">
              · {n}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function ReadinessSection({
  response,
  busy,
  targets,
  onToggleTarget,
  onSelectAll,
  onRun,
}: {
  response: ExportResponse | null;
  busy: boolean;
  targets: string[];
  onToggleTarget: (id: string) => void;
  onSelectAll: () => void;
  onRun: () => void;
}) {
  const targetsReported = response?.targets ?? null;
  const summary = response?.summary ?? null;
  return (
    <div className="rounded-lg border border-line bg-panel-3/40 p-2.5" data-testid="export-readiness">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          <ListChecks size={12} /> Publish readiness
          {summary ? (
            <>
              <Badge tone="ok">{summary.ready} ready</Badge>
              <Badge tone="accent">{summary.readyWithWarnings} with warnings</Badge>
              <Badge tone="danger">{summary.notReady} not ready</Badge>
              <span
                data-testid="export-readiness-indeterminate-count"
                className="inline-flex items-center gap-1 rounded-full border border-dashed border-info/70 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-info"
              >
                <CircleQuestionMark size={10} /> {summary.indeterminate} indeterminate
              </span>
            </>
          ) : null}
        </p>
        <span className="flex items-center gap-2">
          <button
            type="button"
            className="text-[10px] text-ink-faint hover:text-ink"
            disabled={busy}
            onClick={onSelectAll}
            data-testid="export-readiness-all"
          >
            all six targets
          </button>
          <Button size="sm" variant="primary" disabled={busy || targets.length === 0} onClick={onRun} data-testid="export-readiness-run">
            {busy ? <Loader2 size={13} className="animate-spin" /> : <ListChecks size={13} />} Check {targets.length} target
            {targets.length === 1 ? "" : "s"}
          </Button>
        </span>
      </div>

      <p className="mt-2 text-[11px] text-ink-faint">
        Choose the target set, then read the engine&apos;s answer. Every badge below is the engine&apos;s verdict for this project:
        the rule it states, the basis it cites and this project&apos;s actual value. UNKNOWN means the rule could not be checked at
        all — it is never counted as a pass.
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5" data-testid="export-readiness-targets">
        {PUBLISH_TARGET_VIEWS.map((t) => {
          const on = targets.includes(t.id);
          return (
            <button
              key={t.id}
              type="button"
              disabled={busy}
              aria-pressed={on}
              onClick={() => onToggleTarget(t.id)}
              data-testid={`export-target-${t.id}`}
              className={`rounded-full border px-2 py-0.5 text-[10px] transition-colors ${
                on ? "border-accent-line bg-accent-soft text-ink" : "border-line bg-panel-2/50 text-ink-dim hover:text-ink"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {!targetsReported ? (
        <p className="mt-2 text-[11px] text-ink-faint" data-testid="export-readiness-empty">
          No readiness check read yet. Nothing is persisted on the server — a reload or a project switch starts empty, and re-running
          re-checks the project&apos;s own data. This action writes nothing.
        </p>
      ) : (
        <>
          <p className="mt-2 text-[11px] text-ink-faint" data-testid="export-readiness-note">
            {response?.note}
          </p>
          <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-faint">
            <Badge tone="neutral">read-only</Badge>
            <span data-testid="export-readiness-readonly">
              persisted {String(response?.persisted ?? false)} · changed {String(response?.changed ?? false)} · written{" "}
              {String((response?.plan ?? {})["written"] ?? false)} · uploaded{" "}
              {String((response?.plan ?? {})["uploaded"] ?? false)} · filesProduced{" "}
              {String((response?.plan ?? {})["filesProduced"] ?? "?")}
            </span>
            <span className="font-mono">targets: {(response?.requestedTargets ?? []).join(", ") || "none"}</span>
          </p>
          {summary ? (
            <p className="mt-1 text-[10px] text-ink-faint" data-testid="export-readiness-summary-note">
              {summary.note}
            </p>
          ) : null}
          {response?.sidecarSummary ? (
            <p className="mt-1 text-[10px] text-ink-faint" data-testid="export-readiness-sidecar-summary">
              what the checks read: {response.sidecarSummary.cueCount} cue(s) · {response.sidecarSummary.chapterCount} chapter(s) ·{" "}
              {response.sidecarSummary.thumbnail}
            </p>
          ) : null}
          <ul className="mt-2 grid grid-cols-1 gap-2 xl:grid-cols-2" data-testid="export-readiness-grid">
            {targetsReported.map((t) => (
              <TargetReportCard key={t.targetId} report={t} />
            ))}
          </ul>
          {response?.provider && response.provider.connected === false ? (
            <p className="mt-2 text-[10px] text-ink-faint" data-testid="export-readiness-gate">
              Provider-gated rules name the server-side env var{" "}
              <span className="font-mono text-accent">{gateEnvLabel(response.provider)}</span>{" "}
              (name only, never a value): {response.provider.note}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The panel                                                           */
/* ------------------------------------------------------------------ */
/**
 * The env var label shown to a user comes from the ENGINE's gate response — this
 * component never carries an env var name of its own. When the engine names
 * nothing (no provider slot serves that capability) we say so instead of
 * rendering a blank or a placeholder.
 */
function gateEnvLabel(gate: { envHint: string | null; requiredEnv: string[] }): string {
  if (gate.envHint) return gate.envHint;
  if (gate.requiredEnv.length > 0) return gate.requiredEnv.join(", ");
  return "no env var — no provider slot is registered for this capability";
}


/**
 * A field the engine reports as null is rendered as the null it is. A field the
 * response does not carry at all is rendered as "not reported" — never as a
 * plausible-looking number.
 */
function nullText(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "not reported";
  return String(v);
}

const JOB_PROVIDER_ONLY_LABELS: { key: string; label: string }[] = [
  { key: "progress", label: "progress" },
  { key: "percentComplete", label: "percentComplete" },
  { key: "etaSeconds", label: "etaSeconds" },
  { key: "completedAt", label: "completedAt" },
  { key: "outputUrl", label: "outputUrl" },
  { key: "outputBytes", label: "outputBytes" },
];

/**
 * Phase 6 Block 5/6 — the EXPORT JOB HANDOFF section (create / list / detail).
 *
 * A pure renderer of three engine actions on POST /api/studio/editor:
 * `createExportJob` (request export), `listExportJobs` (the project's jobs) and
 * `getExportJob` (one job, whole). Nothing here is derived: the job id, the state
 * and its label, the router's answer, the snapshot contents, the sidecar states,
 * the readiness verdicts, the request handed to the orchestrator and the gate's
 * env var NAMES are all fields of the engine's response.
 *
 * WHAT THIS SECTION DELIBERATELY DOES NOT HAVE: no progress bar, no percentage,
 * no ETA, no spinner standing in for work, and no "completed" badge. The engine
 * reports `progress` / `percentComplete` / `etaSeconds` / `completedAt` /
 * `outputUrl` / `outputBytes` as **null** and `filesProduced` as **0**, so the
 * rows below print those nulls as null and say why they are null: only a
 * connected, wired video_enhancement provider could ever fill them, and there is
 * none. The two states this server can reach (`queued`, `blocked`) are rendered
 * from the response; the two it cannot (`handed_off`, `provider_failed`) are
 * listed as UNREACHABLE with the engine's own reason for each.
 */
function JobHandoffSection({
  rows,
  detail,
  busy,
  disabled,
  selectedJobId,
  onRun,
}: {
  /** The last `listExportJobs` response (summaries only). */
  rows: ExportResponse | null;
  /** The last `createExportJob` / `getExportJob` response (one job, whole). */
  detail: ExportResponse | null;
  busy: string | null;
  disabled: boolean;
  selectedJobId: string | null;
  onRun: (action: "createExportJob" | "listExportJobs" | "getExportJob", jobId?: string) => void;
}) {
  const requesting = busy === "createExportJob";
  const listing = busy === "listExportJobs";
  const reading = busy === "getExportJob";
  const job = detail?.job ?? null;
  const states = detail?.states ?? rows?.states ?? null;
  const regime = detail?.snapshotRegime ?? null;
  const gate = detail?.provider ?? rows?.provider ?? null;
  const jobList = rows?.jobs ?? [];
  const counts = rows?.counts ?? null;
  const snapshot = detail?.snapshot ?? job?.snapshot ?? null;
  const routerRequest = detail?.routerRequest ?? job?.routerRequest ?? null;

  return (
    <div className="mt-3 rounded-lg border border-line bg-panel-3/40 p-2.5" data-testid="export-jobs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          <Send size={12} /> Export job handoff — request an export
        </p>
        <span className="flex flex-wrap items-center gap-1.5">
          <Badge tone="danger" className="normal-case tracking-normal">
            no provider connected — nothing is encoded
          </Badge>
          <Badge tone="neutral" className="normal-case tracking-normal">
            filesProduced {nullText(detail?.filesProduced ?? 0)}
          </Badge>
        </span>
      </div>

      <p className="mt-2 text-[11px] text-ink-faint">
        Requesting an export stores a <span className="text-ink-dim">snapshot</span> of what this project says it will
        deliver — the applied presets, the resolved duration and where it came from, every output&apos;s spec with its
        estimated size, the five sidecar slots with their content states, and the six publish-readiness verdicts as they
        stand — and hands the real <span className="font-mono text-[10px]">ENHANCE_VIDEO</span> task to the AI Model
        Orchestrator. The snapshot is written once and never moves; the job lands in the honest state the router&apos;s own
        answer puts it in. Nothing is encoded, muxed or uploaded, so there is no progress to show — and none is shown.
      </p>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          disabled={disabled}
          onClick={() => onRun("createExportJob")}
          data-testid="export-job-request"
        >
          <Send size={13} /> {requesting ? "asking the orchestrator…" : "Request export"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={disabled}
          onClick={() => onRun("listExportJobs")}
          data-testid="export-job-list-reload"
        >
          <RefreshCw size={13} /> {listing ? "reading…" : "Re-read job list"}
        </Button>
        <span className="text-[10px] text-ink-faint">
          request after applying at least one preset — a job snapshots the presets APPLIED to the project.
        </span>
      </div>

      {/* The gate, exactly as the engine derived it: env var NAMES only. */}
      {gate ? (
        <div className="mt-2 rounded border border-line/70 bg-panel-2/40 p-2" data-testid="export-job-gate">
          <p className="text-[11px] text-ink-dim">
            <span className="font-mono text-[10px]">{gate.capability}</span> · connected{" "}
            <span className="font-mono">{String(gate.connected)}</span> · a server operator would set{" "}
            <span className="font-mono text-ink" data-testid="export-job-gate-env">
              {gateEnvLabel(gate)}
            </span>
          </p>
          <p className="mt-1 text-[10px] text-ink-faint" data-testid="export-job-gate-note">
            {gate.note}
          </p>
        </div>
      ) : null}

      {/* ------------------------------------------------ the ONE job ---- */}
      {job && detail ? (
        <div className="mt-2 rounded-lg border border-line bg-panel-2/50 p-2.5" data-testid="export-job-detail">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Requested job</span>
            <span className="font-mono text-[11px] text-ink" data-testid="export-job-id">
              {job.jobId}
            </span>
            <Badge tone="danger" data-testid="export-job-state">
              {detail.stateInfo?.label ?? job.stateLabel}
            </Badge>
            <Badge tone="neutral" className="font-mono normal-case tracking-normal">
              {job.state}
            </Badge>
            {detail.deduplicated ? (
              <Badge tone="neutral" className="normal-case tracking-normal">
                identical request — same job returned (created: {String(detail.created ?? false)})
              </Badge>
            ) : (
              <Badge tone="ok" className="normal-case tracking-normal">
                created {String(detail.created ?? true)}
              </Badge>
            )}
            <span className="ml-auto flex items-center gap-1 font-mono text-[10px] text-ink-faint">
              <Clock size={11} /> {job.createdAt}
            </span>
          </div>

          {/* The router's own answer, verbatim. */}
          <div className="mt-2 rounded border border-line/70 bg-panel-3/40 p-2" data-testid="export-job-router">
            <p className="text-[11px] text-ink-dim">
              the AI Model Orchestrator answered{" "}
              <span className="font-mono text-[10px]">{detail.router?.status ?? job.router.status}</span> — quoted verbatim
              from this response:
            </p>
            <p className="mt-1 text-[11px] text-ink" data-testid="export-job-router-error">
              {detail.router?.error ?? job.router.error ?? "no error text reported"}
            </p>
            <p className="mt-1 text-[10px] text-ink-faint">
              required env (names only):{" "}
              <span className="font-mono" data-testid="export-job-router-env">
                {(detail.router?.requiredEnv ?? job.router.requiredEnv ?? []).join(", ") || "none named"}
              </span>
            </p>
            <p className="mt-1 text-[10px] text-ink-faint" data-testid="export-job-state-means">
              {detail.stateInfo?.means ?? ""}
            </p>
          </div>

          {/* What the snapshot is OF, and that it is frozen. */}
          {regime ? (
            <div className="mt-2 rounded border border-line/70 bg-panel-3/40 p-2" data-testid="export-job-snapshot-regime">
              <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-dim">
                <Lock size={11} /> the snapshot is of <span className="font-mono text-[10px]">{regime.kind}</span> and it
                is{" "}
                <Badge tone="neutral" className="normal-case tracking-normal">
                  {regime.immutable ? "FROZEN — written once at creation, never re-read" : "mutable"}
                </Badge>
                captured {snapshot?.capturedAt ?? job.snapshot.capturedAt}
              </p>
              <ul className="mt-1 space-y-0.5" data-testid="export-job-snapshot-of">
                {(regime.of ?? []).map((line) => (
                  <li key={line} className="text-[10px] text-ink-faint">
                    · {line}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[10px] text-ink-faint">{regime.note}</p>
            </div>
          ) : null}

          {/* The nulls — printed as nulls, with the reason. */}
          <div className="mt-2 rounded border border-line/70 bg-panel-3/40 p-2" data-testid="export-job-nulls">
            <p className="text-[11px] text-ink-dim">
              fields only a provider could fill — reported null, and rendered as null:
            </p>
            <ul className="mt-1 grid grid-cols-1 gap-0.5 sm:grid-cols-2 xl:grid-cols-3">
              {JOB_PROVIDER_ONLY_LABELS.map((f) => (
                <li key={f.key} className="font-mono text-[10px] text-ink-dim" data-testid={`export-job-null-${f.key}`}>
                  {f.label} = {nullText(detail[f.key as keyof ExportResponse])}
                </li>
              ))}
              <li className="font-mono text-[10px] text-ink-dim" data-testid="export-job-null-filesProduced">
                filesProduced = {nullText(detail.filesProduced)}
              </li>
            </ul>
            <p className="mt-1 text-[10px] text-ink-faint">
              There is no progress bar, no percentage, no ETA, no spinner and no completion badge anywhere on this
              surface: those fields are null because the provider that would fill them is not connected, and the panel does
              not invent a value where the engine reports none.
            </p>
          </div>

          {/* The declared state model: two reachable, two not — with reasons. */}
          {states ? (
            <div className="mt-2 rounded border border-line/70 bg-panel-3/40 p-2" data-testid="export-job-states">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                the four declared states
              </p>
              <ul className="mt-1 space-y-1" data-testid="export-job-states-reachable">
                {states.reachable.map((s) => (
                  <li key={s.state} className="text-[11px] text-ink-dim" data-testid={`export-job-state-reachable-${s.state}`}>
                    <span className="font-mono text-[10px] text-ink">{s.state}</span> — {s.label}: {s.means ?? ""}
                  </li>
                ))}
              </ul>
              <ul className="mt-1 space-y-1" data-testid="export-job-states-unreachable">
                {states.unreachable.map((s) => (
                  <li
                    key={s.state}
                    className="flex flex-wrap items-start gap-1 text-[11px] text-ink-faint"
                    data-testid={`export-job-state-unreachable-${s.state}`}
                  >
                    <CircleSlash size={11} className="mt-0.5 shrink-0" />
                    <span>
                      <span className="font-mono text-[10px] text-ink-dim">UNREACHABLE — {s.state}</span>:{" "}
                      {s.reason ?? "no reason reported"}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[10px] text-ink-faint" data-testid="export-job-states-note">
                {states.note} Provider-only fields:{" "}
                <span className="font-mono">{states.providerOnlyFields.join(", ")}</span>.
              </p>
            </div>
          ) : null}

          {/* The snapshot contents. */}
          {snapshot ? (
            <div className="mt-2 space-y-2">
              <div className="rounded border border-line/70 bg-panel-3/40 p-2" data-testid="export-job-snapshot-presets">
                <p className="text-[11px] text-ink-dim">
                  applied presets at snapshot time:{" "}
                  <span className="font-mono text-ink" data-testid="export-job-snapshot-preset-ids">
                    {snapshot.presetAssignment.presetIds.join(", ") || "none"}
                  </span>{" "}
                  ({snapshot.presetAssignment.count}) · recorded {snapshot.presetAssignment.appliedAt ?? "unknown"}
                </p>
                <p className="mt-1 text-[11px] text-ink-dim" data-testid="export-job-snapshot-duration">
                  resolved duration {snapshot.duration.seconds} s
                  {snapshot.duration.human ? ` (${snapshot.duration.human})` : ""} · source{" "}
                  <span className="font-mono text-[10px]">{snapshot.duration.source}</span>
                  {snapshot.duration.note ? ` — ${snapshot.duration.note}` : ""} · subtitle cues {snapshot.cueCount}
                </p>
              </div>

              <div className="rounded border border-line/70 bg-panel-3/40 p-2" data-testid="export-job-outputs">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  outputs in the snapshot ({snapshot.outputs.length}) — specs, not files
                </p>
                <ul className="mt-1 space-y-1">
                  {snapshot.outputs.map((o) => (
                    <li key={o.presetId} className="text-[10px]" data-testid={`export-job-output-${o.presetId}`}>
                      <span className="font-mono text-[10px] text-ink">{o.fileName}</span>
                      <span className="ml-1 text-ink-faint">
                        {o.resolution}
                        {o.aspect ? ` (${o.aspect})` : ""} · {o.container} · {o.video.codec} {o.video.profile} L
                        {o.video.level} · {o.video.frameRate} fps · {int(o.video.bitrateKbps)} kbps video +{" "}
                        {int(o.audio.bitrateKbps)} kbps {o.audio.codec} {o.audio.sampleRateHz} Hz {o.audio.channelLayout} ·{" "}
                        {o.audio.loudnessTargetLufs} LUFS · estimated{" "}
                        <span className="font-mono">{o.estimatedSize.human}</span> ({int(o.estimatedSize.bytes)} bytes,
                        arithmetic — not a file)
                      </span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded border border-line/70 bg-panel-3/40 p-2" data-testid="export-job-sidecars">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  sidecar states in the snapshot ({snapshot.sidecars.length})
                </p>
                <ul className="mt-1 space-y-0.5">
                  {snapshot.sidecars.map((s) => (
                    <li key={s.id} className="text-[10px] text-ink-faint" data-testid={`export-job-sidecar-${s.id}`}>
                      <span className="font-mono text-[10px] text-ink-dim">{s.id}</span> · {s.contentState} ·{" "}
                      {s.fileName ?? "no file"} ·{" "}
                      {s.requiresEnv ? `would need ${s.requiresEnv}` : "no env var would enable it"}
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded border border-line/70 bg-panel-3/40 p-2" data-testid="export-job-readiness">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  publish-readiness verdicts in the snapshot ({snapshot.readiness.length})
                </p>
                <ul className="mt-1 space-y-0.5">
                  {snapshot.readiness.map((r) => (
                    <li
                      key={r.targetId}
                      className="text-[10px] text-ink-faint"
                      data-testid={`export-job-verdict-${r.targetId}`}
                    >
                      <span className="font-mono text-[10px] text-ink-dim">{r.targetId}</span> · {r.verdict} ·{" "}
                      {r.counts.pass} pass / {r.counts.fail} fail / {r.counts.unknown} unknown of {r.counts.total} rules
                    </li>
                  ))}
                </ul>
              </div>

              <div className="rounded border border-line/70 bg-panel-3/40 p-2" data-testid="export-job-router-request">
                <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  <PackageOpen size={12} /> the request handed to the orchestrator
                </p>
                <pre className="mt-1 max-h-56 overflow-auto whitespace-pre-wrap break-all font-mono text-[10px] text-ink-dim">
                  {JSON.stringify(routerRequest, null, 2)}
                </pre>
              </div>

              <div className="rounded border border-line/70 bg-panel-3/40 p-2" data-testid="export-job-history">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">status history</p>
                <ul className="mt-1 space-y-0.5">
                  {job.statusHistory.map((h) => (
                    <li key={`${h.at}-${h.event}`} className="text-[10px] text-ink-faint">
                      <span className="font-mono">{h.at}</span> · {h.event} →{" "}
                      <span className="font-mono text-ink-dim">{h.state}</span> · {h.detail}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-2 text-[11px] text-ink-faint" data-testid="export-job-detail-empty">
          No job detail on screen yet — request an export, or open one from the list below.
        </p>
      )}

      {/* ---------------------------------------------------- the list ---- */}
      <div className="mt-2 rounded border border-line/70 bg-panel-3/40 p-2" data-testid="export-job-list">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            This project&apos;s export jobs {rows ? `(${rows.count ?? jobList.length})` : ""}
          </p>
          {counts ? (
            <span className="flex flex-wrap gap-1.5 text-[10px] text-ink-faint" data-testid="export-job-counts">
              {counts.jobCount} job(s) · blocked {counts.blocked} · queued {counts.queued} · handed_off {counts.handedOff}{" "}
              · provider_failed {counts.providerFailed} · filesProduced {counts.filesProduced}
            </span>
          ) : null}
        </div>
        {jobList.length === 0 ? (
          <p className="mt-1 text-[11px] text-ink-faint" data-testid="export-job-list-empty">
            {rows
              ? "No export job exists for this project yet. Requesting one stores a snapshot and hands the request to the orchestrator — it does not encode anything."
              : "Reading this project's jobs…"}
          </p>
        ) : (
          <ul className="mt-1 space-y-1">
            {jobList.map((j) => (
              <li
                key={j.jobId}
                className={`rounded border p-2 ${
                  j.jobId === selectedJobId ? "border-accent-line bg-accent-soft/40" : "border-line/70 bg-panel-2/40"
                }`}
                data-testid={`export-job-row-${j.jobId}`}
              >
                <div className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="danger" className="normal-case tracking-normal">
                    {j.stateLabel}
                  </Badge>
                  <span className="font-mono text-[10px] text-ink" data-testid={`export-job-row-state-${j.jobId}`}>
                    {j.state}
                  </span>
                  <span className="font-mono text-[10px] text-ink-faint" data-testid={`export-job-row-created-${j.jobId}`}>
                    created {j.createdAt}
                  </span>
                  <span className="text-[10px] text-ink-faint">
                    {j.presetIds.join(", ") || "no presets"} · {j.durationSeconds ?? "no"} s (
                    {j.durationSource ?? "no source"}) · {j.outputCount} output spec(s) · router{" "}
                    {j.routerStatus ?? "not reported"} · progress {nullText(j.progress)} · filesProduced{" "}
                    {nullText(j.filesProduced)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto"
                    disabled={disabled}
                    onClick={() => onRun("getExportJob", j.jobId)}
                    data-testid={`export-job-open-${j.jobId}`}
                  >
                    {reading && j.jobId === selectedJobId ? "reading…" : "detail"}
                  </Button>
                </div>
                {j.lastHistoryEntry ? (
                  <p className="mt-1 text-[10px] text-ink-faint" data-testid={`export-job-row-last-${j.jobId}`}>
                    last: {j.lastHistoryEntry.event} → {j.lastHistoryEntry.state} · {j.lastHistoryEntry.detail}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {rows?.dedupe?.note ? (
          <p className="mt-1 text-[10px] text-ink-faint" data-testid="export-job-list-note">
            {rows.dedupe.note}
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function ExportPanel({
  projects,
  initialProjectId,
}: {
  /** The signed-in user's live projects (id + title), from the server page. */
  projects: { id: string; title: string }[];
  /** Optional pre-selected project (e.g. from a link). */
  initialProjectId?: string | null;
}) {
  const [projectId, setProjectId] = useState<string | null>(
    initialProjectId && projects.some((p) => p.id === initialProjectId) ? initialProjectId : (projects[0]?.id ?? null),
  );
  const [durationInput, setDurationInput] = useState<string>("");
  const [selected, setSelected] = useState<string[]>([]);
  const [catalogue, setCatalogue] = useState<ExportResponse | null>(null);
  const [result, setResult] = useState<ExportResponse | null>(null);
  /**
   * Block 7 — the duration each of those two reads was TAKEN at, stored beside the
   * response it describes (null = that request carried no `durationSeconds`). The
   * read-out may print a duration only from the pair belonging to the response on
   * screen — never from a value this component derived for the input.
   */
  const [catalogueReadAt, setCatalogueReadAt] = useState<number | null>(null);
  const [resultReadAt, setResultReadAt] = useState<number | null>(null);
  /** Block 4 — the last `planSidecars` response (read-only; never persisted). */
  const [sidecars, setSidecars] = useState<ExportResponse | null>(null);
  /** Block 4 — the last `checkPublishReadiness` response (read-only; never persisted). */
  const [readiness, setReadiness] = useState<ExportResponse | null>(null);
  /** Block 4 — the target set posted to the readiness check (all six by default). */
  const [targets, setTargets] = useState<string[]>(() => PUBLISH_TARGET_VIEWS.map((t) => t.id));
  /** Block 5 — the last `listExportJobs` response: this project's jobs, summaries only. */
  const [jobs, setJobs] = useState<ExportResponse | null>(null);
  /** Block 5 — the last `createExportJob` / `getExportJob` response: one job, whole. */
  const [jobDetail, setJobDetail] = useState<ExportResponse | null>(null);
  /** Block 5 — which job the detail block is showing (highlighted in the list). */
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** True once the user has chosen by hand — then a read never overwrites it. */
  const touched = useRef(false);

  const operationallyBusy = busy !== null;
  const presets = catalogue?.presets ?? [];
  const current = result ?? catalogue;
  const assignment = current?.assignment ?? null;
  const appliedIds = assignment?.presetIds ?? [];
  const sizeModel = current?.sizeModel ?? catalogue?.sizeModel ?? null;
  const gate = result?.provider ?? catalogue?.provider ?? null;
  const estimates = useMemo(() => {
    const rows = result?.estimates && result.estimates.length > 0 ? result.estimates : (catalogue?.estimates ?? []);
    const map = new Map<string, ExportEstimateView>();
    for (const row of rows) map.set(row.presetId, row);
    return map;
  }, [result, catalogue]);

  /**
   * The catalogue + the project's persisted preset choice. A deterministic read:
   * it renders the eight presets and carries the standing encoding gate — a
   * catalogue read encodes nothing and nothing is claimed.
   */
  const loadCatalogue = useCallback(
    async (targetProjectId?: string) => {
      const pid = targetProjectId ?? projectId;
      if (!pid) {
        setCatalogue(null);
        setCatalogueReadAt(null);
        return;
      }
      setBusy("listExportPresets");
      setError(null);
      try {
        const payload: Record<string, unknown> = { action: "listExportPresets", projectId: pid };
        // The duration the request carries comes from the ONE derivation the
        // read-out compares against (`requestDurationSeconds`) — never a second one.
        const seconds = requestDurationSeconds(durationInput);
        if (seconds !== null) payload.durationSeconds = seconds;
        const res = await postEditor(payload);
        setCatalogue(res);
        // Block 7 — the read and the duration it was taken at are stored as a PAIR:
        // the read-out may only print a duration from this pair.
        setCatalogueReadAt(seconds);
        if (!touched.current) setSelected(res.assignment?.presetIds ?? []);
      } catch (err) {
        const status = (err as { status?: number }).status;
        const code = (err as { code?: string }).code;
        setCatalogue(null);
        setCatalogueReadAt(null);
        setError(`${errorMessage(err)}${code ? ` (${code}${status ? ` · HTTP ${status}` : ""})` : ""}`);
      } finally {
        setBusy(null);
      }
    },
    [projectId, durationInput],
  );

  /**
   * Block 5 — this project's export jobs, newest first, summaries only. A read:
   * it stores nothing and encodes nothing. It runs on every project change (and
   * on a cold mount), which is what makes a persisted job survive a reload.
   */
  const loadJobs = useCallback(async () => {
    const pid = projectId;
    if (!pid) {
      setJobs(null);
      return;
    }
    setBusy("listExportJobs");
    setError(null);
    try {
      const res = await postEditor({ action: "listExportJobs", projectId: pid });
      setJobs(res);
    } catch (err) {
      const status = (err as { status?: number }).status;
      const code = (err as { code?: string }).code;
      setJobs(null);
      setError(`${errorMessage(err)}${code ? ` (${code}${status ? ` · HTTP ${status}` : ""})` : ""}`);
    } finally {
      setBusy(null);
    }
  }, [projectId]);

  useEffect(() => {
    void loadCatalogue();
    void loadJobs();
    // Only a project change reloads on its own; the duration is applied on demand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  /**
   * planExport / applyExportPreset / clearExportPreset / planSidecars /
   * checkPublishReadiness. The plan, the sidecar plan and the readiness check are
   * reads (`changed: false`, nothing persisted, `filesProduced: 0`); apply and
   * reset really record or clear the CHOICE and the panel then re-reads the
   * catalogue so the applied state on screen is the persisted state, not the
   * mutation's own echo. Every Block 4 result replaces the previous one of its own
   * kind, so what is rendered is always the engine's latest answer.
   */
  const run = useCallback(
    async (action: ExportPanelAction, jobId?: string) => {
      if (!projectId) return;
      if (action === "listExportPresets") {
        await loadCatalogue();
        return;
      }
      if (action === "listExportJobs") {
        await loadJobs();
        return;
      }
      setBusy(action);
      setError(null);
      try {
        const payload: Record<string, unknown> = { action, projectId };
        const seconds = requestDurationSeconds(durationInput);
        if (seconds !== null) payload.durationSeconds = seconds;
        if (action === "planExport" || action === "applyExportPreset") payload.presetIds = selected;
        if (action === "checkPublishReadiness") payload.targets = targets;
        if (action === "getExportJob") payload.jobId = jobId;
        const res = await postEditor(payload);
        if (action === "planSidecars") {
          setSidecars(res);
        } else if (action === "checkPublishReadiness") {
          setReadiness(res);
        } else if (action === "createExportJob" || action === "getExportJob") {
          setJobDetail(res);
          setSelectedJobId(res.job?.jobId ?? jobId ?? null);
          if (action === "createExportJob") await loadJobs();
        } else {
          setResult(res);
          setResultReadAt(seconds);
        }
        if (action === "applyExportPreset") {
          touched.current = false;
          setSelected(res.assignment?.presetIds ?? []);
          await loadCatalogue();
        } else if (action === "clearExportPreset") {
          touched.current = false;
          setSelected([]);
          await loadCatalogue();
        }
      } catch (err) {
        const status = (err as { status?: number }).status;
        const code = (err as { code?: string }).code;
        if (action === "planSidecars") setSidecars(null);
        else if (action === "checkPublishReadiness") setReadiness(null);
        else if (action === "createExportJob" || action === "getExportJob") setJobDetail(null);
        else {
          setResult(null);
          setResultReadAt(null);
        }
        setError(`${errorMessage(err)}${code ? ` (${code}${status ? ` · HTTP ${status}` : ""})` : ""}`);
      } finally {
        setBusy(null);
      }
    },
    [projectId, durationInput, selected, targets, loadCatalogue, loadJobs],
  );

  /** Switching project drops the per-project reads: they belong to the old project. */
  useEffect(() => {
    setSidecars(null);
    setReadiness(null);
    setJobDetail(null);
    setSelectedJobId(null);
    // Block 7: the plan on screen describes the OLD project's duration and data,
    // while the next request would go to this one — so it is dropped with the other
    // per-project reads rather than left to be read as this project's plan.
    setResult(null);
    setResultReadAt(null);
  }, [projectId]);

  function togglePreset(id: string) {
    touched.current = true;
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleTarget(id: string) {
    setTargets((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  const duration = current?.duration ?? null;
  /**
   * Block 7 — the duration the read on screen was taken at: the value paired with
   * whichever response is being rendered (`result ?? catalogue`), together with the
   * duration the next request would carry, from the same derivation the payload
   * uses. `durationReadOut` prints a duration only when those two agree.
   */
  const durationReadAt = result ? resultReadAt : catalogueReadAt;
  const durationReadOutView = durationReadOut({
    requestSeconds: requestDurationSeconds(durationInput),
    readAtSeconds: durationReadAt,
    reported: duration,
  });
  /** True when the plan / estimate / manifest on screen are NOT for the typed duration. */
  const resultReadIsStale = result !== null && resultReadAt !== requestDurationSeconds(durationInput);
  const outputs = result?.manifest?.outputs ?? [];
  const manifest = result?.manifest ?? null;
  const selectedSpecs = presets.filter((p) => selected.includes(p.id));
  const estimateRows = selected
    .map((id) => estimates.get(id))
    .filter((r): r is ExportEstimateView => r !== undefined);

  return (
    <Card className="p-4" data-testid="export-panel">
      {/* ------------------------------------------------------ header ---- */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          <CloudUpload size={12} /> Export &amp; finishing
        </p>
        <span className="flex items-center gap-2 text-[11px] text-ink-faint">
          <span data-testid="export-assignment">
            {assignment?.applied ? (
              <>
                applied preset{assignment.presetIds.length === 1 ? "" : "s"}:{" "}
                <span className="font-mono text-ink-dim">{assignment.presetIds.join(", ")}</span>
                {assignment.appliedAt ? <span className="ml-1 font-mono text-[10px]">· {assignment.appliedAt}</span> : null}
              </>
            ) : (
              "no preset applied"
            )}
          </span>
          <button
            type="button"
            className="text-ink-faint hover:text-ink"
            title="Re-read the preset catalogue, the estimates and the persisted preset choice"
            onClick={() => void run("listExportPresets")}
            disabled={operationallyBusy}
            data-testid="export-reload"
          >
            <RefreshCw size={12} />
          </button>
        </span>
      </div>
      <p className="mt-2 text-[11px] text-ink-faint">
        The delivery specification for this project: eight presets with the container, video codec, resolution, frame rate,
        bitrate, audio and loudness numbers and the SDR-or-HDR colour tag each one would carry — all of them the values the
        export engine declares, none of them invented here. Pick presets, apply them (the choice is stored on the project, and
        re-applying the same set writes nothing), and read the size ESTIMATE with its formula and units and the deliverable
        manifest. <span className="text-ink-dim">No file exists:</span> nothing is decoded, encoded, muxed, tone-mapped,
        uploaded or written — every number below is a specification, and the byte sizes are arithmetic on the stated formula, not
        measurements of a file.
      </p>
      <p className="mt-1.5 text-[11px] text-ink-faint">
        Below that, the <span className="text-ink-dim">finishing half</span>: the five sidecar deliverables (SRT, WebVTT, chapters,
        thumbnail, metadata) with an honest content state per slot and a real preview where content exists, and a per-platform
        publish-readiness matrix where every rule carries a PASS / FAIL / <span className="text-info">UNKNOWN</span> badge, the
        rule&apos;s own text, its basis and this project&apos;s actual value. Both are read-only: they report what the project
        holds, produce no file and write nothing.
      </p>

      {/* ------------------------------------------ project + duration ---- */}
      <div className="mt-3 grid grid-cols-1 gap-2 xl:grid-cols-2">
        <div className="rounded-lg border border-line bg-panel-3/30 p-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Project</p>
          <div className="mt-2">
            <Label htmlFor="export-project">Export specification for</Label>
            {projects.length === 0 ? (
              <p className="text-[11px] text-ink-faint">
                No live project exists yet — create one and the export specification appears here.
              </p>
            ) : (
              <select
                id="export-project"
                data-testid="export-project-select"
                className="h-9 w-full rounded-xl border border-line bg-panel-3/60 px-2 text-xs text-ink focus:border-accent-line focus:outline-none"
                value={projectId ?? ""}
                disabled={operationallyBusy}
                onChange={(e) => setProjectId(e.target.value)}
              >
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            )}
            {current?.projectId ? (
              <p className="mt-1 text-[10px] text-ink-faint">
                project <span className="font-mono">{current.projectId}</span>
                {current.projectTitle ? ` — ${current.projectTitle}` : ""}
              </p>
            ) : null}
            <p className="mt-1 text-[10px] text-ink-faint">
              The preset choice is stored per project (as project metadata) — switching project re-reads its own choice.
            </p>
          </div>
        </div>

        <div className="rounded-lg border border-line bg-panel-3/30 p-2.5">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            <Ruler size={12} /> Duration for the size estimate
          </p>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            <div className="min-w-[150px] flex-1">
              <Label htmlFor="export-duration">Duration (seconds)</Label>
              <input
                id="export-duration"
                data-testid="export-duration"
                type="number"
                min={1}
                max={MAX_DURATION_SECONDS}
                step={1}
                inputMode="numeric"
                value={durationInput}
                disabled={operationallyBusy}
                placeholder="leave blank to use the timeline / scenes"
                onChange={(e) => setDurationInput(e.target.value)}
                className="h-9 w-full rounded-xl border border-line bg-panel-3/60 px-2.5 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-accent-line focus:outline-none"
              />
            </div>
            <Button size="sm" variant="outline" disabled={operationallyBusy} onClick={() => void run("listExportPresets")}>
              {busy === "listExportPresets" ? <Loader2 size={13} className="animate-spin" /> : <Ruler size={13} />} Estimate at
              this duration
            </Button>
          </div>
          {/*
            Block 7 — THE line. Its text is `durationReadOut`'s, which prints a
            duration only from a read taken at exactly the duration the next request
            would carry, and prints the engine's own source with it. It carries its
            state as an attribute so the state is inspectable, not just readable.
          */}
          <p
            className="mt-1.5 text-[10px] text-ink-faint"
            data-testid="export-resolved-duration"
            data-duration-readout={durationReadOutView.state}
          >
            {durationReadOutView.text}
          </p>
          <p className="mt-1 text-[10px] text-ink-faint">
            Blank uses the engine&apos;s own sources in order: a duration in the request, then the saved editor timeline, then the
            sum of the scene durations. The engine accepts 1–{MAX_DURATION_SECONDS} s (120 min) and refuses anything else rather
            than estimating it. A duration is printed above only when the read it came from was taken at exactly the duration the
            next request would carry — otherwise the line says so, instead of printing a number that belongs to a different
            request.
          </p>
        </div>
      </div>

      {/* -------------------------------------------- preset catalogue ---- */}
      <div className="mt-3 rounded-lg border border-line bg-panel-3/30 p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            Preset catalogue {catalogue ? `(${catalogue.count ?? presets.length})` : ""}
          </p>
          <span className="text-[10px] text-ink-faint">
            {selected.length > 0 ? `${selected.length} selected` : "nothing selected"} · applied{" "}
            <span className="font-mono">{appliedIds.length > 0 ? appliedIds.join(", ") : "none"}</span>
          </span>
        </div>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4" data-testid="export-preset-grid">
          {presets.length === 0 ? (
            <p className="text-[11px] text-ink-faint">
              {projects.length === 0 ? "No project to read presets for." : "Loading the preset catalogue…"}
            </p>
          ) : (
            presets.map((p) => (
              <PresetCard
                key={p.id}
                preset={p}
                selected={selected.includes(p.id)}
                applied={appliedIds.includes(p.id)}
                estimate={estimates.get(p.id) ?? null}
                busy={operationallyBusy}
                onToggle={() => togglePreset(p.id)}
              />
            ))
          )}
        </div>
        <p className="mt-2 text-[10px] text-ink-faint">
          {catalogue?.note ?? "Pick one or more presets — the plan and the apply use exactly the selection above."}
        </p>
      </div>

      {/* ------------------------------------------- selected spec table ---- */}
      {selectedSpecs.length > 0 ? (
        <div className="mt-3 rounded-lg border border-line bg-panel-3/40 p-2.5" data-testid="export-selected-specs">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            Selected delivery specs ({selectedSpecs.length})
          </p>
          <ul className="mt-2 space-y-2">
            {selectedSpecs.map((p) => (
              <li key={p.id} className="rounded border border-line/70 bg-panel-2/50 p-2" data-testid={`export-spec-${p.id}`}>
                <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink">
                  <span className="font-mono text-[10px] text-ink-faint">{p.id}</span>
                  {p.label}
                  <Badge tone="neutral">{p.platform}</Badge>
                  <Badge tone={p.colour.display === "HDR" ? "accent" : "neutral"}>{p.colour.display}</Badge>
                  <span className="ml-auto font-mono text-[10px] text-ink-faint">
                    {p.resolution} · {p.aspect}
                  </span>
                </p>
                <p className="mt-1 font-mono text-[10px] text-ink-dim">
                  container {p.container} · codec {p.video.codec} ({p.video.codecFamily}, profile {p.video.profile}
                  {p.video.level ? `, level ${p.video.level}` : ""}) · pixel format {p.video.pixelFormat} · {p.video.frameRate} fps ·
                  rate control {p.video.rateControl.mode}
                  {p.video.rateControl.crf !== null ? ` (CRF ${p.video.rateControl.crf})` : ""} · target{" "}
                  {int(p.video.bitrateKbps)} kbps ({mbit(p.video.bitrateKbps)})
                  {p.video.maxBitrateKbps !== null ? ` · max ${int(p.video.maxBitrateKbps)} kbps` : " · uncapped"}
                </p>
                <p className="mt-1 font-mono text-[10px] text-ink-dim">
                  audio {p.audio.codec} · {int(p.audio.sampleRateHz)} Hz · {p.audio.channels} ch ({p.audio.channelLayout}) ·{" "}
                  {int(p.audio.bitrateKbps)} kbps · loudness {p.audio.loudnessTargetLufs} LUFS · true peak{" "}
                  {p.audio.truePeakDbfs} dBTP
                </p>
                <p className="mt-1 font-mono text-[10px] text-ink-dim" data-testid={`export-colour-${p.id}`}>
                  colour: {colourTagLine(p.colour)}
                </p>
                <p className="mt-1 font-mono text-[10px] text-ink-faint">
                  mastered {p.colour.master.bitDepth}-bit {p.colour.master.chromaSubsampling} → delivered{" "}
                  {p.colour.delivery.bitDepth}-bit {p.colour.delivery.chromaSubsampling}
                  {p.colour.masteringDisplay
                    ? ` · mastering display ${p.colour.masteringDisplay.maxNits}/${p.colour.masteringDisplay.minNits} nits`
                    : " · no mastering-display volume (SDR master)"}
                  {p.colour.maxCLL !== null ? ` · maxCLL ${p.colour.maxCLL} · maxFALL ${p.colour.maxFALL}` : ""}
                </p>
                <p className="mt-1 text-[10px] text-ink-faint">colour basis: {p.colour.note}</p>
                <p className="mt-1 text-[10px] text-ink-faint">
                  frame rate basis: {p.video.frameRateBasis}
                </p>
                <p className="mt-1 text-[10px] text-ink-faint">
                  bitrate basis: {p.video.rateControl.basis} · audio basis: {p.audio.bitrateBasis} ·{" "}
                  {p.audio.loudnessBasis}
                </p>
                <p className="mt-1 text-[10px] text-ink-faint">
                  subtitle track: {p.subtitleTrack.container} — {p.subtitleTrack.note}
                </p>
                {p.deliveryNotes.map((n) => (
                  <p key={n} className="mt-1 text-[10px] text-ink-faint">
                    · {n}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ------------------------------------------------------- actions ---- */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={operationallyBusy || !projectId || selected.length === 0}
          onClick={() => void run("planExport")}
          data-testid="export-plan"
        >
          {busy === "planExport" ? <Loader2 size={13} className="animate-spin" /> : <Activity size={13} />} Plan{" "}
          {selected.length > 0 ? `${selected.length} preset${selected.length === 1 ? "" : "s"}` : "selection"}
        </Button>
        <Button
          size="sm"
          variant="primary"
          disabled={operationallyBusy || !projectId || selected.length === 0}
          onClick={() => void run("applyExportPreset")}
          data-testid="export-apply"
        >
          {busy === "applyExportPreset" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Apply selection
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={operationallyBusy || !projectId}
          onClick={() => void run("clearExportPreset")}
          data-testid="export-reset"
        >
          {busy === "clearExportPreset" ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Reset preset choice
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={operationallyBusy || !projectId}
          onClick={() => void run("planSidecars")}
          data-testid="export-sidecars-button"
        >
          {busy === "planSidecars" ? <Loader2 size={13} className="animate-spin" /> : <Captions size={13} />} Plan sidecars
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={operationallyBusy || !projectId || targets.length === 0}
          onClick={() => void run("checkPublishReadiness")}
          data-testid="export-readiness-button"
        >
          {busy === "checkPublishReadiness" ? <Loader2 size={13} className="animate-spin" /> : <ListChecks size={13} />} Check
          readiness
        </Button>
        <span className="text-[11px] text-ink-faint" data-testid="export-status">
          {result
            ? `${result.action ?? "result"} — ${result.changed ? "changed" : "nothing changed"}${
                result.persisted ? " · persisted" : " · nothing written"
              }`
            : "not planned yet"}
        </span>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger" data-testid="export-error">
          {error}
        </p>
      ) : null}

      {result ? (
        <div className="mt-3 space-y-3">
          {/*
            Block 7 — the plan, the size estimate and the manifest below were read at
            the duration THIS request carried. If the input has changed since, they
            are not the numbers a request would carry now, and the panel says so
            rather than letting a stale read pass for the current one. Nothing is
            hidden: the block stays readable, with its provenance named.
          */}
          {resultReadIsStale ? (
            <p
              className="rounded-lg border border-dashed border-accent-line bg-accent-soft px-3 py-2 text-[11px] text-accent"
              data-testid="export-plan-stale-duration"
            >
              stale read — the duration above has changed since this plan, estimate and manifest were read, so these numbers are
              not the ones the next request would carry. Press &quot;Estimate at this duration&quot; or &quot;Plan export&quot;
              to re-read them at the duration you typed.
            </p>
          ) : null}
          {/* ------------------------------------------- result summary ---- */}
          <div className="rounded-lg border border-line bg-panel-3/40 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                <Info size={12} /> {result.action ?? "Export result"}
                <Badge tone={result.changed ? "ok" : "neutral"}>
                  {result.changed
                    ? result.action === "clearExportPreset"
                      ? "choice cleared"
                      : "choice changed"
                    : result.action === "applyExportPreset" || result.action === "clearExportPreset"
                      ? "nothing changed"
                      : "read-only"}
                </Badge>
                <Badge tone={result.plan && result.plan["filesProduced"] === 0 ? "neutral" : "neutral"}>
                  filesProduced 0
                </Badge>
                {result.unreadable ? <Badge tone="danger">stored choice unreadable</Badge> : null}
              </p>
              <button
                type="button"
                className="text-[11px] text-ink-faint hover:text-ink"
                onClick={() => {
                  setResult(null);
                  setError(null);
                }}
              >
                Dismiss
              </button>
            </div>
            <p className="mt-2 text-[11px] text-ink-faint" data-testid="export-result-note">
              {result.note}
            </p>
            {(result.changelist ?? []).length > 0 ? (
              <ul className="mt-2 space-y-1" data-testid="export-changelist">
                {(result.changelist ?? []).map((line) => (
                  <li key={line} className="text-[11px] text-ink-dim">
                    · {line}
                  </li>
                ))}
              </ul>
            ) : null}
            {assignment?.applied ? (
              <p className="mt-2 text-[11px] text-ink-dim" data-testid="export-applied-readback">
                persisted choice read back from the project —{" "}
                <span className="font-mono">{assignment.presetIds.join(", ")}</span> · {assignment.count} preset(s) · recorded{" "}
                {assignment.appliedAt ?? "unknown"}
              </p>
            ) : (
              <p className="mt-2 text-[11px] text-ink-dim" data-testid="export-applied-readback">
                persisted choice read back from the project — none applied.
              </p>
            )}
            {(result.previous?.presetIds ?? []).length > 0 || result.action === "clearExportPreset" ? (
              <p className="mt-1 text-[10px] text-ink-faint">
                previous choice:{" "}
                <span className="font-mono">
                  {result.previous && result.previous.presetIds.length > 0 ? result.previous.presetIds.join(", ") : "none"}
                </span>
                {result.previous?.appliedAt ? ` (recorded ${result.previous.appliedAt})` : ""}
              </p>
            ) : null}
          </div>

          {/* ------------------------------------------- size estimate ---- */}
          <div className="rounded-lg border border-line bg-panel-3/40 p-2.5" data-testid="export-size-model">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
              <HardDriveDownload size={12} /> Estimated size — formula and units
            </p>
            <p className="mt-2 font-mono text-[12px] text-ink">{sizeModel?.formula ?? "size = (video bitrate + audio bitrate) × duration ÷ 8"}</p>
            <p className="mt-1 text-[10px] text-ink-faint">
              units: {sizeModel?.units ?? "kbps (1000 bits per second) + kbps → bytes (8 bits per byte)"}
            </p>
            <p className="mt-1 text-[10px] text-ink-faint">{sizeModel?.note}</p>
            {estimateRows.length > 0 ? (
              <ul className="mt-2 space-y-1" data-testid="export-estimate-table">
                {estimateRows.map((row) => (
                  <li key={row.presetId} className="font-mono text-[10px] text-ink-dim" data-testid={`export-estimate-${row.presetId}`}>
                    {row.presetId} · {row.resolution}: {row.estimatedSize.substituted}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-[10px] text-ink-faint">
                No estimate yet — the formula multiplies the duration, so it needs one: type a duration above, or save an editor
                timeline, or give the scenes durations.
              </p>
            )}
            {sizeModel && sizeModel.excludes.length > 0 ? (
              <ul className="mt-2 space-y-0.5">
                {sizeModel.excludes.map((e) => (
                  <li key={e} className="text-[10px] text-ink-faint">
                    · the estimate excludes {e}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {/* --------------------------------------- deliverable manifest ---- */}
          {manifest ? (
            <div className="rounded-lg border border-line bg-panel-3/40 p-2.5" data-testid="export-manifest">
              <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                <Film size={12} /> Deliverable manifest — {manifest.fileCount} output{manifest.fileCount === 1 ? "" : "s"} that
                WOULD be produced
                <Badge tone="danger">filesProduced {manifest.filesProduced}</Badge>
                <Badge tone="neutral">{manifest.durationHuman}</Badge>
                <span className="ml-auto font-mono text-[10px] text-ink-faint">
                  total ≈ {manifest.totalEstimatedHuman} ({int(manifest.totalEstimatedBytes)} bytes)
                </span>
              </p>
              <p className="mt-1.5 text-[11px] text-ink-faint" data-testid="export-manifest-note">
                {manifest.note}
              </p>
              <ul className="mt-2 space-y-2">
                {outputs.map((o) => (
                  <li
                    key={o.presetId}
                    className="rounded border border-line/70 bg-panel-2/50 p-2"
                    data-testid={`export-output-${o.presetId}`}
                  >
                    <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink">
                      <span className="font-mono text-[11px]">{o.fileName}</span>
                      <Badge tone="neutral">{o.platform}</Badge>
                      <span className="ml-auto font-mono text-[10px] text-ink-faint">≈ {o.estimatedSize.human}</span>
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-ink-dim">
                      {o.resolution} ({o.aspect}) · {o.container} · {o.videoCodec} profile {o.videoProfile} · {o.frameRate} fps ·{" "}
                      {int(o.videoBitrateKbps)} + {int(o.audioBitrateKbps)} kbps · {o.audioCodec} {o.sampleRateHz} Hz{" "}
                      {o.channelLayout} · {o.loudnessTargetLufs} LUFS
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-ink-faint">
                      colour {o.colour.display} · {o.colour.standard} / {o.colour.transfer}
                      {o.colour.maxCLL !== null ? ` · maxCLL ${o.colour.maxCLL}` : ""} · bytes {int(o.estimatedSize.bytes)} ·
                      formula {o.estimatedSize.formula}
                    </p>
                    <p className="mt-1 font-mono text-[10px] text-ink-faint">{o.estimatedSize.substituted}</p>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                Not produced by this specification
              </p>
              <ul className="mt-1 space-y-0.5" data-testid="export-not-produced">
                {manifest.notProduced.map((n) => (
                  <li key={n} className="text-[10px] text-ink-faint">
                    · {n}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[10px] text-ink-faint">
                duration {manifest.durationSeconds} s from <span className="font-mono">{manifest.durationSource}</span> · manifest{" "}
                <span className="font-mono">
                  {manifest.format} v{manifest.version}
                </span>
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      {/* -------------------------------- Block 4: finishing deliverables ---- */}
      <div className="mt-3 space-y-3">
        <SidecarSection
          response={sidecars}
          busy={operationallyBusy}
          onRun={() => void run("planSidecars")}
        />
        <ReadinessSection
          response={readiness}
          busy={operationallyBusy}
          targets={targets}
          onToggleTarget={toggleTarget}
          onSelectAll={() => setTargets(PUBLISH_TARGET_VIEWS.map((t) => t.id))}
          onRun={() => void run("checkPublishReadiness")}
        />
      </div>

      {/* ------------------------------ Block 5/6: export job handoff ---- */}
      <JobHandoffSection
        rows={jobs}
        detail={jobDetail}
        busy={busy}
        disabled={operationallyBusy || !projectId}
        selectedJobId={selectedJobId}
        onRun={(action, id) => void run(action, id)}
      />

      {/* --------------------------------------------------- honest gate ---- */}
      {gate && gate.connected === false ? (
        <div className="mt-3" data-testid="export-gate">
          <ProviderNotConnected providerKeys={gate.requiredEnv} note={gate.note} />
          <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2">
            <AlertTriangle size={13} className="text-danger" />
            <p className="text-[11px] text-danger">
              No export file exists and none can be produced here: <span className="font-mono">{gate.capability}</span> is not
              connected, so zero bytes have been written — no frame decoded, no encode, no mux, no HDR metadata authored, no
              upload. Real encoding needs the server-side env var{" "}
              <span className="font-mono">{gateEnvLabel(gate)}</span> (name only, never a value) and the
              capability wired in.
            </p>
          </div>
        </div>
      ) : null}

      {catalogue?.droppedPresets && catalogue.droppedPresets.length > 0 ? (
        <p className="mt-2 text-[10px] text-danger">
          dropped stored preset id(s) that are not in the catalogue: {catalogue.droppedPresets.join(", ")}
        </p>
      ) : null}
    </Card>
  );
}
