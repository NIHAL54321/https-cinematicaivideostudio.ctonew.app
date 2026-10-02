/**
 * Phase 5 Block 5b — smart 16:9 → 9:16 reframing + multi-format output
 * (tenant-scoped, store-injected).
 *
 * The logic for the framing API actions lives here, expressed against a tiny
 * `FramingStore` interface so it can be exercised by contract tests without a
 * database. The HTTP route (src/app/api/studio/editor/route.ts) reaches this
 * through src/lib/editor/service.ts — one surface, no parallel API.
 *
 * DETERMINISTIC (real work, nothing faked):
 *   listFrameFormats — the four delivery formats with their real resolutions,
 *                      safe areas (93% action-safe / 90% title-safe) and the
 *                      caption-safe band derived from the SUBTITLE engine's own
 *                      constants, plus the project's current reframe assignment.
 *   planReframe      — computes, per clip, the cover-crop window (source px and
 *                      normalized), the derived scale, the travel, the source
 *                      action-safe retention, the data-cited framing policy, the
 *                      per-keyframe path and the delivery upscale — for every
 *                      format, project-wide, per scene or per single clip. The
 *                      project's applied Block 5a shorts set is planned too, each
 *                      clip against its own declared 9:16 target.
 *   applyReframe     — PERSISTS a format/policy/anchor override at project, scene
 *                      or clip scope (ProjectSettings.extra.framing) and reports
 *                      the geometry that override produces, read back.
 *   resetReframe     — REMOVES the override at that scope, so the engine's own
 *                      plan applies again — and reports that plan.
 *
 * PROVIDER-GATED (honest gate, nothing changed):
 *   - Locating a face, chart or line of text in a frame needs a real detector
 *     (`face_detection` / `object_detection` / `scene_detection`). None is
 *     wired: `anchoring.known` is false, no box is ever produced, and the gate
 *     names the env var that would enable it. The plan falls back to a STATED
 *     RULE anchor and says so.
 *   - Rendering the reframed pixels (`video_enhancement`) is not wired either:
 *     no frame is decoded, cut, reframed or encoded and no file is produced.
 *
 * Tenancy: every action resolves the project through
 * `store.findOwnedProject(userId, projectId)` first; a missing OR foreign project
 * is a 404 (never 403) so the API leaks nothing about other tenants.
 */
import { clipsAt, buildTimelineFromScenes, type Clip, type SceneInput, type Timeline } from "../editor/timeline";
import { fromSnapshot } from "../editor/versions";
import { PLATFORM_ASPECT } from "../repurpose/targets";
import {
  DEFAULT_FRAME_FORMAT,
  FRAME_FORMATS,
  FRAME_FORMAT_SPECS,
  captionBand,
  formatForAspectValue,
  isFrameFormatId,
  listFormatViews,
  safeAreas,
  sourceAspectSpec,
  type FrameFormatId,
} from "./formats";
import {
  buildKeyframes,
  keyframeTimes,
  type AnchorPoint,
  type FrameKeyframe,
  type SourceFrame,
  type TargetFrame,
} from "./geometry";
import {
  FRAMING_POLICIES,
  FRAMING_POLICY_SPECS,
  anchorCheck,
  decideFramingPolicy,
  isFramingPolicyId,
  sourceActionSafeRect,
  type FramingDecision,
  type FramingPolicyId,
} from "./policies";
import {
  EMPTY_FRAMING_ASSIGNMENT,
  effectiveFrameOverride,
  framingAssignmentView,
  framingsEqual,
  isEmptyFramingAssignment,
  mergeOverride,
  normalizeFraming,
  overridesEqual,
  serializeFraming,
  validateOverride,
  type FrameOverride,
  type FramingAssignment,
} from "./assignment";

/* ------------------------------------------------------------------ */
/* Provider gating                                                     */
/* ------------------------------------------------------------------ */

/**
 * Env var NAMES (never values) a server operator sets to connect real subject
 * detection and real pixel rendering. The names are generic on purpose: an
 * operator wires whichever concrete provider they use; the capability ids say
 * which slots they feed. `MEDIA_ANALYSIS_API_KEY` is the same name Block 5a
 * uses for visual analysis of the footage.
 */
export const FRAMING_DETECTOR_ENV = "MEDIA_ANALYSIS_API_KEY";
export const FRAMING_RENDER_ENV = "VIDEO_PROCESSING_API_KEY";

/** The framing system wires NO provider. One switch flips it when one arrives. */
export const FRAMING_PROVIDER_CONNECTED = false;

export const FRAMING_DETECTOR_CAPABILITY = "face_detection";
export const FRAMING_DETECTOR_CAPABILITIES = ["face_detection", "object_detection", "scene_detection"] as const;
export const FRAMING_RENDER_CAPABILITY = "video_enhancement";

export interface ProviderGate {
  capability: string;
  connected: boolean;
  /** Env var NAMES (never values) a server operator must set. */
  requiredEnv: string[];
  envHint: string | null;
  note: string;
}

/**
 * Honest gate for subject detection. This is the gate that stops the engine from
 * inventing a face/chart/text position: with no detector connected, no box, no
 * centre and no confidence is produced, and the plan says the anchor is a rule.
 */
export function framingDetectorGate(what: string): ProviderGate {
  return {
    capability: FRAMING_DETECTOR_CAPABILITY,
    connected: FRAMING_PROVIDER_CONNECTED,
    requiredEnv: [FRAMING_DETECTOR_ENV],
    envHint: FRAMING_DETECTOR_ENV,
    note:
      `${what} needs a connected detection provider. ${FRAMING_DETECTOR_CAPABILITIES.join(", ")} are not wired into the framing ` +
      `engine, so no face, chart or line of text was located — no box, no centre point and no confidence was produced, and none ` +
      `was invented. The plan uses a stated rule anchor instead and reports it as a rule. A server operator enables real detection ` +
      `by setting the env var ${FRAMING_DETECTOR_ENV} (name only — never a value) and wiring the capabilities.`,
  };
}

/** Honest gate for decoding/cutting/reframing/encoding real pixels. */
export function framingRenderGate(what: string): ProviderGate {
  return {
    capability: FRAMING_RENDER_CAPABILITY,
    connected: FRAMING_PROVIDER_CONNECTED,
    requiredEnv: [FRAMING_RENDER_ENV],
    envHint: FRAMING_RENDER_ENV,
    note:
      `${what} needs a connected video-processing provider. ${FRAMING_RENDER_CAPABILITY} is not wired into the framing engine, so no ` +
      `frame was decoded, cut, reframed, upscaled or encoded and no media file was produced. A server operator enables it by setting ` +
      `the env var ${FRAMING_RENDER_ENV} (name only — never a value) and wiring the capability.`,
  };
}

/* ------------------------------------------------------------------ */
/* Store contract                                                      */
/* ------------------------------------------------------------------ */

export interface FramingSceneRow {
  id: string;
  title: string | null;
  narration: string | null;
  durationSeconds: number | null;
  /** Prisma `AspectRatio` enum value when the scene declares one. */
  aspectRatio?: string | null;
}

export interface FramingAssetRow {
  id: string;
  name: string;
  /** Real pixel dimensions of the asset (Prisma Asset.width / Asset.height). */
  widthPx: number;
  heightPx: number;
  /** Scenes this asset is attached to (SceneAsset rows). */
  sceneIds: string[];
}

export interface FramingStore {
  /** Tenant-scoped project lookup (null when missing OR owned by someone else). */
  findOwnedProject(
    userId: string,
    projectId: string,
  ): Promise<{ id: string; title: string; targetAspect?: string | null } | null>;
  listScenes(projectId: string): Promise<FramingSceneRow[]>;
  /** Assets with real dimensions, for the source frames. */
  listMediaAssets(projectId: string): Promise<FramingAssetRow[]>;
  /** ProjectSettings.extra.editorTimeline (unvalidated raw JSON) or null. */
  readRawTimeline(projectId: string): Promise<unknown | null>;
  /** ProjectSettings.extra.shortsRepurpose (unvalidated raw JSON) or null. */
  readShortsRepurpose(projectId: string): Promise<unknown | null>;
  /** ProjectSettings.extra.framing (unvalidated raw JSON) or null. */
  readFraming(projectId: string): Promise<unknown | null>;
  writeFraming(projectId: string, value: unknown): Promise<void>;
}

export interface FramingResult {
  status: number;
  body: Record<string, unknown>;
}

export const FRAMING_ACTIONS = ["listFrameFormats", "planReframe", "applyReframe", "resetReframe"] as const;
export type FramingAction = (typeof FRAMING_ACTIONS)[number];

export function isFramingAction(v: unknown): v is FramingAction {
  return typeof v === "string" && (FRAMING_ACTIONS as readonly string[]).includes(v);
}

const FRAMING_SCOPES = ["project", "scene", "clip"] as const;
type FramingScope = (typeof FRAMING_SCOPES)[number];

/** A plan is emitted for at most this many clips; the rest are counted, not hidden. */
export const MAX_PLANNED_CLIPS = 60;

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fail(status: number, error: string, code: string, extra: Record<string, unknown> = {}): FramingResult {
  return { status, body: { error, code, ...extra } };
}

function pct(n: number): string {
  return `${Math.round(n * 1000) / 10}%`;
}

function toSceneInput(row: FramingSceneRow): SceneInput {
  return { id: row.id, title: row.title, narration: row.narration, durationSeconds: row.durationSeconds };
}

/* ------------------------------------------------------------------ */
/* Context: frames, targets, timeline                                  */
/* ------------------------------------------------------------------ */

interface FramingTarget {
  /** The id an override is keyed on. */
  clipId: string;
  kind: "scene" | "shorts";
  label: string;
  sceneId: string | null;
  sceneIndex: number | null;
  startMs: number;
  endMs: number;
  durationMs: number;
  /** For a shorts clip: the platform target whose aspect it is cut for. */
  platformTarget?: string;
  /** The aspect the clip is delivered in, when the source data declares one. */
  declaredAspect?: string;
  /** The timeline video clips under this target (one for a scene clip). */
  sourceClips: Clip[];
}

interface ShortsClipRow {
  id?: unknown;
  target?: unknown;
  label?: unknown;
  startMs?: unknown;
  endMs?: unknown;
  scenes?: unknown;
}

/** The applied Block 5a set, read leniently — only ids and windows are needed. */
function readShortsClips(raw: unknown): { clips: ShortsClipRow[]; applied: boolean; targets: Record<string, number> } {
  if (!isObj(raw) || !Array.isArray(raw.clips)) return { clips: [], applied: false, targets: {} };
  const clips = (raw.clips as unknown[]).filter(isObj) as ShortsClipRow[];
  const targets: Record<string, number> = {};
  for (const clip of clips) {
    if (typeof clip.target === "string") targets[clip.target] = (targets[clip.target] ?? 0) + 1;
  }
  return { clips, applied: clips.length > 0, targets };
}

/** The timeline video clips a shorts clip's window covers. */
function videoClipsInWindow(timeline: Timeline, startMs: number, endMs: number): Clip[] {
  return clipsAt(timeline, "video").filter((c) => c.startMs < endMs && startMs < c.endMs);
}

/**
 * The clips this engine plans for:
 *   - one per timeline video clip (i.e. per scene), keyed by the clip's own id,
 *   - one per clip of the APPLIED Block 5a shorts set, keyed by that clip's id,
 *     planned against the aspect its platform target declares.
 */
function buildTargets(
  working: Timeline,
  shorts: { clips: ShortsClipRow[]; applied: boolean; targets: Record<string, number> },
): { targets: FramingTarget[]; shortsLink: Record<string, unknown> } {
  const targets: FramingTarget[] = [];
  const videoClips = clipsAt(working, "video");

  videoClips.forEach((clip) => {
    targets.push({
      clipId: clip.id,
      kind: "scene",
      label: clip.name,
      sceneId: clip.sceneId ?? null,
      sceneIndex: null,
      startMs: clip.startMs,
      endMs: clip.endMs,
      durationMs: Math.max(0, clip.endMs - clip.startMs),
      sourceClips: [clip],
    });
  });

  const shortsClips = shorts.applied ? shorts.clips : [];
  shortsClips.forEach((row, index) => {
    const id = typeof row.id === "string" ? row.id : `shorts-${index + 1}`;
    const startMs = typeof row.startMs === "number" ? Math.max(0, Math.round(row.startMs)) : 0;
    const endMs = typeof row.endMs === "number" ? Math.max(startMs, Math.round(row.endMs)) : startMs;
    const platformTarget = typeof row.target === "string" ? row.target : undefined;
    const covered = videoClipsInWindow(working, startMs, endMs);
    const sceneIds = covered.map((c) => c.sceneId).filter((v): v is string => typeof v === "string");
    targets.push({
      clipId: id,
      kind: "shorts",
      label: typeof row.label === "string" ? row.label : id,
      sceneId: sceneIds[0] ?? null,
      sceneIndex: null,
      startMs,
      endMs,
      durationMs: endMs - startMs,
      platformTarget,
      declaredAspect: platformTarget ? PLATFORM_ASPECT[platformTarget as keyof typeof PLATFORM_ASPECT] ?? undefined : undefined,
      sourceClips: covered,
    });
  });

  const shortsLink: Record<string, unknown> = {
    applied: shorts.applied,
    clipCount: shortsClips.length,
    byTarget: { ...shorts.targets },
    aspects: Object.fromEntries(
      Object.keys(shorts.targets).map((t) => [t, PLATFORM_ASPECT[t as keyof typeof PLATFORM_ASPECT] ?? null]),
    ),
    note: shorts.applied
      ? `The applied Block 5a set is planned here too: ${shortsClips.length} clip(s) are reframed against their own declared 9:16 target, ` +
        `so the repurposing and the reframing halves meet on the same clip ids.`
      : "No shorts set is applied, so there are no repurposed clips to reframe. Run applyShorts (Block 5a) to create them, or pass " +
        "format 9:16 to plan the whole project vertically.",
  };
  return { targets, shortsLink };
}

/* ------------------------------------------------------------------ */
/* Source frames                                                       */
/* ------------------------------------------------------------------ */

interface SourceResolution {
  frame: SourceFrame;
  origin: "asset-dimensions" | "scene-aspect" | "engine-default";
  originDetail: string;
  assetId: string | null;
  sceneAspectDeclared: string | null;
}

/**
 * The source frame of a clip, from real data where it exists:
 *   1. the real pixel dimensions of an asset attached to the clip's scene
 *      (Prisma Asset.width / Asset.height) — the strongest evidence available,
 *   2. the scene's declared AspectRatio (a real enum value) at its nominal size,
 *   3. a stated nominal 16:9 frame — the engine default, labelled as such.
 * Nothing here looks inside the frame; these are frame dimensions only.
 */
function resolveSource(
  target: FramingTarget,
  scenesById: Map<string, FramingSceneRow>,
  assetsByScene: Map<string, FramingAssetRow[]>,
): SourceResolution {
  const sceneId = target.sceneId;
  const scene = sceneId ? scenesById.get(sceneId) ?? null : null;
  const sceneAspectDeclared = typeof scene?.aspectRatio === "string" ? scene.aspectRatio : null;
  const aspectSpec = sceneAspectDeclared ? sourceAspectSpec(sceneAspectDeclared) : null;

  if (sceneId) {
    const candidates = (assetsByScene.get(sceneId) ?? []).slice().sort((a, b) => {
      const areaA = a.widthPx * a.heightPx;
      const areaB = b.widthPx * b.heightPx;
      if (areaA !== areaB) return areaB - areaA;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
    const asset = candidates[0];
    if (asset) {
      const aspectValue = asset.widthPx / asset.heightPx;
      return {
        frame: {
          widthPx: asset.widthPx,
          heightPx: asset.heightPx,
          aspect: `${Math.round(aspectValue * 100) / 100}:1`,
          aspectValue,
        },
        origin: "asset-dimensions",
        originDetail:
          `the real pixel dimensions of asset ${asset.id} ("${asset.name}"), read from Asset.width/height, ` +
          `attached to this scene through SceneAsset`,
        assetId: asset.id,
        sceneAspectDeclared,
      };
    }
  }

  if (aspectSpec) {
    return {
      frame: { widthPx: aspectSpec.widthPx, heightPx: aspectSpec.heightPx, aspect: aspectSpec.label, aspectValue: aspectSpec.aspectValue },
      origin: "scene-aspect",
      originDetail:
        `the scene's declared AspectRatio (${aspectSpec.enumValue} = ${aspectSpec.label}) at its nominal ${aspectSpec.widthPx}×${aspectSpec.heightPx} — ` +
        `a frame SHAPE, with no asset dimensions on record`,
      assetId: null,
      sceneAspectDeclared,
    };
  }

  const spec = FRAME_FORMAT_SPECS[DEFAULT_FRAME_FORMAT];
  return {
    frame: { widthPx: spec.widthPx, heightPx: spec.heightPx, aspect: spec.aspect, aspectValue: spec.aspectValue },
    origin: "engine-default",
    originDetail:
      `no asset dimensions and no declared scene aspect exist for this clip, so the engine's stated nominal ${spec.aspect} ` +
      `${spec.widthPx}×${spec.heightPx} frame is used — the engine default, not a measurement of the footage`,
    assetId: null,
    sceneAspectDeclared: null,
  };
}

/* ------------------------------------------------------------------ */
/* Target format + policy resolution                                   */
/* ------------------------------------------------------------------ */

function resolveFormat(
  target: FramingTarget,
  eff: { override: FrameOverride | null; source: "clip" | "scene" | "project" | "none" },
  projectTargetAspect: string | null,
  requested: FrameFormatId | null,
): { id: FrameFormatId; origin: string; originDetail: string } {
  if (requested) {
    return {
      id: requested,
      origin: "request",
      originDetail: `the format was passed with this request (${FRAME_FORMAT_SPECS[requested].aspect})`,
    };
  }
  if (eff.override?.format) {
    return {
      id: eff.override.format,
      origin: `${eff.source}-override`,
      originDetail: `a saved ${eff.source} override states the ${FRAME_FORMAT_SPECS[eff.override.format].aspect} format`,
    };
  }
  if (target.kind === "shorts" && target.declaredAspect) {
    const match = FRAME_FORMATS.find((id) => FRAME_FORMAT_SPECS[id].aspect === target.declaredAspect);
    if (match) {
      return {
        id: match,
        origin: "platform-target",
        originDetail:
          `the Block 5a platform target "${target.platformTarget}" declares ${target.declaredAspect} — this clip is cut for that platform`,
      };
    }
  }
  const projectSpec = sourceAspectSpec(projectTargetAspect);
  if (projectSpec) {
    const chosen = formatForAspectValue(projectSpec.aspectValue);
    return {
      id: chosen.id,
      origin: "project-target-aspect",
      originDetail: `the project's targetAspectRatio is ${projectSpec.label}: ${chosen.note}`,
    };
  }
  return {
    id: DEFAULT_FRAME_FORMAT,
    origin: "engine-default",
    originDetail: `nothing overrides it and the project declares no target aspect, so the engine default ${FRAME_FORMAT_SPECS[DEFAULT_FRAME_FORMAT].aspect} applies`,
  };
}

/* ------------------------------------------------------------------ */
/* Planning one clip                                                   */
/* ------------------------------------------------------------------ */

interface PlannedClip {
  targetRow: FramingTarget;
  source: SourceResolution;
  format: { id: FrameFormatId; origin: string; originDetail: string };
  decision: FramingDecision;
  keyframes: FrameKeyframe[];
  override: { override: FrameOverride | null; source: "clip" | "scene" | "project" | "none" };
}

function planClip(
  target: FramingTarget,
  scenesById: Map<string, FramingSceneRow>,
  assetsByScene: Map<string, FramingAssetRow[]>,
  scenesWithCaptions: Set<string>,
  assignment: FramingAssignment,
  projectTargetAspect: string | null,
  requestedFormat: FrameFormatId | null,
  requestedPolicy: FramingPolicyId | null,
  requestedAnchor: AnchorPoint | null,
): PlannedClip {
  const source = resolveSource(target, scenesById, assetsByScene);
  const eff = effectiveFrameOverride(assignment, target.sceneId, target.clipId);
  const format = resolveFormat(target, eff, projectTargetAspect, requestedFormat);
  const formatSpecRow = FRAME_FORMAT_SPECS[format.id];
  const targetFrame: TargetFrame = {
    widthPx: formatSpecRow.widthPx,
    heightPx: formatSpecRow.heightPx,
    aspect: formatSpecRow.aspect,
    aspectValue: formatSpecRow.aspectValue,
  };
  const targetSafe = safeAreas(targetFrame);

  const policy = requestedPolicy ?? eff.override?.policy ?? null;
  const anchor = requestedAnchor ?? eff.override?.anchor ?? null;
  const scene = target.sceneId ? scenesById.get(target.sceneId) ?? null : null;
  const captionsPresent = target.sceneId ? scenesWithCaptions.has(target.sceneId) : false;

  const decision = decideFramingPolicy(
    {
      source: source.frame,
      target: targetFrame,
      captionsPresent,
      caption: captionsPresent
        ? { band: captionBand(source.frame).rect, basis: captionBand(source.frame).basis }
        : null,
      narrationBeared: Boolean(scene?.narration && scene.narration.trim().length > 0),
      sceneAspectDeclared: source.sceneAspectDeclared,
      requested: policy,
      requestedAnchor: anchor,
    },
    targetSafe.captionSafe,
  );

  const times = keyframeTimes(target.durationMs, decision.motion.keyframeCount);
  const keyframes = buildKeyframes({
    timesMs: times,
    cropStart: decision.panStart,
    cropEnd: decision.panEnd,
    scale: decision.crop.scale,
    source: { widthPx: source.frame.widthPx, heightPx: source.frame.heightPx },
  });

  return {
    targetRow: target,
    source,
    format,
    decision,
    keyframes,
    override: eff,
  };
}

/** The per-clip view: geometry, safe areas, policy and reason, all verbatim. */
function clipPlanView(planned: PlannedClip): Record<string, unknown> {
  const { targetRow: t, source, format, decision, keyframes, override } = planned;
  const spec = FRAME_FORMAT_SPECS[format.id];
  const targetFrame: TargetFrame = { widthPx: spec.widthPx, heightPx: spec.heightPx, aspect: spec.aspect, aspectValue: spec.aspectValue };
  const safe = safeAreas(targetFrame);
  const crop = decision.crop;
  const keptColumns = crop.crop.width;
  const keptRows = crop.crop.height;
  const sourceSafe = sourceActionSafeRect(source.frame);

  const deliveryNote =
    `${spec.label} delivers ${spec.widthPx}×${spec.heightPx}. The crop keeps ${keptColumns} of ${source.frame.widthPx} source columns ` +
    `and ${keptRows} of ${source.frame.heightPx} rows (${pct(crop.retained.widthFraction)} × ${pct(crop.retained.heightFraction)} of the frame, ` +
    `${pct(crop.retained.areaFraction)} by area${targetRowNote(t)}). Filling ${spec.widthPx}×${spec.heightPx} from that crop is a ` +
    `${crop.scale}× enlargement of the kept region — that is what delivering this format from this source costs.`;

  return {
    clipId: t.clipId,
    kind: t.kind,
    label: t.label,
    sceneId: t.sceneId,
    platformTarget: t.platformTarget ?? null,
    startMs: t.startMs,
    endMs: t.endMs,
    durationMs: t.durationMs,
    durationSeconds: Math.round(t.durationMs / 100) / 10,
    sourceClips: t.sourceClips.length,
    override: override.override
      ? { source: override.source, format: override.override.format ?? null, policy: override.override.policy ?? null, anchor: override.override.anchor ?? null, note: override.override.note ?? null }
      : null,
    source: {
      widthPx: source.frame.widthPx,
      heightPx: source.frame.heightPx,
      aspect: source.frame.aspect,
      aspectValue: Math.round(source.frame.aspectValue * 10000) / 10000,
      origin: source.origin,
      originDetail: source.originDetail,
      assetId: source.assetId,
      sceneAspectDeclared: source.sceneAspectDeclared,
    },
    target: {
      id: spec.id,
      label: spec.label,
      aspect: spec.aspect,
      resolution: `${spec.widthPx}×${spec.heightPx}`,
      widthPx: spec.widthPx,
      heightPx: spec.heightPx,
      origin: format.origin,
      originDetail: format.originDetail,
      platforms: [...spec.platforms],
      deliveryNotes: [...spec.deliveryNotes],
    },
    policy: {
      id: decision.policy.id,
      label: decision.policy.label,
      rule: decision.policy.rule,
      requested: decision.policy.requested,
      anchor: decision.policy.anchor,
      anchorSource: decision.policy.anchorSource,
      engineDefault: decision.engineDefault,
      selectedBecause: decision.selectedBecause,
      signals: decision.signals,
      alternatives: decision.alternatives,
    },
    geometry: {
      scale: crop.scale,
      crop: { ...crop.crop },
      cropNormalized: { ...crop.cropNormalized },
      travelPx: { ...crop.travelPx },
      offsetPx: { ...crop.offsetPx },
      anchor: { ...crop.anchor },
      anchorOffsetPx: { ...crop.anchorOffsetPx },
      retained: { ...crop.retained },
      sourceActionSafeRetained: { ...crop.sourceActionSafeRetained },
      upscale: crop.scale,
      cropCentrePx: {
        x: Math.round(crop.crop.x + crop.crop.width / 2),
        y: Math.round(crop.crop.y + crop.crop.height / 2),
      },
    },
    safeAreas: {
      target: {
        titleSafe: { ...safe.titleSafe },
        actionSafe: { ...safe.actionSafe },
        captionSafe: { ...safe.captionSafe },
        captionBasis: safe.captionBasis,
      },
      sourceActionSafe: { ...sourceSafe },
      safeAreaClamp: {
        applied: decision.safeAreaClamp.applied,
        shiftPx: { ...decision.safeAreaClamp.shiftPx },
        bounds: { ...decision.safeAreaClamp.bounds },
        note: decision.safeAreaClamp.note,
      },
    },
    caption: {
      present: decision.caption.present,
      band: decision.caption.band ? { ...decision.caption.band } : null,
      bandBasis: decision.caption.bandBasis,
      verticalFraction: decision.caption.verticalFraction,
      horizontalFraction: decision.caption.horizontalFraction,
      areaFraction: decision.caption.areaFraction,
      inTarget: decision.caption.inTarget ? { ...decision.caption.inTarget } : null,
      insideTargetCaptionSafe: decision.caption.insideTargetCaptionSafe,
      sourceRows: decision.caption.sourceRows,
      note: decision.caption.note,
    },
    motion: {
      kind: decision.motion.kind,
      rule: decision.motion.rule,
      basis: decision.motion.basis,
      keyframeCount: keyframes.length,
      travelPx: decision.motion.travelPx,
      keyframes: keyframes.map((k) => ({
        index: k.index,
        tMs: k.tMs,
        relative: k.relative,
        crop: { ...k.crop },
        cropNormalized: { ...k.cropNormalized },
        scale: k.scale,
        note: k.note,
      })),
    },
    anchoring: {
      ...anchorCheck(),
      policyAnchorUsed: { ...decision.policy.anchor },
      detector: framingDetectorGate("Locating the faces, charts and text inside this clip"),
    },
    delivery: {
      resolution: `${spec.widthPx}×${spec.heightPx}`,
      upscale: crop.scale,
      keptColumns,
      keptRows,
      sourceColumns: source.frame.widthPx,
      sourceRows: source.frame.heightPx,
      note: deliveryNote,
    },
  };
}

function targetRowNote(t: FramingTarget): string {
  return t.kind === "shorts" ? `, cut for the ${t.platformTarget ?? "shorts"} platform target` : "";
}

/* ------------------------------------------------------------------ */
/* Action handler                                                      */
/* ------------------------------------------------------------------ */

function resolveScope(body: Record<string, unknown>): { scope?: FramingScope; error?: FramingResult } {
  const raw = body.scope === undefined || body.scope === null || body.scope === "" ? "project" : str(body.scope);
  if (!raw || !(FRAMING_SCOPES as readonly string[]).includes(raw)) {
    return {
      error: fail(400, "Unknown reframe scope.", "invalid_scope", { note: "Expected one of: " + FRAMING_SCOPES.join(", ") }),
    };
  }
  return { scope: raw as FramingScope };
}

/**
 * Runs one framing action. Never throws for expected failures — invalid input and
 * tenancy problems come back as `{ status, body }`, mirroring the rest of the
 * studio API. The body shape returned here IS the shape the HTTP client sees.
 */
export async function runFramingAction(store: FramingStore, userId: string, raw: unknown): Promise<FramingResult> {
  const body = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const action = str(body.action);
  if (!action || !isFramingAction(action)) {
    return fail(400, "Unknown framing action.", "unknown_action", {
      note: "Expected one of: " + FRAMING_ACTIONS.join(", "),
    });
  }
  const projectId = str(body.projectId);
  if (!projectId) return fail(400, "projectId is required.", "project_id_required");

  const project = await store.findOwnedProject(userId, projectId);
  if (!project) return fail(404, "Project not found.", "not_found");

  /* ------------------------------------------------ shared context */
  const rawTimeline = await store.readRawTimeline(projectId);
  const restored = rawTimeline === null || rawTimeline === undefined ? null : fromSnapshot(rawTimeline);
  const sceneRows = await store.listScenes(projectId);
  const working: Timeline = restored ?? buildTimelineFromScenes(sceneRows.map(toSceneInput));
  const timelineSource: "saved" | "scenes" = restored ? "saved" : "scenes";

  const shortsRaw = await store.readShortsRepurpose(projectId);
  const shorts = readShortsClips(shortsRaw);
  const { targets: allTargets, shortsLink } = buildTargets(working, shorts);

  const scenesById = new Map(sceneRows.map((r) => [r.id, r]));
  const assets = await store.listMediaAssets(projectId).catch((err) => {
    console.error("[framing] listMediaAssets failed:", err);
    return [] as FramingAssetRow[];
  });
  const assetsByScene = new Map<string, FramingAssetRow[]>();
  for (const asset of assets) {
    for (const sceneId of asset.sceneIds ?? []) {
      const list = assetsByScene.get(sceneId) ?? [];
      list.push(asset);
      assetsByScene.set(sceneId, list);
    }
  }
  const scenesWithCaptions = new Set(
    working.clips.filter((c) => c.trackId === "subtitles" && c.sceneId).map((c) => c.sceneId as string),
  );

  const normalized = normalizeFraming(await store.readFraming(projectId));
  const assignment = normalized.assignment;
  const projectTargetAspect = typeof project.targetAspect === "string" ? project.targetAspect : null;
  const detectorGate = framingDetectorGate("Locating the faces, charts and text inside each clip");
  const renderGate = framingRenderGate("Rendering the reframed frames");

  const storedNote = normalized.unreadable
    ? " The stored reframe assignment was unreadable and was ignored (the engine's own plan is in force)."
    : normalized.dropped.length > 0
      ? ` ${normalized.dropped.length} stored override(s) named an unknown format or policy and were dropped: ${normalized.dropped.join(", ")}.`
      : "";

  /* ------------------------------------------------ request validation */
  const requestedFormatRaw = body.format === undefined || body.format === null || body.format === "" ? null : body.format;
  if (requestedFormatRaw !== null && !isFrameFormatId(requestedFormatRaw)) {
    return fail(400, "Unknown output format.", "unknown_format", {
      note: "Expected one of: " + FRAME_FORMATS.join(", "),
      formats: listFormatViews(),
      changed: false,
      persisted: false,
    });
  }
  const requestedFormat = requestedFormatRaw as FrameFormatId | null;

  const requestedPolicyRaw = body.policy === undefined || body.policy === null || body.policy === "" ? null : body.policy;
  if (requestedPolicyRaw !== null && !isFramingPolicyId(requestedPolicyRaw)) {
    return fail(400, "Unknown framing policy.", "unknown_policy", {
      note: "Expected one of: " + FRAMING_POLICIES.join(", "),
      changed: false,
      persisted: false,
    });
  }
  const requestedPolicy = requestedPolicyRaw as FramingPolicyId | null;

  let requestedAnchor: AnchorPoint | null = null;
  if (body.anchor !== undefined && body.anchor !== null) {
    const checked = validateOverride({ anchor: body.anchor });
    if (!checked.ok) {
      return fail(400, checked.error, checked.code, { note: checked.note, changed: false, persisted: false });
    }
    requestedAnchor = checked.override.anchor ?? null;
  }

  const scopeResult = resolveScope(body);
  if (scopeResult.error) return scopeResult.error;
  const scope = scopeResult.scope as FramingScope;

  const requestedSceneId = str(body.sceneId);
  const requestedClipId = str(body.clipId);
  if (scope === "scene" && !requestedSceneId) {
    return fail(400, "sceneId is required when scope is \"scene\".", "scene_id_required", { changed: false, persisted: false });
  }
  if (scope === "clip" && !requestedClipId) {
    return fail(400, "clipId is required when scope is \"clip\".", "clip_id_required", { changed: false, persisted: false });
  }

  const clipIds = allTargets.map((t) => t.clipId);
  if (scope === "clip" && requestedClipId && !clipIds.includes(requestedClipId)) {
    return fail(400, "Unknown clip.", "unknown_clip", {
      note:
        `No clip with id "${requestedClipId}" exists in this project's plan. Reframing plans for ${clipIds.length} clip(s): ` +
        `${clipIds.slice(0, 12).join(", ")}${clipIds.length > 12 ? ", …" : ""}.` +
        (shorts.applied ? "" : " (No Block 5a shorts set is applied, so no `shorts-*` clip exists yet.)"),
      knownClips: clipIds.slice(0, MAX_PLANNED_CLIPS),
      changed: false,
      persisted: false,
    });
  }
  if (scope === "scene" && requestedSceneId && !scenesById.has(requestedSceneId) && !allTargets.some((t) => t.sceneId === requestedSceneId)) {
    return fail(400, "Unknown scene.", "unknown_scene", {
      note:
        `No scene with id "${requestedSceneId}" exists on this project. Known scene ids: ` +
        `${[...scenesById.keys()].slice(0, 12).join(", ") || "(none)"}.`,
      changed: false,
      persisted: false,
    });
  }

  /* ------------------------------------------------ plan every clip */
  const cap = Math.min(allTargets.length, MAX_PLANNED_CLIPS);
  const planned: PlannedClip[] = [];
  for (let i = 0; i < cap; i += 1) {
    planned.push(
      planClip(
        allTargets[i],
        scenesById,
        assetsByScene,
        scenesWithCaptions,
        assignment,
        projectTargetAspect,
        requestedFormatAlt(action, requestedFormat),
        requestedPolicy,
        requestedAnchor,
      ),
    );
  }
  const truncated = allTargets.length - cap;

  /** Does a clip belong to the scope this request asked about? */
  const rowInScope = (t: FramingTarget): boolean => {
    if (scope === "project") return true;
    if (scope === "scene") return t.sceneId === requestedSceneId;
    return t.clipId === requestedClipId;
  };
  const scopedClips = planned.filter((p) => rowInScope(p.targetRow));

  const effectiveByClip = Object.fromEntries(
    planned.map((p) => [
      p.targetRow.clipId,
      {
        format: p.format.id,
        formatOrigin: p.format.origin,
        policy: p.decision.policy.id,
        policyRequested: p.decision.policy.requested,
        engineDefault: p.decision.engineDefault,
        overrideSource: p.override.source,
        crop: { ...p.decision.crop.crop },
        scale: p.decision.crop.scale,
      },
    ]),
  );

  const baseBody = (): Record<string, unknown> => ({
    projectId,
    projectTitle: project.title,
    timelineSource,
    timelineMs: working.durationMs,
    clipCount: allTargets.length,
    sceneCount: scenesById.size,
    truncated,
    assignment: framingAssignmentView(assignment),
    unreadable: normalized.unreadable,
    droppedOverrides: normalized.dropped,
    effectiveByClip,
    repurposingLink: shortsLink,
  });

  /* ----------------------------------------------------- listFrameFormats */
  if (action === "listFrameFormats") {
    return {
      status: 200,
      body: {
        action: "listFrameFormats",
        ...baseBody(),
        count: FRAME_FORMATS.length,
        formats: listFormatViews(),
        policies: FRAMING_POLICIES.map((id) => ({
          id,
          label: FRAMING_POLICY_SPECS[id].label,
          rule: FRAMING_POLICY_SPECS[id].rule,
          anchor: { ...FRAMING_POLICY_SPECS[id].anchor },
          motion: FRAMING_POLICY_SPECS[id].motion,
          explicitOnly: FRAMING_POLICY_SPECS[id].explicitOnly,
        })),
        defaultFormat: DEFAULT_FRAME_FORMAT,
        anchors: anchorCheck(),
        provider: detectorGate,
        plan: { render: renderGate, framesRendered: false, detectorConnected: FRAMING_PROVIDER_CONNECTED },
        changed: false,
        persisted: false,
        note:
          `Deterministic catalogue: ${FRAME_FORMATS.length} delivery formats with their real resolutions, action-safe (93%) and title-safe (90%) ` +
          `rects, and the caption-safe band scaled from the subtitle engine's own margins; plus ${FRAMING_POLICIES.length} framing policies with their ` +
          `rules verbatim. The subject anchor is UNKNOWN — no field in this app locates a face, chart or text, so nothing was detected and nothing ` +
          `was invented. ${detectorGate.note} Nothing was rendered and nothing was persisted.${storedNote}`,
      },
    };
  }

  /* ----------------------------------------------------------- planReframe */
  if (action === "planReframe") {
    return {
      status: 200,
      body: {
        action: "planReframe",
        ...baseBody(),
        scope,
        sceneId: requestedSceneId ?? null,
        clipId: requestedClipId ?? null,
        requestedFormat: requestedFormat ?? null,
        requestedPolicy: requestedPolicy ?? null,
        clip: scopedClips[0] ? clipPlanView(scopedClips[0]) : null,
        clips: scopedClips.map(clipPlanView),
        scopedCount: scopedClips.length,
        provider: detectorGate,
        plan: { render: renderGate, framesRendered: false, detectorConnected: FRAMING_PROVIDER_CONNECTED },
        changed: false,
        persisted: false,
        note:
          `Planned ${scopedClips.length} clip(s) at ${scope} scope from ${allTargets.length} planned clip(s) on a ` +
          `${working.durationMs} ms timeline (${timelineSource === "saved" ? "saved timeline" : "rebuilt from the scenes"}). ` +
          `Every crop window, scale, safe area and keyframe above is computed from the frames the project actually has — the geometry ` +
          `is real arithmetic and nothing was rendered.${storedNote} ${detectorGate.note}` +
          (requestedFormat ? "" : " Pass `format` to plan another delivery format; the geometry really changes with it."),
      },
    };
  }

  /* -------------------------------------------------------- applyReframe */
  if (action === "applyReframe") {
    const patch = validateOverride({
      ...(requestedFormat ? { format: requestedFormat } : {}),
      ...(requestedPolicy ? { policy: requestedPolicy } : {}),
      ...(requestedAnchor ? { anchor: requestedAnchor } : {}),
      ...(body.note !== undefined ? { note: body.note } : {}),
    });
    if (!patch.ok) return fail(400, patch.error, patch.code, { note: patch.note, changed: false, persisted: false });
    if (Object.keys(patch.override).length === 0) {
      return fail(400, "Nothing to apply.", "empty_override", {
        note: "Pass at least one of `format`, `policy`, `anchor` or `note` — an empty override is not a reframe.",
        changed: false,
        persisted: false,
      });
    }

    const previous = assignment;
    const next: FramingAssignment = {
      project: previous.project,
      scenes: { ...previous.scenes },
      clips: { ...previous.clips },
      appliedAt: previous.appliedAt,
    };
    const target = scope === "project" ? "project" : scope === "scene" ? `scene ${requestedSceneId}` : `clip ${requestedClipId}`;
    if (scope === "project") next.project = mergeOverride(previous.project, patch.override);
    else if (scope === "scene") next.scenes[requestedSceneId as string] = mergeOverride(previous.scenes[requestedSceneId as string] ?? null, patch.override);
    else next.clips[requestedClipId as string] = mergeOverride(previous.clips[requestedClipId as string] ?? null, patch.override);

    const changed = !framingsEqual(previous, next);
    const appliedAt = changed ? new Date().toISOString() : previous.appliedAt;
    next.appliedAt = appliedAt;
    if (changed) await store.writeFraming(projectId, serializeFraming(next));

    const before = scope === "project" ? previous.project : scope === "scene" ? previous.scenes[requestedSceneId as string] ?? null : previous.clips[requestedClipId as string] ?? null;
    const after = scope === "project" ? next.project : scope === "scene" ? next.scenes[requestedSceneId as string] ?? null : next.clips[requestedClipId as string] ?? null;

    // Re-plan with the SAVED assignment so the response is the read-back, not the request echo.
    const readBack: PlannedClip[] = [];
    for (const target_ of allTargets.slice(0, Math.min(allTargets.length, MAX_PLANNED_CLIPS))) {
      if (!rowInScope(target_)) continue;
      readBack.push(
        planClip(target_, scenesById, assetsByScene, scenesWithCaptions, next, projectTargetAspect, null, null, null),
      );
    }

    const changelist: string[] = [];
    changelist.push(
      changed
        ? `reframe: ${target} ${before ? "updated" : "set"} → ${[
            after?.format ? `format ${FRAME_FORMAT_SPECS[after.format].aspect}` : null,
            after?.policy ? `policy ${after.policy}` : null,
            after?.anchor ? `anchor ${after.anchor.x},${after.anchor.y}` : null,
          ]
            .filter(Boolean)
            .join(", ")}.`
        : `reframe: ${target} already had exactly these settings — nothing to change.`,
    );
    for (const p of readBack) {
      changelist.push(
        `${p.targetRow.clipId}: ${p.format.id} crop ${p.decision.crop.crop.width}×${p.decision.crop.crop.height}px at ` +
          `${p.decision.crop.crop.x},${p.decision.crop.crop.y} (scale ${p.decision.crop.scale}×), policy ${p.decision.policy.id} (planned, not rendered).`,
      );
    }

    return {
      status: 200,
      body: {
        action: "applyReframe",
        ...baseBody(),
        assignment: framingAssignmentView(next),
        previous: framingAssignmentView(previous),
        scope,
        sceneId: requestedSceneId ?? null,
        clipId: requestedClipId ?? null,
        appliedOverride: after
          ? { format: after.format ?? null, policy: after.policy ?? null, anchor: after.anchor ?? null, note: after.note ?? null }
          : null,
        clip: readBack[0] ? clipPlanView(readBack[0]) : null,
        clips: readBack.map(clipPlanView),
        scopedCount: readBack.length,
        changed,
        persisted: changed,
        appliedAt,
        changelist,
        provider: detectorGate,
        plan: {
          applied: changed,
          render: renderGate,
          framesRendered: false,
          pixelsProduced: false,
          format: "metadata only — the override is recorded, no frame is cut or reframed",
        },
        note:
          (changed
            ? `The ${target} reframe override was recorded (${after?.format ? FRAME_FORMAT_SPECS[after.format].aspect : "format unchanged"}, ` +
              `${after?.policy ?? "policy unchanged"}) and the plan above is the read-back.`
            : `The ${target} override already stated exactly these settings, so nothing was written.`) +
          ` The OVERRIDE is real metadata; the geometry above is deterministic arithmetic on the project's frames. ` +
          `No frame was decoded, cut, reframed or encoded and no file was produced. ${renderGate.note}${storedNote}`,
      },
    };
  }

  /* -------------------------------------------------------- resetReframe */
  {
    const previous = assignment;
    const next: FramingAssignment = {
      project: previous.project,
      scenes: { ...previous.scenes },
      clips: { ...previous.clips },
      appliedAt: previous.appliedAt,
    };
    const hadProject = previous.project !== null;
    const hadScene = requestedSceneId ? previous.scenes[requestedSceneId] !== undefined : false;
    const hadClip = requestedClipId ? previous.clips[requestedClipId] !== undefined : false;
    if (scope === "project") next.project = null;
    else if (scope === "scene") delete next.scenes[requestedSceneId as string];
    else delete next.clips[requestedClipId as string];

    const changed = !framingsEqual(previous, next);
    const appliedAt = changed ? new Date().toISOString() : previous.appliedAt;
    next.appliedAt = appliedAt;
    if (changed) {
      // An empty assignment is written as null: the stored key is cleared, it is
      // not left behind as an envelope full of nulls.
      await store.writeFraming(projectId, isEmptyFramingAssignment(next) ? null : serializeFraming(next));
    }

    const target = scope === "project" ? "project" : scope === "scene" ? `scene ${requestedSceneId}` : `clip ${requestedClipId}`;
    const had = scope === "project" ? hadProject : scope === "scene" ? hadScene : hadClip;

    const readBack: PlannedClip[] = [];
    for (const target_ of allTargets.slice(0, Math.min(allTargets.length, MAX_PLANNED_CLIPS))) {
      if (!rowInScope(target_)) continue;
      readBack.push(planClip(target_, scenesById, assetsByScene, scenesWithCaptions, next, projectTargetAspect, requestedFormat, null, null));
    }

    const changelist: string[] = [
      changed ? `reframe: ${target} override cleared → the engine's own plan applies.` : `reframe: ${target} had no override — nothing to change.`,
    ];
    for (const p of readBack.slice(0, 8)) {
      changelist.push(
        `${p.targetRow.clipId}: engine plan is ${p.format.id} (${p.format.origin}) with policy ${p.decision.policy.id} — ` +
          `crop ${p.decision.crop.crop.width}×${p.decision.crop.crop.height}px at ${p.decision.crop.crop.x},${p.decision.crop.crop.y} (scale ${p.decision.crop.scale}×).`,
      );
    }

    return {
      status: 200,
      body: {
        action: "resetReframe",
        ...baseBody(),
        assignment: framingAssignmentView(next),
        previous: framingAssignmentView(previous),
        scope,
        sceneId: requestedSceneId ?? null,
        clipId: requestedClipId ?? null,
        hadOverride: had,
        clip: readBack[0] ? clipPlanView(readBack[0]) : null,
        clips: readBack.map(clipPlanView),
        scopedCount: readBack.length,
        changed,
        persisted: changed,
        appliedAt,
        changelist,
        provider: detectorGate,
        plan: { applied: changed, render: renderGate, framesRendered: false },
        note:
          (changed
            ? `The ${target} override was cleared, so the engine's own plan applies again — recomputed above from the project's frames.`
            : `The ${target} had no override, so the engine's plan was already in force; it is shown above.`) +
          (had && scope !== "project" ? " (A narrower scope override, if any, still wins over the project scope.)" : "") +
          ` Nothing was rendered.${storedNote}`,
      },
    };
  }
}

/**
 * The requested format only applies to the plan the CALLER asked for; on the
 * plain read actions the stored overrides decide. Kept as a tiny helper so the
 * intent is visible at every call site.
 */
function requestedFormatAlt(action: FramingAction, format: FrameFormatId | null): FrameFormatId | null {
  return action === "planReframe" ? format : null;
}

