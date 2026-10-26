"use client";
/**
 * The render pipeline surface (Phase 8, block 1) — the Export Center's own
 * view of a render job.
 *
 * WHAT IT SHOWS, AND WHY IT IS BUILT THIS WAY
 * Every stage the pipeline declares is listed, in order, with its REAL state
 * read from the job's stage rows. A stage the pipeline never reached has no row
 * and is shown as "not reached" — never as pending, never as done. The gated
 * stage prints the missing input the probe named ("ffmpeg binary — not
 * installed on this machine (ENOENT)") and the sentence explaining that nothing
 * ran and nothing was written.
 *
 * The percentage is not animated and not timed. It is the number the server
 * derived from the stages that actually succeeded, and the arithmetic behind it
 * is printed underneath so a reader can check it by hand.
 *
 * The job belongs to the server: polling stops when the job reaches a terminal
 * state, and closing this page does not stop the render.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play, RefreshCw, Square } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { DeclaredVersusMeasured } from "@/components/render/declared-measured";
import type { RenderReadout } from "@/lib/render/service";

type Tone = "neutral" | "accent" | "ok" | "danger";

const STATE_TONE: Record<string, Tone> = {
  SUCCEEDED: "ok",
  RUNNING: "accent",
  BLOCKED: "danger",
  FAILED: "danger",
  STOPPED: "neutral",
};

const JOB_TONE: Record<string, Tone> = {
  queued: "neutral",
  running: "accent",
  blocked: "danger",
  failed: "danger",
  stopped: "neutral",
  succeeded: "ok",
};

const TERMINAL = new Set(["blocked", "failed", "stopped", "succeeded"]);

/**
 * The specification a gated FILE stage would have run with (Phase 8, block 2a).
 * A blocked row used to say only "ffmpeg is missing"; it now also prints the
 * exact frame, codec, rate control and argv the stage would have used — while
 * still naming the binary as the missing input. The gate is more informative; it
 * is not weaker.
 */
interface WouldRunWith {
  resolved: boolean;
  reason?: string;
  presetId?: string;
  presetLabel?: string;
  recordedSpecSha256?: string | null;
  liveSpecSha256?: string;
  specMatchesRecord?: boolean;
  spec?: {
    resolution?: { widthPx: number; heightPx: number };
    video?: {
      codec?: string;
      profile?: string;
      level?: string | null;
      pixelFormat?: string;
      frameRate?: number;
      rateControl?: { mode?: string; targetVideoBitrateKbps?: number; maxVideoBitrateKbps?: number | null; crf?: number | null };
    };
    colour?: { display?: string; standard?: string };
    audio?: { codec?: string; audioBitrateKbps?: number; sampleRateHz?: number; loudnessTargetLufs?: number };
  };
  command?: { binary: string; args: string[]; missingInput: string; note: string };
  note?: string;
}

function readWouldRunWith(output: unknown): WouldRunWith | null {
  if (!output || typeof output !== "object") return null;
  const w = (output as { wouldRunWith?: unknown }).wouldRunWith;
  if (!w || typeof w !== "object") return null;
  return w as WouldRunWith;
}

export function RenderPipelinePanel({
  projects,
  initialJob,
}: {
  projects: Array<{ id: string; title: string }>;
  initialJob: RenderReadout | null;
}) {
  const [job, setJob] = useState<RenderReadout | null>(initialJob);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const read = useCallback(async (jobId: string) => {
    const res = await fetch(`/api/studio/render?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error ?? `read failed (${res.status})`);
    return body.job as RenderReadout;
  }, []);

  // Poll while the job is still moving; stop the moment it is terminal.
  useEffect(() => {
    if (!job || TERMINAL.has(job.status)) return;
    const id = job.job.id;
    timer.current = setTimeout(async () => {
      try {
        setJob(await read(id));
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }, 1500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [job, read]);

  async function queue() {
    if (!projectId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/studio/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "enqueue", projectId }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `enqueue failed (${res.status})`);
      setJob(await read(body.jobId));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function stop() {
    if (!job) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/studio/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "stop", jobId: job.job.id, reason: "stopped from the Export Center" }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `stop failed (${res.status})`);
      setJob(body.job as RenderReadout);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const status = job?.status ?? null;

  return (
    <Card className="mt-8 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold text-ink">Render pipeline</h2>
          <p className="mt-1 max-w-2xl text-sm text-ink-dim">
            Seven stages from a finished project to a delivered master. Each stage declares what it consumes, what it
            produces and where its runnability comes from — a live probe, never a typed boolean. A stage whose
            requisite is absent is gated, names the missing input, and the pipeline stops there: no row is written for
            the stages after it and no file is claimed.
          </p>
        </div>
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-2">
          <select
            aria-label="Project to render"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="min-w-0 max-w-full rounded-lg border border-line bg-panel-2 px-3 py-2 text-[13px] text-ink"
          >
            {projects.length === 0 && <option value="">No projects</option>}
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={queue}
            disabled={busy || !projectId}
            className="inline-flex items-center gap-2 rounded-lg bg-accent px-3 py-2 text-[13px] font-semibold text-black disabled:opacity-50"
          >
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            Queue a render
          </button>
          {job && !TERMINAL.has(job.status) && (
            <button
              type="button"
              onClick={stop}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px] font-semibold text-ink disabled:opacity-50"
            >
              <Square size={14} />
              Stop
            </button>
          )}
          {job && (
            <button
              type="button"
              onClick={async () => {
                try {
                  setJob(await read(job.job.id));
                } catch (err) {
                  setError(err instanceof Error ? err.message : String(err));
                }
              }}
              className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px] text-ink-dim"
            >
              <RefreshCw size={14} />
              Re-read
            </button>
          )}
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">{error}</p>
      )}

      {!job ? (
        <p className="mt-4 text-sm text-ink-dim">
          No render job on this account yet. Queue one to watch the pipeline run — it will run in the background, and
          this page can be closed and reopened without stopping it.
        </p>
      ) : (
        <div className="mt-4">
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={JOB_TONE[job.status] ?? "neutral"}>{job.status}</Badge>
            <span className="text-[13px] text-ink-dim">
              job {job.job.id} · {job.job.projectTitle}
              {job.job.fixture ? " · FIXTURE" : ""} · preset {job.job.presetLabel}
            </span>
            <span className="text-[13px] text-ink-faint">
              artefacts: <strong className="text-ink">{job.artefacts.count}</strong>
            </span>
            <span className="text-[13px] text-ink-faint">
              spec: <strong className="text-ink">{job.job.presetSpecSha256 ? job.job.presetSpecSha256.slice(0, 12) : "not recorded"}</strong>
              {job.job.specVersion ? ` · ${job.job.specVersion}` : ""}
              {job.job.presetStillMatchesRecord === false ? " · the catalogue has changed since this job was enqueued" : ""}
            </span>
          </div>

          <p className="mt-2 text-[13px] text-ink-dim">{job.statusBasis}</p>

          <div className="mt-3">
            <div className="h-2 w-full overflow-hidden rounded-full bg-panel-2">
              <div className="h-full bg-accent" style={{ width: `${job.progress.percent}%` }} />
            </div>
            <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-ink-faint">{job.progress.arithmetic}</p>
          </div>

          <ol className="mt-4 space-y-2">
            {job.stages.map((s) => {
              const tone = s.state ? STATE_TONE[s.state] ?? "neutral" : "neutral";
              return (
                <li key={s.id} className="rounded-xl border border-line bg-panel-2/40 px-3 py-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-ink-faint">{s.sequence}</span>
                    <span className="text-[13px] font-semibold text-ink">{s.title}</span>
                    <Badge tone={tone}>{s.state ?? "not reached"}</Badge>
                    <span className="text-[11px] text-ink-faint">weight {s.weight}</span>
                    {s.reached && <span className="text-[11px] text-ink-faint">artefacts {s.artefactCount}</span>}
                  </div>
                  <p className="mt-1 text-[12px] text-ink-dim">
                    <span className="text-ink-faint">produces:</span> {s.produces.label}
                    {s.produces.kind === "file" ? " (a file on disk)" : " (a recorded plan)"}
                  </p>
                  {s.requires.length > 0 && (
                    <p className="mt-0.5 text-[12px] text-ink-faint">
                      requires: {s.requires.map((r) => r.probeId).join(", ")}
                    </p>
                  )}
                  {!s.reached && (
                    <p className="mt-1 text-[12px] text-ink-faint">
                      not reached — the pipeline stopped before this stage, so it has no row and nothing is claimed
                      about it.
                    </p>
                  )}
                  {s.state === "BLOCKED" && (
                    <p className="mt-1 rounded-lg border border-danger/40 bg-danger/10 px-2 py-1.5 text-[12px] text-danger">
                      gated — missing: {s.missingInput ?? "an input the probe did not name"}
                    </p>
                  )}
                  {s.state === "BLOCKED" && (() => {
                    const plan = readWouldRunWith(s.output);
                    if (!plan) return null;
                    if (!plan.resolved) {
                      return (
                        <p className="mt-1 text-[12px] text-ink-dim">
                          No specification can be shown for this job&apos;s preset: {plan.reason ?? "the preset is unknown"}.
                        </p>
                      );
                    }
                    const v = plan.spec?.video;
                    const rc = v?.rateControl;
                    const rate =
                      rc?.mode === "crf"
                        ? `CRF ${rc.crf} (planning equivalent ${rc.targetVideoBitrateKbps} kbps)`
                        : `${String(rc?.mode ?? "").toUpperCase()} ${rc?.targetVideoBitrateKbps} kbps${rc?.maxVideoBitrateKbps ? ` / cap ${rc.maxVideoBitrateKbps} kbps` : ""}`;
                    return (
                      <div className="mt-1 rounded-lg border border-line bg-panel-2/60 px-2 py-1.5">
                        <p className="text-[12px] font-semibold text-ink">
                          This stage would run with: {plan.presetLabel}{" "}
                          <span className="font-mono text-[11px] text-ink-faint">{plan.presetId}</span>
                        </p>
                        <p className="mt-0.5 break-words text-[12px] text-ink-dim">
                          {plan.spec?.resolution?.widthPx}×{plan.spec?.resolution?.heightPx} · {v?.codec} {v?.profile} ·{" "}
                          {v?.pixelFormat} · {v?.frameRate} fps · {rate} ·{" "}
                          {plan.spec?.colour?.display} {plan.spec?.colour?.standard} · {plan.spec?.audio?.codec}{" "}
                          {plan.spec?.audio?.audioBitrateKbps} kbps {plan.spec?.audio?.sampleRateHz} Hz ·{" "}
                          {plan.spec?.audio?.loudnessTargetLufs} LUFS
                        </p>
                        {/* What this preset DECLARES for the codec level, beside
                            what a file measured at it actually carries — two
                            labelled sentences, never one value posing as the
                            other (src/components/render/declared-measured.tsx). */}
                        <DeclaredVersusMeasured
                          presetId={String(plan.presetId)}
                          codec={String(v?.codec ?? "")}
                          profile={String(v?.profile ?? "")}
                          level={(v?.level as string | null | undefined) ?? null}
                        />
                        <p className="mt-0.5 text-[11px] text-ink-faint">
                          spec digest recorded on this job: {plan.recordedSpecSha256?.slice(0, 16) ?? "none"} · catalogue now:{" "}
                          {plan.liveSpecSha256?.slice(0, 16)} ·{" "}
                          {plan.specMatchesRecord ? "identical" : "the catalogue has changed since enqueue"}
                        </p>
                        {plan.command && (
                          <details className="mt-1">
                            <summary className="cursor-pointer text-[11px] font-semibold text-accent">
                              the argv it would spawn — and why the gate still holds
                            </summary>
                            <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-ink-dim">
                              {plan.command.binary} {plan.command.args.join(" ")}
                            </p>
                            <p className="break-words text-[11px] leading-relaxed text-ink-faint">
                              {plan.command.note} Missing input: {plan.command.missingInput}
                            </p>
                          </details>
                        )}
                      </div>
                    );
                  })()}
                  {s.state === "STOPPED" && (
                    <p className="mt-1 text-[12px] text-ink-dim">stopped — {s.blockedReason ?? "no reason stored"}</p>
                  )}
                  {s.state === "FAILED" && (
                    <p className="mt-1 text-[12px] text-danger">{s.errorMessage ?? "failed without a message"}</p>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </Card>
  );
}
