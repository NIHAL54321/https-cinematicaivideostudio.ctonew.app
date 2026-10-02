"use client";

/**
 * Workspace Storyboard tab — the scene-by-scene storyboard workspace.
 *
 * Renders EVERY Phase 2 storyboard field from real data: scene number,
 * narration (honest "AI narration — awaiting provider" when null, editable
 * user text otherwise), duration, visual description, recommended footage
 * (mediaType from the persisted structure plan), AI-generated visual
 * requirement (template visual prompt), camera movement, transition, music
 * mood, sound effect, subtitle and voice timing. Fields with no persisted
 * value render "—" — nothing is invented.
 *
 * Edits are REAL and DB-persisted (narration/duration are user content; the
 * deterministic re-roll runs the visual-prompts engine). Anything labeled AI
 * (regenerate scene, AI generate visual) routes through the AI Model
 * Orchestrator and renders its real result — "Provider Not Connected" in
 * Phase 1. Nothing is simulated, and AI narration is never auto-filled.
 */
import { useCallback, useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Clapperboard,
  Copy,
  Film,
  Loader2,
  Lock,
  Plus,
  RefreshCcw,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { Badge, Button, Label } from "@/components/ui";
import { AiResultPanel } from "@/components/projects/ai-result-panel";
import { apiFetch } from "@/components/projects/client-api";
import type { ScriptTree, ScriptTreeChapter, ScriptTreeScene } from "@/lib/studio/pipeline";
import type { AiResult } from "@/lib/ai/types";
import { MEDIA_LABELS } from "@/lib/studio/scene-intelligence";
import type { SceneVisualAssignment } from "@/lib/studio/visual-assignment";
import type { ContinuityState } from "@/lib/studio/continuity";
import type { VisualCandidate } from "@/lib/studio/visual-selection";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; tree: ScriptTree };

function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return "—";
  const s = Math.round(seconds);
  if (s >= 60) {
    const m = Math.floor(s / 60);
    const rest = s % 60;
    return rest > 0 ? `${m}m ${rest}s` : `${m}m`;
  }
  return `${s}s`;
}

function mediaLabel(v: string | null): string {
  if (!v) return "—";
  return MEDIA_LABELS[v as keyof typeof MEDIA_LABELS] ?? v;
}

function subtitleLabel(enabled: boolean | null): string {
  if (enabled === null) return "—";
  return enabled ? "On" : "Off";
}

/** First segment of the template prompt = the plain visual description. */
function visualDescription(prompt: string | null): string {
  if (!prompt) return "—";
  const first = prompt.split(" · ")[0]?.trim();
  return first || prompt;
}

export function StoryboardTab({ projectId }: { projectId: string }) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [busy, setBusy] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);
  const [aiResults, setAiResults] = useState<Record<string, AiResult>>({});
  const [deleteArmed, setDeleteArmed] = useState<string | null>(null);

  type VisualSel =
    | { phase: "idle" }
    | { phase: "loading" }
    | { phase: "ready"; assignments: SceneVisualAssignment[]; continuity: ContinuityState | null }
    | { phase: "error"; message: string };
  const [visualSel, setVisualSel] = useState<VisualSel>({ phase: "idle" });

  async function runVisualSelection() {
    setVisualSel({ phase: "loading" });
    try {
      const res = await apiFetch<{ assignments: SceneVisualAssignment[]; continuity: ContinuityState | null }>(
        `/api/studio/visuals`,
        { method: "POST", body: JSON.stringify({ projectId }) },
      );
      setVisualSel({ phase: "ready", assignments: res.assignments ?? [], continuity: res.continuity ?? null });
    } catch (e) {
      setVisualSel({ phase: "error", message: e instanceof Error ? e.message : "Visual selection failed." });
    }
  }

  const load = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const tree = await apiFetch<ScriptTree>(`/api/projects/${projectId}/storyboard`);
      setState({ phase: "ready", tree });
    } catch (e) {
      setState({ phase: "error", message: e instanceof Error ? e.message : "Could not load the storyboard." });
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const tree = state.phase === "ready" ? state.tree : null;
  const chapters = tree?.script?.chapters ?? [];
  const scenes = chapters.flatMap((c) => c.scenes);
  const totalSeconds = scenes.reduce((a, s) => a + (s.durationSeconds ?? 0), 0);
  const targetSeconds = tree?.meta?.targetDurationSeconds ?? tree?.meta?.totalDurationSeconds ?? null;

  /** Runs a mutation, swaps in the returned tree, records AI results. */
  async function mutate(
    busyKey: string,
    url: string,
    init?: RequestInit,
  ): Promise<{ tree?: ScriptTree; result?: AiResult } | null> {
    setBusy(busyKey);
    setOpError(null);
    try {
      const res = await apiFetch<{ tree?: ScriptTree; result?: AiResult }>(url, init);
      if (res.tree) setState((s) => (s.phase === "ready" ? { phase: "ready", tree: res.tree! } : s));
      return res;
    } catch (e) {
      setOpError(e instanceof Error ? e.message : "Request failed.");
      return null;
    } finally {
      setBusy(null);
    }
  }

  function runAi(url: string, keyPrefix: string, sceneId: string) {
    void (async () => {
      const res = await mutate(`${sceneId}:${keyPrefix}`, url, { method: "POST" });
      if (res?.result) {
        setAiResults((m) => ({ ...m, [`${keyPrefix}:${sceneId}`]: res.result! }));
      }
    })();
  }

  function handleUpdate(sceneId: string, patch: Record<string, unknown>) {
    void mutate(`${sceneId}:update`, `/api/projects/${projectId}/scenes/${sceneId}`, {
      method: "PATCH",
      body: JSON.stringify(patch),
    });
  }

  function handleAdd(chapterId: string) {
    void mutate(`add:${chapterId}`, `/api/projects/${projectId}/scenes`, {
      method: "POST",
      body: JSON.stringify({ chapterId }),
    });
  }

  function handleMove(sceneId: string, direction: "up" | "down") {
    void mutate(`${sceneId}:move`, `/api/projects/${projectId}/scenes/${sceneId}/move`, {
      method: "POST",
      body: JSON.stringify({ direction }),
    });
  }

  function handleDuplicate(sceneId: string) {
    void mutate(`${sceneId}:duplicate`, `/api/projects/${projectId}/scenes/${sceneId}/duplicate`, { method: "POST" });
  }

  function handleDelete(sceneId: string) {
    if (deleteArmed !== sceneId) {
      setDeleteArmed(sceneId);
      return;
    }
    setDeleteArmed(null);
    void mutate(`${sceneId}:delete`, `/api/projects/${projectId}/scenes/${sceneId}`, { method: "DELETE" });
  }

  if (state.phase === "loading") {
    return (
      <div className="glass flex items-center justify-center gap-2.5 px-6 py-16 text-sm text-ink-dim">
        <Loader2 size={15} className="animate-spin text-accent" /> Loading storyboard…
      </div>
    );
  }
  if (state.phase === "error") {
    return (
      <div className="glass flex flex-col items-center gap-3 border-danger/30 px-6 py-12 text-center">
        <h3 className="font-display text-base font-semibold text-ink">Could not load the storyboard</h3>
        <p className="max-w-md text-sm text-ink-dim">{state.message}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCcw size={13} /> Retry
        </Button>
      </div>
    );
  }

  if (!tree || !tree.script || chapters.length === 0) {
    return (
      <div className="glass flex flex-col items-center gap-3 px-6 py-14 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-panel-2 border border-line text-ink-dim">
          <Clapperboard size={20} strokeWidth={1.75} />
        </span>
        <h3 className="font-display text-base font-semibold text-ink">No structure plan yet</h3>
        <p className="mx-auto max-w-md text-sm leading-relaxed text-ink-dim">
          Start from <span className="text-accent">Create Video</span> to build the idea → script → story →
          storyboard structure. Scenes appear here with their shot plan once the plan is persisted.
        </p>
      </div>
    );
  }

  const structureName = tree.meta?.structureName ?? null;
  const ratio = targetSeconds && targetSeconds > 0 ? Math.min(1, totalSeconds / targetSeconds) : null;

  return (
    <div className="space-y-5">
      {/* ---------------------------------------------------- meta + totals */}
      <div className="glass p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">{structureName ?? "Storyboard"}</Badge>
          <Badge tone="neutral">{chapters.length} chapters</Badge>
          <Badge tone="neutral">{scenes.length} scenes</Badge>
          <Button size="sm" variant="outline" className="ml-2" onClick={() => void runVisualSelection()} disabled={visualSel.phase === "loading"}>
            {visualSel.phase === "loading" ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
            Visual Selection
          </Button>
          <span className="ml-auto text-[11px] text-ink-faint">storyboard · template structure, not AI output</span>
        </div>

        <div className="mt-4 rounded-xl border border-line bg-panel-3/50 px-4 py-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-medium text-ink">
              Total {formatDuration(totalSeconds)}
              {targetSeconds !== null ? (
                <span className="text-ink-dim"> vs target {formatDuration(targetSeconds)}</span>
              ) : null}
            </span>
            {targetSeconds !== null && targetSeconds > 0 ? (
              <span
                className={[
                  "text-xs font-medium",
                  totalSeconds > targetSeconds ? "text-danger" : totalSeconds === targetSeconds ? "text-ok" : "text-ink-dim",
                ].join(" ")}
              >
                {totalSeconds > targetSeconds
                  ? `${Math.round(((totalSeconds - targetSeconds) / targetSeconds) * 100)}% over target`
                  : `${Math.round((totalSeconds / targetSeconds) * 100)}% of target`}
              </span>
            ) : null}
          </div>
          {ratio !== null && targetSeconds !== null ? (
            <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-panel-2">
              <div
                className={[
                  "h-full rounded-full transition-all",
                  totalSeconds > targetSeconds ? "bg-danger" : "bg-accent",
                ].join(" ")}
                style={{ width: `${ratio * 100}%` }}
              />
            </div>
          ) : null}
        </div>

        {opError ? (
          <p className="mt-3 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">{opError}</p>
        ) : null}
      </div>

      {/* ---------------------------------------------------- visual selection panel */}
      {visualSel.phase === "loading" ? (
        <div className="glass flex items-center gap-2.5 px-6 py-5 text-sm text-ink-dim">
          <Loader2 size={15} className="animate-spin text-accent" /> Ranking visuals and scanning continuity…
        </div>
      ) : visualSel.phase === "error" ? (
        <div className="glass flex items-center gap-2.5 rounded-xl border border-danger/25 bg-danger/10 px-6 py-4 text-sm text-danger">
          {visualSel.message}
        </div>
      ) : visualSel.phase === "ready" ? (
        <VisualSelectionPanel assignments={visualSel.assignments} continuity={visualSel.continuity} />
      ) : null}

      {/* ---------------------------------------------------- chapters */}
      {chapters.map((chapter, ci) => (
        <div key={chapter.id} className="glass overflow-hidden">
          <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-5 py-3.5">
            <span
              className={[
                "flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-bold",
                ci === 0 ? "bg-accent-soft text-accent" : "bg-panel-2 text-ink-dim",
              ].join(" ")}
            >
              {chapter.order}
            </span>
            <h3 className="font-display text-sm font-semibold text-ink">{chapter.title}</h3>
            <span className="text-xs text-ink-faint">
              {chapter.scenes.length} scene{chapter.scenes.length === 1 ? "" : "s"} ·{" "}
              {formatDuration(chapter.scenes.reduce((a, s) => a + (s.durationSeconds ?? 0), 0))}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto"
              onClick={() => handleAdd(chapter.id)}
              disabled={busy === `add:${chapter.id}`}
            >
              {busy === `add:${chapter.id}` ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}
              Add scene
            </Button>
          </div>
          {chapter.summary ? (
            <p className="border-b border-line-soft px-5 py-2.5 text-xs leading-relaxed text-ink-dim">{chapter.summary}</p>
          ) : null}

          <ul className="divide-y divide-line-soft">
            {chapter.scenes.map((scene) => {
              const globalNumber = chapters
                .slice(0, ci)
                .reduce((a, c) => a + c.scenes.length, 0) + scene.order;
              return (
                <SceneCard
                  key={scene.id}
                  scene={scene}
                  chapter={chapter}
                  sceneNumber={globalNumber}
                  meta={tree.meta}
                  busy={busy}
                  deleteArmed={deleteArmed}
                  aiVisual={aiResults[`visual:${scene.id}`] ?? null}
                  aiRegen={aiResults[`regenerate:${scene.id}`] ?? null}
                  onUpdate={handleUpdate}
                  onReroll={() =>
                    void (async () => {
                      const res = await mutate(`${scene.id}:reroll`, `/api/projects/${projectId}/scenes/${scene.id}/visual`, {
                        method: "POST",
                        body: JSON.stringify({ mode: "template" }),
                      });
                      if (res?.result) setAiResults((m) => ({ ...m, [`visual:${scene.id}`]: res.result! }));
                    })()
                  }
                  onAiVisual={() => runAi(`/api/projects/${projectId}/scenes/${scene.id}/visual`, "visual", scene.id)}
                  onRegenerate={() => runAi(`/api/projects/${projectId}/scenes/${scene.id}/regenerate`, "regenerate", scene.id)}
                  onMove={(dir) => handleMove(scene.id, dir)}
                  onDuplicate={() => handleDuplicate(scene.id)}
                  onDelete={() => handleDelete(scene.id)}
                />
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Scene card                                                          */
/* ------------------------------------------------------------------ */

function SceneCard({
  scene,
  chapter,
  sceneNumber,
  meta,
  busy,
  deleteArmed,
  aiVisual,
  aiRegen,
  onUpdate,
  onReroll,
  onAiVisual,
  onRegenerate,
  onMove,
  onDuplicate,
  onDelete,
}: {
  scene: ScriptTreeScene;
  chapter: ScriptTreeChapter;
  sceneNumber: number;
  meta: ScriptTree["meta"];
  busy: string | null;
  deleteArmed: string | null;
  aiVisual: AiResult | null;
  aiRegen: AiResult | null;
  onUpdate: (sceneId: string, patch: Record<string, unknown>) => void;
  onReroll: () => void;
  onAiVisual: () => void;
  onRegenerate: () => void;
  onMove: (direction: "up" | "down") => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const [narrationDraft, setNarrationDraft] = useState(scene.narration ?? "");
  const [durationDraft, setDurationDraft] = useState(String(scene.durationSeconds ?? ""));
  useEffect(() => setNarrationDraft(scene.narration ?? ""), [scene.narration]);
  useEffect(() => setDurationDraft(String(scene.durationSeconds ?? "")), [scene.durationSeconds]);

  const narrationDirty = (narrationDraft.trim() || null) !== (scene.narration ?? null);
  const durationNum = Number(durationDraft);
  const durationDirty =
    durationDraft.trim() !== "" &&
    Number.isInteger(durationNum) &&
    durationNum >= 1 &&
    durationNum <= 7200 &&
    durationNum !== scene.durationSeconds;

  const busyUpdate = busy === `${scene.id}:update`;
  const busyReroll = busy === `${scene.id}:reroll`;
  const busyVisual = busy === `${scene.id}:visual`;
  const busyRegen = busy === `${scene.id}:regenerate`;
  const busyMove = busy === `${scene.id}:move`;
  const busyDuplicate = busy === `${scene.id}:duplicate`;
  const busyDelete = busy === `${scene.id}:delete`;
  const anyBusy = busy !== null;

  return (
    <li className="px-5 py-4">
      {/* ------------------------------------------------ card header */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent-soft font-display text-[13px] font-bold text-accent border border-accent-line/40">
          {sceneNumber}
        </span>
        <Film size={14} className="text-ink-faint" />
        <span className="text-[13px] font-medium text-ink">{scene.title ?? `Scene ${scene.order}`}</span>
        <span className="rounded-md border border-line bg-panel-2/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-faint">
          Ch {chapter.order}
        </span>
        <Badge tone="neutral" className="text-[10px] normal-case tracking-normal">
          {scene.status.toLowerCase()}
        </Badge>
        <div className="ml-auto flex items-center gap-1">
          <IconButton title="Move up" disabled={anyBusy} onClick={() => onMove("up")}>
            <ArrowUp size={13} />
          </IconButton>
          <IconButton title="Move down" disabled={anyBusy} onClick={() => onMove("down")}>
            <ArrowDown size={13} />
          </IconButton>
          <IconButton title="Duplicate scene" disabled={anyBusy} onClick={onDuplicate}>
            {busyDuplicate ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />}
          </IconButton>
          <IconButton title="Delete scene" danger disabled={anyBusy} onClick={onDelete}>
            {busyDelete ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
          </IconButton>
        </div>
      </div>

      {deleteArmed === scene.id ? (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-xl border border-danger/25 bg-danger/10 px-3.5 py-2.5 text-xs text-danger">
          <span>Delete “{scene.title ?? `Scene ${scene.order}`}”? Scene assets and subtitles are removed with it.</span>
          <div className="ml-auto flex gap-2">
            <Button size="sm" variant="ghost" onClick={() => onDelete()} disabled={busyDelete}>
              {busyDelete ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />} Confirm delete
            </Button>
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------ narration */}
      <div className="mt-3">
        <Label>Narration</Label>
        {scene.narration ? (
          <>
            <textarea
              value={narrationDraft}
              onChange={(e) => setNarrationDraft(e.target.value)}
              rows={2}
              placeholder="Write the narration for this scene…"
              className="w-full rounded-xl border border-line bg-panel-3/60 px-3.5 py-2.5 text-sm leading-relaxed text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent-line focus:ring-2 focus:ring-accent/20 transition-colors resize-y"
            />
            <div className="mt-1.5 flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!narrationDirty || busyUpdate || anyBusy}
                onClick={() => onUpdate(scene.id, { narration: narrationDraft.trim() || null })}
              >
                {busyUpdate ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                Save narration
              </Button>
              <span className="text-[11px] text-ink-faint">
                {narrationDirty ? "Unsaved narration" : `${narrationDraft.length} characters · user-written`}
              </span>
            </div>
          </>
        ) : (
          <p className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel-2/40 px-2 py-1 text-xs text-ink-faint">
            <Lock size={10} /> AI narration — awaiting a connected provider. Write your own narration when you’re
            ready.
          </p>
        )}
      </div>

      {/* ------------------------------------------------ duration */}
      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label>Duration</Label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={1}
              max={7200}
              value={durationDraft}
              onChange={(e) => setDurationDraft(e.target.value)}
              onBlur={() => {
                if (durationDirty) onUpdate(scene.id, { durationSeconds: durationNum });
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && durationDirty) {
                  e.currentTarget.blur();
                  onUpdate(scene.id, { durationSeconds: durationNum });
                }
              }}
              className="h-9 w-full rounded-lg border border-line bg-panel-3/60 px-3 text-sm text-ink focus:outline-none focus:border-accent-line focus:ring-2 focus:ring-accent/20 transition-colors"
              aria-label="Scene duration in seconds"
            />
            <span className="text-xs text-ink-faint">s</span>
          </div>
          {durationDirty ? <p className="mt-1 text-[11px] text-accent">Unsaved — press Enter or blur to save.</p> : null}
        </div>
        <Field label="Recommended footage" value={mediaLabel(scene.mediaType)} />
        <Field label="Camera movement" value={scene.camera ?? "—"} />
        <Field label="Transition" value="—" />
        <Field label="Music mood" value={meta?.musicMood ?? "—"} />
        <Field label="Sound effect" value="—" />
        <Field label="Subtitle" value={subtitleLabel(meta?.subtitleEnabled ?? null)} />
        <Field label="Voice timing" value="—" />
        <Field label="Visual description" value={visualDescription(scene.visualPrompt)} wide />
      </div>

      {/* ------------------------------------------------ AI visual requirement */}
      <div className="mt-3">
        <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
          AI-generated visual requirement
        </p>
        {scene.visualPrompt ? (
          <p className="rounded-xl border border-line bg-void px-3.5 py-2.5 font-mono text-[11px] leading-relaxed text-ink-dim">
            {scene.visualPrompt}
          </p>
        ) : (
          <p className="rounded-xl border border-line bg-panel-2/40 px-3.5 py-2.5 text-xs text-ink-faint">—</p>
        )}
        {scene.clips && scene.clips.length > 0 ? (
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
              Clip plan · {scene.clips.length} clip{scene.clips.length === 1 ? "" : "s"}
            </span>
            {scene.clips.map((c, i) => (
              <span key={i} className="rounded-md border border-line bg-panel-2/60 px-1.5 py-0.5 font-mono text-[10px] text-ink-dim">
                {c}s
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* ------------------------------------------------ actions */}
      <div className="mt-3.5 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={onReroll} disabled={anyBusy}>
          {busyReroll ? <Loader2 size={13} className="animate-spin" /> : <RefreshCcw size={13} />}
          Re-roll visual (template)
        </Button>
        <Button size="sm" variant="outline" onClick={onAiVisual} disabled={anyBusy}>
          {busyVisual ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          AI generate visual
        </Button>
        <Button size="sm" variant="outline" onClick={onRegenerate} disabled={anyBusy}>
          {busyRegen ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          Regenerate scene (AI)
        </Button>
      </div>

      {aiVisual ? (
        <div className="mt-3">
          <AiResultPanel result={aiVisual} />
        </div>
      ) : null}
      {aiRegen ? (
        <div className="mt-3">
          <AiResultPanel result={aiRegen} />
        </div>
      ) : null}
    </li>
  );
}

function Field({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={wide ? "sm:col-span-2 lg:col-span-4" : undefined}>
      <Label>{label}</Label>
      <p className="min-h-[2.25rem] rounded-lg border border-line bg-panel-2/40 px-3 py-2 text-sm leading-relaxed text-ink">
        {value}
      </p>
    </div>
  );
}

function IconButton({
  children,
  title,
  disabled,
  danger,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={onClick}
      className={[
        "inline-flex h-7 w-7 items-center justify-center rounded-lg border transition-colors cursor-pointer disabled:opacity-40 disabled:pointer-events-none",
        danger
          ? "border-danger/20 text-ink-dim hover:border-danger/40 hover:text-danger"
          : "border-line text-ink-dim hover:bg-panel-2 hover:text-ink",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Visual Selection panel (Phase 3)                                    */
/* ------------------------------------------------------------------ */

function ScoreBar({ value }: { value: number }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-panel-2">
        <div className="h-full rounded-full bg-accent" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
      <span className="w-8 text-right font-mono text-[11px] text-ink-dim">{value}</span>
    </div>
  );
}

function CandidateRow({ candidate, primary }: { candidate: VisualCandidate; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-line bg-panel-3/40 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        {primary ? (
          <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-accent">
            Primary
          </span>
        ) : null}
        <span className="text-xs font-medium text-ink">{candidate.label}</span>
        <span className="rounded-md border border-line bg-panel-2/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-ink-faint">
          {candidate.kind}
        </span>
        <div className="ml-auto">
          <ScoreBar value={candidate.mScore} />
        </div>
      </div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="mt-1.5 text-left text-[11px] leading-relaxed text-ink-dim hover:text-ink transition-colors cursor-pointer"
      >
        <span className="text-accent">{open ? "hide" : "why"}</span> — {candidate.label}
      </button>
      {open ? <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">{candidate.rationale}</p> : null}
    </div>
  );
}

function VisualSelectionPanel({
  assignments,
  continuity,
}: {
  assignments: SceneVisualAssignment[];
  continuity: ContinuityState | null;
}) {
  return (
    <div className="glass p-5">
      <div className="flex items-center gap-2">
        <Wand2 size={15} className="text-accent" />
        <h3 className="font-display text-sm font-semibold text-ink">Visual Selection</h3>
        <span className="ml-auto text-[11px] text-ink-faint">deterministic rule-based ranking · not AI output</span>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-5 lg:grid-cols-[240px_1fr]">
        {/* continuity sidebar */}
        <div className="rounded-xl border border-line bg-panel-3/40 p-4">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Visual continuity</p>
          {continuity ? (
            <div className="space-y-2 text-xs text-ink-dim">
              <div>
                <span className="text-ink">Style · </span>
                <span className="text-accent">{continuity.stylePreset ?? "—"}</span>
              </div>
              <div>
                <span className="text-ink">Lighting · </span>
                {continuity.lighting ?? "—"}
              </div>
              {continuity.palette.length ? (
                <div>
                  <span className="text-ink">Palette · </span>
                  {continuity.palette.join(", ")}
                </div>
              ) : null}
              <ContinuityList label="Characters" items={continuity.characters} />
              <ContinuityList label="Locations" items={continuity.locations} />
              <ContinuityList label="Props" items={continuity.props} />
            </div>
          ) : (
            <p className="text-xs text-ink-faint">No scenes were scanned.</p>
          )}
        </div>

        {/* per-scene assignments */}
        <div className="space-y-3">
          {assignments.length === 0 ? (
            <p className="text-xs text-ink-faint">No scene assignments.</p>
          ) : (
            assignments.map((a) => (
              <div key={a.sceneId} className="rounded-xl border border-line bg-panel-2/30 p-3">
                <div className="flex items-center gap-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-accent-soft text-[11px] font-bold text-accent border border-accent-line/40">
                    {a.order}
                  </span>
                  <span className="text-sm font-medium text-ink">{a.title ?? `Scene ${a.order}`}</span>
                </div>
                <div className="mt-2 space-y-2">
                  <CandidateRow candidate={a.chosen} primary />
                  {a.alternates.slice(0, 2).map((c) => (
                    <CandidateRow key={c.id} candidate={c} />
                  ))}
                </div>
                {a.continuityNotes.length ? (
                  <div className="mt-2 rounded-lg bg-void px-3 py-2">
                    <p className="mb-1 text-[9px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Continuity</p>
                    <ul className="space-y-0.5 text-[11px] leading-relaxed text-ink-dim">
                      {a.continuityNotes.map((n, i) => (
                        <li key={i}>• {n}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function ContinuityList({ label, items }: { label: string; items: { name: string; scenes: number[] }[] }) {
  if (!items.length) return null;
  return (
    <div>
      <span className="text-ink">{label} · </span>
      {items.map((e) => (
        <span key={e.name}>
          {e.name}
          <span className="text-ink-faint"> ({e.scenes.length}×)</span>
          {", "}
        </span>
      ))}
    </div>
  );
}
