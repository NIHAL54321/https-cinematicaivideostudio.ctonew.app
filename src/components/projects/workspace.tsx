"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Captions,
  Check,
  ChevronDown,
  Clapperboard,
  Film,
  History,
  Image as ImageIcon,
  LayoutGrid,
  Loader2,
  Mic,
  Music,
  Pencil,
  RotateCcw,
  Save,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import { ASPECT_RATIOS } from "@/lib/constants";
import type { ProjectDetail, VersionSummary } from "@/lib/projects";
import { Badge, Button, Input, Label } from "@/components/ui";
import { Modal } from "@/components/projects/modal";
import { ScriptTab } from "@/components/projects/script-tab";
import { StoryboardTab } from "@/components/projects/storyboard-tab";
import { apiFetch } from "@/components/projects/client-api";

const STATUS_OPTIONS = [
  { value: "DRAFT", label: "Draft" },
  { value: "PLANNING", label: "Planning" },
  { value: "IN_PRODUCTION", label: "In production" },
  { value: "COMPLETE", label: "Complete" },
  { value: "ARCHIVED", label: "Archived" },
] as const;

const TABS = [
  { id: "script", label: "Script", icon: Clapperboard, blurb: "Logline, chapters and scene narration live here." },
  { id: "storyboard", label: "Storyboard", icon: LayoutGrid, blurb: "Per-scene visuals, camera, narration and shot planning live here." },
  { id: "scenes", label: "Scenes", icon: Film, blurb: "Per-scene visuals, narration, voices and assets are managed here." },
  // Each blurb states what THIS tab does in this build and, where the work exists
  // elsewhere in the app, which page owns it. None of them promises a future
  // milestone: a plan this team cannot back is not a claim a user should read.
  { id: "voice", label: "Voice & Audio", icon: Mic, blurb: "This tab carries no panel in this build — voice, music and sound design are produced on the Voice Studio, Music Studio and Sound Effects pages." },
  { id: "subtitles", label: "Subtitles", icon: Captions, blurb: "This tab carries no panel in this build — captions are generated, styled and positioned on the Subtitle Studio page." },
  { id: "thumbnail", label: "Thumbnail", icon: ImageIcon, blurb: "This tab carries no panel in this build — thumbnail generation runs on the Thumbnail Generator page, which reports its own provider status." },
  { id: "export", label: "Export", icon: UploadCloud, blurb: "This tab carries no panel in this build — render and export jobs are queued on the Export Center page." },
] as const;

type SaveState = "saved" | "saving" | "dirty";

function aspectLabel(value: string | null): string | null {
  if (!value) return null;
  return ASPECT_RATIOS.find((a) => a.id === value)?.label ?? value.replace(/_/g, ":");
}

function formatMinutes(seconds: number | null): string | null {
  if (seconds === null || seconds === undefined) return null;
  return `${Math.round(seconds / 60)} min`;
}

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

export function ProjectWorkspace({
  project: initial,
  initialVersions,
}: {
  project: ProjectDetail;
  initialVersions: VersionSummary[];
}) {
  const router = useRouter();
  const id = initial.id;

  const [project, setProject] = useState<ProjectDetail>(initial);
  const [title, setTitle] = useState(initial.title);
  const [description, setDescription] = useState(initial.description ?? "");
  const [status, setStatus] = useState(initial.status);
  const [aspect, setAspect] = useState(initial.targetAspectRatio ?? "SIXTEEN_NINE");
  const [durationMin, setDurationMin] = useState<string>(
    initial.targetDurationSeconds ? String(Math.round(initial.targetDurationSeconds / 60)) : "",
  );
  const [language, setLanguage] = useState(initial.settings?.language ?? "en");

  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [saveError, setSaveError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<string>("script");
  const [versions, setVersions] = useState<VersionSummary[]>(initialVersions);
  const [versionsOpen, setVersionsOpen] = useState(true);
  const [expandedVersion, setExpandedVersion] = useState<string | null>(null);
  const [versionDetail, setVersionDetail] = useState<{ note: string | null; snapshot: unknown; createdAt: string } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [snapshotBusy, setSnapshotBusy] = useState(false);
  const [snapshotNote, setSnapshotNote] = useState("");
  const [snapshotModal, setSnapshotModal] = useState(false);
  const [restoreTarget, setRestoreTarget] = useState<VersionSummary | null>(null);
  const [restoreBusy, setRestoreBusy] = useState(false);

  const pending = useRef<{ project: Record<string, unknown>; settings: Record<string, unknown> }>({
    project: {},
    settings: {},
  });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ------------------------------------------------------------------
  // Auto-save plumbing
  // ------------------------------------------------------------------

  const flush = useCallback(async () => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    const payload = pending.current;
    if (!Object.keys(payload.project).length && !Object.keys(payload.settings).length) {
      setSaveState("saved");
      return;
    }
    pending.current = { project: {}, settings: {} };
    setSaveState("saving");
    setSaveError(null);
    try {
      const res = await apiFetch<{ project: ProjectDetail }>(`/api/projects/${id}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
      setProject(res.project);
      setSaveState("saved");
    } catch (e) {
      pending.current = {
        project: { ...payload.project, ...pending.current.project },
        settings: { ...payload.settings, ...pending.current.settings },
      };
      setSaveState("dirty");
      setSaveError(e instanceof Error ? e.message : "Could not save changes.");
    }
  }, [id]);

  const scheduleSave = useCallback(() => {
    setSaveState("dirty");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      void flush();
    }, 700);
  }, [flush]);

  /** Persist immediately (blur / explicit actions). */
  const flushNow = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    void flush();
  }, [flush]);

  // Guarantee zero lost work on refresh/navigation: flush pending with
  // keepalive in beforeunload (covers edits still inside the debounce window).
  useEffect(() => {
    const onUnload = () => {
      const payload = pending.current;
      if (Object.keys(payload.project).length || Object.keys(payload.settings).length) {
        fetch(`/api/projects/${id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          keepalive: true,
        });
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [id]);

  const markDirty = useCallback(
    (section: "project" | "settings", key: string, value: unknown) => {
      pending.current[section][key] = value;
      scheduleSave();
    },
    [scheduleSave],
  );

  function handleTitleChange(v: string) {
    setTitle(v);
    markDirty("project", "title", v);
  }

  function handleDescriptionChange(v: string) {
    setDescription(v);
    markDirty("project", "description", v || null);
  }

  function handleStatusChange(v: string) {
    setStatus(v);
    markDirty("project", "status", v);
  }

  function handleAspectChange(v: string) {
    setAspect(v);
    markDirty("project", "targetAspectRatio", v);
  }

  function handleDurationChange(v: string) {
    setDurationMin(v);
    if (v.trim() === "") markDirty("project", "targetDurationSeconds", null);
    else {
      const n = Math.max(0, Math.min(120, Number(v)));
      if (Number.isFinite(n)) markDirty("project", "targetDurationSeconds", Math.round(n * 60));
    }
  }

  function handleLanguageChange(v: string) {
    setLanguage(v);
    markDirty("settings", "language", v || null);
  }

  // ------------------------------------------------------------------
  // Version history
  // ------------------------------------------------------------------

  async function loadVersions() {
    try {
      const res = await apiFetch<{ versions: VersionSummary[] }>(`/api/projects/${id}/versions`);
      setVersions(res.versions);
    } catch {
      // keep the current list; the server page will refresh on navigation
    }
  }

  async function handleCreateSnapshot() {
    setSnapshotBusy(true);
    setSaveError(null);
    try {
      await apiFetch(`/api/projects/${id}/versions`, {
        method: "POST",
        body: JSON.stringify({ note: snapshotNote }),
      });
      setSnapshotNote("");
      setSnapshotModal(false);
      await loadVersions();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not save a snapshot.");
    } finally {
      setSnapshotBusy(false);
    }
  }

  async function handleExpandVersion(v: VersionSummary) {
    if (expandedVersion === v.id) {
      setExpandedVersion(null);
      setVersionDetail(null);
      return;
    }
    setExpandedVersion(v.id);
    setDetailLoading(true);
    setVersionDetail(null);
    try {
      const res = await apiFetch<{ version: { note: string | null; snapshot: unknown; createdAt: string } }>(
        `/api/projects/${id}/versions/${v.id}`,
      );
      setVersionDetail(res.version);
    } catch {
      setVersionDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }

  async function handleRestore() {
    if (!restoreTarget) return;
    setRestoreBusy(true);
    setSaveError(null);
    try {
      const res = await apiFetch<{ project: ProjectDetail }>(
        `/api/projects/${id}/versions/${restoreTarget.id}/restore`,
        { method: "POST" },
      );
      setProject(res.project);
      setTitle(res.project.title);
      setDescription(res.project.description ?? "");
      setStatus(res.project.status);
      setAspect(res.project.targetAspectRatio ?? "SIXTEEN_NINE");
      setDurationMin(
        res.project.targetDurationSeconds ? String(Math.round(res.project.targetDurationSeconds / 60)) : "",
      );
      setLanguage(res.project.settings?.language ?? "en");
      pending.current = { project: {}, settings: {} };
      setSaveState("saved");
      setRestoreTarget(null);
      setExpandedVersion(null);
      setVersionDetail(null);
      await loadVersions();
      router.refresh();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : "Could not restore version.");
    } finally {
      setRestoreBusy(false);
    }
  }

  const meta = [aspectLabel(project.targetAspectRatio), formatMinutes(project.targetDurationSeconds)].filter(
    (m): m is string => Boolean(m),
  );

  return (
    <div>
      {/* ---------------------------------------------------------- header */}
      <div className="mb-6">
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href="/projects"
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-line text-ink-dim transition-colors hover:bg-panel-2 hover:text-ink"
            aria-label="Back to projects"
          >
            <ArrowLeft size={16} />
          </Link>
          <div className="group relative min-w-0 flex-1">
            <input
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              onBlur={flushNow}
              aria-label="Project title"
              className="w-full rounded-lg border border-transparent bg-transparent px-2 py-1 font-display text-2xl font-semibold tracking-tight text-ink transition-colors hover:border-line focus:border-accent-line focus:outline-none focus:ring-2 focus:ring-accent/20"
            />
            <Pencil
              size={14}
              className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-ink-faint opacity-0 transition-opacity group-hover:opacity-100"
            />
          </div>
          <div className="flex items-center gap-2">
            <Link
              href={`/projects/${initial.id}/editor`}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-medium text-ink-dim transition-colors hover:bg-panel-2 hover:text-ink"
            >
              <Clapperboard size={14} /> Open Editor
            </Link>
            {saveState === "saved" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-ok/25 bg-ok/10 px-2.5 py-1 text-[11px] font-medium text-ok">
                <Check size={11} /> Saved
              </span>
            ) : saveState === "saving" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel-2 px-2.5 py-1 text-[11px] font-medium text-ink-dim">
                <Loader2 size={11} className="animate-spin" /> Saving…
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-accent-line bg-accent-soft px-2.5 py-1 text-[11px] font-medium text-accent">
                <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Unsaved changes
              </span>
            )}
          </div>
        </div>

        {saveError ? (
          <p className="mt-2 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">
            {saveError}
          </p>
        ) : null}

        <div className="mt-2 flex flex-wrap items-center gap-2 pl-11">
          <Badge tone={status === "DRAFT" ? "neutral" : "accent"}>
            {STATUS_OPTIONS.find((s) => s.value === status)?.label ?? status}
          </Badge>
          {meta.map((m) => (
            <Badge key={m} tone="neutral">
              {m}
            </Badge>
          ))}
          <span className="text-xs text-ink-faint">
            {project.scriptCounts.chapters} chapter{project.scriptCounts.chapters === 1 ? "" : "s"} ·{" "}
            {project.scriptCounts.scenes} scene{project.scriptCounts.scenes === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1fr_340px]">
        {/* ------------------------------------------------- main tabs */}
        <div>
          <div className="flex flex-wrap gap-1.5 border-b border-line-soft pb-px">
            {TABS.map((tab) => {
              const active = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={[
                    "inline-flex items-center gap-2 rounded-t-lg border-b-2 px-3 py-2.5 text-[13px] font-medium transition-colors cursor-pointer",
                    active
                      ? "border-accent text-accent bg-accent-soft/40"
                      : "border-transparent text-ink-dim hover:text-ink hover:bg-panel-2",
                  ].join(" ")}
                >
                  <tab.icon size={14} strokeWidth={1.75} />
                  {tab.label}
                </button>
              );
            })}
          </div>

          {activeTab === "script" ? (
            <ScriptTab projectId={id} />
          ) : activeTab === "storyboard" ? (
            <StoryboardTab projectId={id} />
          ) : (
            <div className="glass mt-5 flex flex-col items-center gap-3 px-6 py-14 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-panel-2 border border-line text-ink-dim">
                {(() => {
                  const tab = TABS.find((t) => t.id === activeTab) ?? TABS[0];
                  return <tab.icon size={20} strokeWidth={1.75} />;
                })()}
              </span>
              <div>
                <h2 className="font-display text-base font-semibold text-ink">
                  {TABS.find((t) => t.id === activeTab)?.label} — no panel on this tab in this build
                </h2>
                <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-ink-dim">
                  {TABS.find((t) => t.id === activeTab)?.blurb}
                </p>
              </div>
            </div>
          )}
        </div>

        {/* ------------------------------------------------------- sidebar */}
        <div className="space-y-4">
          {/* Project details (auto-saved) */}
          <div className="glass p-5">
            <div className="mb-4 flex items-center gap-2">
              <Sparkles size={14} className="text-accent" />
              <h2 className="font-display text-sm font-semibold text-ink">Project details</h2>
              <span className="ml-auto text-[11px] text-ink-faint">auto-saved</span>
            </div>
            <div className="space-y-3.5">
              <div>
                <Label htmlFor="proj-description">Description</Label>
                <textarea
                  id="proj-description"
                  value={description}
                  onChange={(e) => handleDescriptionChange(e.target.value)}
                  onBlur={flushNow}
                  rows={3}
                  placeholder="What is this video about?"
                  className="w-full rounded-xl border border-line bg-panel-3/60 px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent-line focus:ring-2 focus:ring-accent/20 transition-colors resize-none"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="proj-format">Format</Label>
                  <select
                    id="proj-format"
                    value={aspect}
                    onChange={(e) => handleAspectChange(e.target.value)}
                    className="h-10 w-full rounded-xl border border-line bg-panel-3/60 px-3 text-sm text-ink focus:outline-none focus:border-accent-line focus:ring-2 focus:ring-accent/20 transition-colors cursor-pointer"
                  >
                    {ASPECT_RATIOS.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.label} — {a.description}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="proj-duration">Target length (min)</Label>
                  <Input
                    id="proj-duration"
                    type="number"
                    min={1}
                    max={120}
                    value={durationMin}
                    onChange={(e) => handleDurationChange(e.target.value)}
                    onBlur={flushNow}
                    placeholder="e.g. 12"
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="proj-status">Status</Label>
                  <select
                    id="proj-status"
                    value={status}
                    onChange={(e) => handleStatusChange(e.target.value)}
                    className="h-10 w-full rounded-xl border border-line bg-panel-3/60 px-3 text-sm text-ink focus:outline-none focus:border-accent-line focus:ring-2 focus:ring-accent/20 transition-colors cursor-pointer"
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="proj-language">Language</Label>
                  <Input
                    id="proj-language"
                    value={language}
                    onChange={(e) => handleLanguageChange(e.target.value)}
                    onBlur={flushNow}
                    placeholder="en"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Version history */}
          <div className="glass p-5">
            <div className="mb-3 flex items-center gap-2">
              <History size={14} className="text-accent" />
              <h2 className="font-display text-sm font-semibold text-ink">Version history</h2>
              <span className="ml-auto text-[11px] text-ink-faint">{versions.length}</span>
              <button
                onClick={() => setVersionsOpen((o) => !o)}
                className="rounded-md p-1 text-ink-faint hover:bg-panel-2 hover:text-ink cursor-pointer"
                aria-label="Toggle version history"
              >
                <ChevronDown size={14} className={`transition-transform ${versionsOpen ? "" : "-rotate-90"}`} />
              </button>
            </div>

            {versionsOpen ? (
              <>
                <Button size="sm" variant="outline" className="mb-3 w-full" onClick={() => setSnapshotModal(true)}>
                  <Save size={13} /> Save snapshot now
                </Button>
                <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {versions.length === 0 ? (
                    <p className="text-xs text-ink-faint">No snapshots yet — rename or edit to create one.</p>
                  ) : (
                    versions.map((v) => {
                      const expanded = expandedVersion === v.id;
                      return (
                        <div key={v.id} className="rounded-xl border border-line bg-panel-2/40">
                          <button
                            onClick={() => void handleExpandVersion(v)}
                            className="flex w-full items-center gap-3 px-3 py-2.5 text-left cursor-pointer"
                          >
                            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-[11px] font-bold text-accent">
                              v{v.versionNumber}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-[13px] font-medium text-ink">
                                {v.note ?? `Snapshot #${v.versionNumber}`}
                              </span>
                              <span className="block text-[11px] text-ink-faint">
                                {dateLabel(v.createdAt)}
                                {v.createdBy ? ` · ${v.createdBy.name ?? v.createdBy.email}` : ""}
                              </span>
                            </span>
                            <ChevronDown
                              size={13}
                              className={`shrink-0 text-ink-faint transition-transform ${expanded ? "" : "-rotate-90"}`}
                            />
                          </button>
                          {expanded ? (
                            <div className="border-t border-line px-3 py-3">
                              {detailLoading ? (
                                <p className="flex items-center gap-2 text-xs text-ink-faint">
                                  <Loader2 size={12} className="animate-spin" /> Loading…
                                </p>
                              ) : versionDetail ? (
                                <>
                                  <dl className="space-y-1.5 text-xs">
                                    <div className="flex gap-2">
                                      <dt className="w-24 shrink-0 text-ink-faint">Snapshot of</dt>
                                      <dd className="text-ink">{v.snapshotTitle ?? "—"}</dd>
                                    </div>
                                    <div className="flex gap-2">
                                      <dt className="w-24 shrink-0 text-ink-faint">Structure</dt>
                                      <dd className="text-ink">
                                        {v.snapshotCounts.chapters} chapter{v.snapshotCounts.chapters === 1 ? "" : "s"},{" "}
                                        {v.snapshotCounts.scenes} scene{v.snapshotCounts.scenes === 1 ? "" : "s"}
                                      </dd>
                                    </div>
                                    <div className="flex gap-2">
                                      <dt className="w-24 shrink-0 text-ink-faint">Recorded</dt>
                                      <dd className="text-ink">{dateLabel(v.createdAt)}</dd>
                                    </div>
                                  </dl>
                                  <details className="mt-2.5">
                                    <summary className="cursor-pointer text-[11px] font-medium text-ink-dim hover:text-ink">
                                      Show full snapshot JSON
                                    </summary>
                                    <pre className="mt-2 max-h-40 overflow-auto rounded-lg bg-void p-2.5 text-[10px] leading-relaxed text-ink-dim">
                                      {JSON.stringify(versionDetail.snapshot, null, 2)}
                                    </pre>
                                  </details>
                                  <Button
                                    size="sm"
                                    variant="outline"
                                    className="mt-3 w-full"
                                    onClick={() => setRestoreTarget(v)}
                                  >
                                    <RotateCcw size={13} /> Restore this version
                                  </Button>
                                </>
                              ) : (
                                <p className="text-xs text-ink-faint">Could not load this version.</p>
                              )}
                            </div>
                          ) : null}
                        </div>
                      );
                    })
                  )}
                </div>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {/* Snapshot modal */}
      <Modal
        open={snapshotModal}
        onClose={() => setSnapshotModal(false)}
        title="Save a snapshot"
        description="Captures the current title, settings and script structure as a version you can restore later."
        footer={
          <>
            <Button variant="ghost" onClick={() => setSnapshotModal(false)} disabled={snapshotBusy}>
              Cancel
            </Button>
            <Button onClick={handleCreateSnapshot} disabled={snapshotBusy}>
              {snapshotBusy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
              Save snapshot
            </Button>
          </>
        }
      >
        <Label htmlFor="snapshot-note">Note (optional)</Label>
        <Input
          id="snapshot-note"
          value={snapshotNote}
          onChange={(e) => setSnapshotNote(e.target.value)}
          placeholder="e.g. Ready to record voiceover"
          onKeyDown={(e) => e.key === "Enter" && handleCreateSnapshot()}
          autoFocus
        />
      </Modal>

      {/* Restore confirm */}
      <Modal
        open={restoreTarget !== null}
        onClose={() => setRestoreTarget(null)}
        title="Restore this version?"
        description={
          restoreTarget
            ? `The project title, details and settings will be reset to version #${restoreTarget.versionNumber} (${
                restoreTarget.note ?? "snapshot"
              }). If that snapshot contains a script, the current script, chapters and scenes will be replaced. Assets are never deleted. A new snapshot of the restore is recorded automatically.`
            : undefined
        }
        footer={
          <>
            <Button variant="ghost" onClick={() => setRestoreTarget(null)} disabled={restoreBusy}>
              Cancel
            </Button>
            <Button onClick={handleRestore} disabled={restoreBusy}>
              {restoreBusy ? <Loader2 size={15} className="animate-spin" /> : <RotateCcw size={15} />}
              Restore version
            </Button>
          </>
        }
      />
    </div>
  );
}
