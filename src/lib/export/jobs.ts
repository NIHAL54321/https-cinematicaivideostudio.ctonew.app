/**
 * Phase 6 Block 5 — EXPORT JOB HANDOFF (pure engine, client-safe).
 *
 * Everything before this block specified what WOULD be delivered. This module is
 * what turns that specification into an actual export REQUEST: a stored job
 * record whose snapshot freezes the request, whose state is one the app can
 * genuinely reach, and whose body carries the real orchestrator task the app
 * would hand to a video-processing provider.
 *
 * WHAT IS REAL HERE, AND WHAT IS NOT
 *   - REAL: the snapshot (frozen settings, copied out of the project at creation
 *     time), the request (capability id + the preset's real parameters + the
 *     sidecars to mux), the idempotency key, the status history and the stored
 *     record itself.
 *   - NOT REAL: any encoded file. No frame is decoded, no byte is muxed and no
 *     upload happens. Every state that only a connected provider could reach is
 *     declared UNREACHABLE HERE and is never simulated — no progress bar, no
 *     percentage, no ETA and no "completed" state exists in this model at all.
 *
 * Nothing in this file throws for project data it does not like: a snapshot is
 * built from what the project really holds, and a fact that is not known is
 * reported as unknown rather than invented.
 */
import { createHash } from "node:crypto";
import { estimateSize, humanBytes, humanDuration, type SizeEstimate } from "./sizing";
import { outputFileName } from "./manifest";
import { orderPresetIds, type ExportPresetId, type ExportPresetSpec } from "./presets";
import type { SidecarFile, SidecarManifest } from "./sidecars";
import type { TargetReport } from "./readiness";

/* ------------------------------------------------------------------ */
/* Identity                                                            */
/* ------------------------------------------------------------------ */

export const EXPORT_JOB_FORMAT = "cavis.export.job";
export const EXPORT_JOB_VERSION = 1;

/** The three actions this engine exposes (routed by src/lib/editor/service.ts). */
export const EXPORT_JOB_ACTIONS = ["createExportJob", "listExportJobs", "getExportJob"] as const;
export type ExportJobAction = (typeof EXPORT_JOB_ACTIONS)[number];

export function isExportJobAction(v: unknown): v is ExportJobAction {
  return typeof v === "string" && (EXPORT_JOB_ACTIONS as readonly string[]).includes(v);
}

/** How many job records one project keeps. Beyond this, creation is refused. */
export const MAX_EXPORT_JOBS_PER_PROJECT = 25;

/** How many status-history entries one job keeps (older entries are dropped, counted). */
export const MAX_JOB_HISTORY = 20;

/**
 * The capability and task type an export request uses. `video_enhancement` is
 * the app's own encoding/rendering capability (the same one the Phase 5 colour
 * and framing gates and the Phase 6 export surface name), and ENHANCE_VIDEO is
 * the task type the router maps to it (src/lib/ai/router.ts).
 */
export const EXPORT_JOB_CAPABILITY = "video_enhancement" as const;
export const EXPORT_JOB_TASK_TYPE = "ENHANCE_VIDEO" as const;

/* ------------------------------------------------------------------ */
/* The state model — honest, closed, and mostly unreachable            */
/* ------------------------------------------------------------------ */

export const EXPORT_JOB_STATES = ["queued", "blocked", "handed_off", "provider_failed"] as const;
export type ExportJobState = (typeof EXPORT_JOB_STATES)[number];

export interface ExportJobStateInfo {
  state: ExportJobState;
  label: string;
  /**
   * STATIC fact about the state itself (not about this server): true when the
   * state can only ever exist while a provider is connected AND wired for
   * video_enhancement. Whether such a provider exists HERE AND NOW is decided by
   * `connectivity`, never by this flag.
   */
  requiresConnectedProvider: boolean;
  /** True when the job stops changing until a provider is connected. */
  terminal: boolean;
  means: string;
  /**
   * What the state REQUIRES, phrased as a requirement of the state — never as a
   * claim about this server's keys. Null for states that need no provider. The
   * live "why can I not reach it" sentence is built by `unreachableStateReason`
   * from real connectivity, so this file can never tell a keyed server that it
   * has no key.
   */
  requirement: string | null;
}

/**
 * Live provider connectivity for the export capability, as the caller observed
 * it. The reachable/unreachable split is DERIVED from this — never hard-coded —
 * because a hard-coded split contradicts /api/ai/status on a server where a
 * provider key IS set: exactly the contradiction found and fixed on 2026-10-09.
 */
export interface ExportProviderConnectivity {
  /** True when at least one provider slot is configured AND wired for video_enhancement. */
  connected: boolean;
  /** Ids of the provider slots that are configured AND wired right now. */
  connectedProviders: string[];
  /** Ids of every provider slot that advertises the capability right now. */
  candidateProviders: string[];
}

/** The ONE sentence that describes what the two provider-only states need. */
export const EXPORT_PROVIDER_REQUIREMENT =
  "a connected, wired video_enhancement provider (configured AND wired — a key alone is not enough)";

/**
 * The whole state model, stated as WHAT EACH STATE MEANS and WHAT IT REQUIRES.
 * Two states need no provider; two need a connected + wired one. Note what is
 * absent: there is no "encoding", no "uploading" and no "completed" state
 * anywhere — the app has no way to observe encoding progress, so it does not
 * claim any.
 */
export const EXPORT_JOB_STATE_INFO: readonly ExportJobStateInfo[] = [
  {
    state: "queued",
    label: "Queued",
    requiresConnectedProvider: false,
    terminal: false,
    means:
      "Created: the request snapshot is stored and the request has been handed to the AI Model Orchestrator. This is a record " +
      "that the request was made — not that any work started.",
    requirement: null,
  },
  {
    state: "blocked",
    label: "Blocked — Provider Not Connected",
    requiresConnectedProvider: false,
    terminal: true,
    means:
      "The orchestrator's router answered \"Provider Not Connected\": no provider is configured AND wired for video_enhancement, so " +
      "nothing was attempted and nothing was produced. The job stays here until a provider is configured and wired for " +
      "video_enhancement — a key alone never leaves this state.",
    requirement: null,
  },
  {
    state: "handed_off",
    label: "Handed off to a connected provider",
    requiresConnectedProvider: true,
    terminal: true,
    means:
      "A connected provider ACCEPTED the encode request and returned its own output reference. Deliberately not called " +
      "\"completed\": the app has not verified that an encoded file exists, so it does not claim one.",
    requirement: `requires ${EXPORT_PROVIDER_REQUIREMENT}`,
  },
  {
    state: "provider_failed",
    label: "Provider reached, every attempt failed",
    requiresConnectedProvider: true,
    terminal: true,
    means:
      "A connected provider WAS reached and every attempt in the A → B → C → D chain failed; the router's own error is recorded " +
      "verbatim in the status history.",
    requirement: `requires ${EXPORT_PROVIDER_REQUIREMENT}`,
  },
];

/**
 * The states this server can reach with the connectivity it actually reports,
 * and the ones it cannot. The connectivity argument is REQUIRED on purpose: a
 * caller cannot ask for this split without saying what it observed, so the wrong
 * sentence cannot be printed by forgetting to check.
 */
export function reachableJobStates(connectivity: ExportProviderConnectivity): ExportJobStateInfo[] {
  return EXPORT_JOB_STATE_INFO.filter((s) => !s.requiresConnectedProvider || connectivity.connected);
}
export function unreachableJobStates(connectivity: ExportProviderConnectivity): ExportJobStateInfo[] {
  return EXPORT_JOB_STATE_INFO.filter((s) => s.requiresConnectedProvider && !connectivity.connected);
}

/**
 * Why a state cannot be reached HERE AND NOW, derived from live connectivity —
 * or null when it can be reached, or when it needs no provider at all. True in
 * both directions: it never says "no key is set" on a server that has a wired,
 * configured provider, and it never calls a state reachable when none exists.
 */
export function unreachableStateReason(
  state: ExportJobStateInfo,
  connectivity: ExportProviderConnectivity,
): string | null {
  if (!state.requiresConnectedProvider) return null;
  if (connectivity.connected) return null;
  const candidates = connectivity.candidateProviders.length
    ? `${connectivity.candidateProviders.length} provider slot(s) advertise video_enhancement (${connectivity.candidateProviders.join(
        ", ",
      )}) but none is configured AND wired`
    : "no provider slot advertises video_enhancement at all";
  return `requires ${EXPORT_PROVIDER_REQUIREMENT} — right now ${candidates}, so this state cannot be reached`;
}

/** Fields that would only ever be populated by a connected provider. */
export const JOB_PROVIDER_ONLY_FIELDS = [
  "progress",
  "percentComplete",
  "etaSeconds",
  "completedAt",
  "outputUrl",
  "outputBytes",
] as const;

/* ------------------------------------------------------------------ */
/* Snapshot                                                            */
/* ------------------------------------------------------------------ */

/** One output as the request carries it — the preset's real parameters. */
export interface ExportJobOutputSpec {
  presetId: ExportPresetId;
  label: string;
  platform: string;
  fileName: string;
  resolution: string;
  widthPx: number;
  heightPx: number;
  aspect: string;
  container: string;
  video: {
    codec: string;
    codecFamily: string;
    profile: string;
    /** H.264/H.265 level, or null when the preset declares none (e.g. AV1). */
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
  colour: {
    display: string;
    standard: string;
    transfer: string;
    peakNits: number;
    referenceWhiteNits: number;
    maxCLL: number | null;
    maxFALL: number | null;
    note: string;
  };
  subtitleTrack: Record<string, unknown>;
  estimatedSize: SizeEstimate;
}

/**
 * One preset → the exact output spec the request carries. Every number is copied
 * from the preset (src/lib/export/presets.ts), which itself reuses the app's own
 * framing/colour/mix constants — nothing is re-typed here.
 */
export function jobOutputSpec(
  preset: ExportPresetSpec,
  projectTitle: string | null | undefined,
  durationSeconds: number,
): ExportJobOutputSpec {
  return {
    presetId: preset.id,
    label: preset.label,
    platform: preset.platform,
    fileName: outputFileName(projectTitle, preset),
    resolution: preset.resolution,
    widthPx: preset.widthPx,
    heightPx: preset.heightPx,
    aspect: preset.aspect,
    container: preset.container,
    video: {
      codec: preset.video.codec,
      codecFamily: preset.video.codecFamily,
      profile: preset.video.profile,
      level: preset.video.level,
      pixelFormat: preset.video.pixelFormat,
      frameRate: preset.video.frameRate,
      frameRateBasis: preset.video.frameRateBasis,
      bitrateKbps: preset.video.rateControl.targetVideoBitrateKbps,
      maxBitrateKbps: preset.video.rateControl.maxVideoBitrateKbps,
      rateControl: {
        mode: preset.video.rateControl.mode,
        crf: preset.video.rateControl.crf,
        basis: preset.video.rateControl.basis,
      },
    },
    audio: {
      codec: preset.audio.codec,
      sampleRateHz: preset.audio.sampleRateHz,
      channels: preset.audio.channels,
      channelLayout: preset.audio.channelLayout,
      bitrateKbps: preset.audio.audioBitrateKbps,
      loudnessTargetLufs: preset.audio.loudnessTargetLufs,
      truePeakDbfs: preset.audio.truePeakDbfs,
      loudnessBasis: preset.audio.loudnessBasis,
      bitrateBasis: preset.audio.bitrateBasis,
    },
    colour: {
      display: preset.colour.display,
      standard: preset.colour.standard,
      transfer: preset.colour.transfer,
      peakNits: preset.colour.peakNits,
      referenceWhiteNits: preset.colour.referenceWhiteNits,
      maxCLL: preset.colour.maxCLL,
      maxFALL: preset.colour.maxFALL,
      note: preset.colour.note,
    },
    subtitleTrack: { ...preset.subtitleTrack } as Record<string, unknown>,
    estimatedSize: estimateSize({
      videoBitrateKbps: preset.video.rateControl.targetVideoBitrateKbps,
      audioBitrateKbps: preset.audio.audioBitrateKbps,
      durationSeconds,
    }),
  };
}

/** One sidecar as the snapshot freezes it: its state, never its content. */
export interface ExportJobSidecarSpec {
  id: string;
  label: string;
  fileName: string | null;
  mimeType: string;
  container: string;
  contentState: string;
  bytes: number | null;
  truncated: boolean;
  requires: string | null;
  requiresEnv: string | null;
}

export function jobSidecarSpecs(sidecars: SidecarManifest | null): ExportJobSidecarSpec[] {
  if (!sidecars) return [];
  return sidecars.files.map((f: SidecarFile) => ({
    id: f.id,
    label: f.label,
    fileName: f.fileName,
    mimeType: f.mimeType,
    container: f.container,
    contentState: f.contentState,
    bytes: f.bytes,
    truncated: f.truncated,
    requires: f.requires,
    requiresEnv: f.requiresEnv,
  }));
}

/** One publish target's verdict as the snapshot freezes it. */
export interface ExportJobReadinessVerdict {
  targetId: string;
  label: string;
  platform: string;
  verdict: string;
  counts: { pass: number; fail: number; unknown: number; total: number };
  blockingFailures: string[];
  unknownRequired: string[];
  warnings: string[];
}

export function jobReadinessVerdicts(reports: readonly TargetReport[]): ExportJobReadinessVerdict[] {
  return reports.map((r) => ({
    targetId: r.targetId,
    label: r.label,
    platform: r.platform,
    verdict: r.verdict,
    counts: { ...r.counts },
    blockingFailures: [...r.blockingFailures],
    unknownRequired: [...r.unknownRequired],
    warnings: [...r.warnings],
  }));
}

/**
 * The frozen snapshot. Every field is a COPY taken at creation time: the stored
 * record never re-reads the project, so a later edit cannot silently change a
 * job that was already requested.
 */
export interface ExportJobSnapshot {
  format: string;
  version: number;
  kind: "request-snapshot";
  projectId: string;
  projectTitle: string | null;
  capturedAt: string;
  presetAssignment: { presetIds: ExportPresetId[]; appliedAt: string | null; source: string; note: string };
  duration: { seconds: number; human: string; source: string; note: string };
  outputs: ExportJobOutputSpec[];
  sidecars: ExportJobSidecarSpec[];
  sidecarCounts: { exists: number; requiresGeneration: number; empty: number };
  readiness: ExportJobReadinessVerdict[];
  cueCount: number;
  of: string[];
  note: string;
}

/** What the snapshot is OF — stated on every response that carries one. */
export const SNAPSHOT_OF = [
  "the applied export preset set (ProjectSettings.extra.exportPreset, read once at creation)",
  "the resolved duration and the source it was resolved from",
  "each output's full spec (container, codec/profile/level, resolution, frame rate, bitrate, audio layout, loudness, colour tagging) and its estimated size",
  "the sidecar list with each sidecar's content state (exists / requires-generation / empty) and the env var name any missing one needs",
  "the per-platform publish-readiness verdicts as they stood at the time of the request",
];

export function snapshotNote(capturedAt: string): string {
  return (
    `This is a SNAPSHOT of the export request taken at ${capturedAt}. It is stored with this job and does NOT change when the ` +
    "project changes — edit the project and create a new job to capture a new snapshot. It is a record of what was REQUESTED, " +
    "not a record of anything produced."
  );
}

/* ------------------------------------------------------------------ */
/* The orchestrator request                                            */
/* ------------------------------------------------------------------ */

/**
 * The exact task the app hands to the AI Model Orchestrator for encoding. The
 * shape is an `AiTask`: type ENHANCE_VIDEO, capability video_enhancement, and a
 * payload carrying the deliverable's real parameters plus the sidecars to mux.
 *
 * `videoRef` names the app's OWN edit (the project's timeline). No rendered
 * source file exists, so the reference is internal and says so — it is not a
 * pretend URL to a file that was never produced.
 */
export interface ExportJobRouterRequest {
  type: typeof EXPORT_JOB_TASK_TYPE;
  capability: typeof EXPORT_JOB_CAPABILITY;
  projectId: string;
  payload: {
    videoRef: string;
    videoRefKind: string;
    durationSeconds: number;
    durationSource: string;
    deliverable: ExportJobOutputSpec;
    outputs: ExportJobOutputSpec[];
    sidecarsToMux: {
      id: string;
      fileName: string | null;
      mimeType: string;
      contentState: string;
      bytes: number | null;
    }[];
    loudnessTargetLufs: number;
    truePeakDbfs: number;
  };
  params: {
    format: string;
    resolution: string;
    aspectRatio: string;
    durationSeconds: number;
    videoType: "longform" | "shorts";
    requirements: string[];
  };
  metadata: {
    source: "export-job";
    jobId: string;
    requestKey: string;
    snapshotCapturedAt: string;
    snapshotOf: string[];
  };
}

/** The project's own timeline, referenced honestly (there is no rendered file). */
export function exportSourceRef(projectId: string): string {
  return `project-timeline://${projectId}`;
}

export const EXPORT_SOURCE_REF_KIND =
  "the project's own editor timeline inside this app — no rendered or uploaded source file exists yet, and none is pretended";

/** Long-form vs Shorts, from the preset's own aspect (never guessed). */
function videoTypeFor(spec: ExportJobOutputSpec): "longform" | "shorts" {
  return spec.aspect === "16:9" ? "longform" : "shorts";
}

/**
 * Build the request. `primary` is the FIRST output in catalogue order and is
 * mirrored at payload.deliverable; every output travels in payload.outputs, so a
 * multi-preset job is ONE request that names all of them.
 */
export function buildExportJobRouterRequest(input: {
  projectId: string;
  jobId: string;
  requestKey: string;
  capturedAt: string;
  durationSeconds: number;
  durationSource: string;
  outputs: readonly ExportJobOutputSpec[];
  sidecars: readonly ExportJobSidecarSpec[];
}): ExportJobRouterRequest {
  const primary = input.outputs[0];
  const requirements = input.outputs.some((o) => o.widthPx >= 3840) ? ["4k"] : [];
  // The widest required resolution drives routing (the router's own 4K check).
  const widest = input.outputs.reduce((best, o) => (o.widthPx > best.widthPx ? o : best), primary);
  return {
    type: EXPORT_JOB_TASK_TYPE,
    capability: EXPORT_JOB_CAPABILITY,
    projectId: input.projectId,
    payload: {
      videoRef: exportSourceRef(input.projectId),
      videoRefKind: EXPORT_SOURCE_REF_KIND,
      durationSeconds: input.durationSeconds,
      durationSource: input.durationSource,
      deliverable: primary,
      outputs: [...input.outputs],
      sidecarsToMux: input.sidecars.map((s) => ({
        id: s.id,
        fileName: s.fileName,
        mimeType: s.mimeType,
        contentState: s.contentState,
        bytes: s.bytes,
      })),
      loudnessTargetLufs: primary.audio.loudnessTargetLufs,
      truePeakDbfs: primary.audio.truePeakDbfs,
    },
    params: {
      format: primary.container,
      resolution: widest.resolution,
      aspectRatio: widest.aspect,
      durationSeconds: input.durationSeconds,
      videoType: videoTypeFor(widest),
      requirements,
    },
    metadata: {
      source: "export-job",
      jobId: input.jobId,
      requestKey: input.requestKey,
      snapshotCapturedAt: input.capturedAt,
      snapshotOf: [...SNAPSHOT_OF],
    },
  };
}

/* ------------------------------------------------------------------ */
/* Idempotency key                                                     */
/* ------------------------------------------------------------------ */

/**
 * The canonical facts that DEFINE an encode request. Two requests with the same
 * canonical facts are the same request, so the second returns the first job
 * (explicit de-duplication) instead of creating a near-duplicate.
 */
export interface ExportJobRequestFacts {
  projectId: string;
  presetIds: readonly ExportPresetId[];
  durationSeconds: number;
  durationSource: string;
  sidecarStates: readonly (readonly [string, string])[];
  cueCount: number;
}

export function canonicalRequest(facts: ExportJobRequestFacts): string {
  return JSON.stringify({
    projectId: facts.projectId,
    presetIds: orderPresetIds([...facts.presetIds]),
    durationSeconds: facts.durationSeconds,
    durationSource: facts.durationSource,
    sidecarStates: facts.sidecarStates.map(([id, state]) => [id, state]),
    cueCount: facts.cueCount,
  });
}

export function jobRequestKey(facts: ExportJobRequestFacts): string {
  return `sha256:${createHash("sha256").update(canonicalRequest(facts)).digest("hex").slice(0, 32)}`;
}

export const DEDUPE_BASIS =
  "sha256 of the canonical request: project id, the applied presets in catalogue order, the resolved duration and its source, " +
  "each sidecar's content state in catalogue order, and the subtitle cue count";

export const DEDUPE_NOTE =
  "Repeated IDENTICAL requests are de-duplicated: the second returns the SAME job (created: false, deduplicated: true) with its " +
  "original snapshot and history. A request whose facts differ (different presets, duration, sidecar content states or cue count) " +
  "is a different request and creates a new job. This is explicit de-duplication, not a silent merge.";

/* ------------------------------------------------------------------ */
/* The stored record                                                   */
/* ------------------------------------------------------------------ */

export interface ExportJobHistoryEntry {
  at: string;
  event: string;
  state: ExportJobState;
  detail: string;
  /** Present only on entries that record an orchestrator answer. */
  routerStatus?: string;
  requiredEnv?: string[];
}

/** The orchestrator's answer, recorded verbatim (never prettified). */
export interface ExportJobRouterAnswer {
  capability: string;
  taskType: string;
  status: string;
  provider: string | null;
  model: string | null;
  /** Env var NAMES only — the router's own list, exactly as it returned it. */
  requiredEnv: string[];
  /** The router's own message, character for character. */
  error: string | null;
  attempts: { provider: string; model: string | null; status: string; error: string | null; at: string }[];
  generationId: string | null;
  at: string;
}

export interface ExportJobRecord {
  format: string;
  version: number;
  id: string;
  projectId: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  requestKey: string;
  state: ExportJobState;
  snapshot: ExportJobSnapshot;
  routerRequest: ExportJobRouterRequest;
  router: ExportJobRouterAnswer;
  statusHistory: ExportJobHistoryEntry[];
  droppedHistoryEntries: number;
  /** Always null: only a connected provider could populate these. */
  progress: null;
  percentComplete: null;
  etaSeconds: null;
  completedAt: null;
  outputUrl: null;
  outputBytes: null;
  filesProduced: 0;
}

/** The honest "nothing produced" block carried by every job view. */
export function notProducedBlock(): Record<string, unknown> {
  return {
    filesProduced: 0,
    progress: null,
    percentComplete: null,
    etaSeconds: null,
    completedAt: null,
    outputUrl: null,
    outputBytes: null,
    note:
      "No encoding, muxing or upload happened, so there is nothing to report progress about: every provider-only field is null " +
      "rather than a zero that could be mistaken for a measurement. `filesProduced: 0` means zero files exist.",
  };
}

export function jobView(job: ExportJobRecord): Record<string, unknown> {
  return {
    jobId: job.id,
    projectId: job.projectId,
    state: job.state,
    stateLabel: (EXPORT_JOB_STATE_INFO.find((s) => s.state === job.state) ?? EXPORT_JOB_STATE_INFO[0]).label,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    requestKey: job.requestKey,
    snapshot: job.snapshot,
    routerRequest: job.routerRequest,
    router: job.router,
    statusHistory: job.statusHistory,
    droppedHistoryEntries: job.droppedHistoryEntries,
    ...notProducedBlock(),
  };
}

/** A list row: enough to see the job, without shipping every snapshot twice. */
export function jobSummaryView(job: ExportJobRecord): Record<string, unknown> {
  const last = job.statusHistory.at(-1) ?? null;
  return {
    jobId: job.id,
    projectId: job.projectId,
    state: job.state,
    stateLabel: (EXPORT_JOB_STATE_INFO.find((s) => s.state === job.state) ?? EXPORT_JOB_STATE_INFO[0]).label,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    requestKey: job.requestKey,
    snapshotCapturedAt: job.snapshot.capturedAt,
    presetIds: job.snapshot.presetAssignment.presetIds,
    durationSeconds: job.snapshot.duration.seconds,
    durationSource: job.snapshot.duration.source,
    outputCount: job.snapshot.outputs.length,
    sidecarCounts: job.snapshot.sidecarCounts,
    estimatedTotalBytes: job.snapshot.outputs.reduce((sum, o) => sum + o.estimatedSize.bytes, 0),
    cueCount: job.snapshot.cueCount,
    routerStatus: job.router.status,
    routerRequiredEnv: job.router.requiredEnv,
    historyCount: job.statusHistory.length,
    lastHistoryEntry: last,
    filesProduced: 0,
    progress: null,
    percentComplete: null,
    completedAt: null,
  };
}

/* ------------------------------------------------------------------ */
/* Stored-record normalisation                                         */
/* ------------------------------------------------------------------ */

export interface NormalizedJobs {
  jobs: ExportJobRecord[];
  /** True when the stored value was present but not a readable job list. */
  unreadable: boolean;
  /** Records dropped because their shape was not usable, with the reason. */
  dropped: { index: number; reason: string }[];
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Read the stored job list LENIENTLY. A record that cannot be read as a job is
 * dropped and REPORTED (never silently repaired into a job that claims things
 * its stored data did not say), and an unreadable blob is reported as such.
 */
export function normalizeExportJobs(raw: unknown): NormalizedJobs {
  if (raw === null || raw === undefined) return { jobs: [], unreadable: false, dropped: [] };
  if (!Array.isArray(raw)) return { jobs: [], unreadable: true, dropped: [] };
  const jobs: ExportJobRecord[] = [];
  const dropped: { index: number; reason: string }[] = [];
  raw.forEach((entry, index) => {
    if (!isObj(entry) || entry.format !== EXPORT_JOB_FORMAT || typeof entry.id !== "string" || !isObj(entry.snapshot)) {
      dropped.push({ index, reason: "not an export-job record (missing format, id or snapshot)" });
      return;
    }
    if (!(EXPORT_JOB_STATES as readonly string[]).includes(String(entry.state))) {
      dropped.push({ index, reason: `unknown state "${String(entry.state)}"` });
      return;
    }
    jobs.push(entry as unknown as ExportJobRecord);
  });
  return { jobs, unreadable: false, dropped };
}

/* ------------------------------------------------------------------ */
/* Small shared formatting                                             */
/* ------------------------------------------------------------------ */

export function humanBytesOrNull(bytes: number | null): string | null {
  return typeof bytes === "number" && Number.isFinite(bytes) ? humanBytes(bytes) : null;
}

export function durationHuman(seconds: number): string | null {
  return seconds > 0 ? humanDuration(seconds) : null;
}
