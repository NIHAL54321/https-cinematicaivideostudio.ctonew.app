"use client";

/**
 * Phase 4 Block 2 — Music Studio UI.
 *
 * Deterministic client over the music lib (selection + ducking run server-side
 * via /api/studio/music). No audio is fabricated: whenever the orchestrator has
 * no provider to hand the work to, its own honest gate is shown verbatim after
 * "Generate music plan".
 * Ducking is a pure mix preview and always works.
 */
import { useState } from "react";
import { Loader2, Music, SlidersHorizontal } from "lucide-react";
import { Badge, Button, Card, Input, Label, PageHeader } from "@/components/ui";
import { apiFetch } from "@/components/projects/client-api";
import { AiResultViewPanel } from "@/components/projects/ai-result-panel";
import { studioStepView } from "@/lib/ai/result-view";
import type { AiAttempt } from "@/lib/ai/types";
import type { MusicCategory, RankedCategory, MusicSelectionInput } from "@/lib/music";
import type { DuckReason } from "@/lib/music";

interface SelectResponse {
  connected: boolean;
  capability?: string;
  /** The orchestrator's own result status when the route forwarded one. */
  status?: string;
  /** Every provider attempt the orchestrator recorded, in A → B → C → D order. */
  attempts?: AiAttempt[];
  requiredEnv?: string[];
  ranked: RankedCategory[];
  top: RankedCategory;
  availableCategories?: MusicCategory[];
  selected?: { genre: string; mood: string; bpm: number } | null;
  note?: string;
  error?: string;
  provider?: string | null;
  model?: string | null;
  audioUrl?: string | null;
  asset?: unknown;
}

interface DuckEvent {
  startMs: number;
  endMs: number;
  dB: number;
  reason: DuckReason;
}

interface DuckMix {
  musicVolume: number;
  duckedDepthDb: number;
  fadeInMs: number;
  fadeOutMs: number;
}

interface DuckResponse {
  connected: boolean;
  ducking: DuckEvent[];
  mix: DuckMix;
  timingModel?: string;
  note?: string;
  error?: string;
}

const EMOTIONS = ["focused", "happy", "sad", "calm", "tense", "epic", "dark", "energetic", "professional", "romantic"];
const SCENE_TYPES = ["intro", "explainer", "story", "interview", "montage", "travel", "review", "finale", "outro", "suspense", "crime"];
const PACES = ["slow", "medium", "fast", "epic", "dramatic"];
const DEFAULT_VOICE_PLAN_JSON = JSON.stringify(
  {
    voice: "nora-female",
    language: "en",
    segments: [
      { startMs: 0, endMs: 3000, text: "Welcome to the future of computing." },
      { startMs: 3400, endMs: 6400, text: "And the numbers are staggering." },
      { startMs: 7300, endMs: 10300, text: "This changes everything." },
    ],
    energy: 62,
    estimatedDurationMs: 10300,
    timingModel: "ESTIMATE: chars-per-second model",
  },
  null,
  2,
);

function fmtTime(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

const REASON_TONE: Record<DuckReason, "neutral" | "accent" | "ok" | "danger"> = {
  narrating: "accent",
  pause: "ok",
  "music-only": "neutral",
};

export function MusicStudioClient() {
  const [topic, setTopic] = useState("technology");
  const [emotion, setEmotion] = useState("focused");
  const [sceneType, setSceneType] = useState("explainer");
  const [pace, setPace] = useState("medium");
  const [genre, setGenre] = useState("");

  const [voicePlanJson, setVoicePlanJson] = useState(DEFAULT_VOICE_PLAN_JSON);
  const [musicVolume, setMusicVolume] = useState(70);
  const [duckDepth, setDuckDepth] = useState(6);
  const [fadeIn, setFadeIn] = useState(600);
  const [fadeOut, setFadeOut] = useState(1200);

  const [sel, setSel] = useState<SelectResponse | null>(null);
  const [duck, setDuck] = useState<DuckResponse | null>(null);
  const [busy, setBusy] = useState<"select" | "duck" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function generatePlan() {
    if (!topic.trim() && !sceneType.trim() && !genre.trim() && !emotion.trim() && !pace.trim()) {
      setError("Enter at least one of topic, emotion, scene type, pace or genre.");
      return;
    }
    setBusy("select");
    setError(null);
    try {
      const input: MusicSelectionInput & { action: "select" } = {
        action: "select",
        ...(topic.trim() ? { topic: topic.trim() } : {}),
        emotion: emotion.trim() || undefined,
        sceneType: sceneType.trim() || undefined,
        pace: pace.trim() || undefined,
        ...(genre.trim() ? { genre: genre.trim() } : {}),
      };
      const res = await apiFetch<SelectResponse>("/api/studio/music", {
        method: "POST",
        body: JSON.stringify(input),
      });
      setSel(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
      setSel(null);
    } finally {
      setBusy(null);
    }
  }

  async function computeDucking() {
    setBusy("duck");
    setError(null);
    let voicePlan: unknown;
    try {
      voicePlan = voicePlanJson.trim() ? JSON.parse(voicePlanJson) : { segments: [] };
    } catch {
      setError("The voice plan JSON is not valid — fix it or clear the field.");
      setBusy(null);
      return;
    }
    try {
      const res = await apiFetch<DuckResponse>("/api/studio/music", {
        method: "POST",
        body: JSON.stringify({
          action: "duck",
          voicePlan,
          musicVolume: musicVolume / 100,
          duckedDepthDb: duckDepth,
          fadeInMs: fadeIn,
          fadeOutMs: fadeOut,
        }),
      });
      setDuck(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
      setDuck(null);
    } finally {
      setBusy(null);
    }
  }

  const maxScore = sel ? Math.max(1, ...sel.ranked.map((r) => r.score)) : 1;

  return (
    <div className="min-w-0">
      <PageHeader
        title="Music Studio"
        description="Score your video with 15 licensed cinematic categories — auto-matched to topic and emotion, with ducking under your voiceover."
        actions={
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-panel-2 border border-line text-ink-dim">
            <Music size={18} strokeWidth={1.75} />
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* ------------------------------- inputs ------------------------------- */}
        <div className="min-w-0 space-y-6">
          <Card className="p-5">
            <Label htmlFor="music-topic">Topic</Label>
            <Input
              id="music-topic"
              value={topic}
              onChange={(e) => setTopic(e.target.value)}
              placeholder="e.g. technology, personal finance, travel"
            />
            <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label htmlFor="music-emotion">Emotion</Label>
                <select
                  id="music-emotion"
                  value={emotion}
                  onChange={(e) => setEmotion(e.target.value)}
                  className="h-10 w-full rounded-xl border border-line bg-panel-3/60 px-3.5 text-sm text-ink focus:outline-none focus:border-accent-line"
                >
                  {EMOTIONS.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="music-scene-type">Scene type</Label>
                <select
                  id="music-scene-type"
                  value={sceneType}
                  onChange={(e) => setSceneType(e.target.value)}
                  className="h-10 w-full rounded-xl border border-line bg-panel-3/60 px-3.5 text-sm text-ink focus:outline-none focus:border-accent-line"
                >
                  {SCENE_TYPES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="music-pace">Pace</Label>
                <select
                  id="music-pace"
                  value={pace}
                  onChange={(e) => setPace(e.target.value)}
                  className="h-10 w-full rounded-xl border border-line bg-panel-3/60 px-3.5 text-sm text-ink focus:outline-none focus:border-accent-line"
                >
                  {PACES.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <Label htmlFor="music-genre">Genre (optional, overrides heuristic)</Label>
                <Input id="music-genre" value={genre} onChange={(e) => setGenre(e.target.value)} placeholder="e.g. cinematic, ambient" />
              </div>
            </div>
            <Button className="mt-5 w-full" onClick={generatePlan} disabled={busy !== null}>
              {busy === "select" ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Ranking licensed categories…
                </>
              ) : (
                "Generate music plan"
              )}
            </Button>
          </Card>

          <Card className="p-5">
            <div className="flex items-center gap-2">
              <SlidersHorizontal size={15} className="text-ink-faint" />
              <Label className="mb-0">Ducking & mix controls</Label>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <div>
                <Label htmlFor="music-volume">Music volume ({musicVolume}%)</Label>
                <input
                  id="music-volume"
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={musicVolume}
                  onChange={(e) => setMusicVolume(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <Label htmlFor="duck-depth">Duck depth ({duckDepth} dB)</Label>
                <input
                  id="duck-depth"
                  type="range"
                  min={3}
                  max={20}
                  step={1}
                  value={duckDepth}
                  onChange={(e) => setDuckDepth(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <Label htmlFor="fade-in">Fade in ({fadeIn} ms)</Label>
                <input
                  id="fade-in"
                  type="range"
                  min={0}
                  max={4000}
                  step={100}
                  value={fadeIn}
                  onChange={(e) => setFadeIn(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <Label htmlFor="fade-out">Fade out ({fadeOut} ms)</Label>
                <input
                  id="fade-out"
                  type="range"
                  min={0}
                  max={6000}
                  step={100}
                  value={fadeOut}
                  onChange={(e) => setFadeOut(Number(e.target.value))}
                  className="w-full"
                />
              </div>
            </div>
            <p className="mt-3 text-xs text-ink-faint">
              Manual controls — the same values feed the deterministic ducking preview below. Music is lowered by the duck
              depth while narration is active, and rises in narration pauses.
            </p>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between gap-2">
              <Label className="mb-0">Voice plan for ducking (JSON)</Label>
              <span className="text-[11px] uppercase tracking-wider text-ink-faint">Optional</span>
            </div>
            <textarea
              value={voicePlanJson}
              onChange={(e) => setVoicePlanJson(e.target.value)}
              rows={10}
              spellCheck={false}
              placeholder='Paste a DirectedVoicePlan from the Voice Studio, or {"segments":[{"startMs":0,"endMs":3000}]}…'
              className="mt-3 w-full min-w-0 rounded-xl border border-line bg-panel-3/60 px-3.5 py-3 font-mono text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent-line"
            />
            <Button className="mt-4 w-full" variant="outline" onClick={computeDucking} disabled={busy !== null}>
              {busy === "duck" ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Computing ducking…
                </>
              ) : (
                "Compute ducking"
              )}
            </Button>
            {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
          </Card>
        </div>

        {/* ------------------------------- results ------------------------------ */}
        <div className="min-w-0 space-y-6">
          {!sel && !duck ? (
            <Card className="p-8 text-center">
              <p className="text-sm text-ink-dim">
                No plan yet — describe your video and hit “Generate music plan”, or paste a voice plan and “Compute
                ducking”.
              </p>
            </Card>
          ) : null}

          {sel ? (
            <Card className="p-5">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="accent">Top pick: {sel.top.name}</Badge>
                <Badge tone="neutral">score {sel.top.score}</Badge>
                {sel.selected ? <Badge tone="neutral">{sel.selected.bpm} BPM</Badge> : null}
              </div>
              {sel.connected ? (
                <p className="mt-3 text-sm text-ink-dim">
                  Generated via {sel.provider ?? "provider"}
                  {sel.model ? ` · ${sel.model}` : ""}.
                </p>
              ) : (
                <div className="mt-4">
                  <AiResultViewPanel
                    view={studioStepView({
                      ...sel,
                      // The unkeyed wording this panel has always shown — reached
                      // through the shared classifier, so a reached-and-rejected
                      // attempt can no longer borrow the "not connected" cause.
                      note: "The moment a music provider key is added, the top-ranked category below is generated and persisted with licensing metadata.",
                    })}
                  />
                </div>
              )}
              <div className="mt-5 space-y-2.5">
                {sel.ranked.map((r) => (
                  <div key={r.categoryId} className="min-w-0">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-medium text-ink">
                        {r.name}
                        {r.categoryId === sel.top.categoryId ? <span className="ml-1.5 text-accent">★</span> : null}
                      </p>
                      <span className="shrink-0 text-xs tabular-nums text-ink-faint">{r.score}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-3">
                      <div
                        className="h-full rounded-full bg-accent/70"
                        style={{ width: `${Math.max(4, Math.round((r.score / maxScore) * 100))}%` }}
                      />
                    </div>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">{r.reason}</p>
                  </div>
                ))}
              </div>
              {sel.note && !sel.connected ? <p className="mt-3 text-xs text-ink-faint">{sel.note}</p> : null}
            </Card>
          ) : null}

          {sel && sel.top ? (
            <Card className="p-5">
              <h3 className="text-sm font-semibold text-ink">Top pick profile</h3>
              {(() => {
                const cat = sel.availableCategories?.find((c) => c.id === sel.top.categoryId);
                if (!cat) {
                  return <p className="mt-2 text-xs text-ink-faint">Full category profile unavailable.</p>;
                }
                return (
                  <div className="mt-3 space-y-3">
                    <div className="flex flex-wrap gap-1.5">
                      {cat.moods.map((m) => (
                        <Badge key={m} tone="neutral">
                          {m}
                        </Badge>
                      ))}
                      <Badge tone="accent">{cat.tempos} tempo</Badge>
                      <Badge tone="neutral">{cat.typicalBpm} BPM</Badge>
                    </div>
                    <p className="text-xs leading-relaxed text-ink-dim">{cat.description}</p>
                    <p className="text-xs text-ink-faint">
                      Energy {cat.energyRange[0]}–{cat.energyRange[1]} · {cat.useHint}
                    </p>
                    <p className="text-[11px] text-ink-faint">
                      Licensing: every category maps to tracks licensed for YouTube use across all video
                      formats. Attribution is recorded server-side in LicensingMetadata when a track is generated
                      or imported.
                    </p>
                  </div>
                );
              })()}
            </Card>
          ) : null}

          {duck ? (
            <Card className="p-5">
              <h3 className="text-sm font-semibold text-ink">Ducking timeline</h3>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Badge tone="neutral">music {(duck.mix.musicVolume * 100).toFixed(0)}%</Badge>
                <Badge tone="accent">duck depth {duck.mix.duckedDepthDb} dB</Badge>
                <Badge tone="neutral">fade in {duck.mix.fadeInMs} ms</Badge>
                <Badge tone="neutral">fade out {duck.mix.fadeOutMs} ms</Badge>
              </div>
              {duck.ducking.length === 0 ? (
                <p className="mt-3 text-xs text-ink-faint">No narration or music regions — nothing to duck.</p>
              ) : (
                <div className="mt-4 space-y-2">
                  {duck.ducking.map((ev, i) => (
                    <div
                      key={i}
                      className={`flex min-w-0 items-center gap-3 rounded-xl border px-3.5 py-2.5 ${
                        ev.reason === "narrating" ? "border-accent-line/40 bg-accent-soft/40" : "border-line bg-panel-3/40"
                      }`}
                    >
                      <span className="w-20 shrink-0 font-mono text-xs tabular-nums text-ink-dim">
                        {fmtTime(ev.startMs)}–{fmtTime(ev.endMs)}
                      </span>
                      <span className="w-16 shrink-0 font-mono text-xs tabular-nums text-ink">
                        {ev.dB > 0 ? `+${ev.dB}` : ev.dB} dB
                      </span>
                      <Badge tone={REASON_TONE[ev.reason]}>{ev.reason}</Badge>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-3 text-xs text-ink-faint">
                {duck.timingModel ?? ""} {duck.note ? ` ${duck.note}` : ""}
              </p>
            </Card>
          ) : null}
        </div>
      </div>
    </div>
  );
}