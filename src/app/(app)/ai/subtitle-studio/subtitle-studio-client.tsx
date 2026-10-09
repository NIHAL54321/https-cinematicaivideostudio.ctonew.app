"use client";

import { useMemo, useState } from "react";
import { Captions, Download, Loader2 } from "lucide-react";
import { Badge, Button, Card, Label } from "@/components/ui";
import { apiFetch } from "@/components/projects/client-api";
import { AiResultViewPanel } from "@/components/projects/ai-result-panel";
import { studioStepView } from "@/lib/ai/result-view";
import type { AiAttempt } from "@/lib/ai/types";
import type { SubtitleCue, SubtitlePlan, SubtitleStyle, CuePlacement } from "@/lib/subtitles";

interface GenerateResponse {
  connected: boolean;
  capability?: string;
  /** The orchestrator's own result status when the route forwarded one. */
  status?: string;
  /** Every provider attempt the orchestrator recorded, in A → B → C → D order. */
  attempts?: AiAttempt[];
  requiredEnv?: string[];
  plan: SubtitlePlan;
  chosenStyle: { style: SubtitleStyle; reason: string };
  placements: CuePlacement[];
  format?: { srt?: string };
  safeMargins?: { x: number; y: number };
  note?: string;
  error?: string;
}

const STYLE_OPTIONS = ["auto", "minimal", "cinematic", "modern", "creator", "bold", "white", "yellow", "karaoke"];
const LANGUAGES = ["en", "es", "fr", "de", "it", "pt", "hi", "ja", "ko", "zh"];

const DEFAULT_SCRIPT =
  "Welcome to the future. This changes everything — you will remember this moment.";

const DEFAULT_REGIONS = JSON.stringify(
  [
    { label: "face", x: 700, y: 720, w: 420, h: 300 },
    { label: "chart", x: 200, y: 300, w: 500, h: 260 },
  ],
  null,
  2,
);

function fmtTime(ms: number): string {
  const safe = Math.max(0, Math.round(ms));
  const h = Math.floor(safe / 3_600_000);
  const m = Math.floor((safe % 3_600_000) / 60_000);
  const s = Math.floor((safe % 60_000) / 1000);
  const milli = safe % 1000;
  const pad = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(milli, 3)}`;
}

export function SubtitleStudioClient() {
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [segmentsJson, setSegmentsJson] = useState("");
  const [language, setLanguage] = useState("en");
  const [style, setStyle] = useState("auto");
  const [regionsJson, setRegionsJson] = useState(DEFAULT_REGIONS);
  const [result, setResult] = useState<GenerateResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const placementsFor = useMemo(() => {
    if (!result) return new Map<number, CuePlacement>();
    const map = new Map<number, CuePlacement>();
    result.plan.cues.forEach((cue, i) => {
      const placement = result.placements[i];
      if (placement) map.set(cue.index, placement);
    });
    return map;
  }, [result]);

  async function generate() {
    const segments = segmentsJson.trim()
      ? (() => {
          try {
            const parsed = JSON.parse(segmentsJson);
            if (!Array.isArray(parsed)) throw new Error("array expected");
            return parsed;
          } catch {
            return null;
          }
        })()
      : null;
    if (segmentsJson.trim() && segments === null) {
      setError("The voice plan JSON is not valid — fix it or clear the field.");
      return;
    }
    if (!script.trim() && !segments) {
      setError("Paste script text or a DirectedVoicePlan JSON.");
      return;
    }
    let regions: unknown = undefined;
    if (regionsJson.trim()) {
      try {
        regions = JSON.parse(regionsJson);
        if (!Array.isArray(regions)) throw new Error("array expected");
      } catch {
        setError("The regions JSON is not valid — fix it or clear the field.");
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<GenerateResponse>("/api/studio/subtitles", {
        method: "POST",
        body: JSON.stringify({
          action: "generate",
          ...(script.trim() ? { text: script } : {}),
          ...(segments ? { segments } : {}),
          language,
          style,
          ...(regions ? { regions } : {}),
          videoWidth: 1920,
          videoHeight: 1080,
        }),
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  function downloadSrt() {
    const srt = result?.format?.srt;
    if (!srt) return;
    const blob = new Blob([srt], { type: "application/x-subrip" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "subtitles.srt";
    a.click();
    URL.revokeObjectURL(url);
  }

  const chosen = result?.chosenStyle.style;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
      {/* ------------------------------ controls ----------------------------- */}
      <div className="min-w-0 space-y-5">
        <Card className="p-5">
          <Label htmlFor="sub-script">Script text</Label>
          <textarea
            id="sub-script"
            value={script}
            onChange={(e) => setScript(e.target.value)}
            rows={5}
            placeholder="Paste the narration text…"
            className="mt-2 w-full min-w-0 rounded-xl border border-line bg-panel-3/60 px-3.5 py-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent-line"
          />
          <div className="mt-3">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="sub-segments" className="mb-0">
                DirectedVoicePlan JSON
              </Label>
              <span className="text-[11px] uppercase tracking-wider text-ink-faint">Optional</span>
            </div>
            <textarea
              id="sub-segments"
              value={segmentsJson}
              onChange={(e) => setSegmentsJson(e.target.value)}
              rows={6}
              spellCheck={false}
              placeholder='Paste {"segments":[{...}]} from the Voice Studio — timing/emphasis flows in automatically…'
              className="mt-2 w-full min-w-0 rounded-xl border border-line bg-panel-3/60 px-3.5 py-3 font-mono text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent-line"
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="sub-lang">Language</Label>
              <select
                id="sub-lang"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-xl border border-line bg-panel-3/60 px-3.5 text-sm text-ink focus:outline-none focus:border-accent-line"
              >
                {LANGUAGES.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor="sub-style">Style</Label>
              <select
                id="sub-style"
                value={style}
                onChange={(e) => setStyle(e.target.value)}
                className="mt-1.5 h-10 w-full rounded-xl border border-line bg-panel-3/60 px-3.5 text-sm text-ink focus:outline-none focus:border-accent-line"
              >
                {STYLE_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s === "auto" ? "Auto" : s}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-3">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="sub-regions" className="mb-0">
                Regions to avoid (JSON)
              </Label>
              <span className="text-[11px] uppercase tracking-wider text-ink-faint">Optional</span>
            </div>
            <textarea
              id="sub-regions"
              value={regionsJson}
              onChange={(e) => setRegionsJson(e.target.value)}
              rows={4}
              spellCheck={false}
              placeholder='[{"label":"face","x":700,"y":720,"w":420,"h":300}]'
              className="mt-2 w-full min-w-0 rounded-xl border border-line bg-panel-3/60 px-3.5 py-3 font-mono text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent-line"
            />
            <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
              Region detection is a provider-backed step and reports its own provider status; the engine avoids any regions
              it is given (faces, on-screen text, charts, subjects).
            </p>
          </div>
          <Button className="mt-4 w-full" onClick={generate} disabled={busy}>
            {busy ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Generating subtitles…
              </>
            ) : (
              <>
                <Captions size={16} /> Generate subtitles
              </>
            )}
          </Button>
          {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
        </Card>
      </div>

      {/* ------------------------------ results ------------------------------ */}
      <div className="min-w-0 space-y-6">
        {!result ? (
          <Card className="p-8 text-center">
            <p className="text-sm text-ink-dim">
              No subtitles yet — paste script text (or a voice plan) and hit “Generate subtitles”.
            </p>
          </Card>
        ) : null}

        {result ? (
          <>
            {result.connected ? null : (
              <div>
                <AiResultViewPanel
                  view={studioStepView({
                    ...result,
                    note: "Caption text is fully generated by the deterministic engines in this build; audio→subtitle transcription is a provider-backed step and reports its own provider status.",
                  })}
                />
              </div>
            )}

            {result.plan.cues.length === 0 ? (
              <Card className="p-8 text-center">
                <p className="text-sm text-ink-dim">No cues — the input produced no subtitle text.</p>
              </Card>
            ) : null}

            {result.plan.cues.length > 0 ? (
              <>
                {/* style preview + safe margin note */}
                <Card className="p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone="accent">Style: {chosen?.name ?? "—"}</Badge>
                    {result.chosenStyle ? (
                      <span className="text-xs text-ink-faint">{result.chosenStyle.reason}</span>
                    ) : null}
                  </div>
                  <div className="mt-4 flex flex-wrap items-center gap-4">
                    <div
                      className="flex w-64 items-center justify-center rounded-xl border border-line px-4 py-5"
                      style={{
                        background: "linear-gradient(180deg,#1b2230,#0d1117)",
                      }}
                    >
                      <span
                        style={{
                          fontFamily: chosen?.font ?? "sans-serif",
                          fontSize: Math.max(18, Math.min(30, (chosen?.size ?? 46) * 0.5)),
                          color: chosen?.color ?? "#fff",
                          textTransform: chosen?.uppercase ? "uppercase" : "none",
                          textShadow: chosen?.shadow?.blur
                            ? `0 ${chosen.shadow.blur}px ${chosen.shadow.color}`
                            : "none",
                        }}
                      >
                        Sample text
                      </span>
                    </div>
                    <div className="min-w-0 text-xs leading-relaxed text-ink-dim">
                      <p>
                        {chosen?.font} · {chosen?.size}px @1080p
                      </p>
                      <p className="mt-1">
                        {chosen?.background === "none" ? "No background" : `Background ${chosen?.background}`}
                        {chosen?.outline?.width ? ` · outline ${chosen.outline.width}px` : ""}
                        {chosen?.karaoke ? " · karaoke word highlight" : ""}
                      </p>
                      <p className="mt-2 text-ink-faint">
                        Safe margins: x {result.safeMargins?.x ?? 48}px, y {result.safeMargins?.y ?? 48}px
                        (1080p base — applied by the positioning engine to every cue).
                      </p>
                    </div>
                  </div>
                </Card>

                {/* cue list */}
                <Card className="p-5">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="text-sm font-semibold text-ink">
                      {result.plan.cues.length} cue{result.plan.cues.length === 1 ? "" : "s"}
                      <span className="ml-2 font-normal text-ink-faint">{result.plan.style}</span>
                    </h3>
                    {result.format?.srt ? (
                      <Button variant="outline" size="sm" onClick={downloadSrt}>
                        <Download size={14} /> Download .srt
                      </Button>
                    ) : null}
                  </div>
                  <div className="mt-4 space-y-2">
                    {result.plan.cues.map((cue: SubtitleCue) => {
                      const placement = placementsFor.get(cue.index);
                      const avoided = placement?.reason.startsWith("avoided:");
                      return (
                        <div
                          key={cue.index}
                          className="rounded-xl border border-line bg-panel-3/40 px-3.5 py-2.5"
                        >
                          <div className="flex min-w-0 items-start gap-3">
                            <span className="mt-0.5 w-28 shrink-0 font-mono text-[11px] tabular-nums text-ink-dim">
                              {fmtTime(cue.startMs)} → {fmtTime(cue.endMs)}
                            </span>
                            <div className="min-w-0 flex-1">
                              <p className="whitespace-pre-line text-sm font-medium text-ink">{cue.text}</p>
                              {cue.words.some((w) => w.emphasis) ? (
                                <p className="mt-1 text-[11px] text-ink-faint">
                                  Emphasis:{" "}
                                  {cue.words
                                    .filter((w) => w.emphasis)
                                    .map((w) => w.word)
                                    .join(", ")}
                                </p>
                              ) : null}
                            </div>
                            <div className="flex shrink-0 flex-col items-end gap-1">
                              <Badge tone="neutral">#{cue.index}</Badge>
                              {avoided ? (
                                <Badge tone="accent">{placement?.reason}</Badge>
                              ) : placement?.reason === "safe-margin" ? (
                                <Badge tone="neutral">safe-margin</Badge>
                              ) : null}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-[11px] text-ink-faint">{result.plan.timingModel}</p>
                </Card>

                {/* SRT preview */}
                {result.format?.srt ? (
                  <Card className="p-5">
                    <h3 className="text-sm font-semibold text-ink">SRT preview</h3>
                    <pre className="mt-3 max-h-72 overflow-auto whitespace-pre-wrap rounded-xl border border-line bg-panel-3/60 p-4 font-mono text-xs leading-relaxed text-ink-dim">
                      {result.format.srt}
                    </pre>
                  </Card>
                ) : null}
              </>
            ) : null}

            {result.note ? <p className="text-xs text-ink-faint">{result.note}</p> : null}
          </>
        ) : null}
      </div>
    </div>
  );
}