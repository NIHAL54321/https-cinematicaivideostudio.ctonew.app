/**
 * Phase 6 Block 1 — the EXPORT PRESET ASSIGNMENT (pure, client-safe).
 *
 * The chosen delivery presets persist as ONE small object per project, in the
 * same `ProjectSettings.extra` envelope the editor timeline (Phase 5 Block 1),
 * the colour assignment (Block 4), the shorts set (Block 5a) and the reframe
 * overrides (Block 5b) already use — under the key `exportPreset`. No schema
 * migration.
 *
 * The object records ONLY the choice (which preset ids are applied, and when).
 * It caches no spec and no size: the presets are catalogue constants and the
 * estimate is recomputed from the preset + the project's duration on every read,
 * so a stale stored value can never become a stale specification.
 *
 * Reading is lenient-but-honest: an unparsable value is reported as unreadable
 * and IGNORED (nothing is half-applied), and a stored preset id that is no
 * longer in the catalogue is DROPPED and counted — never repaired into a
 * different preset the user did not choose.
 */
import { EXPORT_PRESET_IDS, isExportPresetId, orderPresetIds, type ExportPresetId } from "./presets";

export const EXPORT_ASSIGNMENT_FORMAT = "cavis.export.preset";
export const EXPORT_ASSIGNMENT_VERSION = 1;

export interface ExportAssignment {
  /** Applied presets, in canonical catalogue order. */
  presetIds: ExportPresetId[];
  appliedAt: string | null;
}

export const EMPTY_EXPORT_ASSIGNMENT: ExportAssignment = { presetIds: [], appliedAt: null };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** True when nothing is applied — "clear" then stores a bare null. */
export function isEmptyExportAssignment(assignment: ExportAssignment): boolean {
  return assignment.presetIds.length === 0;
}

/**
 * Lenient read of the stored assignment. `presetIds` is deduped and put into
 * canonical catalogue order, so the same choice always serializes identically —
 * which is what makes re-applying it a no-op.
 */
export function normalizeExportAssignment(raw: unknown): {
  assignment: ExportAssignment;
  unreadable: boolean;
  dropped: string[];
} {
  if (raw === null || raw === undefined) return { assignment: EMPTY_EXPORT_ASSIGNMENT, unreadable: false, dropped: [] };
  if (!isObj(raw) || raw.format !== EXPORT_ASSIGNMENT_FORMAT) {
    return { assignment: EMPTY_EXPORT_ASSIGNMENT, unreadable: true, dropped: [] };
  }
  const dropped: string[] = [];
  const input = Array.isArray(raw.presetIds) ? raw.presetIds : [];
  for (const id of input) {
    if (!isExportPresetId(id)) dropped.push(typeof id === "string" ? id : JSON.stringify(id));
  }
  return {
    assignment: {
      presetIds: orderPresetIds(input),
      appliedAt: typeof raw.appliedAt === "string" ? raw.appliedAt : null,
    },
    unreadable: false,
    dropped,
  };
}

export function serializeExportAssignment(assignment: ExportAssignment): Record<string, unknown> {
  return {
    format: EXPORT_ASSIGNMENT_FORMAT,
    version: EXPORT_ASSIGNMENT_VERSION,
    presetIds: orderPresetIds(assignment.presetIds),
    appliedAt: assignment.appliedAt,
  };
}

/** Canonical equality: same ids (order-insensitive), same appliedAt presence. */
export function exportAssignmentsEqual(a: ExportAssignment, b: ExportAssignment): boolean {
  const x = orderPresetIds(a.presetIds);
  const y = orderPresetIds(b.presetIds);
  if (x.length !== y.length) return false;
  for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return false;
  return (a.appliedAt ?? null) === (b.appliedAt ?? null);
}

/** The assignment exactly as the UI reads it. */
export function exportAssignmentView(assignment: ExportAssignment): Record<string, unknown> {
  return {
    applied: assignment.presetIds.length > 0,
    count: assignment.presetIds.length,
    presetIds: orderPresetIds(assignment.presetIds),
    appliedAt: assignment.appliedAt,
  };
}

/** The catalogue-wide check: is every id in `ids` a real preset? */
export function unknownPresetIds(ids: unknown): string[] {
  if (!Array.isArray(ids)) return [];
  return ids.filter((id) => !isExportPresetId(id)).map((id) => (typeof id === "string" ? id : JSON.stringify(id)));
}

/** The full catalogue, for error notes. */
export function presetCatalogueNote(): string {
  return "Expected one or more of: " + EXPORT_PRESET_IDS.join(", ");
}
