"use client";

/**
 * Workspace Thumbnail tab — the brief the product would use, and the plain
 * statement that no thumbnail image exists.
 * Phase 8 Audio/Subtitle/Thumbnail block, Block B.
 *
 * Every value arrives in the payload from `GET /api/projects/:id/thumbnail`,
 * which derives it on the server from this project's own Project, Script and
 * Scene rows, and from the AI status module's capability facts. The component
 * lays it out and derives nothing.
 *
 * There is deliberately NO preview box and NO "Generate thumbnail" control: no
 * image provider is configured, so a picture cannot be produced, and a
 * placeholder that looked like a generated thumbnail would be a lie.
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Image as ImageIcon, Loader2, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui";
import { apiFetch } from "@/components/projects/client-api";
import type { ThumbnailView } from "@/lib/studio/thumbnail-view";

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; view: ThumbnailView };

export function ThumbnailTab({ projectId }: { projectId: string }) {
  const [load, setLoad] = useState<LoadState>({ phase: "loading" });

  const read = useCallback(async () => {
    setLoad((prev) => (prev.phase === "ready" ? prev : { phase: "loading" }));
    try {
      const view = await apiFetch<ThumbnailView>(`/api/projects/${projectId}/thumbnail`);
      setLoad({ phase: "ready", view });
    } catch (e) {
      setLoad({ phase: "error", message: e instanceof Error ? e.message : "Could not read the thumbnail brief for this project." });
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
          <p className="text-[13px] leading-relaxed text-ink" data-testid="no-thumbnail-image">
            {view?.image.sentence ??
              "No thumbnail image exists anywhere in this product: no image provider is configured on this deployment, so none can be produced and none is shown."}
          </p>
        </div>
      </div>

      <div className="glass p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <ImageIcon size={15} className="text-accent" />
              <h2 className="font-display text-sm font-semibold text-ink">The thumbnail brief</h2>
            </div>
            <p className="mt-1 text-xs text-ink-dim">
              What the product would ask an image model for, read from this project&apos;s own rows — with the row and
              field every piece came from.
            </p>
          </div>
          <button
            onClick={() => void read()}
            disabled={load.phase === "loading"}
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium text-ink-dim transition-colors hover:bg-panel-2 hover:text-ink disabled:opacity-60 cursor-pointer"
            data-testid="thumbnail-reread"
          >
            {load.phase === "loading" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            Re-read
          </button>
        </div>

        {load.phase === "loading" ? (
          <p className="mt-5 flex items-center gap-2 text-sm text-ink-dim">
            <Loader2 size={14} className="animate-spin" /> Reading the brief from this project&apos;s rows…
          </p>
        ) : load.phase === "error" ? (
          <p className="mt-5 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-sm text-danger">{load.message}</p>
        ) : view ? (
          <>
            <p className="mt-4 text-xs leading-relaxed text-ink-dim" data-testid="brief-sentence">
              {view.brief.sentence}
            </p>

            <div className="mt-4 space-y-2">
              <div className="rounded-xl border border-line bg-panel-2/40 px-3 py-2.5">
                <div className="text-[11px] uppercase tracking-wide text-ink-faint">Title</div>
                <div className="mt-0.5 text-[13px] font-medium text-ink" data-testid="brief-title">
                  {view.brief.title.value}
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-ink-faint">from {view.brief.title.source}</p>
              </div>

              <div className="rounded-xl border border-line bg-panel-2/40 px-3 py-2.5">
                <div className="text-[11px] uppercase tracking-wide text-ink-faint">Key text on the thumbnail</div>
                {view.brief.keyText ? (
                  <>
                    <div className="mt-0.5 text-[13px] font-medium text-ink" data-testid="brief-key-text">
                      {view.brief.keyText.value}
                    </div>
                    <p className="mt-0.5 font-mono text-[11px] text-ink-faint">from {view.brief.keyText.source}</p>
                  </>
                ) : (
                  <p className="mt-0.5 text-xs leading-relaxed text-ink-dim">{view.brief.keyTextMissingReason}</p>
                )}
              </div>

              <div className="rounded-xl border border-line bg-panel-2/40 px-3 py-2.5">
                <div className="text-[11px] uppercase tracking-wide text-ink-faint">Target frame</div>
                <div className="mt-0.5 text-[13px] font-medium text-ink" data-testid="brief-frame">
                  {view.brief.frame.value}
                </div>
                <p className="mt-0.5 font-mono text-[11px] text-ink-faint">from {view.brief.frame.source}</p>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-xl border border-line bg-panel-2/40 px-3 py-2.5">
                  <div className="text-[11px] uppercase tracking-wide text-ink-faint">Scenes</div>
                  <div className="font-display text-lg font-semibold text-ink">{view.brief.sceneCount}</div>
                </div>
                <div className="rounded-xl border border-line bg-panel-2/40 px-3 py-2.5">
                  <div className="text-[11px] uppercase tracking-wide text-ink-faint">With narration</div>
                  <div className="font-display text-lg font-semibold text-ink">{view.brief.scenesWithNarration}</div>
                </div>
                <div className="rounded-xl border border-line bg-panel-2/40 px-3 py-2.5">
                  <div className="text-[11px] uppercase tracking-wide text-ink-faint">Thumbnail rows</div>
                  <div className="font-display text-lg font-semibold text-ink" data-testid="thumbnail-rows">
                    {view.thumbnailRows}
                  </div>
                </div>
                <div className="rounded-xl border border-line bg-panel-2/40 px-3 py-2.5">
                  <div className="text-[11px] uppercase tracking-wide text-ink-faint">THUMBNAIL assets</div>
                  <div className="font-display text-lg font-semibold text-ink">{view.thumbnailAssets}</div>
                </div>
              </div>
            </div>

            {/* -------------------------------------- provider facts */}
            <div className="mt-4 rounded-xl border border-line bg-panel-2/40 px-3 py-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] uppercase tracking-wide text-ink-faint">Capability</span>
                <code className="rounded-md border border-line bg-panel-3/60 px-1.5 py-0.5 font-mono text-[11px] text-ink">
                  {view.provider.capability}
                </code>
                <Badge tone={view.provider.connected ? "accent" : "neutral"}>{view.provider.status.replace(/_/g, " ")}</Badge>
              </div>
              <div className="mt-2 text-[11px] uppercase tracking-wide text-ink-faint">
                Env var that would enable it
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

            <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">{view.note}</p>
          </>
        ) : null}
      </div>
    </div>
  );
}
