/**
 * Phase 5 Block 4 — Colour-grade ASSIGNMENT model (pure, client-safe).
 *
 * A project can carry one grade; each scene can override it. The assignment is
 * stored as plain JSON in `ProjectSettings.extra.colorGrade` — no schema change,
 * and every other settings key is preserved (the store merges, it never
 * replaces).
 *
 * Shape:
 *   { format: "cavis.color.grades", version: 1,
 *     project: "cinematic" | null,
 *     scenes: { "<sceneId>": "<gradeId>" } }
 *
 * Anything unreadable is treated as "no assignment" and reported honestly — a
 * corrupt value never silently becomes a grade.
 */
import { isColorGradeId, type ColorGradeId } from "./presets";

export const COLOR_ASSIGNMENT_FORMAT = "cavis.color.grades";
export const COLOR_ASSIGNMENT_VERSION = 1;

export interface ColorGradeAssignment {
  project: ColorGradeId | null;
  /** sceneId → gradeId. Unknown scene ids are kept: a scene may be restored later. */
  scenes: Record<string, ColorGradeId>;
}

export interface NormalizedAssignment {
  assignment: ColorGradeAssignment;
  /** True when the stored value existed but could not be read as an assignment. */
  unreadable: boolean;
  /** Grade ids that were dropped because they are not in the catalog. */
  dropped: string[];
}

export const EMPTY_ASSIGNMENT: ColorGradeAssignment = { project: null, scenes: {} };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function emptyAssignment(): ColorGradeAssignment {
  return { project: null, scenes: {} };
}

/**
 * Parse a stored value into a safe assignment. Never throws: an unreadable
 * value yields the empty assignment plus `unreadable: true` so the caller can
 * say so instead of pretending the project has no grade.
 */
export function normalizeAssignment(raw: unknown): NormalizedAssignment {
  if (raw === null || raw === undefined) {
    return { assignment: emptyAssignment(), unreadable: false, dropped: [] };
  }
  if (!isObj(raw)) {
    return { assignment: emptyAssignment(), unreadable: true, dropped: [] };
  }
  // Accept only our own envelope: an unrelated object in the same key is
  // reported as unreadable rather than guessed at.
  if (raw.format !== COLOR_ASSIGNMENT_FORMAT) {
    return { assignment: emptyAssignment(), unreadable: true, dropped: [] };
  }
  const dropped: string[] = [];
  const project = raw.project;
  let projectId: ColorGradeId | null = null;
  if (isColorGradeId(project)) {
    projectId = project;
  } else if (project !== null && project !== undefined && project !== "") {
    dropped.push(String(project));
  }

  const scenes: Record<string, ColorGradeId> = {};
  const rawScenes = raw.scenes;
  if (isObj(rawScenes)) {
    for (const [sceneId, value] of Object.entries(rawScenes)) {
      if (isColorGradeId(value)) scenes[sceneId] = value;
      else if (value !== null && value !== undefined && value !== "") dropped.push(String(value));
    }
  }
  return { assignment: { project: projectId, scenes }, unreadable: false, dropped };
}

/** The value to persist for an assignment. */
export function serializeAssignment(assignment: ColorGradeAssignment): Record<string, unknown> {
  return {
    format: COLOR_ASSIGNMENT_FORMAT,
    version: COLOR_ASSIGNMENT_VERSION,
    project: assignment.project,
    scenes: { ...assignment.scenes },
  };
}

/** Effective grade for a scene: its own override, else the project grade. */
export function effectiveGrade(
  assignment: ColorGradeAssignment,
  sceneId?: string | null,
): { gradeId: ColorGradeId | null; source: "scene" | "project" | "none" } {
  if (sceneId && assignment.scenes[sceneId]) {
    return { gradeId: assignment.scenes[sceneId], source: "scene" };
  }
  if (assignment.project) return { gradeId: assignment.project, source: "project" };
  return { gradeId: null, source: "none" };
}

export function assignmentsEqual(a: ColorGradeAssignment, b: ColorGradeAssignment): boolean {
  if (a.project !== b.project) return false;
  const ka = Object.keys(a.scenes).sort();
  const kb = Object.keys(b.scenes).sort();
  if (ka.length !== kb.length) return false;
  for (let i = 0; i < ka.length; i += 1) {
    if (ka[i] !== kb[i]) return false;
    if (a.scenes[ka[i]] !== b.scenes[kb[i]]) return false;
  }
  return true;
}
