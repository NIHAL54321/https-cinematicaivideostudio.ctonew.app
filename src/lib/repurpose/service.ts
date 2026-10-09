/**
 * Phase 5 Block 5a — Long-form → shorts repurposing service (tenant-scoped,
 * store-injected).
 *
 * The logic for the repurposing API actions lives here, expressed against a tiny
 * `RepurposeStore` interface so it can be exercised by contract tests without a
 * database. The HTTP route (src/app/api/studio/editor/route.ts) reaches this
 * through src/lib/editor/service.ts — one surface, no parallel API.
 *
 * DETERMINISTIC (real work, nothing faked):
 *   listShortsMoments      — scores the timeline + script into classified moment
 *                            candidates (kind, score, reason, signals) and turns
 *                            them into concrete clip windows per platform target.
 *   configureShortsTargets — validates a caller-supplied output set (counts and
 *                            duration windows per platform), applies it for real
 *                            and reports back the config that was used plus the
 *                            clip set it produces.
 *   applyShorts            — PERSISTS the chosen set (config + clips) as project
 *                            metadata and reads back.
 *   clearShorts            — clears that metadata.
 *
 * PROVIDER-GATED (honest gate, nothing changed):
 *   - Real moment detection from the media (transcribing the audio, audio/visual
 *     ML over the footage) is `speech_recognition` + `scene_detection`; the
 *     response says so with env var NAMES only and produces no transcript and no
 *     "detected" moment.
 *   - Cutting, reframing (16:9 → 9:16) and encoding the actual clip files is
 *     `video_enhancement`; no frames are cut, reframed or encoded and no media
 *     file is invented. Multi-format rendering is Block 5b.
 *
 * Tenancy: every action resolves the project through
 * `store.findOwnedProject(userId, projectId)` first; a missing OR foreign project
 * is a 404 (never 403) so the API leaks nothing about other tenants.
 */
import { buildTimelineFromScenes, type SceneInput, type Timeline } from "../editor/timeline";
import { fromSnapshot } from "../editor/versions";
import {
  capabilityEnvNames,
  capabilityEnvNamesFor,
} from "../ai/providers/capability-env";
import {
  derivedProviderGate,
  type CapabilityProviderGate,
} from "../ai/providers/capability-connectivity";
import { analyzeMoments, MOMENT_KINDS, type MomentCandidate, type MomentKind } from "./moments";
import {
  buildClipPlan,
  clipStats,
  clipView,
  flattenClips,
  planSummary,
  type ClipPlan,
} from "./clips";
import {
  defaultTargetConfig,
  targetConfigsEqual,
  targetConfigView,
  validateTargetConfig,
  readStoredTargetConfig,
  REPURPOSE_CONFIG_FORMAT,
  type ShortsTargetConfig,
} from "./targets";
import {
  assignmentView,
  assignmentsEqual,
  normalizeShortsAssignment,
  serializeShortsAssignment,
  type ShortsAssignment,
} from "./assignment";

/* ------------------------------------------------------------------ */
/* Provider gating                                                     */
/* ------------------------------------------------------------------ */

/**
 * Env var NAMES (never values) a server operator would set to connect real media
 * analysis / media processing. Derived from the provider env-key registry plus
 * the capability→provider slot table (`capability-env`), never hard-coded: the
 * analysis gate is gated on speech_recognition and scene_detection (openai,
 * google, replicate, elevenlabs, azure) and the render gate on video_enhancement
 * (replicate, runway), so every name printed here is one some code actually
 * reads. A name no code reads would do nothing, so none is invented.
 */
export const REPURPOSE_ANALYSIS_CAPABILITY = "speech_recognition";
export const REPURPOSE_VISUAL_CAPABILITY = "scene_detection";
export const REPURPOSE_RENDER_CAPABILITY = "video_enhancement";

/** Derived: registry names that could enable transcription + visual analysis. */
export const REPURPOSE_TRANSCRIPTION_ENV_NAMES = capabilityEnvNames(REPURPOSE_ANALYSIS_CAPABILITY);
export const REPURPOSE_VISUAL_ENV_NAMES = capabilityEnvNames(REPURPOSE_VISUAL_CAPABILITY);
export const REPURPOSE_ANALYSIS_ENV_NAMES = capabilityEnvNamesFor([
  REPURPOSE_ANALYSIS_CAPABILITY,
  REPURPOSE_VISUAL_CAPABILITY,
]);
export const REPURPOSE_RENDER_ENV_NAMES = capabilityEnvNames(REPURPOSE_RENDER_CAPABILITY);

/**
 * A CODE fact, and NOT a claim about this server: the repurposing engine contains
 * no call site that dispatches to a provider (this file imports no orchestrator).
 * `connected` is DERIVED separately, on every response, from the provider
 * registry — so a gate here can never contradict GET /api/ai/status.
 */
export const REPURPOSE_ENGINE_DISPATCHES = false;

/** The gate shape every engine in the app returns — one shared implementation. */
export type ProviderGate = CapabilityProviderGate;

/**
 * Honest gate for real media analysis (transcription + audio/visual ML). The
 * work needs BOTH capabilities, so this gate is connected only when both are
 * configured AND wired — derived at call time, never declared.
 */
export function repurposeAnalysisGate(what: string): ProviderGate {
  return derivedProviderGate({
    capability: REPURPOSE_ANALYSIS_CAPABILITY,
    capabilities: [REPURPOSE_ANALYSIS_CAPABILITY, REPURPOSE_VISUAL_CAPABILITY],
    what,
    engineDispatches: REPURPOSE_ENGINE_DISPATCHES,
    notProduced:
      "no transcript was produced, no frame was analysed and no moment was \"detected\" from the media.",
  });
}

/** Honest gate for cutting / reframing / encoding the real clip files. */
export function repurposeRenderGate(what: string): ProviderGate {
  return derivedProviderGate({
    capability: REPURPOSE_RENDER_CAPABILITY,
    what,
    engineDispatches: REPURPOSE_ENGINE_DISPATCHES,
    notProduced: "no frames were cut, reframed or encoded and no media file was produced.",
  });
}

/* ------------------------------------------------------------------ */
/* Store contract                                                      */
/* ------------------------------------------------------------------ */

export interface RepurposeSceneRow {
  id: string;
  title: string | null;
  narration: string | null;
  durationSeconds: number | null;
}

export interface RepurposeStore {
  /** Tenant-scoped project lookup (null when missing OR owned by someone else). */
  findOwnedProject(userId: string, projectId: string): Promise<{ id: string; title: string } | null>;
  listScenes(projectId: string): Promise<RepurposeSceneRow[]>;
  /** ProjectSettings.extra.editorTimeline (unvalidated raw JSON) or null. */
  readRawTimeline(projectId: string): Promise<unknown | null>;
  /** ProjectSettings.extra.shortsRepurpose (unvalidated raw JSON) or null. */
  readShortsRepurpose(projectId: string): Promise<unknown | null>;
  writeShortsRepurpose(projectId: string, value: unknown): Promise<void>;
}

export interface RepurposeResult {
  status: number;
  body: Record<string, unknown>;
}

export const REPURPOSE_ACTIONS = [
  "listShortsMoments",
  "configureShortsTargets",
  "applyShorts",
  "clearShorts",
] as const;
export type RepurposeAction = (typeof REPURPOSE_ACTIONS)[number];

export function isRepurposeAction(v: unknown): v is RepurposeAction {
  return typeof v === "string" && (REPURPOSE_ACTIONS as readonly string[]).includes(v);
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function fail(status: number, error: string, code: string, extra: Record<string, unknown> = {}): RepurposeResult {
  return { status, body: { error, code, ...extra } };
}

function toSceneInput(row: RepurposeSceneRow): SceneInput {
  return {
    id: row.id,
    title: row.title,
    narration: row.narration,
    durationSeconds: row.durationSeconds,
  };
}

/** Working timeline: the saved one when readable, else rebuilt from scenes. */
async function resolveTimeline(
  store: RepurposeStore,
  projectId: string,
): Promise<{ timeline: Timeline; source: "saved" | "scenes"; staleSaved: boolean }> {
  const raw = await store.readRawTimeline(projectId);
  const restored = raw === null || raw === undefined ? null : fromSnapshot(raw);
  if (restored) return { timeline: restored, source: "saved", staleSaved: false };
  const scenes = await store.listScenes(projectId);
  return {
    timeline: buildTimelineFromScenes(scenes.map(toSceneInput)),
    source: "scenes",
    staleSaved: raw !== null && raw !== undefined,
  };
}

interface Context {
  timeline: Timeline;
  timelineSource: "saved" | "scenes";
  staleSaved: boolean;
  scenes: RepurposeSceneRow[];
  moments: ReturnType<typeof analyzeMoments>;
  current: ShortsAssignment | null;
  unreadableStored: boolean;
  droppedClips: number;
  /** The config in force: the request's, else the applied one, else the defaults. */
  config: ShortsTargetConfig;
  configSource: "request" | "applied" | "default";
  plan: ClipPlan;
}

/**
 * Everything the four actions share: the timeline, the scored moments, the
 * stored assignment and the effective config + clip plan for this request.
 */
async function buildContext(
  store: RepurposeStore,
  projectId: string,
  body: Record<string, unknown>,
): Promise<{ ctx?: Context; error?: RepurposeResult }> {
  const resolved = await resolveTimeline(store, projectId);
  const scenes = await store.listScenes(projectId);
  const sceneInputs = scenes.map(toSceneInput);
  const normalized = normalizeShortsAssignment(await store.readShortsRepurpose(projectId));

  const supplied = body.targets;
  const validation = validateTargetConfig(supplied);
  if (!validation.ok) {
    return {
      error: fail(400, validation.error, validation.code, {
        note: validation.note,
        projectId,
        changed: false,
        persisted: false,
      }),
    };
  }

  const appliedConfig = normalized.assignment
    ? { format: REPURPOSE_CONFIG_FORMAT, version: 1, targets: normalized.assignment.targets }
    : null;
  const config = validation.supplied.length > 0 ? validation.config : (appliedConfig ?? validation.config);
  const configSource: Context["configSource"] =
    validation.supplied.length > 0 ? "request" : appliedConfig ? "applied" : "default";

  const moments = analyzeMoments(resolved.timeline, sceneInputs);
  const plan = buildClipPlan(moments.candidates, resolved.timeline, config);

  return {
    ctx: {
      timeline: resolved.timeline,
      timelineSource: resolved.source,
      staleSaved: resolved.staleSaved,
      scenes,
      moments,
      current: normalized.assignment,
      unreadableStored: normalized.unreadable,
      droppedClips: normalized.droppedClips,
      config,
      configSource,
      plan,
    },
  };
}

/** The moment candidate as the client reads it (reason and signals verbatim). */
function candidateView(c: MomentCandidate): Record<string, unknown> {
  return {
    id: c.id,
    kind: c.kind,
    sceneId: c.sceneId,
    sceneIndex: c.sceneIndex,
    startMs: c.startMs,
    endMs: c.endMs,
    durationMs: c.durationMs,
    durationSeconds: Math.round(c.durationMs / 100) / 10,
    title: c.title,
    text: c.text,
    score: c.score,
    reason: c.reason,
    signals: c.signals,
    watchedFootage: c.watchedFootage,
    basis: c.basis,
  };
}

/* ------------------------------------------------------------------ */
/* Action handler                                                      */
/* ------------------------------------------------------------------ */

/**
 * Runs one repurposing action. Never throws for expected failures — invalid
 * input and tenancy problems come back as `{ status, body }`, mirroring the rest
 * of the studio API. The body shape returned here IS the shape the HTTP client
 * sees.
 */
export async function runRepurposeAction(
  store: RepurposeStore,
  userId: string,
  raw: unknown,
): Promise<RepurposeResult> {
  const body = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const action = str(body.action);
  if (!action || !isRepurposeAction(action)) {
    return fail(400, "Unknown repurposing action.", "unknown_action", {
      note: "Expected one of: " + REPURPOSE_ACTIONS.join(", "),
    });
  }
  const projectId = str(body.projectId);
  if (!projectId) return fail(400, "projectId is required.", "project_id_required");

  const project = await store.findOwnedProject(userId, projectId);
  if (!project) return fail(404, "Project not found.", "not_found");

  const built = await buildContext(store, projectId, body);
  if (built.error) return built.error;
  const ctx = built.ctx as Context;

  const countsByKind = Object.fromEntries(MOMENT_KINDS.map((k) => [k, ctx.moments.countsByKind[k]])) as Record<
    MomentKind,
    number
  >;
  const analysisGate = repurposeAnalysisGate("Transcribing the audio and analysing the footage for moments");
  const renderGate = repurposeRenderGate("Cutting, reframing and encoding the clip files");

  const appliedBefore = assignmentView(ctx.current);
  const storedNote = ctx.unreadableStored
    ? " The stored repurposing assignment was unreadable and was ignored (nothing is applied)."
    : ctx.droppedClips > 0
      ? ` ${ctx.droppedClips} stored clip(s) had an unusable window and were dropped.`
      : "";

  /* ----------------------------------------------------- listShortsMoments */
  if (action === "listShortsMoments") {
    return {
      status: 200,
      body: {
        action: "listShortsMoments",
        projectId,
        projectTitle: project.title,
        timelineSource: ctx.timelineSource,
        timelineMs: ctx.timeline.durationMs,
        clipCount: ctx.timeline.clips.length,
        basis: ctx.moments.basis,
        watchedFootage: false,
        momentCount: ctx.moments.candidateCount,
        returned: ctx.moments.candidates.length,
        candidateLimit: 40,
        countsByKind,
        moments: ctx.moments.candidates.map(candidateView),
        units: ctx.moments.totals,
        pacing: ctx.moments.pacing,
        config: targetConfigView(ctx.config),
        configSource: ctx.configSource,
        targets: planSummary(ctx.plan),
        clips: flattenClips(ctx.plan).map(clipView),
        clipStats: clipStats(flattenClips(ctx.plan)),
        totalClips: ctx.plan.totalClips,
        applied: appliedBefore,
        provider: analysisGate,
        plan: {
          render: renderGate,
          mediaAnalysed: false,
          transcriptProduced: false,
          clipsRendered: false,
          plannedClips: ctx.plan.totalClips,
        },
        changed: false,
        persisted: false,
        unreadable: ctx.unreadableStored,
        note:
          `Scored ${ctx.moments.totals.units} unit(s) of the timeline against the script: ${ctx.moments.candidateCount} candidate moment(s), ` +
          `${ctx.plan.totalClips} clip window(s) planned across the targets. The scores are arithmetic on the narration text and the ` +
          `timeline structure — the footage was NOT analysed, so no transcript and no "detected" moment was produced. ` +
          storedNote +
          analysisGate.note +
          " Nothing was persisted.",
      },
    };
  }

  /* ------------------------------------------------ configureShortsTargets */
  if (action === "configureShortsTargets") {
    const targetConfig = ctx.config;
    const sameAsApplied = ctx.current
      ? targetConfigsEqual({ format: targetConfig.format, version: targetConfig.version, targets: ctx.current.targets }, targetConfig) &&
        ctx.current.clips.length === ctx.plan.totalClips
      : false;
    return {
      status: 200,
      body: {
        action: "configureShortsTargets",
        projectId,
        configSource: ctx.configSource,
        config: targetConfigView(targetConfig),
        configChanges: targetConfigsEqual(
          { format: targetConfig.format, version: targetConfig.version, targets: defaultTargetConfig().targets },
          targetConfig,
        )
          ? []
          : ["the output sets differ from the engine defaults"],
        targets: planSummary(ctx.plan),
        clips: flattenClips(ctx.plan).map(clipView),
        clipStats: clipStats(flattenClips(ctx.plan)),
        totalClips: ctx.plan.totalClips,
        timelineMs: ctx.timeline.durationMs,
        applied: appliedBefore,
        changed: !sameAsApplied,
        persisted: false,
        provider: analysisGate,
        plan: { render: renderGate, mediaAnalysed: false, transcriptProduced: false, clipsRendered: false },
        note:
          `Platform targets validated and applied to this request: ` +
          ctx.plan.targets.map((t) => `${t.target} ${t.enabled ? `${t.count}×${t.minSeconds}-${t.maxSeconds}s` : "off"} → ${t.produced} clip(s)`).join(", ") +
          `. The config is REAL and was used to build the clip windows; nothing was persisted (use action "applyShorts" to keep the set) and ` +
          `no media was cut or encoded. ${renderGate.note}`,
      },
    };
  }

  /* ------------------------------------------------------------ applyShorts */
  if (action === "applyShorts") {
    const clips = flattenClips(ctx.plan);
    const appliedAt = new Date().toISOString();
    const next: ShortsAssignment = {
      targets: ctx.config.targets,
      clips: clips.map((clip) => ({
        id: clip.id,
        target: clip.target,
        rank: clip.rank,
        label: clip.label,
        clipKind: clip.clipKind,
        momentKind: clip.momentKind,
        momentId: clip.momentId,
        score: clip.momentScore,
        reason: clip.reason,
        startMs: clip.startMs,
        endMs: clip.endMs,
        durationMs: clip.durationMs,
        scenes: [...clip.scenes],
      })),
      appliedAt,
      timelineMs: ctx.timeline.durationMs,
    };
    const changed = !assignmentsEqual(ctx.current, next);
    if (changed) {
      await store.writeShortsRepurpose(
        projectId,
        serializeShortsAssignment({
          config: ctx.config,
          clips,
          appliedAt,
          timelineMs: ctx.timeline.durationMs,
        }),
      );
    }
    return {
      status: 200,
      body: {
        action: "applyShorts",
        projectId,
        config: targetConfigView(ctx.config),
        targets: planSummary(ctx.plan),
        clips: clips.map(clipView),
        clipStats: clipStats(clips),
        totalClips: clips.length,
        applied: assignmentView(next),
        previous: appliedBefore,
        changed,
        persisted: changed,
        changelist: changed
          ? [
              `shorts set: ${appliedBefore ? `${(appliedBefore.clipCount as number) ?? 0} clip(s)` : "none"} → ${clips.length} clip(s)`,
              ...ctx.plan.targets.map(
                (t) => `target ${t.target}: ${t.enabled ? `${t.produced}/${t.count} clip(s)` : "disabled"}`,
              ),
            ]
          : ["shorts set: the chosen clips already match the stored set — nothing to write."],
        provider: analysisGate,
        plan: {
          render: renderGate,
          applied: changed,
          clipsRendered: false,
          reframed: false,
          encoded: false,
          format: "metadata only — the clip windows are recorded, not cut",
        },
        note:
          (changed
            ? `${clips.length} clip window(s) across ${ctx.plan.targets.filter((t) => t.produced > 0).length} target(s) were recorded as project metadata.`
            : `The chosen clip set already matched the stored set — nothing was written.`) +
          storedNote +
          ` The ASSIGNMENT is real metadata; no frames were cut, no 16:9 → 9:16 reframing was performed and no file was encoded. ` +
          `Multi-format rendering is the next block (5b). ${renderGate.note}`,
        timelineMs: ctx.timeline.durationMs,
      },
    };
  }

  /* ------------------------------------------------------------ clearShorts */
  {
    const had = ctx.current !== null;
    const next: ShortsAssignment | null = null;
    const changed = !assignmentsEqual(ctx.current, next);
    if (changed) await store.writeShortsRepurpose(projectId, null);
    return {
      status: 200,
      body: {
        action: "clearShorts",
        projectId,
        previous: appliedBefore,
        applied: null,
        clips: [],
        totalClips: 0,
        changed,
        persisted: changed,
        changelist: [changed ? `shorts set: ${had ? "cleared" : "already empty"}` : "shorts set: already empty — nothing to change."],
        // A clear is pure metadata: there is no media work to gate.
        plan: { applied: changed, clipsRendered: false },
        note: changed
          ? "The applied shorts set was cleared. The clip windows are no longer recorded — the engine can rebuild them from the timeline at any time."
          : "No shorts set was applied, so there was nothing to clear.",
      },
    };
  }
}
