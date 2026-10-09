"use client";

/**
 * Magic Create screen — the honest post-CREATE state.
 *
 * Shows the spec progression ("Analyzing your idea…" → "Writing the script…"
 * → "Creating storyboard…" → "Finding cinematic visuals…" → …). The first two
 * steps completed FOR REAL on the server (analyze + structure plan persisted
 * as Script/Chapter/Scene rows). The first step that needs AI generation
 * (script writing) stops at the data-driven "Provider Not Connected" panel —
 * fetched from /api/ai/status, never hardcoded, never animated past.
 */
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, Clapperboard, Loader2, PlugZap } from "lucide-react";
import { Badge, PageHeader } from "@/components/ui";
import { apiFetch } from "@/components/projects/client-api";
import type { ScriptTree } from "@/lib/studio/pipeline";
import type { CapabilityStatusDto } from "@/components/ai-capability-status";

interface MagicState {
  tree: ScriptTree | null;
  capability: CapabilityStatusDto | undefined;
  phase: "loading" | "error" | "ready";
  error?: string;
}

const STEP_ORDER: { id: string; label: string }[] = [
  { id: "analyze", label: "Analyzing your idea…" },
  { id: "structure", label: "Building the structure plan…" },
  { id: "script", label: "Writing the script…" },
  { id: "storyboard", label: "Creating storyboard…" },
  { id: "visuals", label: "Finding cinematic visuals…" },
  { id: "voice", label: "Recording voiceover…" },
  { id: "music", label: "Composing music…" },
  { id: "export", label: "Rendering final video…" },
];

export function MagicCreateScreen({ projectId }: { projectId: string }) {
  const [state, setState] = useState<MagicState>({ tree: null, capability: undefined, phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      apiFetch<ScriptTree>(`/api/projects/${projectId}/script`),
      apiFetch<{ capabilities: CapabilityStatusDto[] }>("/api/ai/status"),
    ])
      .then(([tree, status]) => {
        if (cancelled) return;
        setState({
          tree,
          capability: status.capabilities.find((c) => c.capability === "script_generation"),
          phase: "ready",
        });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          tree: null,
          capability: undefined,
          phase: "error",
          error: err instanceof Error ? err.message : "Could not load the magic create state.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const summary = useMemo(() => {
    const chapters = state.tree?.script?.chapters ?? [];
    const scenes = chapters.flatMap((c) => c.scenes);
    const total = scenes.reduce((a, s) => a + (s.durationSeconds ?? 0), 0);
    return { chapterCount: chapters.length, sceneCount: scenes.length, totalSeconds: total };
  }, [state.tree]);

  const blocked = state.phase === "ready" && state.capability?.status !== "connected";

  if (state.phase === "loading") {
    return (
      <div className="glass flex flex-col items-center gap-4 px-6 py-20 text-center">
        <Loader2 size={22} className="animate-spin text-accent" />
        <p className="text-sm text-ink-dim">Loading your project…</p>
      </div>
    );
  }

  if (state.phase === "error") {
    return (
      <div className="glass flex flex-col items-center gap-4 border-danger/30 px-6 py-16 text-center">
        <h2 className="font-display text-lg font-semibold text-ink">Could not load the project</h2>
        <p className="mx-auto max-w-xl text-sm leading-relaxed text-ink-dim">
          {state.error} The project may still exist — check My Projects.
        </p>
        <Link
          href="/projects"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-[#171208] hover:bg-accent-strong transition-all"
        >
          Go to My Projects <ArrowRight size={15} />
        </Link>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Magic Create"
        description="Your structure plan is ready — script and visuals follow once providers are connected."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
        {/* -------------------------------------------------- step list */}
        <div className="glass p-6 sm:p-8">
          <ol className="space-y-1">
            {STEP_ORDER.map((s, i) => {
              const isAnalyze = s.id === "analyze";
              const isStructure = s.id === "structure";
              const isScript = s.id === "script";
              const done = isAnalyze || (isStructure && summary.chapterCount > 0);
              const blockedStep = blocked && isScript;
              return (
                <li
                  key={s.id}
                  className={[
                    "flex items-start gap-3.5 rounded-xl px-4 py-3.5",
                    blockedStep ? "border border-accent-line/40 bg-accent-soft/30" : "",
                  ].join(" ")}
                >
                  <span
                    className={[
                      "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[11px] font-bold",
                      done
                        ? "border-ok/40 bg-ok/10 text-ok"
                        : blockedStep
                          ? "border-accent bg-accent text-void"
                          : "border-line bg-panel-2 text-ink-faint",
                    ].join(" ")}
                  >
                    {done ? <Check size={13} /> : blockedStep ? <PlugZap size={13} /> : i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={
                          done
                            ? "text-sm font-medium text-ink"
                            : blockedStep
                              ? "text-sm font-semibold text-accent"
                              : "text-sm font-medium text-ink-faint"
                        }
                      >
                        {s.label}
                      </span>
                      {done ? (
                        <Badge tone="ok" className="text-[10px] uppercase tracking-wider">
                          Completed — real
                        </Badge>
                      ) : blockedStep ? (
                        <Badge tone="accent" className="text-[10px] uppercase tracking-wider">
                          Needs provider
                        </Badge>
                      ) : (
                        <Badge tone="neutral" className="text-[10px] uppercase tracking-wider">
                          Pending
                        </Badge>
                      )}
                    </div>
                    {s.id === "analyze" && done ? (
                      <p className="mt-1 text-xs leading-relaxed text-ink-dim">
                        {state.tree?.meta?.structureName
                          ? `Structure selected: ${state.tree.meta.structureName}.`
                          : "Input analyzed and structure selected."}{" "}
                        Deterministic heuristics — no AI involved.
                      </p>
                    ) : null}
                    {s.id === "structure" && done ? (
                      <p className="mt-1 text-xs leading-relaxed text-ink-dim">
                        {summary.chapterCount} chapters · {summary.sceneCount} scenes · {summary.totalSeconds}s
                        total — persisted as real Script/Chapter/Scene rows with exact durations. This is the
                        structure plan (template), not AI-written text.
                      </p>
                    ) : null}
                    {blockedStep && state.capability ? (
                      <p className="mt-1 text-xs leading-relaxed text-ink-dim">
                        Script writing requires an AI provider. The pipeline stops here honestly — it will not
                        fake the remaining steps.
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ol>

          {/* ------------------------------------------ blocked panel */}
          {blocked && state.capability ? (
            <div className="mt-6">
              <NotConnectedPanel capability={state.capability} />
            </div>
          ) : null}
        </div>

        {/* ----------------------------------------------------- sidebar */}
        <div className="space-y-4">
          <div className="glass p-5">
            <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold text-ink">
              <Clapperboard size={14} className="text-accent" /> Structure plan
            </h2>
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-ink-faint">Chapters</dt>
                <dd className="font-medium text-ink">{summary.chapterCount}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-faint">Scenes</dt>
                <dd className="font-medium text-ink">{summary.sceneCount}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-faint">Total duration</dt>
                <dd className="font-medium text-ink">{formatDuration(summary.totalSeconds)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-ink-faint">Script text</dt>
                <dd className="font-medium text-ink">Awaiting provider</dd>
              </div>
            </dl>
          </div>

          <div className="glass p-5">
            <h2 className="mb-3 font-display text-sm font-semibold text-ink">What happens next</h2>
            <ul className="space-y-2 text-xs leading-relaxed text-ink-dim">
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
                Your structure plan is saved and versioned — open it to review chapters, scenes, durations and
                template visual prompts.
              </li>
              <li className="flex gap-2">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
                When a provider key is added to the server, “Generate Script” runs through the AI Model
                Orchestrator, which ranks the providers that can serve the step and falls through to the next
                ranked one when an attempt fails.
              </li>
            </ul>
            <Link
              href={`/projects/${projectId}`}
              className="mt-4 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent px-6 text-base font-medium text-[#171208] hover:bg-accent-strong shadow-[0_8px_24px_rgba(232,180,90,0.25)] transition-all"
            >
              Open project <ArrowRight size={15} />
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}

function NotConnectedPanel({ capability }: { capability: CapabilityStatusDto }) {
  return (
    <div className="flex flex-col items-center gap-4 rounded-2xl border border-accent-line/30 bg-panel-2/40 px-6 py-10 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-soft border border-accent-line text-accent">
        <PlugZap size={20} strokeWidth={1.75} />
      </span>
      <div>
        <h3 className="font-display text-base font-semibold text-ink">Provider Not Connected</h3>
        <p className="mx-auto mt-1.5 max-w-lg text-sm leading-relaxed text-ink-dim">
          {capability.label} needs an AI provider. No provider is configured and wired on this server, so the
          pipeline stops here — nothing is simulated.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-ink-faint">Requires server-side env:</span>
        {capability.requiredEnv.length > 0 ? (
          capability.requiredEnv.map((k) => (
            <Badge key={k} tone="neutral" className="font-mono normal-case tracking-normal">
              {k}
            </Badge>
          ))
        ) : (
          <Badge tone="neutral">No provider slots registered</Badge>
        )}
      </div>
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
