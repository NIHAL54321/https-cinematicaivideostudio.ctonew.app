"use client";

/**
 * Workspace Export tab — THE PLACE A VIDEO IS RENDERED AND COLLECTED BY CLICKING.
 * Phase 8 Export panel block, 2026-11-14.
 *
 * This tab used to read "Export — no panel on this tab in this build". Everything
 * below runs on routes that already existed (`POST /api/studio/render` with
 * enqueue | stop | retry, `GET /api/studio/render?jobId=…`, the download route) and
 * on code that already existed for the Export Center and the Download Centre:
 *
 *   - readiness is `exportReadiness()` (src/lib/studio/export-view.ts) over the
 *     project's own structure tree — the same `scenesView()` the Scenes tab counts
 *     with — and the refusal it prints when a scene is unsourced is the string
 *     `encode-master` itself throws (`encodeRefusalSentence`);
 *   - presets come from the preset registry (`EXPORT_PRESETS`), with the declared
 *     properties shown beside each one. A preset is a SPECIFICATION, not a file;
 *   - per-stage state, the attempt number and the elapsed time are read from the
 *     job's stage/attempt rows on every poll. There is no stored percentage and no
 *     spinner that outlives the job;
 *   - a delivered file is shown only when the `checksum-artefact` row says
 *     SUCCEEDED (`deliveryGate`), and the download facts (bytes, SHA-256, durable
 *     object key, and whether the bytes are actually there) are the Download
 *     Centre's own derivation, fetched through `?delivery=1`. When the file is
 *     gone, the panel says so and offers no link.
 *
 * Honesty rules held here, in the same spirit as the rest of the app:
 *   - the queue button is disabled with the reason, never left to fail silently;
 *   - a server refusal (retry, stop, enqueue) is printed in the server's words;
 *   - nothing is called done before the checksum row says SUCCEEDED, and a job the
 *     machine could not finish reads as failed/interrupted, never "still running";
 *   - no preset is weakened, and no scene is shortened, to make a render fit.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  Download,
  Film,
  Loader2,
  Play,
  RefreshCw,
  RotateCcw,
  Square,
  UploadCloud,
} from "lucide-react";
import { Badge, Button, Label } from "@/components/ui";
import { apiFetch } from "@/components/projects/client-api";
import { readScriptTreeBody } from "@/lib/studio/storyboard-view";
import type { ScriptTree } from "@/lib/studio/pipeline";
import { exportReadiness, deliveryGate, type ExportReadinessView } from "@/lib/studio/export-view";
import { EXPORT_PRESETS, findExportPreset } from "@/lib/export/presets";
import type { RenderReadout } from "@/lib/render/service";
import type { DeliverableFile } from "@/lib/downloads/centre";

type Tone = "neutral" | "accent" | "ok" | "danger";

const STATE_TONE: Record<string, Tone> = {
  SUCCEEDED: "ok",
  RUNNING: "accent",
  INTERRUPTED: "danger",
  BLOCKED: "danger",
  FAILED: "danger",
  STOPPED: "neutral",
};

const JOB_TONE: Record<string, Tone> = {
  queued: "neutral",
  running: "accent",
  interrupted: "danger",
  blocked: "danger",
  failed: "danger",
  stopped: "neutral",
  succeeded: "ok",
};

/** States nothing will move without a person: polling stops here. */
const TERMINAL = new Set(["blocked", "failed", "stopped", "succeeded", "interrupted"]);

const DEFAULT_PRESET_ID = "youtube-1080p";

type LoadState =
  | { phase: "loading" }
  | { phase: "ready"; view: ExportReadinessView };

function fmtBytes(bytes: number | null): string {
  if (bytes === null) return "unknown";
  return `${String(Math.trunc(bytes)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")} B`;
}

function shortIso(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d+Z$/, "Z");
}

/** Elapsed, measured from the job's own rows — never from a client-side timer. */
function elapsedSentence(job: RenderReadout, now: number): string {
  const start = job.job.startedAt ?? job.job.requestedAt;
  const end = job.job.finishedAt ?? new Date(now).toISOString();
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (!Number.isFinite(ms) || ms < 0) return "elapsed not measurable from the rows";
  const s = Math.round(ms / 1000);
  const basis = job.job.finishedAt
    ? `from startedAt to finishedAt on the job row`
    : `from ${job.job.startedAt ? "startedAt" : "requestedAt"} on the job row to now — the job has not finished`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s (${basis})`;
}

function stageElapsed(stage: { startedAt: string | null; finishedAt: string | null }, now: number): string | null {
  if (!stage.startedAt) return null;
  const end = stage.finishedAt ?? new Date(now).toISOString();
  const ms = new Date(end).getTime() - new Date(stage.startedAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return null;
  const s = ms / 1000;
  return s < 60 ? `${s.toFixed(1)}s` : `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function ExportTab({ projectId, onOpenScenes }: { projectId: string; onOpenScenes: () => void }) {
  const [load, setLoad] = useState<LoadState>({ phase: "loading" });
  const [presetId, setPresetId] = useState<string>(DEFAULT_PRESET_ID);
  const [job, setJob] = useState<RenderReadout | null>(null);
  const [delivery, setDelivery] = useState<DeliverableFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The server's own refusal, quoted verbatim. */
  const [refusal, setRefusal] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadReadiness = useCallback(async () => {
    try {
      const body = await apiFetch<unknown>(`/api/projects/${projectId}/storyboard`);
      const tree: ScriptTree | null = readScriptTreeBody(body);
      if (!tree) throw new Error("The storyboard response carried no structure tree.");
      setLoad({ phase: "ready", view: exportReadiness(tree) });
    } catch (e) {
      // An unreadable tree is not "ready": exportReadiness(null) says so.
      setLoad({
        phase: "ready",
        view: exportReadiness(null),
      });
      setError(e instanceof Error ? e.message : "The scenes could not be read.");
    }
  }, [projectId]);

  const readJob = useCallback(async (jobId: string) => {
    const body = await apiFetch<{ job: RenderReadout; delivery?: { files: DeliverableFile[] } }>(
      `/api/studio/render?jobId=${encodeURIComponent(jobId)}&delivery=1`,
    );
    setJob(body.job);
    setDelivery(body.delivery?.files ?? []);
    return body.job;
  }, []);

  /** The most recent job for THIS project, so a reload shows the truth, not a blank panel. */
  const loadLatestJob = useCallback(async () => {
    try {
      const body = await apiFetch<{ jobs: RenderReadout[] }>(
        `/api/studio/render?projectId=${encodeURIComponent(projectId)}`,
      );
      const latest = body.jobs?.[0] ?? null;
      if (latest) await readJob(latest.job.id);
      else {
        setJob(null);
        setDelivery([]);
      }
    } catch {
      // No job is not an error: the panel says "no render queued yet".
    }
  }, [projectId, readJob]);

  useEffect(() => {
    void loadReadiness();
    void loadLatestJob();
  }, [loadReadiness, loadLatestJob]);

  // One clock for the elapsed read-outs; it only formats row timestamps.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Poll while the job is still moving; stop the moment nothing will change it.
  useEffect(() => {
    if (!job || TERMINAL.has(job.status)) return;
    const id = job.job.id;
    timer.current = setTimeout(async () => {
      try {
        await readJob(id);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }, 1500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [job, readJob]);

  const preset = useMemo(() => findExportPreset(presetId) ?? null, [presetId]);
  const readiness = load.phase === "ready" ? load.view : null;

  async function queue() {
    setBusy(true);
    setError(null);
    setRefusal(null);
    try {
      const body = await apiFetch<{ jobId: string }>("/api/studio/render", {
        method: "POST",
        body: JSON.stringify({ action: "enqueue", projectId, presetId }),
      });
      await readJob(body.jobId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The render was not queued.");
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!job) return;
    setBusy(true);
    setError(null);
    setRefusal(null);
    try {
      const body = await apiFetch<{ job: RenderReadout }>("/api/studio/render", {
        method: "POST",
        body: JSON.stringify({ action: "stop", jobId: job.job.id, reason: "stopped from the Export tab" }),
      });
      setJob(body.job);
    } catch (e) {
      setError(e instanceof Error ? e.message : "The stop was refused.");
    } finally {
      setBusy(false);
    }
  }

  async function retry() {
    if (!job) return;
    setBusy(true);
    setError(null);
    setRefusal(null);
    try {
      const body = await apiFetch<{ job?: RenderReadout }>("/api/studio/render", {
        method: "POST",
        body: JSON.stringify({ action: "retry", jobId: job.job.id }),
      });
      if (body.job) setJob(body.job);
      await readJob(job.job.id);
    } catch (e) {
      // Quoted, not paraphrased: 404 not yours, 409 still running / nothing to
      // retry, 503 queue not connected are materially different answers.
      setRefusal(e instanceof Error ? e.message : "The server refused this retry and gave no sentence.");
    } finally {
      setBusy(false);
    }
  }

  const gate = job ? deliveryGate({ stages: job.stages }) : null;
  const failedStage = job?.stages.find((s) => s.state === "FAILED" || s.state === "BLOCKED" || s.state === "INTERRUPTED") ?? null;
  const deliverable = gate?.allowed ? delivery : [];

  return (
    <div className="mt-5 space-y-4">
      {/* ------------------------------------------------------- readiness */}
      <div className="glass p-5" data-testid="export-readiness">
        <div className="flex flex-wrap items-center gap-2">
          <Film size={15} className="text-accent" />
          <h2 className="font-display text-sm font-semibold text-ink">Readiness</h2>
          {readiness ? (
            <Badge tone={readiness.canQueue ? "ok" : "danger"} data-testid="export-readiness-badge">
              {readiness.canQueue ? "can queue" : "blocked"}
            </Badge>
          ) : (
            <Loader2 size={13} className="animate-spin text-ink-faint" />
          )}
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto"
            onClick={() => void loadReadiness()}
            data-testid="export-readiness-refresh"
          >
            <RefreshCw size={13} /> Re-read
          </Button>
        </div>

        {load.phase === "loading" ? (
          <p className="mt-2 text-sm text-ink-dim">Reading this project&apos;s scenes…</p>
        ) : (
          <>
            <p className="mt-2 text-sm leading-relaxed text-ink" data-testid="export-readiness-sentence">
              {load.view.summary}
            </p>
            {load.view.refusal ? (
              <div className="mt-2 rounded-xl border border-danger/30 bg-danger/10 p-3" data-testid="export-refusal">
                <p className="text-[12px] font-semibold uppercase tracking-wider text-danger">
                  The exact refusal the encode stage gives this project
                </p>
                <p className="mt-1 break-words font-mono text-[12px] leading-relaxed text-ink-dim">{load.view.refusal}</p>
                <p className="mt-1.5 text-[11px] text-ink-faint">
                  This is not a summary of the refusal — it is the sentence <span className="font-mono">encode-master</span>{" "}
                  throws, from the same function the stage calls.
                </p>
              </div>
            ) : null}
            {load.view.blockedReason ? (
              <p className="mt-2 text-xs leading-relaxed text-danger" data-testid="export-blocked-reason">
                {load.view.blockedReason}
              </p>
            ) : null}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={onOpenScenes}
                className="text-xs font-medium text-accent underline-offset-2 hover:underline"
                data-testid="export-open-scenes"
              >
                Open the Scenes tab to source a clip
              </button>
              <span className="text-xs text-ink-faint">
                The delivery specification and the derived production statement live on the{" "}
                <Link href="/export-center" className="text-accent underline-offset-2 hover:underline">
                  Export Center page
                </Link>
                .
              </span>
            </div>
          </>
        )}
      </div>

      {/* ---------------------------------------------------- queue controls */}
      <div className="glass p-5" data-testid="export-queue">
        <h2 className="font-display text-sm font-semibold text-ink">Queue a render</h2>
        <p className="mt-1 text-xs leading-relaxed text-ink-dim">
          A preset is a specification this app computes — not a file it has produced. What is produced is shown below, from the
          job&apos;s own stage rows.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <div>
            <Label htmlFor="export-preset">Preset</Label>
            <select
              id="export-preset"
              value={presetId}
              onChange={(e) => setPresetId(e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-panel-3/60 px-3 text-sm text-ink focus:outline-none focus:border-accent-line focus:ring-2 focus:ring-accent/20 cursor-pointer"
              data-testid="export-preset"
            >
              {EXPORT_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label} — {p.resolution} · {p.video.codec} {p.video.profile} · {p.video.frameRate} fps
                </option>
              ))}
            </select>
          </div>
          <Button
            onClick={() => void queue()}
            disabled={busy || !readiness?.canQueue}
            title={readiness?.canQueue ? "Queue this render" : (readiness?.blockedReason ?? "Readiness is still being read.")}
            data-testid="export-render"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <Play size={15} />}
            Render
          </Button>
        </div>
        {preset ? (
          <p className="mt-2 text-xs leading-relaxed text-ink-dim" data-testid="export-preset-facts">
            {preset.label}: {preset.widthPx}×{preset.heightPx} · {preset.video.codec} {preset.video.profile}
            {preset.video.level ? ` L${preset.video.level}` : ""} · {preset.video.pixelFormat} · {preset.video.frameRate} fps ·{" "}
            {preset.container} · audio {preset.audio.codec} {preset.audio.audioBitrateKbps} kbps {preset.audio.sampleRateHz} Hz ·
            spec {preset.specVersion}
          </p>
        ) : null}
        {readiness && !readiness.canQueue ? (
          <p className="mt-1.5 text-xs text-ink-faint" data-testid="export-render-disabled-reason">
            The Render button is disabled. {readiness.blockedReason}
          </p>
        ) : null}
        {error ? (
          <p className="mt-2 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger" data-testid="export-error">
            {error}
          </p>
        ) : null}
        {refusal ? (
          <p className="mt-2 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger" data-testid="export-refusal-message">
            The server refused this retry, in its own words: {refusal}
          </p>
        ) : null}
      </div>

      {/* --------------------------------------------------------- the job */}
      {!job ? (
        <div className="glass p-5" data-testid="export-job-empty">
          <p className="text-sm text-ink-dim">
            No render job exists for this project yet. Press Render and this panel shows the job it created — the queue
            belongs to the server, so closing this tab does not stop a render.
          </p>
        </div>
      ) : (
        <div className="glass p-5" data-testid="export-job">
          <div className="flex flex-wrap items-center gap-2">
            <UploadCloud size={15} className="text-accent" />
            <h2 className="font-display text-sm font-semibold text-ink">Render job</h2>
            <Badge tone={JOB_TONE[job.status] ?? "neutral"} data-testid="export-job-status">
              {job.status}
            </Badge>
            <span className="text-xs text-ink-faint">
              job {job.job.id} · preset {job.job.presetLabel} · pipeline {job.job.pipelineVersion}
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-2">
              {!TERMINAL.has(job.status) ? (
                <Button variant="outline" size="sm" onClick={() => void stop()} disabled={busy} data-testid="export-stop">
                  <Square size={13} /> Stop
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => void retry()} disabled={busy} data-testid="export-retry">
                <RotateCcw size={13} /> Retry
              </Button>
              <Button variant="ghost" size="sm" onClick={() => void readJob(job.job.id)} data-testid="export-reread">
                <RefreshCw size={13} /> Re-read
              </Button>
            </div>
          </div>

          <p className="mt-2 text-[12px] leading-relaxed text-ink-dim" data-testid="export-job-basis">
            {job.statusBasis}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-3 text-xs text-ink-faint">
            <span className="inline-flex items-center gap-1" data-testid="export-job-elapsed">
              <Clock size={12} /> {elapsedSentence(job, now)}
            </span>
            <span data-testid="export-job-attempt">
              attempt {job.latestAttempt ? job.latestAttempt.attemptNumber : "none yet"}
              {job.latestAttempt ? ` · ${job.latestAttempt.state}` : ""}
            </span>
            <span>requested {shortIso(job.job.requestedAt)}</span>
          </div>

          {/* Progress is the server's derivation from SUCCEEDED rows, printed with
              its own arithmetic so a reader can check it by hand. */}
          <div className="mt-3">
            <div className="h-2 w-full overflow-hidden rounded-full bg-panel-2">
              <div className="h-full bg-accent" style={{ width: `${job.progress.percent}%` }} />
            </div>
            <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-ink-faint" data-testid="export-progress-arithmetic">
              {job.progress.arithmetic}
            </p>
          </div>

          <ol className="mt-4 space-y-2">
            {job.stages.map((s) => (
              <li
                key={s.id}
                className="rounded-xl border border-line bg-panel-2/40 px-3 py-2.5"
                data-testid={`export-stage-${s.id}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-[11px] text-ink-faint">{s.sequence}</span>
                  <span className="text-[13px] font-semibold text-ink">{s.title}</span>
                  <Badge tone={s.state ? (STATE_TONE[s.state] ?? "neutral") : "neutral"}>{s.state ?? "not reached"}</Badge>
                  {s.attemptNumber !== null ? <span className="text-[11px] text-ink-faint">attempt {s.attemptNumber}</span> : null}
                  {stageElapsed(s, now) ? <span className="text-[11px] text-ink-faint">{stageElapsed(s, now)}</span> : null}
                </div>
                {!s.reached ? (
                  <p className="mt-1 text-[12px] text-ink-faint">
                    not reached — the pipeline stopped before this stage, so it has no row and nothing is claimed about it.
                  </p>
                ) : null}
                {s.state === "FAILED" ? (
                  <p className="mt-1 rounded-lg border border-danger/40 bg-danger/10 px-2 py-1.5 text-[12px] text-danger">
                    {s.errorMessage ?? "failed without a message"}
                  </p>
                ) : null}
                {s.state === "BLOCKED" ? (
                  <p className="mt-1 rounded-lg border border-danger/40 bg-danger/10 px-2 py-1.5 text-[12px] text-danger">
                    gated — missing: {s.missingInput ?? "an input the probe did not name"}
                  </p>
                ) : null}
                {s.state === "INTERRUPTED" ? (
                  <p className="mt-1 rounded-lg border border-danger/40 bg-danger/10 px-2 py-1.5 text-[12px] text-danger">
                    interrupted — {s.stateBasis ?? "the process that owned this row stopped without recording an outcome"}
                  </p>
                ) : null}
                {s.state === "STOPPED" ? (
                  <p className="mt-1 text-[12px] text-ink-dim">stopped — {s.blockedReason ?? "no reason stored"}</p>
                ) : null}
              </li>
            ))}
          </ol>

          {failedStage ? (
            <p className="mt-3 text-xs leading-relaxed text-ink-dim" data-testid="export-failure-summary">
              This render stopped at <span className="font-mono">{failedStage.id}</span> ({failedStage.state}). Retry creates a
              new attempt starting at the first stage that did not succeed; it does not continue the process that stopped and
              it does not rewrite any earlier attempt&apos;s rows.
            </p>
          ) : null}
        </div>
      )}

      {/* ----------------------------------------------------- the delivery */}
      <div className="glass p-5" data-testid="export-delivery">
        <div className="flex flex-wrap items-center gap-2">
          <Download size={15} className="text-accent" />
          <h2 className="font-display text-sm font-semibold text-ink">Delivery</h2>
          {job && gate ? (
            <Badge tone={gate.allowed ? "ok" : "neutral"} data-testid="export-delivery-state">
              {gate.allowed ? "checksum-artefact succeeded" : `checksum-artefact: ${gate.state ?? "not reached"}`}
            </Badge>
          ) : null}
        </div>

        {!job ? (
          <p className="mt-2 text-sm text-ink-dim">Nothing has been rendered for this project in this tab yet.</p>
        ) : !gate?.allowed ? (
          <p className="mt-2 text-sm leading-relaxed text-ink-dim" data-testid="export-delivery-not-yet">
            {gate?.reason}
          </p>
        ) : deliverable.length === 0 ? (
          <p className="mt-2 text-sm leading-relaxed text-ink-dim" data-testid="export-delivery-none">
            The checksum stage succeeded, but no artefact row for this job is a deliverable this account may download. Nothing
            is offered in its place.
          </p>
        ) : (
          <div className="mt-2 space-y-3">
            {deliverable.map((file) => {
              const downloadable = file.state === "present" || file.state === "durable";
              return (
                <div
                  key={file.artefactId}
                  className="rounded-xl border border-line bg-panel-3/40 p-3"
                  data-testid={`export-deliverable-${file.kind}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold text-ink">{file.kindLabel}</span>
                    <Badge tone={file.state === "gone" || file.state === "altered" ? "danger" : "ok"}>{file.state}</Badge>
                    <span className="text-xs text-ink-faint">{file.filename}</span>
                    {downloadable ? (
                      <a
                        href={file.href}
                        className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-[#171208]"
                        data-testid={`export-download-${file.kind}`}
                      >
                        <Download size={13} /> Download
                      </a>
                    ) : (
                      <span className="ml-auto text-xs text-danger" data-testid={`export-no-download-${file.kind}`}>
                        no download offered — the file is {file.state}
                      </span>
                    )}
                  </div>
                  <dl className="mt-2 grid gap-1 text-[12px] text-ink-dim">
                    <div className="flex flex-wrap gap-1.5">
                      <dt className="text-ink-faint">Bytes</dt>
                      <dd className="font-mono">{fmtBytes(file.recordedBytes)}</dd>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <dt className="text-ink-faint">SHA-256</dt>
                      <dd className="break-all font-mono">{file.recordedSha256}</dd>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <dt className="text-ink-faint">Durable object key</dt>
                      <dd className="break-all font-mono">
                        {file.durableCopy ? `${file.durableCopy.bucket}/${file.durableCopy.key}` : "no durable copy found in object storage"}
                      </dd>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <dt className="text-ink-faint">Copies</dt>
                      <dd>{file.copies}</dd>
                    </div>
                  </dl>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-ink-dim" data-testid={`export-deliverable-sentence-${file.kind}`}>
                    {file.sentence}
                  </p>
                  <p className="mt-1 text-[11px] text-ink-faint">
                    The download goes through this app&apos;s own route, which re-measures the bytes against the recorded size
                    and SHA-256 before it serves them.
                  </p>
                </div>
              );
            })}
          </div>
        )}

        {job && gate?.allowed ? (
          <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-faint">
            {deliverable.some((f) => f.state === "gone" || f.state === "altered") ? (
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
            ) : (
              <CheckCircle2 size={12} className="mt-0.5 shrink-0" />
            )}
            <span>
              What the file does and does not contain is stated by the container&apos;s own metadata, generated from the
              scenes&apos; provenance rows — not by this panel.
            </span>
          </p>
        ) : null}
      </div>
    </div>
  );
}
