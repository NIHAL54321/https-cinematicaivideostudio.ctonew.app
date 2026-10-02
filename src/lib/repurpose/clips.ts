/**
 * Phase 5 Block 5a — CLIP CANDIDATES (pure, deterministic).
 *
 * Turns the scored moment candidates from ./moments into concrete clips for each
 * configured platform target: a start/end inside the timeline, a whole-second
 * duration inside that target's window, the scenes and timeline clips the window
 * spans, the winning moment's kind / score / reason (rendered verbatim) and a
 * label hint taken from the script.
 *
 * DETERMINISM: identical moments + identical timeline + identical config always
 * produce the identical clip list in the identical order. Selection is
 * score-first (ties broken by startMs, then id), windows are snapped to whole
 * seconds, and a target never returns two clips that overlap — a skipped
 * candidate is counted, not hidden.
 *
 * HONESTY: a clip candidate is a WINDOW INTO EXISTING FOOTAGE. No frames are
 * cut, reframed, upscaled or encoded here; that is the render gate in ./service.
 * Nothing is invented — the window is arithmetic on the timeline the project
 * actually has.
 */
import { clipsAt, type Timeline } from "../editor/timeline";
import { MOMENT_LABELS, sceneIdsIn, type MomentCandidate, type MomentKind } from "./moments";
import {
  CLIP_KIND_LABELS,
  clipKindOfMoment,
  PLATFORM_ASPECT,
  momentsForTarget,
  type ClipKind,
  type PlatformTarget,
  type PlatformTargetSpec,
  type ShortsTargetConfig,
} from "./targets";

export interface PlatformClip {
  /** Deterministic id: `<target>-<rank>`. */
  id: string;
  target: PlatformTarget;
  /** 1-based rank inside this target. */
  rank: number;
  /** Title/label hint, derived from the moment's text (never AI-written). */
  label: string;
  clipKind: ClipKind;
  momentKind: MomentKind;
  momentId: string;
  momentScore: number;
  /** The moment's own reason, verbatim. */
  reason: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  /** Scene ids whose video clips fall inside the window. */
  scenes: string[];
  /** How many timeline clips the window spans (video + b-roll + images). */
  sourceClips: number;
  /** The duration window this target used, in whole seconds. */
  windowSeconds: { min: number; max: number };
  /** The aspect this target is delivered in (Block 5b renders it). */
  aspect: string;
}

export interface TargetPlan {
  target: PlatformTarget;
  enabled: boolean;
  /** The configured count. */
  count: number;
  /** How many clips were actually produced. */
  produced: number;
  minSeconds: number;
  maxSeconds: number;
  kinds: ClipKind[];
  /** Moment kinds this target considers (derived from `kinds`). */
  momentKinds: MomentKind[];
  /** Scored moments eligible for this target. */
  considered: number;
  /** Eligible moments dropped because their window overlapped a chosen clip. */
  skippedOverlap: number;
  clips: PlatformClip[];
  note: string;
}

export interface ClipPlan {
  targets: TargetPlan[];
  totalClips: number;
  timelineMs: number;
}

const TARGET_ORDER: PlatformTarget[] = ["shorts", "reels", "tiktoks"];

function clamp(n: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, n));
}

/** Round ms up to the next whole second (a window is always whole seconds). */
function ceilSecond(ms: number): number {
  return Math.max(1000, Math.ceil(ms / 1000) * 1000);
}

/**
 * The clip window for a moment: its own span rounded up to whole seconds and
 * clamped into the target's window, centred on the moment, then snapped to a
 * whole second and kept inside the timeline.
 */
export function clipWindow(
  moment: MomentCandidate,
  spec: PlatformTargetSpec,
  timelineMs: number,
): { startMs: number; endMs: number; durationMs: number } {
  const minMs = spec.minSeconds * 1000;
  const maxMs = spec.maxSeconds * 1000;
  const wanted = clamp(ceilSecond(moment.durationMs), minMs, maxMs);
  if (timelineMs <= 0) return { startMs: 0, endMs: 0, durationMs: 0 };
  if (timelineMs <= wanted) return { startMs: 0, endMs: timelineMs, durationMs: timelineMs };
  const mid = Math.round((moment.startMs + moment.endMs) / 2);
  const start = clamp(Math.round((mid - wanted / 2) / 1000) * 1000, 0, timelineMs - wanted);
  return { startMs: start, endMs: start + wanted, durationMs: wanted };
}

function overlaps(a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }): boolean {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}

/** Deterministic ranking: score desc, then startMs asc, then id asc. */
function rank(moments: MomentCandidate[]): MomentCandidate[] {
  return moments
    .slice()
    .sort((a, b) => b.score - a.score || a.startMs - b.startMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function labelFor(moment: MomentCandidate): string {
  return moment.title;
}

/**
 * Build the clip plan for a whole config.
 *
 * Every target is reported, enabled or not: a disabled target produces 0 clips
 * and says so, so "different config → different counts" is visible in the
 * response rather than inferred.
 */
export function buildClipPlan(
  moments: MomentCandidate[],
  timeline: Timeline,
  config: ShortsTargetConfig,
): ClipPlan {
  const timelineMs = Math.max(0, timeline.durationMs);
  const safeMoments = Array.isArray(moments) ? moments : [];
  const targets: TargetPlan[] = [];

  for (const target of TARGET_ORDER) {
    const spec = config.targets[target];
    const momentKinds = momentsForTarget(spec);
    const eligible = rank(safeMoments.filter((m) => momentKinds.includes(m.kind)));
    const chosen: PlatformClip[] = [];
    const taken: { startMs: number; endMs: number }[] = [];
    let skippedOverlap = 0;

    if (spec.enabled) {
      for (const moment of eligible) {
        if (chosen.length >= spec.count) break;
        const window = clipWindow(moment, spec, timelineMs);
        if (window.durationMs <= 0) continue;
        if (taken.some((t) => overlaps(t, window))) {
          skippedOverlap += 1;
          continue;
        }
        const clipKind = clipKindOfMoment(moment.kind);
        if (!clipKind) continue;
        taken.push(window);
        chosen.push({
          id: `${target}-${chosen.length + 1}`,
          target,
          rank: chosen.length + 1,
          label: labelFor(moment),
          clipKind,
          momentKind: moment.kind,
          momentId: moment.id,
          momentScore: moment.score,
          reason: moment.reason,
          startMs: window.startMs,
          endMs: window.endMs,
          durationMs: window.durationMs,
          scenes: sceneIdsInWindow(timeline, window),
          sourceClips: clipsInWindow(timeline, window).length,
          windowSeconds: { min: spec.minSeconds, max: spec.maxSeconds },
          aspect: aspectOf(target),
        });
      }
    }

    targets.push({
      target,
      enabled: spec.enabled,
      count: spec.count,
      produced: chosen.length,
      minSeconds: spec.minSeconds,
      maxSeconds: spec.maxSeconds,
      kinds: [...spec.kinds],
      momentKinds,
      considered: eligible.length,
      skippedOverlap,
      clips: chosen,
      note: !spec.enabled
        ? `${target} is switched off in the config — 0 clips.`
        : chosen.length === 0
          ? `${target} is on (up to ${spec.count} × ${spec.minSeconds}-${spec.maxSeconds}s) but no scored moment matched its clip kinds (${spec.kinds.join(", ")}) — 0 clips. Nothing was invented to fill the quota.`
          : `${chosen.length}/${spec.count} clip(s) selected from ${eligible.length} eligible moment(s), each ${spec.minSeconds}-${spec.maxSeconds}s.` +
            (skippedOverlap > 0 ? ` ${skippedOverlap} candidate(s) skipped: their window overlapped a chosen clip.` : ""),
    });
  }

  return { targets, totalClips: targets.reduce((n, t) => n + t.produced, 0), timelineMs };
}

function aspectOf(target: PlatformTarget): string {
  return PLATFORM_ASPECT[target];
}

function clipsInWindow(timeline: Timeline, window: { startMs: number; endMs: number }) {
  const wanted: string[] = ["video", "broll", "images"];
  return timeline.clips
    .filter((c) => wanted.includes(c.trackId) && c.startMs < window.endMs && window.startMs < c.endMs)
    .sort((a, b) => a.startMs - b.startMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function sceneIdsInWindow(timeline: Timeline, window: { startMs: number; endMs: number }): string[] {
  return sceneIdsIn(clipsInWindow(timeline, window));
}

/** Flattened clip list across targets, in target order then rank (what gets persisted). */
export function flattenClips(plan: ClipPlan): PlatformClip[] {
  return plan.targets.flatMap((t) => t.clips);
}

/** Compact per-target summary for responses and the UI. */
export function planSummary(plan: ClipPlan): Record<string, unknown>[] {
  return plan.targets.map((t) => ({
    target: t.target,
    enabled: t.enabled,
    count: t.count,
    produced: t.produced,
    minSeconds: t.minSeconds,
    maxSeconds: t.maxSeconds,
    kinds: t.kinds,
    momentKinds: t.momentKinds,
    considered: t.considered,
    skippedOverlap: t.skippedOverlap,
    aspect: t.clips[0]?.aspect ?? aspectOf(t.target),
    note: t.note,
  }));
}

/** A clip as the UI/persisted state reads it (reason verbatim). */
export function clipView(clip: PlatformClip): Record<string, unknown> {
  return {
    id: clip.id,
    target: clip.target,
    rank: clip.rank,
    label: clip.label,
    clipKind: clip.clipKind,
    clipKindLabel: CLIP_KIND_LABELS[clip.clipKind],
    momentKind: clip.momentKind,
    momentKindLabel: MOMENT_LABELS[clip.momentKind],
    momentId: clip.momentId,
    score: clip.momentScore,
    reason: clip.reason,
    startMs: clip.startMs,
    endMs: clip.endMs,
    durationMs: clip.durationMs,
    durationSeconds: Math.round(clip.durationMs / 100) / 10,
    scenes: clip.scenes,
    sourceClips: clip.sourceClips,
    windowSeconds: clip.windowSeconds,
    aspect: clip.aspect,
  };
}

/** Aggregate stats used by the apply/clear responses. */
export function clipStats(clips: PlatformClip[]): { total: number; byTarget: Record<string, number>; byKind: Record<string, number>; totalMs: number } {
  const byTarget: Record<string, number> = {};
  const byKind: Record<string, number> = {};
  let totalMs = 0;
  for (const clip of clips) {
    byTarget[clip.target] = (byTarget[clip.target] ?? 0) + 1;
    byKind[clip.clipKind] = (byKind[clip.clipKind] ?? 0) + 1;
    totalMs += clip.durationMs;
  }
  return { total: clips.length, byTarget, byKind, totalMs };
}

/** Video-lane clips in a window (exported for tests / later reframing work). */
export function videoClipsInWindow(timeline: Timeline, window: { startMs: number; endMs: number }) {
  return clipsAt(timeline, "video").filter((c) => c.startMs < window.endMs && window.startMs < c.endMs);
}
