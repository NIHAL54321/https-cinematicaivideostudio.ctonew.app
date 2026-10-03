/**
 * Phase 5 Block 1 + 2 — Editor API service (tenant-scoped, store-injected).
 *
 * The logic for every editor API action lives here, expressed against a tiny
 * `EditorStore` interface so it can be exercised by contract tests without a
 * database. The route (src/app/api/studio/editor/route.ts) only wires the
 * Prisma store in and maps `{ status, body }` onto a JSON response — the body
 * shape tested here IS the shape the HTTP client sees.
 *
 * Tenancy: every action first resolves the project through
 * `store.findOwnedProject(userId, projectId)`; a missing OR foreign project is
 * a 404 (never 403) so the API leaks nothing about other tenants.
 *
 * BLOCK 2 adds `sceneControl` (the seven spec scene controls — deterministic
 * plans + honest provider gates, logic in ./scenes) and `autoTransitions`
 * (the conservative auto policy, logic in ./transitions). Both are pure: they
 * never persist, the client keeps the result and saves it with `action: "save"`.
 *
 * Version LISTING is filtered to editor-format snapshots (Block 2 fix): the
 * same ProjectVersion table also holds Phase 1-3 PROJECT snapshots, which can
 * never be restored as a timeline — they are hidden from the list (and counted
 * honestly) instead of being offered as a broken Restore button.
 */
import {
  EditorError,
  buildTimelineFromScenes,
  type SceneInput,
  type Timeline,
} from "./timeline";
import {
  fromSnapshot,
  toSnapshot,
  validateTimelineShape,
} from "./versions";
import { DRAMA_MIN_CUTS, autoSelectTransitions, transitionSummary } from "./transitions";
import {
  SCENE_CONTROLS,
  applySceneControl,
  isSceneControlName,
  type SceneControlArgs,
  type SceneControlResult,
} from "./scenes";
import {
  AUTO_EDITOR_COMMANDS,
  applyAutoEditCommand,
  isAutoEditCommand,
  type AutoEditorCommand,
  type AutoEditorResult,
} from "./auto-editor";
import { analyzePacing, paceBandOf } from "./pacing";
import { runColorAction, type ColorStore } from "../color/service";
import { runRepurposeAction, type RepurposeStore } from "../repurpose/service";
import { runFramingAction, type FramingAssetRow, type FramingStore } from "../framing/service";
import { runExportAction, type ExportStore } from "../export/service";
import { runExportJobAction, type ExportJobStore } from "../export/job-service";

export const EDITOR_ACTIONS = [
  "build",
  "load",
  "save",
  "createVersion",
  "versions",
  "restoreVersion",
  "sceneControl",
  "autoTransitions",
  "autoEdit",
  "analyzePacing",
  // Phase 5 Block 4 — the colour system. The logic lives in src/lib/color
  // (store-injected, independently unit-tested); this switch only routes to it,
  // so the colour surface adds no second endpoint and no duplicated tenancy.
  "listGrades",
  "applyGrade",
  "resetGrade",
  "renderGradePreview",
  // Phase 5 Block 5a — long-form → shorts repurposing. The logic lives in
  // src/lib/repurpose (store-injected, independently unit-tested); this switch
  // only routes to it. Same single API surface, same tenancy check.
  "listShortsMoments",
  "configureShortsTargets",
  "applyShorts",
  "clearShorts",
  // Phase 5 Block 5b — smart 16:9 → 9:16 reframing and multi-format output. The
  // logic lives in src/lib/framing (store-injected, independently unit-tested);
  // this switch only routes to it. Same single API surface, same tenancy check.
  "listFrameFormats",
  "planReframe",
  "applyReframe",
  "resetReframe",
  // Phase 6 Block 1 — export & finishing: the deterministic deliverable-spec
  // layer (presets, size arithmetic, manifest, persisted preset choice). The
  // logic lives in src/lib/export (store-injected, independently unit-tested);
  // this switch only routes to it. Same single API surface, same tenancy check.
  "listExportPresets",
  "planExport",
  "applyExportPreset",
  "clearExportPreset",
  // Phase 6 Block 3 — finishing & packaging: the sidecar deliverables (subtitle
  // SRT/WebVTT, chapter markers, thumbnail, metadata) and the per-platform
  // publish-readiness check. Both are READ-ONLY: nothing is persisted, no rule
  // is estimated and no content is invented. The logic lives in src/lib/export
  // (./sidecars, ./chapters, ./readiness), store-injected like every block
  // before it; this switch only routes to it.
  "planSidecars",
  "checkPublishReadiness",
  // Phase 6 Block 5 — the export JOB handoff: createExportJob | listExportJobs |
  // getExportJob. These turn a specification into an actual REQUEST — a stored
  // snapshot plus the real video_enhancement task handed to the AI Model
  // Orchestrator — and land in the honest `blocked` state while no provider is
  // connected. The logic lives in src/lib/export/job-service.ts (store-injected,
  // independently unit-tested); this switch only routes to it, so the job surface
  // adds no second endpoint and no duplicated tenancy.
  "createExportJob",
  "listExportJobs",
  "getExportJob",
] as const;

export type EditorAction = (typeof EDITOR_ACTIONS)[number];

export interface EditorSceneRow {
  id: string;
  title: string | null;
  narration: string | null;
  durationSeconds: number | null;
  /** Block 2 — the scene's visual prompt (used by regenerateVisual's plan). */
  visualPrompt?: string | null;
  /**
   * Block 5b — the scene's declared frame shape (Prisma `AspectRatio`), used by
   * the reframing engine as one of the real sources of source-frame geometry.
   */
  aspectRatio?: string | null;
}

export interface EditorVersionRow {
  versionNumber: number;
  note: string | null;
  createdAt: Date;
  snapshotBytes: number;
  clipCount: number;
  durationMs: number;
  /**
   * Block 2 — true only for rows whose snapshot is an editor timeline envelope
   * (`cavis.editor.timeline`). Phase 1-3 project snapshots share the table and
   * must never be listed as restorable editor versions.
   */
  editorSnapshot: boolean;
}

export interface EditorStore {
  /**
   * Tenant-scoped project lookup (null when missing OR owned by someone else).
   * `targetAspect` (Prisma `Project.targetAspectRatio`) is optional so stores
   * that do not know it stay valid; the reframing engine reads it as a real
   * source of the project's intended delivery format.
   */
  findOwnedProject(
    userId: string,
    projectId: string,
  ): Promise<{ id: string; title: string; targetAspect?: string | null } | null>;
  listScenes(projectId: string): Promise<EditorSceneRow[]>;
  /** ProjectSettings.extra.editorTimeline (unvalidated raw JSON) or null. */
  readRawTimeline(projectId: string): Promise<unknown | null>;
  writeRawTimeline(projectId: string, timeline: unknown): Promise<void>;
  /** Newest first, WITHOUT the snapshots themselves. */
  listVersionRows(projectId: string): Promise<EditorVersionRow[]>;
  nextVersionNumber(projectId: string): Promise<number>;
  insertVersion(input: {
    projectId: string;
    versionNumber: number;
    note: string | null;
    snapshot: unknown;
    createdById: string;
  }): Promise<{ versionNumber: number; createdAt: Date }>;
  findVersion(
    projectId: string,
    versionNumber: number,
  ): Promise<{ snapshot: unknown; createdAt: Date } | null>;
  /**
   * Block 4 — the project's colour-grade assignment
   * (ProjectSettings.extra.colorGrade, unvalidated raw JSON) or null.
   * These two methods are also what makes this store a valid `ColorStore`.
   */
  readColorGrade(projectId: string): Promise<unknown | null>;
  writeColorGrade(projectId: string, value: unknown): Promise<void>;
  /**
   * Block 5a — the applied long-form → shorts set
   * (ProjectSettings.extra.shortsRepurpose, unvalidated raw JSON) or null.
   * These two methods are also what makes this store a valid `RepurposeStore`.
   */
  readShortsRepurpose(projectId: string): Promise<unknown | null>;
  writeShortsRepurpose(projectId: string, value: unknown): Promise<void>;
  /**
   * Block 5b — assets with REAL pixel dimensions (Asset.width/height) and the
   * scenes they are attached to. Read-only; the reframing engine never writes it.
   */
  listMediaAssets(projectId: string): Promise<FramingAssetRow[]>;
  /**
   * Block 5b — the reframe assignment
   * (ProjectSettings.extra.framing, unvalidated raw JSON) or null.
   * These three methods are also what makes this store a valid `FramingStore`.
   */
  readFraming(projectId: string): Promise<unknown | null>;
  writeFraming(projectId: string, value: unknown): Promise<void>;
  /**
   * Phase 6 Block 1 — the applied delivery presets
   * (ProjectSettings.extra.exportPreset, unvalidated raw JSON) or null.
   * These two methods are also what makes this store a valid `ExportStore`.
   */
  readExportPreset(projectId: string): Promise<unknown | null>;
  writeExportPreset(projectId: string, value: unknown): Promise<void>;
  /**
   * Phase 6 Block 5 — the project's export JOB records
   * (ProjectSettings.extra.exportJobs, unvalidated raw JSON) or null. These two
   * methods are also what makes this store a valid `ExportJobStore`.
   */
  readExportJobs(projectId: string): Promise<unknown | null>;
  writeExportJobs(projectId: string, value: unknown): Promise<void>;
}

export interface EditorResult {
  status: number;
  body: Record<string, unknown>;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function fail(status: number, error: string, code: string, extra: Record<string, unknown> = {}): EditorResult {
  return { status, body: { error, code, ...extra } };
}

function toSceneInput(row: EditorSceneRow): SceneInput {
  return {
    id: row.id,
    title: row.title,
    narration: row.narration,
    durationSeconds: row.durationSeconds,
    visualPrompt: row.visualPrompt ?? null,
  };
}

/**
 * The scene as the controls see it: the Scene row when the project has one, else
 * a synthesized view derived from the timeline clips (so the controls also work
 * on ad-hoc / manual scenes). Returns null when neither exists → the caller
 * answers 404.
 */
function resolveSceneInput(
  rows: EditorSceneRow[],
  timeline: Timeline,
  sceneId: string,
): { scene: SceneInput | null; source: "project" | "timeline" } | null {
  const row = rows.find((r) => r.id === sceneId);
  if (row) return { scene: toSceneInput(row), source: "project" };
  const clips = timeline.clips.filter((c) => c.sceneId === sceneId);
  if (clips.length === 0) return null;
  const startMs = clips.reduce((min, c) => Math.min(min, c.startMs), clips[0].startMs);
  const endMs = clips.reduce((max, c) => Math.max(max, c.endMs), clips[0].endMs);
  const video = clips.find((c) => c.trackId === "video") ?? clips[0];
  return {
    scene: {
      id: sceneId,
      title: video.name,
      // Narration is UNKNOWN here (undefined, not null) — the controls then leave
      // the voice lane alone instead of guessing that the scene has none.
      narration: undefined,
      durationSeconds: Math.max(1, Math.round((endMs - startMs) / 1000)),
    },
    source: "timeline",
  };
}

/**
 * The scene list the Block 3 auto editor works from: the project's Scene rows
 * plus a synthesized view of every scene that only exists on the supplied
 * timeline. For those, narration / visualPrompt stay UNKNOWN (undefined, never
 * null) so a command never mistakes "we do not know" for "the scene has none".
 */
function sceneInputsFor(rows: EditorSceneRow[], timeline: Timeline): SceneInput[] {
  const out = rows.map(toSceneInput);
  const known = new Set(rows.map((r) => r.id));
  const ids: string[] = [];
  for (const clip of timeline.clips) {
    if (!clip.sceneId || known.has(clip.sceneId) || ids.includes(clip.sceneId)) continue;
    ids.push(clip.sceneId);
  }
  for (const sceneId of ids) {
    const clips = timeline.clips.filter((c) => c.sceneId === sceneId);
    const startMs = clips.reduce((min, c) => Math.min(min, c.startMs), clips[0].startMs);
    const endMs = clips.reduce((max, c) => Math.max(max, c.endMs), clips[0].endMs);
    const video = clips.find((c) => c.trackId === "video") ?? clips[0];
    out.push({
      id: sceneId,
      title: video.name,
      narration: undefined,
      durationSeconds: Math.max(1, Math.round((endMs - startMs) / 1000)),
      visualPrompt: undefined,
    });
  }
  return out;
}

/** Timeline supplied by the caller (validated) — used by pure Block 2 actions. */
function timelineFromBody(body: Record<string, unknown>): { timeline?: Timeline; error?: EditorResult } {
  if (body.timeline === undefined || body.timeline === null) return {};
  const check = validateTimelineShape(body.timeline);
  if (!check.ok) return { error: fail(400, check.error, check.code) };
  return { timeline: check.timeline };
}

/** Working timeline: the saved one when readable, else rebuilt from scenes. */
async function resolveCurrentTimeline(
  store: EditorStore,
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

/**
 * Runs one editor action. Never throws for expected failures — invalid input
 * and tenancy problems come back as `{ status, body }` with an honest shape,
 * mirroring the other studio routes.
 */
export async function runEditorAction(
  store: EditorStore,
  userId: string,
  raw: unknown,
): Promise<EditorResult> {
  const body = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const action = str(body.action);
  if (!action || !(EDITOR_ACTIONS as readonly string[]).includes(action)) {
    return {
      status: 400,
      body: {
        connected: false,
        error: "Unknown action.",
        note: "Expected one of: " + EDITOR_ACTIONS.join(", "),
      },
    };
  }
  const projectId = str(body.projectId);
  if (!projectId) {
    return fail(400, "projectId is required.", "project_id_required");
  }

  const project = await store.findOwnedProject(userId, projectId);
  if (!project) return fail(404, "Project not found.", "not_found");

  switch (action as EditorAction) {
    /* ---------------------------------------------------------------- build */
    case "build": {
      const scenes = await store.listScenes(projectId);
      const timeline = buildTimelineFromScenes(scenes.map(toSceneInput));
      return {
        status: 200,
        body: {
          action: "build",
          projectId,
          projectTitle: project.title,
          source: "scenes",
          sceneCount: scenes.length,
          clipCount: timeline.clips.length,
          timeline,
          note: "Timeline built deterministically from the project's scenes. Nothing was persisted — send action \"save\" to keep it.",
        },
      };
    }

    /* ----------------------------------------------------------------- load */
    case "load": {
      const scenes = await store.listScenes(projectId);
      const resolved = await resolveCurrentTimeline(store, projectId);
      return {
        status: 200,
        body: {
          action: "load",
          projectId,
          projectTitle: project.title,
          source: resolved.source,
          sceneCount: scenes.length,
          clipCount: resolved.timeline.clips.length,
          timeline: resolved.timeline,
          note:
            resolved.source === "saved"
              ? "Loaded the saved editor timeline."
              : resolved.staleSaved
                ? "The saved timeline was unreadable and was rebuilt from the project's scenes."
                : "No saved timeline yet — built fresh from the project's scenes.",
        },
      };
    }

    /* ----------------------------------------------------------------- save */
    case "save": {
      const check = validateTimelineShape(body.timeline);
      if (!check.ok) return fail(400, check.error, check.code);
      await store.writeRawTimeline(projectId, check.timeline);
      const responseBody: Record<string, unknown> = {
        saved: true,
        projectId,
        count: check.timeline.clips.length,
        durationMs: check.timeline.durationMs,
      };
      if (check.dropped > 0) {
        responseBody.note = `${check.dropped} malformed clip(s) were dropped by validation.`;
      }
      return { status: 200, body: responseBody };
    }

    /* -------------------------------------------------------- createVersion */
    case "createVersion": {
      const resolved = await resolveCurrentTimeline(store, projectId);
      const note = str(body.note) ?? null;
      const snapshot = toSnapshot(resolved.timeline, { note: note ?? undefined, createdAt: new Date().toISOString() });
      let attempt = 0;
      let inserted: { versionNumber: number; createdAt: Date } | null = null;
      let lastError: unknown = null;
      while (attempt < 2 && !inserted) {
        attempt += 1;
        const versionNumber = await store.nextVersionNumber(projectId);
        try {
          inserted = await store.insertVersion({
            projectId,
            versionNumber,
            note,
            snapshot,
            createdById: userId,
          });
        } catch (err) {
          // Unique (projectId, versionNumber) race — recompute once.
          lastError = err;
        }
      }
      if (!inserted) {
        console.error("[editor] createVersion failed:", lastError);
        return fail(500, "Could not create a version.", "version_create_failed");
      }
      return {
        status: 200,
        body: {
          created: true,
          projectId,
          versionNumber: inserted.versionNumber,
          note,
          clipCount: resolved.timeline.clips.length,
          durationMs: resolved.timeline.durationMs,
          source: resolved.source,
        },
      };
    }

    /* -------------------------------------------------------------- versions */
    case "versions": {
      const rows = await store.listVersionRows(projectId);
      // Block 2 fix: only editor-format snapshots are restorable timelines.
      // Phase 1-3 PROJECT snapshots share ProjectVersion — hide them, count them.
      const editorRows = rows.filter((r) => r.editorSnapshot);
      const hiddenCount = rows.length - editorRows.length;
      const responseBody: Record<string, unknown> = {
        projectId,
        count: editorRows.length,
        hiddenCount,
        versions: editorRows.map((r) => ({
          versionNumber: r.versionNumber,
          note: r.note,
          createdAt: r.createdAt.toISOString(),
          snapshotBytes: r.snapshotBytes,
          clipCount: r.clipCount,
          durationMs: r.durationMs,
        })),
      };
      if (hiddenCount > 0) {
        responseBody.note = `${hiddenCount} non-editor snapshot(s) (Phase 1-3 project format) hidden — they cannot be restored as a timeline.`;
      }
      return { status: 200, body: responseBody };
    }

    /* -------------------------------------------------------- restoreVersion */
    case "restoreVersion": {
      const versionNumber = num(body.versionNumber);
      if (versionNumber === undefined || versionNumber < 1 || !Number.isInteger(versionNumber)) {
        return fail(400, "versionNumber must be a positive integer.", "invalid_version_number");
      }
      const row = await store.findVersion(projectId, versionNumber);
      if (!row) return fail(404, "Version not found.", "not_found");
      const timeline = fromSnapshot(row.snapshot);
      if (!timeline) return fail(400, "That version's snapshot is not a readable timeline.", "invalid_snapshot");
      await store.writeRawTimeline(projectId, timeline);
      return {
        status: 200,
        body: {
          restored: true,
          projectId,
          versionNumber,
          clipCount: timeline.clips.length,
          timeline,
          note: "Version restored into the working editor timeline. Save (or keep editing) to build on it.",
        },
      };
    }

    /* -------------------------------------------------------- sceneControl */
    case "sceneControl": {
      const control = str(body.control);
      if (!control || !isSceneControlName(control)) {
        return fail(400, "Unknown control.", "unknown_control", {
          note: "Expected one of: " + SCENE_CONTROLS.join(", "),
        });
      }
      const sceneId = str(body.sceneId);
      if (!sceneId) return fail(400, "sceneId is required.", "scene_id_required");

      const supplied = timelineFromBody(body);
      if (supplied.error) return supplied.error;
      const resolved = supplied.timeline
        ? { timeline: supplied.timeline, source: "request" as const }
        : { timeline: (await resolveCurrentTimeline(store, projectId)).timeline, source: "timeline" as const };

      const rows = await store.listScenes(projectId);
      const resolvedScene = resolveSceneInput(rows, resolved.timeline, sceneId);
      if (!resolvedScene) {
        return fail(404, "Scene not found on this project's timeline.", "scene_not_found");
      }

      const args: SceneControlArgs = {
        sceneId,
        scene: resolvedScene.scene,
        visualPrompt: str(body.visualPrompt) ?? null,
        mood: str(body.mood) ?? null,
        energy: num(body.energy) ?? null,
        kind: str(body.kind) ?? null,
        durationMs: num(body.durationMs) ?? null,
        styleId: str(body.styleId) ?? null,
        grade: str(body.grade) ?? null,
      };

      let result: SceneControlResult;
      try {
        result = applySceneControl(resolved.timeline, control, args);
      } catch (err) {
        if (err instanceof EditorError) {
          const status = err.code === "scene_not_found" ? 404 : 400;
          return fail(status, err.message, err.code);
        }
        console.error("[editor] sceneControl failed:", err);
        return fail(500, "The scene control could not run.", "scene_control_failed");
      }

      return {
        status: 200,
        body: {
          action: "sceneControl",
          projectId,
          control: result.control,
          sceneId: result.sceneId,
          sceneSource: resolvedScene.source,
          timelineSource: resolved.source,
          changed: result.changed,
          changelist: result.changelist,
          ...(result.timeline ? { timeline: result.timeline } : {}),
          ...(result.provider ? { provider: result.provider } : {}),
          ...(result.selection ? { selection: result.selection } : {}),
          ...(result.plan ? { plan: result.plan } : {}),
          ...(result.note ? { note: result.note } : {}),
          // Scene controls produce a PLAN — the client keeps it and saves it with
          // action "save". Nothing is written to the project here.
          persisted: false,
        },
      };
    }

    /* ------------------------------------------------------ autoTransitions */
    case "autoTransitions": {
      const supplied = timelineFromBody(body);
      if (supplied.error) return supplied.error;
      const base = supplied.timeline ?? (await resolveCurrentTimeline(store, projectId)).timeline;
      const timeline = autoSelectTransitions(base);
      const summary = transitionSummary(timeline);
      return {
        status: 200,
        body: {
          action: "autoTransitions",
          projectId,
          timeline,
          clipCount: timeline.clips.length,
          durationMs: timeline.durationMs,
          transitions: {
            total: summary.total,
            nonCut: summary.nonCut,
            dramatic: summary.dramatic,
            cuts: summary.cuts,
          },
          violations: summary.violations,
          persisted: false,
          note:
            `Auto transitions applied to the video lane: ${summary.nonCut} blend(s), ` +
            `${summary.dramatic} dramatic — the policy never opens on a transition, never blends inside a scene ` +
            `and spaces blends at least ${DRAMA_MIN_CUTS} cuts apart. Nothing was persisted — save to keep it.`,
        },
      };
    }

    /* ------------------------------------------------------------- autoEdit */
    case "autoEdit": {
      const command = str(body.command);
      if (!command || !isAutoEditCommand(command)) {
        return fail(400, "Unknown command.", "unknown_command", {
          note: "Expected one of: " + AUTO_EDITOR_COMMANDS.join(", "),
        });
      }
      const supplied = timelineFromBody(body);
      if (supplied.error) return supplied.error;
      const base = supplied.timeline ?? (await resolveCurrentTimeline(store, projectId)).timeline;
      const scenes = sceneInputsFor(await store.listScenes(projectId), base);
      const intensity = num(body.intensity) ?? null;

      let result: AutoEditorResult;
      try {
        result = applyAutoEditCommand(base, scenes, command as AutoEditorCommand, { intensity });
      } catch (err) {
        if (err instanceof EditorError) {
          const status = err.code === "scene_not_found" ? 404 : 400;
          return fail(status, err.message, err.code);
        }
        console.error("[editor] autoEdit failed:", err);
        return fail(500, "The auto-edit command could not run.", "auto_edit_failed");
      }

      return {
        status: 200,
        body: {
          action: "autoEdit",
          projectId,
          command: result.command,
          timelineSource: supplied.timeline ? "request" : "timeline",
          changed: result.changed,
          changelist: result.changelist,
          ...(result.timeline ? { timeline: result.timeline } : {}),
          ...(result.provider ? { provider: result.provider } : {}),
          ...(result.plan ? { plan: result.plan } : {}),
          ...(result.note ? { note: result.note } : {}),
          clipCount: result.timeline?.clips.length ?? base.clips.length,
          durationMs: result.timeline?.durationMs ?? base.durationMs,
          // Auto-edit produces a NEW timeline — the client keeps it and saves it
          // with action "save". Nothing is written to the project here.
          persisted: false,
        },
      };
    }

    /* -------------------------------------------------------- analyzePacing */
    case "analyzePacing": {
      const supplied = timelineFromBody(body);
      if (supplied.error) return supplied.error;
      const base = supplied.timeline ?? (await resolveCurrentTimeline(store, projectId)).timeline;
      const scenes = sceneInputsFor(await store.listScenes(projectId), base);
      const analysis = analyzePacing(base, scenes);
      return {
        status: 200,
        body: {
          action: "analyzePacing",
          projectId,
          timelineSource: supplied.timeline ? "request" : "timeline",
          dimensions: analysis.dimensions,
          overall: analysis.overall,
          band: paceBandOf(analysis.overall),
          clipCount: base.clips.length,
          durationMs: base.durationMs,
          note: analysis.note,
          persisted: false,
        },
      };
    }

    /* --------------------------------------------------------- Block 4 colour */
    // listGrades | applyGrade | resetGrade | renderGradePreview live in
    // src/lib/color/service.ts. The store passed here structurally satisfies
    // `ColorStore`, so the colour service keeps its own tenancy check (a missing
    // or foreign project is a 404 for every colour action too).
    case "listGrades":
    case "applyGrade":
    case "resetGrade":
    case "renderGradePreview": {
      const result = await runColorAction(store as ColorStore, userId, body);
      return { status: result.status, body: { ...result.body, projectId } };
    }

    /* ------------------------------------------- Block 5a repurposing */
    // listShortsMoments | configureShortsTargets | applyShorts | clearShorts live
    // in src/lib/repurpose/service.ts. The store passed here structurally
    // satisfies `RepurposeStore`, so the repurposing service keeps its own
    // tenancy check (a missing or foreign project is a 404 here too).
    case "listShortsMoments":
    case "configureShortsTargets":
    case "applyShorts":
    case "clearShorts": {
      const result = await runRepurposeAction(store as RepurposeStore, userId, body);
      return { status: result.status, body: { ...result.body, projectId } };
    }

    /* ---------------------------- Block 5b reframing + multi-format output */
    // listFrameFormats | planReframe | applyReframe | resetReframe live in
    // src/lib/framing/service.ts. The store passed here structurally satisfies
    // `FramingStore`, so the framing service keeps its own tenancy check (a
    // missing or foreign project is a 404 here too).
    case "listFrameFormats":
    case "planReframe":
    case "applyReframe":
    case "resetReframe": {
      const result = await runFramingAction(store as FramingStore, userId, body);
      return { status: result.status, body: { ...result.body, projectId } };
    }

    /* ---------------------- Phase 6 Block 1 export & finishing ----------- */
    // listExportPresets | planExport | applyExportPreset | clearExportPreset live
    // in src/lib/export/service.ts. The store passed here structurally satisfies
    // `ExportStore`, so the export service keeps its own tenancy check (a missing
    // or foreign project is a 404 here too).
    //
    // Phase 6 Block 3 adds planSidecars | checkPublishReadiness on the same
    // service and the same route: the sidecar deliverables and the per-platform
    // readiness check are read-only, so they never write project metadata.
    case "listExportPresets":
    case "planExport":
    case "applyExportPreset":
    case "clearExportPreset":
    case "planSidecars":
    case "checkPublishReadiness": {
      const result = await runExportAction(store as ExportStore, userId, body);
      return { status: result.status, body: { ...result.body, projectId } };
    }

    /* ------------------- Phase 6 Block 5 export job handoff --------------- */
    // createExportJob | listExportJobs | getExportJob live in
    // src/lib/export/job-service.ts. That service calls the REAL AI Model
    // Orchestrator (src/lib/ai/orchestrator.ts) for capability
    // video_enhancement, so the job records the router's own answer — including
    // its verbatim "Provider Not Connected" message — instead of a hand-rolled
    // check. The store passed here structurally satisfies `ExportJobStore`, so
    // the job service keeps its own tenancy check (a missing or foreign project
    // is a 404 here too).
    case "createExportJob":
    case "listExportJobs":
    case "getExportJob": {
      const result = await runExportJobAction(store as ExportJobStore, userId, body);
      return { status: result.status, body: { ...result.body, projectId } };
    }

    default:
      return {
        status: 400,
        body: {
          connected: false,
          error: "Unknown action.",
          note: "Expected one of: " + EDITOR_ACTIONS.join(", "),
        },
      };
  }
}
