/**
 * Phase 5 Block 5a — SHORTS ASSIGNMENT model (pure, client-safe).
 *
 * What "apply" writes: the exact platform-target config that was used plus the
 * clip set it produced, stored as plain JSON in `ProjectSettings.extra.shortsRepurpose`
 * — no schema change, and every other settings key is preserved (the store
 * merges, it never replaces).
 *
 * Shape:
 *   { format: "cavis.repurpose.shorts", version: 1, appliedAt: ISO,
 *     timelineMs: number,
 *     targets: { shorts: {...}, reels: {...}, tiktoks: {...} },
 *     clips: [ { id, target, rank, label, clipKind, momentKind, momentId,
 *                score, reason, startMs, endMs, durationMs, scenes } ] }
 *
 * Anything unreadable is treated as "nothing applied" and reported honestly — a
 * corrupt value never silently becomes a clip plan, and clips with an impossible
 * window are dropped and counted rather than trusted.
 */
import {
  PLATFORM_TARGETS,
  REPURPOSE_CONFIG_FORMAT,
  readStoredTargetConfig,
  type PlatformTarget,
  type PlatformTargetSpec,
  type ShortsTargetConfig,
} from "./targets";
import { CLIP_KINDS, type ClipKind } from "./targets";
import { MOMENT_KINDS, type MomentKind } from "./moments";
import type { PlatformClip } from "./clips";

export const REPURPOSE_ASSIGNMENT_FORMAT = "cavis.repurpose.shorts";
export const REPURPOSE_ASSIGNMENT_VERSION = 1;

export interface PersistedClip {
  id: string;
  target: PlatformTarget;
  rank: number;
  label: string;
  clipKind: ClipKind;
  momentKind: MomentKind;
  momentId: string;
  score: number;
  reason: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  scenes: string[];
}

export interface ShortsAssignment {
  /** The config in force when the set was applied. */
  targets: Record<PlatformTarget, PlatformTargetSpec>;
  clips: PersistedClip[];
  /** ISO timestamp of the write (server clock, recorded verbatim). */
  appliedAt: string | null;
  /** The timeline length the windows were computed against. */
  timelineMs: number;
}

export interface NormalizedShortsAssignment {
  assignment: ShortsAssignment | null;
  /** True when the stored value existed but could not be read as an assignment. */
  unreadable: boolean;
  /** Clips dropped because their window / id / kind was not usable. */
  droppedClips: number;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function persistedClip(raw: unknown): PersistedClip | null {
  if (!isObj(raw)) return null;
  const id = typeof raw.id === "string" && raw.id ? raw.id : null;
  const target = typeof raw.target === "string" && (PLATFORM_TARGETS as readonly string[]).includes(raw.target)
    ? (raw.target as PlatformTarget)
    : null;
  const clipKind = typeof raw.clipKind === "string" && (CLIP_KINDS as readonly string[]).includes(raw.clipKind)
    ? (raw.clipKind as ClipKind)
    : null;
  const momentKind = typeof raw.momentKind === "string" && (MOMENT_KINDS as readonly string[]).includes(raw.momentKind)
    ? (raw.momentKind as MomentKind)
    : null;
  const startMs = num(raw.startMs);
  const endMs = num(raw.endMs);
  if (!id || !target || !clipKind || !momentKind || startMs === null || endMs === null || endMs <= startMs) return null;
  const scenes = Array.isArray(raw.scenes) ? raw.scenes.filter((s): s is string => typeof s === "string") : [];
  return {
    id,
    target,
    rank: num(raw.rank) ?? 0,
    label: typeof raw.label === "string" ? raw.label : id,
    clipKind,
    momentKind,
    momentId: typeof raw.momentId === "string" ? raw.momentId : "",
    score: num(raw.score) ?? 0,
    reason: typeof raw.reason === "string" ? raw.reason : "",
    startMs: Math.round(startMs),
    endMs: Math.round(endMs),
    durationMs: Math.round(endMs - startMs),
    scenes,
  };
}

/**
 * Parse a stored value into a safe assignment. Never throws: an unreadable value
 * yields `null` plus `unreadable: true` so the caller can say so instead of
 * pretending the project has no repurposing.
 */
export function normalizeShortsAssignment(raw: unknown): NormalizedShortsAssignment {
  if (raw === null || raw === undefined) return { assignment: null, unreadable: false, droppedClips: 0 };
  if (!isObj(raw) || raw.format !== REPURPOSE_ASSIGNMENT_FORMAT) {
    return { assignment: null, unreadable: true, droppedClips: 0 };
  }
  const stored = readStoredTargetConfig({ format: REPURPOSE_CONFIG_FORMAT, targets: raw.targets });
  if (!stored.config) {
    return { assignment: null, unreadable: true, droppedClips: 0 };
  }
  const rawClips = Array.isArray(raw.clips) ? raw.clips : [];
  const clips: PersistedClip[] = [];
  let droppedClips = 0;
  for (const candidate of rawClips) {
    const clip = persistedClip(candidate);
    if (!clip || !stored.config.targets[clip.target]) droppedClips += 1;
    else clips.push(clip);
  }
  clips.sort((a, b) => a.target.localeCompare(b.target) || a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return {
    assignment: {
      targets: stored.config.targets,
      clips,
      appliedAt: typeof raw.appliedAt === "string" ? raw.appliedAt : null,
      timelineMs: num(raw.timelineMs) ?? 0,
    },
    unreadable: false,
    droppedClips,
  };
}

/** The value to persist for an assignment (from the clip plan actually produced). */
export function serializeShortsAssignment(input: {
  config: ShortsTargetConfig;
  clips: PlatformClip[];
  appliedAt: string;
  timelineMs: number;
}): Record<string, unknown> {
  return {
    format: REPURPOSE_ASSIGNMENT_FORMAT,
    version: REPURPOSE_ASSIGNMENT_VERSION,
    appliedAt: input.appliedAt,
    timelineMs: input.timelineMs,
    targets: Object.fromEntries(
      PLATFORM_TARGETS.map((t) => [
        t,
        {
          enabled: input.config.targets[t].enabled,
          count: input.config.targets[t].count,
          minSeconds: input.config.targets[t].minSeconds,
          maxSeconds: input.config.targets[t].maxSeconds,
          kinds: [...input.config.targets[t].kinds],
        },
      ]),
    ),
    clips: input.clips.map((clip) => ({
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
  };
}

/** Response/UI view of an assignment. */
export function assignmentView(assignment: ShortsAssignment | null): Record<string, unknown> | null {
  if (!assignment) return null;
  // Canonical clip order (target name, then rank, then id) so a freshly built
  // set and a stored set compare equal — "changed" must mean really changed.
  // The aggregates below are derived from THIS canonical order: a stored set
  // (which is re-sorted on read) and a freshly built set (which is in target
  // order) must not differ merely in the key order of byTarget/byKind, or
  // "changed" would be true on every re-apply of an identical set.
  const ordered = assignment.clips
    .slice()
    .sort((a, b) => a.target.localeCompare(b.target) || a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const byTarget: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  let totalMs = 0;
  for (const clip of ordered) {
    byTarget[clip.target] = (byTarget[clip.target] ?? 0) + 1;
    byKind[clip.clipKind] = (byKind[clip.clipKind] ?? 0) + 1;
    totalMs += clip.durationMs;
  }
  return {
    applied: true,
    appliedAt: assignment.appliedAt,
    timelineMs: assignment.timelineMs,
    clipCount: assignment.clips.length,
    byTarget,
    byKind,
    totalMs,
    targetsUsed: Object.fromEntries(
      PLATFORM_TARGETS.map((t) => [
        t,
        {
          enabled: assignment.targets[t].enabled,
          count: assignment.targets[t].count,
          minSeconds: assignment.targets[t].minSeconds,
          maxSeconds: assignment.targets[t].maxSeconds,
          kinds: [...assignment.targets[t].kinds],
        },
      ]),
    ),
    clips: ordered.map((clip) => ({
      id: clip.id,
      target: clip.target,
      rank: clip.rank,
      label: clip.label,
      clipKind: clip.clipKind,
      momentKind: clip.momentKind,
      score: clip.score,
      reason: clip.reason,
      startMs: clip.startMs,
      endMs: clip.endMs,
      durationMs: clip.durationMs,
      scenes: clip.scenes,
    })),
  };
}

/** Stable comparison so "changed" is honest rather than always true. */
export function assignmentsEqual(a: ShortsAssignment | null, b: ShortsAssignment | null): boolean {
  const av = assignmentView(a);
  const bv = assignmentView(b);
  if (av === null || bv === null) return av === bv;
  return JSON.stringify({ ...av, appliedAt: null }) === JSON.stringify({ ...bv, appliedAt: null });
}
