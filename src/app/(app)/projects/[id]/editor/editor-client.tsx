"use client";
/**
 * Phase 5 Block 1 + 2 — the video editor UI (client).
 *
 * Every timeline change goes through the PURE engine in `@/lib/editor`
 * (`trimClip`, `splitClip`, `reorderClip`, …) and is recorded in
 * `EditorHistory`. This component never mutates a Timeline directly: it calls
 * an op, commits the returned timeline to history, and (when asked) persists it
 * through `POST /api/studio/editor` with `action: "save"`.
 *
 * Block 2 adds the SCENE CONTROLS panel (the seven spec controls), the
 * "Add Auto Transitions" toolbar action and a real transition read-out in the
 * clip inspector. All three go through the same API: the server returns an
 * already-updated timeline for the deterministic operations (the client commits
 * it to history and marks the timeline dirty), while the provider-gated
 * operations (Regenerate Visual / Regenerate Voice) come back with an honest
 * "Provider Not Connected" gate — env var names, never a fabricated result.
 *
 * Honest UI: the preview is a styled placeholder that says so, and nothing here
 * pretends to render, synthesize or generate media.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowLeft,
  Check,
  ChevronDown,
  Copy,
  Film,
  Gauge,
  Info,
  Layers,
  ListChecks,
  Loader2,
  Mic,
  Music,
  Palette,
  Pause,
  Play,
  Plus,
  Redo2,
  RefreshCw,
  Save,
  Scissors,
  Shuffle,
  Sparkles,
  Trash2,
  Type,
  Undo2,
  WandSparkles,
  X,
} from "lucide-react";
import { Badge, Button, Card, Input, Label } from "@/components/ui";
import { ProviderNotConnected } from "@/components/provider-not-connected";
import { providerGateWording } from "@/lib/ai/gate-wording";
import {
  FramingPanel,
  type FrameFormatView,
  type FramingPanelAction,
  type FramingPolicyView,
  type FramingResponse,
} from "@/components/editor/framing-panel";
import { apiFetch } from "@/components/projects/client-api";
import { SUBTITLE_STYLES } from "@/lib/subtitles/styles";
import {
  AUTO_EDITOR_META,
  COLOR_GRADE_HINTS,
  EditorError,
  MUSIC_MOODS,
  PACE_BANDS,
  PACE_DIMENSIONS,
  PROVIDER_CONTROLS,
  SCENE_CONTROLS,
  SCENE_CONTROL_LABELS,
  TRANSITIONS,
  TRACKS,
  addScene as addSceneOp,
  adjustVolume,
  canRedo,
  canUndo,
  changeDuration,
  clipAtMs,
  clipById,
  clipsAt,
  commit,
  createHistory,
  deleteClip,
  describeTransition,
  duplicateClip,
  formatMs,
  isAudioTrack,
  isSequentialTrack,
  redo,
  removeScene as removeSceneOp,
  removeTransition,
  reorderClip,
  replaceClip,
  reset as resetHistory,
  splitClip,
  timelinesEqual,
  trimClip,
  undo,
  type AutoEditorCommand,
  type Clip,
  type EditorHistory,
  type SceneControlName,
  type SceneInput,
  type Timeline,
  type TrackId,
  type TransitionKind,
} from "@/lib/editor";
import {
  CLIP_KINDS,
  CLIP_KIND_LABELS,
  MOMENT_KINDS,
  MOMENT_LABELS,
  PLATFORM_LABELS,
  PLATFORM_TARGETS,
} from "@/lib/repurpose";

const TRACK_LABEL_W = 104;
const DEFAULT_SCENE_SECONDS = 5;

interface VersionRow {
  versionNumber: number;
  note: string | null;
  createdAt: string;
  snapshotBytes: number;
  clipCount: number;
  durationMs: number;
}

interface EditorBody {
  action?: string;
  source?: "saved" | "scenes";
  note?: string;
  error?: string;
  code?: string;
  count?: number;
  durationMs?: number;
  saved?: boolean;
  created?: boolean;
  restored?: boolean;
  versionNumber?: number;
  timeline?: Timeline;
  versions?: VersionRow[];
}

/* ---------------------------------------------- Block 2 response shapes */

/** The honest provider gate the API attaches to AI-backed scene controls. */
interface ProviderGateView {
  capability: string;
  connected: boolean;
  /** Env var NAMES a server operator must set — never values. */
  requiredEnv: string[];
  envHint: string | null;
  note: string;
}

interface MusicSelectionView {
  categoryId: string;
  name: string;
  score: number;
  reason: string;
  mood: string;
  energy: number;
  pace: string;
  gain: number;
}

interface SceneControlResponse extends EditorBody {
  control?: string;
  sceneId?: string;
  changed?: boolean;
  changelist?: string[];
  provider?: ProviderGateView;
  selection?: MusicSelectionView;
  plan?: Record<string, unknown>;
  sceneSource?: "project" | "timeline";
  timelineSource?: "request" | "timeline";
  persisted?: boolean;
  transitions?: { total: number; nonCut: number; dramatic: number; cuts: number };
  violations?: unknown[];
}

/**
 * POST /api/studio/editor keeping the HTTP status and the API's error `code`
 * (the Block 1 paths keep using `apiFetch`; the Block 2 controls surface the
 * server's honest refusal — e.g. 404 `scene_not_found` — verbatim).
 */
async function postEditor(payload: Record<string, unknown>): Promise<SceneControlResponse> {
  const res = await fetch("/api/studio/editor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  let body: SceneControlResponse = {};
  try {
    body = (await res.json()) as SceneControlResponse;
  } catch {
    body = {};
  }
  if (!res.ok) {
    const message = typeof body.error === "string" ? body.error : `Request failed (${res.status})`;
    throw Object.assign(new Error(message), { status: res.status, code: body.code });
  }
  return body;
}

/** The seven scene controls with their icons (labels come from the metadata). */
const SCENE_CONTROL_ICONS: Record<SceneControlName, typeof RefreshCw> = {
  regenerateScene: RefreshCw,
  regenerateVisual: Layers,
  regenerateVoice: Mic,
  changeMusic: Music,
  changeTransition: Shuffle,
  changeSubtitle: Type,
  restyleScene: Palette,
};

/** The controls whose result the client applies to the local timeline. */
const APPLIES_TIMELINE: readonly SceneControlName[] = [
  "regenerateScene",
  "changeTransition",
  "changeSubtitle",
  "restyleScene",
  "changeMusic",
];

const CONTROL_HINTS: Record<SceneControlName, string> = {
  regenerateScene: "Re-derives this scene's clips from its Scene row (duration + narration). Deterministic.",
  regenerateVisual: "Plans the new visual prompt — needs an image provider (nothing is generated here).",
  regenerateVoice: "Plans the voice timing from the narration — needs a TTS provider for the audio.",
  changeMusic: "Deterministic category pick from mood + energy — the audio bed needs a music provider.",
  changeTransition: "Sets the transition on this scene's outgoing clip. Deterministic.",
  changeSubtitle: "Records the caption style on this scene's subtitle clip. Deterministic.",
  restyleScene: "Records the colour grade on this scene's visual clips (Block 4 renders it).",
};

function errorMessage(err: unknown): string {
  if (err instanceof EditorError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

function sceneLabel(scene: SceneInput, index: number): string {
  const title = typeof scene.title === "string" && scene.title.trim() ? scene.title.trim() : `Scene ${index + 1}`;
  return title;
}

function sceneSeconds(scene: SceneInput): number {
  return typeof scene.durationSeconds === "number" && scene.durationSeconds > 0
    ? scene.durationSeconds
    : DEFAULT_SCENE_SECONDS;
}

/* ------------------------------------------------------------------ */
/* Block 2 — honest provider gate + the seven scene controls           */
/* ------------------------------------------------------------------ */

function ProviderPanel({ gate }: { gate: ProviderGateView }) {
  /*
   * BLOCK 9 — the label is DERIVED from the gate's live `connected` (the value the
   * server produced for THIS request), because the body below already branches on
   * it: a fixed "Provider Not Connected" label sitting above a body that says a
   * provider IS connected contradicts itself in the same view. Unread makes no
   * claim in either direction. See @/lib/ai/gate-wording.
   */
  const wording = providerGateWording(gate);
  return (
    <div className={`mt-2 rounded-lg border p-2.5 ${wording.tone === "ok" ? "border-ok/30 bg-ok/5" : "border-danger/30 bg-danger/5"}`}>
      <p
        data-testid="provider-gate-label"
        className={`flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] ${
          wording.tone === "ok" ? "text-ok" : wording.tone === "danger" ? "text-danger" : "text-ink-faint"
        }`}
      >
        <Info size={12} /> {wording.label}
      </p>
      <p className="mt-1.5 text-[11px] text-ink-dim">{wording.body}</p>
      <p className="mt-1.5 text-[11px] text-ink-faint">
        capability <span className="font-mono text-ink-dim">{gate.capability}</span>
      </p>
      {gate.requiredEnv.length > 0 ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          <span className="text-[11px] text-ink-faint">Set server-side:</span>
          {gate.requiredEnv.map((key) => (
            <span
              key={key}
              className="rounded border border-line bg-panel-3/60 px-1.5 py-0.5 font-mono text-[10px] text-ink-dim"
            >
              {key}
            </span>
          ))}
        </div>
      ) : null}
      <p className="mt-1.5 text-[11px] text-ink-faint">{gate.note}</p>
    </div>
  );
}

/** Exactly what the API returned for the last scene control — never a summary. */
function ControlResultPanel({
  result,
  applied,
  onDismiss,
}: {
  result: SceneControlResponse;
  applied: boolean;
  onDismiss: () => void;
}) {
  const label = result.control
    ? (SCENE_CONTROL_LABELS as Record<string, string>)[result.control] ?? result.control
    : "Result";
  const changelist = result.changelist ?? [];
  return (
    <div className="mt-3 rounded-lg border border-line bg-panel-3/40 p-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          {label}
          <Badge tone={applied ? "ok" : "neutral"}>{applied ? "timeline updated" : "plan only"}</Badge>
        </p>
        <button type="button" className="text-[11px] text-ink-faint hover:text-ink" onClick={onDismiss}>
          Dismiss
        </button>
      </div>

      {changelist.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {changelist.map((line) => (
            <li key={line} className="text-[11px] text-ink-dim">
              · {line}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[11px] text-ink-faint">No changelist — nothing needed to change.</p>
      )}

      {result.selection ? (
        <div className="mt-2 rounded-lg border border-line bg-panel-2/60 p-2">
          <p className="text-[11px] text-ink">
            Selected music category: <span className="font-medium">{result.selection.name}</span>{" "}
            <span className="font-mono text-[10px] text-ink-faint">{result.selection.categoryId}</span>
          </p>
          <p className="mt-1 text-[11px] text-ink-faint">
            score {result.selection.score} · mood {result.selection.mood} · energy {result.selection.energy} · pace{" "}
            {result.selection.pace} · gain {result.selection.gain}
          </p>
          <p className="mt-1 text-[11px] text-ink-faint">{result.selection.reason}</p>
        </div>
      ) : null}

      {result.provider ? <ProviderPanel gate={result.provider} /> : null}

      {result.note ? <p className="mt-2 text-[11px] text-ink-faint">{result.note}</p> : null}
      <p className="mt-1.5 text-[11px] text-ink-faint">
        {applied
          ? "Applied to the local timeline — Save to keep it."
          : "Plan only: the local timeline was NOT changed and nothing was persisted."}
      </p>
    </div>
  );
}

function SceneControlsPanel({
  sceneId,
  sceneLabel,
  onTimeline,
  busy,
  result,
  applied,
  error,
  onRun,
  onDismiss,
  transitionKind,
  onTransitionKind,
  subtitleStyleId,
  onSubtitleStyleId,
  mood,
  onMood,
  energy,
  onEnergy,
  grade,
  onGrade,
}: {
  sceneId: string | null;
  sceneLabel: string | null;
  onTimeline: boolean;
  busy: SceneControlName | null;
  result: SceneControlResponse | null;
  /** true when the last result was really committed to the local timeline. */
  applied: boolean;
  error: string | null;
  onRun: (control: SceneControlName) => void;
  onDismiss: () => void;
  transitionKind: TransitionKind;
  onTransitionKind: (v: TransitionKind) => void;
  subtitleStyleId: string;
  onSubtitleStyleId: (v: string) => void;
  mood: string;
  onMood: (v: string) => void;
  energy: number;
  onEnergy: (v: number) => void;
  grade: string;
  onGrade: (v: string) => void;
}) {
  const selectClass = "h-9 w-full rounded-lg border border-line bg-panel-3/60 px-2 text-xs text-ink";
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          <Sparkles size={12} /> Scene controls
        </p>
        <span className="text-[11px] text-ink-faint">
          {sceneId
            ? `Selected scene: ${sceneLabel ?? sceneId}${onTimeline ? "" : " — not on the timeline yet"}`
            : "Select a scene in the Scenes panel"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4">
        {SCENE_CONTROLS.map((control) => {
          const Icon = SCENE_CONTROL_ICONS[control];
          const running = busy === control;
          const gated = PROVIDER_CONTROLS.includes(control);
          return (
            <button
              key={control}
              type="button"
              disabled={!sceneId || busy !== null}
              title={CONTROL_HINTS[control]}
              onClick={() => onRun(control)}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-2 text-left text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                gated
                  ? "border-danger/25 bg-danger/5 text-ink-dim hover:border-danger/40 hover:text-ink"
                  : "border-line bg-panel-3/50 text-ink-dim hover:border-accent-line hover:text-ink"
              }`}
            >
              {running ? <Loader2 size={13} className="shrink-0 animate-spin" /> : <Icon size={13} className="shrink-0" />}
              <span className="truncate">{SCENE_CONTROL_LABELS[control]}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
        <div>
          <Label htmlFor="scene-transition">Transition kind</Label>
          <select
            id="scene-transition"
            className={selectClass}
            value={transitionKind}
            onChange={(e) => onTransitionKind(e.target.value as TransitionKind)}
          >
            {TRANSITIONS.map((t) => (
              <option key={t.kind} value={t.kind}>
                {t.label}
                {t.durationMsMax > 0 ? ` · ${t.durationMsMin}–${t.durationMsMax}ms` : " · 0ms"}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="scene-subtitle">Subtitle style</Label>
          <select
            id="scene-subtitle"
            className={selectClass}
            value={subtitleStyleId}
            onChange={(e) => onSubtitleStyleId(e.target.value)}
          >
            {SUBTITLE_STYLES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
            <option value="auto">Auto (from mood)</option>
          </select>
        </div>
        <div>
          <Label htmlFor="scene-mood">Music mood</Label>
          <select id="scene-mood" className={selectClass} value={mood} onChange={(e) => onMood(e.target.value)}>
            {MUSIC_MOODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="scene-grade">Colour grade</Label>
          <select id="scene-grade" className={selectClass} value={grade} onChange={(e) => onGrade(e.target.value)}>
            {COLOR_GRADE_HINTS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-2">
        <Label htmlFor="scene-energy">Music energy — {energy}</Label>
        <input
          id="scene-energy"
          type="range"
          min={0}
          max={100}
          step={5}
          value={energy}
          onChange={(e) => onEnergy(Number(e.target.value))}
          className="w-full accent-[var(--color-accent,#e8b45a)]"
        />
      </div>

      <p className="mt-2 text-[11px] text-ink-faint">
        Each button sends <span className="font-mono">action: &quot;sceneControl&quot;</span> with the picker values above
        and the current timeline. Deterministic controls return an updated timeline that is applied here; provider-gated
        controls return an honest plan instead of a result.
      </p>

      {error ? (
        <p className="mt-2 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
      ) : null}
      {result ? <ControlResultPanel result={result} applied={applied} onDismiss={onDismiss} /> : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Block 3b — AI auto-editor + pacing analyzer                         */
/* ------------------------------------------------------------------ */

/** `action: "autoEdit"` — the Block 3 command envelope, rendered verbatim. */
interface AutoEditResponse extends SceneControlResponse {
  command?: string;
  clipCount?: number;
}

/** One dimension of `action: "analyzePacing"` (0-100 + the engine's reason). */
interface PaceDimensionView {
  score: number;
  /** The engine names this `label`; `scoreLabel` is accepted as an alias. */
  label?: string;
  scoreLabel?: string;
  reason: string;
}

interface PacingResponse extends EditorBody {
  dimensions?: Record<string, PaceDimensionView>;
  overall?: number;
  band?: string;
  clipCount?: number;
  timelineSource?: "request" | "timeline";
}

/** Human names for the five engine dimension ids. */
const PACE_DIMENSION_LABELS: Record<string, string> = {
  narration: "Narration",
  visual: "Visual",
  music: "Music",
  sceneChange: "Scene change",
  attention: "Attention",
};

/** Bar tint: weak (<60) reads red, watchable (60-74) accent, strong (75+) green. */
function paceBarClass(score: number): string {
  if (score >= 75) return "bg-ok";
  if (score >= 60) return "bg-accent";
  return "bg-danger";
}

function paceBandTone(band: string | null | undefined): "neutral" | "accent" | "ok" | "danger" {
  if (band === "balanced") return "ok";
  if (band === "too fast") return "accent";
  if (band === "too slow") return "danger";
  return "neutral";
}

/**
 * The twelve one-click auto-edit commands. Every click posts the CURRENT local
 * timeline (+ the in-memory scenes) to `action: "autoEdit"`. A returned timeline
 * is committed through the same history/commit path the scene controls use; a
 * provider-gated answer (changed: false) is shown as its honest plan — nothing is
 * applied and nothing is fabricated.
 */
function AutoEditorPanel({
  busy,
  result,
  applied,
  error,
  onRun,
  onDismiss,
}: {
  busy: AutoEditorCommand | null;
  result: AutoEditResponse | null;
  /** The command whose timeline was really committed to the local timeline. */
  applied: AutoEditorCommand | null;
  error: string | null;
  onRun: (command: AutoEditorCommand) => void;
  onDismiss: () => void;
}) {
  const gated = Boolean(result?.provider && result.provider.connected === false);
  const appliedMeta = applied ? AUTO_EDITOR_META.find((m) => m.id === applied) ?? null : null;
  const resultMeta = result?.command
    ? AUTO_EDITOR_META.find((m) => m.id === result.command) ?? null
    : null;
  const changelist = result?.changelist ?? [];
  const rawPlanApplied = result?.plan ? result.plan["applied"] : undefined;
  const planApplied = typeof rawPlanApplied === "boolean" ? rawPlanApplied : null;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          <WandSparkles size={12} /> AI auto-editor
        </p>
        <span className="text-[11px] text-ink-faint">
          {appliedMeta ? `Last applied: ${appliedMeta.label}` : `${AUTO_EDITOR_META.length} one-click commands`}
        </span>
      </div>
      <p className="mt-2 text-[11px] text-ink-faint">
        Each command runs the editor engine on the timeline shown here and returns a changelist. A deterministic command
        edits the timeline for real; a command that needs a provider comes back as an honest plan — nothing is generated
        and no provider output is invented.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {AUTO_EDITOR_META.map((meta) => {
          const running = busy === meta.id;
          const wasApplied = applied === meta.id;
          return (
            <button
              key={meta.id}
              type="button"
              disabled={busy !== null}
              title={meta.hint}
              onClick={() => onRun(meta.id)}
              className={`flex flex-col gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                wasApplied
                  ? "border-ok/40 bg-ok/10 text-ink"
                  : "border-line bg-panel-3/50 text-ink-dim hover:border-accent-line hover:text-ink"
              }`}
            >
              <span className="flex items-center gap-1.5 text-[11px] font-medium">
                {running ? (
                  <Loader2 size={13} className="shrink-0 animate-spin" />
                ) : wasApplied ? (
                  <Check size={13} className="shrink-0 text-ok" />
                ) : (
                  <WandSparkles size={13} className="shrink-0" />
                )}
                <span className="truncate">{meta.label}</span>
                {wasApplied ? (
                  <Badge tone="ok" className="ml-auto shrink-0">
                    applied
                  </Badge>
                ) : null}
              </span>
              <span className="text-[10px] leading-snug text-ink-faint">{meta.hint}</span>
            </button>
          );
        })}
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
      ) : null}

      {result ? (
        <div className="mt-3 rounded-lg border border-line bg-panel-3/40 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
              <ListChecks size={12} />
              {resultMeta?.label ?? "Auto-edit result"}
              <Badge tone={applied ? "ok" : gated ? "danger" : result.changed ? "accent" : "neutral"}>
                {applied
                  ? "applied"
                  : gated
                    ? "provider not connected"
                    : result.changed
                      ? "not applied"
                      : "no change"}
              </Badge>
            </p>
            <button type="button" className="text-[11px] text-ink-faint hover:text-ink" onClick={onDismiss}>
              Dismiss
            </button>
          </div>

          {changelist.length > 0 ? (
            <>
              <p className="mt-2 text-[11px] text-ink-faint">
                {applied
                  ? "Applied to the local timeline:"
                  : gated
                    ? "Planned changes — none of these were applied:"
                    : "Changelist:"}
              </p>
              <ul className="mt-1 space-y-1">
                {changelist.map((line) => (
                  <li key={line} className="flex items-start gap-1.5 text-[11px] text-ink-dim">
                    {applied ? (
                      <Check size={11} className="mt-0.5 shrink-0 text-ok" />
                    ) : (
                      <span className="mt-0.5 shrink-0 text-ink-faint">·</span>
                    )}
                    <span>{line}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="mt-2 text-[11px] text-ink-faint">No changelist — nothing needed to change.</p>
          )}

          {result.provider ? <ProviderPanel gate={result.provider} /> : null}

          {planApplied !== null ? (
            <p className="mt-2 text-[11px] text-ink-faint">
              Plan status: <span className="font-mono">applied: {String(planApplied)}</span>
              {planApplied ? "" : " — every plan line above is a proposal only."}
            </p>
          ) : null}

          {result.note ? <p className="mt-2 text-[11px] text-ink-faint">{result.note}</p> : null}
          <p className="mt-1.5 text-[11px] text-ink-faint">
            {applied
              ? "Applied to the local timeline — Save to keep it."
              : "Plan only: the local timeline was NOT changed and nothing was persisted."}
          </p>
        </div>
      ) : null}
    </Card>
  );
}

/**
 * The five-dimension pacing read (`action: "analyzePacing"`). Deterministic
 * arithmetic on the timeline: five scores, a weighted overall and the engine's
 * own note — never an AI estimate.
 */
function PacingPanel({
  busy,
  result,
  error,
  onRun,
  onDismiss,
}: {
  busy: boolean;
  result: PacingResponse | null;
  error: string | null;
  onRun: () => void;
  onDismiss: () => void;
}) {
  const dimensions = result?.dimensions ?? null;
  const overall = typeof result?.overall === "number" ? Math.round(result.overall) : null;
  const band = typeof result?.band === "string" ? result.band : null;
  const bandHint = band ? PACE_BANDS.find((b) => b.band === band)?.hint ?? null : null;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          <Gauge size={12} /> Pacing analyzer
        </p>
        <Button size="sm" variant="outline" disabled={busy} onClick={onRun}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Activity size={13} />} Analyze pacing
        </Button>
      </div>
      <p className="mt-2 text-[11px] text-ink-faint">
        Five deterministic dimensions scored 0-100 on the timeline shown here — narration, visual coverage, music bed,
        scene-change cadence and attention. The numbers are arithmetic on the timeline itself: this panel performs no
        re-timing and invents no score. What an AI pass would need, and what is connected right now, is DERIVED by the
        engine and stated in the read-out below — never asserted here.
      </p>

      {error ? (
        <p className="mt-3 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
      ) : null}

      {result && dimensions ? (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-panel-3/40 p-2.5">
            <p className="font-display text-2xl font-semibold tracking-tight text-ink">{overall ?? 0}</p>
            <div className="min-w-0">
              <p className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.14em] text-ink-faint">
                overall <Badge tone={paceBandTone(band)}>{band ?? "unknown"}</Badge>
              </p>
              {bandHint ? <p className="mt-1 text-[11px] text-ink-faint">{bandHint}</p> : null}
            </div>
            <span className="ml-auto text-[11px] text-ink-faint">
              {result.clipCount ?? 0} clips · {formatMs(result.durationMs ?? 0)} · timeline{" "}
              {result.timelineSource === "request" ? "as shown" : "from the saved project"}
            </span>
          </div>

          <div className="space-y-2">
            {PACE_DIMENSIONS.map((id) => {
              const dim = dimensions[id];
              if (!dim) return null;
              const label = dim.label ?? dim.scoreLabel ?? PACE_DIMENSION_LABELS[id] ?? id;
              const score = Math.max(0, Math.min(100, Math.round(dim.score)));
              return (
                <div key={id} className="rounded-lg border border-line bg-panel-3/30 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-ink">
                      {label}
                      <span className="ml-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-faint">{id}</span>
                    </p>
                    <span className="font-mono text-[11px] text-ink-dim">{score}/100</span>
                  </div>
                  <div
                    className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-panel-2"
                    role="img"
                    aria-label={`${label}: ${score} of 100`}
                  >
                    <div className={`h-full rounded-full ${paceBarClass(score)}`} style={{ width: `${score}%` }} />
                  </div>
                  <p className="mt-1.5 text-[11px] text-ink-faint">{dim.reason}</p>
                </div>
              );
            })}
          </div>

          <div className="rounded-lg border border-line bg-panel-2/60 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Read-out</p>
              <button type="button" className="text-[11px] text-ink-faint hover:text-ink" onClick={onDismiss}>
                Dismiss
              </button>
            </div>
            {result.note ? <p className="mt-1.5 text-[11px] text-ink-dim">{result.note}</p> : null}
          </div>
        </div>
      ) : !error ? (
        <p className="mt-3 text-[11px] text-ink-faint">
          No analysis yet — run it to score the timeline currently in the editor.
        </p>
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Block 4 — colour system (deterministic grades + honest render gate) */
/* ------------------------------------------------------------------ */

/** One grade exactly as `action: "listGrades"` / `applyGrade` returns it. */
interface ColorGradeView {
  id: string;
  name: string;
  family: string;
  description: string;
  useWhen: string;
  hdrOnly: boolean;
  parameters: {
    contrast: number;
    saturation: number;
    temperatureK: number;
    tint: number;
    curves: { shadows: number; midtones: number; highlights: number };
    lgg: {
      lift: { r: number; g: number; b: number };
      gamma: { r: number; g: number; b: number };
      gain: { r: number; g: number; b: number };
    };
    lutEquivalent: string;
    target: {
      display: string;
      standard: string;
      transfer: string;
      peakNits: number;
      referenceWhiteNits: number;
      maxCLL: number | null;
      maxFALL: number | null;
      bitDepth: number;
      chromaSubsampling: string;
    };
  };
}

interface ColorAssignmentView {
  project: string | null;
  scenes: Record<string, string>;
}

interface ColorRenderView {
  gradeId: string;
  operations: { order: number; op: string; params: Record<string, unknown> }[];
  lut: { name: string; format: string; baked: boolean; requiresProvider: boolean };
  output: ColorGradeView["parameters"]["target"];
  providerWork: { step: string; capability: string }[];
  performed: boolean;
  note: string;
  provider?: ProviderGateView;
}

/** The Block 4 envelope — every field comes straight from the API. */
interface ColorGradeResponse extends SceneControlResponse {
  scope?: "project" | "scene";
  gradeId?: string | null;
  grade?: ColorGradeView;
  grades?: ColorGradeView[];
  assignment?: ColorAssignmentView;
  previous?: ColorAssignmentView;
  effective?: { gradeId: string | null; source: string };
  preview?: { produced: boolean; kind: string };
  render?: ColorRenderView;
  unreadable?: boolean;
}

const COLOR_SCOPE_LABELS: Record<"project" | "scene", string> = {
  project: "Whole project",
  scene: "Selected scene",
};

/** Signed 2-decimal readout for the curve offsets (0 prints unsigned). */
function signed(n: number): string {
  if (n === 0) return "0";
  return `${n > 0 ? "+" : "−"}${Math.abs(n).toFixed(2)}`;
}

/** Colour family → badge tone, so the technical grades read differently. */
function gradeFamilyTone(family: string): "neutral" | "accent" | "ok" {
  if (family === "technical") return "ok";
  if (family === "cinematic") return "accent";
  return "neutral";
}

function ColorParameterRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-line/60 py-1 last:border-b-0">
      <span className="text-[11px] text-ink-faint">{label}</span>
      <span className="text-right font-mono text-[11px] text-ink-dim">{value}</span>
    </div>
  );
}

/**
 * The Block 4 colour-grading panel.
 *
 * Everything shown here is the engine's own output: the nine grades and their
 * parameters come from `action: "listGrades"`, the assignment from the same
 * response, and every apply/reset/preview posts to `POST /api/studio/editor`.
 * A grade assignment is real metadata; the frames are NOT rendered, and the
 * render-preview path renders the honest "Provider Not Connected" gate instead
 * of pretending to produce a graded image.
 */
function ColorGradingPanel({
  grades,
  assignment,
  selectedId,
  onSelect,
  scope,
  onScope,
  sceneId,
  sceneLabel,
  busy,
  result,
  error,
  renderGate,
  onApply,
  onReset,
  onPreview,
  onReload,
  onDismiss,
}: {
  grades: ColorGradeView[];
  assignment: ColorAssignmentView | null;
  selectedId: string | null;
  onSelect: (id: string) => void;
  scope: "project" | "scene";
  onScope: (s: "project" | "scene") => void;
  sceneId: string | null;
  sceneLabel: string | null;
  busy: string | null;
  result: ColorGradeResponse | null;
  error: string | null;
  /** The standing gate the catalogue reports — shown before any render click. */
  renderGate: ProviderGateView | null;
  onApply: () => void;
  onReset: () => void;
  onPreview: () => void;
  onReload: () => void;
  onDismiss: () => void;
}) {
  const projectGrade = assignment?.project ?? null;
  const sceneGrade = scope === "scene" && sceneId ? assignment?.scenes?.[sceneId] ?? null : null;
  const effectiveGradeId = scope === "scene" ? sceneGrade ?? projectGrade : projectGrade;
  const selected = grades.find((g) => g.id === selectedId) ?? null;
  const gate = result?.provider ?? null;
  const inlineGate = result?.render?.provider ?? null;
  const operationallyBusy = busy !== null;
  const canTargetScene = scope === "project" || Boolean(sceneId);

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          <Palette size={12} /> Color grading
        </p>
        <span className="flex items-center gap-2 text-[11px] text-ink-faint">
          {effectiveGradeId ? (
            <>
              in effect: <span className="font-mono text-ink-dim">{effectiveGradeId}</span>
            </>
          ) : (
            "no grade applied"
          )}
          <button type="button" className="text-ink-faint hover:text-ink" onClick={onReload} disabled={operationallyBusy}>
            <RefreshCw size={12} />
          </button>
        </span>
      </div>
      <p className="mt-2 text-[11px] text-ink-faint">
        Nine deterministic grades. Applying one records the assignment and resolves the exact parameter set the renderer
        would consume — contrast, saturation, temperature/tint, lift/gamma/gain, the LUT-equivalent transform and the
        delivery target. No frames are decoded or graded here: that needs a video-processing provider, so the preview
        control returns an honest gate instead of a picture.
      </p>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {grades.map((grade) => {
          const isSelected = grade.id === selectedId;
          const isApplied = grade.id === effectiveGradeId;
          return (
            <button
              key={grade.id}
              type="button"
              disabled={operationallyBusy}
              onClick={() => onSelect(grade.id)}
              title={grade.useWhen}
              className={`flex flex-col gap-1 rounded-lg border px-2.5 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                isApplied
                  ? "border-ok/40 bg-ok/10 text-ink"
                  : isSelected
                    ? "border-accent-line bg-accent-soft text-ink"
                    : "border-line bg-panel-3/50 text-ink-dim hover:border-accent-line hover:text-ink"
              }`}
            >
              <span className="flex items-center gap-1.5 text-[11px] font-medium">
                {isApplied ? <Check size={13} className="shrink-0 text-ok" /> : <Palette size={13} className="shrink-0" />}
                <span className="truncate">{grade.name}</span>
                {isApplied ? (
                  <Badge tone="ok" className="ml-auto shrink-0">
                    applied
                  </Badge>
                ) : null}
              </span>
              <span className="flex items-center gap-1.5">
                <span className="font-mono text-[10px] text-ink-faint">{grade.id}</span>
                <Badge tone={gradeFamilyTone(grade.family)} className="shrink-0">
                  {grade.family}
                </Badge>
                {grade.hdrOnly ? (
                  <Badge tone="danger" className="shrink-0">
                    HDR only
                  </Badge>
                ) : null}
              </span>
              <span className="line-clamp-2 text-[10px] leading-snug text-ink-faint">{grade.description}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex flex-wrap items-end gap-2">
        <div>
          <Label htmlFor="color-scope">Apply to</Label>
          <select
            id="color-scope"
            className="h-9 rounded-lg border border-line bg-panel-3/60 px-2 text-xs text-ink"
            value={scope}
            onChange={(e) => onScope(e.target.value as "project" | "scene")}
            disabled={operationallyBusy}
          >
            <option value="project">{COLOR_SCOPE_LABELS.project}</option>
            <option value="scene">{COLOR_SCOPE_LABELS.scene}</option>
          </select>
        </div>
        <Button
          size="sm"
          variant="primary"
          disabled={!selected || !canTargetScene || operationallyBusy}
          onClick={onApply}
          title={canTargetScene ? "Record this grade at the chosen scope" : "Select a scene first"}
        >
          {busy === "applyGrade" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Apply grade
        </Button>
        <Button size="sm" variant="outline" disabled={!canTargetScene || operationallyBusy} onClick={onReset}>
          {busy === "resetGrade" ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />} Reset to none
        </Button>
        <Button size="sm" variant="outline" disabled={!selected || operationallyBusy} onClick={onPreview}>
          {busy === "renderGradePreview" ? <Loader2 size={13} className="animate-spin" /> : <Film size={13} />} Render
          preview
        </Button>
        <span className="text-[11px] text-ink-faint">
          target:{" "}
          {scope === "project"
            ? "whole project"
            : sceneId
              ? sceneLabel ?? sceneId
              : "no scene selected"}
        </span>
      </div>

      {selected ? (
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-line bg-panel-3/40 p-2.5">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
              <Info size={12} /> {selected.name}
            </p>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-dim">{selected.description}</p>
            <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
              <span className="uppercase tracking-wider">Use when</span> — {selected.useWhen}
            </p>
          </div>
          <div className="rounded-lg border border-line bg-panel-3/40 p-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
              Parameters (as the renderer would receive them)
            </p>
            <div className="mt-2">
              <ColorParameterRow label="contrast ×" value={selected.parameters.contrast.toFixed(2)} />
              <ColorParameterRow label="saturation ×" value={selected.parameters.saturation.toFixed(2)} />
              <ColorParameterRow
                label="temperature"
                value={`${signed(selected.parameters.temperatureK)} K`}
              />
              <ColorParameterRow label="tint" value={signed(selected.parameters.tint)} />
              <ColorParameterRow
                label="shadows / midtones / highlights"
                value={`${signed(selected.parameters.curves.shadows)} / ${signed(selected.parameters.curves.midtones)} / ${signed(
                  selected.parameters.curves.highlights,
                )}`}
              />
              <ColorParameterRow
                label="lift (r/g/b)"
                value={`${selected.parameters.lgg.lift.r.toFixed(3)} / ${selected.parameters.lgg.lift.g.toFixed(3)} / ${selected.parameters.lgg.lift.b.toFixed(3)}`}
              />
              <ColorParameterRow
                label="gamma / gain"
                value={`${selected.parameters.lgg.gamma.g.toFixed(2)} / ${selected.parameters.lgg.gain.r.toFixed(2)}`}
              />
              <ColorParameterRow label="LUT equivalent" value={selected.parameters.lutEquivalent} />
              <ColorParameterRow
                label="target display"
                value={`${selected.parameters.target.display} · ${selected.parameters.target.standard}`}
              />
              <ColorParameterRow label="transfer" value={selected.parameters.target.transfer} />
              <ColorParameterRow
                label="peak / reference white"
                value={`${selected.parameters.target.peakNits} / ${selected.parameters.target.referenceWhiteNits} nits`}
              />
              {selected.parameters.target.maxCLL !== null ? (
                <ColorParameterRow
                  label="maxCLL / maxFALL"
                  value={`${selected.parameters.target.maxCLL} / ${selected.parameters.target.maxFALL ?? 0} nits`}
                />
              ) : null}
              <ColorParameterRow
                label="bit depth / chroma"
                value={`${selected.parameters.target.bitDepth}-bit ${selected.parameters.target.chromaSubsampling}`}
              />
            </div>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-[11px] text-ink-faint">
          {grades.length === 0
            ? "Loading the grade catalogue…"
            : "Pick a grade above to see its parameters and when to use it."}
        </p>
      )}

      {error ? (
        <p className="mt-3 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
      ) : null}

      {result ? (
        <div className="mt-3 rounded-lg border border-line bg-panel-3/40 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
              <ListChecks size={12} /> {result.action ?? "Colour result"}
              <Badge tone={result.changed ? "ok" : "neutral"}>
                {result.changed ? "assignment changed" : "nothing changed"}
              </Badge>
            </p>
            <button type="button" className="text-[11px] text-ink-faint hover:text-ink" onClick={onDismiss}>
              Dismiss
            </button>
          </div>

          {(result.changelist ?? []).length > 0 ? (
            <ul className="mt-2 space-y-1">
              {(result.changelist ?? []).map((line) => (
                <li key={line} className="text-[11px] text-ink-dim">
                  · {line}
                </li>
              ))}
            </ul>
          ) : null}

          {result.render ? (
            <div className="mt-2 rounded-lg border border-line bg-panel-2/60 p-2">
              <p className="text-[11px] text-ink">
                Render plan: <span className="font-mono">{result.render.operations.length}</span> steps · LUT{" "}
                <span className="font-mono">{result.render.lut.name}</span>{" "}
                <Badge tone={result.render.lut.baked ? "ok" : "neutral"}>{result.render.lut.baked ? "baked" : "not baked"}</Badge>
              </p>
              <p className="mt-1 text-[11px] text-ink-faint">
                Output: {result.render.output.display} · {result.render.output.standard} · {result.render.output.transfer} ·{" "}
                {result.render.output.peakNits} nits peak · {result.render.output.bitDepth}-bit
              </p>
              <p className="mt-1 text-[11px] text-ink-faint">{result.render.note}</p>
              <ul className="mt-1 space-y-0.5">
                {result.render.providerWork.map((w) => (
                  <li key={w.step} className="text-[11px] text-ink-faint">
                    · needs a provider: {w.step} <span className="font-mono text-[10px]">{w.capability}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {inlineGate ? <ProviderPanel gate={inlineGate} /> : null}
          {result.note ? <p className="mt-2 text-[11px] text-ink-faint">{result.note}</p> : null}
        </div>
      ) : null}

      {gate ? (
        <div className="mt-3">
          <ProviderNotConnected providerKeys={gate.requiredEnv} note={gate.note} />
        </div>
      ) : renderGate && !result ? (
        // The standing state before any render click: the catalogue itself says
        // real pixel work needs a provider.
        <ProviderPanel gate={renderGate} />
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Block 5a — long-form → shorts repurposing                           */
/* ------------------------------------------------------------------ */

/** One scored moment candidate, exactly as `listShortsMoments` returns it. */
interface ShortsMomentView {
  id: string;
  kind: string;
  sceneId: string;
  sceneIndex: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  durationSeconds: number;
  title: string;
  text: string;
  score: number;
  reason: string;
  signals: { signal: string; points: number; detail: string }[];
  watchedFootage: boolean;
  basis: string;
}

/** One platform target's plan (count vs produced, the windows it used, its note). */
interface ShortsTargetPlanView {
  target: string;
  enabled: boolean;
  count: number;
  produced: number;
  minSeconds: number;
  maxSeconds: number;
  kinds: string[];
  momentKinds: string[];
  considered: number;
  skippedOverlap: number;
  aspect: string;
  note: string;
}

/** One clip window, exactly as the engine produced it. */
interface ShortsClipView {
  id: string;
  target: string;
  rank: number;
  label: string;
  clipKind: string;
  clipKindLabel: string;
  momentKind: string;
  momentKindLabel: string;
  momentId: string;
  score: number;
  reason: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  durationSeconds: number;
  scenes: string[];
  sourceClips: number;
  windowSeconds: { min: number; max: number };
  aspect: string;
}

interface ShortsTargetConfigEntry {
  enabled: boolean;
  count: number;
  minSeconds: number;
  maxSeconds: number;
  kinds: string[];
  label?: string;
  aspect?: string;
  totalSecondsWindow?: string;
}

interface ShortsConfigView {
  format: string;
  version: number;
  targets: Record<string, ShortsTargetConfigEntry>;
}

/** The persisted set as the API reports it (`applied` / `previous`). */
interface ShortsAssignmentView {
  applied?: boolean;
  appliedAt: string | null;
  timelineMs: number;
  clipCount: number;
  byTarget: Record<string, number>;
  byKind: Record<string, number>;
  totalMs: number;
  targetsUsed: Record<string, ShortsTargetConfigEntry>;
  clips: ShortsClipView[];
}

/** The Block 5a envelope — every value below comes straight from the API. */
interface RepurposeResponse extends Omit<SceneControlResponse, "timelineSource"> {
  action?: string;
  /** "saved" when the plan used the stored editor timeline, "scenes" when rebuilt. */
  timelineSource?: "saved" | "scenes";
  basis?: string;
  watchedFootage?: boolean;
  momentCount?: number;
  returned?: number;
  candidateLimit?: number;
  countsByKind?: Record<string, number>;
  units?: { units: number; narratedUnits: number; structuralOnlyUnits: number };
  pacing?: { attention: number; narration: number; cadence: number };
  config?: ShortsConfigView;
  configSource?: "request" | "applied" | "default";
  configChanges?: string[];
  moments?: ShortsMomentView[];
  targets?: ShortsTargetPlanView[];
  clips?: ShortsClipView[];
  clipStats?: { total: number; byTarget: Record<string, number>; byKind: Record<string, number>; totalMs: number };
  totalClips?: number;
  timelineMs?: number;
  applied?: ShortsAssignmentView | null;
  previous?: ShortsAssignmentView | null;
  unreadable?: boolean;
}

const SHORTS_ACTIONS = ["listShortsMoments", "configureShortsTargets", "applyShorts", "clearShorts"] as const;
type ShortsAction = (typeof SHORTS_ACTIONS)[number];

/** The editable form of a platform target config (the shape the API accepts). */
type ShortsTargetDraft = Record<
  string,
  { enabled: boolean; count: number; minSeconds: number; maxSeconds: number; kinds: string[] }
>;

/** Seed the editable form from the config the API reported (values verbatim). */
function draftFromConfig(config: ShortsConfigView | undefined): ShortsTargetDraft | null {
  if (!config?.targets) return null;
  const out: ShortsTargetDraft = {};
  for (const target of PLATFORM_TARGETS) {
    const entry = config.targets[target];
    if (!entry) continue;
    out[target] = {
      enabled: entry.enabled,
      count: entry.count,
      minSeconds: entry.minSeconds,
      maxSeconds: entry.maxSeconds,
      kinds: [...entry.kinds],
    };
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** Target id → badge tone, so the three output sets read differently. */
function targetTone(target: string): "neutral" | "accent" | "ok" {
  if (target === "shorts") return "accent";
  if (target === "reels") return "ok";
  return "neutral";
}

/** Moment kind → badge tone (the analysis kinds, not the clip kinds). */
function momentTone(kind: string): "neutral" | "accent" | "ok" | "danger" {
  if (kind === "hook" || kind === "quote") return "accent";
  if (kind === "stat" || kind === "informative") return "ok";
  if (kind === "surprise" || kind === "emotional") return "danger";
  return "neutral";
}

function ShortsConfigField({
  label,
  value,
  disabled,
  onChange,
  suffix,
}: {
  label: string;
  value: number;
  disabled: boolean;
  onChange: (n: number) => void;
  suffix?: string;
}) {
  return (
    <label className="flex flex-col gap-1">
      {/* The unit sits in the label, not beside the field: inside a three-up card
          the sibling span plus its gap cost ~9px of the column, which is what the
          digits themselves needed. */}
      <span className="text-[10px] uppercase tracking-wider text-ink-faint">
        {label}
        {suffix ? <span className="normal-case"> {suffix}</span> : null}
      </span>
      {/* A compact number field rather than the shared <Input>: the shared input
          reserves px-3.5 of horizontal padding (28px across both sides), which
          inside a three-up card left a ~29px text box and pushed real two-digit
          values under that padding, clipping them. Every pixel of the column goes
          to the digits here. */}
      <input
        type="number"
        value={Number.isFinite(value) ? value : 0}
        disabled={disabled}
        onChange={(e) => {
          const n = Number(e.target.value);
          onChange(Number.isFinite(n) ? Math.trunc(n) : 0);
        }}
        className="no-spinner h-8 w-full min-w-0 rounded-lg border border-line bg-panel-3/60 px-1.5 text-xs tabular-nums text-ink transition-colors duration-150 focus:border-accent-line focus:outline-none focus:ring-2 focus:ring-accent/20 disabled:opacity-50"
      />
    </label>
  );
}

/**
 * The Block 5a repurposing panel.
 *
 * Everything rendered here is the engine's own output: the scored moment
 * candidates (kind, score, duration and the engine's reason VERBATIM), the clip
 * windows per platform target and the config that was used — all of it read from
 * `POST /api/studio/editor` actions `listShortsMoments` /
 * `configureShortsTargets` / `applyShorts` / `clearShorts`. The platform target
 * form really drives the engine: the values it POSTs are the counts, duration
 * windows and clip kinds the clip plan is built from.
 *
 * Honest by construction: no thumbnail, preview frame or transcript is invented;
 * media analysis and the actual cutting/reframing/encoding are provider paths, so
 * they render as "Provider Not Connected" with env var NAMES and change nothing.
 */
function RepurposePanel({
  result,
  busy,
  error,
  draft,
  standingGate,
  onDraft,
  onRun,
  onUseDefaults,
  onDismiss,
}: {
  result: RepurposeResponse | null;
  /** The action currently in flight, or null. */
  busy: string | null;
  error: string | null;
  /** The editable platform targets (null until the API has reported them). */
  draft: ShortsTargetDraft | null;
  /** The standing analysis gate the last read reported. */
  standingGate: ProviderGateView | null;
  onDraft: (next: ShortsTargetDraft) => void;
  onRun: (action: ShortsAction) => void;
  onUseDefaults: () => void;
  onDismiss: () => void;
}) {
  const operationallyBusy = busy !== null;
  const moments = result?.moments ?? [];
  const targets = result?.targets ?? [];
  const clips = result?.clips ?? [];
  const applied = result?.applied ?? null;
  const previous = result?.previous ?? null;
  const analysisGate = result?.provider ?? null;
  const renderGate = (result?.plan?.["render"] as ProviderGateView | undefined) ?? null;
  const configSource = result?.configSource ?? null;

  const setTarget = (target: string, patch: Partial<ShortsTargetDraft[string]>) => {
    if (!draft) return;
    onDraft({ ...draft, [target]: { ...draft[target], ...patch } });
  };

  const toggleKind = (target: string, kind: string) => {
    if (!draft) return;
    const current = draft[target].kinds;
    setTarget(target, { kinds: current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind] });
  };

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          <Scissors size={12} /> Repurpose to shorts
        </p>
        <span className="flex items-center gap-2 text-[11px] text-ink-faint">
          {applied ? (
            <>
              applied set: <span className="font-mono text-ink-dim">{applied.clipCount} clip(s)</span>
            </>
          ) : (
            "no set applied"
          )}
          {configSource ? <Badge tone="neutral">config: {configSource}</Badge> : null}
          <button
            type="button"
            className="text-ink-faint hover:text-ink"
            title="Re-read the moment candidates and the clip plan"
            onClick={() => onRun("listShortsMoments")}
            disabled={operationallyBusy}
          >
            <RefreshCw size={12} />
          </button>
        </span>
      </div>
      <p className="mt-2 text-[11px] text-ink-faint">
        Scores the timeline and the script into moment candidates (hook, emotional, surprise, quote, stat, informative)
        and turns them into concrete clip windows for Shorts, Reels and TikToks. The numbers are arithmetic on the
        narration text and the timeline structure — the footage is never analysed, no transcript exists and every score is
        the sum of the signals listed with it. The clip windows are recorded as metadata; nothing is cut, reframed or
        encoded here.
      </p>

      {/* ------------------------------------------- platform targets ---- */}
      <div className="mt-3 rounded-lg border border-line bg-panel-3/30 p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Platform targets</p>
          <button
            type="button"
            className="text-[11px] text-ink-faint hover:text-ink"
            onClick={onUseDefaults}
            disabled={operationallyBusy}
          >
            Reset to engine defaults
          </button>
        </div>
        {draft ? (
          <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-3">
            {PLATFORM_TARGETS.map((target) => {
              const spec = draft[target];
              if (!spec) return null;
              const entry = result?.config?.targets[target];
              return (
                <div key={target} className="rounded-lg border border-line bg-panel-2/50 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <p className="flex items-center gap-1.5 text-[11px] font-medium text-ink">
                      {PLATFORM_LABELS[target]}
                      <Badge tone={targetTone(target)}>{entry?.aspect ?? "9:16"}</Badge>
                    </p>
                    <label className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-ink-faint">
                      <input
                        type="checkbox"
                        checked={spec.enabled}
                        disabled={operationallyBusy}
                        onChange={(e) => setTarget(target, { enabled: e.target.checked })}
                      />
                      on
                    </label>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-1.5">
                    <ShortsConfigField
                      label="count"
                      value={spec.count}
                      disabled={operationallyBusy}
                      onChange={(n) => setTarget(target, { count: n })}
                    />
                    <ShortsConfigField
                      label="min"
                      value={spec.minSeconds}
                      disabled={operationallyBusy}
                      onChange={(n) => setTarget(target, { minSeconds: n })}
                      suffix="s"
                    />
                    <ShortsConfigField
                      label="max"
                      value={spec.maxSeconds}
                      disabled={operationallyBusy}
                      onChange={(n) => setTarget(target, { maxSeconds: n })}
                      suffix="s"
                    />
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="text-[10px] uppercase tracking-wider text-ink-faint">clip kinds</span>
                    {CLIP_KINDS.map((kind) => (
                      <label key={kind} className="flex items-center gap-1 text-[10px] text-ink-dim">
                        <input
                          type="checkbox"
                          checked={spec.kinds.includes(kind)}
                          disabled={operationallyBusy}
                          onChange={() => toggleKind(target, kind)}
                        />
                        {CLIP_KIND_LABELS[kind]}
                      </label>
                    ))}
                  </div>
                  {entry?.totalSecondsWindow ? (
                    <p className="mt-1.5 font-mono text-[10px] text-ink-faint">
                      engine config in force: {entry.count} × {entry.totalSecondsWindow}
                    </p>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : (
          <p className="mt-2 text-[11px] text-ink-faint">Loading the engine's platform targets…</p>
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={operationallyBusy} onClick={() => onRun("listShortsMoments")}>
          {busy === "listShortsMoments" ? <Loader2 size={13} className="animate-spin" /> : <Activity size={13} />}{" "}
          Analyse moments
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={operationallyBusy || !draft}
          onClick={() => onRun("configureShortsTargets")}
        >
          {busy === "configureShortsTargets" ? <Loader2 size={13} className="animate-spin" /> : <Shuffle size={13} />}{" "}
          Preview set
        </Button>
        <Button size="sm" variant="primary" disabled={operationallyBusy || !draft} onClick={() => onRun("applyShorts")}>
          {busy === "applyShorts" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Apply set
        </Button>
        <Button size="sm" variant="outline" disabled={operationallyBusy || !applied} onClick={() => onRun("clearShorts")}>
          {busy === "clearShorts" ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Clear set
        </Button>
        <span className="text-[11px] text-ink-faint">
          {result ? `${clips.length} clip window(s) · ${targets.length} target(s)` : "not analysed yet"}
        </span>
      </div>

      {error ? (
        <p className="mt-3 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
      ) : null}

      {result ? (
        <div className="mt-3 space-y-3">
          {/* --------------------------------------- analysis summary ---- */}
          <div className="rounded-lg border border-line bg-panel-3/40 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                <ListChecks size={12} /> {result.action ?? "Repurposing result"}
                <Badge tone={result.totalClips ? "accent" : "neutral"}>
                  {result.totalClips ?? 0} clip window(s)
                </Badge>
                {result.unreadable ? <Badge tone="danger">stored set unreadable</Badge> : null}
              </p>
              <button type="button" className="text-[11px] text-ink-faint hover:text-ink" onClick={onDismiss}>
                Dismiss
              </button>
            </div>
            <p className="mt-2 text-[11px] text-ink-faint">
              {result.returned ?? moments.length} of {result.momentCount ?? moments.length} candidate moment(s) shown
              (limit {result.candidateLimit ?? "—"}) · {result.units?.units ?? 0} timeline unit(s) ·{" "}
              {result.units?.narratedUnits ?? 0} narrated · {result.timelineMs ?? 0} ms of timeline · timeline{" "}
              {result.timelineSource === "saved" ? "from the saved project" : "rebuilt from the scenes"}
            </p>
            {result.countsByKind ? (
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {MOMENT_KINDS.map((kind) => (
                  <Badge key={kind} tone={momentTone(kind)}>
                    {MOMENT_LABELS[kind]} {result.countsByKind?.[kind] ?? 0}
                  </Badge>
                ))}
              </div>
            ) : null}
            {applied ? (
              <p className="mt-2 text-[11px] text-ink-dim">
                Applied set — {applied.clipCount} clip(s) · {formatMs(applied.totalMs)} of source · timeline{" "}
                {formatMs(applied.timelineMs)} · recorded {applied.appliedAt ?? "unknown"}
              </p>
            ) : previous ? (
              <p className="mt-2 text-[11px] text-ink-faint">
                Previous set ({previous.clipCount} clip(s)) is no longer applied.
              </p>
            ) : null}
          </div>

          {/* ---------------------------------- moment candidates ---- */}
          <div className="rounded-lg border border-line bg-panel-3/40 p-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Moment candidates</p>
            {moments.length === 0 ? (
              <p className="mt-2 text-[11px] text-ink-faint">
                No moment cleared the score floor — nothing was invented to fill the list.
              </p>
            ) : (
              <ul className="mt-2 space-y-2">
                {moments.map((m) => (
                  <li key={m.id} className="rounded-lg border border-line bg-panel-2/50 p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={momentTone(m.kind)}>
                        {MOMENT_LABELS[m.kind as keyof typeof MOMENT_LABELS] ?? m.kind}
                      </Badge>
                      <span className="font-mono text-[10px] text-ink-faint">{m.id}</span>
                      <span className="truncate text-[11px] text-ink">{m.title}</span>
                      <span className="ml-auto flex items-center gap-2">
                        <span className="font-mono text-[11px] text-ink-dim">{m.score}/100</span>
                        <span className="text-[11px] text-ink-faint">
                          {formatMs(m.startMs)}–{formatMs(m.endMs)} · {m.durationSeconds}s
                        </span>
                      </span>
                    </div>
                    <div
                      className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-panel-3"
                      role="img"
                      aria-label={`score ${m.score} of 100`}
                    >
                      <div
                        className={`h-full rounded-full ${m.score >= 75 ? "bg-ok" : m.score >= 50 ? "bg-accent" : "bg-danger"}`}
                        style={{ width: `${Math.max(0, Math.min(100, m.score))}%` }}
                      />
                    </div>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-ink-dim">{m.reason}</p>
                    {m.signals.length > 0 ? (
                      <ul className="mt-1.5 space-y-0.5">
                        {m.signals.map((s) => (
                          <li key={s.signal} className="text-[10px] text-ink-faint">
                            · {s.signal} <span className="font-mono">+{s.points}</span> — {s.detail}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {m.watchedFootage === false ? (
                      <p className="mt-1 text-[10px] text-ink-faint">
                        basis: {m.basis} · the footage was not analysed
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* ------------------------------------------ clip plan ---- */}
          <div className="rounded-lg border border-line bg-panel-3/40 p-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Clip windows</p>
            <div className="mt-2 space-y-2">
              {targets.map((t) => {
                const forTarget = clips.filter((c) => c.target === t.target);
                return (
                  <div key={t.target} className="rounded-lg border border-line bg-panel-2/50 p-2.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] text-ink">
                        {PLATFORM_LABELS[t.target as keyof typeof PLATFORM_LABELS] ?? t.target}
                      </span>
                      <Badge tone={t.enabled ? targetTone(t.target) : "neutral"}>
                        {t.enabled ? `${t.produced}/${t.count} clip(s)` : "off"}
                      </Badge>
                      <span className="text-[11px] text-ink-faint">
                        {t.minSeconds}-{t.maxSeconds}s · kinds {t.kinds.join(", ")} · {t.considered} eligible ·{" "}
                        {t.skippedOverlap} skipped
                      </span>
                      <span className="ml-auto font-mono text-[10px] text-ink-faint">{t.aspect}</span>
                    </div>
                    <p className="mt-1.5 text-[11px] text-ink-faint">{t.note}</p>
                    {forTarget.length > 0 ? (
                      <ul className="mt-1.5 space-y-1.5">
                        {forTarget.map((c) => (
                          <li key={c.id} className="rounded border border-line/70 bg-panel-3/50 p-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-[10px] text-ink-faint">{c.id}</span>
                              <span className="truncate text-[11px] text-ink">{c.label}</span>
                              <Badge tone={momentTone(c.momentKind)}>{c.momentKindLabel}</Badge>
                              <Badge tone="neutral">{c.clipKindLabel}</Badge>
                              <span className="ml-auto text-[11px] text-ink-faint">
                                {formatMs(c.startMs)}–{formatMs(c.endMs)} · {c.durationSeconds}s · {c.aspect} ·{" "}
                                {c.scenes.length} scene(s) · {c.sourceClips} source clip(s) · score {c.score}
                              </span>
                            </div>
                            <p className="mt-1 text-[10px] text-ink-faint">{c.reason}</p>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
            </div>
            {renderGate ? <ProviderPanel gate={renderGate} /> : null}
          </div>

          {result.note ? <p className="text-[11px] text-ink-faint">{result.note}</p> : null}
        </div>
      ) : null}

      {analysisGate && analysisGate.connected === false ? (
        <div className="mt-3">
          <ProviderNotConnected providerKeys={analysisGate.requiredEnv} note={analysisGate.note} />
        </div>
      ) : standingGate && !result ? (
        <ProviderPanel gate={standingGate} />
      ) : null}
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Clip inspector                                                      */
/* ------------------------------------------------------------------ */

function ClipInspector({
  clip,
  timeline,
  playheadMs,
  onOp,
}: {
  clip: Clip;
  timeline: Timeline;
  playheadMs: number;
  onOp: (fn: (t: Timeline) => { timeline: Timeline; changed: boolean }) => void;
}) {
  const [name, setName] = useState(clip.name);
  const [startMs, setStartMs] = useState(String(clip.startMs));
  const [endMs, setEndMs] = useState(String(clip.endMs));
  const [sourceRef, setSourceRef] = useState(clip.sourceRef ?? "");
  const [moveTrack, setMoveTrack] = useState<TrackId>(clip.trackId);
  const [moveStart, setMoveStart] = useState(String(clip.startMs));
  const [durationMs, setDurationMs] = useState(String(clip.endMs - clip.startMs));

  const audio = isAudioTrack(clip.trackId);
  const canSplit = playheadMs > clip.startMs && playheadMs < clip.endMs;
  const numberOf = (v: string): number | null => {
    const n = Number(v);
    return v.trim() !== "" && Number.isFinite(n) ? n : null;
  };

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="clip-name">Clip</Label>
        <Input
          id="clip-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => {
            if (name.trim() && name.trim() !== clip.name) onOp((t) => replaceClip(t, { clipId: clip.id, name }));
          }}
        />
        <p className="mt-1.5 text-[11px] text-ink-faint">
          {clip.id} · {TRACKS.find((t) => t.id === clip.trackId)?.label ?? clip.trackId}
          {clip.sceneId ? ` · scene ${clip.sceneId}` : ""}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="clip-start">Trim start (ms)</Label>
          <Input id="clip-start" inputMode="numeric" value={startMs} onChange={(e) => setStartMs(e.target.value)} />
          <p className="mt-1 text-[11px] text-ink-faint">{formatMs(Number(startMs) || 0)}</p>
        </div>
        <div>
          <Label htmlFor="clip-end">Trim end (ms)</Label>
          <Input id="clip-end" inputMode="numeric" value={endMs} onChange={(e) => setEndMs(e.target.value)} />
          <p className="mt-1 text-[11px] text-ink-faint">{formatMs(Number(endMs) || 0)}</p>
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        onClick={() => {
          const s = numberOf(startMs);
          const e = numberOf(endMs);
          onOp((t) =>
            trimClip(t, {
              clipId: clip.id,
              ...(s !== null ? { startMs: s } : {}),
              ...(e !== null ? { endMs: e } : {}),
            }),
          );
        }}
      >
        <Scissors size={13} /> Apply trim
      </Button>

      <div className="grid grid-cols-2 gap-2">
        <Button size="sm" variant="outline" disabled={!canSplit} onClick={() => onOp((t) => splitClip(t, { clipId: clip.id, atMs: playheadMs }))}>
          <Scissors size={13} /> Split
        </Button>
        <Button size="sm" variant="outline" onClick={() => onOp((t) => duplicateClip(t, { clipId: clip.id }))}>
          <Copy size={13} /> Duplicate
        </Button>
        <Button size="sm" variant="outline" onClick={() => onOp((t) => deleteClip(t, { clipId: clip.id }))}>
          <Trash2 size={13} /> Delete
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onOp((t) => replaceClip(t, { clipId: clip.id, sourceRef: sourceRef.trim() ? sourceRef : null }))}>
          Replace source
        </Button>
      </div>
      {!canSplit ? (
        <p className="text-[11px] text-ink-faint">Move the playhead inside the clip ({formatMs(clip.startMs)} – {formatMs(clip.endMs)}) to split it.</p>
      ) : (
        <p className="text-[11px] text-ink-faint">Split at the playhead: {formatMs(playheadMs)}.</p>
      )}

      <div>
        <Label htmlFor="clip-source">Replace — source reference</Label>
        <Input
          id="clip-source"
          value={sourceRef}
          placeholder="asset id, URL or scene:<id>"
          onChange={(e) => setSourceRef(e.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <Label htmlFor="clip-track">Move to track</Label>
          <select
            id="clip-track"
            value={moveTrack}
            onChange={(e) => setMoveTrack(e.target.value as TrackId)}
            className="h-10 w-full rounded-xl border border-line bg-panel-3/60 px-3 text-sm text-ink"
          >
            {TRACKS.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="clip-move-start">Start (ms)</Label>
          <Input id="clip-move-start" inputMode="numeric" value={moveStart} onChange={(e) => setMoveStart(e.target.value)} />
        </div>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="w-full"
        onClick={() => {
          const ms = numberOf(moveStart);
          if (ms === null) return;
          onOp((t) => reorderClip(t, { clipId: clip.id, trackId: moveTrack, startMs: ms }));
        }}
      >
        Move clip
      </Button>
      {isSequentialTrack(moveTrack) ? (
        <p className="text-[11px] text-ink-faint">
          {TRACKS.find((t) => t.id === moveTrack)?.label} is a sequential track — clips snap to the first free slot.
        </p>
      ) : null}

      <div>
        <Label htmlFor="clip-duration">Duration (ms)</Label>
        <div className="flex items-center gap-2">
          <Input id="clip-duration" inputMode="numeric" value={durationMs} onChange={(e) => setDurationMs(e.target.value)} />
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const ms = numberOf(durationMs);
              if (ms === null) return;
              onOp((t) => changeDuration(t, { clipId: clip.id, durationMs: ms }));
            }}
          >
            Set
          </Button>
        </div>
        <p className="mt-1 text-[11px] text-ink-faint">Current: {formatMs(clip.endMs - clip.startMs)}</p>
      </div>

      {audio ? (
        <div>
          <Label htmlFor="clip-gain">Volume — {Math.round((clip.gain ?? 1) * 100)}%</Label>
          <input
            id="clip-gain"
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={clip.gain ?? 1}
            onChange={(e) => onOp((t) => adjustVolume(t, { clipId: clip.id, gain: Number(e.target.value) }))}
            className="w-full accent-[var(--color-accent,#e8b45a)]"
          />
          <p className="text-[11px] text-ink-faint">Gain applies to voice, music and SFX clips (0–1, clamped).</p>
        </div>
      ) : (
        <p className="text-[11px] text-ink-faint">Volume is only available on the audio tracks (Voice, Music, SFX).</p>
      )}

      <div>
        <Label htmlFor="clip-transition">Transition — outgoing edge</Label>
        <Input
          id="clip-transition"
          value={describeTransition(clip.transition ?? null)}
          disabled
          readOnly
        />
        {clip.transition ? (
          <Button
            size="sm"
            variant="outline"
            className="mt-2 w-full"
            onClick={() => onOp((t) => removeTransition(t, { clipId: clip.id }))}
          >
            <X size={13} /> Remove transition
          </Button>
        ) : (
          <p className="mt-1.5 text-[11px] text-ink-faint">
            No transition recorded on this clip. Set one from the Scene controls panel (Change Transition) or the
            toolbar (Add Auto Transitions).
          </p>
        )}
        {clip.transition && clip.transition.kind !== "cut" ? (
          <p className="mt-1.5 text-[11px] text-ink-faint">
            A transition describes how this clip hands off to the next clip on the same track. A lane never opens on a
            blend — the auto policy always starts on a hard cut.
          </p>
        ) : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Editor                                                              */
/* ------------------------------------------------------------------ */

export function EditorClient({
  projectId,
  projectTitle,
  initialTimeline,
  initialSource,
  scenes,
}: {
  projectId: string;
  projectTitle: string;
  initialTimeline: Timeline;
  initialSource: "saved" | "scenes";
  scenes: SceneInput[];
}) {
  const [history, setHistory] = useState<EditorHistory>(() => createHistory(initialTimeline));
  const historyRef = useRef(history);
  historyRef.current = history;
  const timeline = history.present;

  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(
    initialSource === "saved"
      ? "Loaded the saved editor timeline."
      : "No saved timeline yet — built deterministically from the project's scenes.",
  );
  const [error, setError] = useState<string | null>(null);

  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [playheadMs, setPlayheadMs] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [pxPerMs, setPxPerMs] = useState(0.08);

  const [manualScenes, setManualScenes] = useState<SceneInput[]>([]);
  const [activeSceneId, setActiveSceneId] = useState<string | null>(scenes[0]?.id ?? null);

  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [versionNote, setVersionNote] = useState("");
  const [versionBusy, setVersionBusy] = useState(false);

  /* ------------------------------------------- Block 2 scene controls */
  const [controlBusy, setControlBusy] = useState<SceneControlName | null>(null);
  const [controlResult, setControlResult] = useState<SceneControlResponse | null>(null);
  const [controlApplied, setControlApplied] = useState(false);
  const [controlError, setControlError] = useState<string | null>(null);
  const [autoBusy, setAutoBusy] = useState(false);
  const [transitionKind, setTransitionKind] = useState<TransitionKind>("dissolve");
  const [subtitleStyleId, setSubtitleStyleId] = useState<string>(SUBTITLE_STYLES[0]?.id ?? "minimal");
  const [musicMood, setMusicMood] = useState<string>("calm");
  const [musicEnergy, setMusicEnergy] = useState(40);
  const [grade, setGrade] = useState<string>(COLOR_GRADE_HINTS[1] ?? "neutral");

  /* ------------------------------- Block 3b auto-editor + pacing analyzer */
  const [autoEditBusy, setAutoEditBusy] = useState<AutoEditorCommand | null>(null);
  const [autoEditResult, setAutoEditResult] = useState<AutoEditResponse | null>(null);
  const [autoEditApplied, setAutoEditApplied] = useState<AutoEditorCommand | null>(null);
  const [autoEditError, setAutoEditError] = useState<string | null>(null);
  const [pacingBusy, setPacingBusy] = useState(false);
  const [pacingResult, setPacingResult] = useState<PacingResponse | null>(null);
  const [pacingError, setPacingError] = useState<string | null>(null);

  /* -------------------------------------- Block 5a repurposing */
  const [shortsBusy, setShortsBusy] = useState<ShortsAction | null>(null);
  const [shortsResult, setShortsResult] = useState<RepurposeResponse | null>(null);
  const [shortsError, setShortsError] = useState<string | null>(null);
  /** The editable platform targets, seeded from the config the API reports. */
  const [shortsDraft, setShortsDraft] = useState<ShortsTargetDraft | null>(null);
  /** The standing analysis gate the last read reported (honest, before any click). */
  const [shortsGate, setShortsGate] = useState<ProviderGateView | null>(null);

  /* ------------------------------------------ Block 4 colour grading */
  const [colorGrades, setColorGrades] = useState<ColorGradeView[]>([]);
  const [colorAssignment, setColorAssignment] = useState<ColorAssignmentView | null>(null);
  const [colorSelected, setColorSelected] = useState<string | null>(null);
  const [colorScope, setColorScope] = useState<"project" | "scene">("project");
  const [colorBusy, setColorBusy] = useState<string | null>(null);
  const [colorResult, setColorResult] = useState<ColorGradeResponse | null>(null);
  const [colorError, setColorError] = useState<string | null>(null);
  /** The standing render gate `listGrades` reports (honest, before any click). */
  const [colorRenderGate, setColorRenderGate] = useState<ProviderGateView | null>(null);

  /* --------------------------------- Block 5b reframe & formats -- */
  const [framingFormats, setFramingFormats] = useState<FrameFormatView[]>([]);
  const [framingPolicies, setFramingPolicies] = useState<FramingPolicyView[]>([]);
  const [framingCatalogue, setFramingCatalogue] = useState<FramingResponse | null>(null);
  const [framingResult, setFramingResult] = useState<FramingResponse | null>(null);
  const [framingError, setFramingError] = useState<string | null>(null);
  const [framingBusy, setFramingBusy] = useState<string | null>(null);
  const [framingGate, setFramingGate] = useState<ProviderGateView | null>(null);
  const [framingFormat, setFramingFormat] = useState<string | null>(null);
  const [framingPolicy, setFramingPolicy] = useState<string | null>(null);
  const [framingScope, setFramingScope] = useState<"project" | "scene" | "clip">("project");
  const [framingClipId, setFramingClipId] = useState<string | null>(null);

  const allScenes = useMemo(() => [...scenes, ...manualScenes], [scenes, manualScenes]);
  const selectedClip = selectedClipId ? clipById(timeline, selectedClipId) : null;

  // The active scene, derived here (rather than next to the JSX) because the
  // Block 4 colour handlers below target it and read its label.
  const activeScene = allScenes.find((s) => s.id === activeSceneId) ?? null;
  const activeSceneLabel = activeScene
    ? typeof activeScene.title === "string" && activeScene.title.trim()
      ? activeScene.title.trim()
      : activeScene.id
    : null;
  const activeSceneOnTimeline = activeSceneId ? timeline.clips.some((c) => c.sceneId === activeSceneId) : false;

  const callEditor = useCallback(
    async (body: Record<string, unknown>): Promise<EditorBody> =>
      apiFetch<EditorBody>("/api/studio/editor", {
        method: "POST",
        body: JSON.stringify({ projectId, ...body }),
      }),
    [projectId],
  );

  /** Run a pure engine op, commit the result to history, flag unsaved work. */
  const applyOp = useCallback((fn: (t: Timeline) => { timeline: Timeline; changed: boolean }) => {
    const current = historyRef.current;
    try {
      const result = fn(current.present);
      if (!result.changed) return;
      const next = commit(current, result.timeline);
      historyRef.current = next;
      setHistory(next);
      setDirty(true);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }, []);

  /* ---------------------------------------------------- transport ---- */
  useEffect(() => {
    if (!playing) return;
    const duration = timeline.durationMs;
    const id = window.setInterval(() => {
      setPlayheadMs((ms) => {
        const next = ms + 60;
        if (next >= duration) setPlaying(false);
        return duration > 0 ? Math.min(next, duration) : 0;
      });
    }, 60);
    return () => window.clearInterval(id);
  }, [playing, timeline.durationMs]);

  /* ------------------------------------------------------ persistence */
  async function saveTimeline(): Promise<boolean> {
    setSaving(true);
    try {
      const res = await callEditor({ action: "save", timeline: historyRef.current.present });
      setDirty(false);
      setNotice(`Saved ${res.count ?? timeline.clips.length} clip(s) · ${formatMs(res.durationMs ?? timeline.durationMs)}.`);
      setError(null);
      return true;
    } catch (err) {
      setError(errorMessage(err));
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function loadVersions() {
    try {
      const res = await callEditor({ action: "versions" });
      setVersions(res.versions ?? []);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    }
  }

  async function createVersion() {
    setVersionBusy(true);
    try {
      // A version snapshots the SAVED timeline — persist the work in progress first.
      await callEditor({ action: "save", timeline: historyRef.current.present });
      const res = await callEditor({
        action: "createVersion",
        ...(versionNote.trim() ? { note: versionNote.trim() } : {}),
      });
      setDirty(false);
      setNotice(`Version ${res.versionNumber} created${versionNote.trim() ? ` — "${versionNote.trim()}"` : ""}.`);
      setVersionNote("");
      setError(null);
      await loadVersions();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setVersionBusy(false);
    }
  }

  async function restoreVersion(versionNumber: number) {
    setVersionBusy(true);
    try {
      const res = await callEditor({ action: "restoreVersion", versionNumber });
      if (!res.timeline) throw new Error("That version did not contain a readable timeline.");
      const next = resetHistory(historyRef.current, res.timeline);
      historyRef.current = next;
      setHistory(next);
      setSelectedClipId(null);
      setPlayheadMs(0);
      setPlaying(false);
      setDirty(false);
      setVersionsOpen(false);
      setNotice(`Version ${versionNumber} restored (${res.timeline.clips.length} clips).`);
      setError(null);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setVersionBusy(false);
    }
  }

  /* ------------------------------------------- Block 2 scene controls */

  /**
   * The seven scene controls, exactly as the API contract specifies: POST
   * `action: "sceneControl"` with the current LOCAL timeline (so the server can
   * run the pure operation on what the editor really shows) plus the control's
   * arguments. A returned timeline is committed to history for the controls the
   * engine really applies; provider-gated controls only ever return a plan.
   */
  const runSceneControl = useCallback(
    async (control: SceneControlName) => {
      const sceneId = activeSceneId;
      if (!sceneId) {
        setControlError("Select a scene first.");
        return;
      }
      setControlBusy(control);
      setControlResult(null);
      setControlApplied(false);
      setControlError(null);
      try {
        const args: Record<string, unknown> = {};
        if (control === "changeTransition") args.kind = transitionKind;
        if (control === "changeSubtitle") args.styleId = subtitleStyleId;
        if (control === "changeMusic") {
          args.mood = musicMood;
          args.energy = musicEnergy;
        }
        if (control === "restyleScene") args.grade = grade;

        const res = await postEditor({
          action: "sceneControl",
          projectId,
          control,
          sceneId,
          ...args,
          timeline: historyRef.current.present,
        });
        setControlResult(res);
        const applies =
          Boolean(res.timeline) &&
          APPLIES_TIMELINE.includes(control) &&
          !timelinesEqual(res.timeline as Timeline, historyRef.current.present);
        if (applies) {
          const next = commit(historyRef.current, res.timeline as Timeline);
          historyRef.current = next;
          setHistory(next);
          setDirty(true);
        }
        setControlApplied(applies);
      } catch (err) {
        const status = (err as { status?: number }).status;
        const code = (err as { code?: string }).code;
        setControlResult(null);
        setControlError(
          `${errorMessage(err)}${code ? ` (${code}${status ? ` · HTTP ${status}` : ""})` : ""}`,
        );
      } finally {
        setControlBusy(null);
      }
    },
    [activeSceneId, projectId, transitionKind, subtitleStyleId, musicMood, musicEnergy, grade],
  );

  /** Toolbar: let the conservative auto policy place the transitions. */
  async function addAutoTransitions() {
    setAutoBusy(true);
    setControlError(null);
    try {
      const res = await postEditor({
        action: "autoTransitions",
        projectId,
        timeline: historyRef.current.present,
      });
      setControlResult(res);
      const applies = Boolean(res.timeline) && !timelinesEqual(res.timeline as Timeline, historyRef.current.present);
      if (applies) {
        const next = commit(historyRef.current, res.timeline as Timeline);
        historyRef.current = next;
        setHistory(next);
        setDirty(true);
      }
      setControlApplied(applies);
      const t = res.transitions;
      setNotice(
        t
          ? `Auto transitions: ${t.nonCut} blend(s) + ${t.cuts} cut(s) across ${t.total} edge(s) — ${t.dramatic} dramatic.`
          : "Auto transitions applied to the video lane.",
      );
    } catch (err) {
      const status = (err as { status?: number }).status;
      const code = (err as { code?: string }).code;
      setControlError(`${errorMessage(err)}${code ? ` (${code}${status ? ` · HTTP ${status}` : ""})` : ""}`);
    } finally {
      setAutoBusy(false);
    }
  }

  /* ---------------------------- Block 3b auto-editor + pacing analyzer -- */

  /**
   * One-click auto-edit. POST `action: "autoEdit"` with the CURRENT local
   * timeline (and the scenes the editor shows). When the engine really edited
   * the timeline the returned timeline is committed through the same
   * history/commit path the scene controls use, so Undo/Redo and Save see it. A
   * provider-gated answer (`changed: false`) is rendered as its honest plan and
   * NOTHING is applied — no fabricated success.
   */
  const runAutoEdit = useCallback(
    async (command: AutoEditorCommand) => {
      const label = AUTO_EDITOR_META.find((m) => m.id === command)?.label ?? command;
      setAutoEditBusy(command);
      setAutoEditResult(null);
      setAutoEditApplied(null);
      setAutoEditError(null);
      try {
        const res = await postEditor({
          action: "autoEdit",
          projectId,
          command,
          timeline: historyRef.current.present,
          scenes: allScenes,
        });
        setAutoEditResult(res);
        const returned = res.timeline;
        const applies =
          Boolean(res.changed) &&
          Boolean(returned) &&
          !timelinesEqual(returned as Timeline, historyRef.current.present);
        if (applies) {
          const next = commit(historyRef.current, returned as Timeline);
          historyRef.current = next;
          setHistory(next);
          setDirty(true);
          setAutoEditApplied(command);
          setNotice(`${label} applied to the local timeline — Save to keep it.`);
        } else if (res.provider && res.provider.connected === false) {
          setNotice(`${label}: Provider Not Connected — a plan was returned, nothing was applied.`);
        } else {
          setNotice(`${label}: nothing needed to change on the local timeline.`);
        }
      } catch (err) {
        const status = (err as { status?: number }).status;
        const code = (err as { code?: string }).code;
        setAutoEditResult(null);
        setAutoEditError(`${errorMessage(err)}${code ? ` (${code}${status ? ` · HTTP ${status}` : ""})` : ""}`);
      } finally {
        setAutoEditBusy(null);
      }
    },
    [projectId, allScenes],
  );

  /**
   * Pacing read-out: POST `action: "analyzePacing"` with the timeline shown here
   * so the five scores describe exactly what the editor displays.
   */
  const runAnalyzePacing = useCallback(async () => {
    setPacingBusy(true);
    setPacingError(null);
    try {
      const res = await postEditor({
        action: "analyzePacing",
        projectId,
        timeline: historyRef.current.present,
        scenes: allScenes,
      });
      setPacingResult(res as PacingResponse);
    } catch (err) {
      const status = (err as { status?: number }).status;
      const code = (err as { code?: string }).code;
      setPacingResult(null);
      setPacingError(`${errorMessage(err)}${code ? ` (${code}${status ? ` · HTTP ${status}` : ""})` : ""}`);
    } finally {
      setPacingBusy(false);
    }
  }, [projectId, allScenes]);

  /* ---------------------------------- Block 5a repurposing actions -- */

  /**
   * The four Block 5a actions, all on the same `POST /api/studio/editor`
   * surface. `listShortsMoments` scores the timeline + script into moment
   * candidates and builds the clip windows (with whatever targets the panel
   * currently shows); `configureShortsTargets` previews the same plan without
   * writing; `applyShorts` records the chosen set as project metadata; and
   * `clearShorts` removes it. None of them cuts, reframes, encodes or transcribes
   * anything — the provider gate in the answer says so, and every number the
   * panel renders is the engine's own.
   */
  const loadShortsMoments = useCallback(
    async (withDraft: boolean) => {
      setShortsBusy("listShortsMoments");
      setShortsError(null);
      try {
        const payload: Record<string, unknown> = { action: "listShortsMoments", projectId };
        if (withDraft && shortsDraft) payload.targets = shortsDraft;
        const res = (await postEditor(payload)) as RepurposeResponse;
        setShortsResult(res);
        setShortsDraft((prev) => prev ?? draftFromConfig(res.config));
        setShortsGate(res.provider ?? null);
        setNotice(
          res.momentCount === 0
            ? "No moment cleared the score floor on this timeline — nothing was invented."
            : `Analysed ${res.momentCount} moment candidate(s) → ${res.totalClips ?? 0} clip window(s) planned.`,
        );
      } catch (err) {
        const status = (err as { status?: number }).status;
        const code = (err as { code?: string }).code;
        setShortsResult(null);
        setShortsError(`${errorMessage(err)}${code ? ` (${code}${status ? ` · HTTP ${status}` : ""})` : ""}`);
      } finally {
        setShortsBusy(null);
      }
    },
    [projectId, shortsDraft],
  );

  const runShortsAction = useCallback(
    async (action: ShortsAction) => {
      if (action === "listShortsMoments") {
        await loadShortsMoments(true);
        return;
      }
      setShortsBusy(action);
      setShortsError(null);
      try {
        const payload: Record<string, unknown> = { action, projectId };
        if (action !== "clearShorts" && shortsDraft) payload.targets = shortsDraft;
        const res = (await postEditor(payload)) as RepurposeResponse;
        setShortsResult(res);
        setShortsDraft((prev) => prev ?? draftFromConfig(res.config));
        if (action === "applyShorts") {
          setNotice(
            res.changed
              ? `Shorts set applied: ${res.totalClips ?? 0} clip window(s) recorded as project metadata — no frames were cut and nothing was rendered.`
              : "The chosen clip set already matched the stored set — nothing was written.",
          );
        } else if (action === "clearShorts") {
          setNotice(
            res.changed
              ? "Shorts set cleared — the clip windows are no longer recorded."
              : "No shorts set was applied, so there was nothing to clear.",
          );
        } else {
          setNotice(
            `Platform targets validated: ${(res.targets ?? [])
              .map((t) => `${t.target} ${t.enabled ? `${t.produced}/${t.count}` : "off"}`)
              .join(", ")} — nothing was persisted (Apply set keeps it).`,
          );
        }
      } catch (err) {
        const status = (err as { status?: number }).status;
        const code = (err as { code?: string }).code;
        setShortsResult(null);
        setShortsError(`${errorMessage(err)}${code ? ` (${code}${status ? ` · HTTP ${status}` : ""})` : ""}`);
      } finally {
        setShortsBusy(null);
      }
    },
    [projectId, shortsDraft, loadShortsMoments],
  );

  /** Drop the local edits and re-read the engine's own defaults for the three targets. */
  const useShortsDefaults = useCallback(() => {
    setShortsDraft(null);
    void loadShortsMoments(false);
  }, [loadShortsMoments]);

  useEffect(() => {
    void loadShortsMoments(false);
    // The standing read only: the draft (once the user edits it) drives later calls.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---------------------------------- Block 4 colour grading actions -- */

  /**
   * The catalogue + the project's current assignment. `listGrades` is a
   * deterministic read: it renders the nine grades with their real parameters
   * and returns the honest render gate (no frames are produced by a catalogue
   * read, and none are claimed).
   */
  const loadColorGrades = useCallback(async () => {
    setColorBusy("listGrades");
    setColorError(null);
    try {
      const res = (await postEditor({ action: "listGrades", projectId })) as ColorGradeResponse;
      const grades = res.grades ?? [];
      setColorGrades(grades);
      setColorAssignment(res.assignment ?? null);
      setColorSelected((prev) => (prev && grades.some((g) => g.id === prev) ? prev : grades[0]?.id ?? null));
      // The catalogue read reports the standing render gate; keep it as the
      // panel's honest "nothing is rendered here" state.
      setColorRenderGate(res.provider ?? null);
    } catch (err) {
      const status = (err as { status?: number }).status;
      const code = (err as { code?: string }).code;
      setColorGrades([]);
      setColorAssignment(null);
      setColorError(`${errorMessage(err)}${code ? ` (${code}${status ? ` · HTTP ${status}` : ""})` : ""}`);
    } finally {
      setColorBusy(null);
    }
  }, [projectId]);

  useEffect(() => {
    void loadColorGrades();
  }, [loadColorGrades]);

  /**
   * applyGrade / resetGrade / renderGradePreview. The three differ in exactly
   * one honest way: apply and reset change the ASSIGNMENT (real metadata, hence
   * `changed`/`persisted` reflect it), while renderGradePreview only resolves
   * the parameter plan and ALWAYS comes back with the "Provider Not Connected"
   * gate — `changed: false`, nothing persisted, no image produced.
   */
  const runColorAction = useCallback(
    async (action: "applyGrade" | "resetGrade" | "renderGradePreview") => {
      setColorBusy(action);
      setColorResult(null);
      setColorError(null);
      try {
        const payload: Record<string, unknown> = { action, projectId, scope: colorScope };
        if (colorScope === "scene" && activeSceneId) payload.sceneId = activeSceneId;
        if (action === "applyGrade" && colorSelected) payload.gradeId = colorSelected;
        if (action === "renderGradePreview" && colorSelected) payload.gradeId = colorSelected;

        const res = (await postEditor(payload)) as ColorGradeResponse;
        setColorResult(res);
        if (res.assignment) setColorAssignment(res.assignment);

        if (action === "applyGrade") {
          const target = colorScope === "project" ? "the whole project" : (activeSceneLabel ?? activeSceneId ?? "the scene");
          setNotice(
            res.changed
              ? `Grade "${res.gradeId}" applied to ${target} — the parameter set is recorded; no frames were rendered.`
              : `Grade "${res.gradeId}" was already in effect on ${target}.`,
          );
        } else if (action === "resetGrade") {
          setNotice(
            res.changed
              ? "Colour grade reset to none — the renderer falls back to the next scope up."
              : "There was no colour grade to reset at that scope.",
          );
        } else {
          setNotice(
            "Render preview: Provider Not Connected — the plan was resolved and nothing was rendered.",
          );
        }
      } catch (err) {
        const status = (err as { status?: number }).status;
        const code = (err as { code?: string }).code;
        setColorResult(null);
        setColorError(`${errorMessage(err)}${code ? ` (${code}${status ? ` · HTTP ${status}` : ""})` : ""}`);
      } finally {
        setColorBusy(null);
      }
    },
    [projectId, colorScope, colorSelected, activeSceneId, activeSceneLabel],
  );

  /* ------------------------------ Block 5b reframe & output formats -- */

  /**
   * The format catalogue + the project's applied overrides. A deterministic read:
   * it renders the four delivery formats (real resolutions, action/title/caption
   * safe areas) and the four framing policies with their rules verbatim, and it
   * carries the standing detector gate — no frame is produced by a catalogue read
   * and none is claimed.
   */
  const loadFramingCatalogue = useCallback(async () => {
    setFramingBusy("listFrameFormats");
    setFramingError(null);
    try {
      const res = (await postEditor({ action: "listFrameFormats", projectId })) as FramingResponse;
      setFramingFormats(res.formats ?? []);
      setFramingPolicies(res.policies ?? []);
      setFramingGate(res.provider ?? null);
      setFramingCatalogue(res);
      setFramingFormat((prev) => prev ?? res.defaultFormat ?? res.formats?.[0]?.id ?? null);
    } catch (err) {
      const status = (err as { status?: number }).status;
      const code = (err as { code?: string }).code;
      setFramingFormats([]);
      setFramingPolicies([]);
      setFramingCatalogue(null);
      setFramingError(`${errorMessage(err)}${code ? ` (${code}${status ? ` · HTTP ${status}` : ""})` : ""}`);
    } finally {
      setFramingBusy(null);
    }
  }, [projectId]);

  useEffect(() => {
    void loadFramingCatalogue();
  }, [loadFramingCatalogue]);

  /**
   * planReframe / applyReframe / resetReframe. The plan is a read (`changed`
   * false, nothing persisted); apply and reset really record or clear the
   * OVERRIDE and return the read-back plan. The geometry is deterministic
   * arithmetic on the project's frames — nothing here renders a frame.
   */
  const runFramingAction = useCallback(
    async (action: FramingPanelAction, requestedFormat?: string | null) => {
      if (action === "listFrameFormats") {
        await loadFramingCatalogue();
        return;
      }
      setFramingBusy(action);
      setFramingError(null);
      try {
        const payload: Record<string, unknown> = { action, projectId, scope: framingScope };
        if (framingScope === "scene" && activeSceneId) payload.sceneId = activeSceneId;
        if (framingScope === "clip" && framingClipId) payload.clipId = framingClipId;
        const fmt = requestedFormat !== undefined ? requestedFormat : framingFormat;
        if (fmt) payload.format = fmt;
        if ((action === "planReframe" || action === "applyReframe") && framingPolicy) payload.policy = framingPolicy;
        const res = (await postEditor(payload)) as FramingResponse;
        setFramingResult(res);
        if (res.provider) setFramingGate(res.provider);
        if (!framingClipId && res.clip?.clipId) setFramingClipId(res.clip.clipId);
        const target =
          framingScope === "project"
            ? "the whole project"
            : framingScope === "scene"
              ? (activeSceneLabel ?? activeSceneId ?? "the scene")
              : (framingClipId ?? "the clip");
        if (action === "planReframe") {
          setNotice(
            `Reframe planned: ${res.scopedCount ?? 0} clip(s) at ${res.scope ?? framingScope} scope for ${
              res.requestedFormat ?? fmt ?? "the engine's format"
            } — the crop window, scale, keyframes and safe areas are arithmetic on the project's frames; nothing was rendered.`,
          );
        } else if (action === "applyReframe") {
          setNotice(
            res.changed
              ? `Reframe override applied to ${target} — recorded as project metadata; no frame was cut, reframed or encoded.`
              : `${target} already stated exactly these reframe settings — nothing was written.`,
          );
        } else {
          setNotice(
            res.changed
              ? `Reframe override cleared on ${target} — the engine's own stated plan applies again.`
              : `There was no reframe override on ${target}.`,
          );
        }
      } catch (err) {
        const status = (err as { status?: number }).status;
        const code = (err as { code?: string }).code;
        setFramingResult(null);
        setFramingError(`${errorMessage(err)}${code ? ` (${code}${status ? ` · HTTP ${status}` : ""})` : ""}`);
      } finally {
        setFramingBusy(null);
      }
    },
    [projectId, framingScope, framingClipId, framingFormat, framingPolicy, activeSceneId, activeSceneLabel, loadFramingCatalogue],
  );

  /* --------------------------------------------------------- scenes -- */
  function addBlankScene() {
    const taken = new Set(allScenes.map((s) => s.id));
    let n = manualScenes.length + 1;
    while (taken.has(`manual-${n}`)) n += 1;
    const scene: SceneInput = { id: `manual-${n}`, title: `New scene ${n}`, narration: null, durationSeconds: DEFAULT_SCENE_SECONDS };
    setManualScenes((prev) => [...prev, scene]);
    setActiveSceneId(scene.id);
    applyOp((t) => addSceneOp(t, { scene }));
    setNotice(`Added "${scene.title}" to the timeline (${sceneSeconds(scene)}s).`);
  }

  function addExistingScene(scene: SceneInput) {
    applyOp((t) => addSceneOp(t, { scene }));
    setActiveSceneId(scene.id);
    setNotice(`Added "${scene.title ?? scene.id}" to the timeline.`);
  }

  function removeScene(sceneId: string) {
    applyOp((t) => removeSceneOp(t, { sceneId }));
    setNotice("Removed every clip derived from that scene.");
  }

  /* -------------------------------------------------------- timeline -- */
  const timelineWidth = Math.max(640, Math.round(timeline.durationMs * pxPerMs) + 80);
  const playheadX = TRACK_LABEL_W + playheadMs * pxPerMs;

  const previewClips = TRACKS.map((track) => ({ track, clip: clipAtMs(timeline, track.id, playheadMs) })).filter(
    (entry): entry is { track: (typeof TRACKS)[number]; clip: Clip } => entry.clip !== null,
  );

  return (
    <div className="flex flex-col gap-4">
      {/* -------------------------------------------------------- top bar */}
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={`/projects/${projectId}`}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-dim transition-colors hover:bg-panel-2 hover:text-ink"
          aria-label="Back to project"
        >
          <ArrowLeft size={16} />
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-xl font-semibold tracking-tight text-ink">
            {projectTitle} <span className="text-ink-faint">— Editor</span>
          </h1>
          <p className="mt-0.5 flex items-center gap-2 text-[11px] text-ink-faint">
            <Badge tone="neutral">{initialSource === "saved" ? "saved timeline" : "built from scenes"}</Badge>
            {timeline.clips.length} clips · {formatMs(timeline.durationMs)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {dirty ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-line bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Unsaved changes
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-ok/25 bg-ok/10 px-2.5 py-1 text-[11px] font-medium text-ok">
              Saved
            </span>
          )}
          <Button
            size="sm"
            variant="outline"
            disabled={autoBusy}
            title="Apply the conservative auto-transition policy to the video lane"
            onClick={() => void addAutoTransitions()}
          >
            {autoBusy ? <Loader2 size={13} className="animate-spin" /> : <Shuffle size={13} />} Add Auto Transitions
          </Button>
          <Button size="sm" variant="outline" disabled={!canUndo(history)} onClick={() => { const next = undo(historyRef.current); historyRef.current = next; setHistory(next); setDirty(true); }}>
            <Undo2 size={13} /> Undo
          </Button>
          <Button size="sm" variant="outline" disabled={!canRedo(history)} onClick={() => { const next = redo(historyRef.current); historyRef.current = next; setHistory(next); setDirty(true); }}>
            <Redo2 size={13} /> Redo
          </Button>
          <div className="relative">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                const open = !versionsOpen;
                setVersionsOpen(open);
                if (open) void loadVersions();
              }}
            >
              Versions <ChevronDown size={13} />
            </Button>
            {versionsOpen ? (
              <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-line bg-panel-2 p-3 shadow-xl">
                <div className="flex items-center justify-between">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Versions</p>
                  <button type="button" className="text-[11px] text-ink-faint hover:text-ink" onClick={() => setVersionsOpen(false)}>
                    Close
                  </button>
                </div>
                <div className="mt-2 space-y-2">
                  <Input
                    placeholder="Optional note for the new version"
                    value={versionNote}
                    onChange={(e) => setVersionNote(e.target.value)}
                  />
                  <Button size="sm" className="w-full" disabled={versionBusy} onClick={() => void createVersion()}>
                    {versionBusy ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Create version
                  </Button>
                </div>
                <div className="mt-3 max-h-56 space-y-1.5 overflow-y-auto">
                  {versions.length === 0 ? (
                    <p className="text-[11px] text-ink-faint">No versions yet — create one to snapshot this timeline.</p>
                  ) : (
                    versions.map((v) => (
                      <div key={v.versionNumber} className="flex items-center justify-between gap-2 rounded-lg border border-line bg-panel-3/50 px-2.5 py-2">
                        <div className="min-w-0">
                          <p className="text-xs text-ink">
                            v{v.versionNumber} · {v.clipCount} clips · {formatMs(v.durationMs)}
                          </p>
                          <p className="truncate text-[11px] text-ink-faint">
                            {v.note ? `${v.note} · ` : ""}
                            {new Date(v.createdAt).toLocaleString()}
                          </p>
                        </div>
                        <Button size="sm" variant="ghost" disabled={versionBusy} onClick={() => void restoreVersion(v.versionNumber)}>
                          Restore
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            ) : null}
          </div>
          <Button size="sm" disabled={saving || !dirty} onClick={() => void saveTimeline()}>
            {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
          </Button>
        </div>
      </div>

      {error ? (
        <p className="rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p>
      ) : null}
      {notice && !error ? (
        <p className="rounded-lg border border-line bg-panel-2 px-3 py-2 text-xs text-ink-dim">{notice}</p>
      ) : null}

      {/* ------------------------------------------------------------ body */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[230px_minmax(0,1fr)_300px]">
        {/* ---------------------------------------------------- left panel */}
        <Card className="p-4">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Scenes</p>
            <span className="text-[11px] text-ink-faint">{allScenes.length}</span>
          </div>
          <div className="mt-3 max-h-[520px] space-y-2 overflow-y-auto">
            {allScenes.length === 0 ? (
              <p className="text-[11px] text-ink-faint">
                This project has no scenes yet — add a blank scene to start building the timeline.
              </p>
            ) : (
              allScenes.map((scene, i) => {
                const onTimeline = timeline.clips.some((c) => c.sceneId === scene.id);
                const label = sceneLabel(scene, i);
                return (
                  <div
                    key={scene.id}
                    className={`rounded-lg border px-2.5 py-2 transition-colors ${
                      activeSceneId === scene.id ? "border-accent-line bg-accent-soft/40" : "border-line bg-panel-3/40"
                    }`}
                  >
                    <button type="button" className="w-full text-left" onClick={() => setActiveSceneId(scene.id)}>
                      <p className="truncate text-xs text-ink">{label}</p>
                      <p className="text-[11px] text-ink-faint">
                        {sceneSeconds(scene)}s{scene.narration ? " · narration" : ""}
                        {onTimeline ? " · on timeline" : ""}
                      </p>
                    </button>
                    <div className="mt-1.5 flex gap-1.5">
                      <Button size="sm" variant="outline" className="flex-1" disabled={onTimeline} onClick={() => addExistingScene(scene)}>
                        Add
                      </Button>
                      <Button size="sm" variant="ghost" className="flex-1" disabled={!onTimeline} onClick={() => removeScene(scene.id)}>
                        Remove
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
          <Button size="sm" variant="outline" className="mt-3 w-full" onClick={addBlankScene}>
            <Plus size={13} /> Add scene
          </Button>
          {activeScene ? (
            <p className="mt-2 text-[11px] text-ink-faint">Selected: {activeScene.title ?? activeScene.id}</p>
          ) : null}
        </Card>

        {/* -------------------------------------------- center: preview + timeline */}
        <div className="min-w-0 space-y-4">
          <Card className="p-4">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Preview at playhead</p>
              <span className="text-[11px] text-ink-faint">{formatMs(playheadMs)}</span>
            </div>
            <div className="mt-3 aspect-video w-full rounded-xl border border-line bg-black/50 p-3">
              {previewClips.length === 0 ? (
                <div className="flex h-full items-center justify-center text-center text-[11px] text-ink-faint">
                  No clip under the playhead at {formatMs(playheadMs)}.
                </div>
              ) : (
                <div className="flex h-full flex-col justify-center gap-2">
                  {previewClips.map(({ track, clip }) => (
                    <div
                      key={clip.id}
                      className={`rounded-lg border px-3 py-2 ${
                        selectedClipId === clip.id ? "border-accent-line bg-accent-soft/40" : "border-line bg-panel-2/70"
                      }`}
                    >
                      <p className="truncate text-xs text-ink">{clip.name}</p>
                      <p className="text-[11px] text-ink-faint">
                        {track.label} · {formatMs(clip.startMs)} → {formatMs(clip.endMs)}
                        {clip.sourceRef ? ` · ${clip.sourceRef}` : ""}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <p className="mt-2 text-[11px] text-ink-faint">
              Styled placeholder blocks — frame preview of real media arrives in a later phase.
            </p>
          </Card>

          {/* --------------------------------------------------- timeline */}
          <Card className="p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Timeline</p>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => setPlaying((p) => !p)}>
                  {playing ? <Pause size={13} /> : <Play size={13} />} {playing ? "Pause" : "Play"}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setPlaying(false); setPlayheadMs(0); }}>
                  Reset
                </Button>
                <span className="text-[11px] text-ink-faint">{formatMs(playheadMs)} / {formatMs(timeline.durationMs)}</span>
                <label className="flex items-center gap-2 text-[11px] text-ink-faint">
                  Zoom
                  <input
                    type="range"
                    min={0.02}
                    max={0.4}
                    step={0.01}
                    value={pxPerMs}
                    onChange={(e) => setPxPerMs(Number(e.target.value))}
                    aria-label="Timeline zoom"
                  />
                </label>
              </div>
            </div>

            <div className="mt-3 overflow-x-auto rounded-xl border border-line bg-panel-3/30">
              <div className="relative" style={{ width: `${timelineWidth}px`, minWidth: "100%" }}>
                <div className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-accent" style={{ left: `${playheadX}px` }} />
                {TRACKS.map((track) => (
                  <div key={track.id} className="flex items-stretch border-b border-line/60 last:border-b-0">
                    <div
                      className="flex shrink-0 items-center gap-1.5 border-r border-line/60 px-2 py-1.5"
                      style={{ width: `${TRACK_LABEL_W}px` }}
                    >
                      <span className="truncate text-[11px] text-ink-dim">{track.label}</span>
                    </div>
                    <div
                      className="relative h-10 flex-1"
                      onDragOver={(e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(e) => {
                        e.preventDefault();
                        const clipId = e.dataTransfer.getData("text/plain");
                        if (!clipId) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const startMs = Math.max(0, Math.round((e.clientX - rect.left) / pxPerMs));
                        applyOp((t) => reorderClip(t, { clipId, trackId: track.id, startMs }));
                      }}
                      onMouseDown={(e) => {
                        if (e.target !== e.currentTarget) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        setPlaying(false);
                        setPlayheadMs(Math.max(0, Math.round((e.clientX - rect.left) / pxPerMs)));
                      }}
                    >
                      {clipsAt(timeline, track.id).map((clip) => {
                        const left = clip.startMs * pxPerMs;
                        const width = Math.max(6, (clip.endMs - clip.startMs) * pxPerMs);
                        const selected = selectedClipId === clip.id;
                        return (
                          <button
                            key={clip.id}
                            type="button"
                            draggable
                            onDragStart={(e) => {
                              e.dataTransfer.setData("text/plain", clip.id);
                              e.dataTransfer.effectAllowed = "move";
                              setSelectedClipId(clip.id);
                            }}
                            onClick={() => setSelectedClipId(clip.id)}
                            title={`${clip.name} · ${track.label} · ${formatMs(clip.startMs)} → ${formatMs(clip.endMs)}`}
                            className={`absolute top-1.5 bottom-1.5 overflow-hidden rounded-md border px-1.5 text-left text-[10px] leading-tight transition-colors ${
                              selected
                                ? "border-accent-line bg-accent-soft text-ink"
                                : isAudioTrack(track.id)
                                  ? "border-line bg-panel-2 text-ink-dim hover:text-ink"
                                  : "border-line bg-panel-2/80 text-ink-dim hover:text-ink"
                            }`}
                            style={{ left: `${left}px`, width: `${width}px` }}
                          >
                            <span className="block truncate">{clip.name}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-2 text-[11px] text-ink-faint">
              Drag a clip onto any track row to move it there (block width is proportional to its duration). Click a
              lane to move the playhead.
            </p>
          </Card>

          <SceneControlsPanel
            sceneId={activeSceneId}
            sceneLabel={activeSceneLabel}
            onTimeline={activeSceneOnTimeline}
            busy={controlBusy}
            result={controlResult}
            applied={controlApplied}
            error={controlError}
            onRun={(control) => void runSceneControl(control)}
            onDismiss={() => {
              setControlResult(null);
              setControlApplied(false);
              setControlError(null);
            }}
            transitionKind={transitionKind}
            onTransitionKind={setTransitionKind}
            subtitleStyleId={subtitleStyleId}
            onSubtitleStyleId={setSubtitleStyleId}
            mood={musicMood}
            onMood={setMusicMood}
            energy={musicEnergy}
            onEnergy={setMusicEnergy}
            grade={grade}
            onGrade={setGrade}
          />

          <AutoEditorPanel
            busy={autoEditBusy}
            result={autoEditResult}
            applied={autoEditApplied}
            error={autoEditError}
            onRun={(command) => void runAutoEdit(command)}
            onDismiss={() => {
              setAutoEditResult(null);
              setAutoEditApplied(null);
              setAutoEditError(null);
            }}
          />

          <PacingPanel
            busy={pacingBusy}
            result={pacingResult}
            error={pacingError}
            onRun={() => void runAnalyzePacing()}
            onDismiss={() => {
              setPacingResult(null);
              setPacingError(null);
            }}
          />

          <ColorGradingPanel
            grades={colorGrades}
            assignment={colorAssignment}
            selectedId={colorSelected}
            onSelect={setColorSelected}
            scope={colorScope}
            onScope={setColorScope}
            sceneId={activeSceneId}
            sceneLabel={activeSceneLabel}
            busy={colorBusy}
            result={colorResult}
            error={colorError}
            renderGate={colorRenderGate}
            onApply={() => void runColorAction("applyGrade")}
            onReset={() => void runColorAction("resetGrade")}
            onPreview={() => void runColorAction("renderGradePreview")}
            onReload={() => void loadColorGrades()}
            onDismiss={() => {
              setColorResult(null);
              setColorError(null);
            }}
          />

          <RepurposePanel
            result={shortsResult}
            busy={shortsBusy}
            error={shortsError}
            draft={shortsDraft}
            standingGate={shortsGate}
            onDraft={setShortsDraft}
            onRun={(action) => void runShortsAction(action)}
            onUseDefaults={useShortsDefaults}
            onDismiss={() => {
              setShortsResult(null);
              setShortsError(null);
            }}
          />
        </div>

          <FramingPanel
            formats={framingFormats}
            policies={framingPolicies}
            catalogue={framingCatalogue}
            result={framingResult}
            busy={framingBusy}
            error={framingError}
            gate={framingGate}
            format={framingFormat}
            onFormat={setFramingFormat}
            policy={framingPolicy}
            onPolicy={setFramingPolicy}
            scope={framingScope}
            onScope={setFramingScope}
            clipId={framingClipId}
            onClip={setFramingClipId}
            sceneId={activeSceneId}
            sceneLabel={activeSceneLabel}
            onRun={(action) => void runFramingAction(action)}
            onPlanAt={(formatId) => {
              setFramingFormat(formatId);
              void runFramingAction("planReframe", formatId);
            }}
            onReload={() => void loadFramingCatalogue()}
            onDismiss={() => {
              setFramingResult(null);
              setFramingError(null);
            }}
          />

        {/* ------------------------------------------------- right inspector */}
        <Card className="p-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Inspector</p>
          <div className="mt-3">
            {selectedClip ? (
              <ClipInspector
                key={selectedClip.id}
                clip={selectedClip}
                timeline={timeline}
                playheadMs={playheadMs}
                onOp={applyOp}
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-center">
                <Film size={20} className="text-ink-faint" />
                <p className="text-xs text-ink-dim">Select a clip to edit it.</p>
                <p className="text-[11px] text-ink-faint">Trim, split, duplicate, move, replace, duration and volume all live here.</p>
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
