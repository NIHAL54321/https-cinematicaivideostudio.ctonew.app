/**
 * Phase 7 Block 1 — CHAPTERS, derived from the project's real Chapter/Scene rows.
 *
 * WHY THIS IS NOT ./export/chapters: that module builds the platform's chapter
 * LABELS from editor timeline beats, and where a scene has no title it is
 * REQUIRED to emit a positional label ("Scene 2") because a chapter line needs
 * some text. A publishing package is a different contract: it may not invent a
 * title at all. So here a blank chapter title is reported empty-with-reason and
 * the block is not emitted for it. Nothing is merged, split, re-ordered or
 * padded — every entry names the Chapter row id it came from.
 *
 * Timings are summed from the scenes' own `durationSeconds` and nothing else. If
 * any scene lacks a duration, or the project has no scenes at all, NO timing is
 * emitted (all timing fields empty-with-reason naming the count) rather than a
 * guess from the chapters that do have one.
 */
import { humanDuration } from "../export/sizing";
import { formatChapterTimecode } from "../export/chapters";
import { derived, emptyNoInput, type Field, type SourceKind } from "./provenance";
import type { PublishingChapterRow, PublishingSource } from "./types";

/** The exact wording the empty case uses, so callers and tests can rely on it. */
export const NO_CHAPTER_DATA = "no chapter data on this project yet";

export interface ChapterSceneEntry {
  sceneId: string;
  order: number;
  status: string;
  title: Field<string>;
  narration: Field<string>;
  durationSeconds: Field<number>;
}

export interface ChapterEntry {
  index: number;
  chapterId: string;
  scriptId: string;
  order: number;
  sceneCount: number;
  title: Field<string>;
  summary: Field<string>;
  startSeconds: Field<number>;
  startTimecode: Field<string>;
  durationSeconds: Field<number>;
  scenes: ChapterSceneEntry[];
}

export interface ChapterPlanView {
  kind: "chapters";
  rule: "R-CH-ORDER";
  titleRule: "R-CH-TITLE";
  timingRule: "R-CH-TIMING";
  blockRule: "R-CH-BLOCK";
  entries: ChapterEntry[];
  chapterCount: number;
  sceneCount: number;
  scenesWithoutDuration: number;
  timingsAvailable: boolean;
  timingBasis: string;
  /** The "0:00 Title" block, or empty-with-reason when it cannot be built. */
  block: Field<string>;
  coveredSeconds: number | null;
  coveredHuman: string | null;
  notes: string[];
}

const SCENE_PATH = "title";
const NARRATION_PATH = "narration";
const DURATION_PATH = "durationSeconds";

function sceneRefKind(): SourceKind {
  return "scene";
}

/** Empty-with-reason for a text column that is null/blank on a real row. */
function blankText(
  reason: string,
  requires: string[],
  ref: { kind: SourceKind; id: string; path: string },
): Field<string> {
  return emptyNoInput(reason, requires, {
    note: `The row ${ref.kind}(${ref.id}).${ref.path} was read and holds no text; nothing was written for it.`,
  });
}

export function buildChapters(source: PublishingSource): ChapterPlanView {
  const { project, chapters } = source;
  const notes: string[] = [];

  const ordered = [...chapters].sort((a, b) => a.order - b.order);
  const sceneTotal = ordered.reduce((n, c) => n + c.scenes.length, 0);
  let scenesWithoutDuration = 0;
  for (const chapter of ordered) {
    for (const scene of chapter.scenes) if (scene.durationSeconds === null) scenesWithoutDuration += 1;
  }

  const timingsAvailable = sceneTotal > 0 && scenesWithoutDuration === 0;

  // The project's own TITLE is deliberately not interpolated into this reason:
  // a project whose title contains a phrase this app's own prose may not use must
  // still build, and an app-authored sentence never carries the project's
  // characters (see ./quotation). The row is named by id instead.
  const timingReason =
    sceneTotal === 0
      ? `Project row ${project.id} has no Scene rows, so a chapter's start and length cannot be summed from anything.`
      : `${scenesWithoutDuration} of ${sceneTotal} scene(s) on this project have no stored durationSeconds, so summing only the scenes that do have one would understate the timeline.`;

  const timingRequires =
    sceneTotal === 0
      ? ["Scene rows on this project with durationSeconds set"]
      : [`durationSeconds on all ${sceneTotal} Scene rows (currently missing on ${scenesWithoutDuration})`];

  if (sceneTotal === 0) {
    notes.push(
      "This project has chapters but no scene rows, so the package carries the real chapter titles and no timings at all.",
    );
  } else if (scenesWithoutDuration > 0) {
    notes.push(timingReason);
  }

  let cursorSeconds = 0;
  const entries: ChapterEntry[] = ordered.map((chapter, i) => {
    const chapterRef = { kind: "chapter" as SourceKind, id: chapter.id };
    const titleText = chapter.title.trim();
    const title: Field<string> = titleText
      ? derived(chapter.title, "R-CH-TITLE", [{ ...chapterRef, path: "title" }], {
          textOrigin: "source_verbatim",
        })
      : blankText(
          `Chapter ${i + 1} (row ${chapter.id}) has a blank title column, so no title is printed for it.`,
          ["a non-blank Chapter.title on this row"],
          { ...chapterRef, path: "title" },
        );

    const summaryText = chapter.summary?.trim();
    const summary: Field<string> = summaryText
      ? derived(chapter.summary as string, "R-CH-SUMMARY", [{ ...chapterRef, path: "summary" }], {
          textOrigin: "source_verbatim",
        })
      : blankText(
          `Chapter ${i + 1} (row ${chapter.id}) has no summary stored.`,
          ["Chapter.summary on this row"],
          { ...chapterRef, path: "summary" },
        );

    const scenes: ChapterSceneEntry[] = [...chapter.scenes]
      .sort((a, b) => a.order - b.order)
      .map((scene) => {
        const sceneRef = { kind: sceneRefKind(), id: scene.id };
        const sceneTitle = scene.title?.trim();
        const narration = scene.narration?.trim();
        return {
          sceneId: scene.id,
          order: scene.order,
          status: scene.status,
          title: sceneTitle
            ? derived(scene.title as string, "R-CH-TITLE", [{ ...sceneRef, path: SCENE_PATH }], {
                textOrigin: "source_verbatim",
                note: "This is a SCENE title, kept for traceability. It is not promoted to a chapter title and no chapter is created from it.",
              })
            : blankText(
                `Scene ${scene.order} (row ${scene.id}) has no title.`,
                ["Scene.title on this row"],
                { ...sceneRef, path: SCENE_PATH },
              ),
          narration: narration
            ? derived(scene.narration as string, "R-CH-SUMMARY", [{ ...sceneRef, path: NARRATION_PATH }], {
                textOrigin: "source_verbatim",
                note: "The scene's spoken text, kept as the source of the project's own words. It is not a summary and is not printed as one.",
              })
            : blankText(
                `Scene ${scene.order} (row ${scene.id}) has no narration stored.`,
                ["Scene.narration on this row"],
                { ...sceneRef, path: NARRATION_PATH },
              ),
          durationSeconds:
            scene.durationSeconds === null
              ? emptyNoInput(
                  `Scene ${scene.order} (row ${scene.id}) has no stored durationSeconds.`,
                  ["Scene.durationSeconds on this row"],
                )
              : derived(scene.durationSeconds, "R-CH-TIMING", [{ ...sceneRef, path: DURATION_PATH }], {
                  note: "The scene's own intended length in seconds, read from the row.",
                }),
        };
      });

    const chapterSeconds = timingsAvailable
      ? chapter.scenes.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0)
      : null;

    const startSeconds: Field<number> = timingsAvailable
      ? derived(cursorSeconds, "R-CH-TIMING", [{ ...chapterRef, path: "order" }], {
          note: `Sum of every scene duration in chapters before this one (${humanDuration(cursorSeconds)}).`,
        })
      : emptyNoInput(timingReason, timingRequires);

    const startTimecode: Field<string> = timingsAvailable
      ? derived(formatChapterTimecode(cursorSeconds * 1000), "R-CH-BLOCK", [{ ...chapterRef, path: "order" }], {
          textOrigin: "rule_authored",
          note: "The whole second this chapter starts in, floored. The characters are written by this rule from the summed scene durations above.",
        })
      : emptyNoInput(timingReason, timingRequires);

    const durationSeconds: Field<number> =
      timingsAvailable && chapterSeconds !== null && chapter.scenes.length > 0
        ? derived(chapterSeconds, "R-CH-TIMING", chapter.scenes.map((s) => ({ kind: sceneRefKind(), id: s.id, path: DURATION_PATH })), {
            note: `Sum of the ${chapter.scenes.length} scene duration(s) in this chapter.`,
          })
        : emptyNoInput(
            chapter.scenes.length === 0
              ? `Chapter ${i + 1} (row ${chapter.id}) has no Scene rows, so it has no length to sum.`
              : timingReason,
            chapter.scenes.length === 0 ? ["Scene rows on this chapter"] : timingRequires,
          );

    if (timingsAvailable && chapterSeconds !== null) cursorSeconds += chapterSeconds;

    return {
      index: i + 1,
      chapterId: chapter.id,
      scriptId: chapter.scriptId,
      order: chapter.order,
      sceneCount: chapter.scenes.length,
      title,
      summary,
      startSeconds,
      startTimecode,
      durationSeconds,
      scenes,
    };
  });

  if (entries.length === 0) {
    notes.push(`${NO_CHAPTER_DATA}: the project has no Chapter rows, so no chapter list, no titles and no timings exist to derive.`);
  }

  const block: Field<string> = (() => {
    if (entries.length === 0) {
      return emptyNoInput(
        `${NO_CHAPTER_DATA}. Nothing was invented to fill a chapter list.`,
        ["Chapter rows on this project (with their scenes)"],
      );
    }
    const untitled = entries.filter((e) => e.title.state !== "derived");
    if (untitled.length > 0) {
      return emptyNoInput(
        `${untitled.length} chapter(s) on this project have no title, so a chapter line cannot be written for them.`,
        ["a non-blank Chapter.title on every chapter"],
      );
    }
    if (!timingsAvailable) {
      return emptyNoInput(timingReason, timingRequires);
    }
    const lines = entries.map((e) => `${(e.startTimecode as { value: string }).value} ${(e.title as { value: string }).value}`);
    return derived(lines.join("\n"), "R-CH-BLOCK", entries.flatMap((e) => e.startTimecode.sources), {
      textOrigin: "source_verbatim",
      note: "One line per chapter, in chapter order, built only from each chapter's own title and start timecode.",
    });
  })();

  const coveredSeconds = timingsAvailable ? entries.reduce((sum, e) => sum + ((e.durationSeconds as { value: number }).value ?? 0), 0) : null;

  return {
    kind: "chapters",
    rule: "R-CH-ORDER",
    titleRule: "R-CH-TITLE",
    timingRule: "R-CH-TIMING",
    blockRule: "R-CH-BLOCK",
    entries,
    chapterCount: entries.length,
    sceneCount: sceneTotal,
    scenesWithoutDuration,
    timingsAvailable,
    timingBasis:
      "Chapter starts and lengths are sums of the scenes' own stored durationSeconds in narrative order; chapter 1 starts at 0 s. Nothing is assumed about a scene whose duration is not stored.",
    block,
    coveredSeconds,
    coveredHuman: coveredSeconds === null ? null : humanDuration(coveredSeconds),
    notes,
  };
}

/** The project's chapter rows, in narrative order, with their scenes. */
export function orderChapterRows(rows: readonly PublishingChapterRow[]): PublishingChapterRow[] {
  return [...rows]
    .sort((a, b) => a.order - b.order)
    .map((c) => ({ ...c, scenes: [...c.scenes].sort((a, b) => a.order - b.order) }));
}
