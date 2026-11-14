"use client";

/**
 * Workspace Scenes tab — the first place in this product where a video can be
 * SOURCED AND EDITED BY CLICKING. Phase 8 Scenes-panel block, 2026-11-09.
 *
 * What it does, all of it against routes that already existed:
 *   - lists every scene in order (number, title, narration, duration, visual
 *     prompt) and says whether it has a sourced clip;
 *   - edits title / narration / duration / visual prompt inline through
 *     `PATCH /api/projects/:id/scenes/:sceneId` (which now accepts
 *     `visualPrompt` — without it this panel could show the prompt that drives
 *     the search but never fix it);
 *   - searches stock for a scene from that scene's own prompt
 *     (`GET /api/media?sceneId=…&mediaType=video`), and when the user edits the
 *     query it searches the words actually typed (`?q=…&mediaType=video`);
 *   - on a click: `POST /api/media/select` then `POST /api/media/ingest`, then
 *     re-reads the project so the attached asset shown is the row the render
 *     will read — never an optimistic local copy;
 *   - summarises sourced vs unsourced and states that an unsourced scene blocks
 *     the render.
 *
 * Honesty rules held here:
 *   - no candidate is invented; a provider refusal is printed with the
 *     provider's own words and is never rendered as "no results";
 *   - no match score is shown, because the ranking is ours and the clips are
 *     keyword-found stock — every attached clip is labelled as exactly that,
 *     the same sentence the delivered container carries in its metadata;
 *   - no scene value is written, defaulted or "completed" to make the panel
 *     look finished: an empty narration stays empty and is labelled as such.
 */
import { useCallback, useEffect, useState } from "react";
import { Check, Film, Loader2, RefreshCw, Search, Sparkles } from "lucide-react";
import { Badge, Button, Label } from "@/components/ui";
import { apiFetch } from "@/components/projects/client-api";
import type { ScriptTree } from "@/lib/studio/pipeline";
import type { ProviderAsset } from "@/lib/media/types";
import { readScriptTreeBody } from "@/lib/studio/storyboard-view";
import {
  SOURCE_LABEL,
  licenceSentence,
  readSearchOutcome,
  scenesView,
  type SceneRow,
  type ScenesView,
  type SearchOutcome,
} from "@/lib/studio/scenes-view";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; view: ScenesView };

type SaveState =
  | { phase: "idle" }
  | { phase: "saving" }
  | { phase: "saved"; note: string }
  | { phase: "error"; message: string };

type SearchState =
  | { phase: "idle" }
  | { phase: "loading" }
  | { phase: "done"; outcome: SearchOutcome; at: string }
  | { phase: "error"; message: string };

type PickState =
  | { phase: "idle" }
  | { phase: "selecting"; externalId: string }
  | { phase: "ingesting"; externalId: string }
  | { phase: "done"; message: string }
  | { phase: "error"; message: string };

interface StockStatus {
  connected: Array<{ id: string; name: string; mediaTypes: string[] }>;
  requiredEnv: string[];
  liveProbe: { mediaType: string; status: string; candidates: number; message: string | null } | null;
}

interface Draft {
  title: string;
  narration: string;
  durationSeconds: string;
  visualPrompt: string;
}

function draftFor(scene: SceneRow): Draft {
  return {
    title: scene.title ?? "",
    narration: scene.narration ?? "",
    durationSeconds: scene.durationSeconds === null ? "" : String(scene.durationSeconds),
    visualPrompt: scene.visualPrompt ?? "",
  };
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "no duration recorded";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rest = s % 60;
  return rest ? `${m}m ${rest}s` : `${m}m`;
}

function candidatePreview(asset: ProviderAsset): string | null {
  // Only the provider's OWN preview address is ever shown. No placeholder that
  // would imply a clip exists when none was returned.
  return asset.thumbUrl ?? asset.previewUrl ?? null;
}

export function ScenesTab({ projectId }: { projectId: string }) {
  const [load, setLoad] = useState<LoadState>({ phase: "loading" });
  const [status, setStatus] = useState<StockStatus | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [saves, setSaves] = useState<Record<string, SaveState>>({});
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [queries, setQueries] = useState<Record<string, string>>({});
  const [searches, setSearches] = useState<Record<string, SearchState>>({});
  const [picks, setPicks] = useState<Record<string, PickState>>({});

  const loadProject = useCallback(async () => {
    setLoad((prev) => (prev.phase === "ready" ? prev : { phase: "loading" }));
    try {
      const body = await apiFetch<unknown>(`/api/projects/${projectId}/storyboard`);
      const tree: ScriptTree | null = readScriptTreeBody(body);
      if (!tree) throw new Error("The storyboard response carried no structure tree.");
      const view = scenesView(tree);
      setLoad({ phase: "ready", view });
      if (view.kind === "scenes") {
        setDrafts((prev) => {
          const next = { ...prev };
          for (const scene of view.scenes) next[scene.id] = draftFor(scene);
          return next;
        });
        setQueries((prev) => {
          const next = { ...prev };
          for (const scene of view.scenes) if (next[scene.id] === undefined) next[scene.id] = scene.visualPrompt ?? "";
          return next;
        });
      }
    } catch (e) {
      setLoad({ phase: "error", message: e instanceof Error ? e.message : "Could not load the scenes." });
    }
  }, [projectId]);

  useEffect(() => {
    void loadProject();
  }, [loadProject]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await apiFetch<StockStatus>("/api/media/status");
        if (!cancelled) setStatus(data);
      } catch (e) {
        if (!cancelled) setStatusError(e instanceof Error ? e.message : "Could not read the stock provider status.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function setDraft(sceneId: string, field: keyof Draft, value: string) {
    setDrafts((prev) => ({ ...prev, [sceneId]: { ...prev[sceneId], [field]: value } }));
    setSaves((prev) => ({ ...prev, [sceneId]: { phase: "idle" } }));
  }

  async function saveScene(scene: SceneRow) {
    const draft = drafts[scene.id];
    if (!draft) return;
    const patch: Record<string, unknown> = {};

    const title = draft.title.trim();
    if (title !== (scene.title ?? "")) {
      if (!title) {
        setSaves((prev) => ({
          ...prev,
          [scene.id]: { phase: "error", message: "A scene title cannot be empty — clear it by giving it another name." },
        }));
        return;
      }
      patch.title = title;
    }
    const narration = draft.narration.trim();
    if (narration !== (scene.narration ?? "").trim()) patch.narration = narration || null;

    const durationRaw = draft.durationSeconds.trim();
    if (durationRaw !== (scene.durationSeconds === null ? "" : String(scene.durationSeconds))) {
      const n = Number(durationRaw);
      if (!Number.isInteger(n) || n < 1 || n > 7200) {
        setSaves((prev) => ({
          ...prev,
          [scene.id]: { phase: "error", message: "Duration must be a whole number of seconds between 1 and 7200." },
        }));
        return;
      }
      patch.durationSeconds = n;
    }

    const prompt = draft.visualPrompt.trim();
    if (prompt !== (scene.visualPrompt ?? "").trim()) patch.visualPrompt = prompt || null;

    if (Object.keys(patch).length === 0) {
      setSaves((prev) => ({ ...prev, [scene.id]: { phase: "saved", note: "Nothing changed." } }));
      return;
    }

    setSaves((prev) => ({ ...prev, [scene.id]: { phase: "saving" } }));
    try {
      const res = await apiFetch<{ scene?: { title?: string | null; narration?: string | null; durationSeconds?: number | null; visualPrompt?: string | null } }>(
        `/api/projects/${projectId}/scenes/${scene.id}`,
        { method: "PATCH", body: JSON.stringify(patch) },
      );
      const stored = res.scene ?? {};
      // Re-read from the API, so what the panel shows afterwards is what the
      // database holds — not the words that were typed.
      await loadProject();
      setSaves((prev) => ({
        ...prev,
        [scene.id]: {
          phase: "saved",
          note:
            `Saved ${Object.keys(patch).join(", ")}. Stored now: ` +
            `${stored.title === undefined ? "" : `title “${stored.title ?? ""}”, `}` +
            `${stored.durationSeconds === undefined ? "" : `${stored.durationSeconds ?? "no"}s, `}` +
            `${stored.visualPrompt === undefined ? "" : `visual prompt ${stored.visualPrompt ? "set" : "cleared"}, `}` +
            `${stored.narration === undefined ? "" : `narration ${stored.narration ? "set" : "cleared"}`}`.replace(/, $/, ""),
        },
      }));
    } catch (e) {
      setSaves((prev) => ({
        ...prev,
        [scene.id]: { phase: "error", message: e instanceof Error ? e.message : "The scene was not saved." },
      }));
    }
  }

  async function searchScene(scene: SceneRow) {
    const prompt = (scene.visualPrompt ?? "").trim();
    const typed = (queries[scene.id] ?? "").trim();
    const query = typed || prompt;
    if (!query) {
      setSearches((prev) => ({
        ...prev,
        [scene.id]: {
          phase: "error",
          message: "This scene has no visual prompt, so there is nothing to search on. Write one above and save it first.",
        },
      }));
      return;
    }
    setSearches((prev) => ({ ...prev, [scene.id]: { phase: "loading" } }));
    try {
      const params = new URLSearchParams({ mediaType: "video", count: "8" });
      // The scene's own prompt → the scene route (it also carries the scene's
      // aspect ratio and title). Words the user typed instead → the q route,
      // so the search is built from what is in the box, not from a stale row.
      if (query === prompt) params.set("sceneId", scene.id);
      else params.set("q", query);
      const body = await apiFetch<unknown>(`/api/media?${params.toString()}`);
      const outcome = readSearchOutcome(body);
      setSearches((prev) => ({
        ...prev,
        [scene.id]: { phase: "done", outcome, at: new Date().toISOString() },
      }));
    } catch (e) {
      setSearches((prev) => ({
        ...prev,
        [scene.id]: { phase: "error", message: e instanceof Error ? e.message : "The search failed." },
      }));
    }
  }

  async function chooseCandidate(scene: SceneRow, asset: ProviderAsset) {
    setPicks((prev) => ({ ...prev, [scene.id]: { phase: "selecting", externalId: asset.externalId } }));
    try {
      const selected = await apiFetch<{ asset?: { id?: string } }>("/api/media/select", {
        method: "POST",
        body: JSON.stringify({ sceneId: scene.id, asset }),
      });
      const assetId = selected.asset?.id;
      if (!assetId) {
        throw new Error("The select route returned no asset id, so nothing was ingested and nothing is shown as sourced.");
      }
      setPicks((prev) => ({ ...prev, [scene.id]: { phase: "ingesting", externalId: asset.externalId } }));
      const ingested = await apiFetch<{ footage?: { bytes?: number; alreadyStored?: boolean } }>("/api/media/ingest", {
        method: "POST",
        body: JSON.stringify({ assetId }),
      });
      const bytes = ingested.footage?.bytes;
      await loadProject();
      setPicks((prev) => ({
        ...prev,
        [scene.id]: {
          phase: "done",
          message:
            `Attached “${asset.title}” from ${asset.provider} and stored its bytes` +
            (typeof bytes === "number" ? ` (${bytes.toLocaleString()} B read back by the ingest route)` : "") +
            ".",
        },
      }));
    } catch (e) {
      await loadProject();
      setPicks((prev) => ({
        ...prev,
        [scene.id]: {
          phase: "error",
          message: e instanceof Error ? e.message : "The clip was not attached.",
        },
      }));
    }
  }

  /* ------------------------------------------------------------ status line */
  const statusLine = (() => {
    if (statusError) {
      return `Stock provider status could not be read: ${statusError}`;
    }
    if (!status) return "Reading which stock providers this server can call…";
    if (status.connected.length === 0) {
      return (
        "No stock provider is configured on this server" +
        (status.requiredEnv.length ? ` (set one of ${status.requiredEnv.join(", ")} server-side)` : "") +
        ". Searching will say so instead of showing candidates."
      );
    }
    const names = status.connected.map((p) => `${p.name} (${p.mediaTypes.join(", ")})`).join(", ");
    const probe = status.liveProbe;
    if (!probe) return `Stock providers connected: ${names}. No live probe was run.`;
    if (probe.status === "ok") {
      return `Stock providers connected: ${names}. A live ${probe.mediaType} search just now returned ${probe.candidates} candidate${probe.candidates === 1 ? "" : "s"}.`;
    }
    return `Stock providers connected: ${names}. The live ${probe.mediaType} probe failed: ${probe.message ?? probe.status}.`;
  })();

  if (load.phase === "loading") {
    return (
      <div className="glass mt-5 flex items-center gap-2 px-6 py-10 text-sm text-ink-dim">
        <Loader2 size={16} className="animate-spin" /> Loading this project&apos;s scenes…
      </div>
    );
  }

  if (load.phase === "error") {
    return (
      <div className="glass mt-5 px-6 py-8">
        <h2 className="font-display text-base font-semibold text-ink">The scenes could not be loaded</h2>
        <p className="mt-1.5 text-sm text-ink-dim">{load.message}</p>
        <p className="mt-1 text-xs text-ink-faint">
          Nothing is shown as sourced or unsourced, because the scene list could not be read.
        </p>
        <Button variant="outline" size="sm" className="mt-4" onClick={() => void loadProject()}>
          <RefreshCw size={14} /> Try again
        </Button>
      </div>
    );
  }

  const view = load.view;
  if (view.kind === "empty") {
    return (
      <div className="glass mt-5 px-6 py-10 text-center">
        <h2 className="font-display text-base font-semibold text-ink">{view.title}</h2>
        <p className="mx-auto mt-1.5 max-w-lg text-sm leading-relaxed text-ink-dim">{view.body}</p>
      </div>
    );
  }

  const storedCount = view.scenes.filter((s) => s.assets.some((a) => a.storedBytes)).length;

  return (
    <div className="mt-5 space-y-4">
      {/* ------------------------------------------------------- summary */}
      <div className="glass p-5" data-testid="scenes-summary">
        <div className="flex flex-wrap items-center gap-2">
          <Film size={15} className="text-accent" />
          <h2 className="font-display text-sm font-semibold text-ink">
            {view.sourced} of {view.total} scenes sourced
          </h2>
          <Badge tone={view.unsourced === 0 ? "ok" : "danger"}>
            {view.unsourced === 0 ? "all sourced" : `${view.unsourced} unsourced`}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => void loadProject()}
            data-testid="scenes-refresh"
          >
            <RefreshCw size={13} /> Re-read from the database
          </Button>
        </div>
        <p className="mt-2 text-sm leading-relaxed text-ink" data-testid="scenes-summary-sentence">
          {view.summary}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-ink-dim">
          {storedCount} of {view.sourced} attached clip{view.sourced === 1 ? "" : "s"} have their bytes in this
          business&apos;s object storage
          {storedCount < view.sourced
            ? " — the rest carry only the provider's address, which the encode stage refuses to fetch mid-render."
            : "."}
        </p>
        <p className="mt-2 flex items-start gap-1.5 text-xs leading-relaxed text-ink-faint" data-testid="scenes-source-label">
          <Sparkles size={12} className="mt-0.5 shrink-0" />
          <span>{SOURCE_LABEL}. The search is a keyword search over a stock library; no clip was made for, or matched to, the scene.</span>
        </p>
        <p className="mt-1.5 text-xs text-ink-dim" data-testid="scenes-provider-status">
          {statusLine}
        </p>
      </div>

      {/* -------------------------------------------------------- scenes */}
      {view.scenes.map((scene) => {
        const draft = drafts[scene.id] ?? draftFor(scene);
        const save = saves[scene.id] ?? { phase: "idle" };
        const search = searches[scene.id] ?? { phase: "idle" };
        const pick = picks[scene.id] ?? { phase: "idle" };
        const isOpen = open[scene.id] === true;
        return (
          <div key={scene.id} className="glass p-5" data-testid={`scene-${scene.number}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-panel-2 border border-line text-xs font-semibold text-ink">
                {scene.number}
              </span>
              <h3 className="font-display text-sm font-semibold text-ink">{scene.title || "Untitled scene"}</h3>
              <span className="text-xs text-ink-faint">{scene.chapterTitle}</span>
              <Badge tone={scene.sourced ? "ok" : "danger"} data-testid={`scene-${scene.number}-sourced`}>
                {scene.sourced ? "sourced" : "unsourced"}
              </Badge>
              <span className="text-xs text-ink-dim">{formatDuration(scene.durationSeconds)}</span>
            </div>

            {/* narration / duration / title */}
            <div className="mt-4 grid gap-3">
              <div>
                <Label htmlFor={`title-${scene.id}`}>Title</Label>
                <input
                  id={`title-${scene.id}`}
                  value={draft.title}
                  onChange={(e) => setDraft(scene.id, "title", e.target.value)}
                  className="h-10 w-full rounded-xl border border-line bg-panel-3/60 px-3.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent-line focus:ring-2 focus:ring-accent/20"
                  data-testid={`scene-${scene.number}-title`}
                />
              </div>
              <div>
                <Label htmlFor={`narration-${scene.id}`}>Narration</Label>
                <textarea
                  id={`narration-${scene.id}`}
                  value={draft.narration}
                  onChange={(e) => setDraft(scene.id, "narration", e.target.value)}
                  rows={3}
                  placeholder="No narration recorded for this scene — nothing is invented to fill it."
                  className="w-full rounded-xl border border-line bg-panel-3/60 px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent-line focus:ring-2 focus:ring-accent/20 resize-none"
                  data-testid={`scene-${scene.number}-narration`}
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[8rem_1fr]">
                <div>
                  <Label htmlFor={`duration-${scene.id}`}>Duration (s)</Label>
                  <input
                    id={`duration-${scene.id}`}
                    inputMode="numeric"
                    value={draft.durationSeconds}
                    onChange={(e) => setDraft(scene.id, "durationSeconds", e.target.value)}
                    className="h-10 w-full rounded-xl border border-line bg-panel-3/60 px-3.5 text-sm text-ink focus:outline-none focus:border-accent-line focus:ring-2 focus:ring-accent/20"
                    data-testid={`scene-${scene.number}-duration`}
                  />
                </div>
                <div>
                  <Label htmlFor={`prompt-${scene.id}`}>Visual prompt (what the stock search is built from)</Label>
                  <textarea
                    id={`prompt-${scene.id}`}
                    value={draft.visualPrompt}
                    onChange={(e) => setDraft(scene.id, "visualPrompt", e.target.value)}
                    rows={2}
                    placeholder="No visual prompt recorded — the search has nothing to build on."
                    className="w-full rounded-xl border border-line bg-panel-3/60 px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent-line focus:ring-2 focus:ring-accent/20 resize-none"
                    data-testid={`scene-${scene.number}-prompt`}
                  />
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => void saveScene(scene)}
                  disabled={save.phase === "saving"}
                  data-testid={`scene-${scene.number}-save`}
                >
                  {save.phase === "saving" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                  Save this scene
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setOpen((prev) => ({ ...prev, [scene.id]: !isOpen }))}
                  data-testid={`scene-${scene.number}-source-toggle`}
                >
                  <Search size={13} /> {isOpen ? "Hide stock search" : "Source a clip"}
                </Button>
                {save.phase === "saved" ? (
                  <span className="text-xs text-ok" data-testid={`scene-${scene.number}-save-state`}>
                    {save.note}
                  </span>
                ) : null}
                {save.phase === "error" ? (
                  <span className="text-xs text-danger" data-testid={`scene-${scene.number}-save-state`}>
                    Not saved: {save.message}
                  </span>
                ) : null}
              </div>
            </div>

            {/* ---------------------------------------------- attached asset */}
            <div className="mt-4 border-t border-line pt-3">
              <p className="text-xs uppercase tracking-wider text-ink-dim">Attached clip</p>
              {scene.assets.length === 0 ? (
                <p className="mt-1 text-sm text-ink-dim" data-testid={`scene-${scene.number}-asset`}>
                  No clip is attached to this scene, so the render cannot include it.
                </p>
              ) : (
                scene.assets.map((asset) => (
                  <div key={asset.id} className="mt-2 rounded-xl border border-line bg-panel-3/40 p-3" data-testid={`scene-${scene.number}-asset`}>
                    <p className="text-sm text-ink">
                      {asset.name} <span className="text-ink-faint">· {asset.kind.toLowerCase()}</span>
                    </p>
                    <p className="mt-0.5 text-xs text-ink-dim">
                      Provider: {asset.provider ?? "the record names none"}
                      {asset.externalId ? ` · id ${asset.externalId}` : ""}
                    </p>
                    <p className="text-xs text-ink-dim">Author: {asset.author ?? "the record names none"}</p>
                    <p className="text-xs text-ink-dim">
                      {licenceSentence(asset)}
                      {asset.licenseUrl ? (
                        <>
                          {" "}
                          <a href={asset.licenseUrl} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">
                            licence page
                          </a>
                        </>
                      ) : null}
                      {asset.pageUrl ? (
                        <>
                          {" · "}
                          <a href={asset.pageUrl} target="_blank" rel="noreferrer" className="text-accent underline-offset-2 hover:underline">
                            provider page
                          </a>
                        </>
                      ) : null}
                    </p>
                    <p className="text-xs text-ink-faint">
                      {asset.storedBytes
                        ? `Bytes in object storage${asset.sizeBytes === null ? "" : ` (${asset.sizeBytes.toLocaleString()} B)`}.`
                        : "Bytes are NOT in object storage — only the provider's address is recorded."}
                    </p>
                    <p className="mt-1 text-[11px] text-ink-faint">{SOURCE_LABEL}.</p>
                  </div>
                ))
              )}
            </div>

            {/* --------------------------------------------------- search */}
            {isOpen ? (
              <div className="mt-4 border-t border-line pt-3" data-testid={`scene-${scene.number}-search`}>
                <Label htmlFor={`query-${scene.id}`}>Search terms (pre-filled from this scene&apos;s visual prompt)</Label>
                <div className="flex flex-wrap gap-2">
                  <input
                    id={`query-${scene.id}`}
                    value={queries[scene.id] ?? ""}
                    onChange={(e) => setQueries((prev) => ({ ...prev, [scene.id]: e.target.value }))}
                    className="h-10 min-w-[12rem] flex-1 rounded-xl border border-line bg-panel-3/60 px-3.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent-line focus:ring-2 focus:ring-accent/20"
                    data-testid={`scene-${scene.number}-query`}
                  />
                  <Button
                    size="sm"
                    onClick={() => void searchScene(scene)}
                    disabled={search.phase === "loading"}
                    data-testid={`scene-${scene.number}-search-run`}
                  >
                    {search.phase === "loading" ? <Loader2 size={13} className="animate-spin" /> : <Search size={13} />}
                    Search stock video
                  </Button>
                </div>
                <p className="mt-1.5 text-[11px] text-ink-faint">
                  {((queries[scene.id] ?? "").trim() === (scene.visualPrompt ?? "").trim() && (scene.visualPrompt ?? "").trim()
                    ? "Searching this scene's saved visual prompt through the scene route."
                    : "Searching the words in the box, as typed.")}{" "}
                  Results are the provider&apos;s own; nothing is invented and no match score is shown.
                </p>

                {search.phase === "loading" ? (
                  <p className="mt-3 flex items-center gap-2 text-sm text-ink-dim">
                    <Loader2 size={14} className="animate-spin" /> Asking the stock provider…
                  </p>
                ) : null}

                {search.phase === "error" ? (
                  <p className="mt-3 text-sm text-danger" data-testid={`scene-${scene.number}-search-message`}>
                    The search did not run: {search.message}
                  </p>
                ) : null}

                {search.phase === "done" ? (
                  <div className="mt-3" data-testid={`scene-${scene.number}-results`}>
                    {search.outcome.kind === "ok" ? (
                      <>
                        <p className="text-xs text-ink-dim">
                          {search.outcome.candidates.length} candidate
                          {search.outcome.candidates.length === 1 ? "" : "s"} returned by the provider
                          {search.outcome.query ? ` for “${search.outcome.query}”` : ""}. Keyword matches, not illustrations.
                        </p>
                        <div className="mt-2 grid gap-2 sm:grid-cols-2">
                          {search.outcome.candidates.map((candidate) => {
                            const preview = candidatePreview(candidate);
                            const busy =
                              pick.phase === "selecting" || pick.phase === "ingesting"
                                ? pick.externalId === candidate.externalId
                                : false;
                            return (
                              <button
                                key={`${candidate.provider}:${candidate.externalId}`}
                                onClick={() => void chooseCandidate(scene, candidate)}
                                disabled={busy}
                                className="flex gap-3 rounded-xl border border-line bg-panel-3/40 p-2.5 text-left transition-colors hover:border-accent-line disabled:opacity-60"
                                data-testid={`scene-${scene.number}-candidate-${candidate.externalId}`}
                              >
                                {preview ? (
                                  // eslint-disable-next-line @next/next/no-img-element
                                  <img
                                    src={preview}
                                    alt=""
                                    className="h-16 w-24 shrink-0 rounded-lg object-cover"
                                    loading="lazy"
                                  />
                                ) : (
                                  <span className="flex h-16 w-24 shrink-0 items-center justify-center rounded-lg border border-line text-[10px] text-ink-faint">
                                    no preview from provider
                                  </span>
                                )}
                                <span className="min-w-0">
                                  <span className="block truncate text-xs font-medium text-ink">{candidate.title}</span>
                                  <span className="block text-[11px] text-ink-dim">
                                    {candidate.provider} · {candidate.author}
                                  </span>
                                  <span className="block text-[11px] text-ink-faint">
                                    {candidate.width}×{candidate.height}
                                    {candidate.durationSeconds ? ` · ${Math.round(candidate.durationSeconds)}s` : ""}
                                  </span>
                                  <span className="mt-0.5 block text-[11px] text-accent">
                                    {busy ? "Attaching…" : "Click to attach this clip"}
                                  </span>
                                </span>
                              </button>
                            );
                          })}
                        </div>
                      </>
                    ) : null}

                    {search.outcome.kind === "empty" ? (
                      <p className="text-sm text-ink-dim">{search.outcome.message}</p>
                    ) : null}

                    {search.outcome.kind === "not_connected" ? (
                      <p className="text-sm text-danger">{search.outcome.message}</p>
                    ) : null}

                    {search.outcome.kind === "provider_error" ? (
                      <p className="text-sm text-danger">
                        The stock provider refused this search, in its own words: {search.outcome.message}
                      </p>
                    ) : null}

                    {search.outcome.kind === "error" ? (
                      <p className="text-sm text-danger">{search.outcome.message}</p>
                    ) : null}

                    {"notes" in search.outcome && search.outcome.notes.length > 0 && search.outcome.kind !== "provider_error" ? (
                      <p className="mt-1.5 text-xs text-danger">
                        Provider note: {search.outcome.notes.join(" · ")}
                      </p>
                    ) : null}
                  </div>
                ) : null}

                {pick.phase === "selecting" || pick.phase === "ingesting" ? (
                  <p className="mt-2 flex items-center gap-2 text-sm text-ink-dim" data-testid={`scene-${scene.number}-pick-state`}>
                    <Loader2 size={14} className="animate-spin" />
                    {pick.phase === "selecting"
                      ? "Recording the selection on this scene…"
                      : "Storing the clip's bytes in object storage…"}
                  </p>
                ) : null}
                {pick.phase === "done" ? (
                  <p className="mt-2 text-sm text-ok" data-testid={`scene-${scene.number}-pick-state`}>
                    {pick.message}
                  </p>
                ) : null}
                {pick.phase === "error" ? (
                  <p className="mt-2 text-sm text-danger" data-testid={`scene-${scene.number}-pick-state`}>
                    The clip was not attached: {pick.message}
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
