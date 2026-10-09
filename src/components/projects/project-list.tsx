"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Archive,
  Clock,
  Copy,
  Film,
  FolderOpen,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from "lucide-react";
import type { ProjectSummary } from "@/lib/projects";
import { Button, Input, Label, Badge } from "@/components/ui";
import { EmptyState } from "@/components/empty-state";
import { Modal } from "@/components/projects/modal";
import { apiFetch } from "@/components/projects/client-api";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  PLANNING: "Planning",
  IN_PRODUCTION: "In production",
  COMPLETE: "Complete",
  ARCHIVED: "Archived",
};

function timeAgo(iso: string): string {
  const then = new Date(iso).getTime();
  const diffSec = Math.max(1, Math.round((Date.now() - then) / 1000));
  if (diffSec < 60) return "just now";
  const units: [number, string][] = [
    [60, "m"],
    [60, "h"],
    [24, "d"],
    [30, "mo"],
    [12, "y"],
  ];
  let value = diffSec;
  let unit = "s";
  for (const [div, label] of units) {
    value = Math.round(value / div);
    if (value < 1) break;
    unit = label;
  }
  return `${value}${unit} ago`;
}

function initials(title: string): string {
  const parts = title.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "CV";
  const first = parts[0][0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1][0] : "";
  return (first + last).toUpperCase().slice(0, 2);
}

/** Deterministic gradient for the thumbnail placeholder (stable per project). */
function gradientFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  const palettes = [
    "from-[#1a1626] via-[#241d30] to-[#3a2a1c]",
    "from-[#101a26] via-[#16243a] to-[#2c1f3d]",
    "from-[#1c1c16] via-[#26220f] to-[#3d2f10]",
    "from-[#141a18] via-[#182623] to-[#1f2e3a]",
    "from-[#1e1218] via-[#2a1622] to-[#3d1a26]",
  ];
  return palettes[h % palettes.length];
}

function ProjectCard({
  project,
  onRename,
  onDuplicate,
  onDelete,
  busy,
}: {
  project: ProjectSummary;
  onRename: (p: ProjectSummary) => void;
  onDuplicate: (p: ProjectSummary) => void;
  onDelete: (p: ProjectSummary) => void;
  busy: boolean;
}) {
  const { id, title, updatedAt, status, targetAspectRatio, targetDurationSeconds } = project;
  const metaBits: string[] = [];
  if (targetAspectRatio) metaBits.push(targetAspectRatio.replace(/_/g, ":"));
  if (targetDurationSeconds) metaBits.push(`${Math.round(targetDurationSeconds / 60)} min`);

  return (
    <div className="glass glass-hover group flex flex-col overflow-hidden">
      <Link
        href={`/projects/${id}`}
        className={`relative block aspect-video overflow-hidden bg-gradient-to-br ${gradientFor(id)}`}
      >
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
          <span className="font-display text-3xl font-semibold tracking-tight text-ink/25 transition-colors duration-200 group-hover:text-ink/40">
            {initials(title)}
          </span>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/30 text-ink/40 border border-white/5">
            <Film size={14} strokeWidth={1.75} />
          </span>
        </div>
        <div className="absolute right-2.5 top-2.5">
          <Badge tone={status === "DRAFT" ? "neutral" : status === "ARCHIVED" ? "neutral" : "accent"}>
            {STATUS_LABELS[status] ?? status}
          </Badge>
        </div>
      </Link>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div>
          <Link
            href={`/projects/${id}`}
            className="line-clamp-1 font-display text-[15px] font-semibold text-ink transition-colors hover:text-accent"
            title={title}
          >
            {title}
          </Link>
          <p className="mt-1 flex items-center gap-1.5 text-xs text-ink-faint">
            <Clock size={11} /> Updated {timeAgo(updatedAt)}
            {metaBits.length ? <span className="text-ink-faint/70">· {metaBits.join(" · ")}</span> : null}
          </p>
        </div>

        <div className="mt-auto flex items-center gap-1.5">
          <Link
            href={`/projects/${id}`}
            className="inline-flex h-8 flex-1 items-center justify-center gap-2 rounded-xl bg-accent px-3 text-xs font-medium text-[#171208] transition-colors hover:bg-accent-strong"
          >
            Open
          </Link>
          <Button size="sm" variant="ghost" onClick={() => onRename(project)} title="Rename" aria-label="Rename">
            <Pencil size={14} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onDuplicate(project)}
            title="Duplicate"
            aria-label="Duplicate"
            disabled={busy}
          >
            <Copy size={14} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onDelete(project)}
            title="Move to trash"
            aria-label="Move to trash"
            className="hover:text-danger"
          >
            <Trash2 size={14} />
          </Button>
        </div>
      </div>
    </div>
  );
}

export function ProjectList({ projects, trashCount }: { projects: ProjectSummary[]; trashCount: number }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [createBusy, setCreateBusy] = useState(false);
  const [renameTarget, setRenameTarget] = useState<ProjectSummary | null>(null);
  const [renameTitle, setRenameTitle] = useState("");
  const [renameBusy, setRenameBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProjectSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const sorted = useMemo(
    () => [...projects].sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1)),
    [projects],
  );

  async function handleCreate() {
    setCreateBusy(true);
    setError(null);
    try {
      const { project } = await apiFetch<{ project: { id: string } }>("/api/projects", {
        method: "POST",
        body: JSON.stringify({ title: newTitle }),
      });
      router.push(`/projects/${project.id}`);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create project.");
      setCreateBusy(false);
    }
  }

  async function handleRename() {
    if (!renameTarget) return;
    setRenameBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/projects/${renameTarget.id}`, {
        method: "PATCH",
        body: JSON.stringify({ project: { title: renameTitle } }),
      });
      setRenameTarget(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rename project.");
      setRenameBusy(false);
    }
  }

  async function handleDuplicate(project: ProjectSummary) {
    setDuplicatingId(project.id);
    setError(null);
    try {
      await apiFetch(`/api/projects/${project.id}/duplicate`, { method: "POST" });
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not duplicate project.");
    } finally {
      setDuplicatingId(null);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    setError(null);
    try {
      await apiFetch(`/api/projects/${deleteTarget.id}`, { method: "DELETE" });
      setDeleteTarget(null);
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete project.");
      setDeleteBusy(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold tracking-tight text-ink">My Projects</h1>
          <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-dim">
            Every video you create, from first idea to final export. Trash holds soft-deleted projects.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/projects/trash"
            className="inline-flex h-10 items-center gap-2 rounded-xl border border-line bg-transparent px-4 text-sm text-ink-dim transition-colors hover:bg-panel-2 hover:border-line hover:text-ink"
          >
            <Archive size={15} />
            Trash{trashCount > 0 ? ` (${trashCount})` : ""}
          </Link>
          <Button onClick={() => setCreating(true)}>
            <Plus size={15} /> New project
          </Button>
        </div>
      </div>

      {error ? (
        <p className="mb-4 rounded-xl border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</p>
      ) : null}

      {sorted.length === 0 ? (
        <EmptyState
          icon={FolderOpen}
          title="No projects yet"
          description="Create your first project to open the workspace — title, auto-saved settings and version history are ready. The 8-step Create Video wizard also builds one from a single idea, scene structure and all."
          note="Live data from your account"
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {sorted.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              onRename={setRenameTarget}
              onDuplicate={handleDuplicate}
              onDelete={setDeleteTarget}
              busy={duplicatingId === p.id}
            />
          ))}
        </div>
      )}

      {/* Create */}
      <Modal
        open={creating}
        onClose={() => setCreating(false)}
        title="New project"
        description="A project holds the script, storyboard, scenes and everything that becomes a video."
        footer={
          <>
            <Button variant="ghost" onClick={() => setCreating(false)} disabled={createBusy}>
              Cancel
            </Button>
            <Button onClick={handleCreate} disabled={createBusy}>
              {createBusy ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              Create project
            </Button>
          </>
        }
      >
        <Label htmlFor="new-title">Title</Label>
        <Input
          id="new-title"
          value={newTitle}
          onChange={(e) => setNewTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleCreate()}
          placeholder="Untitled Video"
          autoFocus
        />
      </Modal>

      {/* Rename */}
      <Modal
        open={renameTarget !== null}
        onClose={() => setRenameTarget(null)}
        title="Rename project"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRenameTarget(null)} disabled={renameBusy}>
              Cancel
            </Button>
            <Button onClick={handleRename} disabled={renameBusy || !renameTitle.trim()}>
              {renameBusy ? <Loader2 size={15} className="animate-spin" /> : null}
              Save
            </Button>
          </>
        }
      >
        <Label htmlFor="rename-title">Title</Label>
        <Input
          id="rename-title"
          value={renameTitle}
          onChange={(e) => setRenameTitle(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleRename()}
          autoFocus
        />
      </Modal>

      {/* Delete (soft) */}
      <Modal
        open={deleteTarget !== null}
        onClose={() => setDeleteTarget(null)}
        title="Move to trash?"
        description={`“${deleteTarget?.title ?? ""}” will be moved to the trash. You can restore it from /projects/trash any time — nothing is lost.`}
        footer={
          <>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleDelete} disabled={deleteBusy}>
              {deleteBusy ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
              Move to trash
            </Button>
          </>
        }
      />
    </div>
  );
}
