/**
 * Captions from a project's OWN scenes — the Subtitles tab's derivation.
 * Phase 8 Audio/Subtitle/Thumbnail block, 2026-11-15.
 *
 * Pure and unit-tested: it takes the Scene rows already read from the database
 * and returns the cue plan, grouped by scene, plus the sentences the panel
 * prints. It performs NO cue maths of its own — every cue, line break, word
 * timing and emphasis mark comes from `buildSubtitles` (src/lib/subtitles), the
 * same engine the render pipeline's `subtitle-plan` stage and the
 * `subtitles` `generate` API action use. What this module adds is only:
 *
 *   1. WHERE each scene's speech sits on the project timeline — a scene's own
 *      recorded `durationSeconds` when the row has one, otherwise the engine's
 *      own chars/sec ESTIMATE, in scene order, with the cursor advanced by what
 *      the previous scene actually produced;
 *   2. WHICH cues belong to which scene, so the panel can group them;
 *   3. the sentences that say what is true: the timing model in use, and — the
 *      one that must never be softened — that no subtitle is burned into any
 *      delivered file.
 *
 * Nothing here invents narration: a scene with no narration text produces no
 * cue and is reported as exactly that.
 */
import {
  buildSubtitles,
  DEFAULT_SAFE_MARGINS,
  type SubtitleCue,
  type SubtitlePlan,
} from "./engine";
import { autoSubtitleStyle, findSubtitleStyle, type SubtitleStyle } from "./styles";

/** One Scene row, reduced to what a cue needs. Read from the database; never guessed. */
export interface SceneSource {
  id: string;
  /** 1-based position in chapter-then-scene order. */
  number: number;
  title: string | null;
  narration: string | null;
  durationSeconds: number | null;
}

export interface SceneCueGroup {
  sceneId: string;
  number: number;
  title: string | null;
  narration: string | null;
  /** The Scene row's own recorded duration; null when the row records none. */
  durationSeconds: number | null;
  cues: SubtitleCue[];
  /** Where this scene's cues start/end on the project timeline (null when it has none). */
  startMs: number | null;
  endMs: number | null;
  /** Non-null only when the scene produced no cue, naming the reason. */
  missing: string | null;
}

export type TimingBasis = "explicit" | "estimate" | "mixed";

export interface SceneSubtitleDerivation {
  /** The assembled plan: every scene's cues, renumbered 1..N, in scene order. */
  plan: SubtitlePlan;
  groups: SceneCueGroup[];
  cueCount: number;
  scenesWithCues: number;
  scenesWithoutNarration: number;
  /** How each scene's speech window was placed. */
  timingBasis: TimingBasis;
  /** The sentence describing the timing model, for the panel. */
  timingSentence: string;
  /** True when no cue exists at all (nothing to export). */
  empty: boolean;
  /** The reason the plan is empty, or null when it is not. */
  emptyReason: string | null;
  style: SubtitleStyle;
}

export interface DeriveOptions {
  /** A catalog id, or "auto" to let the engine choose from topic/mood. */
  style?: string;
  language?: string;
  maxLineLength?: number;
  topic?: string;
  emotion?: string;
  mood?: string;
  videoKind?: string;
}

/**
 * The one sentence about the delivered file. It is the container's own
 * recorded provenance restated, and it must stay a statement about what was
 * PRODUCED: the pipeline's `subtitle-plan` stage plans and records cues; no
 * burn-in exists and no timed-text track is muxed into any delivered file.
 */
export const NO_BURN_IN_SENTENCE =
  "No subtitle track is burned into any delivered file. The render pipeline's subtitle-plan stage plans and " +
  "records cues; no burn-in has been produced or proved, and no delivered file carries a caption stream — the " +
  "file's own recorded provenance says: \u201cNo subtitles: no subtitle cue was burned in, and no timed-text " +
  "track is muxed.\u201d The .srt and .vtt below are the captions themselves, as files you can take away.";

/** Resolve the requested style against the catalog the API serves. */
export function resolveStyle(requested: string | undefined, opts: DeriveOptions = {}): SubtitleStyle {
  if (requested && requested !== "auto") {
    const found = findSubtitleStyle(requested);
    if (found) return found;
  }
  if (requested === "auto" || !requested) {
    return autoSubtitleStyle({
      topic: opts.topic,
      emotion: opts.emotion,
      mood: opts.mood,
      videoKind: opts.videoKind,
    }).style;
  }
  return findSubtitleStyle("minimal")!;
}

function shiftCue(cue: SubtitleCue, offsetMs: number): SubtitleCue {
  if (offsetMs === 0) return cue;
  return {
    ...cue,
    startMs: cue.startMs + offsetMs,
    endMs: cue.endMs + offsetMs,
    words: cue.words.map((w) => ({ ...w, startMs: w.startMs + offsetMs, endMs: w.endMs + offsetMs })),
  };
}

/**
 * Derive the project's caption plan from its scenes, in order.
 *
 * For each scene: if the Scene row records `durationSeconds`, its narration is
 * handed to the engine as an EXPLICIT window of exactly that length at the
 * running cursor. If it records none, the narration is handed over without a
 * window and the engine's own ESTIMATE places it; the cursor then advances to
 * the end of what the engine produced. Either way the cue text, the line
 * breaks and the word timings are the engine's, not this module's.
 */
export function deriveSceneSubtitles(scenes: SceneSource[], opts: DeriveOptions = {}): SceneSubtitleDerivation {
  const style = resolveStyle(opts.style, opts);
  const language = opts.language && opts.language.trim() ? opts.language.trim() : "en";

  const groups: SceneCueGroup[] = [];
  const allCues: SubtitleCue[] = [];
  let cursor = 0;
  let explicitScenes = 0;
  let estimatedScenes = 0;
  let scenesWithoutNarration = 0;

  for (const scene of scenes) {
    const narration = (scene.narration ?? "").trim();
    if (!narration) {
      scenesWithoutNarration += 1;
      groups.push({
        sceneId: scene.id,
        number: scene.number,
        title: scene.title,
        narration: scene.narration,
        durationSeconds: scene.durationSeconds,
        cues: [],
        startMs: null,
        endMs: null,
        missing: "This scene carries no narration text in the database, so it produces no cue. Nothing is invented to fill it.",
      });
      continue;
    }

    const durationMs =
      typeof scene.durationSeconds === "number" && Number.isFinite(scene.durationSeconds) && scene.durationSeconds > 0
        ? Math.round(scene.durationSeconds * 1000)
        : null;

    const plan = buildSubtitles({
      segments:
        durationMs !== null
          ? [{ text: narration, startMs: cursor, endMs: cursor + durationMs }]
          : [{ text: narration }],
      language,
      style: style.id,
      ...(opts.maxLineLength !== undefined ? { maxLineLength: opts.maxLineLength } : {}),
    });

    // An estimated plan starts at 0; move it to where the project timeline is.
    const offset = durationMs !== null ? 0 : cursor;
    const cues = plan.cues.map((cue) => shiftCue(cue, offset));

    if (durationMs !== null) {
      explicitScenes += 1;
      cursor = cursor + durationMs;
    } else if (cues.length > 0) {
      estimatedScenes += 1;
      cursor = Math.max(cursor, cues[cues.length - 1].endMs);
    } else {
      estimatedScenes += 1;
    }

    for (const cue of cues) allCues.push(cue);
    groups.push({
      sceneId: scene.id,
      number: scene.number,
      title: scene.title,
      narration: scene.narration,
      durationSeconds: scene.durationSeconds,
      cues,
      startMs: cues.length > 0 ? cues[0].startMs : null,
      endMs: cues.length > 0 ? cues[cues.length - 1].endMs : null,
      missing: null,
    });
  }

  // One continuous cue numbering across the whole project: an SRT index is a
  // file-wide sequence, so scene 2's first cue continues scene 1's last.
  let index = 0;
  for (const cue of allCues) {
    index += 1;
    cue.index = index;
  }

  const timingBasis: TimingBasis =
    explicitScenes > 0 && estimatedScenes > 0 ? "mixed" : explicitScenes > 0 ? "explicit" : "estimate";
  const timingSentence =
    allCues.length === 0
      ? "No cue was produced, so no timing model was used."
      : timingBasis === "explicit"
        ? `Timing is EXPLICIT: each scene's cues sit inside that Scene row's own recorded durationSeconds, in scene order.`
        : timingBasis === "estimate"
          ? `Timing is the engine's ESTIMATE: the Scene rows record no duration, so each scene's speech is placed in sequence by the subtitle engine's chars-per-second model. It is an estimate, not measured audio.`
          : `Timing is MIXED: ${explicitScenes} scene${explicitScenes === 1 ? "" : "s"} used their own recorded durationSeconds and ${estimatedScenes} used the engine's chars-per-second estimate because the Scene row records no duration. The estimated scenes are an estimate, not measured audio.`;

  const scenesWithCues = groups.filter((g) => g.cues.length > 0).length;
  const empty = allCues.length === 0;
  const emptyReason = empty
    ? scenes.length === 0
      ? "This project has no Scene rows, so there is no narration to turn into captions."
      : `This project has ${scenes.length} scene${scenes.length === 1 ? "" : "s"} and none carries narration text, so there is nothing to turn into captions. Nothing is invented to fill them.`
    : null;

  const plan: SubtitlePlan = {
    cues: allCues,
    language,
    style: style.id,
    maxLineLength: Math.max(8, Math.round(opts.maxLineLength ?? 42)),
    safeMargins: { x: DEFAULT_SAFE_MARGINS.x, y: DEFAULT_SAFE_MARGINS.y },
    timingModel: timingSentence,
  };

  return {
    plan,
    groups,
    cueCount: allCues.length,
    scenesWithCues,
    scenesWithoutNarration,
    timingBasis,
    timingSentence,
    empty,
    emptyReason,
    style,
  };
}

/** ms as m:ss.mmm — the panel's compact read of a cue time. */
export function clockLabel(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const m = Math.floor(safe / 60_000);
  const s = Math.floor((safe % 60_000) / 1000);
  const milli = safe % 1000;
  return `${m}:${String(s).padStart(2, "0")}.${String(milli).padStart(3, "0")}`;
}
