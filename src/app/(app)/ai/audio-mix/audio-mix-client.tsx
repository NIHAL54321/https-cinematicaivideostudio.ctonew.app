"use client";

import { useState } from "react";
import { Loader2, SlidersHorizontal } from "lucide-react";
import { Badge, Button, Card, Label } from "@/components/ui";
import { apiFetch } from "@/components/projects/client-api";
import { buildDuckingSchedule, type DuckingSchedule } from "@/lib/music";
import type { AudioMixPlan, MixTrackEvent, MixTrackId } from "@/lib/mix";

interface MixResponse {
  connected: boolean;
  plan: AudioMixPlan;
  ducked?: AudioMixPlan;
  clipping: AudioMixPlan["clipping"];
  loudness: AudioMixPlan["loudness"];
  note?: string;
  error?: string;
}

const TRACK_META: Array<{ id: MixTrackId; label: string; hint: string }> = [
  { id: "voice", label: "Voice", hint: "Narration / voiceover" },
  { id: "music", label: "Music", hint: "Scored bed (ducked under narration)" },
  { id: "sfx", label: "SFX", hint: "Sound effects" },
  { id: "ambient", label: "Ambient", hint: "Room tone / ambience" },
];

const DEFAULT_VOICE_PLAN_JSON = JSON.stringify(
  {
    voice: "nora-female",
    language: "en",
    segments: [
      { startMs: 0, endMs: 3000, text: "Welcome to the future." },
      { startMs: 3400, endMs: 6400, text: "This changes everything." },
    ],
    energy: 62,
    estimatedDurationMs: 6400,
  },
  null,
  2,
);

const DEFAULT_DUCKING_JSON = JSON.stringify(
  {
    ducking: [
      { startMs: 0, endMs: 3000, dB: -6, reason: "narrating" },
      { startMs: 3000, endMs: 3400, dB: 0, reason: "pause" },
      { startMs: 3400, endMs: 6400, dB: -6, reason: "narrating" },
    ],
    mix: { musicVolume: 0.7, duckedDepthDb: 6, fadeInMs: 600, fadeOutMs: 1200 },
  },
  null,
  2,
);

function fmtTime(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function AudioMixClient() {
  const [gains, setGains] = useState<Record<MixTrackId, number>>({ voice: 100, music: 70, sfx: 80, ambient: 30 });
  const [loudnessTarget, setLoudnessTarget] = useState(-14);
  const [voicePlanJson, setVoicePlanJson] = useState(DEFAULT_VOICE_PLAN_JSON);
  const [duckingJson, setDuckingJson] = useState("");
  const [result, setResult] = useState<MixResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function calculate() {
    let ducking: DuckingSchedule | undefined;
    // 1) Explicit ducking schedule JSON wins.
    if (duckingJson.trim()) {
      try {
        const parsed = JSON.parse(duckingJson);
        if (!Array.isArray(parsed?.ducking)) throw new Error("expected { ducking: [...] }");
        ducking = parsed;
      } catch {
        setError("The ducking schedule JSON is not valid — fix it or clear the field.");
        return;
      }
    } else if (voicePlanJson.trim()) {
      // 2) Voice plan JSON → derive the ducking schedule deterministically.
      try {
        const parsed = JSON.parse(voicePlanJson);
        if (!Array.isArray(parsed?.segments)) throw new Error("expected { segments: [...] }");
        ducking = buildDuckingSchedule({
          voicePlan: parsed as Parameters<typeof buildDuckingSchedule>[0]["voicePlan"],
          musicVolume: gains.music / 100,
        });
      } catch {
        setError("The voice plan JSON is not valid — fix it or clear the field.");
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<MixResponse>("/api/studio/mix", {
        method: "POST",
        body: JSON.stringify({
          action: "mix",
          voice: { gain: gains.voice / 100 },
          music: {
            gain: gains.music / 100,
            duckedDepthDb: ducking?.mix?.duckedDepthDb ?? 6,
            fadeInMs: ducking?.mix?.fadeInMs ?? 600,
            fadeOutMs: ducking?.mix?.fadeOutMs ?? 1200,
          },
          sfx: { cues: [] },
          ambient: { gain: gains.ambient / 100 },
          loudnessTarget,
          ...(ducking ? { ducking } : {}),
        }),
      });
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
    } finally {
      setBusy(false);
    }
  }

  const duckedMusic = result?.ducked?.tracks.find((t) => t.id === "music");
  const tableTracks = result?.ducked?.tracks ?? result?.plan.tracks ?? [];

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[380px_minmax(0,1fr)]">
      {/* ------------------------------ controls ----------------------------- */}
      <div className="min-w-0 space-y-5">
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-ink">Track gains</h3>
          <div className="mt-4 space-y-4">
            {TRACK_META.map((t) => (
              <div key={t.id}>
                <div className="flex items-baseline justify-between gap-2">
                  <Label htmlFor={`mix-${t.id}`} className="mb-0">
                    {t.label}
                    <span className="ml-2 text-[11px] font-normal text-ink-faint">{t.hint}</span>
                  </Label>
                  <span className="text-xs tabular-nums text-ink-dim">{gains[t.id]}%</span>
                </div>
                <input
                  id={`mix-${t.id}`}
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={gains[t.id]}
                  onChange={(e) => setGains((g) => ({ ...g, [t.id]: Number(e.target.value) }))}
                  className="mt-1 w-full"
                />
              </div>
            ))}
          </div>
          <div className="mt-4">
            <Label htmlFor="mix-lufs">Loudness target (LUFS)</Label>
            <input
              id="mix-lufs"
              type="number"
              min={-40}
              max={-6}
              step={1}
              value={loudnessTarget}
              onChange={(e) => setLoudnessTarget(Number(e.target.value) || -14)}
              className="mt-1.5 h-10 w-full rounded-xl border border-line bg-panel-3/60 px-3.5 text-sm text-ink focus:outline-none focus:border-accent-line"
            />
            <p className="mt-1.5 text-[11px] text-ink-faint">Default −14 LUFS (YouTube).</p>
          </div>
        </Card>
        <Card className="p-5">
          <div className="flex items-center justify-between gap-2">
            <Label className="mb-0">Ducking schedule (JSON)</Label>
            <span className="text-[11px] uppercase tracking-wider text-ink-faint">Optional</span>
          </div>
          <textarea
            value={duckingJson}
            onChange={(e) => setDuckingJson(e.target.value)}
            rows={5}
            spellCheck={false}
            placeholder='{"ducking":[{"startMs":0,"endMs":3000,"dB":-6,"reason":"narrating"}], "mix":{...}}'
            className="mt-2 w-full min-w-0 rounded-xl border border-line bg-panel-3/60 px-3.5 py-3 font-mono text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent-line"
          />
          <div className="mt-3 flex items-center justify-between gap-2">
            <Label className="mb-0">…or voice plan (JSON)</Label>
            <span className="text-[11px] uppercase tracking-wider text-ink-faint">Derives ducking</span>
          </div>
          <textarea
            value={voicePlanJson}
            onChange={(e) => setVoicePlanJson(e.target.value)}
            rows={6}
            spellCheck={false}
            placeholder='{"segments":[{"startMs":0,"endMs":3000}]}'
            className="mt-2 w-full min-w-0 rounded-xl border border-line bg-panel-3/60 px-3.5 py-3 font-mono text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent-line"
          />
          <Button className="mt-4 w-full" onClick={calculate} disabled={busy}>
            {busy ? (
              <>
                <Loader2 size={16} className="animate-spin" /> Calculating mix…
              </>
            ) : (
              <>
                <SlidersHorizontal size={16} /> Calculate mix
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
              No mix yet — set the four track gains and hit “Calculate mix”, optionally with a ducking schedule
              from the Music Studio.
            </p>
          </Card>
        ) : null}

        {result ? (
          <>
            {/* clipping + loudness */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Card className="p-5">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
                  Clipping check
                </h3>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  {result.clipping.prevented ? (
                    <Badge tone="danger">prevented · gain-staging</Badge>
                  ) : (
                    <Badge tone="ok">no clipping risk</Badge>
                  )}
                  <Badge tone="neutral">headroom {result.clipping.headroomDb.toFixed(2)} dB</Badge>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
                  {result.clipping.prevented
                    ? "Gain staging scaled all tracks so the worst-case peak sum sits at −1 dBFS (0.891)."
                    : "The summed track gains stay below −1 dBFS — nothing to stage."}
                </p>
              </Card>
              <Card className="p-5">
                <h3 className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Loudness</h3>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <Badge tone="neutral">target {result.loudness.targetLufs} LUFS</Badge>
                  <Badge tone="accent">≈ {result.loudness.measuredEstimateLufs.toFixed(1)} LUFS est.</Badge>
                  {result.loudness.normalized ? <Badge tone="ok">normalized</Badge> : null}
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">{result.loudness.model}</p>
              </Card>
            </div>

            {/* track table */}
            <Card className="p-5">
              <h3 className="text-sm font-semibold text-ink">Track plan{result.ducked ? " (ducked)" : ""}</h3>
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[460px] text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-[10px] uppercase tracking-[0.16em] text-ink-faint">
                      <th className="py-2 pr-3 font-semibold">Track</th>
                      <th className="py-2 pr-3 font-semibold">Staged gain</th>
                      <th className="py-2 font-semibold">Events</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tableTracks.map((t) => (
                      <tr key={t.id} className="border-b border-line/60 last:border-0">
                        <td className="py-2.5 pr-3 font-medium capitalize text-ink">{t.id}</td>
                        <td className="py-2.5 pr-3 tabular-nums text-ink-dim">
                          {(t.gain * 100).toFixed(0)}%
                        </td>
                        <td className="py-2.5 text-xs text-ink-dim">
                          {t.events && t.events.length > 0 ? `${t.events.length} event${t.events.length === 1 ? "" : "s"}` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            {/* ducked music gain curve */}
            {result.ducked && duckedMusic?.events && duckedMusic.events.length > 0 ? (
              <Card className="p-5">
                <h3 className="text-sm font-semibold text-ink">Ducked music gain curve</h3>
                <div className="mt-3 space-y-2">
                  {duckedMusic.events.map((ev: MixTrackEvent, i: number) => (
                    <div
                      key={i}
                      className={`flex min-w-0 items-center gap-3 rounded-xl border px-3.5 py-2.5 ${
                        ev.type === "narrating" ? "border-accent-line/40 bg-accent-soft/40" : "border-line bg-panel-3/40"
                      }`}
                    >
                      <span className="w-24 shrink-0 font-mono text-xs tabular-nums text-ink-dim">
                        {fmtTime(ev.startMs)}–{fmtTime(ev.endMs)}
                      </span>
                      <span className="w-16 shrink-0 font-mono text-xs tabular-nums text-ink">
                        {(ev.gain * 100).toFixed(0)}%
                      </span>
                      <Badge tone={ev.type === "narrating" ? "accent" : "ok"}>{ev.type}</Badge>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
                  Music is lowered by the duck depth while narration is active and restored at full level in
                  pauses / music-only spans. {result.note ?? ""}
                </p>
              </Card>
            ) : result.note ? (
              <Card className="p-5">
                <p className="text-xs leading-relaxed text-ink-faint">{result.note}</p>
              </Card>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}