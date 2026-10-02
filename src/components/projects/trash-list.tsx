"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Archive, ArrowLeft, Loader2, RotateCcw, Trash2 } from "lucide-react";
import type { ProjectSummary } from "@/lib/projects";
import { Button } from "@/components/ui";
import { EmptyState } from "@/components/empty-state";
import { Modal } from "@/components/projects/modal";
import { apiFetch } from "@/components/projects/client-api";

function dateLabel(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

export function TrashList({ projects }: { projects: ProjectSummary[] }) {
  const router = useRouter();
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<ProjectSummary | null>(null);
  const [purgeBusy, setPurgeBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRestore(project: ProjectSummary) {
    setRestoringId(project.id);
    setError(null);
    try {
      await apiFetch(`/api/projects/${project.id}/restore`, { method: "POST" });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not restore project.");
    } finally {
      setRestoringId(null);
    }
  }

  async function handlePurge() {
    if (!purgeTarget) return;
    setPurgeBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/projects/${purgeTarget.id}/permanent`, { method: "DELETE" });
      setPurgeTarget(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete project.");
      setPurgeBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <div className="flex items-center gap-3">
            <Link
              href="/projects"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-line text-ink-dim transition-colors hover:bg-panel-2 hover:text-ink"
              aria-label="Back to projects"
            >
              <ArrowLeft size={15} />
            </Link>
            <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">Trash</h1>
          </div>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-dim">
            Soft-deleted projects live here until you restore them or delete them forever.
          </p>
        </div>
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>
      ) : null}

      {projects.length === 0 ? (
        <EmptyState
          icon={Archive}
          title="Trash is empty"
          description="Projects you delete are soft-deleted and appear here. Restore them any time, or delete them permanently."
        />
      ) : (
        <div className="space-y-3">
          {projects.map((p) => (
            <div key={p.id} className="glass glass-hover flex flex-wrap items-center gap-4 p-4">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-panel-2 border border-line text-ink-dim">
                <Archive size={18} strokeWidth={1.75} />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-[15px] font-semibold text-ink">{p.title}</p>
                <p className="mt-0.5 text-xs text-ink-faint">
                  Deleted {dateLabel(p.deletedAt ?? p.updatedAt)}
                  {p.targetAspectRatio ? ` · ${p.targetAspectRatio.replace(/_/g, ":")}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={() => handleRestore(p)} disabled={restoringId === p.id}>
                  {restoringId === p.id ? <Loader2 size={14} className="animate-spin" /> : <RotateCcw size={14} />}
                  Restore
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => setPurgeTarget(p)}
                  disabled={restoringId === p.id}
                >
                  <Trash2 size={14} />
                  Delete forever
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal
        open={purgeTarget !== null}
        onClose={() => setPurgeTarget(null)}
        title="Delete forever?"
        description={`“${purgeTarget?.title ?? ""}” and all of its script, chapters and scenes will be permanently deleted. This cannot be undone.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setPurgeTarget(null)} disabled={purgeBusy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handlePurge} disabled={purgeBusy}>
              {purgeBusy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
              Delete forever
            </Button>
          </>
        }
      />
    </div>
  );
}
