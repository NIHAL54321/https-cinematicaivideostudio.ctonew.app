/**
 * Budgeting engine — duration → structure math (Video → Chapters → Scenes → Clips).
 *
 * PURE and DETERMINISTIC. Given a total duration (15s…120m) and a format, this
 * module produces a plan whose scene durations sum EXACTLY to the requested
 * total (see `validatePlan` and the unit tests). Allocation uses the
 * largest-remainder method: integer seconds, never fractional drift, and the
 * hook beat always gets its share while the CTA beat always closes the video.
 */
import type {
  ChapterPlan,
  DurationSeconds,
  ScenePlan,
  StoryStructure,
  StructureBeat,
  VideoFormat,
  VideoPlan,
} from "./types";
import { DURATION_OPTIONS, MAX_DURATION, MIN_DURATION } from "./types";
import { DEFAULT_STRUCTURE_ID, getStructure, selectStructure } from "./structures";

/** Format → allowed duration window (seconds). LONG: 1m–120m, SHORT: 15s–3m, SOCIAL: 15s–5m. */
export const FORMAT_DURATION_RANGE: Record<VideoFormat, { min: number; max: number }> = {
  LONG: { min: 60, max: MAX_DURATION },
  SHORT: { min: MIN_DURATION, max: 180 },
  SOCIAL: { min: MIN_DURATION, max: 300 },
};

/** Default duration picked when a format change makes the current one invalid. */
export const DEFAULT_DURATION_FOR_FORMAT: Record<VideoFormat, number> = {
  LONG: 300,
  SHORT: 60,
  SOCIAL: 60,
};

export function validateDurationForFormat(
  duration: number,
  format: VideoFormat,
): { ok: true } | { ok: false; error: string } {
  if (!Number.isInteger(duration)) return { ok: false, error: "Duration must be a whole number of seconds." };
  const range = FORMAT_DURATION_RANGE[format];
  if (duration < range.min || duration > range.max) {
    return {
      ok: false,
      error: `Duration ${duration}s is outside the ${format} range (${range.min}s–${range.max}s).`,
    };
  }
  return { ok: true };
}

/** The preset options allowed for a format (drives the wizard's duration step). */
export function allowedDurationOptions(format: VideoFormat): DurationSeconds[] {
  const range = FORMAT_DURATION_RANGE[format];
  return DURATION_OPTIONS.filter((d) => d >= range.min && d <= range.max);
}

/**
 * Split `total` (integer seconds) across `weights` using largest remainder.
 * Guarantees: all parts are integers >= 1 (when total >= weights.length),
 * and the parts sum to `total` EXACTLY.
 */
export function splitDuration(total: number, weights: number[]): number[] {
  const n = weights.length;
  if (n === 0) return [];
  if (n === 1) return [total];
  const wsum = weights.reduce((a, b) => a + b, 0);
  const raw = weights.map((w) => (total * w) / wsum);
  const parts = raw.map((r) => Math.floor(r));
  let remainder = total - parts.reduce((a, b) => a + b, 0);
  // Distribute the remainder to the parts with the largest fractional tails.
  const order = raw
    .map((r, i) => ({ i, frac: r - parts[i] }))
    .sort((a, b) => b.frac - a.frac);
  let k = 0;
  while (remainder > 0) {
    parts[order[k % order.length].i] += 1;
    remainder -= 1;
    k += 1;
  }
  // Safety: no part below 1 second (only relevant when total < n).
  for (let pass = 0; pass < n; pass++) {
    const zeroIdx = parts.findIndex((v) => v < 1);
    if (zeroIdx === -1) break;
    const maxIdx = parts.indexOf(Math.max(...parts));
    parts[maxIdx] -= 1;
    parts[zeroIdx] += 1;
  }
  return parts;
}

/**
 * Pick the beats a given duration can afford, always keeping the first beat
 * (hook) and the last beat (CTA/conclusion). Short videos get a compressed
 * arc — structure, not a shortened script.
 */
function selectBeats(structure: StoryStructure, duration: number): StructureBeat[] {
  const all = structure.beats;
  if (all.length <= 2) return all;
  const maxBeats =
    duration <= 30 ? 2 : duration <= 60 ? 3 : duration <= 90 ? 4 : duration <= 300 ? 6 : all.length;
  if (all.length <= maxBeats) return all;
  const picked = all.slice(0, maxBeats - 1);
  const last = all[all.length - 1];
  if (!picked.includes(last)) picked.push(last);
  return picked;
}

/** Chapter count heuristic by duration (deterministic). */
function chapterCountFor(duration: number, format: VideoFormat): number {
  if (duration <= 30) return 1;
  if (duration <= 90) return format === "LONG" ? 2 : 1;
  if (duration <= 300) return 3;
  if (duration <= 600) return 4;
  if (duration <= 1200) return 5;
  if (duration <= 1800) return 6;
  if (duration <= 3600) return 8;
  if (duration <= 5400) return 12;
  return 16;
}

/** Scene count heuristic for a chapter of `chapterSeconds` (deterministic). */
function sceneCountFor(chapterSeconds: number): number {
  return Math.min(6, Math.max(1, Math.round(chapterSeconds / 45)));
}

/**
 * Default duration for a scene the user adds manually — the engine's average
 * scene length heuristic for the chapter (chapterSeconds ÷ sceneCountFor),
 * clamped to [MIN_DURATION, 120]. Used by the storyboard "Add scene" action.
 */
export function defaultSceneDuration(chapterSeconds: number): number {
  const n = sceneCountFor(Math.max(1, chapterSeconds));
  return Math.min(120, Math.max(MIN_DURATION, Math.round(Math.max(1, chapterSeconds) / n)));
}

/** Clip count heuristic for a scene of `sceneSeconds` (editing rhythm). */
function clipCountFor(sceneSeconds: number): number {
  return Math.min(4, Math.max(1, Math.ceil(sceneSeconds / 15)));
}

/** Group beats into contiguous chapters, as evenly as possible. */
function groupBeats(beats: StructureBeat[], chapterCount: number): StructureBeat[][] {
  const n = beats.length;
  if (chapterCount >= n) return beats.map((b) => [b]);
  const groups: StructureBeat[][] = [];
  const base = Math.floor(n / chapterCount);
  let extra = n % chapterCount;
  let idx = 0;
  for (let g = 0; g < chapterCount; g++) {
    const size = base + (extra > 0 ? 1 : 0);
    extra = Math.max(0, extra - 1);
    groups.push(beats.slice(idx, idx + size));
    idx += size;
  }
  return groups;
}

export interface BuildPlanOptions {
  durationSeconds: number;
  format: VideoFormat;
  /** Optional explicit structure id; defaults to format-appropriate heuristics. */
  structureId?: string;
  /** Optional topic text used only for the heuristic structure selection. */
  topic?: string;
}

/**
 * Build the full Video → Chapters → Scenes → Clips plan.
 * Throws on invalid duration/format. The sum of every scene's duration
 * (and every clip's duration within a scene) equals `durationSeconds` exactly.
 */
export function buildPlan(opts: BuildPlanOptions): VideoPlan {
  const { format } = opts;
  const duration = opts.durationSeconds;
  const validated = validateDurationForFormat(duration, format);
  if (!validated.ok) throw new Error(validated.error);

  const structure: StoryStructure = opts.structureId
    ? getStructure(opts.structureId) ?? getStructure(DEFAULT_STRUCTURE_ID)!
    : selectStructure(format, opts.topic ?? "").structure;

  const beats = selectBeats(structure, duration);
  const chapterCount = Math.min(chapterCountFor(duration, format), beats.length);
  const groups = groupBeats(beats, chapterCount);

  // Beat-level seconds via largest remainder (beats keep their shares).
  const beatSeconds = splitDuration(duration, beats.map((b) => b.share));

  const chapters: ChapterPlan[] = groups.map((group, gi) => {
    const chapterSeconds = group.reduce((acc, b) => acc + beatSeconds[beats.indexOf(b)], 0);
    const sceneCount = sceneCountFor(chapterSeconds);
    const sceneWeights = group.map((b, idx) => {
      // One scene per beat inside the group; extra scenes split the largest beat.
      const perBeat = Math.max(1, Math.floor(sceneCount / group.length));
      const extras = sceneCount - perBeat * group.length;
      return perBeat + (idx < extras ? 1 : 0);
    });
    const scenes: ScenePlan[] = [];
    let sceneOrder = 0;
    for (let bi = 0; bi < group.length; bi++) {
      const beat = group[bi];
      const beatTotal = beatSeconds[beats.indexOf(beat)];
      const splitCount = sceneWeights[bi];
      const sub = splitDuration(beatTotal, Array(splitCount).fill(1));
      for (const subSeconds of sub) {
        sceneOrder += 1;
        const clips = splitDuration(subSeconds, Array(clipCountFor(subSeconds)).fill(1));
        const label = sceneLabel(beat, sceneOrder, splitCount > 1);
        scenes.push({
          order: sceneOrder,
          title: label.title,
          beatId: beat.id,
          beatName: beat.name,
          durationSeconds: subSeconds,
          narration: null,
          visualPrompt: null,
          camera: "",
          mediaType: "",
          clips,
        });
      }
    }
    const firstBeat = group[0];
    const isSingleBeat = group.length === 1;
    return {
      order: gi + 1,
      beatId: firstBeat.id,
      beatName: firstBeat.name,
      beatIds: group.map((b) => b.id),
      title: isSingleBeat ? firstBeat.name : `${firstBeat.name} → ${group[group.length - 1].name}`,
      summary: isSingleBeat
        ? firstBeat.purpose
        : group.map((b) => b.name).join(" · "),
      durationSeconds: chapterSeconds,
      scenes,
    };
  });

  const sceneCount = chapters.reduce((a, c) => a + c.scenes.length, 0);
  const clipCount = chapters.reduce((a, c) => a + c.scenes.reduce((x, s) => x + s.clips.length, 0), 0);
  const hookSeconds = chapters.find((c) => c.beatId === beats[0].id)?.durationSeconds ?? chapters[0]?.durationSeconds ?? 0;

  const plan: VideoPlan = {
    format,
    totalDurationSeconds: duration,
    structure,
    chapterCount: chapters.length,
    sceneCount,
    clipCount,
    hookSeconds,
    chapters,
    source: "structure-template",
  };
  const check = validatePlan(plan);
  if (!check.ok) throw new Error(`Internal budgeting error: ${check.error}`);
  return plan;
}

function sceneLabel(beat: StructureBeat, order: number, multi: boolean): { title: string } {
  const part = multi ? ` · Part ${order}` : "";
  return { title: `${beat.name}${part}` };
}

/** Sum of scene durations — must equal totalDurationSeconds EXACTLY. */
export function sceneSum(plan: VideoPlan): number {
  return plan.chapters.reduce((a, c) => a + c.scenes.reduce((x, s) => x + s.durationSeconds, 0), 0);
}

/** Sum of clip durations — must equal the scene duration EXACTLY. */
export function clipSum(scene: ScenePlan): number {
  return scene.clips.reduce((a, b) => a + b, 0);
}

export function validatePlan(plan: VideoPlan): { ok: true } | { ok: false; error: string } {
  if (plan.chapters.length === 0) return { ok: false, error: "Plan has no chapters." };
  if (sceneSum(plan) !== plan.totalDurationSeconds) {
    return { ok: false, error: "Scene durations do not sum to the total exactly." };
  }
  for (const ch of plan.chapters) {
    const chSum = ch.scenes.reduce((a, s) => a + s.durationSeconds, 0);
    if (chSum !== ch.durationSeconds) return { ok: false, error: `Chapter ${ch.order} sum mismatch.` };
    for (const sc of ch.scenes) {
      if (sc.durationSeconds < 1) return { ok: false, error: `Scene ${sc.order} has non-positive duration.` };
      if (clipSum(sc) !== sc.durationSeconds) {
        return { ok: false, error: `Scene ${sc.order} clips do not sum to its duration.` };
      }
    }
  }
  const first = plan.chapters[0];
  const last = plan.chapters[plan.chapters.length - 1];
  if (!first.beatIds.includes(plan.structure.beats[0].id)) {
    return { ok: false, error: "The hook beat must open the plan." };
  }
  if (!last.beatIds.includes(plan.structure.beats[plan.structure.beats.length - 1].id)) {
    return { ok: false, error: "The ending/CTA beat must close the plan." };
  }
  return { ok: true };
}
