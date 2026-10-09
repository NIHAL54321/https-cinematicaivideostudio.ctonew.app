/**
 * Phase 5 Block 4 — Colour system service (tenant-scoped, store-injected).
 *
 * The logic for the colour API actions lives here, expressed against a tiny
 * `ColorStore` interface so it can be exercised by contract tests without a
 * database. The HTTP route (src/app/api/studio/editor/route.ts) reaches this
 * through src/lib/editor/service.ts — one surface, no parallel API.
 *
 * DETERMINISTIC (real work, nothing faked):
 *   listGrades          — the nine-grade catalog with every parameter, plus the
 *                         project's current assignment.
 *   applyGrade          — resolves grade → renderer parameter set and RECORDS the
 *                         assignment (project scope, or per-scene override).
 *   resetGrade          — clears an assignment back to "none".
 *   renderGradePreview  — resolves which grade WOULD be previewed (plan only).
 *
 * PROVIDER-GATED (honest gate, nothing changed):
 *   Real frame rendering, LUT-file baking, HDR tone-mapping of real footage and
 *   ML auto-grading/relighting are the only things that need a video-processing
 *   provider. Every response that touches them carries
 *   `provider: { capability, connected: false, requiredEnv: [names], envHint, note }`
 *   and `plan.applied: false`. No pixels are produced and no pixel statistic is
 *   ever reported.
 *
 * Tenancy: every action resolves the project through
 * `store.findOwnedProject(userId, projectId)` first; a missing OR foreign project
 * is a 404 (never 403) so the API leaks nothing about other tenants.
 */
import { fromSnapshot } from "../editor/versions";
import { capabilityEnvNames } from "../ai/providers/capability-env";
import {
  derivedProviderGate,
  type CapabilityProviderGate,
} from "../ai/providers/capability-connectivity";
import {
  COLOR_GRADES,
  buildRenderPlan,
  findColorGrade,
  isColorGradeId,
  listColorGradeViews,
  type ColorGradeId,
  type ColorRenderPlan,
} from "./presets";
import {
  EMPTY_ASSIGNMENT,
  assignmentsEqual,
  effectiveGrade,
  normalizeAssignment,
  serializeAssignment,
  type ColorGradeAssignment,
} from "./assignment";

/* ------------------------------------------------------------------ */
/* Provider gating                                                     */
/* ------------------------------------------------------------------ */

/**
 * Env var NAMES (never values) a server operator would set to connect a real
 * video-processing / colour pipeline. Derived from the provider env-key registry
 * and the capability→provider slot table (`capability-env`), never hard-coded:
 * video_enhancement is served by the replicate and runway slots, so these are
 * the names some code actually reads. Setting anything else changes nothing,
 * which is why no other name is printed anywhere on this surface.
 */
export const COLOR_RENDER_CAPABILITY = "video_enhancement";

export const COLOR_RENDER_ENV_NAMES = capabilityEnvNames(COLOR_RENDER_CAPABILITY);

/**
 * A CODE fact, and NOT a claim about this server: the colour system contains no
 * call site that dispatches to a provider (this file imports no orchestrator).
 * `connected` is DERIVED separately, on every response, from the provider
 * registry — so this gate can never contradict GET /api/ai/status.
 */
export const COLOR_ENGINE_DISPATCHES = false;

/** The gate shape every engine in the app returns — one shared implementation. */
export type ProviderGate = CapabilityProviderGate;

/**
 * Honest provider gate: `connected` is derived at call time — a provider counts
 * only when it is configured (its key is present) AND wired (a real
 * request/parse pair exists), which is the status API's own predicate.
 * `requiredEnv` lists env var NAMES only (from the registry, so each one is
 * really read by the provider registry), and the note says exactly what was NOT
 * produced.
 */
export function colorProviderGate(what: string): ProviderGate {
  return derivedProviderGate({
    capability: COLOR_RENDER_CAPABILITY,
    what,
    engineDispatches: COLOR_ENGINE_DISPATCHES,
    notProduced: "nothing was rendered, tone-mapped or baked and no pixel output was invented.",
  });
}

/* ------------------------------------------------------------------ */
/* Store contract                                                      */
/* ------------------------------------------------------------------ */

export interface ColorSceneRow {
  id: string;
  title: string | null;
}

export interface ColorStore {
  /** Tenant-scoped project lookup (null when missing OR owned by someone else). */
  findOwnedProject(userId: string, projectId: string): Promise<{ id: string; title: string } | null>;
  /** ProjectSettings.extra.colorGrade (unvalidated raw JSON) or null. */
  readColorGrade(projectId: string): Promise<unknown | null>;
  writeColorGrade(projectId: string, value: unknown): Promise<void>;
  listScenes(projectId: string): Promise<ColorSceneRow[]>;
  /** ProjectSettings.extra.editorTimeline (unvalidated raw JSON) or null. */
  readRawTimeline(projectId: string): Promise<unknown | null>;
}

export interface ColorResult {
  status: number;
  body: Record<string, unknown>;
}

export const COLOR_ACTIONS = ["listGrades", "applyGrade", "resetGrade", "renderGradePreview"] as const;
export type ColorAction = (typeof COLOR_ACTIONS)[number];

export function isColorAction(v: unknown): v is ColorAction {
  return typeof v === "string" && (COLOR_ACTIONS as readonly string[]).includes(v);
}

const GRADE_SCOPES = ["project", "scene"] as const;
type GradeScope = (typeof GRADE_SCOPES)[number];

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function fail(status: number, error: string, code: string, extra: Record<string, unknown> = {}): ColorResult {
  return { status, body: { error, code, ...extra } };
}

function gradeNotFound(gradeId: unknown): ColorResult {
  return fail(400, "Unknown colour grade.", "unknown_grade", {
    note: "Expected one of: " + COLOR_GRADES.map((g) => g.id).join(", "),
  });
}

function resolveScope(body: Record<string, unknown>): { scope?: GradeScope; error?: ColorResult } {
  const raw = body.scope === undefined || body.scope === null || body.scope === "" ? "project" : str(body.scope);
  if (!raw || !(GRADE_SCOPES as readonly string[]).includes(raw)) {
    return {
      error: fail(400, "Unknown grade scope.", "invalid_scope", {
        note: "Expected one of: " + GRADE_SCOPES.join(", "),
      }),
    };
  }
  return { scope: raw as GradeScope };
}

/**
 * The scene list the colour actions know about: the project's Scene rows plus
 * every scene that exists on the project's timeline. A scene on the timeline
 * only (a manual scene) is a real target too — it is reported as
 * `source: "timeline"` rather than being refused.
 */
async function knownScenes(store: ColorStore, projectId: string): Promise<Map<string, "project" | "timeline">> {
  const out = new Map<string, "project" | "timeline">();
  for (const row of await store.listScenes(projectId)) out.set(row.id, "project");
  const raw = await store.readRawTimeline(projectId);
  const timeline = raw === null || raw === undefined ? null : fromSnapshot(raw);
  if (timeline) {
    for (const clip of timeline.clips) {
      if (clip.sceneId && !out.has(clip.sceneId)) out.set(clip.sceneId, "timeline");
    }
  }
  return out;
}

async function readAssignment(store: ColorStore, projectId: string): Promise<{
  assignment: ColorGradeAssignment;
  unreadable: boolean;
  dropped: string[];
}> {
  const raw = await store.readColorGrade(projectId);
  return normalizeAssignment(raw);
}

function assignmentView(assignment: ColorGradeAssignment): Record<string, unknown> {
  return { project: assignment.project, scenes: { ...assignment.scenes } };
}

/* ------------------------------------------------------------------ */
/* Action handler                                                      */
/* ------------------------------------------------------------------ */

/**
 * Runs one colour action. Never throws for expected failures — invalid input and
 * tenancy problems come back as `{ status, body }`, mirroring the rest of the
 * studio API. The body shape returned here IS the shape the HTTP client sees.
 */
export async function runColorAction(
  store: ColorStore,
  userId: string,
  raw: unknown,
): Promise<ColorResult> {
  const body = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const action = str(body.action);
  if (!action || !isColorAction(action)) {
    return fail(400, "Unknown colour action.", "unknown_action", {
      note: "Expected one of: " + COLOR_ACTIONS.join(", "),
    });
  }
  const projectId = str(body.projectId);
  if (!projectId) return fail(400, "projectId is required.", "project_id_required");

  const project = await store.findOwnedProject(userId, projectId);
  if (!project) return fail(404, "Project not found.", "not_found");

  const current = await readAssignment(store, projectId);

  /* --------------------------------------------------------- listGrades */
  if (action === "listGrades") {
    const scenes = await knownScenes(store, projectId);
    const view: Record<string, unknown> = {
      action: "listGrades",
      projectId,
      count: COLOR_GRADES.length,
      grades: listColorGradeViews(),
      assignment: assignmentView(current.assignment),
      effective: Object.fromEntries(
        [...scenes.keys()].map((sceneId) => [sceneId, effectiveGrade(current.assignment, sceneId)]),
      ),
      sceneSource: Object.fromEntries(scenes),
      sceneCount: scenes.size,
      changed: false,
      persisted: false,
      // Nothing is rendered by a catalog read; the gate states that plainly.
      provider: colorProviderGate("Real frame rendering"),
      note:
        "Deterministic catalogue: nine named grades with their real parameters and delivery targets. " +
        "Values are read-only — nothing was rendered and nothing was persisted.",
    };
    if (current.unreadable) {
      view.note =
        "The stored colour assignment was unreadable and was ignored (no grade is in effect). " +
        "Re-apply a grade to replace it. " +
        String(view.note);
    } else if (current.dropped.length > 0) {
      view.droppedGrades = current.dropped;
      view.note = `${current.dropped.length} stored grade id(s) are not in the catalogue and were ignored. ` + String(view.note);
    }
    view.unreadable = current.unreadable;
    return { status: 200, body: view };
  }

  /* -------------------------------------------------------- applyGrade */
  if (action === "applyGrade") {
    const gradeId = str(body.gradeId);
    if (!gradeId || !isColorGradeId(gradeId)) return gradeNotFound(body.gradeId);
    const grade = findColorGrade(gradeId);
    if (!grade) return gradeNotFound(body.gradeId); // unreachable; keeps TS honest

    const scope = resolveScope(body);
    if (scope.error) return scope.error;

    let sceneId: string | null = null;
    let sceneSource: "project" | "timeline" | null = null;
    if (scope.scope === "scene") {
      const requested = str(body.sceneId);
      if (!requested) return fail(400, "sceneId is required when scope is \"scene\".", "scene_id_required");
      const scenes = await knownScenes(store, projectId);
      const found = scenes.get(requested);
      if (!found) {
        return fail(404, "Scene not found on this project.", "scene_not_found");
      }
      sceneId = requested;
      sceneSource = found;
    }

    const previous = current.assignment;
    const next: ColorGradeAssignment = {
      project: previous.project,
      scenes: { ...previous.scenes },
    };
    if (scope.scope === "project") next.project = grade.id;
    else next.scenes[sceneId as string] = grade.id;

    const changed = !assignmentsEqual(previous, next);
    const changelist: string[] = [];
    const target = scope.scope === "project" ? "project default" : `scene ${sceneId}`;
    const before = scope.scope === "project" ? previous.project : previous.scenes[sceneId as string] ?? null;
    if (changed) {
      changelist.push(`grade: ${target} ${before ?? "none"} → ${grade.id}.`);
    } else {
      changelist.push(`grade: ${target} already ${grade.id} — nothing to change.`);
    }
    const renderPlan = buildRenderPlan(grade);
    for (const op of renderPlan.operations) {
      changelist.push(`render step ${op.order}: ${op.op} (planned, not executed).`);
    }

    if (changed) await store.writeColorGrade(projectId, serializeAssignment(next));

    const gate = colorProviderGate("Rendering the graded frames");
    return {
      status: 200,
      body: {
        action: "applyGrade",
        projectId,
        scope: scope.scope,
        sceneId,
        sceneSource,
        gradeId: grade.id,
        grade: listColorGradeViews().find((g) => g.id === grade.id),
        render: {
          ...renderPlan,
          /** The plan is real; the pixels are not. */
          performed: false,
          provider: gate,
        },
        assignment: assignmentView(next),
        previous: assignmentView(previous),
        effective: effectiveGrade(next, sceneId),
        changed,
        changelist,
        plan: {
          applied: changed,
          pixelsRendered: false,
          lutBaked: false,
          toneMapped: false,
          steps: renderPlan.operations.length,
        },
        persisted: changed,
        note:
          `Grade "${grade.id}" resolved to ${renderPlan.operations.length} deterministic render steps and recorded as the ` +
          `${target}. The ASSIGNMENT is real metadata; no frames were decoded, graded or exported. ${gate.note}`,
      },
    };
  }

  /* -------------------------------------------------------- resetGrade */
  if (action === "resetGrade") {
    const scope = resolveScope(body);
    if (scope.error) return scope.error;

    let sceneId: string | null = null;
    if (scope.scope === "scene") {
      const requested = str(body.sceneId);
      if (!requested) return fail(400, "sceneId is required when scope is \"scene\".", "scene_id_required");
      sceneId = requested;
    }

    const previous = current.assignment;
    const next: ColorGradeAssignment = {
      project: previous.project,
      scenes: { ...previous.scenes },
    };
    const before = scope.scope === "project" ? previous.project : previous.scenes[sceneId as string] ?? null;
    if (scope.scope === "project") next.project = null;
    else delete next.scenes[sceneId as string];

    const changed = !assignmentsEqual(previous, next);
    const changelist: string[] = [];
    const target = scope.scope === "project" ? "project default" : `scene ${sceneId}`;
    changelist.push(
      changed ? `grade: ${target} ${before ?? "none"} → none.` : `grade: ${target} already none — nothing to change.`,
    );

    if (changed) await store.writeColorGrade(projectId, serializeAssignment(next));

    return {
      status: 200,
      body: {
        action: "resetGrade",
        projectId,
        scope: scope.scope,
        sceneId,
        gradeId: null,
        previous: assignmentView(previous),
        assignment: assignmentView(next),
        effective: effectiveGrade(next, sceneId),
        changed,
        changelist,
        persisted: changed,
        // A reset is pure metadata: there is no pixel work to gate.
        plan: { applied: changed, pixelsRendered: false },
        note: changed
          ? `${target} reset to none — the renderer falls back to the next scope up (a scene with no override uses the project grade).`
          : `${target} already had no grade assigned.`,
      },
    };
  }

  /* ------------------------------------------------- renderGradePreview */
  {
    // Pick the grade under test: an explicit gradeId wins, else the effective
    // assignment for the requested scope. With neither, there is nothing to
    // preview and the answer says so honestly (no default look is assumed).
    const requested = str(body.gradeId);
    if (requested && !isColorGradeId(requested)) return gradeNotFound(body.gradeId);
    const scope = resolveScope(body);
    if (scope.error) return scope.error;

    let sceneId: string | null = null;
    if (scope.scope === "scene") {
      const s = str(body.sceneId);
      if (!s) return fail(400, "sceneId is required when scope is \"scene\".", "scene_id_required");
      const scenes = await knownScenes(store, projectId);
      if (!scenes.get(s)) return fail(404, "Scene not found on this project.", "scene_not_found");
      sceneId = s;
    }

    const resolved = requested
      ? { gradeId: requested as ColorGradeId, source: "request" as const }
      : effectiveGrade(current.assignment, sceneId);

    if (!resolved.gradeId) {
      return fail(400, "No grade to preview.", "no_grade", {
        scope: scope.scope,
        sceneId,
        assignment: assignmentView(current.assignment),
        changed: false,
        persisted: false,
        note: "No grade id was supplied and no grade is assigned at this scope — apply a grade first, or pass gradeId.",
      });
    }

    const grade = findColorGrade(resolved.gradeId);
    if (!grade) return gradeNotFound(resolved.gradeId);
    const renderPlan = buildRenderPlan(grade);
    const gate = colorProviderGate("A rendered grade preview");

    return {
      status: 200,
      body: {
        action: "renderGradePreview",
        projectId,
        scope: scope.scope,
        sceneId,
        gradeId: grade.id,
        gradeSource: resolved.source,
        grade: listColorGradeViews().find((g) => g.id === grade.id),
        render: { ...renderPlan, performed: false, provider: gate },
        preview: { produced: false, kind: "graded-frame-preview" },
        provider: gate,
        // The whole point: an honest gate changes nothing at all.
        changed: false,
        /*
         * BLOCK 9 — was the unconditional literal "requested, not produced (no
         * provider connected)", which contradicts GET /api/ai/status on a keyed
         * server in the same view. The parenthetical is now DERIVED from this
         * response's own gate (`colorProviderGate`, i.e. the registry's live
         * configured-AND-wired flags); the engine half is a code fact — this
         * engine has no call site that renders pixels either way.
         */
        changelist: [
          `preview: ${grade.id} — requested, not produced (` +
            (gate.connected
              ? "a provider is connected AND wired for this work, but this engine has no code path that renders pixels"
              : "no provider is connected AND wired for this work") +
            ").",
        ],
        persisted: false,
        plan: { applied: false, pixelsRendered: false, lutBaked: false, toneMapped: false },
        note:
          `A real graded preview of "${grade.id}" was NOT produced: ${gate.note} ` +
          "The parameter set above is the deterministic plan the renderer would consume.",
      },
    };
  }
}

/** Re-exported so the editor service can keep its import surface narrow. */
export { EMPTY_ASSIGNMENT };
export type { ColorRenderPlan };
export type { ColorGradeAssignment };
