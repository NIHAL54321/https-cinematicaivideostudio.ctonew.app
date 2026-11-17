"use client";

/**
 * Workspace Music tab — real Audius search, genre/mood filters, previews, and a
 * licence badge on every track that decides what may be exported.
 * BLOCK M1, 2026-11-17.
 *
 * Every fact on this panel comes from the server:
 *   - the tracks and their verdicts from `GET /api/studio/music/search` (the
 *     server runs the licence decision table; this component decides nothing
 *     about exportability),
 *   - the provider slots, the current selection and its stored verdict from
 *     `GET /api/projects/:id/music`,
 *   - the audio from our own preview proxy, so no provider URL reaches the
 *     browser.
 *
 * The genre and mood selects are populated from values the provider actually
 * returned in THIS session (accumulated across searches) — there is no
 * hardcoded genre list here. A badge appears only on a row the server evaluated.
 *
 * What this deliberately does NOT have: any statement that music is in a
 * delivered file. It is not — mixing is the next block — and the panel says so.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, Music, Pause, Play, RefreshCw, Search, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui";
import { apiFetch } from "@/components/projects/client-api";
import type { MusicSearchView, MusicTrackRow, MusicView } from "@/lib/music/service";

type ViewState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; view: MusicView };

type SearchState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; result: MusicSearchView };

type PreviewState = { trackId: string | null; playing: boolean; error: string | null };

function duration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export function MusicTab({ projectId }: { projectId: string }) {
  const [load, setLoad] = useState<ViewState>({ phase: "loading" });
  const [q, setQ] = useState("");
  const [genre, setGenre] = useState("");
  const [mood, setMood] = useState("");
  const [search, setSearch] = useState<SearchState>({ phase: "idle" });
  // Values the provider has actually returned this session. Never a constant.
  const [facets, setFacets] = useState<{ genres: string[]; moods: string[] }>({ genres: [], moods: [] });
  const [preview, setPreview] = useState<PreviewState>({ trackId: null, playing: false, error: null });
  const [selecting, setSelecting] = useState<string | null>(null);
  const [refusal, setRefusal] = useState<{ trackId: string; reason: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const read = useCallback(async () => {
    setLoad((prev) => (prev.phase === "ready" ? prev : { phase: "loading" }));
    try {
      const view = await apiFetch<MusicView>(`/api/projects/${projectId}/music`);
      setLoad({ phase: "ready", view });
    } catch (e) {
      setLoad({
        phase: "error",
        message: e instanceof Error ? e.message : "Could not read this project's music selection.",
      });
    }
  }, [projectId]);

  useEffect(() => {
    void read();
  }, [read]);

  const view = load.phase === "ready" ? load.view : null;

  const runSearch = useCallback(
    async (event?: React.FormEvent) => {
      event?.preventDefault();
      const query = q.trim();
      if (query.length === 0) {
        setSearch({ phase: "error", message: "Type a title or artist to search the catalogue." });
        return;
      }
      setSearch({ phase: "loading" });
      setPreview({ trackId: null, playing: false, error: null });
      setNotice(null);
      const params = new URLSearchParams({
        q: query,
        limit: "20",
        intendedUse: view?.intendedUse ?? "commercial",
      });
      if (genre) params.set("genre", genre);
      if (mood) params.set("mood", mood);
      try {
        const result = await apiFetch<MusicSearchView>(`/api/studio/music/search?${params.toString()}`);
        setSearch({ phase: "ready", result });
        setFacets((prev) => ({
          genres: [...new Set([...prev.genres, ...result.facets.genres])].sort(),
          moods: [...new Set([...prev.moods, ...result.facets.moods])].sort(),
        }));
      } catch (e) {
        setSearch({
          phase: "error",
          message: e instanceof Error ? e.message : "The music search failed.",
        });
      }
    },
    [q, genre, mood, view?.intendedUse],
  );

  const useTrack = useCallback(
    async (row: MusicTrackRow) => {
      const trackId = row.track.providerTrackId;
      setSelecting(trackId);
      setRefusal(null);
      setNotice(null);
      try {
        const res = await apiFetch<{ selection: unknown; view: MusicView }>(
          `/api/projects/${projectId}/music/select`,
          {
            method: "POST",
            body: JSON.stringify({
              provider: row.track.providerId,
              providerTrackId: trackId,
            }),
          },
        );
        setLoad({ phase: "ready", view: res.view });
        setNotice(`“${row.track.title}” is now this project's selection.`);
      } catch (e) {
        // The server's reason, verbatim. The selection does not change.
        setRefusal({
          trackId,
          reason: e instanceof Error ? e.message : "The track could not be selected.",
        });
      } finally {
        setSelecting(null);
      }
    },
    [projectId],
  );

  const clearSelection = useCallback(async () => {
    setNotice(null);
    try {
      const res = await apiFetch<{ deleted: number; view: MusicView }>(`/api/projects/${projectId}/music`, {
        method: "DELETE",
      });
      setLoad({ phase: "ready", view: res.view });
      setNotice(
        res.deleted === 0
          ? "There was no selection to clear."
          : `Selection cleared — ${res.deleted} stored row${res.deleted === 1 ? "" : "s"} deleted.`,
      );
    } catch (e) {
      setLoad({
        phase: "error",
        message: e instanceof Error ? e.message : "Could not clear the selection.",
      });
    }
  }, [projectId]);

  const result = search.phase === "ready" ? search.result : null;

  return (
    <div className="mt-5 space-y-4">
      {/* ------------------------------------------- what is NOT true yet */}
      <div className="rounded-xl border border-warn/30 bg-warn/10 px-4 py-3">
        <div className="flex items-start gap-2">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-warn" />
          <p className="text-[13px] leading-relaxed text-ink" data-testid="music-no-mix">
            {view?.note ??
              "No music is in any delivered file yet: this tab selects a track and records its licence. Mixing music into a render is the next block."}
          </p>
        </div>
      </div>

      <div className="glass p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <Music size={15} className="text-accent" />
              <h2 className="font-display text-sm font-semibold text-ink">Music library</h2>
            </div>
            <p className="mt-1 text-xs text-ink-dim">
              Real tracks from the catalogue, with the licence each uploader stated. The badge is this
              product&apos;s licence decision, not a clearance.
            </p>
          </div>
          <button
            onClick={() => void read()}
            disabled={load.phase === "loading"}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium text-ink-dim transition-colors hover:bg-panel-2 hover:text-ink disabled:opacity-60 cursor-pointer"
            data-testid="music-reread"
          >
            {load.phase === "loading" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Re-read
          </button>
        </div>

        {load.phase === "loading" ? (
          <p className="mt-5 flex items-center gap-2 text-sm text-ink-dim">
            <Loader2 size={14} className="animate-spin" /> Reading this project&apos;s music facts…
          </p>
        ) : load.phase === "error" ? (
          <p className="mt-5 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">
            {load.message}
          </p>
        ) : view ? (
          <>
            {/* -------------------------------------- provider + intended use */}
            <div className="mt-4 rounded-xl border border-line bg-panel-2/40 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] uppercase tracking-wide text-ink-faint">Providers</span>
                {view.providers.map((p) => (
                  <span
                    key={p.id}
                    className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-[11px] text-ink-dim"
                    data-testid={`music-provider-${p.id}`}
                  >
                    <span className="font-medium text-ink">{p.label}</span>
                    <Badge tone={p.configured ? "ok" : "neutral"}>
                      {p.configured ? "configured" : "not configured"}
                    </Badge>
                    {p.requiredEnv.length > 0 ? (
                      <code className="font-mono text-[10px] text-ink-faint">{p.requiredEnv.join(" · ")}</code>
                    ) : null}
                  </span>
                ))}
                <span className="ml-auto text-[11px] text-ink-dim" data-testid="music-intended-use">
                  Intended use: <span className="font-medium text-ink">{view.intendedUse}</span>
                </span>
              </div>
              <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">{view.licenceNote}</p>
            </div>

            {/* --------------------------------------------- current selection */}
            <div className="mt-3 rounded-xl border border-line bg-panel-2/40 px-3 py-2.5" data-testid="music-selection">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] uppercase tracking-wide text-ink-faint">Selection</span>
                {view.selection ? (
                  <>
                    <span className="text-[13px] font-medium text-ink">{view.selection.title}</span>
                    <span className="text-[11px] text-ink-dim">
                      {view.selection.artist ?? view.selection.artistHandle ?? "unknown artist"}
                      {view.selection.artistHandle ? ` · @${view.selection.artistHandle}` : ""}
                    </span>
                    <span className="font-mono text-[11px] text-ink-faint">
                      {duration(view.selection.durationSeconds)}
                    </span>
                    <LicenceBadge verdict={view.selection.verdict} testId="music-selection-badge" />
                    <button
                      onClick={() => void clearSelection()}
                      className="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[11px] font-medium text-ink-dim transition-colors hover:bg-panel-2 hover:text-ink cursor-pointer"
                      data-testid="music-clear-selection"
                    >
                      <Trash2 size={12} /> Clear selection
                    </button>
                  </>
                ) : (
                  <span className="text-[12px] text-ink-dim" data-testid="music-no-selection">
                    No track selected for this project.
                  </span>
                )}
              </div>
              {view.selection ? (
                <>
                  <p className="mt-1 text-[11px] leading-relaxed text-ink-dim">
                    Licence stated by the uploader: <span className="text-ink">{view.selection.licenceText ?? "none"}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
                    Verdict basis: {view.selection.verdict.basis} · evaluated {view.selection.evaluatedAt} ·{" "}
                    {view.counts.musicAssets} stored MUSIC row{view.counts.musicAssets === 1 ? "" : "s"} for this project
                  </p>
                </>
              ) : null}
              {notice ? (
                <p className="mt-1 text-[11px] text-ok" data-testid="music-notice">
                  {notice}
                </p>
              ) : null}
            </div>

            {/* -------------------------------------------------- the search */}
            <form onSubmit={runSearch} className="mt-4 rounded-xl border border-line bg-panel-2/40 p-3">
              <div className="flex flex-wrap items-end gap-2">
                <label className="min-w-[180px] flex-1">
                  <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-faint">Title or artist</span>
                  <input
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="cinematic"
                    className="h-9 w-full rounded-lg border border-line bg-panel-3/50 px-3 text-sm text-ink outline-none focus:border-accent-line"
                    data-testid="music-search-input"
                  />
                </label>
                <label>
                  <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-faint">Genre</span>
                  <select
                    value={genre}
                    onChange={(e) => setGenre(e.target.value)}
                    className="h-9 rounded-lg border border-line bg-panel-3/50 px-2 text-sm text-ink outline-none focus:border-accent-line"
                    data-testid="music-genre"
                  >
                    <option value="">Any genre</option>
                    {facets.genres.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span className="mb-1 block text-[11px] uppercase tracking-wide text-ink-faint">Mood</span>
                  <select
                    value={mood}
                    onChange={(e) => setMood(e.target.value)}
                    className="h-9 rounded-lg border border-line bg-panel-3/50 px-2 text-sm text-ink outline-none focus:border-accent-line"
                    data-testid="music-mood"
                  >
                    <option value="">Any mood</option>
                    {facets.moods.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="submit"
                  disabled={search.phase === "loading"}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-accent-line bg-accent-soft px-3 text-xs font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-60 cursor-pointer"
                  data-testid="music-search-submit"
                >
                  {search.phase === "loading" ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                  Search
                </button>
              </div>
              <p className="mt-1.5 text-[11px] text-ink-faint">
                {facets.genres.length === 0 && facets.moods.length === 0
                  ? "The genre and mood filters fill from values the catalogue actually returns — none yet this session."
                  : `Filters offered from values returned this session: ${facets.genres.length} genre${facets.genres.length === 1 ? "" : "s"}, ${facets.moods.length} mood${facets.moods.length === 1 ? "" : "s"}.`}
              </p>

              {search.phase === "loading" ? (
                <p className="mt-3 flex items-center gap-2 text-sm text-ink-dim">
                  <Loader2 size={14} className="animate-spin" /> Searching the catalogue…
                </p>
              ) : search.phase === "error" ? (
                <p
                  className="mt-3 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger"
                  data-testid="music-search-error"
                >
                  {search.message}
                </p>
              ) : result ? (
                <>
                  <p className="mt-3 text-[12px] font-medium text-ink" data-testid="music-counts">
                    {result.counts.total} track{result.counts.total === 1 ? "" : "s"} · {result.counts.exportAllowed}{" "}
                    export-allowed · {result.counts.previewOnly} preview-only
                  </p>
                  <p className="text-[11px] text-ink-faint">
                    “{result.query.q}”{result.query.genre ? ` · genre ${result.query.genre}` : ""}
                    {result.query.mood ? ` · mood ${result.query.mood}` : ""} · limit {result.query.limit} · provider{" "}
                    {result.provider.label} · verdicts computed for {result.intendedUse} use
                  </p>

                  {result.tracks.length === 0 ? (
                    <p className="mt-2 text-sm text-ink-dim" data-testid="music-empty">
                      The catalogue returned no tracks for that query. That is the provider&apos;s answer, not a
                      filtered list.
                    </p>
                  ) : (
                    <ul className="mt-2 space-y-1.5">
                      {result.tracks.map((row) => {
                        const id = row.track.providerTrackId;
                        const isPreviewing = preview.trackId === id;
                        return (
                          <li
                            key={`${row.track.providerId}:${id}`}
                            className="rounded-lg border border-line bg-panel-3/40 px-3 py-2"
                            data-testid="music-row"
                            data-track-id={id}
                          >
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[13px] font-medium text-ink">{row.track.title}</span>
                              <span className="text-[11px] text-ink-dim">
                                {row.track.artist ?? row.track.artistHandle ?? "unknown artist"}
                                {row.track.artistHandle ? ` · @${row.track.artistHandle}` : ""}
                              </span>
                              <span className="font-mono text-[11px] text-ink-faint">
                                {duration(row.track.durationSeconds)}
                              </span>
                              <span className="text-[11px] text-ink-faint">
                                {[row.track.genre, row.track.mood].filter(Boolean).join(" · ") || "no genre or mood"}
                              </span>
                              <LicenceBadge verdict={row.verdict} testId={`music-badge-${id}`} />
                              <div className="ml-auto flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (isPreviewing) {
                                      setPreview({ trackId: null, playing: false, error: null });
                                    } else {
                                      setPreview({ trackId: id, playing: false, error: null });
                                    }
                                  }}
                                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[11px] font-medium text-ink-dim transition-colors hover:bg-panel-2 hover:text-ink cursor-pointer"
                                  data-testid={`music-preview-toggle-${id}`}
                                >
                                  {isPreviewing && preview.playing ? <Pause size={12} /> : <Play size={12} />}
                                  {isPreviewing && preview.playing ? "Playing" : "Preview"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void useTrack(row)}
                                  disabled={selecting === id}
                                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-accent-line bg-accent-soft px-2.5 text-[11px] font-medium text-accent transition-colors hover:bg-accent/20 disabled:opacity-60 cursor-pointer"
                                  data-testid={`music-use-${id}`}
                                >
                                  {selecting === id ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                                  Use as background music
                                </button>
                              </div>
                            </div>

                            <p className="mt-0.5 text-[11px] leading-relaxed text-ink-dim">
                              Licence stated by the uploader:{" "}
                              <span className="text-ink">{row.track.licenceText ?? "none"}</span>
                              {row.verdict.permitted ? "" : ` — ${row.verdict.reason}`}
                            </p>

                            {isPreviewing ? (
                              <div className="mt-1.5">
                                <audio
                                  controls
                                  autoPlay
                                  preload="none"
                                  className="h-9 w-full max-w-md"
                                  data-testid="music-preview-audio"
                                  src={`/api/studio/music/preview/${row.track.providerId}/${encodeURIComponent(id)}`}
                                  onPlay={() => setPreview({ trackId: id, playing: true, error: null })}
                                  onPause={() => setPreview({ trackId: id, playing: false, error: null })}
                                  onEnded={() => setPreview({ trackId: id, playing: false, error: null })}
                                  onError={() =>
                                    setPreview({
                                      trackId: id,
                                      playing: false,
                                      error: "This preview did not play — the provider did not serve the audio.",
                                    })
                                  }
                                />
                                {preview.error ? (
                                  <p className="mt-1 text-[11px] text-danger" data-testid={`music-preview-error-${id}`}>
                                    {preview.error}
                                  </p>
                                ) : null}
                              </div>
                            ) : null}

                            {refusal && refusal.trackId === id ? (
                              <p
                                className="mt-1.5 rounded-lg border border-danger/25 bg-danger/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-danger"
                                data-testid="music-refusal"
                              >
                                Not selected — {refusal.reason}
                              </p>
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </>
              ) : null}
            </form>

            <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">{view.licenceNote}</p>
          </>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The licence badge. Green + "uploader-claimed" only when the server's verdict
 * permitted the track; amber + the one-line reason otherwise. There is no third
 * state: a track that was not evaluated is not rendered at all.
 */
function LicenceBadge({
  verdict,
  testId,
}: {
  verdict: { permitted: boolean; reason: string; attributionRequired: boolean; basis: string };
  testId: string;
}) {
  if (verdict.permitted) {
    return (
      <span className="inline-flex items-center gap-1.5" data-testid={testId}>
        <span className="inline-flex items-center rounded-full border border-ok/25 bg-ok/10 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-ok">
          Export allowed
        </span>
        <span className="text-[10px] uppercase tracking-wide text-ink-faint">
          {verdict.attributionRequired ? "uploader-claimed · attribution required" : "uploader-claimed"}
        </span>
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5" data-testid={testId}>
      <span className="inline-flex items-center rounded-full border border-warn/30 bg-warn/10 px-2.5 py-0.5 text-[11px] font-medium uppercase tracking-wider text-warn">
        Preview only
      </span>
      <span className="text-[10px] text-ink-faint">{verdict.reason}</span>
    </span>
  );
}
