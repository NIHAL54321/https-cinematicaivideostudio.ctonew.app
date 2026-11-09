"use client";

/**
 * Workspace Script tab — renders the REAL structure plan for the project:
 * source text, structure meta, chapters → scenes with exact durations,
 * template visual prompts, and honest per-scene "awaiting provider" narration
 * placeholders. AI buttons (Generate Script / Generate Hook) call the AI Model
 * Orchestrator and render its real result — "Provider Not Connected" in Phase 1.
 * Nothing is simulated and template output is always labeled as template.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Clapperboard,
  Film,
  Loader2,
  Lock,
  PenLine,
  RefreshCcw,
  Sparkles,
} from "lucide-react";
import { Badge, Button } from "@/components/ui";
import { AiResultPanel } from "@/components/projects/ai-result-panel";
import { apiFetch } from "@/components/projects/client-api";
import type { ScriptTree } from "@/lib/studio/pipeline";
import type { AiResult } from "@/lib/ai/types";
import { generateHookOptions, type HookOption } from "@/lib/studio/hooks";
import { readScriptTreeBody, storyboardView, type ScriptCapabilityState } from "@/lib/studio/storyboard-view";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; tree: ScriptTree };

type AiState =
  | { id: "script" | "hook"; phase: "idle" }
  | { id: "script" | "hook"; phase: "running" }
  | { id: "script" | "hook"; phase: "result"; result: AiResult };

export function ScriptTab({ projectId }: { projectId: string }) {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  const [ai, setAi] = useState<AiState>({ id: "script", phase: "idle" });
  /* Same honest-state input the Storyboard tab uses: "the script step is
   * blocked for lack of a provider" is only said when /api/ai/status says so. */
  const [scriptCapability, setScriptCapability] = useState<ScriptCapabilityState>(null);

  const load = useCallback(async () => {
    setState({ phase: "loading" });
    try {
      const body = await apiFetch<unknown>(`/api/projects/${projectId}/script`);
      const tree = readScriptTreeBody(body);
      if (!tree) throw new Error("The script response carried no structure tree.");
      setState({ phase: "ready", tree });
    } catch (e) {
      setState({ phase: "error", message: e instanceof Error ? e.message : "Could not load the script." });
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    apiFetch<{ capabilities: { capability: string; status: string; requiredEnv?: string[] }[] }>("/api/ai/status")
      .then((res) => {
        if (cancelled) return;
        const c = res.capabilities?.find((x) => x.capability === "script_generation");
        setScriptCapability(c ? { status: c.status, requiredEnv: c.requiredEnv ?? [] } : null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const tree = state.phase === "ready" ? state.tree : null;
  /* ONE derivation shared with the Storyboard tab, so the two tabs can never
   * describe the same project's structure differently. */
  const view = storyboardView(tree, scriptCapability);
  const chapters = view.kind === "scenes" ? view.chapters : [];
  const scenes = view.kind === "scenes" ? view.scenes : [];
  const totalSeconds = view.kind === "scenes" ? view.totalSeconds : 0;

  const hookOptions = useMemo<HookOption[]>(() => {
    const topic = tree?.meta?.sourceText;
    if (!topic || topic.trim().length < 3) return [];
    return generateHookOptions({ topic, tone: tree.meta?.style ?? "cinematic", maxOptions: 8 });
  }, [tree?.meta?.sourceText, tree?.meta?.style]);

  async function runAi(id: "script" | "hook") {
    setAi({ id, phase: "running" });
    try {
      const res = await apiFetch<{ result: AiResult }>(
        id === "script" ? `/api/projects/${projectId}/script/generate` : `/api/projects/${projectId}/hook/generate`,
        { method: "POST" },
      );
      setAi({ id, phase: "result", result: res.result });
    } catch (e) {
      const fake: AiResult = {
        status: "failed",
        capability: id === "script" ? "script_generation" : "reasoning",
        taskType: id === "script" ? "SCRIPT" : "REASON",
        attempts: [],
        error: e instanceof Error ? e.message : "Request failed.",
        requiredEnv: [],
      };
      setAi({ id, phase: "result", result: fake });
    }
  }

  if (state.phase === "loading") {
    return (
      <div className="glass flex items-center justify-center gap-2.5 px-6 py-16 text-sm text-ink-dim">
        <Loader2 size={15} className="animate-spin text-accent" /> Loading script structure…
      </div>
    );
  }
  if (state.phase === "error") {
    return (
      <div className="glass flex flex-col items-center gap-3 border-danger/30 px-6 py-12 text-center">
        <h3 className="font-display text-base font-semibold text-ink">Could not load the script</h3>
        <p className="max-w-md text-sm text-ink-dim">{state.message}</p>
        <Button variant="outline" size="sm" onClick={() => void load()}>
          <RefreshCcw size={13} /> Retry
        </Button>
      </div>
    );
  }

  /* Which rows are missing is named, never generalised into "no structure
   * plan yet" — that sentence now appears only when no Script row exists. */
  if (view.kind === "empty") {
    return (
      <div className="glass flex flex-col items-center gap-3 px-6 py-14 text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-panel-2 border border-line text-ink-dim">
          <Clapperboard size={20} strokeWidth={1.75} />
        </span>
        <h3 className="font-display text-base font-semibold text-ink">{view.title}</h3>
        <p className="mx-auto max-w-md text-sm leading-relaxed text-ink-dim">{view.body}</p>
        <p className="mx-auto max-w-md text-xs text-ink-faint">{view.detail}</p>
      </div>
    );
  }

  const treeMeta = tree?.meta ?? null;
  const sourceText = treeMeta?.sourceText ?? null;
  const structureName = treeMeta?.structureName ?? null;

  return (
    <div className="space-y-5">
      {view.missingScript ? (
        <div className="glass flex items-start gap-3 rounded-xl border-accent-line/30 px-4 py-3">
          <Lock size={15} className="mt-0.5 shrink-0 text-accent" />
          <div className="text-[13px] leading-relaxed text-ink-dim">
            <span className="font-medium text-ink">No narration text on any scene.</span>{" "}
            {view.missingScript.sentence}
          </div>
        </div>
      ) : null}

      {/* ---------------------------------------------------- meta + actions */}
      <div className="glass p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">{structureName ?? "Structure plan"}</Badge>
          <Badge tone="neutral">{chapters.length} chapters</Badge>
          <Badge tone="neutral">{scenes.length} scenes</Badge>
          <Badge tone="neutral">{formatDuration(totalSeconds)}</Badge>
          <span className="ml-auto text-[11px] text-ink-faint">structure-template · not AI-written text</span>
        </div>

        {sourceText ? (
          <div className="mt-4">
            <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
              Source text
            </p>
            <p className="rounded-xl border border-line bg-panel-3/50 px-4 py-3 text-sm leading-relaxed text-ink-dim">
              {sourceText}
            </p>
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2.5">
          <Button size="sm" onClick={() => void runAi("script")} disabled={ai.phase === "running"}>
            {ai.phase === "running" && ai.id === "script" ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <PenLine size={13} />
            )}
            Generate Script (AI)
          </Button>
          <Button size="sm" variant="outline" onClick={() => void runAi("hook")} disabled={ai.phase === "running"}>
            {ai.phase === "running" && ai.id === "hook" ? (
              <Loader2 size={13} className="animate-spin" />
            ) : (
              <Sparkles size={13} />
            )}
            Generate Hook (AI)
          </Button>
        </div>

        {ai.phase === "result" ? (
          <div className="mt-3">
            <AiResultPanel result={ai.result} />
          </div>
        ) : null}
      </div>

      {/* ------------------------------------------- template hooks (labeled) */}
      {hookOptions.length > 0 ? (
        <div className="glass p-5">
          <div className="mb-1 flex items-center gap-2">
            <Sparkles size={14} className="text-accent" />
            <h3 className="font-display text-sm font-semibold text-ink">Template hook options</h3>
            <Badge tone="neutral" className="text-[10px] uppercase tracking-wider">
              Templates — not AI
            </Badge>
          </div>
          <p className="mb-3 text-xs leading-relaxed text-ink-faint">
            Deterministic templates with your topic inserted (src/lib/studio/hooks.ts). Replace with AI-written or
            human copy later — statistics hooks show “[verified statistic]” until real sourced data is supplied.
          </p>
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {hookOptions.map((h, i) => (
              <li key={`${h.type}-${i}`} className="rounded-xl border border-line bg-panel-2/50 px-3.5 py-2.5">
                <p className="text-sm leading-relaxed text-ink">{h.text}</p>
                <p className="mt-1 text-[11px] capitalize text-ink-faint">
                  {h.type} · {h.statistic ? `real stat (${h.statistic.source})` : "template"}
                </p>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* ---------------------------------------------------- chapters */}
      {chapters.map((chapter) => {
        const chDuration = chapter.scenes.reduce((a, s) => a + (s.durationSeconds ?? 0), 0);
        const isHook = chapter.order === 1;
        return (
          <div key={chapter.id} className="glass overflow-hidden">
            <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-5 py-3.5">
              <span
                className={[
                  "flex h-7 w-7 items-center justify-center rounded-lg text-[11px] font-bold",
                  isHook ? "bg-accent-soft text-accent" : "bg-panel-2 text-ink-dim",
                ].join(" ")}
              >
                {chapter.order}
              </span>
              <h3 className="font-display text-sm font-semibold text-ink">{chapter.title}</h3>
              {isHook ? (
                <Badge tone="accent" className="text-[10px] uppercase tracking-wider">
                  Hook
                </Badge>
              ) : null}
              <span className="ml-auto text-xs text-ink-faint">{formatDuration(chDuration)}</span>
            </div>
            {chapter.summary ? (
              <p className="border-b border-line-soft px-5 py-2.5 text-xs leading-relaxed text-ink-dim">
                {chapter.summary}
              </p>
            ) : null}
            <ul className="divide-y divide-line-soft">
              {chapter.scenes.map((scene) => (
                <li key={scene.id} className="px-5 py-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Film size={13} className="text-ink-faint" />
                    <span className="text-[13px] font-medium text-ink">{scene.title ?? `Scene ${scene.order}`}</span>
                    <span className="text-xs text-ink-faint">{formatDuration(scene.durationSeconds ?? 0)}</span>
                    <Badge tone="neutral" className="text-[10px] normal-case tracking-normal">
                      {scene.status.toLowerCase()}
                    </Badge>
                  </div>
                  <div className="mt-2 space-y-1.5 text-xs leading-relaxed">
                    {scene.narration ? (
                      <p className="text-ink">{scene.narration}</p>
                    ) : (
                      <p className="inline-flex items-center gap-1.5 rounded-md border border-line bg-panel-2/40 px-2 py-1 text-ink-faint">
                        <Lock size={10} /> AI narration — awaiting a connected provider
                      </p>
                    )}
                    {scene.visualPrompt ? (
                      <p className="text-ink-faint">
                        <span className="font-medium text-ink-dim">Visual prompt (template):</span>{" "}
                        {scene.visualPrompt}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function formatDuration(seconds: number): string {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  return `${seconds}s`;
}
