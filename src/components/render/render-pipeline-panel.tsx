"use client";
/**
 * The render pipeline surface (Phase 8, blocks 1 and 6) — the Export Center's
 * own view of a render job.
 *
 * WHAT IT SHOWS, AND WHY IT IS BUILT THIS WAY
 * Every stage the pipeline declares is listed, in order, with its REAL state
 * read from the job's stage rows. A stage the pipeline never reached has no row
 * and is shown as "not reached" — never as pending, never as done. The gated
 * stage prints the missing input the probe named ("ffmpeg binary — not
 * installed on this machine (ENOENT)") and the sentence explaining that nothing
 * ran and nothing was written.
 *
 * A STAGE WHOSE PROCESS DIED (block 6). A stage row left in state RUNNING by a
 * process that no longer exists is shown as `interrupted`, with the sentence the
 * server derived — which says whether the owning process was OBSERVED gone or
 * whether the verdict is the weaker, time-based inference. The two are never
 * merged into one word here, because they are not the same kind of evidence.
 *
 * THE RETRY CONTROL IS NOT A PROMISE. It posts `{action:"retry"}` and shows the
 * server's own refusal sentence when the server refuses (a job that is not
 * yours, an attempt whose process is still alive, a job with nothing left to
 * retry, a queue that is not connected). Nothing on this page retries by itself.
 *
 * The percentage is not animated and not timed. It is the number the server
 * derived from the stages that actually succeeded, and the arithmetic behind it
 * is printed underneath so a reader can check it by hand.
 *
 * The job belongs to the server: polling stops when the job reaches a state that
 * will not change on its own, and closing this page does not stop the render.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Play, RefreshCw, RotateCcw, Square } from "lucide-react";
import { Badge, Card } from "@/components/ui";
import { DeclaredVersusMeasured } from "@/components/render/declared-measured";
import type { AttemptReadout, RenderReadout } from "@/lib/render/service";

type Tone = "neutral" | "accent" | "ok" | "danger";

const STATE_TONE: Record<string, Tone> = {
  SUCCEEDED: "ok",
  RUNNING: "accent",
  /** The process that owned this row is gone: a fault, not progress. */
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

const ATTEMPT_TONE: Record<string, Tone> = {
  queued: "neutral",
  running: "accent",
  interrupted: "danger",
  unknown: "neutral",
  succeeded: "ok",
  failed: "danger",
  blocked: "danger",
  stopped: "neutral",
};

/**
 * States nothing will move without a person doing something. `interrupted` is in
 * here for the same reason `failed` is: no process is working on this job, so
 * polling would only re-read the same answer forever.
 */
const TERMINAL = new Set(["blocked", "failed", "stopped", "succeeded", "interrupted"]);

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

/** An attempt's reused artefacts, as the attempt row recorded them. */
function readReusedArtefacts(raw: unknown): Array<{ kind: string; stageId: string; sha256: string; fromAttemptNumber: number }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ kind: string; stageId: string; sha256: string; fromAttemptNumber: number }> = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const r = item as { kind?: unknown; stageId?: unknown; sha256?: unknown; fromAttemptNumber?: unknown };
    if (typeof r.kind !== "string" || typeof r.stageId !== "string") continue;
    out.push({
      kind: r.kind,
      stageId: r.stageId,
      sha256: typeof r.sha256 === "string" ? r.sha256 : "",
      fromAttemptNumber: typeof r.fromAttemptNumber === "number" ? r.fromAttemptNumber : 0,
    });
  }
  return out;
}

/** What the server answered when it accepted a retry — quoted, not summarised. */
interface RetryAccepted {
  attemptNumber: number;
  startStageId: string;
  honoured: Array<{ stageId: string; fromAttemptNumber: number; reason: string }>;
  reused: Array<{ stageId: string; kind: string; sha256: string; measuredSha256: string | null; fromAttemptNumber: number }>;
  basis: string;
}

function shortIso(iso: string): string {
  return iso.replace("T", " ").replace(/\.\d+Z$/, "Z");
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
  /** The server's own refusal sentence, quoted verbatim. */
  const [refusal, setRefusal] = useState<string | null>(null);
  /** What the server said it did when it accepted a retry. */
  const [accepted, setAccepted] = useState<RetryAccepted | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const read = useCallback(async (jobId: string) => {
    const res = await fetch(`/api/studio/render?jobId=${encodeURIComponent(jobId)}`, { cache: "no-store" });
    const body = await res.json();
    if (!res.ok) throw new Error(body?.error ?? `read failed (${res.status})`);
    return body.job as RenderReadout;
  }, []);

  // Poll while the job is still moving; stop the moment nothing will change it.
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
    setRefusal(null);
    setAccepted(null);
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
    setRefusal(null);
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

  /**
   * Ask the server for a retry. Whatever the server answers is what is shown:
   * a refusal is quoted with its status code, never translated into a friendlier
   * sentence, because the difference between "still running", "nothing to
   * retry" and "queue not connected" is the whole answer.
   */
  async function retry() {
    if (!job) return;
    setBusy(true);
    setError(null);
    setRefusal(null);
    setAccepted(null);
    try {
      const res = await fetch("/api/studio/render", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "retry", jobId: job.job.id }),
      });
      const body = await res.json();
      if (!res.ok) {
        setRefusal(`${res.status} — ${body?.error ?? "the server refused this retry and gave no sentence"}`);
        return;
      }
      setAccepted({
        attemptNumber: body.attemptNumber,
        startStageId: body.startStageId,
        honoured: Array.isArray(body.honoured) ? body.honoured : [],
        reused: Array.isArray(body.reused) ? body.reused : [],
        basis: typeof body.basis === "string" ? body.basis : "",
      });
      if (body.job) setJob(body.job as RenderReadout);
      else setJob(await read(job.job.id));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

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
              onClick={retry}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-[13px] font-semibold text-ink disabled:opacity-50"
            >
              <RotateCcw size={14} />
              Retry
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

      {/* THE SERVER'S OWN REFUSAL, QUOTED. Four different answers arrive here —
          404 for a job that is not yours, 409 for an attempt whose process is
          still alive, 409 for a job with nothing left to retry, 503 for a queue
          that is not connected — and the page does not paraphrase any of them. */}
      {refusal && (
        <div className="mt-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2">
          <p className="text-[13px] font-semibold text-danger">The server refused this retry</p>
          <p className="mt-0.5 break-words text-[13px] text-ink-dim">{refusal}</p>
          <p className="mt-1 text-[11px] text-ink-faint">
            quoted from the response; nothing was queued and no attempt row was created.
          </p>
        </div>
      )}

      {accepted && (
        <div className="mt-3 rounded-lg border border-accent/40 bg-accent/10 px-3 py-2">
          <p className="text-[13px] font-semibold text-ink">
            The server accepted a retry: attempt {accepted.attemptNumber} starts at{" "}
            <span className="font-mono text-[12px]">{accepted.startStageId}</span>
          </p>
          <p className="mt-0.5 break-words text-[12px] text-ink-dim">{accepted.basis}</p>
          {accepted.honoured.length > 0 && (
            <p className="mt-1 break-words text-[12px] text-ink-dim">
              not run again:{" "}
              {accepted.honoured.map((h) => `${h.stageId} (from attempt ${h.fromAttemptNumber})`).join(", ")}
            </p>
          )}
          {accepted.reused.length > 0 && (
            <p className="mt-0.5 break-words text-[12px] text-ink-dim">
              files re-measured and reused:{" "}
              {accepted.reused
                .map((r) => `${r.kind} ${String(r.measuredSha256 ?? r.sha256).slice(0, 12)}… from attempt ${r.fromAttemptNumber}`)
                .join(", ")}
            </p>
          )}
          <p className="mt-1 text-[11px] text-ink-faint">
            it is queued, not running: this page will show the stage rows the worker writes as it writes them.
          </p>
        </div>
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
                    {s.attemptNumber !== null && <span className="text-[11px] text-ink-faint">attempt {s.attemptNumber}</span>}
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
                  {/* THE INTERRUPTED ROW (block 6): the row says RUNNING, the
                      process that owned it is gone, and the server's own sentence
                      says which kind of evidence it used. Nothing here calls it
                      running, and nothing calls it done. */}
                  {s.state === "INTERRUPTED" && (
                    <div className="mt-1 rounded-lg border border-danger/40 bg-danger/10 px-2 py-1.5">
                      <p className="text-[12px] font-semibold text-danger">
                        interrupted — the process that owned this stage stopped without recording an outcome
                      </p>
                      <p className="mt-0.5 break-words text-[12px] text-ink-dim">
                        {s.stateBasis ?? "the attempt that owns this row is not running, and no stage row was rewritten to say otherwise"}
                      </p>
                    </div>
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

          {/* ------------------------------------------------------------ *
           * WHAT A RETRY IS — stated here, in the same words for everybody.
           * ------------------------------------------------------------ */}
          <div className="mt-5 rounded-xl border border-line bg-panel-2/40 px-3 py-2.5">
            <h3 className="text-[13px] font-semibold text-ink">What Retry does, and what it does not do</h3>
            <p className="mt-1 text-[12px] text-ink-dim">
              <strong className="text-ink">It does:</strong> create a new attempt for this job, starting at the first
              declared stage whose latest row is not SUCCEEDED. Every stage before that one is honoured — its work stays
              on the attempt that did it, and its file is re-measured against the byte count and SHA-256 recorded on its
              row before it is reused. A file that no longer matches is produced again instead. The new attempt writes
              its own stage rows beside the old ones.
            </p>
            <p className="mt-1 text-[12px] text-ink-dim">
              <strong className="text-ink">It does not:</strong> continue the process that stopped, edit or delete any
              earlier attempt&apos;s rows, or start itself. Nothing is retried unless this button is pressed, and a retry
              needs the queue to be connected — when it is not, the server says so and nothing is queued.
            </p>
            {job.retry.unavailableReason && (
              <p className="mt-1 text-[12px] text-ink-faint">
                the read-out&apos;s own note, before you press it: {job.retry.unavailableReason}
              </p>
            )}
            {job.retry.firstUnsuccessfulStageId && (
              <p className="mt-0.5 text-[11px] text-ink-faint">
                from the stage rows alone the first stage that did not succeed is{" "}
                <span className="font-mono">{job.retry.firstUnsuccessfulStageId}</span> — {job.retry.note}
              </p>
            )}
          </div>

          {/* ------------------------------------------------------------ *
           * THE ATTEMPT HISTORY: attempt 1 → attempt 2, what each ran, and
           * which files the later one took from the earlier one.
           * ------------------------------------------------------------ */}
          {job.attempts.length > 0 && (
            <div className="mt-5">
              <h3 className="text-[13px] font-semibold text-ink">Attempts</h3>
              <p className="mt-0.5 text-[12px] text-ink-dim">
                One row per attempt, oldest first. A retry adds an attempt; none of these rows is rewritten by a later
                one, so attempt 1 still says exactly what happened to attempt 1.
              </p>
              <ol className="mt-2 space-y-2">
                {job.attempts.map((a: AttemptReadout) => {
                  const ran = job.stages.filter((s) => s.attemptNumber === a.attemptNumber).map((s) => s.id);
                  const reused = readReusedArtefacts(a.reusedArtefacts);
                  return (
                    <li key={a.id} className="rounded-xl border border-line bg-panel-2/40 px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] font-semibold text-ink">attempt {a.attemptNumber}</span>
                        <Badge tone={ATTEMPT_TONE[a.state] ?? "neutral"}>{a.state}</Badge>
                        <span className="text-[11px] text-ink-faint">
                          started {shortIso(a.startedAt)} · started at <span className="font-mono">{a.startStageId}</span>
                        </span>
                        {a.continuedFromId && <span className="text-[11px] text-ink-faint">continued from {a.continuedFromId}</span>}
                      </div>
                      <p className="mt-1 text-[12px] text-ink-dim">
                        <span className="text-ink-faint">ran:</span>{" "}
                        {ran.length > 0 ? ran.join(", ") : "no stage row — nothing has started on this attempt"}
                      </p>
                      <p className="mt-0.5 break-words text-[12px] text-ink-dim">
                        <span className="text-ink-faint">files reused:</span>{" "}
                        {reused.length > 0
                          ? reused
                              .map((r) => `${r.kind} (${r.sha256.slice(0, 12)}…) from attempt ${r.fromAttemptNumber}`)
                              .join(", ")
                          : "none — this attempt reused no earlier attempt's file"}
                      </p>
                      <p className="mt-0.5 text-[11px] text-ink-faint">
                        last seen in <span className="font-mono">{a.lastStageId ?? "(no stage recorded)"}</span> ·{" "}
                        {a.heartbeatCount} heartbeat(s), last at {shortIso(a.lastHeartbeatAt)}
                      </p>
                      {a.state === "interrupted" && (
                        <p className="mt-1 break-words rounded-lg border border-danger/40 bg-danger/10 px-2 py-1.5 text-[12px] text-ink-dim">
                          {a.liveness.basis}
                        </p>
                      )}
                      {a.endedReason && <p className="mt-1 break-words text-[12px] text-ink-dim">{a.endedReason}</p>}
                    </li>
                  );
                })}
              </ol>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
