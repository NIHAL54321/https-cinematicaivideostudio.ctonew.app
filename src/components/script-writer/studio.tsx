"use client";

/**
 * AI Script Writer Studio — the last Phase 2 builder UI.
 *
 * Deterministic engines run FOR REAL (structure selection, template hooks,
 * retention heuristics, composed outline). Anything that needs AI generation —
 * "Generate Hook (AI)" and the Script Intelligence actions — routes through the
 * AI Model Orchestrator (POST /api/studio/script-writer) and honestly renders
 * the data-driven "Provider Not Connected" state until a provider is wired.
 * No fake AI, no fabricated statistics.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Clapperboard,
  FilePenLine,
  Layers,
  Lightbulb,
  Loader2,
  PenLine,
  RefreshCcw,
  Sparkles,
  Wand2,
} from "lucide-react";
import { Badge, Button, Card, Label } from "@/components/ui";
import { AiResultPanel } from "@/components/projects/ai-result-panel";
import { apiFetch } from "@/components/projects/client-api";
import { HOOK_TYPES, generateHookOptions, type HookOption, type HookTypeId } from "@/lib/studio/hooks";
import { TONES } from "@/lib/studio/tones";
import { VIDEO_TYPES, videoTypeByIdOrFirst } from "@/lib/studio/video-types";
import { selectStructure } from "@/lib/studio/structures";
import { analyzeRetention, RECOMMENDATION_TYPES, type RecommendationType } from "@/lib/studio/retention";
import { splitDuration } from "@/lib/studio/budgeting";
import { DURATION_OPTIONS, DURATION_LABELS, type VideoFormat } from "@/lib/studio/types";
import type { AiResult } from "@/lib/ai/types";

const DURATION_LIST = [...DURATION_OPTIONS];

function durationToFormat(seconds: number): VideoFormat {
  if (seconds <= 180) return "SHORT";
  if (seconds <= 300) return "SOCIAL";
  return "LONG";
}

function orchestratorVideoType(format: VideoFormat): "longform" | "shorts" | "clip" {
  return format === "LONG" ? "longform" : format === "SHORT" ? "shorts" : "clip";
}

function formatDuration(seconds: number): string {
  if (seconds >= 60) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return s > 0 ? `${m}m ${s}s` : `${m}m`;
  }
  return `${seconds}s`;
}

function sceneCountFor(chapterSeconds: number): number {
  return Math.min(6, Math.max(1, Math.round(chapterSeconds / 45)));
}

interface OutlineChapter {
  order: number;
  name: string;
  purpose: string;
  role: string;
  seconds: number;
}

interface Outline {
  format: VideoFormat;
  structureId: string;
  structureName: string;
  chapters: OutlineChapter[];
  totalSeconds: number;
  hookSeconds: number;
  hookText: string;
  toneName: string;
  sceneCount: number;
}

const INTELLIGENCE_BUTTONS: { directive: string; label: string; icon: typeof PenLine }[] = [
  { directive: "improve", label: "Improve Script", icon: PenLine },
  { directive: "engaging", label: "Make More Engaging", icon: Activity },
  { directive: "emotional", label: "Make More Emotional", icon: Sparkles },
  { directive: "concise", label: "Make More Concise", icon: FilePenLine },
  { directive: "professional", label: "Make More Professional", icon: Layers },
  { directive: "retention", label: "Increase Retention", icon: Activity },
];

const RECOMMENDATION_LABELS: Record<RecommendationType, string> = {
  pattern_interrupt: "Pattern interrupt",
  curiosity_loop: "Curiosity loop",
  question: "Question",
  statistic: "Statistic",
  example: "Example",
  emotional_moment: "Emotional moment",
  story_transition: "Story transition",
  visual_change: "Visual change",
};

export function ScriptWriterStudio({ projectId }: { projectId?: string }) {
  const [topic, setTopic] = useState("");
  const [videoTypeId, setVideoTypeId] = useState("documentary");
  const [toneId, setToneId] = useState("cinematic");
  const [duration, setDuration] = useState<number>(300);

  // Hook engine state.
  const [hookTypeId, setHookTypeId] = useState<HookTypeId>("curiosity");
  const [hookOptions, setHookOptions] = useState<HookOption[]>([]);
  const [usedHooks, setUsedHooks] = useState<HookOption[]>([]);
  const [selectedIdx, setSelectedIdx] = useState(0);
  // Rotation counter — each Replace shifts to a fresh deterministic template set.
  const [hookVariant, setHookVariant] = useState(0);

  // AI results (honest orchestrator output; not_connected in Phase 1).
  const [aiHook, setAiHook] = useState<AiResult | null>(null);
  const [runningHook, setRunningHook] = useState(false);
  const [aiIntent, setAiIntent] = useState<{ label: string; result: AiResult } | null>(null);
  const [runningIntent, setRunningIntent] = useState<string | null>(null);

  const topicReady = topic.trim().length >= 3;
  const videoType = videoTypeByIdOrFirst(videoTypeId);
  const format = durationToFormat(duration);
  const tone = TONES.find((t) => t.id === toneId);

  // ------------------------------------------------------------------ derive
  const selection = useMemo(() => {
    if (!topicReady) return null;
    return selectStructure(format, `${videoType.name} ${topic}`);
  }, [topicReady, format, videoType.name, topic]);

  const structure = selection?.structure;

  const outline = useMemo<Outline | null>(() => {
    if (!structure || !topicReady) return null;
    const sizes = splitDuration(duration, structure.beats.map((b) => b.share));
    const chapters = structure.beats.map((b, i) => ({
      order: i + 1,
      name: b.name,
      purpose: b.purpose,
      role: b.role,
      seconds: sizes[i],
    }));
    const hookSeconds = sizes[0] ?? 0;
    const sceneCount = chapters.reduce((a, c) => a + sceneCountFor(c.seconds), 0);
    const selectedHook = hookOptions[selectedIdx];
    const hookText = selectedHook ? selectedHook.text : `Hook of type “${HOOK_TYPES.find((h) => h.id === hookTypeId)?.name}”`;
    return {
      format,
      structureId: structure.id,
      structureName: structure.name,
      chapters,
      totalSeconds: duration,
      hookSeconds,
      hookText,
      toneName: tone?.name ?? "—",
      sceneCount,
    };
  }, [structure, topicReady, duration, hookOptions, selectedIdx, hookTypeId, tone?.name, format]);

  const retention = useMemo(() => {
    if (!outline || !structure) return null;
    const hookOption = hookOptions[selectedIdx];
    return analyzeRetention({
      structureId: structure.id,
      hookType: hookOption ? hookOption.type : hookTypeId,
      totalDurationSeconds: outline.totalSeconds,
      chapterCount: outline.chapters.length,
      sceneCount: outline.sceneCount,
      hookSeconds: outline.hookSeconds,
      beatNames: outline.chapters.map((c) => c.name),
    });
  }, [outline, structure, hookOptions, selectedIdx, hookTypeId]);

  // ------------------------------------------------------------ hook engine
  function generateTemplates() {
    if (!topicReady) return;
    setHookVariant(0);
    const all = generateHookOptions({ topic: topic.trim(), tone: toneId, maxOptions: 24 });
    const filtered = all.filter((o) => o.type === hookTypeId).slice(0, 3);
    setHookOptions(filtered);
    setUsedHooks(filtered);
    setSelectedIdx(0);
    setAiHook(null);
  }

  function replaceSelectedHook() {
    if (!topicReady || hookOptions.length === 0) return;
    // Deterministic rotation: vary the tone string hash so the next set draws
    // different templates for the chosen hook type. Honest — never AI, just
    // template rotation.
    const next = hookVariant + 1;
    setHookVariant(next);
    const all = generateHookOptions({ topic: topic.trim(), tone: `${toneId}:${next}`, maxOptions: 24 });
    const filtered = all.filter((o) => o.type === hookTypeId).slice(0, 3);
    setHookOptions(filtered);
    setUsedHooks(filtered);
    setSelectedIdx(0);
    setAiHook(null);
  }

  async function runAiHook() {
    if (!topicReady) return;
    setRunningHook(true);
    setAiHook(null);
    try {
      const res = await apiFetch<{ result: AiResult }>("/api/studio/script-writer", {
        method: "POST",
        body: JSON.stringify({
          action: "hook",
          topic: topic.trim(),
          tone: toneId,
          videoType: orchestratorVideoType(format),
        }),
      });
      setAiHook(res.result);
    } catch (e) {
      setAiHook(makeFailed("reasoning", "REASON", e));
    } finally {
      setRunningHook(false);
    }
  }

  async function runIntelligence(directive: string, label: string) {
    if (!topicReady) return;
    setRunningIntent(directive);
    setAiIntent(null);
    try {
      const res = await apiFetch<{ result: AiResult }>("/api/studio/script-writer", {
        method: "POST",
        body: JSON.stringify({
          action: "intelligence",
          directive,
          topic: topic.trim(),
          tone: toneId,
          videoType: orchestratorVideoType(format),
          durationSeconds: duration,
          outline: outlineText(outline),
        }),
      });
      setAiIntent({ label, result: res.result });
    } catch (e) {
      setAiIntent({ label, result: makeFailed("script_generation", "SCRIPT", e) });
    } finally {
      setRunningIntent(null);
    }
  }

  const recommendedMatches = structure ? selection?.matchedKeywords ?? [] : [];
  const recsByType = retention
    ? RECOMMENDATION_TYPES.filter((t) => retention.recommendations.some((r) => r.type === t))
    : [];

  return (
    <div className="space-y-6">
      {/* --------------------------------------------------------- input card */}
      <Card className="p-6">
        <div className="mb-5 flex items-start gap-3.5">
          <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft border border-accent-line text-accent">
            <Wand2 size={18} strokeWidth={1.75} />
          </span>
          <div>
            <h2 className="font-display text-xl font-semibold tracking-tight text-ink">Create your script brief</h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-dim">
              Choose the video type, tone and duration, then describe your idea. The studio builds a real structure
              outline — hooks, retention and structure selection run for real; AI writing shows “Provider Not
              Connected”.
            </p>
          </div>
        </div>

        <div className="space-y-5">
          <div>
            <Label>Video type (24)</Label>
            <div className="flex flex-wrap gap-2">
              {VIDEO_TYPES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setVideoTypeId(t.id)}
                  title={t.description}
                  className={[
                    "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                    videoTypeId === t.id
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line bg-panel-2/60 text-ink-dim hover:border-accent-line hover:text-ink",
                  ].join(" ")}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label>Tone (13)</Label>
            <div className="flex flex-wrap gap-2">
              {TONES.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setToneId(t.id)}
                  title={t.description}
                  className={[
                    "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                    toneId === t.id
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line bg-panel-2/60 text-ink-dim hover:border-accent-line hover:text-ink",
                  ].join(" ")}
                >
                  {t.name}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label>Duration</Label>
            <div className="flex flex-wrap gap-2">
              {DURATION_LIST.map((d) => (
                <button
                  key={d}
                  onClick={() => setDuration(d)}
                  className={[
                    "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                    duration === d
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line bg-panel-2/60 text-ink-dim hover:border-accent-line hover:text-ink",
                  ].join(" ")}
                >
                  {DURATION_LABELS[d]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <Label>Topic / idea</Label>
            <textarea
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              rows={4}
              placeholder="e.g. The surprising economics behind why coffee became a global obsession"
              className="w-full rounded-xl border border-line bg-panel-3/60 px-4 py-3.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent-line focus:ring-2 focus:ring-accent/20 transition-colors resize-none"
            />
            {!topicReady ? (
              <p className="mt-1.5 text-xs text-ink-faint">
                Enter at least 3 characters to unlock structure selection, outline, hooks and retention.
              </p>
            ) : null}
            {topicReady ? (
              <p className="mt-1.5 text-xs text-ink-dim">
                Selected structure: <span className="text-accent">{structure?.name ?? "—"}</span> · format{" "}
                <span className="text-ink">{format}</span>
              </p>
            ) : null}
          </div>
        </div>
      </Card>

      {/* ------------------------------------------------- structure + outline */}
      {topicReady && structure && outline && selection ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_340px]">
          <div className="space-y-6">
            {/* Structural recommendation */}
            <Card className="p-6">
              <div className="mb-4 flex items-center gap-2">
                <Lightbulb size={15} className="text-accent" />
                <h3 className="font-display text-sm font-semibold text-ink">Recommended story structure</h3>
                <Badge tone="neutral" className="text-[10px] uppercase tracking-wider">
                  Deterministic heuristic
                </Badge>
              </div>
              <p className="text-sm font-medium text-ink">{structure.name}</p>
              <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-dim">{structure.description}</p>
              <p className="mt-2 text-xs text-ink-faint">
                Chosen by keyboard/format heuristics — not AI.{" "}
                {recommendedMatches.length > 0 ? <>Matched keywords: {recommendedMatches.join(", ")}.</> : null}
              </p>
            </Card>

            {/* Composed script outline */}
            <Card className="p-6">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Clapperboard size={15} className="text-accent" />
                <h3 className="font-display text-sm font-semibold text-ink">Script outline</h3>
                <Badge tone="neutral" className="text-[10px] uppercase tracking-wider">
                  Structure — not AI-written text
                </Badge>
              </div>
              <p className="mb-4 text-xs text-ink-faint">
                A deterministic chapter outline with exact durations from the structure engine. Narration text awaits
                a connected AI provider.
              </p>

              <div className="mb-4 rounded-xl border border-accent-line/30 bg-accent-soft/40 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-accent">Selected hook</p>
                <p className="mt-1 text-sm leading-relaxed text-ink">
                  {hookOptions[selectedIdx]?.text ?? outline.hookText}
                </p>
                <p className="mt-1 text-[11px] text-ink-faint">
                  {hookOptions[selectedIdx]
                    ? `${hookOptions[selectedIdx].type} · template, not AI · ${
                        hookOptions[selectedIdx].statistic ? "real sourced stat" : "“[verified statistic]” placeholder"
                      }`
                    : "Pick a hook below to reflect it here."}
                </p>
              </div>

              <ol className="space-y-2.5">
                {outline.chapters.map((c) => (
                  <li key={c.order} className="flex items-start gap-3 rounded-xl border border-line bg-panel-2/40 px-4 py-3">
                    <span
                      className={[
                        "mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-bold",
                        c.role === "hook"
                          ? "bg-accent-soft text-accent"
                          : c.role === "ending"
                            ? "bg-ok/10 text-ok"
                            : "bg-panel-3 text-ink-dim",
                      ].join(" ")}
                    >
                      {c.order}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-ink">{c.name}</span>
                        <Badge tone="neutral" className="text-[10px] normal-case tracking-normal">
                          {c.role}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs leading-relaxed text-ink-dim">{c.purpose}</p>
                    </div>
                    <span className="shrink-0 text-xs font-medium text-ink-faint">{formatDuration(c.seconds)}</span>
                  </li>
                ))}
              </ol>
            </Card>

            {/* Hook Engine */}
            <Card className="p-6">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <PenLine size={15} className="text-accent" />
                <h3 className="font-display text-sm font-semibold text-ink">Hook Engine</h3>
                <Badge tone="neutral" className="text-[10px] uppercase tracking-wider">
                  Templates — not AI
                </Badge>
              </div>
              <p className="mb-4 text-xs leading-relaxed text-ink-faint">
                Choose a hook type, generate deterministic template options (your topic inserted — never AI copy, no
                invented statistics), pick one, and replace it for a fresh variant.
              </p>

              <Label>Hook type (8)</Label>
              <div className="mb-4 flex flex-wrap gap-2">
                {HOOK_TYPES.map((h) => (
                  <button
                    key={h.id}
                    onClick={() => {
                      setHookTypeId(h.id);
                      setHookOptions([]);
                      setUsedHooks([]);
                      setSelectedIdx(0);
                      setAiHook(null);
                    }}
                    title={h.description}
                    className={[
                      "rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors cursor-pointer",
                      hookTypeId === h.id
                        ? "border-accent bg-accent-soft text-accent"
                        : "border-line bg-panel-2/60 text-ink-dim hover:border-accent-line hover:text-ink",
                    ].join(" ")}
                  >
                    {h.name}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap gap-2.5">
                <Button size="sm" onClick={generateTemplates} disabled={!topicReady}>
                  <Sparkles size={13} /> Generate hook options
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={replaceSelectedHook}
                  disabled={!topicReady || hookOptions.length === 0}
                >
                  <RefreshCcw size={13} /> Replace Hook
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void runAiHook()}
                  disabled={!topicReady || runningHook}
                >
                  {runningHook ? <Loader2 size={13} className="animate-spin" /> : <Wand2 size={13} />}
                  Generate Hook (AI)
                </Button>
              </div>

              {hookOptions.length > 0 ? (
                <div className="mt-4 space-y-2">
                  {hookOptions.map((o, i) => (
                    <button
                      key={`${o.type}-${o.templateId}`}
                      onClick={() => setSelectedIdx(i)}
                      className={[
                        "flex w-full items-start gap-3 rounded-xl border px-4 py-3 text-left transition-colors cursor-pointer",
                        selectedIdx === i
                          ? "border-accent bg-accent-soft/60 ring-1 ring-accent/30"
                          : "border-line bg-panel-2/40 hover:border-accent-line",
                      ].join(" ")}
                    >
                      <span
                        className={[
                          "mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border",
                          selectedIdx === i ? "border-accent bg-accent text-void" : "border-line bg-panel-3",
                        ].join(" ")}
                      >
                        {selectedIdx === i ? "✓" : ""}
                      </span>
                      <span className="min-w-0">
                        <span className="text-sm leading-relaxed text-ink">{o.text}</span>
                        <span className="mt-1 block text-[11px] text-ink-faint">
                          {o.type} · {o.note}
                          {o.statistic ? ` · real stat (${o.statistic.source})` : ""}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}

              {aiHook ? (
                <div className="mt-4">
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                    Generative hook (AI) — orchestrator result
                  </p>
                  <AiResultPanel result={aiHook} />
                </div>
              ) : null}
            </Card>

            {/* Script Intelligence */}
            <Card className="p-6">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <Activity size={15} className="text-accent" />
                <h3 className="font-display text-sm font-semibold text-ink">Script Intelligence</h3>
              </div>
              <p className="mb-4 text-xs leading-relaxed text-ink-faint">
                These transformations require generative AI. They call the AI Model Orchestrator (script generation)
                and report its real result — which is the honest “Provider Not Connected” state when the step
                has no connected provider. Nothing is
                simulated.
              </p>
              <div className="flex flex-wrap gap-2.5">
                {INTELLIGENCE_BUTTONS.map((b) => (
                  <Button
                    key={b.directive}
                    size="sm"
                    variant="outline"
                    onClick={() => void runIntelligence(b.directive, b.label)}
                    disabled={!topicReady || runningIntent !== null}
                  >
                    {runningIntent === b.directive ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <b.icon size={13} />
                    )}
                    {b.label}
                  </Button>
                ))}
              </div>

              {recsByType.length > 0 ? (
                <div className="mt-4 rounded-xl border border-line bg-panel-2/40 px-4 py-3">
                  <p className="mb-2 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wider text-ink-dim">
                    <Lightbulb size={12} className="text-accent" />
                    Deterministic suggestions (heuristic — not AI)
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {recsByType.map((t) => (
                      <Badge key={t} tone="neutral" className="normal-case tracking-normal">
                        {RECOMMENDATION_LABELS[t]}
                      </Badge>
                    ))}
                  </div>
                </div>
              ) : null}

              {aiIntent ? (
                <div className="mt-4">
                  <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                    {aiIntent.label} — orchestrator result
                  </p>
                  <AiResultPanel result={aiIntent.result} />
                </div>
              ) : null}
            </Card>
          </div>

          {/* ------------------------------------------------------------ sidebar */}
          <div className="space-y-4">
            <Card className="p-5">
              <h2 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold text-ink">
                <Activity size={14} className="text-accent" /> Retention analysis
              </h2>
              {retention ? (
                <>
                  <div className="mb-3 flex items-center gap-3">
                    <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-panel-2 text-sm font-bold text-accent">
                      {retention.riskScore}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-ink">Drop-off risk</p>
                      <p className="text-[11px] text-ink-faint">0 = healthy shape · 100 = high risk</p>
                    </div>
                  </div>
                  <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                    Heuristic analysis
                  </p>
                  {retention.risks.length > 0 ? (
                    <ul className="space-y-2">
                      {retention.risks.map((r, i) => (
                        <li key={i} className="flex items-start gap-2 rounded-lg border border-line bg-panel-2/40 px-3 py-2">
                          <Badge
                            tone={r.severity === "high" ? "danger" : r.severity === "medium" ? "accent" : "neutral"}
                            className="mt-0.5 shrink-0 text-[9px] uppercase tracking-wider"
                          >
                            {r.severity}
                          </Badge>
                          <p className="text-xs leading-relaxed text-ink-dim">{r.reason}</p>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-ink-dim">No drop-off risks detected in the outline shape.</p>
                  )}

                  {retention.recommendations.length > 0 ? (
                    <div className="mt-4">
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                        Recommendations
                      </p>
                      <ul className="space-y-2">
                        {retention.recommendations.map((rec, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs leading-relaxed">
                            <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" />
                            <span>
                              <span className="font-medium text-ink">{RECOMMENDATION_LABELS[rec.type]}</span>
                              <span className="text-ink-dim"> — {rec.reason}</span>
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">{retention.honestNote}</p>
                </>
              ) : null}
            </Card>

            <Card className="p-5">
              <h2 className="mb-3 font-display text-sm font-semibold text-ink">Where this goes</h2>
              <p className="mb-3 text-xs leading-relaxed text-ink-dim">
                The outline above is real deterministic structure with exact durations. Narration and script text need
                an AI provider — open a project to see the full Script → Chapters → Scenes flow with the honest
                awaiting-provider state.
              </p>
              {projectId ? (
                <Link
                  href={`/projects/${projectId}`}
                  className="mb-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-[#171208] hover:bg-accent-strong transition-all"
                >
                  Open in project <ArrowRight size={15} />
                </Link>
              ) : (
                <Link
                  href="/create-video"
                  className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent px-4 text-sm font-medium text-[#171208] hover:bg-accent-strong transition-all"
                >
                  Create a project from this idea <ArrowRight size={15} />
                </Link>
              )}
              <p className="text-[11px] text-ink-faint">
                {projectId
                  ? "A project context was loaded from the URL — open it to apply this outline."
                  : "Start from Create Video to persist this outline into a real, openable project."}
              </p>
            </Card>
          </div>
        </div>
      ) : null}

      {/* ------------------------------------------------------- empty state */}
      {!topicReady ? (
        <Card className="flex flex-col items-center gap-4 px-6 py-14 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft border border-accent-line text-accent">
            <Clapperboard size={24} strokeWidth={1.75} />
          </span>
          <h3 className="font-display text-lg font-semibold text-ink">Describe your idea to begin</h3>
          <p className="mx-auto max-w-md text-sm leading-relaxed text-ink-dim">
            Fill in the brief above and the studio will run the deterministic engines for real — structure selection,
            timeline outline, template hooks and retention analysis — and honestly show “Provider Not Connected” for
            any AI writing step.
          </p>
        </Card>
      ) : null}
    </div>
  );
}

function outlineText(outline: Outline | null): string {
  if (!outline) return "";
  return outline.chapters.map((c) => `${c.order}. ${c.name} — ${c.purpose}`).join("\n");
}

function makeFailed(capability: string, taskType: string, err: unknown): AiResult {
  return {
    status: "failed",
    capability: capability as AiResult["capability"],
    taskType: taskType as AiResult["taskType"],
    attempts: [],
    error: err instanceof Error ? err.message : "Request failed.",
    requiredEnv: [],
  };
}
