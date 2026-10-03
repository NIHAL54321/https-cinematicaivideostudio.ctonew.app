/**
 * Phase 6 Block 1 — Export / finishing API service (tenant-scoped, store-injected).
 *
 * The logic for the four export API actions lives here, expressed against a tiny
 * `ExportStore` interface so it can be exercised by contract tests without a
 * database. The HTTP route (src/app/api/studio/editor/route.ts) reaches this
 * through src/lib/editor/service.ts — one surface, no parallel API.
 *
 * DETERMINISTIC (real work, nothing faked):
 *   listExportPresets — the eight delivery presets with every declared number
 *                       (container, codec + profile, resolution, frame rate,
 *                       bitrate + its basis, audio codec/sample rate/channels,
 *                       loudness target and the SDR/HDR colour tagging) plus the
 *                       project's applied set and the estimate at the project's
 *                       duration.
 *   planExport        — the DELIVERABLE MANIFEST: one output per chosen preset
 *                       (name, resolution, codec, container, estimated size from
 *                       the stated formula) and an explicit list of what is NOT
 *                       produced.
 *   applyExportPreset — PERSISTS the chosen preset ids as project metadata
 *                       (ProjectSettings.extra.exportPreset) and reports the
 *                       manifest that choice produces, read back. Re-applying the
 *                       same set is a no-op (`changed: false`, no write).
 *   clearExportPreset — CLEARS the stored choice (writes a bare null, so nothing
 *                       is left half-applied). Clearing an already-clear project
 *                       is a no-op.
 *
 * PROVIDER-GATED (honest gate, nothing produced):
 *   Encoding, muxing, subtitle muxing, HDR metadata authoring and uploading need
 *   a real video-processing pipeline (`video_enhancement`). None is wired:
 *   `connected: false`, and every response that touches encoding carries
 *   `provider: { capability, connected, requiredEnv, envHint, note }` naming the
 *   env var `VIDEO_PROCESSING_API_KEY` (name only — never a value) and
 *   `filesProduced: 0`. No file is written anywhere by this module.
 *
 * Tenancy: every action resolves the project through
 * `store.findOwnedProject(userId, projectId)` first; a missing OR foreign project
 * is a 404 (never 403) so the API leaks nothing about other tenants.
 */
import { fromSnapshot } from "../editor/versions";
import { buildTimelineFromScenes, type Timeline } from "../editor/timeline";
import { buildSubtitles, type SegmentTimingView, type SubtitlePlan } from "../subtitles/engine";
import { buildMix } from "../mix/engine";
import { slugifyProjectTitle } from "./manifest";
import {
  buildSidecarManifest,
  type SidecarManifest,
  type SubtitleSidecar,
} from "./sidecars";
import { buildChapterPlan, type ChapterBeat } from "./chapters";
import {
  PUBLISH_TARGET_IDS,
  checkPublishReadiness,
  findPublishTarget,
  isPublishTargetId,
  orderPublishTargetIds,
  publishTargetCatalogueNote,
  readinessMediaAnalysisGate,
  unknownPublishTargetIds,
  type PublishTargetId,
  type ReadinessInput,
  type TargetReport,
} from "./readiness";
import {
  EXPORT_PRESETS,
  findExportPreset,
  isExportPresetId,
  listExportPresetViews,
  orderPresetIds,
  presetView,
  type ExportPresetId,
  type ExportPresetSpec,
} from "./presets";
import { NOT_PRODUCED, buildDeliverableManifest, type DeliverableManifest } from "./manifest";
import {
  EMPTY_EXPORT_ASSIGNMENT,
  exportAssignmentView,
  exportAssignmentsEqual,
  isEmptyExportAssignment,
  normalizeExportAssignment,
  presetCatalogueNote,
  serializeExportAssignment,
  unknownPresetIds,
  type ExportAssignment,
} from "./assignment";
import {
  MAX_EXPORT_DURATION_SECONDS,
  SIZE_EXCLUDES,
  SIZE_FORMULA,
  SIZE_FORMULA_UNITS,
  SizeError,
  estimateSize,
  humanDuration,
} from "./sizing";

/* ------------------------------------------------------------------ */
/* Provider gating                                                     */
/* ------------------------------------------------------------------ */

/**
 * Env var NAME (never a value) a server operator sets to connect a real
 * encoding / muxing / rendering pipeline. The name is the same one the Phase 5
 * colour and framing gates use, so one key covers the whole finishing surface.
 */
export const EXPORT_ENCODE_ENV = "VIDEO_PROCESSING_API_KEY";

/** No provider is wired anywhere in this block. One switch flips it later. */
export const EXPORT_PROVIDER_CONNECTED = false;

export const EXPORT_ENCODE_CAPABILITY = "video_enhancement";

export interface ProviderGate {
  capability: string;
  connected: boolean;
  /** Env var NAMES (never values) a server operator must set. */
  requiredEnv: string[];
  envHint: string | null;
  note: string;
}

/**
 * The honest gate the export surface carries. `connected` mirrors
 * EXPORT_PROVIDER_CONNECTED, `requiredEnv` lists env var NAMES only, and the note
 * says exactly what was NOT produced.
 */
export function exportProviderGate(what: string): ProviderGate {
  return {
    capability: EXPORT_ENCODE_CAPABILITY,
    connected: EXPORT_PROVIDER_CONNECTED,
    requiredEnv: [EXPORT_ENCODE_ENV],
    envHint: EXPORT_ENCODE_ENV,
    note:
      `${what} needs a connected video-processing pipeline. ${EXPORT_ENCODE_CAPABILITY} is not wired into the export ` +
      `surface, so no frame was decoded, encoded or muxed, no subtitle track was muxed, no HDR metadata was authored and no ` +
      `file was written or uploaded. Nothing about the specification below is a produced file. A server operator enables real ` +
      `encoding by setting the env var ${EXPORT_ENCODE_ENV} (name only — never a value) and wiring the capability.`,
  };
}

/* ------------------------------------------------------------------ */
/* Store contract                                                      */
/* ------------------------------------------------------------------ */

export interface ExportSceneRow {
  id: string;
  title: string | null;
  durationSeconds: number | null;
  /**
   * Block 3 — the scene's narration text. It is the ONLY cue source the app
   * owns, so it is what the subtitle sidecar is built from. Absent (undefined)
   * means "this store does not expose narration", which is reported as an empty
   * cue list, never as invented cues.
   */
  narration?: string | null;
  /** Block 3 — the chapter title this scene belongs to, when the store knows it. */
  chapterTitle?: string | null;
}

/** Block 3 — the project-level text and declared format the readiness check reads. */
export interface ExportProjectMeta {
  description: string | null;
  /** The Prisma `AspectRatio` enum value, or null when the project declares none. */
  targetAspect: string | null;
  targetDurationSeconds: number | null;
  /** ProjectSettings.seoDefaults, already reduced to the three usable fields. */
  seoDefaults: { title: string | null; description: string | null; tags: string[] | null } | null;
  /** Where the SEO metadata came from (stated, never guessed). */
  seoDefaultsSource: string | null;
}

/** Block 3 — a thumbnail asset the project already holds. */
export interface ThumbnailAssetRow {
  id: string;
  name: string;
  /** Prisma `AssetStatus` — only READY is a usable deliverable. */
  status: string;
  widthPx: number | null;
  heightPx: number | null;
}

export interface ExportStore {
  /** Tenant-scoped project lookup (null when missing OR owned by someone else). */
  findOwnedProject(userId: string, projectId: string): Promise<{ id: string; title: string } | null>;
  listScenes(projectId: string): Promise<ExportSceneRow[]>;
  /** ProjectSettings.extra.editorTimeline (unvalidated raw JSON) or null. */
  readRawTimeline(projectId: string): Promise<unknown | null>;
  /** ProjectSettings.extra.exportPreset (unvalidated raw JSON) or null. */
  readExportPreset(projectId: string): Promise<unknown | null>;
  writeExportPreset(projectId: string, value: unknown): Promise<void>;
  /**
   * Block 3 — the project's own description, declared target aspect and SEO
   * defaults. OPTIONAL, like `findOwnedProject`'s `targetAspect` in the editor
   * store: a store that predates Block 3 simply has no project metadata, which
   * the sidecar and readiness reports state as "not stored" rather than
   * inventing a value. The Prisma store implements it.
   */
  readProjectMeta?(projectId: string): Promise<ExportProjectMeta | null>;
  /**
   * Block 3 — the project's thumbnail assets (kind THUMBNAIL). OPTIONAL for the
   * same reason: no method means no thumbnail data, which is the same honest
   * answer as a project with no thumbnail.
   */
  listThumbnailAssets?(projectId: string): Promise<ThumbnailAssetRow[]>;
  /**
   * Block 5 — the project's export JOB records
   * (ProjectSettings.extra.exportJobs, unvalidated raw JSON) or null. OPTIONAL
   * here for the same backward-compatible reason; the Block 5 job service
   * requires both through its own `ExportJobStore` (src/lib/export/job-service.ts),
   * and refuses to create a job when the store cannot persist one.
   */
  readExportJobs?(projectId: string): Promise<unknown | null>;
  writeExportJobs?(projectId: string, value: unknown): Promise<void>;
}

export interface ExportResult {
  status: number;
  body: Record<string, unknown>;
}

export const EXPORT_ACTIONS = [
  "listExportPresets",
  "planExport",
  "applyExportPreset",
  "clearExportPreset",
  "planSidecars",
  "checkPublishReadiness",
] as const;
export type ExportAction = (typeof EXPORT_ACTIONS)[number];

export function isExportAction(v: unknown): v is ExportAction {
  return typeof v === "string" && (EXPORT_ACTIONS as readonly string[]).includes(v);
}

/** A manifest is emitted for at most this many outputs; the catalogue is 8. */
export const MAX_MANIFEST_OUTPUTS = 12;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function fail(status: number, error: string, code: string, extra: Record<string, unknown> = {}): ExportResult {
  return { status, body: { error, code, ...extra } };
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/* ------------------------------------------------------------------ */
/* Duration resolution (never guessed)                                 */
/* ------------------------------------------------------------------ */

export type DurationSource = "request" | "timeline" | "scenes" | "none";

export interface ResolvedDuration {
  seconds: number;
  source: DurationSource;
  note: string;
}

export async function resolveDuration(
  store: ExportStore,
  projectId: string,
  body: Record<string, unknown>,
): Promise<{ duration?: ResolvedDuration; error?: ExportResult }> {
  if (body.durationSeconds !== undefined && body.durationSeconds !== null) {
    const raw = body.durationSeconds;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0 || raw > MAX_EXPORT_DURATION_SECONDS) {
      return {
        error: fail(400, "durationSeconds must be a number greater than 0 and at most 7200 (120 minutes).", "invalid_duration", {
          received: raw,
          maxSeconds: MAX_EXPORT_DURATION_SECONDS,
          note: "The size estimate multiplies the duration, so a duration that is not a real positive length is refused rather than estimated.",
        }),
      };
    }
    return {
      duration: {
        seconds: round3(raw),
        source: "request",
        note: `Duration supplied in the request: ${raw} s (${humanDuration(raw)}).`,
      },
    };
  }

  const rawTimeline = await store.readRawTimeline(projectId);
  const timeline = rawTimeline === null || rawTimeline === undefined ? null : fromSnapshot(rawTimeline);
  if (timeline && timeline.durationMs > 0) {
    return {
      duration: {
        seconds: round3(timeline.durationMs / 1000),
        source: "timeline",
        note: `Duration read from the saved editor timeline: ${timeline.durationMs} ms.`,
      },
    };
  }

  const scenes = await store.listScenes(projectId);
  const sceneSeconds = scenes.reduce((sum, s) => sum + (typeof s.durationSeconds === "number" && s.durationSeconds > 0 ? s.durationSeconds : 0), 0);
  if (sceneSeconds > 0) {
    return {
      duration: {
        seconds: round3(sceneSeconds),
        source: "scenes",
        note: `Duration summed from ${scenes.length} scene duration(s): ${round3(sceneSeconds)} s.`,
      },
    };
  }

  return {
    duration: { seconds: 0, source: "none", note: "No duration is available: no duration was supplied, no readable editor timeline exists and no scene carries a duration." },
  };
}

/* ------------------------------------------------------------------ */
/* Preset selection                                                    */
/* ------------------------------------------------------------------ */

type SelectionSource = "request" | "applied" | "all";

export interface Selection {
  presetIds: ExportPresetId[];
  source: SelectionSource;
}

function parseRequestedPresetIds(raw: unknown): { ids?: ExportPresetId[]; error?: ExportResult } {
  if (!Array.isArray(raw)) {
    return {
      error: fail(400, "presetIds must be an array of preset ids.", "invalid_preset_ids", {
        received: raw,
        note: presetCatalogueNote(),
      }),
    };
  }
  if (raw.length === 0) {
    return {
      error: fail(400, "presetIds must name at least one preset.", "invalid_preset_ids", { note: presetCatalogueNote() }),
    };
  }
  const unknown = unknownPresetIds(raw);
  if (unknown.length > 0) {
    return {
      error: fail(400, "Unknown export preset id.", "unknown_preset", { unknown, note: presetCatalogueNote() }),
    };
  }
  const ids = orderPresetIds(raw);
  if (ids.length > MAX_MANIFEST_OUTPUTS) {
    return {
      error: fail(400, `At most ${MAX_MANIFEST_OUTPUTS} presets may be planned at once.`, "too_many_presets", {
        count: ids.length,
        max: MAX_MANIFEST_OUTPUTS,
      }),
    };
  }
  return { ids };
}

export function selectPresets(body: Record<string, unknown>, applied: ExportAssignment): { selection?: Selection; error?: ExportResult } {
  if (body.presetIds !== undefined && body.presetIds !== null) {
    const parsed = parseRequestedPresetIds(body.presetIds);
    if (parsed.error) return { error: parsed.error };
    return { selection: { presetIds: parsed.ids as ExportPresetId[], source: "request" } };
  }
  if (applied.presetIds.length > 0) return { selection: { presetIds: applied.presetIds, source: "applied" } };
  return { selection: { presetIds: orderPresetIds(EXPORT_PRESETS.map((p) => p.id)), source: "all" } };
}

/* ------------------------------------------------------------------ */
/* Shared view pieces                                                  */
/* ------------------------------------------------------------------ */

function presetViewsFor(ids: readonly ExportPresetId[]): Record<string, unknown>[] {
  return orderPresetIds(ids)
    .map((id) => findExportPreset(id))
    .filter((p): p is ExportPresetSpec => p !== null)
    .map(presetView);
}

function estimateViews(ids: readonly ExportPresetId[], durationSeconds: number): Record<string, unknown>[] {
  return orderPresetIds(ids)
    .map((id) => findExportPreset(id))
    .filter((p): p is ExportPresetSpec => p !== null)
    .map((preset) => ({
      presetId: preset.id,
      resolution: preset.resolution,
      videoBitrateKbps: preset.video.rateControl.targetVideoBitrateKbps,
      audioBitrateKbps: preset.audio.audioBitrateKbps,
      estimatedSize: estimateSize({
        videoBitrateKbps: preset.video.rateControl.targetVideoBitrateKbps,
        audioBitrateKbps: preset.audio.audioBitrateKbps,
        durationSeconds,
      }),
    }));
}

function sizeModelView(): Record<string, unknown> {
  return {
    formula: SIZE_FORMULA,
    units: SIZE_FORMULA_UNITS,
    excludes: [...SIZE_EXCLUDES],
    estimate: true,
    produced: false,
    note:
      "size = (video bitrate + audio bitrate) × duration ÷ 8, with both bitrates in kbps (1000 bits/s), the duration in " +
      "seconds and the result in bytes (8 bits/byte). This is an ESTIMATE from the preset's planning bitrate: it is not a " +
      "measurement of a file, because no file exists.",
  };
}

/** A typed 400 from a SizeError raised while building a manifest. */
function sizeErrorResult(err: SizeError): ExportResult {
  return fail(400, err.message, err.code, {
    maxSeconds: MAX_EXPORT_DURATION_SECONDS,
    note: "The estimate needs a positive duration of at most 120 minutes; anything else is refused rather than estimated.",
  });
}

/* ------------------------------------------------------------------ */
/* Block 3 — the finishing context                                     */
/* ------------------------------------------------------------------ */

/** Every real input the sidecar and readiness surfaces read, in one place. */
export interface FinishContext {
  scenes: ExportSceneRow[];
  timeline: Timeline;
  timelineSource: "saved" | "scenes";
  meta: ExportProjectMeta | null;
  thumbnail: ThumbnailAssetRow | null;
  /** Thumbnail assets that exist but are not usable, reported not hidden. */
  thumbnailNote: string;
  duration: ResolvedDuration;
  beats: ChapterBeat[];
  plan: SubtitlePlan;
  cueSource: string;
  stageCaptionSource: string;
}

/** The scene beats chapters are derived from: the timeline's own scene spans. */
function beatsFromTimeline(timeline: Timeline, scenes: readonly ExportSceneRow[]): ChapterBeat[] {
  const byScene = new Map<string, { startMs: number; endMs: number }>();
  for (const clip of timeline.clips) {
    if (clip.trackId !== "video" || !clip.sceneId) continue;
    const span = byScene.get(clip.sceneId);
    if (!span) byScene.set(clip.sceneId, { startMs: clip.startMs, endMs: clip.endMs });
    else {
      span.startMs = Math.min(span.startMs, clip.startMs);
      span.endMs = Math.max(span.endMs, clip.endMs);
    }
  }
  const rowById = new Map(scenes.map((s) => [s.id, s]));
  return [...byScene.entries()]
    .map(([sceneId, span]) => {
      const row = rowById.get(sceneId);
      return {
        sceneId,
        // The scene's own title; the chapter plan labels a missing title
        // positionally and says so (never a generated title).
        title: row?.title ?? null,
        startMs: span.startMs,
        endMs: span.endMs,
      };
    })
    .sort((a, b) => a.startMs - b.startMs);
}

/**
 * The subtitle plan: cue TEXT from the project's scene narration, cue TIMING
 * from the scene's real window on the timeline. A scene without narration
 * contributes no cue — nothing is invented — and a project with no narration at
 * all yields zero cues, which is reported as zero.
 */
function buildCaptionPlan(beats: readonly ChapterBeat[], scenes: readonly ExportSceneRow[]): { plan: SubtitlePlan; cueSource: string; stageCaptionSource: string } {
  const rowById = new Map(scenes.map((s) => [s.id, s]));
  const segments: SegmentTimingView[] = [];
  let narrated = 0;
  for (const beat of beats) {
    if (!beat.sceneId) continue;
    const narration = rowById.get(beat.sceneId)?.narration;
    if (typeof narration !== "string" || !narration.trim()) continue;
    if (beat.endMs <= beat.startMs) continue;
    narrated += 1;
    segments.push({ startMs: beat.startMs, endMs: beat.endMs, text: narration.trim() });
  }
  const plan = buildSubtitles(segments.length > 0 ? { segments, language: "en", style: "minimal" } : {});
  const cueSource =
    segments.length > 0
      ? `${narrated} narrated scene(s) of ${beats.length} on the timeline; sentence timing from each scene's window on the timeline, word timing from the subtitle engine's own estimate model`
      : `0 of ${beats.length} scene(s) on the timeline carry narration, so the subtitle engine had no text to subtitle`;
  const stageCaptionSource =
    segments.length > 0
      ? "scene narration + the timeline's scene windows (deterministic; no provider was called)"
      : "none — this project's scenes carry no narration";
  return { plan, cueSource, stageCaptionSource };
}

/**
 * The final-mix engine's ESTIMATE for this timeline. `null` when the timeline has
 * no voice, music or SFX clips at all — there is then no mix to judge, which the
 * loudness rule reports as UNKNOWN rather than assuming a level.
 */
function mixEstimateFor(timeline: Timeline): ReadinessInput["mix"] {
  const gainsFor = (trackId: "voice" | "music" | "sfx"): { gain?: number } => {
    const clips = timeline.clips.filter((c) => c.trackId === trackId && c.endMs > c.startMs);
    if (clips.length === 0) return {};
    const withGain = clips.filter((c) => typeof c.gain === "number" && Number.isFinite(c.gain));
    // The timeline's own declared gain when it has one; otherwise the mix
    // engine's default applies and the model string below says so.
    return withGain.length > 0 ? { gain: withGain[0].gain as number } : {};
  };
  const voice = gainsFor("voice");
  const music = gainsFor("music");
  const sfx = gainsFor("sfx");
  const hasAudioClips = Object.keys(voice).length + Object.keys(music).length + Object.keys(sfx).length > 0;
  const plan = buildMix({ voice, music, sfx });
  return {
    estimateLufs: plan.loudness.measuredEstimateLufs,
    targetLufs: plan.loudness.targetLufs,
    hasAudioClips,
    model: plan.loudness.model,
  };
}

/** The thumbnail the project would deliver: a READY asset, or nothing. */
function chooseThumbnail(assets: readonly ThumbnailAssetRow[]): { chosen: ThumbnailAssetRow | null; note: string } {
  if (assets.length === 0) return { chosen: null, note: "no thumbnail asset exists for this project" };
  const ready = assets.find((a) => a.status === "READY");
  if (!ready) {
    return {
      chosen: null,
      note: `${assets.length} thumbnail asset(s) exist but none is READY (statuses: ${assets.map((a) => a.status).join(", ")})`,
    };
  }
  return {
    chosen: ready,
    note: `thumbnail asset "${ready.name}" (status READY${ready.widthPx && ready.heightPx ? `, ${ready.widthPx}×${ready.heightPx}` : ", dimensions not recorded"})`,
  };
}

/** Read every Block 3 input for a project in one pass. Never writes anything. */
export async function loadFinishContext(
  store: ExportStore,
  projectId: string,
  duration: ResolvedDuration,
): Promise<FinishContext> {
  const scenes = await store.listScenes(projectId);
  const rawTimeline = await store.readRawTimeline(projectId);
  const saved = rawTimeline === null || rawTimeline === undefined ? null : fromSnapshot(rawTimeline);
  const timeline = saved ?? buildTimelineFromScenes(scenes.map((s) => ({ id: s.id, title: s.title, durationSeconds: s.durationSeconds })));
  const meta = store.readProjectMeta ? await store.readProjectMeta(projectId) : null;
  const thumbs = store.listThumbnailAssets ? await store.listThumbnailAssets(projectId) : [];
  const { chosen, note } = chooseThumbnail(thumbs);
  const beats = beatsFromTimeline(timeline, scenes);
  const captions = buildCaptionPlan(beats, scenes);
  return {
    scenes,
    timeline,
    timelineSource: saved ? "saved" : "scenes",
    meta,
    thumbnail: chosen,
    thumbnailNote: note,
    duration,
    beats,
    plan: captions.plan,
    cueSource: captions.cueSource,
    stageCaptionSource: captions.stageCaptionSource,
  };
}

/** The metadata the project already holds, with where each field came from. */
export interface FinishMetadataInput {
  title: string | null;
  description: string | null;
  tags: string[] | null;
  titleSource: string;
  descriptionSource: string;
  tagsSource: string;
}

function metadataInputFor(projectTitle: string, meta: ExportProjectMeta | null): FinishMetadataInput {
  const seoTitle = meta?.seoDefaults?.title ?? null;
  const seoDescription = meta?.seoDefaults?.description ?? null;
  const seoTags = meta?.seoDefaults?.tags ?? null;
  return {
    title: seoTitle ?? (projectTitle && projectTitle.trim() ? projectTitle.trim() : null),
    titleSource: seoTitle ? `ProjectSettings.seoDefaults.title${meta?.seoDefaultsSource ? ` (${meta.seoDefaultsSource})` : ""}` : "the project's own title field",
    description: seoDescription ?? meta?.description ?? null,
    descriptionSource: seoDescription
      ? `ProjectSettings.seoDefaults.description${meta?.seoDefaultsSource ? ` (${meta.seoDefaultsSource})` : ""}`
      : meta?.description
        ? "the project's own description field"
        : "nothing stored",
    tags: seoTags,
    tagsSource: seoTags ? `ProjectSettings.seoDefaults.tags${meta?.seoDefaultsSource ? ` (${meta.seoDefaultsSource})` : ""}` : "nothing stored",
  };
}

/** Assemble the sidecar manifest for a project. Pure — reads nothing itself. */
export function sidecarsFor(projectId: string, projectTitle: string, ctx: FinishContext): SidecarManifest {
  return buildSidecarManifest({
    projectId,
    projectTitle,
    slug: slugifyProjectTitle(projectTitle),
    durationSeconds: ctx.duration.seconds,
    plan: ctx.plan,
    cueSource: ctx.cueSource,
    timelineDurationMs: ctx.timeline.durationMs,
    beats: ctx.beats,
    thumbnail: {
      present: ctx.thumbnail !== null,
      assetId: ctx.thumbnail?.id ?? null,
      name: ctx.thumbnail?.name ?? null,
      widthPx: ctx.thumbnail?.widthPx ?? null,
      heightPx: ctx.thumbnail?.heightPx ?? null,
      status: ctx.thumbnail?.status ?? null,
    },
    metadata: metadataInputFor(projectTitle, ctx.meta),
  });
}

/** The readiness input, assembled from the same context. Pure. */
export function readinessInputFor(projectTitle: string, ctx: FinishContext, applied: readonly ExportPresetId[]): ReadinessInput {
  const meta = metadataInputFor(projectTitle, ctx.meta);
  return {
    durationSeconds: ctx.duration.seconds,
    durationSource: ctx.duration.source,
    targetAspect: ctx.meta?.targetAspect ?? null,
    appliedPresetIds: applied,
    cueCount: ctx.plan.cues.length,
    captionSource: ctx.stageCaptionSource,
    mix: mixEstimateFor(ctx.timeline),
    thumbnail: { present: ctx.thumbnail !== null, assetName: ctx.thumbnail?.name ?? null, detail: ctx.thumbnailNote },
    metadata: meta,
  };
}

/* ------------------------------------------------------------------ */
/* Action handler                                                      */
/* ------------------------------------------------------------------ */

/**
 * Runs one export action. Never throws for expected failures — invalid input and
 * tenancy problems come back as `{ status, body }`, mirroring the rest of the
 * studio API. The body shape returned here IS the shape the HTTP client sees.
 */
export async function runExportAction(store: ExportStore, userId: string, raw: unknown): Promise<ExportResult> {
  const body = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const action = str(body.action);
  if (!action || !isExportAction(action)) {
    return fail(400, "Unknown export action.", "unknown_action", { note: "Expected one of: " + EXPORT_ACTIONS.join(", ") });
  }
  const projectId = str(body.projectId);
  if (!projectId) return fail(400, "projectId is required.", "project_id_required");

  const project = await store.findOwnedProject(userId, projectId);
  if (!project) return fail(404, "Project not found.", "not_found");

  const read = await readAssignment(store, projectId);
  const current = read.assignment;

  /* ----------------------------------------------------- listExportPresets */
  if (action === "listExportPresets") {
    const resolved = await resolveDuration(store, projectId, body);
    if (resolved.error) return resolved.error;
    const duration = resolved.duration as ResolvedDuration;
    const hasDuration = duration.seconds > 0;
    const view: Record<string, unknown> = {
      action: "listExportPresets",
      projectId,
      projectTitle: project.title,
      count: EXPORT_PRESETS.length,
      presets: listExportPresetViews(),
      assignment: exportAssignmentView(current),
      appliedPresets: presetViewsFor(current.presetIds),
      duration: { seconds: duration.seconds, human: hasDuration ? humanDuration(duration.seconds) : null, source: duration.source, note: duration.note },
      estimates: hasDuration ? estimateViews(orderPresetIds(EXPORT_PRESETS.map((p) => p.id)), duration.seconds) : [],
      sizeModel: sizeModelView(),
      // A catalogue read encodes nothing; the gate states that plainly.
      provider: exportProviderGate("Encoding any of these delivery presets"),
      changed: false,
      persisted: false,
      plan: { applied: false, encoded: false, filesProduced: 0 },
      note:
        "Deterministic catalogue: eight delivery presets with their real container, codec, resolution, frame rate, bitrate, " +
        "audio and colour-tagging values. Nothing was encoded and nothing was persisted." +
        (hasDuration
          ? " Sizes are estimates at this project's duration, from the stated formula."
          : " No project duration is available, so no size is estimated until one is supplied or a timeline is saved."),
    };
    if (read.unreadable) {
      view.note =
        "The stored export preset assignment was unreadable and was ignored (no preset is applied). Re-apply a preset to replace it. " +
        String(view.note);
    } else if (read.dropped.length > 0) {
      view.droppedPresets = read.dropped;
      view.note = `${read.dropped.length} stored preset id(s) are not in the catalogue and were ignored. ` + String(view.note);
    }
    view.unreadable = read.unreadable;
    return { status: 200, body: view };
  }

  /* -------------------------------------------------------------- planExport */
  if (action === "planExport") {
    const selection = selectPresets(body, current);
    if (selection.error) return selection.error;

    const resolved = await resolveDuration(store, projectId, body);
    if (resolved.error) return resolved.error;
    const duration = resolved.duration as ResolvedDuration;
    if (duration.seconds <= 0) {
      return fail(400, "No duration is available to estimate from.", "duration_unavailable", {
        durationSource: duration.source,
        note:
          "The export plan multiplies the duration by the total bitrate, so it needs a real duration: pass durationSeconds, " +
          "or save an editor timeline, or give the project's scenes durations. Nothing was estimated and nothing was produced.",
      });
    }

    let manifest: DeliverableManifest;
    try {
      const ctx = await loadFinishContext(store, projectId, duration);
      manifest = buildDeliverableManifest({
        projectId,
        projectTitle: project.title,
        durationSeconds: duration.seconds,
        presetIds: (selection.selection as Selection).presetIds,
        durationSource: duration.source,
        // Block 3 — the sidecar deliverables travel WITH the manifest, so one
        // response answers "what ships" as well as "what is the video file".
        sidecars: sidecarsFor(projectId, project.title, ctx),
      });
    } catch (err) {
      if (err instanceof SizeError) return sizeErrorResult(err);
      throw err;
    }

    const gate = exportProviderGate("Producing the encoded output files");
    return {
      status: 200,
      body: {
        action: "planExport",
        projectId,
        projectTitle: project.title,
        duration: { seconds: duration.seconds, human: humanDuration(duration.seconds), source: duration.source, note: duration.note },
        selection: { source: (selection.selection as Selection).source, count: (selection.selection as Selection).presetIds.length, presetIds: (selection.selection as Selection).presetIds },
        manifest,
        sizeModel: sizeModelView(),
        provider: gate,
        changed: false,
        persisted: false,
        plan: { applied: false, encoded: false, muxed: false, filesProduced: 0 },
        note:
          `The manifest lists ${manifest.fileCount} output file(s) that WOULD be produced at ${humanDuration(duration.seconds)} ` +
          `(${duration.source}) plus ${manifest.sidecars?.fileCount ?? 0} sidecar deliverable(s), and states what is not. ${gate.note} ` +
          "Nothing was persisted — use applyExportPreset to keep the choice.",
      },
    };
  }

  /* -------------------------------------------------------- applyExportPreset */
  if (action === "applyExportPreset") {
    const parsed = parseRequestedPresetIds(body.presetIds);
    if (parsed.error) return parsed.error;
    const requested = orderPresetIds(parsed.ids as ExportPresetId[]);
    const previous = current;

    const idsUnchanged = requested.length === previous.presetIds.length && requested.every((id, i) => id === previous.presetIds[i]);
    const next: ExportAssignment = {
      presetIds: requested,
      appliedAt: idsUnchanged ? previous.appliedAt : new Date().toISOString(),
    };
    const changed = !idsUnchanged;
    const changelist: string[] = [];
    if (changed) {
      const before = previous.presetIds.length > 0 ? previous.presetIds.join(", ") : "none";
      changelist.push(`presets: ${before} → ${requested.join(", ")}.`);
    } else {
      changelist.push(`presets: already ${requested.join(", ")} — nothing to change.`);
    }

    const resolved = await resolveDuration(store, projectId, body);
    if (resolved.error) return resolved.error;
    const duration = (resolved.duration ?? { seconds: 0, source: "none" as DurationSource, note: "" }) as ResolvedDuration;

    let manifest: DeliverableManifest | null = null;
    if (duration.seconds > 0) {
      try {
        manifest = buildDeliverableManifest({
          projectId,
          projectTitle: project.title,
          durationSeconds: duration.seconds,
          presetIds: requested,
          durationSource: duration.source,
        });
      } catch (err) {
        if (err instanceof SizeError) return sizeErrorResult(err);
        throw err;
      }
    }

    if (changed) await store.writeExportPreset(projectId, serializeExportAssignment(next));

    const gate = exportProviderGate("Encoding the applied presets");
    return {
      status: 200,
      body: {
        action: "applyExportPreset",
        projectId,
        projectTitle: project.title,
        presetIds: requested,
        applied: presetViewsFor(requested),
        previous: exportAssignmentView(previous),
        assignment: exportAssignmentView(next),
        duration: { seconds: duration.seconds, human: duration.seconds > 0 ? humanDuration(duration.seconds) : null, source: duration.source },
        estimates: duration.seconds > 0 ? estimateViews(requested, duration.seconds) : [],
        manifest,
        sizeModel: sizeModelView(),
        provider: gate,
        changed,
        changelist,
        persisted: changed,
        plan: { applied: changed, encoded: false, muxed: false, filesProduced: 0 },
        note: changed
          ? `Applied ${requested.length} delivery preset(s) as project metadata. The CHOICE is real and stored; no file was ` +
            `encoded, muxed or written. ${gate.note}`
          : `${requested.length} delivery preset(s) were already applied — nothing changed and nothing was written. ${gate.note}`,
      },
    };
  }

  /* ---------------------------------------------------------- planSidecars */
  if (action === "planSidecars") {
    const resolved = await resolveDuration(store, projectId, body);
    if (resolved.error) return resolved.error;
    const duration = resolved.duration as ResolvedDuration;
    const ctx = await loadFinishContext(store, projectId, duration);
    const sidecars = sidecarsFor(projectId, project.title, ctx);
    const envNames = [...new Set(sidecars.files.map((f) => f.requiresEnv).filter((v): v is string => typeof v === "string"))];
    const gate = exportProviderGate("Writing the sidecar files into an export bundle");
    return {
      status: 200,
      body: {
        action: "planSidecars",
        projectId,
        projectTitle: project.title,
        duration: {
          seconds: duration.seconds,
          human: duration.seconds > 0 ? humanDuration(duration.seconds) : null,
          source: duration.source,
          note: duration.note,
        },
        timelineSource: ctx.timelineSource,
        timelineDurationMs: ctx.timeline.durationMs,
        sceneCount: ctx.scenes.length,
        beatCount: ctx.beats.length,
        cueSource: ctx.cueSource,
        sidecars,
        requiresGeneration: {
          count: sidecars.counts.requiresGeneration,
          // Env var NAMES only — never values.
          envNames,
          note:
            envNames.length > 0
              ? `These slots would need generation; each names the env var a server operator sets to enable it. No value is ever read or returned here.`
              : "Every slot is either filled from data the project already holds or genuinely empty.",
        },
        provider: gate,
        changed: false,
        persisted: false,
        plan: { written: false, encoded: false, muxed: false, filesProduced: 0 },
        note:
          `${sidecars.note} Nothing was persisted and no project metadata was written — this is a read-only plan. ${gate.note}`,
      },
    };
  }

  /* -------------------------------------------------- checkPublishReadiness */
  if (action === "checkPublishReadiness") {
    const requested = body.targets;
    let targetIds: PublishTargetId[];
    if (requested === undefined || requested === null) {
      targetIds = [...PUBLISH_TARGET_IDS];
    } else {
      if (!Array.isArray(requested)) {
        return fail(400, "targets must be an array of publish target ids.", "invalid_targets", {
          received: requested,
          note: publishTargetCatalogueNote(),
        });
      }
      if (requested.length === 0) {
        return fail(400, "targets must name at least one publish target.", "invalid_targets", {
          note: publishTargetCatalogueNote(),
        });
      }
      const unknown = unknownPublishTargetIds(requested);
      if (unknown.length > 0) {
        return fail(400, "Unknown publish target.", "unknown_target", { unknown, note: publishTargetCatalogueNote() });
      }
      targetIds = orderPublishTargetIds(requested);
    }

    const resolved = await resolveDuration(store, projectId, body);
    if (resolved.error) return resolved.error;
    const duration = resolved.duration as ResolvedDuration;
    const ctx = await loadFinishContext(store, projectId, duration);
    const reports: TargetReport[] = checkPublishReadiness(targetIds, readinessInputFor(project.title, ctx, current.presetIds));
    const summary = {
      targetCount: reports.length,
      ready: reports.filter((r) => r.verdict === "ready").length,
      readyWithWarnings: reports.filter((r) => r.verdict === "ready_with_warnings").length,
      notReady: reports.filter((r) => r.verdict === "not_ready").length,
      indeterminate: reports.filter((r) => r.verdict === "indeterminate").length,
      blocking: reports.filter((r) => r.blockingFailures.length > 0).map((r) => ({ targetId: r.targetId, rules: r.blockingFailures })),
      unknownRequired: reports.filter((r) => r.unknownRequired.length > 0).map((r) => ({ targetId: r.targetId, rules: r.unknownRequired })),
      warnings: reports.filter((r) => r.warnings.length > 0).map((r) => ({ targetId: r.targetId, rules: r.warnings })),
      note:
        "These are counts of RULES, not a score: pass/fail/unknown per stated rule, with the project's actual value beside each. " +
        "No percentage, rating or confidence number is derived from them.",
    };
    const gate = readinessMediaAnalysisGate("Checking platform policy, quality and duplicate content");
    return {
      status: 200,
      body: {
        action: "checkPublishReadiness",
        projectId,
        projectTitle: project.title,
        duration: {
          seconds: duration.seconds,
          human: duration.seconds > 0 ? humanDuration(duration.seconds) : null,
          source: duration.source,
          note: duration.note,
        },
        requestedTargets: targetIds,
        appliedPresets: [...current.presetIds],
        sidecarSummary: {
          cueCount: ctx.plan.cues.length,
          chapterCount: buildChapterPlan(ctx.beats).count,
          thumbnail: ctx.thumbnailNote,
        },
        targets: reports,
        summary,
        provider: gate,
        changed: false,
        persisted: false,
        plan: { written: false, encoded: false, uploaded: false, filesProduced: 0 },
        note:
          `Publish-readiness check for ${reports.length} target(s): ` +
          reports
            .map((r) => `${r.label} ${r.verdict} (${r.counts.pass} pass / ${r.counts.fail} fail / ${r.counts.unknown} unknown)`)
            .join("; ") +
          ". Read-only: nothing was written, no project metadata changed, no video was encoded or uploaded, and no rule was " +
          "estimated. " +
          gate.note,
      },
    };
  }

  /* -------------------------------------------------------- clearExportPreset */
  {
    const previous = current;
    const next: ExportAssignment = { ...EMPTY_EXPORT_ASSIGNMENT };
    const changed = !isEmptyExportAssignment(previous);
    const changelist: string[] = [
      changed
        ? `presets: ${previous.presetIds.join(", ")} → none.`
        : "presets: already none — nothing to change.",
    ];

    // A reset writes a bare null so nothing is left half-applied.
    if (changed) await store.writeExportPreset(projectId, null);

    const gate = exportProviderGate("Encoding any preset");
    return {
      status: 200,
      body: {
        action: "clearExportPreset",
        projectId,
        presetIds: [],
        previous: exportAssignmentView(previous),
        assignment: exportAssignmentView(next),
        provider: gate,
        changed,
        changelist,
        persisted: changed,
        plan: { applied: false, encoded: false, muxed: false, filesProduced: 0 },
        note: changed
          ? "The applied export presets were cleared — the stored choice is empty again. No file was ever encoded, muxed or written."
          : "No export preset was applied, so there was nothing to clear. No file was encoded, muxed or written.",
      },
    };
  }
}

/* ------------------------------------------------------------------ */
/* The stored assignment read                                          */
/* ------------------------------------------------------------------ */

export async function readAssignment(
  store: ExportStore,
  projectId: string,
): Promise<{ assignment: ExportAssignment; unreadable: boolean; dropped: string[] }> {
  const raw = await store.readExportPreset(projectId);
  return normalizeExportAssignment(raw);
}

/* Re-exported so the editor service can keep its import surface narrow. */
export { EMPTY_EXPORT_ASSIGNMENT, NOT_PRODUCED };
export type { DeliverableManifest, ExportAssignment, ExportPresetId };
export { exportAssignmentsEqual };
export { isExportPresetId };
