"use client";
/**
 * Image/Video Generator studio — the Phase 3 visual generation entry points.
 *
 * Deterministic prompt pipeline is real and always runs; the final generation
 * routes through the AI Model Orchestrator. When no provider is configured the
 * response is the honest "Provider Not Connected" state showing the exact env
 * var and the FULLY-BUILT prompt — nothing is ever fabricated.
 */
import { useState } from "react";
import { Film, Image as ImageIcon, Loader2, PlugZap, Sparkles, Wand2 } from "lucide-react";
import { Badge, Button, Card, Label } from "@/components/ui";
import { apiFetch } from "@/components/projects/client-api";
import { CINEMATIC_PRESETS, listPresets, type CinematicPreset } from "@/lib/studio/presets";
import { CAMERA_MOVES } from "@/lib/studio/camera";
import { VISUAL_EFFECTS } from "@/lib/studio/effects";

type Mode = "image" | "video";
type Action = "image" | "video" | "variation" | "restyle" | "upscale" | "enhance" | "bg_replace";

interface GenerateResponse {
  connected: boolean;
  action?: Action;
  capability?: string;
  requiredEnv?: string[];
  envHint?: string;
  prompt?: string;
  preset?: { id: string; name: string; description?: string; grading?: string | null };
  camera?: { move: string; shot: string; rationale?: string } | null;
  effects?: string[];
  note?: string;
  asset?: { id: string; url?: string | null; kind?: string; name?: string } | null;
  url?: string | null;
}

const ASPECTS = ["16:9", "9:16", "1:1", "4:3", "21:9", "4:5"];
const EFFECT_IDS = Object.keys(VISUAL_EFFECTS);

export function GeneratorStudio({ mode }: { mode: Mode }) {
  const isVideo = mode === "video";
  const [topic, setTopic] = useState("");
  const [presetId, setPresetId] = useState("cinematic");
  const [cameraMove, setCameraMove] = useState<string>("");
  const [effects, setEffects] = useState<string[]>([]);
  const [aspect, setAspect] = useState(isVideo ? "16:9" : "16:9");
  const [builtPrompt, setBuiltPrompt] = useState<string | null>(null);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const preset: CinematicPreset = CINEMATIC_PRESETS[presetId] ?? CINEMATIC_PRESETS.cinematic;
  const ready = topic.trim().length >= 3;

  function toggleEffect(id: string) {
    setEffects((prev) => (prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id]));
  }

  function buildPromptLocal() {
    const base = topic.trim();
    // Deterministic local preview of the pipeline (final pipeline runs server-side).
    const withCamera =
      cameraMove && (mode === "image" || mode === "video")
        ? `${base}. camera move: ${cameraMove}`
        : base;
    const withEffects = effects.length ? `${withCamera}, ${effects.map((e) => VISUAL_EFFECTS[e].name).join(", ")}` : withCamera;
    setBuiltPrompt(withEffects);
    setResult(null);
  }

  async function generate() {
    if (!ready) return;
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = {
      action: mode,
      topic,
      presetId,
      ...(cameraMove ? { cameraMove } : {}),
      ...(effects.length ? { effects } : {}),
      aspectRatio: aspect,
    };
    try {
      const res = await apiFetch<GenerateResponse>("/api/studio/generate", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setResult(res);
      if (!res.connected && res.prompt) setBuiltPrompt(res.prompt);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
      setResult(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      {/* ------------------------------------------- inputs */}
      <div className="space-y-6">
        <Card className="p-6">
          <Label htmlFor="topic">{isVideo ? "Scene / video topic" : "Scene / image topic"}</Label>
          <textarea
            id="topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            placeholder={
              isVideo
                ? "Describe the footage you want… e.g. a drone sweeping over a misty mountain range at dawn"
                : "Describe the still you want… e.g. a lone explorer walking through a neon-lit rain-soaked street"
            }
            rows={4}
            className="w-full rounded-xl border border-line bg-panel-3/60 px-3.5 py-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent-line focus:ring-2 focus:ring-accent/20"
          />
          <p className="mt-2 text-[11px] text-ink-faint">
            The description below is composed deterministically into a full prompt, then sent to the AI Model
            Orchestrator.
          </p>
        </Card>

        <Card className="p-6">
          <Label>Cinematic Style Preset</Label>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {listPresets().map((p) => {
              const active = p.id === presetId;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPresetId(p.id)}
                  className={[
                    "rounded-xl border px-3.5 py-2.5 text-left transition-colors",
                    active
                      ? "border-accent-line bg-accent-soft/40"
                      : "border-line bg-panel-2/40 hover:border-accent-line/50",
                  ].join(" ")}
                >
                  <p className="text-sm font-medium text-ink">{p.name}</p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-ink-faint">{p.description}</p>
                </button>
              );
            })}
          </div>
        </Card>

        {(mode === "image" || mode === "video") && (
          <Card className="p-6">
            <Label>Camera move</Label>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setCameraMove("")}
                className={[
                  "rounded-lg border px-3 py-1.5 text-xs transition-colors",
                  cameraMove === "" ? "border-accent-line bg-accent-soft/40 text-ink" : "border-line bg-panel-2/40 text-ink-dim",
                ].join(" ")}
              >
                Auto
              </button>
              {CAMERA_MOVES.map((m) => (
                <button
                  key={m.move}
                  type="button"
                  onClick={() => setCameraMove(m.move)}
                  title={m.description}
                  className={[
                    "rounded-lg border px-3 py-1.5 text-xs transition-colors",
                    cameraMove === m.move
                      ? "border-accent-line bg-accent-soft/40 text-ink"
                      : "border-line bg-panel-2/40 text-ink-dim hover:text-ink",
                  ].join(" ")}
                >
                  {m.move}
                </button>
              ))}
            </div>
          </Card>
        )}

        <Card className="p-6">
          <Label>Visual effects</Label>
          <div className="flex flex-wrap gap-2">
            {EFFECT_IDS.map((id) => {
              const e = VISUAL_EFFECTS[id];
              const active = effects.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => toggleEffect(id)}
                  className={[
                    "rounded-lg border px-3 py-1.5 text-xs transition-colors",
                    active
                      ? "border-accent-line bg-accent-soft/40 text-ink"
                      : "border-line bg-panel-2/40 text-ink-dim hover:text-ink",
                  ].join(" ")}
                >
                  {e.name}
                </button>
              );
            })}
          </div>
        </Card>

        <Card className="p-6">
          <Label>Aspect ratio</Label>
          <div className="flex flex-wrap gap-2">
            {ASPECTS.map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAspect(a)}
                className={[
                  "rounded-lg border px-3 py-1.5 font-mono text-xs transition-colors",
                  aspect === a ? "border-accent-line bg-accent-soft/40 text-ink" : "border-line bg-panel-2/40 text-ink-dim",
                ].join(" ")}
              >
                {a}
              </button>
            ))}
          </div>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" onClick={buildPromptLocal} disabled={!ready}>
            <Wand2 size={15} /> Build Prompt
          </Button>
          <Button onClick={generate} disabled={!ready || busy}>
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
            Generate {isVideo ? "Video" : "Image"}
          </Button>
        </div>
        {error ? <p className="text-sm text-danger">{error}</p> : null}
      </div>

      {/* ------------------------------------------- output */}
      <div className="space-y-6">
        {(builtPrompt || result?.prompt) && (
          <Card className="p-6">
            <div className="mb-2 flex items-center gap-2">
              <Wand2 size={14} className="text-accent" />
              <h3 className="font-display text-sm font-semibold text-ink">Composed prompt</h3>
              <Badge tone="neutral" className="text-[10px] uppercase tracking-wider">
                Deterministic pipeline
              </Badge>
            </div>
            <p className="text-xs leading-relaxed text-ink-dim">{(result?.prompt ?? builtPrompt) as string}</p>
          </Card>
        )}

        {result?.connected ? (
          <Card className="p-6">
            <div className="mb-3 flex items-center gap-2">
              {isVideo ? <Film size={15} className="text-accent" /> : <ImageIcon size={15} className="text-accent" />}
              <h3 className="font-display text-sm font-semibold text-ink">Generated asset</h3>
            </div>
            {result.asset?.url || result.url ? (
              isVideo ? (
                <video src={(result.asset?.url ?? result.url) as string} controls className="w-full rounded-xl border border-line bg-black" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={(result.asset?.url ?? result.url) as string} alt="Generated" className="w-full rounded-xl border border-line" />
              )
            ) : (
              <p className="text-sm text-ink-dim">{result.note ?? "Generation succeeded but no asset URL was returned."}</p>
            )}
            {result.asset?.id ? (
              <p className="mt-2 text-[11px] text-ink-faint">Asset id: {result.asset.id}</p>
            ) : null}
          </Card>
        ) : result?.connected === false ? (
          <Card className="overflow-hidden p-0">
            <div className="flex flex-col items-center gap-3 border-b border-line px-6 py-8 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-accent-line bg-accent-soft text-accent">
                <PlugZap size={22} strokeWidth={1.75} />
              </span>
              <div>
                <h3 className="font-display text-base font-semibold text-ink">Provider Not Connected</h3>
                <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-ink-dim">{result.note}</p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <span className="text-[10px] uppercase tracking-wider text-ink-faint">Requires server-side env:</span>
                {(result.requiredEnv ?? []).map((k) => (
                  <Badge key={k} tone="neutral" className="font-mono normal-case tracking-normal">
                    {k}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="bg-panel-2/40 px-6 py-4">
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Ready-to-send prompt</p>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-ink">{result.prompt}</p>
              {result.camera ? (
                <p className="mt-2 text-[11px] text-ink-faint">camera: {result.camera.move} · {result.camera.rationale}</p>
              ) : null}
            </div>
          </Card>
        ) : (
          <Card className="p-6">
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-line bg-panel-2 text-ink-faint">
                {isVideo ? <Film size={20} /> : <ImageIcon size={20} />}
              </span>
              <p className="max-w-sm text-xs leading-relaxed text-ink-faint">
                Build a prompt, then Generate. When no AI provider is connected you&apos;ll see the honest “Provider Not
                Connected” state with the fully-composed prompt — generation is never simulated.
              </p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
