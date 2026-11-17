"use client";

/**
 * Workspace Voice & Audio tab — the catalogue, the plans, and the delivered
 * file's own audio track. Phase 8 Audio/Subtitle/Thumbnail block, Block B.
 *
 * Every sentence and every number on this panel arrives in the payload from
 * `GET /api/projects/:id/voice-audio`, which derives it on the server from this
 * project's rows and from the voice/music/sfx engines. The component formats
 * timings and lays the payload out; it derives no fact of its own.
 *
 * What it deliberately does NOT have: a "Generate voice", "Generate music" or
 * "Add sound effects" control. No text-to-speech, music or sound-effects
 * provider is wired on this deployment, so such a button could not work — and a
 * control that cannot work is the defect this block removes. The one control
 * here re-reads the payload, which does work.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, Mic, Music, RefreshCw, Volume2, Waves } from "lucide-react";
import { Badge } from "@/components/ui";
import { apiFetch } from "@/components/projects/client-api";
import { clockLabel } from "@/lib/subtitles/from-scenes";
import type { VoiceAudioView } from "@/lib/studio/voice-audio-view";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; view: VoiceAudioView };

function ms(msValue: number): string {
  return `${clockLabel(msValue)} (${Math.round(msValue)} ms)`;
}

export function VoiceAudioTab({ projectId }: { projectId: string }) {
  const [load, setLoad] = useState<LoadState>({ phase: "loading" });

  const read = useCallback(async () => {
    setLoad((prev) => (prev.phase === "ready" ? prev : { phase: "loading" }));
    try {
      const view = await apiFetch<VoiceAudioView>(`/api/projects/${projectId}/voice-audio`);
      setLoad({ phase: "ready", view });
    } catch (e) {
      setLoad({ phase: "error", message: e instanceof Error ? e.message : "Could not read the audio facts for this project." });
    }
  }, [projectId]);

  useEffect(() => {
    void read();
  }, [read]);

  const view = load.phase === "ready" ? load.view : null;

  return (
    <div className="mt-5 space-y-4">
      {/* ------------------------------------------- what is NOT true */}
      <div className="rounded-xl border border-warn/30 bg-warn/10 px-4 py-3">
        <div className="flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />
          <p className="text-[13px] leading-relaxed text-ink" data-testid="no-tts-provider">
            {view?.catalogue.sentence ??
              "No text-to-speech provider is wired on this deployment, so no narration can be produced — and none is in any delivered file."}
          </p>
        </div>
      </div>

      <div className="glass p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Mic size={15} className="text-accent" />
              <h2 className="font-display text-sm font-semibold text-ink">Voice catalogue</h2>
            </div>
            <p className="mt-1 text-xs text-ink-dim">
              Every persona this build ships, with the provider-side id each one maps to. A null there is why no
              narration can be produced.
            </p>
          </div>
          <button
            onClick={() => void read()}
            disabled={load.phase === "loading"}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium text-ink-dim transition-colors hover:bg-panel-2 hover:text-ink disabled:opacity-60 cursor-pointer"
            data-testid="voice-audio-reread"
          >
            {load.phase === "loading" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Re-read
          </button>
        </div>

        {load.phase === "loading" ? (
          <p className="mt-5 flex items-center gap-2 text-sm text-ink-dim">
            <Loader2 size={14} className="animate-spin" /> Reading this project&apos;s audio facts…
          </p>
        ) : load.phase === "error" ? (
          <p className="mt-5 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">{load.message}</p>
        ) : view ? (
          <>
            {/* -------------------------------------- provider facts */}
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-line bg-panel-2/40 px-3 py-2.5">
                <div className="text-[11px] uppercase tracking-wide text-ink-faint">Personas</div>
                <div className="font-display text-lg font-semibold text-ink" data-testid="voice-count">
                  {view.catalogue.count}
                </div>
              </div>
              <div className="rounded-xl border border-line bg-panel-2/40 px-3 py-2.5">
                <div className="text-[11px] uppercase tracking-wide text-ink-faint">providerVoiceId null</div>
                <div className="font-display text-lg font-semibold text-ink" data-testid="null-voice-ids">
                  {view.catalogue.providerVoiceIdNullCount}
                </div>
              </div>
              <div className="rounded-xl border border-line bg-panel-2/40 px-3 py-2.5">
                <div className="text-[11px] uppercase tracking-wide text-ink-faint">voice_generation</div>
                <div className="font-display text-lg font-semibold capitalize text-ink">
                  {view.provider.status.replace(/_/g, " ")}
                </div>
              </div>
              <div className="rounded-xl border border-line bg-panel-2/40 px-3 py-2.5">
                <div className="text-[11px] uppercase tracking-wide text-ink-faint">Voiceover rows</div>
                <div className="font-display text-lg font-semibold text-ink">{view.voiceoverRows}</div>
              </div>
            </div>

            <div className="mt-3 rounded-xl border border-line bg-panel-2/40 px-3 py-2.5">
              <div className="text-[11px] uppercase tracking-wide text-ink-faint">
                Env var that would enable voice_generation
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {view.provider.requiredEnv.length === 0 ? (
                  <span className="text-xs text-ink-dim">none — no provider slot serves the capability</span>
                ) : (
                  view.provider.requiredEnv.map((name) => (
                    <code key={name} className="rounded-md border border-line bg-panel-3/60 px-1.5 py-0.5 font-mono text-[11px] text-ink">
                      {name}
                    </code>
                  ))
                )}
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">{view.provider.envNote}</p>
              <ul className="mt-2 flex flex-wrap gap-2">
                {view.provider.providers.map((p) => (
                  <li key={p.id} className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[11px] text-ink-dim">
                    <span className="font-medium text-ink">{p.name}</span>
                    <Badge tone={p.configured ? "accent" : "neutral"}>{p.configured ? "configured" : "not configured"}</Badge>
                    <Badge tone={p.wired ? "accent" : "neutral"}>{p.wired ? "wired" : "not wired"}</Badge>
                  </li>
                ))}
              </ul>
            </div>

            {/* ------------------------------------------ the catalogue */}
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {view.catalogue.voices.map((v) => (
                <div key={v.id} className="rounded-xl border border-line bg-panel-2/30 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[13px] font-medium text-ink">{v.name}</span>
                    <Badge tone="neutral">{v.persona}</Badge>
                    <span className="text-[11px] text-ink-faint">
                      {v.gender} · {v.accent} · {v.tone}
                    </span>
                  </div>
                  <p className="mt-1 text-xs leading-relaxed text-ink-dim">{v.description}</p>
                  <p className="mt-1 font-mono text-[11px] text-ink-faint">
                    providerVoiceId: {v.providerVoiceId === null ? "null" : v.providerVoiceId}
                  </p>
                </div>
              ))}
            </div>

            {/* --------------------------------------------- the plans */}
            <div className="mt-5 rounded-xl border border-line bg-panel-2/40 p-3">
              <div className="flex items-center gap-2">
                <Waves size={14} className="text-accent" />
                <h3 className="font-display text-[13px] font-semibold text-ink">The audio plan — a plan, not audio</h3>
              </div>
              <p className="mt-1 text-xs leading-relaxed text-ink-dim" data-testid="plans-are-plans">
                {view.plans.sentence}
              </p>
              <p className="mt-1 text-[11px] text-ink-faint">
                {view.plans.sceneCount} scene{view.plans.sceneCount === 1 ? "" : "s"} in this project ·{" "}
                {view.plans.scenesWithNarration} with narration
              </p>

              {/* music select */}
              <div className="mt-3 rounded-lg border border-line bg-panel-3/40 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Music size={13} className="text-ink-dim" />
                  <span className="text-[12px] font-medium text-ink">Music — selection</span>
                  <Badge tone="accent">{view.plans.music.top.name}</Badge>
                  <span className="ml-auto font-mono text-[11px] text-ink-faint">score {view.plans.music.top.score}</span>
                </div>
                <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">{view.plans.music.top.reason}</p>
                <p className="mt-1 text-[11px] text-ink-faint">
                  Ranked over this project&apos;s own text: “{view.plans.music.topic}”
                  {view.plans.music.category
                    ? ` · moods ${view.plans.music.category.moods.join(", ")} · ${view.plans.music.category.typicalBpm} BPM typical`
                    : ""}
                </p>
                <ul className="mt-2 space-y-1">
                  {view.plans.music.ranked.map((r) => (
                    <li key={r.categoryId} className="flex items-baseline gap-2 text-[11px] text-ink-dim">
                      <span className="w-8 shrink-0 text-right font-mono text-ink-faint">{r.score}</span>
                      <span className="font-medium text-ink">{r.name}</span>
                      <span className="truncate">{r.reason}</span>
                    </li>
                  ))}
                </ul>
              </div>

              {/* ducking */}
              <div className="mt-2 rounded-lg border border-line bg-panel-3/40 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Volume2 size={13} className="text-ink-dim" />
                  <span className="text-[12px] font-medium text-ink">Music — ducking under narration</span>
                  {view.plans.ducking ? (
                    <span className="ml-auto text-[11px] text-ink-faint">
                      {view.plans.ducking.events.length} window{view.plans.ducking.events.length === 1 ? "" : "s"}
                    </span>
                  ) : null}
                </div>
                {view.plans.ducking ? (
                  <>
                    <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">
                      Built from the director&apos;s plan of this project&apos;s narration ({view.plans.ducking.scenesUsed} scene
                      {view.plans.ducking.scenesUsed === 1 ? "" : "s"}), estimated at{" "}
                      {ms(view.plans.ducking.estimatedDurationMs)}, directed to the catalog persona{" "}
                      <span className="text-ink">{view.plans.ducking.voiceName}</span>. Timing model: {view.plans.ducking.timingModel}.
                    </p>
                    <p className="mt-1 text-[11px] text-ink-faint">
                      Music {Math.round(view.plans.ducking.mix.musicVolume * 100)}% · ducks{" "}
                      {view.plans.ducking.mix.duckedDepthDb} dB · fade in {view.plans.ducking.mix.fadeInMs} ms · fade out{" "}
                      {view.plans.ducking.mix.fadeOutMs} ms
                    </p>
                    <ul className="mt-2 max-h-40 space-y-1 overflow-auto">
                      {view.plans.ducking.events.map((ev, i) => (
                        <li key={`${ev.startMs}-${i}`} className="flex items-baseline gap-2 font-mono text-[11px] text-ink-dim">
                          <span className="w-28 shrink-0">
                            {clockLabel(ev.startMs)} → {clockLabel(ev.endMs)}
                          </span>
                          <span className="w-14 shrink-0 text-right text-ink">{ev.dB} dB</span>
                          <span className="text-ink-faint">{ev.reason}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ) : (
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">{view.plans.duckingMissingReason}</p>
                )}
              </div>

              {/* sfx */}
              <div className="mt-2 rounded-lg border border-line bg-panel-3/40 px-3 py-2.5">
                <div className="flex items-center gap-2">
                  <Waves size={13} className="text-ink-dim" />
                  <span className="text-[12px] font-medium text-ink">Sound effects — placement</span>
                  {view.plans.sfx ? (
                    <span className="ml-auto text-[11px] text-ink-faint">
                      {view.plans.sfx.events.length} hit{view.plans.sfx.events.length === 1 ? "" : "s"} · max{" "}
                      {view.plans.sfx.policy.maxPerScene}/scene · ≥ {view.plans.sfx.policy.minGapMs} ms apart
                    </span>
                  ) : null}
                </div>
                {view.plans.sfx ? (
                  <>
                    <p className="mt-1 text-[11px] text-ink-faint">Timing model: {view.plans.sfx.timingModel}</p>
                    {view.plans.sfx.events.length === 0 ? (
                      <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">
                        The planner placed no effect: no scene carries a transition type or a keyword the library matches, and
                        it places nothing on a plain talking scene.
                      </p>
                    ) : (
                      <ul className="mt-2 max-h-40 space-y-1 overflow-auto">
                        {view.plans.sfx.events.map((ev, i) => (
                          <li key={`${ev.startMs}-${ev.sfxId}-${i}`} className="flex items-baseline gap-2 font-mono text-[11px] text-ink-dim">
                            <span className="w-28 shrink-0">
                              {clockLabel(ev.startMs)} → {clockLabel(ev.endMs)}
                            </span>
                            <span className="w-24 shrink-0 text-ink">{ev.sfxId}</span>
                            <span className="truncate text-ink-faint">{ev.reason}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </>
                ) : (
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">{view.plans.sfxMissingReason}</p>
                )}
              </div>
            </div>

            {/* ------------------------------- the delivered file's audio */}
            <div className="mt-4 rounded-xl border border-line bg-panel-2/40 p-3">
              <h3 className="font-display text-[13px] font-semibold text-ink">
                What the delivered file&apos;s audio actually is
              </h3>
              <p className="mt-1 text-xs leading-relaxed text-ink-dim" data-testid="delivered-audio">
                {view.delivered.sentence}
              </p>
              {view.delivered.files.length > 0 ? (
                <ul className="mt-2 space-y-2">
                  {view.delivered.files.map((f) => (
                    <li key={f.jobId} className="rounded-lg border border-line bg-panel-3/40 px-3 py-2">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-faint">
                        <span className="font-mono text-ink-dim">job {f.jobId}</span>
                        <Badge tone="neutral">{f.presetLabel}</Badge>
                        <span className="font-mono">
                          {f.audioCodec ?? "no audio measurement"}
                          {f.audioChannels !== null ? ` · ${f.audioChannels} ch` : ""}
                          {f.audioSampleRateHz !== null ? ` · ${f.audioSampleRateHz} Hz` : ""}
                        </span>
                        <span className="ml-auto font-mono">{f.bytes} B</span>
                      </div>
                      {f.measuredBy ? (
                        <p className="mt-1 font-mono text-[10px] text-ink-faint">measured by {f.measuredBy}</p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">{view.note}</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
