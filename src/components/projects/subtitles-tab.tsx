"use client";

/**
 * Workspace Subtitles tab — real captions from the project's own narration.
 * Phase 8 Audio/Subtitle/Thumbnail block, 2026-11-15.
 *
 * What it does, and where every value comes from:
 *   - the cue list is DERIVED ON THE SERVER from this project's Scene rows
 *     through the existing `subtitles` `generate` action (`POST
 *     /api/studio/subtitles` with `{action:"generate", projectId, style}`);
 *     this component computes no timing, no line break and no cue text;
 *   - the style catalogue is the existing `subtitles` `styles` action, and the
 *     resolved style shown is the one the API says it used;
 *   - the .srt and .vtt are downloaded from `GET
 *     /api/projects/:id/subtitles/export`, which rebuilds the plan server-side
 *     from the same rows — the file is never a string this component built.
 *
 * What it says plainly: no subtitle track is burned into any delivered file.
 * The sentence is carried in the API payload and printed verbatim here, because
 * a panel that lets a reader believe the MP4 has captions would be lying.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Captions, Download, Loader2, RefreshCw } from "lucide-react";
import { Badge, Button, Label } from "@/components/ui";
import { apiFetch } from "@/components/projects/client-api";
import { clockLabel, NO_BURN_IN_SENTENCE } from "@/lib/subtitles/from-scenes";
import type { SubtitleStyle } from "@/lib/subtitles/styles";

interface CueDto {
  index: number;
  startMs: number;
  endMs: number;
  text: string;
}

interface SceneGroupDto {
  sceneId: string;
  number: number;
  title: string | null;
  narration: string | null;
  durationSeconds: number | null;
  cues: CueDto[];
  startMs: number | null;
  endMs: number | null;
  missing: string | null;
}

interface StylesPayload {
  styles: SubtitleStyle[];
  auto: { style: SubtitleStyle; reason: string };
}

interface GeneratePayload {
  plan: { cues: CueDto[]; style: string; language: string; timingModel: string };
  chosenStyle: { style: SubtitleStyle; reason: string };
  sceneGroups?: SceneGroupDto[];
  sceneCount?: number;
  scenesWithCues?: number;
  scenesWithoutNarration?: number;
  cueCount?: number;
  timingBasis?: string;
  timingSentence?: string;
  emptyReason?: string | null;
  noBurnIn?: string;
  note?: string;
  requiredEnv?: string[];
}

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; payload: GeneratePayload };

function formatDuration(seconds: number | null): string {
  if (seconds === null || seconds === undefined) return "no duration recorded";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m}m ${rest}s` : `${m}m`;
}

export function SubtitlesTab({ projectId }: { projectId: string }) {
  const [styles, setStyles] = useState<SubtitleStyle[]>([]);
  const [autoStyle, setAutoStyle] = useState<SubtitleStyle | null>(null);
  const [stylesError, setStylesError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string>("auto");
  const [load, setLoad] = useState<LoadState>({ phase: "loading" });

  const generate = useCallback(
    async (style: string) => {
      setLoad((prev) => (prev.phase === "ready" ? prev : { phase: "loading" }));
      try {
        const payload = await apiFetch<GeneratePayload>("/api/studio/subtitles", {
          method: "POST",
          body: JSON.stringify({ action: "generate", projectId, style }),
        });
        setLoad({ phase: "ready", payload });
      } catch (e) {
        setLoad({ phase: "error", message: e instanceof Error ? e.message : "Could not generate captions." });
      }
    },
    [projectId],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const body = await apiFetch<StylesPayload>("/api/studio/subtitles", {
          method: "POST",
          body: JSON.stringify({ action: "styles" }),
        });
        if (cancelled) return;
        setStyles(Array.isArray(body.styles) ? body.styles : []);
        setAutoStyle(body.auto?.style ?? null);
      } catch (e) {
        if (!cancelled) setStylesError(e instanceof Error ? e.message : "Could not load the style catalogue.");
      }
    })();
    void generate("auto");
    return () => {
      cancelled = true;
    };
  }, [generate]);

  function onStyleChange(next: string) {
    setSelected(next);
    void generate(next);
  }

  const payload = load.phase === "ready" ? load.payload : null;
  const resolvedStyle = payload?.chosenStyle?.style ?? null;
  const resolvedStyleId = payload?.plan?.style ?? resolvedStyle?.id ?? null;
  const groups = payload?.sceneGroups ?? [];
  const cueCount = payload?.cueCount ?? payload?.plan?.cues?.length ?? 0;
  const hasCues = cueCount > 0 && resolvedStyleId !== null;
  const exportBase = resolvedStyleId ? `/api/projects/${projectId}/subtitles/export?style=${encodeURIComponent(resolvedStyleId)}` : null;

  return (
    <div className="mt-5 space-y-4">
      {/* ---------------------------------------------- what is NOT true */}
      <div className="rounded-xl border border-warn/30 bg-warn/10 px-4 py-3">
        <div className="flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />
          <p className="text-[13px] leading-relaxed text-ink" data-testid="no-burn-in">
            {payload?.noBurnIn ?? NO_BURN_IN_SENTENCE}
          </p>
        </div>
      </div>

      {/* ------------------------------------------------------- the panel */}
      <div className="glass p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Captions size={15} className="text-accent" />
              <h2 className="font-display text-sm font-semibold text-ink">Captions from this project&apos;s scenes</h2>
            </div>
            <p className="mt-1 text-xs text-ink-dim">
              Every cue below is derived on the server from this project&apos;s own Scene rows — the narration text and
              the duration recorded on each row — in scene order.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => void generate(selected)}
            disabled={load.phase === "loading"}
          >
            {load.phase === "loading" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Re-derive cues
          </Button>
        </div>

        <div className="mt-4 flex flex-wrap items-end gap-3">
          <div className="min-w-[220px]">
            <Label htmlFor="subtitle-style">Caption style</Label>
            <select
              id="subtitle-style"
              value={selected}
              onChange={(e) => onStyleChange(e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-panel-3/60 px-3 text-sm text-ink focus:outline-none focus:border-accent-line focus:ring-2 focus:ring-accent/20 transition-colors cursor-pointer"
            >
              <option value="auto">
                Auto{autoStyle ? ` — engine picks ${autoStyle.name}` : ""}
              </option>
              {styles.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          {resolvedStyle ? (
            <div className="text-xs text-ink-dim" data-testid="resolved-style">
              <span className="text-ink-faint">In use:</span>{" "}
              <span className="font-medium text-ink">{resolvedStyle.name}</span> · {resolvedStyle.font} ·{" "}
              {resolvedStyle.size}px on a 1080p frame · {resolvedStyle.position}
              {payload?.chosenStyle?.reason ? ` · ${payload.chosenStyle.reason}` : ""}
            </div>
          ) : null}
        </div>

        {stylesError ? (
          <p className="mt-3 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">
            {stylesError}
          </p>
        ) : null}

        {/* ------------------------------------------------------- body */}
        {load.phase === "loading" ? (
          <p className="mt-5 flex items-center gap-2 text-sm text-ink-dim">
            <Loader2 size={14} className="animate-spin" /> Deriving cues from this project&apos;s scenes…
          </p>
        ) : load.phase === "error" ? (
          <p className="mt-5 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
            {load.message}
          </p>
        ) : payload ? (
          <>
            <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-line bg-panel-2/40 px-3 py-2.5">
                <div className="text-[11px] uppercase tracking-wide text-ink-faint">Cues</div>
                <div className="font-display text-lg font-semibold text-ink" data-testid="cue-count">
                  {cueCount}
                </div>
              </div>
              <div className="rounded-xl border border-line bg-panel-2/40 px-3 py-2.5">
                <div className="text-[11px] uppercase tracking-wide text-ink-faint">Scenes with cues</div>
                <div className="font-display text-lg font-semibold text-ink">
                  {payload.scenesWithCues ?? 0} / {payload.sceneCount ?? 0}
                </div>
              </div>
              <div className="rounded-xl border border-line bg-panel-2/40 px-3 py-2.5">
                <div className="text-[11px] uppercase tracking-wide text-ink-faint">Scenes without narration</div>
                <div className="font-display text-lg font-semibold text-ink">{payload.scenesWithoutNarration ?? 0}</div>
              </div>
              <div className="rounded-xl border border-line bg-panel-2/40 px-3 py-2.5">
                <div className="text-[11px] uppercase tracking-wide text-ink-faint">Timing</div>
                <div className="font-display text-lg font-semibold capitalize text-ink">{payload.timingBasis ?? "—"}</div>
              </div>
            </div>

            {payload.timingSentence ? (
              <p className="mt-3 text-xs leading-relaxed text-ink-dim">{payload.timingSentence}</p>
            ) : null}

            {/* ------------------------------------------------ download */}
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-panel-2/40 px-3 py-3">
              <span className="text-xs text-ink-dim">Take the captions away:</span>
              {hasCues && exportBase ? (
                <>
                  <a
                    href={`${exportBase}&format=srt`}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium text-ink-dim transition-colors hover:bg-panel-2 hover:text-ink"
                    data-testid="download-srt"
                  >
                    <Download size={13} /> .srt
                  </a>
                  <a
                    href={`${exportBase}&format=vtt`}
                    className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium text-ink-dim transition-colors hover:bg-panel-2 hover:text-ink"
                    data-testid="download-vtt"
                  >
                    <Download size={13} /> .vtt
                  </a>
                  <span className="text-[11px] text-ink-faint">
                    Built on the server from these rows, in the {resolvedStyle?.name ?? resolvedStyleId} style.
                  </span>
                </>
              ) : (
                <span className="text-xs text-ink-faint">No cue exists, so there is no file to download.</span>
              )}
            </div>

            {payload.note ? <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">{payload.note}</p> : null}

            {/* ------------------------------------------- cue list */}
            {groups.length === 0 ? (
              <p className="mt-5 rounded-xl border border-line bg-panel-2/40 px-3 py-3 text-sm text-ink-dim">
                {payload.emptyReason ?? "This project produced no scenes, so there are no captions to show."}
              </p>
            ) : (
              <div className="mt-5 space-y-3">
                {groups.map((group) => (
                  <div key={group.sceneId} className="rounded-xl border border-line bg-panel-2/30">
                    <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-3 py-2">
                      <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
                        Scene {group.number}
                      </span>
                      <span className="text-[13px] font-medium text-ink">{group.title ?? "Untitled scene"}</span>
                      <Badge tone="neutral">{formatDuration(group.durationSeconds)}</Badge>
                      <Badge tone={group.cues.length > 0 ? "accent" : "neutral"}>
                        {group.cues.length} cue{group.cues.length === 1 ? "" : "s"}
                      </Badge>
                      {group.startMs !== null && group.endMs !== null ? (
                        <span className="ml-auto font-mono text-[11px] text-ink-faint">
                          {clockLabel(group.startMs)} → {clockLabel(group.endMs)}
                        </span>
                      ) : null}
                    </div>
                    {group.cues.length === 0 ? (
                      <p className="px-3 py-3 text-xs leading-relaxed text-ink-dim">{group.missing}</p>
                    ) : (
                      <ul className="divide-y divide-line-soft">
                        {group.cues.map((cue) => (
                          <li key={`${group.sceneId}-${cue.index}`} className="flex gap-3 px-3 py-2">
                            <span className="w-8 shrink-0 text-right font-mono text-[11px] text-ink-faint">
                              {cue.index}
                            </span>
                            <span className="w-32 shrink-0 font-mono text-[11px] text-ink-dim">
                              {clockLabel(cue.startMs)} → {clockLabel(cue.endMs)}
                            </span>
                            <span className="whitespace-pre-line text-[13px] leading-relaxed text-ink">
                              {cue.text}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
