/**
 * Phase 6 Block 3 — CHAPTER MARKERS (pure, client-safe).
 *
 * Chapter markers are derived from the REAL structure the project already has:
 * the scene/beat windows on the editor timeline (one beat per scene span on the
 * video lane), titled with the scene's own title. Nothing is invented:
 *
 *   - a beat's title is the scene title; when a scene has no title the chapter
 *     carries a POSITIONAL label ("Scene 2") and says so in `titleSource`,
 *   - adjacent beats are merged until a chapter is at least
 *     CHAPTER_MIN_SECONDS long, which is the rule YouTube enforces before it
 *     will show a chapter list at all; the merge is stated and every merged
 *     scene id is listed on the chapter,
 *   - a chapter RUNS UNTIL THE NEXT ONE (its end is the next chapter's start),
 *     so the block covers the timeline without gaps or overlaps — the same way
 *     a chapter list behaves on the platform,
 *   - the rules the block must satisfy are YouTube's PUBLISHED requirements,
 *     quoted in `CHAPTER_RULE_BASIS`: the first chapter starts at 00:00, the
 *     list has at least three chapters and every chapter is at least 10 seconds
 *     long. When a project cannot satisfy them the plan SAYS SO (`blockers`)
 *     instead of trimming chapters to a rounder-looking list.
 *
 * NOTHING IS WRITTEN. This module returns strings and numbers; the honest gate
 * for reading cue data out of audio lives in ./service.
 */
import { humanDuration } from "./sizing";

/* ------------------------------------------------------------------ */
/* The rules (published, quoted)                                       */
/* ------------------------------------------------------------------ */

/** The first chapter must start here. */
export const CHAPTER_FIRST_START_MS = 0;
/** Every chapter must be at least this long for the list to be shown. */
export const CHAPTER_MIN_SECONDS = 10;
/** A chapter list needs at least this many chapters to be shown. */
export const CHAPTER_MIN_COUNT = 3;

export const CHAPTER_RULE_BASIS =
  "YouTube's published chapter requirements (support.google.com/youtube — \"Add chapters to a video\"): the first chapter " +
  "starts at 00:00, the list contains at least three chapters, and each chapter is at least 10 seconds long. The same page " +
  "publishes the description format: one line per chapter, \"0:00 Title\", in order. When these are not met the platform " +
  "ignores the whole list, so this plan reports the unmet rules rather than trimming the list to look valid.";

export const CHAPTER_MERGE_POLICY =
  `Adjacent scene beats are merged in timeline order until a chapter reaches at least ${CHAPTER_MIN_SECONDS} s, so the merge ` +
  "itself never leaves a mid-list chapter below the minimum. A trailing group that cannot reach the minimum stays as one " +
  "short final chapter and is reported as too short rather than padded or dropped.";

/** Which timecode format the block uses, stated. */
export const CHAPTER_TIMECODE_BASIS =
  "M:SS for a video under an hour and H:MM:SS for one an hour or longer, which is the format the platform's own chapter " +
  "block uses; every value is the whole second the chapter starts in (floored, never rounded up).";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

/** One span of one scene on the timeline — the beat chapters are built from. */
export interface ChapterBeat {
  sceneId: string | null;
  title: string | null;
  startMs: number;
  endMs: number;
}

export interface Chapter {
  index: number;
  title: string;
  /** "scene" = the scene's own title; "positional" = a label derived from order. */
  titleSource: "scene" | "positional";
  startMs: number;
  endMs: number;
  startTimecode: string;
  durationMs: number;
  durationSeconds: number;
  durationHuman: string;
  /** The scene ids this chapter covers, in order. */
  sceneIds: string[];
  /** The scenes merged in AFTER the first one (empty for a single-scene chapter). */
  mergedSceneIds: string[];
  mergedSceneCount: number;
}

export interface ChapterPlan {
  /** The rule the merge and the block follow. */
  rules: {
    firstChapterAtMs: number;
    minChapterSeconds: number;
    minChapterCount: number;
    timecodeBasis: string;
    basis: string;
    mergePolicy: string;
  };
  /** Beats considered (the real timeline structure). */
  beatCount: number;
  /** Beats with no usable span, dropped and counted. */
  ignoredBeats: number;
  chapters: Chapter[];
  count: number;
  /** The plain-text / YouTube-style chapter block. */
  block: string;
  firstStartsAtZero: boolean;
  tooShort: { index: number; title: string; seconds: number }[];
  meetsYoutubeRequirements: boolean;
  /** Every published requirement this block does NOT meet, in plain words. */
  blockers: string[];
  /** Total seconds the chapters cover. */
  coveredSeconds: number;
  note: string;
}

/* ------------------------------------------------------------------ */
/* Timecode                                                            */
/* ------------------------------------------------------------------ */

/**
 * The chapter timecode: "0:00", "1:05", "1:02:03". Whole seconds, floored, so
 * a chapter never claims to start earlier than it does.
 */
export function formatChapterTimecode(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

/* ------------------------------------------------------------------ */
/* Beats → chapters                                                    */
/* ------------------------------------------------------------------ */

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Positional label used when a scene carries no title of its own. */
function positionalTitle(index: number): string {
  return `Scene ${index}`;
}

/**
 * Merge beats into chapters. Beats are taken in timeline order; each chapter is
 * closed as soon as its span (first beat start → last beat end) reaches
 * `minSeconds`. Only beats with a positive span are considered.
 */
export function mergeBeatsIntoChapters(beats: readonly ChapterBeat[], minSeconds: number = CHAPTER_MIN_SECONDS): {
  chapters: Chapter[];
  ignoredBeats: number;
} {
  const usable = beats
    .filter((b) => Number.isFinite(b.startMs) && Number.isFinite(b.endMs) && b.endMs > b.startMs)
    .slice()
    .sort((a, b) => a.startMs - b.startMs || a.endMs - b.endMs);
  const ignoredBeats = beats.length - usable.length;
  const minMs = Math.max(0, minSeconds) * 1000;

  interface Group {
    startMs: number;
    endMs: number;
    sceneIds: string[];
    titles: (string | null)[];
  }
  const groups: Group[] = [];
  let current: Group | null = null;
  for (const beat of usable) {
    if (!current) {
      current = { startMs: beat.startMs, endMs: beat.endMs, sceneIds: [], titles: [] };
    } else {
      current.endMs = Math.max(current.endMs, beat.endMs);
    }
    current.sceneIds.push(beat.sceneId ?? `beat:${beat.startMs}`);
    current.titles.push(beat.title);
    if (current.endMs - current.startMs >= minMs) {
      groups.push(current);
      current = null;
    }
  }
  if (current) groups.push(current);

  // A chapter runs until the next chapter starts; the last one ends at the last beat.
  const chapters: Chapter[] = groups.map((group, i) => {
    const next = groups[i + 1];
    const endMs = next ? next.startMs : group.endMs;
    const startMs = group.startMs;
    const title = group.titles.find((t) => typeof t === "string" && t.trim().length > 0);
    const durationMs = Math.max(0, endMs - startMs);
    const firstSceneId = group.sceneIds[0];
    return {
      index: i + 1,
      title: title ? title.trim() : positionalTitle(i + 1),
      titleSource: title ? "scene" : "positional",
      startMs,
      endMs,
      startTimecode: formatChapterTimecode(startMs),
      durationMs,
      durationSeconds: round3(durationMs / 1000),
      durationHuman: humanDuration(durationMs / 1000),
      sceneIds: [...group.sceneIds],
      mergedSceneIds: group.sceneIds.filter((id) => id !== firstSceneId),
      mergedSceneCount: Math.max(0, group.sceneIds.length - 1),
    };
  });

  return { chapters, ignoredBeats };
}

/** The plain-text chapter block the description would carry. */
export function renderChapterBlock(chapters: readonly Chapter[]): string {
  return chapters.map((c) => `${c.startTimecode} ${c.title}`).join("\n");
}

/**
 * The chapter plan: the chapters, the block, and every published requirement
 * the block meets or does not meet — stated, never smoothed over.
 */
export function buildChapterPlan(
  beats: readonly ChapterBeat[],
  minSeconds: number = CHAPTER_MIN_SECONDS,
): ChapterPlan {
  const { chapters, ignoredBeats } = mergeBeatsIntoChapters(beats, minSeconds);
  const block = renderChapterBlock(chapters);
  const firstStartsAtZero = chapters.length > 0 && chapters[0].startMs === CHAPTER_FIRST_START_MS;
  const tooShort = chapters
    .filter((c) => c.durationSeconds < minSeconds)
    .map((c) => ({ index: c.index, title: c.title, seconds: c.durationSeconds }));

  const blockers: string[] = [];
  if (ignoredBeats > 0) {
    blockers.push(`${ignoredBeats} beat(s) carried no usable span and were ignored, so the block does not cover the whole timeline.`);
  }
  if (chapters.length === 0) {
    blockers.push("No scene beats exist on the timeline, so there is nothing to chapter.");
  } else {
    if (!firstStartsAtZero) {
      blockers.push(
        `The first chapter starts at ${chapters[0].startTimecode}, not 00:00 — the platform requires the first chapter at 00:00.`,
      );
    }
    if (chapters.length < CHAPTER_MIN_COUNT) {
      blockers.push(
        `${chapters.length} chapter(s) — the platform needs at least ${CHAPTER_MIN_COUNT} before it shows a chapter list.`,
      );
    }
    if (tooShort.length > 0) {
      blockers.push(
        `${tooShort.length} chapter(s) are shorter than ${minSeconds} s (${tooShort
          .map((t) => `${t.title} ${t.seconds}s`)
          .join(", ")}).`,
      );
    }
  }

  return {
    rules: {
      firstChapterAtMs: CHAPTER_FIRST_START_MS,
      minChapterSeconds: minSeconds,
      minChapterCount: CHAPTER_MIN_COUNT,
      timecodeBasis: CHAPTER_TIMECODE_BASIS,
      basis: CHAPTER_RULE_BASIS,
      mergePolicy: CHAPTER_MERGE_POLICY,
    },
    beatCount: beats.length,
    ignoredBeats,
    chapters,
    count: chapters.length,
    block,
    firstStartsAtZero,
    tooShort,
    meetsYoutubeRequirements: blockers.length === 0,
    blockers,
    coveredSeconds: round3(chapters.reduce((sum, c) => sum + c.durationSeconds, 0)),
    note:
      chapters.length === 0
        ? "No chapter markers: this project has no scene beats on its timeline to derive them from. Nothing was invented to fill the list."
        : `Chapter markers derived from ${beats.length} scene beat(s) on the timeline: ${chapters.length} chapter(s), first at ` +
          `${chapters[0].startTimecode}, covering ${humanDuration(chapters.reduce((sum, c) => sum + c.durationSeconds, 0))}. ` +
          (blockers.length === 0
            ? "Every published chapter requirement is met."
            : `NOT met: ${blockers.join(" ")}`),
  };
}
