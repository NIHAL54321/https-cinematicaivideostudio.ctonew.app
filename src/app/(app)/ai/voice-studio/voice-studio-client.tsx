"use client";

/**
 * Phase 4 Block 1 — Voice Studio UI.
 *
 * Deterministic client over the voice lib (catalog/director/pronunciation/
 * languages run server-side via /api/studio/voice; the catalog is fetched
 * read-only from the same endpoint). No audio is fabricated: when no TTS
 * provider is connected the honest Provider Not Connected panel is shown.
 */
import { useEffect, useMemo, useState } from "react";
import { Loader2, Mic, PlugZap } from "lucide-react";
import { Badge, Button, Card, Input, Label, PageHeader } from "@/components/ui";
import { apiFetch } from "@/components/projects/client-api";
import { ProviderNotConnected } from "@/components/provider-not-connected";
import {
  SUPPORTED_LANGUAGES,
  getVoiceRecommendation,
  voicePersonas,
  type DirectedVoicePlan,
  type VoiceEntry,
} from "@/lib/voice";

interface CatalogResponse {
  connected: boolean;
  voices: VoiceEntry[];
  personas: string[];
}

interface DirectResponse {
  connected: boolean;
  capability?: string;
  requiredEnv?: string[];
  envHint?: string;
  plan: DirectedVoicePlan;
  spokenText: string;
  voice?: VoiceEntry | null;
  estimatedDurationMs: number;
  note?: string;
  error?: string;
  provider?: string | null;
  model?: string | null;
  audioUrl?: string | null;
}

interface PronounceResponse {
  connected: boolean;
  spokenText: string;
  lexicon: { token: string; phoneticHint: string }[];
  issues: { token: string; phoneticHint: string; error: string }[];
}

interface CorrectionRow {
  token: string;
  pronunciation: string;
}

const DIRECTION_TONE: Record<string, "neutral" | "accent" | "ok" | "danger"> = {
  narrative: "neutral",
  calm: "ok",
  serious: "accent",
  dramatic: "danger",
  energetic: "accent",
  emotional: "ok",
};

const DEFAULT_SCRIPT = "In 2024, NASA announced a breakthrough. This is huge — it will change everything!";

export function VoiceStudioClient() {
  const [voices, setVoices] = useState<VoiceEntry[]>([]);
  const [personas, setPersonas] = useState<string[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);

  const [persona, setPersona] = useState<string>("");
  const [voiceId, setVoiceId] = useState<string>("");
  const [language, setLanguage] = useState("en");
  const [script, setScript] = useState(DEFAULT_SCRIPT);
  const [speed, setSpeed] = useState(1);
  const [pitch, setPitch] = useState(1);
  const [energy, setEnergy] = useState(70);
  const [emotion, setEmotion] = useState("neutral");
  const [pauses, setPauses] = useState(true);
  const [corrections, setCorrections] = useState<CorrectionRow[]>([]);

  const [plan, setPlan] = useState<DirectResponse | null>(null);
  const [pron, setPron] = useState<PronounceResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiFetch<CatalogResponse>("/api/studio/voice", {
      method: "POST",
      body: JSON.stringify({ action: "catalog" }),
    })
      .then((res) => {
        if (!alive) return;
        setVoices(res.voices);
        setPersonas(res.personas.length > 0 ? res.personas : voicePersonas());
        const def = getVoiceRecommendation();
        setVoiceId((v) => v || def.id);
      })
      .catch((e) => {
        if (!alive) return;
        setCatalogError(e instanceof Error ? e.message : "Could not load the voice catalog.");
        // Deterministic client fallback so the picker still renders.
        setVoices([]);
        setPersonas(voicePersonas());
        setVoiceId((v) => v || getVoiceRecommendation().id);
      });
    return () => {
      alive = false;
    };
  }, []);

  const personaVoices = useMemo(
    () => (persona ? voices.filter((v) => v.persona === persona) : voices),
    [persona, voices],
  );
  const selectedVoice = useMemo(
    () => voices.find((v) => v.id === voiceId) ?? null,
    [voices, voiceId],
  );

  function correctionsRecord(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const row of corrections) {
      if (row.token.trim() && row.pronunciation.trim()) out[row.token.trim()] = row.pronunciation.trim();
    }
    return out;
  }

  async function generatePlan() {
    if (script.trim().length < 3) {
      setError("Enter a script of at least a few characters first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<DirectResponse>("/api/studio/voice", {
        method: "POST",
        body: JSON.stringify({
          action: "direct",
          script,
          language,
          voiceId: voiceId || undefined,
          corrections: correctionsRecord(),
          speakingRate: speed,
        }),
      });
      setPlan(res);
      const p = await apiFetch<PronounceResponse>("/api/studio/voice", {
        method: "POST",
        body: JSON.stringify({ action: "pronounce", text: script, corrections: correctionsRecord() }),
      });
      setPron(p);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
      setPlan(null);
      setPron(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title="Voice Studio"
        description="Direct a professional AI voiceover — pick a voice and language, tune pacing, fix pronunciations, and review the directed plan segment by segment."
        actions={
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-panel-2 border border-line text-ink-dim">
            <Mic size={18} strokeWidth={1.75} />
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* ------------------------------- inputs ------------------------------- */}
        <div className="min-w-0 space-y-6">
          <Card className="p-5">
            <Label htmlFor="voice-persona">Voice persona</Label>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={persona === "" ? "primary" : "outline"}
                onClick={() => setPersona("")}
              >
                All
              </Button>
              {personas.map((p) => (
                <Button
                  key={p}
                  size="sm"
                  variant={persona === p ? "primary" : "outline"}
                  onClick={() => {
                    setPersona(p);
                    const first = voices.find((v) => v.persona === p);
                    if (first) setVoiceId(first.id);
                  }}
                >
                  {p}
                </Button>
              ))}
            </div>
            {catalogError ? (
              <p className="mt-2 text-xs text-danger">Catalog API unavailable ({catalogError}) — bundled fallback in use.</p>
            ) : null}

            <div className="mt-4">
              <Label htmlFor="voice-picker">Voice</Label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {personaVoices.map((v) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setVoiceId(v.id)}
                    className={`min-w-0 rounded-xl border p-3 text-left transition-colors ${
                      voiceId === v.id
                        ? "border-accent-line bg-accent-soft"
                        : "border-line bg-panel-3/40 hover:border-line-strong"
                    }`}
                  >
                    <p className="truncate text-sm font-semibold text-ink">{v.name}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      <Badge tone="neutral">{v.gender}</Badge>
                      <Badge tone="neutral">{v.accent}</Badge>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-xs text-ink-dim">{v.description}</p>
                  </button>
                ))}
              </div>
              {selectedVoice ? (
                <p className="mt-2 text-xs text-ink-faint">
                  Selected: {selectedVoice.name} · {selectedVoice.persona} · {selectedVoice.tone}
                </p>
              ) : null}
            </div>

            <div className="mt-4">
              <Label htmlFor="voice-language">Language</Label>
              <select
                id="voice-language"
                value={language}
                onChange={(e) => setLanguage(e.target.value)}
                className="h-10 w-full rounded-xl border border-line bg-panel-3/60 px-3.5 text-sm text-ink focus:outline-none focus:border-accent-line"
              >
                {SUPPORTED_LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}{l.nativeName && l.nativeName !== l.name ? ` · ${l.nativeName}` : ""}
                  </option>
                ))}
              </select>
              <p className="mt-1.5 text-xs text-ink-faint">
                50+ languages unlock when a TTS provider is connected — this list is additive.
              </p>
            </div>
          </Card>

          <Card className="p-5">
            <Label htmlFor="voice-script">Script</Label>
            <textarea
              id="voice-script"
              value={script}
              onChange={(e) => setScript(e.target.value)}
              rows={5}
              placeholder="Paste or write the narration to direct…"
              className="w-full min-w-0 rounded-xl border border-line bg-panel-3/60 px-3.5 py-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent-line"
            />
            <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="voice-speed">Speed ({speed.toFixed(2)}×)</Label>
                <input
                  id="voice-speed"
                  type="range"
                  min={0.5}
                  max={1.5}
                  step={0.05}
                  value={speed}
                  onChange={(e) => setSpeed(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <Label htmlFor="voice-pitch">Pitch ({pitch.toFixed(2)}×)</Label>
                <input
                  id="voice-pitch"
                  type="range"
                  min={0.5}
                  max={1.5}
                  step={0.05}
                  value={pitch}
                  onChange={(e) => setPitch(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <Label htmlFor="voice-energy">Energy ({energy})</Label>
                <input
                  id="voice-energy"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={energy}
                  onChange={(e) => setEnergy(Number(e.target.value))}
                  className="w-full"
                />
              </div>
              <div>
                <Label htmlFor="voice-emotion">Emotion</Label>
                <select
                  id="voice-emotion"
                  value={emotion}
                  onChange={(e) => setEmotion(e.target.value)}
                  className="h-10 w-full rounded-xl border border-line bg-panel-3/60 px-3.5 text-sm text-ink focus:outline-none focus:border-accent-line"
                >
                  {["neutral", "warm", "dramatic", "serious", "calm", "energetic"].map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end pb-1">
                <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-dim">
                  <input
                    type="checkbox"
                    checked={pauses}
                    onChange={(e) => setPauses(e.target.checked)}
                    className="h-4 w-4 accent-current"
                  />
                  Dramatic pauses
                </label>
              </div>
            </div>
          </Card>

          <Card className="p-5">
            <div className="flex items-center justify-between gap-2">
              <Label className="mb-0">Pronunciation corrections</Label>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setCorrections((c) => [...c, { token: "", pronunciation: "" }])}
              >
                Add row
              </Button>
            </div>
            {corrections.length === 0 ? (
              <p className="mt-2 text-xs text-ink-faint">
                No corrections yet — add rows like NASA → “Nasa” for provider pronunciation hints.
              </p>
            ) : (
              <div className="mt-3 space-y-2">
                {corrections.map((row, i) => (
                  <div key={i} className="flex min-w-0 items-center gap-2">
                    <Input
                      value={row.token}
                      onChange={(e) =>
                        setCorrections((c) => c.map((r, j) => (j === i ? { ...r, token: e.target.value } : r)))
                      }
                      placeholder="Token (e.g. NASA)"
                      aria-label="Correction token"
                    />
                    <Input
                      value={row.pronunciation}
                      onChange={(e) =>
                        setCorrections((c) =>
                          c.map((r, j) => (j === i ? { ...r, pronunciation: e.target.value } : r)),
                        )
                      }
                      placeholder="Pronunciation (e.g. Nasa)"
                      aria-label="Correction pronunciation"
                    />
                    <Button size="sm" variant="ghost" onClick={() => setCorrections((c) => c.filter((_, j) => j !== i))}>
                      Remove
                    </Button>
                  </div>
                ))}
              </div>
            )}
            <Button className="mt-5 w-full" onClick={generatePlan} disabled={busy}>
              {busy ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Directing voice plan…
                </>
              ) : (
                "Generate voice plan"
              )}
            </Button>
            {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
          </Card>
        </div>

        {/* ------------------------------- results ------------------------------ */}
        <div className="min-w-0 space-y-6">
          {!plan ? (
            <Card className="p-8 text-center">
              <p className="text-sm text-ink-dim">
                No voice plan yet — pick a voice, paste a script, and hit “Generate voice plan”.
              </p>
            </Card>
          ) : (
            <>
              <Card className="p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="accent">Overall energy {plan.plan.energy}</Badge>
                  <Badge tone="neutral">Est. {(plan.estimatedDurationMs / 1000).toFixed(1)}s</Badge>
                  <Badge tone="neutral">{plan.plan.segments.length} segments</Badge>
                  {plan.plan.timingModel ? <Badge tone="neutral">Estimate</Badge> : null}
                </div>
                {plan.connected ? (
                  <p className="mt-3 text-sm text-ink-dim">
                    Generated via {plan.provider ?? "provider"}
                    {plan.model ? ` · ${plan.model}` : ""}.
                  </p>
                ) : (
                  <div className="mt-4">
                    <ProviderNotConnected
                      providerKeys={plan.requiredEnv ?? []}
                      note="Audio is generated the moment a voice provider key is added — the full directed request is ready."
                    />
                  </div>
                )}
                {plan.note && plan.connected ? (
                  <p className="mt-3 text-xs text-ink-faint">{plan.note}</p>
                ) : null}
              </Card>

              <div className="space-y-3">
                {plan.plan.segments.map((seg, i) => (
                  <Card key={i} className="min-w-0 p-4">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs font-semibold text-ink-faint">#{i + 1}</span>
                      <Badge tone={DIRECTION_TONE[seg.direction] ?? "neutral"}>{seg.direction}</Badge>
                      <Badge tone="neutral">{seg.pace}</Badge>
                      <Badge tone="neutral">intensity {seg.intensity}</Badge>
                      <Badge tone="neutral">{seg.speakingRate.toFixed(2)}×</Badge>
                    </div>
                    <p className="mt-2 break-words text-sm text-ink">{seg.text}</p>
                    <p className="mt-1 break-words text-xs text-ink-dim">
                      Spoken: {pauses ? seg.spokenText : seg.spokenText} {seg.pauseBeforeMs > 0 || seg.pauseAfterMs > 0 ? (
                        <span className="text-ink-faint">
                          (pauses: {seg.pauseBeforeMs > 0 ? `⏸ ${seg.pauseBeforeMs}ms before` : ""}
                          {seg.pauseBeforeMs > 0 && seg.pauseAfterMs > 0 ? " · " : ""}
                          {seg.pauseAfterMs > 0 ? `⏸ ${seg.pauseAfterMs}ms after` : ""})
                        </span>
                      ) : null}
                    </p>
                    {seg.emphasis.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1">
                        <span className="text-[11px] uppercase tracking-wider text-ink-faint">Emphasis:</span>
                        {seg.emphasis.map((w) => (
                          <Badge key={w} tone="accent">
                            {w}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                    <p className="mt-1.5 text-xs text-ink-faint">
                      Emotion: {seg.emotion} · {seg.pace} pace
                    </p>
                  </Card>
                ))}
              </div>

              <Card className="p-5">
                <h3 className="text-sm font-semibold text-ink">Spoken-text preview</h3>
                <p className="mt-2 break-words text-sm leading-relaxed text-ink-dim">{plan.spokenText}</p>
              </Card>

              {pron ? (
                <Card className="p-5">
                  <h3 className="text-sm font-semibold text-ink">Pronunciations preview</h3>
                  {pron.issues.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {pron.issues.map((iss, i) => (
                        <li key={i} className="flex items-center gap-2 text-xs text-danger">
                          <PlugZap size={12} /> {iss.token || "(empty)"} — {iss.error}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs text-ink-faint">No correction issues.</p>
                  )}
                  {pron.lexicon.length > 0 ? (
                    <div className="mt-3 space-y-1">
                      {pron.lexicon.map((entry) => (
                        <p key={entry.token} className="break-words text-xs text-ink-dim">
                          <span className="font-mono text-ink">{entry.token}</span> → {entry.phoneticHint}
                        </p>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-ink-faint">Lexicon empty — corrections feed the provider lexicon.</p>
                  )}
                </Card>
              ) : null}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
