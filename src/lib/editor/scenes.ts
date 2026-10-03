/**
 * Phase 5 Block 2 — Scene controls service (deterministic plans + honest gates).
 *
 * The seven spec controls every scene owns in the editor:
 *
 *   regenerateScene  — re-derives the scene's clips from its Scene row (title,
 *                      narration, duration) → real timeline + changelist.
 *   regenerateVisual — visual re-generation plan + HONEST provider gate for
 *                      `image_generation` (nothing is applied without a provider).
 *   regenerateVoice  — re-derives the voice clip TIMING from the narration
 *                      (deterministic, real) + honest gate for `voice_generation`
 *                      (the audio itself needs a connected TTS provider).
 *   changeMusic      — deterministic category selection (`@/lib/music`
 *                      selectMusic) + real music-clip span/gain plan, with an
 *                      honest gate for `music_generation` (synthesis only).
 *   changeTransition — real, deterministic (`./transitions` setTransition).
 *   changeSubtitle   — real, deterministic style choice (`@/lib/subtitles`).
 *   restyleScene     — records a colour-grade id on the visual clips (Block 4
 *                      renders it) → real timeline + changelist.
 *
 * EVERY control returns the same envelope
 * `{ control, sceneId, changed, changelist, timeline?, provider?, note? }`:
 *   - `changelist` always describes exactly what changed (or, for a blocked
 *     plan, what WOULD change — never a claim that it happened),
 *   - `timeline` is present whenever the control produced one,
 *   - `provider` is present only where an AI provider is genuinely involved and
 *     is always honest: `connected: false`, the env var NAMES a server operator
 *     must set, and a note. Provider secrets never appear here.
 *
 * Determinism: same input → byte-identical result. No randomness, no clock, no
 * IO. All functions are pure and take/return plain timelines; the API layer
 * injects the Scene row and the store.
 */
import {
  EditorError,
  MIN_CLIP_MS,
  clipsAt,
  clipsForScene,
  copyClip,
  nextClipId,
  rebuildTimeline,
  sceneDurationMs,
  timelinesEqual,
  type Clip,
  type SceneInput,
  type Timeline,
  type TrackId,
} from "./timeline";
import {
  describeTransition,
  isTransitionKind,
  outgoingClipForScene,
  setTransition,
  type TransitionKind,
} from "./transitions";
import { findMusicCategory, selectMusic } from "../music";
import { BASE_WPM, findSubtitleStyle, autoSubtitleStyle } from "../subtitles";
import { capabilityStatus } from "../ai/status";
import {
  capabilityEnvHint,
  capabilityEnvNames,
  capabilityEnvRequirement,
} from "../ai/providers/capability-env";
import type { AiCapabilityId } from "../ai/types";
import { type SceneControlName } from "./scene-control-meta";

// The client-safe metadata (labels, moods, grade ids) is owned by
// ./scene-control-meta so the UI never imports this server-side module.
export {
  SCENE_CONTROLS,
  SCENE_CONTROL_LABELS,
  PROVIDER_CONTROLS,
  MUSIC_MOODS,
  COLOR_GRADE_HINTS,
  isSceneControlName,
  type SceneControlName,
} from "./scene-control-meta";

export interface ProviderGate {
  capability: string;
  connected: boolean;
  /** Env var NAMES (never values) a server operator must set. */
  requiredEnv: string[];
  envHint: string | null;
  note: string;
}

export interface MusicSelectionView {
  categoryId: string;
  name: string;
  score: number;
  reason: string;
  mood: string;
  energy: number;
  pace: string;
  gain: number;
}

export interface SceneControlResult {
  control: SceneControlName;
  sceneId: string;
  changed: boolean;
  changelist: string[];
  timeline?: Timeline;
  provider?: ProviderGate;
  selection?: MusicSelectionView;
  plan?: Record<string, unknown>;
  note?: string;
}

export interface SceneControlArgs {
  sceneId: string;
  /** The Scene row (absent for a manual/timeline-only scene). */
  scene?: SceneInput | null;
  visualPrompt?: string | null;
  mood?: string | null;
  /** 0-100. */
  energy?: number | null;
  kind?: string | null;
  durationMs?: number | null;
  styleId?: string | null;
  grade?: string | null;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/**
 * Honest capability gate. `connected` mirrors the orchestrator's real status
 * (false until a provider is both configured AND wired). The env var NAMES come
 * from the derived capability→env path (`capability-env`), which reads them out
 * of the provider registry — never from a literal in this file. When no provider
 * slot serves the capability the list is empty and the note says so rather than
 * naming a variable that would do nothing.
 */
function gate(capability: string, note: string): ProviderGate {
  let status: { status: string } | null = null;
  try {
    status = capabilityStatus(capability as AiCapabilityId);
  } catch {
    status = null;
  }
  return {
    capability,
    connected: status?.status === "connected",
    requiredEnv: capabilityEnvNames(capability),
    envHint: capabilityEnvHint(capability),
    note: `${note} ${capabilityEnvRequirement(capability)}`,
  };
}

/** Clips derived from a scene — empty list → EditorError("scene_not_found"). */
function requireSceneClips(timeline: Timeline, sceneId: string): Clip[] {
  const clips = clipsForScene(timeline, sceneId);
  if (clips.length === 0) {
    throw new EditorError("scene_not_found", `No clips for scene "${String(sceneId)}".`);
  }
  return clips;
}

function sceneSpanFrom(clips: Clip[]): { startMs: number; endMs: number } {
  const startMs = clips.reduce((min, c) => Math.min(min, c.startMs), clips[0].startMs);
  const endMs = clips.reduce((max, c) => Math.max(max, c.endMs), clips[0].endMs);
  return { startMs, endMs };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Word count of a narration string (deterministic, whitespace based). */
export function countWords(text: string | null | undefined): number {
  if (typeof text !== "string") return 0;
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).length;
}

/**
 * Deterministic narration estimate at the subtitle engine's BASE_WPM (150 wpm).
 * 0 for empty text — callers decide what to do with that.
 */
export function estimateNarrationMs(text: string | null | undefined): number {
  const words = countWords(text);
  if (words === 0) return 0;
  return Math.max(MIN_CLIP_MS, Math.round((words / BASE_WPM) * 60_000));
}

/** 0-100 energy → the music engine's pace vocabulary. */
export function energyToPace(energy: number): "slow" | "medium" | "fast" {
  if (energy >= 70) return "fast";
  if (energy >= 40) return "medium";
  return "slow";
}

/** Deterministic music-bed gain from the 0-100 energy slider (0.2-0.5). */
export function energyToGain(energy: number): number {
  const clamped = Math.max(0, Math.min(100, energy));
  return round2(0.2 + (clamped / 100) * 0.3);
}

function clampEnergy(v: unknown, fallback = 40): number {
  const n = typeof v === "number" && Number.isFinite(v) ? v : fallback;
  return Math.round(Math.max(0, Math.min(100, n)));
}

/** Re-derive a scene's clip naming so regenerated clips stay recognisable. */
function laneLabel(scene: SceneInput | null | undefined, existing: Clip[], sceneId: string): string {
  const title = str(scene?.title);
  if (title) return title;
  const video = existing.find((c) => c.trackId === "video");
  if (video) return video.name;
  return `Scene ${sceneId}`;
}

/* ------------------------------------------------------------------ */
/* a) regenerateScene                                                 */
/* ------------------------------------------------------------------ */

export function regenerateScene(
  timeline: Timeline,
  args: { sceneId: string; scene?: SceneInput | null },
): SceneControlResult {
  const sceneId = args.sceneId;
  const existing = requireSceneClips(timeline, sceneId);
  const scene = args.scene ?? null;
  const anchor = sceneSpanFrom(existing);
  const spanMs = scene ? sceneDurationMs(scene) : Math.max(MIN_CLIP_MS, anchor.endMs - anchor.startMs);
  const startMs = anchor.startMs;
  const endMs = startMs + spanMs;
  const label = laneLabel(scene, existing, sceneId);

  const touched = new Set<string>();
  const derived: Clip[] = [];
  const changelist: string[] = [];
  const lanes: { trackId: TrackId; name: string; sourceRef: string }[] = [
    { trackId: "video", name: label, sourceRef: `scene:${sceneId}` },
  ];
  // `narration` known (row present) decides the voice lane; unknown keeps it as-is.
  const narrationKnown = scene !== null && scene !== undefined;
  const narration = scene?.narration ?? null;
  const hasNarrationText = Boolean(str(narration));
  const wantsVoice = narrationKnown ? hasNarrationText : existing.some((c) => c.trackId === "voice");
  if (wantsVoice) lanes.push({ trackId: "voice", name: `Voice — ${label}`, sourceRef: "voice:auto" });
  lanes.push({ trackId: "subtitles", name: `Subtitles — ${label}`, sourceRef: "subtitle:auto" });

  for (const lane of lanes) {
    const previous = existing.find((c) => c.trackId === lane.trackId) ?? null;
    const id = previous ? previous.id : nextClipId(timeline, `sc-${sceneId}-${lane.trackId}`);
    const clip: Clip = {
      id,
      name: lane.name,
      trackId: lane.trackId,
      sceneId,
      startMs,
      endMs,
      sourceRef: lane.sourceRef,
    };
    if (previous) {
      if (previous.gain !== undefined) clip.gain = previous.gain;
      if (previous.subtitleStyle !== undefined) clip.subtitleStyle = previous.subtitleStyle;
      if (previous.grade !== undefined) clip.grade = previous.grade;
      if (previous.transition !== undefined) clip.transition = previous.transition;
      touched.add(previous.id);
    }
    derived.push(clip);
    if (!previous) {
      changelist.push(`${lane.trackId}: added ${id} (${startMs}→${endMs}ms).`);
    } else {
      const moved: string[] = [];
      if (previous.startMs !== startMs || previous.endMs !== endMs) {
        moved.push(`re-timed ${previous.startMs}→${previous.endMs}ms → ${startMs}→${endMs}ms`);
      }
      if (previous.name !== lane.name) moved.push(`renamed to "${lane.name}"`);
      if (previous.sourceRef !== lane.sourceRef) moved.push(`sourceRef → ${lane.sourceRef}`);
      if (moved.length > 0) changelist.push(`${lane.trackId}: ${id} ${moved.join(", ")}.`);
    }
  }

  // Clips of this scene that the derived set no longer covers (e.g. a split half
  // or a voice clip after the narration was cleared) are removed.
  const removed = existing.filter((c) => (c.trackId === "video" || c.trackId === "voice" || c.trackId === "subtitles") && !touched.has(c.id));
  if (removed.length > 0) {
    changelist.push(`${removed.length} stale clip(s) of this scene removed (${removed.map((c) => c.id).join(", ")}).`);
  }
  const ids = new Set(removed.map((c) => c.id));
  const untouchedOverlays = existing.filter((c) => c.trackId !== "video" && c.trackId !== "voice" && c.trackId !== "subtitles").length;
  if (untouchedOverlays > 0) {
    changelist.push(`${untouchedOverlays} overlay clip(s) of this scene (music/SFX/B-roll…) left untouched.`);
  }

  // `touched` clips are REPLACED by their derived counterpart (same id, new
  // span/name/sourceRef) — they must be dropped here as well, otherwise the
  // re-derived clip would sit next to the stale original (duplicate clip ids).
  const replaced = new Set(touched);
  const clips = [
    ...timeline.clips.filter((c) => !ids.has(c.id) && !replaced.has(c.id)).map(copyClip),
    ...derived,
  ];
  const next = rebuildTimeline(clips, timeline.version);
  const changed = !timelinesEqual(next, timeline);
  return {
    control: "regenerateScene",
    sceneId,
    changed,
    changelist: changed ? changelist : [],
    timeline: next,
    note: changed
      ? "The scene's clips were re-derived from its Scene row (duration/narration). Nothing was persisted — save to keep it."
      : "The scene's clips already match its Scene row — nothing to change.",
  };
}

/* ------------------------------------------------------------------ */
/* b) regenerateVisual (plan only — provider gated)                    */
/* ------------------------------------------------------------------ */

export function regenerateVisual(
  timeline: Timeline,
  args: { sceneId: string; scene?: SceneInput | null; visualPrompt?: string | null },
): SceneControlResult {
  const sceneId = args.sceneId;
  const existing = requireSceneClips(timeline, sceneId);
  const visualClips = clipsAt(timeline, "video").filter((c) => c.sceneId === sceneId);
  const prompt =
    str(args.visualPrompt) ?? str(args.scene?.visualPrompt ?? null) ?? str(args.scene?.title ?? null) ?? `Scene ${sceneId}`;
  const provider = gate(
    "image_generation",
    "Visual regeneration needs a connected image provider. The prompt and target clips below are ready — nothing was generated and no clip was changed.",
  );
  const changelist = visualClips.length
    ? visualClips.map(
        (c) => `video clip ${c.id}: visual prompt "${prompt}" would be re-issued — not applied (image_generation not connected).`,
      )
    : [`scene ${sceneId} has no video clip on the timeline — attach the scene first.`];
  return {
    control: "regenerateVisual",
    sceneId,
    changed: false,
    changelist,
    provider,
    plan: {
      applied: false,
      capability: provider.capability,
      visualPrompt: prompt,
      clipIds: visualClips.map((c) => c.id),
      sceneClipCount: existing.length,
    },
    note: provider.connected
      ? "An image provider is connected — re-issue this prompt through the orchestrator (no local timeline change)."
      : "Provider Not Connected — set one of " +
        provider.requiredEnv.join(", ") +
        " server-side to enable image_generation. Nothing was fabricated.",
  };
}

/* ------------------------------------------------------------------ */
/* c) regenerateVoice (timing is real, audio is gated)                 */
/* ------------------------------------------------------------------ */

export function regenerateVoice(
  timeline: Timeline,
  args: { sceneId: string; scene?: SceneInput | null },
): SceneControlResult {
  const sceneId = args.sceneId;
  const existing = requireSceneClips(timeline, sceneId);
  const span = sceneSpanFrom(existing);
  const scene = args.scene ?? null;
  const narrationKnown = scene !== null && scene !== undefined;
  const narration = scene?.narration ?? null;
  const provider = gate(
    "voice_generation",
    "The voice clip TIMING below is deterministic and was applied locally. The audio itself needs a connected TTS provider — no speech was synthesized.",
  );

  if (!narrationKnown) {
    return {
      control: "regenerateVoice",
      sceneId,
      changed: false,
      changelist: [],
      timeline,
      provider,
      note: "No Scene row is available for this scene, so the narration text is unknown and the voice timing was left untouched.",
    };
  }

  const voiceClips = existing.filter((c) => c.trackId === "voice");
  const words = countWords(narration);
  const changelist: string[] = [];
  let clips: Clip[];

  if (words === 0) {
    if (voiceClips.length === 0) {
      return {
        control: "regenerateVoice",
        sceneId,
        changed: false,
        changelist: [],
        timeline,
        provider,
        note: "This scene has no narration text and no voice clip — nothing to change.",
      };
    }
    const ids = new Set(voiceClips.map((c) => c.id));
    clips = timeline.clips.filter((c) => !ids.has(c.id)).map(copyClip);
    changelist.push(`voice: removed ${voiceClips.length} clip(s) — the scene has no narration text.`);
  } else {
    const estimatedMs = Math.max(MIN_CLIP_MS, estimateNarrationMs(narration));
    const endMs = span.startMs + estimatedMs;
    const target = voiceClips[0] ?? null;
    const id = target ? target.id : nextClipId(timeline, `sc-${sceneId}-voice`);
    const created: Clip = {
      id,
      name: `Voice — ${str(scene?.title) ?? `Scene ${sceneId}`}`,
      trackId: "voice",
      sceneId,
      startMs: span.startMs,
      endMs,
      sourceRef: "voice:auto",
    };
    if (target) {
      if (target.gain !== undefined) created.gain = target.gain;
      const moved: string[] = [];
      if (target.startMs !== created.startMs || target.endMs !== created.endMs) {
        moved.push(`re-timed ${target.startMs}→${target.endMs}ms → ${created.startMs}→${created.endMs}ms`);
      }
      if (target.name !== created.name) moved.push(`renamed to "${created.name}"`);
      changelist.push(
        `voice: ${id} ${moved.length > 0 ? moved.join(", ") : "unchanged"} — narration ≈ ${words} words @ ${BASE_WPM} wpm ≈ ${estimatedMs}ms.`,
      );
      clips = timeline.clips.map((c) => (c.id === id ? created : copyClip(c)));
    } else {
      changelist.push(`voice: added ${id} (${created.startMs}→${created.endMs}ms) — narration ≈ ${words} words @ ${BASE_WPM} wpm ≈ ${estimatedMs}ms.`);
      clips = [...timeline.clips.map(copyClip), created];
    }
  }

  const next = rebuildTimeline(clips, timeline.version);
  const changed = !timelinesEqual(next, timeline);
  return {
    control: "regenerateVoice",
    sceneId,
    changed,
    changelist: changed ? changelist : [],
    timeline: next,
    provider,
    note: changed
      ? "Voice timing re-derived from the narration. " + provider.note
      : "The voice clip already matches the narration timing. " + provider.note,
  };
}

/* ------------------------------------------------------------------ */
/* d) changeMusic (selection + span real, synthesis gated)             */
/* ------------------------------------------------------------------ */

export function changeMusic(
  timeline: Timeline,
  args: { sceneId: string; scene?: SceneInput | null; mood?: string | null; energy?: number | null },
): SceneControlResult {
  const sceneId = args.sceneId;
  const existing = requireSceneClips(timeline, sceneId);
  const span = sceneSpanFrom(existing);
  const mood = str(args.mood) ?? "calm";
  const energy = clampEnergy(args.energy);
  const pace = energyToPace(energy);
  const { top } = selectMusic({
    emotion: mood,
    pace,
    ...(str(args.scene?.title) ? { topic: str(args.scene?.title) } : {}),
  });
  const category = findMusicCategory(top.categoryId);
  const gain = energyToGain(energy);
  const provider = gate(
    "music_generation",
    "The category choice, the clip span and the gain are deterministic and were applied locally. The audio bed itself needs a connected music provider — nothing was synthesized and no track URL was invented.",
  );

  const musicClips = clipsAt(timeline, "music").filter((c) => c.sceneId === sceneId);
  const changelist: string[] = [];
  let clips: Clip[];
  const selection: MusicSelectionView = {
    categoryId: top.categoryId,
    name: category?.name ?? top.name,
    score: top.score,
    reason: top.reason,
    mood,
    energy,
    pace,
    gain,
  };
  const sourceRef = `music-category:${top.categoryId}`;
  const name = `Music — ${category?.name ?? top.name}`;

  if (musicClips.length === 0) {
    const clip: Clip = {
      id: nextClipId(timeline, `sc-${sceneId}-music`),
      name,
      trackId: "music",
      sceneId,
      startMs: span.startMs,
      endMs: span.endMs,
      sourceRef,
      gain,
    };
    clips = [...timeline.clips.map(copyClip), clip];
    changelist.push(`music: added ${clip.id} (${sourceRef} @ gain ${gain}, ${clip.startMs}→${clip.endMs}ms) — synthesis pending.`);
  } else {
    const target = musicClips[0];
    const updated: Clip = { ...copyClip(target), name, sourceRef, gain, startMs: span.startMs, endMs: span.endMs };
    const moved: string[] = [];
    if (target.sourceRef !== sourceRef) moved.push(`${target.sourceRef ?? "no source"} → ${sourceRef}`);
    if (target.gain !== gain) moved.push(`gain ${target.gain ?? 1} → ${gain}`);
    if (target.startMs !== span.startMs || target.endMs !== span.endMs) {
      moved.push(`span ${target.startMs}→${target.endMs}ms → ${span.startMs}→${span.endMs}ms`);
    }
    if (target.name !== name) moved.push(`name → "${name}"`);
    changelist.push(`music: ${target.id} ${moved.length > 0 ? moved.join(", ") : "unchanged"} — synthesis pending.`);
    clips = timeline.clips.map((c) => (c.id === target.id ? updated : copyClip(c)));
    const extra = musicClips.length - 1;
    if (extra > 0) changelist.push(`music: ${extra} additional music clip(s) on this scene left untouched.`);
  }

  const next = rebuildTimeline(clips, timeline.version);
  const changed = !timelinesEqual(next, timeline);
  return {
    control: "changeMusic",
    sceneId,
    changed,
    changelist: changed ? changelist : [],
    timeline: next,
    provider,
    selection,
    note:
      `Deterministic pick: ${selection.name} (score ${selection.score}) for mood "${mood}", energy ${energy} → pace "${pace}". ` +
      (changed ? "The music clip was updated. " : "The music clip already matched. ") +
      provider.note,
  };
}

/* ------------------------------------------------------------------ */
/* e) changeTransition (fully deterministic)                           */
/* ------------------------------------------------------------------ */

export function changeTransition(
  timeline: Timeline,
  args: { sceneId: string; kind: string; durationMs?: number | null },
): SceneControlResult {
  const sceneId = args.sceneId;
  requireSceneClips(timeline, sceneId);
  const kind = str(args.kind);
  if (!kind || !isTransitionKind(kind)) {
    throw new EditorError("invalid_input", `Unknown transition kind "${String(args.kind)}".`);
  }
  const target = outgoingClipForScene(timeline, sceneId);
  if (!target) throw new EditorError("scene_not_found", `No clips for scene "${String(sceneId)}".`);
  const before = describeTransition(target.transition ?? null);
  const durationMs =
    args.durationMs === null || args.durationMs === undefined ? undefined : Number(args.durationMs);
  const result = setTransition(timeline, {
    sceneId,
    kind: kind as TransitionKind,
    ...(durationMs !== undefined ? { durationMs } : {}),
  });
  const applied = result.timeline.clips.find((c) => c.id === target.id)?.transition ?? null;
  const changelist = result.changed
    ? [`transition: ${target.id} (scene outgoing clip) ${before} → ${describeTransition(applied)}.`]
    : [];
  return {
    control: "changeTransition",
    sceneId,
    changed: result.changed,
    changelist,
    timeline: result.timeline,
    note: result.changed
      ? "Transition set on the scene's outgoing clip. Deterministic — no provider involved."
      : `The scene's outgoing clip is already ${describeTransition(applied)}.`,
  };
}

/* ------------------------------------------------------------------ */
/* f) changeSubtitle (fully deterministic)                             */
/* ------------------------------------------------------------------ */

export function changeSubtitle(
  timeline: Timeline,
  args: { sceneId: string; styleId: string; mood?: string | null },
): SceneControlResult {
  const sceneId = args.sceneId;
  const existing = requireSceneClips(timeline, sceneId);
  const raw = str(args.styleId);
  if (!raw) throw new EditorError("invalid_input", "changeSubtitle.styleId is required.");
  let styleId: string;
  let reason: string;
  if (raw.toLowerCase() === "auto") {
    const auto = autoSubtitleStyle({
      ...(str(args.mood) ? { emotion: str(args.mood) } : {}),
      ...(str(args.mood) ? { mood: str(args.mood) } : {}),
    });
    styleId = auto.style.id;
    reason = auto.reason;
  } else {
    const style = findSubtitleStyle(raw);
    if (!style) throw new EditorError("invalid_input", `Unknown subtitle style "${raw}".`);
    styleId = style.id;
    reason = `Manually selected ${style.name}.`;
  }

  const captionClips = existing.filter((c) => c.trackId === "subtitles");
  if (captionClips.length === 0) {
    return {
      control: "changeSubtitle",
      sceneId,
      changed: false,
      changelist: [],
      timeline,
      note: `Scene ${sceneId} has no subtitle clip on the timeline — attach the scene (or its captions) first.`,
    };
  }
  const changelist: string[] = [];
  const clips = timeline.clips.map((c) => {
    if (!captionClips.some((s) => s.id === c.id)) return copyClip(c);
    if ((c.subtitleStyle ?? null) === styleId) return copyClip(c);
    changelist.push(`subtitles: ${c.id} style ${c.subtitleStyle ?? "default"} → ${styleId}.`);
    return { ...copyClip(c), subtitleStyle: styleId };
  });
  const next = rebuildTimeline(clips, timeline.version);
  const changed = !timelinesEqual(next, timeline);
  return {
    control: "changeSubtitle",
    sceneId,
    changed,
    changelist,
    timeline: next,
    note: changed
      ? `${reason} Deterministic — the style id is stored on the caption clip(s); no provider involved.`
      : `The caption clip(s) already use ${styleId}. Deterministic — no provider involved.`,
  };
}

/* ------------------------------------------------------------------ */
/* g) restyleScene (records the grade; Block 4 renders it)             */
/* ------------------------------------------------------------------ */

export function restyleScene(
  timeline: Timeline,
  args: { sceneId: string; grade: string },
): SceneControlResult {
  const sceneId = args.sceneId;
  const existing = requireSceneClips(timeline, sceneId);
  const grade = str(args.grade);
  if (!grade) throw new EditorError("invalid_input", "restyleScene.grade is required.");
  const targetClips = existing.filter((c) => c.trackId === "video" || c.trackId === "broll" || c.trackId === "images");
  if (targetClips.length === 0) {
    return {
      control: "restyleScene",
      sceneId,
      changed: false,
      changelist: [],
      timeline,
      note: `Scene ${sceneId} has no visual clip to grade yet.`,
    };
  }
  const changelist: string[] = [];
  const clips = timeline.clips.map((c) => {
    if (!targetClips.some((s) => s.id === c.id)) return copyClip(c);
    if ((c.grade ?? null) === grade) return copyClip(c);
    changelist.push(`grade: ${c.id} ${c.grade ?? "none"} → ${grade}.`);
    return { ...copyClip(c), grade };
  });
  const next = rebuildTimeline(clips, timeline.version);
  const changed = !timelinesEqual(next, timeline);
  return {
    control: "restyleScene",
    sceneId,
    changed,
    changelist,
    timeline: next,
    plan: { applied: true, grade, clipIds: targetClips.map((c) => c.id) },
    note: changed
      ? `Grade "${grade}" recorded on ${targetClips.length} visual clip(s). Block 4 renders the actual colour grade — nothing is rendered here.`
      : `The visual clip(s) already carry grade "${grade}".`,
  };
}

/* ------------------------------------------------------------------ */
/* Dispatcher                                                          */
/* ------------------------------------------------------------------ */

/**
 * One entry point for all seven controls — the API service and the unit tests
 * call exactly this, so the tested behaviour is the served behaviour.
 */
export function applySceneControl(
  timeline: Timeline,
  control: SceneControlName,
  args: SceneControlArgs,
): SceneControlResult {
  switch (control) {
    case "regenerateScene":
      return regenerateScene(timeline, { sceneId: args.sceneId, scene: args.scene ?? null });
    case "regenerateVisual":
      return regenerateVisual(timeline, {
        sceneId: args.sceneId,
        scene: args.scene ?? null,
        visualPrompt: args.visualPrompt ?? null,
      });
    case "regenerateVoice":
      return regenerateVoice(timeline, { sceneId: args.sceneId, scene: args.scene ?? null });
    case "changeMusic":
      return changeMusic(timeline, {
        sceneId: args.sceneId,
        scene: args.scene ?? null,
        mood: args.mood ?? null,
        energy: args.energy ?? null,
      });
    case "changeTransition": {
      const kind = str(args.kind);
      if (!kind) throw new EditorError("invalid_input", "changeTransition.kind is required.");
      return changeTransition(timeline, {
        sceneId: args.sceneId,
        kind,
        durationMs: args.durationMs ?? null,
      });
    }
    case "changeSubtitle": {
      const styleId = str(args.styleId);
      if (!styleId) throw new EditorError("invalid_input", "changeSubtitle.styleId is required.");
      return changeSubtitle(timeline, { sceneId: args.sceneId, styleId, mood: args.mood ?? null });
    }
    case "restyleScene": {
      const grade = str(args.grade);
      if (!grade) throw new EditorError("invalid_input", "restyleScene.grade is required.");
      return restyleScene(timeline, { sceneId: args.sceneId, grade });
    }
    default:
      throw new EditorError("invalid_input", `Unknown scene control "${String(control)}".`);
  }
}
