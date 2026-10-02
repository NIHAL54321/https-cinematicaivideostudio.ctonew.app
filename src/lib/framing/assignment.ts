/**
 * Phase 5 Block 5b — the FRAMING ASSIGNMENT (pure, client-safe).
 *
 * The reframe surface persists ONE small object per project, in the same
 * `ProjectSettings.extra` envelope the editor timeline (Block 1), the colour
 * assignment (Block 4) and the shorts set (Block 5a) already use — under the key
 * `framing`. No schema migration is involved.
 *
 * The model mirrors the colour assignment exactly, one scope wider:
 *
 *   project: one override for the whole project,
 *   scenes:  per-scene overrides (keyed by Scene id),
 *   clips:   per-clip overrides (keyed by the clip id the plan reports —
 *            `sc-<sceneId>-video` for a timeline clip, `shorts-3` for a clip the
 *            Block 5a repurposing set produced).
 *
 * An override only ever STATES a format and/or a policy and/or an anchor. It
 * does not cache geometry: the engine recomputes the crop, the safe areas and
 * the keyframes from the project's real frames every time, so a stale override
 * can never become a stale crop window. "Reset" simply removes the override and
 * the engine's own plan applies again.
 *
 * Reading is lenient-but-honest: a stored value that no longer parses is
 * reported as unreadable and IGNORED (nothing is half-applied), and an override
 * naming an unknown format or policy is DROPPED and counted — never silently
 * repaired into something the user did not ask for.
 */
import { isFrameFormatId, type FrameFormatId } from "./formats";
import { isFramingPolicyId, type FramingPolicyId } from "./policies";
import type { AnchorPoint } from "./geometry";

export const FRAMING_FORMAT = "cavis.framing.assignment";
export const FRAMING_VERSION = 1;

export interface FrameOverride {
  /** Delivery format the scope is planned for. */
  format?: FrameFormatId;
  /** Framing policy the scope uses. */
  policy?: FramingPolicyId;
  /** Explicit rule anchor (normalized in source coordinates). */
  anchor?: AnchorPoint;
  /** Free-text note the caller may attach (echoed back verbatim). */
  note?: string | null;
}

export interface FramingAssignment {
  project: FrameOverride | null;
  scenes: Record<string, FrameOverride>;
  clips: Record<string, FrameOverride>;
  appliedAt: string | null;
}

export const EMPTY_FRAMING_ASSIGNMENT: FramingAssignment = { project: null, scenes: {}, clips: {}, appliedAt: null };

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function cloneOverride(o: FrameOverride): FrameOverride {
  return {
    ...(o.format !== undefined ? { format: o.format } : {}),
    ...(o.policy !== undefined ? { policy: o.policy } : {}),
    ...(o.anchor !== undefined ? { anchor: { ...o.anchor } } : {}),
    ...(o.note !== undefined ? { note: o.note } : {}),
  };
}

/** True when the override states nothing at all (an empty override is no override). */
export function isEmptyOverride(o: FrameOverride | null | undefined): boolean {
  if (!o) return true;
  return o.format === undefined && o.policy === undefined && o.anchor === undefined && (o.note === undefined || o.note === null);
}

/** Validate one override object. Unknown keys are ignored; unknown ids are errors. */
export function validateOverride(raw: unknown): { ok: true; override: FrameOverride } | { ok: false; code: string; error: string; note: string } {
  if (!isObj(raw)) {
    return { ok: false, code: "invalid_override", error: "Invalid reframe override.", note: "An override must be an object with optional `format`, `policy`, `anchor` and `note`." };
  }
  const override: FrameOverride = {};
  if (raw.format !== undefined && raw.format !== null) {
    if (!isFrameFormatId(raw.format)) {
      return { ok: false, code: "unknown_format", error: "Unknown output format.", note: "Expected one of: 16:9, 9:16, 1:1, 4:5." };
    }
    override.format = raw.format;
  }
  if (raw.policy !== undefined && raw.policy !== null) {
    if (!isFramingPolicyId(raw.policy)) {
      return {
        ok: false,
        code: "unknown_policy",
        error: "Unknown framing policy.",
        note: "Expected one of: centre-cover, upper-third-bias, caption-safe-hold, pan-across-travel.",
      };
    }
    override.policy = raw.policy;
  }
  if (raw.anchor !== undefined && raw.anchor !== null) {
    if (!isObj(raw.anchor)) {
      return { ok: false, code: "invalid_anchor", error: "Invalid anchor.", note: "`anchor` must be an object with numeric `x` and `y` in 0..1." };
    }
    const x = raw.anchor.x;
    const y = raw.anchor.y;
    if (typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y) || x < 0 || x > 1 || y < 0 || y > 1) {
      return {
        ok: false,
        code: "invalid_anchor",
        error: "Invalid anchor.",
        note: `\`anchor.x\` and \`anchor.y\` must be numbers between 0 and 1 (got ${JSON.stringify(raw.anchor)}).`,
      };
    }
    override.anchor = { x: Math.round(x * 10000) / 10000, y: Math.round(y * 10000) / 10000 };
  }
  if (raw.note !== undefined && raw.note !== null) {
    if (typeof raw.note !== "string") {
      return { ok: false, code: "invalid_note", error: "Invalid note.", note: "`note` must be a string or null." };
    }
    override.note = raw.note.slice(0, 500);
  }
  return { ok: true, override };
}

/**
 * Lenient read of the stored assignment. Unparsable → `unreadable: true` and an
 * empty assignment; an override naming an unknown format/policy is dropped and
 * its scope key is counted in `dropped`.
 */
export function normalizeFraming(raw: unknown): { assignment: FramingAssignment; unreadable: boolean; dropped: string[] } {
  if (raw === null || raw === undefined) return { assignment: EMPTY_FRAMING_ASSIGNMENT, unreadable: false, dropped: [] };
  if (!isObj(raw) || raw.format !== FRAMING_FORMAT) {
    return { assignment: EMPTY_FRAMING_ASSIGNMENT, unreadable: true, dropped: [] };
  }
  const dropped: string[] = [];
  const readScope = (value: unknown, key: string): FrameOverride | null => {
    if (value === null || value === undefined) return null;
    const checked = validateOverride(value);
    if (!checked.ok) {
      dropped.push(key);
      return null;
    }
    return isEmptyOverride(checked.override) ? null : checked.override;
  };
  const scenes: Record<string, FrameOverride> = {};
  if (isObj(raw.scenes)) {
    for (const [sceneId, value] of Object.entries(raw.scenes)) {
      const o = readScope(value, `scene:${sceneId}`);
      if (o) scenes[sceneId] = o;
    }
  }
  const clips: Record<string, FrameOverride> = {};
  if (isObj(raw.clips)) {
    for (const [clipId, value] of Object.entries(raw.clips)) {
      const o = readScope(value, `clip:${clipId}`);
      if (o) clips[clipId] = o;
    }
  }
  return {
    assignment: {
      project: readScope(raw.project, "project"),
      scenes,
      clips,
      appliedAt: typeof raw.appliedAt === "string" ? raw.appliedAt : null,
    },
    unreadable: false,
    dropped,
  };
}

/**
 * True when the assignment states nothing at all. A reset that empties every
 * scope then writes a bare `null` (the key is cleared) instead of an envelope
 * full of nulls, so "reset" really clears the stored metadata.
 */
export function isEmptyFramingAssignment(assignment: FramingAssignment): boolean {
  return (
    assignment.project === null && Object.keys(assignment.scenes).length === 0 && Object.keys(assignment.clips).length === 0
  );
}

export function serializeFraming(assignment: FramingAssignment): Record<string, unknown> {
  return {
    format: FRAMING_FORMAT,
    version: FRAMING_VERSION,
    project: assignment.project ? cloneOverride(assignment.project) : null,
    scenes: Object.fromEntries(Object.entries(assignment.scenes).map(([k, v]) => [k, cloneOverride(v)])),
    clips: Object.fromEntries(Object.entries(assignment.clips).map(([k, v]) => [k, cloneOverride(v)])),
    appliedAt: assignment.appliedAt,
  };
}

export function overridesEqual(a: FrameOverride | null, b: FrameOverride | null): boolean {
  const x = a ?? null;
  const y = b ?? null;
  if (x === null && y === null) return true;
  if (x === null || y === null) return false;
  if ((x.format ?? null) !== (y.format ?? null)) return false;
  if ((x.policy ?? null) !== (y.policy ?? null)) return false;
  const ax = x.anchor ?? null;
  const ay = y.anchor ?? null;
  if (ax === null || ay === null) {
    if (ax !== ay) return false;
  } else if (ax.x !== ay.x || ax.y !== ay.y) return false;
  return (x.note ?? null) === (y.note ?? null);
}

export function framingsEqual(a: FramingAssignment, b: FramingAssignment): boolean {
  if (!overridesEqual(a.project, b.project)) return false;
  const keysA = Object.keys(a.scenes).sort();
  const keysB = Object.keys(b.scenes).sort();
  if (keysA.length !== keysB.length) return false;
  for (let i = 0; i < keysA.length; i += 1) {
    if (keysA[i] !== keysB[i]) return false;
    if (!overridesEqual(a.scenes[keysA[i]], b.scenes[keysB[i]])) return false;
  }
  const clipKeysA = Object.keys(a.clips).sort();
  const clipKeysB = Object.keys(b.clips).sort();
  if (clipKeysA.length !== clipKeysB.length) return false;
  for (let i = 0; i < clipKeysA.length; i += 1) {
    if (clipKeysA[i] !== clipKeysB[i]) return false;
    if (!overridesEqual(a.clips[clipKeysA[i]], b.clips[clipKeysB[i]])) return false;
  }
  return true;
}

export interface EffectiveOverride {
  override: FrameOverride | null;
  source: "clip" | "scene" | "project" | "none";
}

/**
 * The override in force for a clip: the clip's own override wins, else its
 * scene's, else the project's, else none at all (the engine's plan).
 */
export function effectiveFrameOverride(
  assignment: FramingAssignment,
  sceneId: string | null | undefined,
  clipId: string | null | undefined,
): EffectiveOverride {
  if (clipId && assignment.clips[clipId]) return { override: assignment.clips[clipId], source: "clip" };
  if (sceneId && assignment.scenes[sceneId]) return { override: assignment.scenes[sceneId], source: "scene" };
  if (assignment.project) return { override: assignment.project, source: "project" };
  return { override: null, source: "none" };
}

/** Merge a new override over an existing one (undefined fields keep their value). */
export function mergeOverride(previous: FrameOverride | null, patch: FrameOverride): FrameOverride {
  const next: FrameOverride = { ...(previous ? cloneOverride(previous) : {}) };
  if (patch.format !== undefined) next.format = patch.format;
  if (patch.policy !== undefined) next.policy = patch.policy;
  if (patch.anchor !== undefined) next.anchor = { ...patch.anchor };
  if (patch.note !== undefined) next.note = patch.note;
  return next;
}

/** Serializable view of the assignment (formats and policies expanded for the UI). */
export function framingAssignmentView(assignment: FramingAssignment): Record<string, unknown> {
  const view = (o: FrameOverride | null) =>
    o
      ? {
          format: o.format ?? null,
          policy: o.policy ?? null,
          anchor: o.anchor ? { ...o.anchor } : null,
          note: o.note ?? null,
        }
      : null;
  return {
    applied: assignment.project !== null || Object.keys(assignment.scenes).length > 0 || Object.keys(assignment.clips).length > 0,
    appliedAt: assignment.appliedAt,
    project: view(assignment.project),
    scenes: Object.fromEntries(Object.entries(assignment.scenes).map(([k, v]) => [k, view(v)])),
    clips: Object.fromEntries(Object.entries(assignment.clips).map(([k, v]) => [k, view(v)])),
    sceneCount: Object.keys(assignment.scenes).length,
    clipCount: Object.keys(assignment.clips).length,
  };
}
