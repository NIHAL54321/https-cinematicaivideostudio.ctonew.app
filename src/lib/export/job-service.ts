/**
 * Phase 6 Block 5 — export job handoff SERVICE (tenant-scoped, store-injected).
 *
 * Three actions on the single POST /api/studio/editor surface:
 *   createExportJob — freeze a SNAPSHOT of the export request (applied presets,
 *                     resolved duration, every output's full spec, the sidecar
 *                     list with each sidecar's content state, the publish
 *                     readiness verdicts), build the REAL orchestrator task for
 *                     video_enhancement, and hand it to the AI Model
 *                     Orchestrator. Store the job. With no provider connected the
 *                     job lands in the honest `blocked` state carrying the
 *                     router's own answer verbatim.
 *   listExportJobs  — the project's jobs, newest first, as summaries.
 *   getExportJob    — one job, whole: snapshot, request, router answer, history.
 *
 * WHAT IS DELIBERATELY ABSENT: any progress percentage, ETA, "encoding" state or
 * completion claim. The state model (./jobs) has exactly two states this server
 * can reach — `queued` and `blocked` — and declares the other two unreachable.
 *
 * Tenancy: every action resolves the project through
 * `store.findOwnedProject(userId, projectId)` FIRST; a missing or foreign project
 * is a 404 (never 403), and a job id is only ever looked up inside the owned
 * project's own job list.
 *
 * Persistence: the job list lives in ProjectSettings.extra.exportJobs — the same
 * place (and the same merge strategy) the rest of the engine persists project
 * state, so no schema migration is needed for a JSON snapshot by nature.
 */
import { execute, type ExecuteOptions } from "../ai/orchestrator";
import type { AiTask } from "../ai/types";
import { findExportPreset, type ExportPresetId } from "./presets";
import { PUBLISH_TARGET_IDS, checkPublishReadiness } from "./readiness";
import { humanDuration } from "./sizing";
import {
  DEDUPE_BASIS,
  DEDUPE_NOTE,
  EXPORT_JOB_ACTIONS,
  EXPORT_JOB_CAPABILITY,
  EXPORT_JOB_FORMAT,
  EXPORT_JOB_STATES,
  EXPORT_JOB_STATE_INFO,
  EXPORT_JOB_TASK_TYPE,
  EXPORT_JOB_VERSION,
  JOB_PROVIDER_ONLY_FIELDS,
  MAX_EXPORT_JOBS_PER_PROJECT,
  MAX_JOB_HISTORY,
  SNAPSHOT_OF,
  buildExportJobRouterRequest,
  isExportJobAction,
  jobOutputSpec,
  jobReadinessVerdicts,
  jobSidecarSpecs,
  jobRequestKey,
  jobSummaryView,
  jobView,
  normalizeExportJobs,
  notProducedBlock,
  reachableJobStates,
  snapshotNote,
  unreachableJobStates,
  type ExportJobHistoryEntry,
  type ExportJobRecord,
  type ExportJobRequestFacts,
  type ExportJobRouterAnswer,
  type ExportJobState,
} from "./jobs";
import {
  EXPORT_ENCODE_CAPABILITY,
  EXPORT_ENCODE_ENV,
  exportProviderGate,
  loadFinishContext,
  readAssignment,
  readinessInputFor,
  resolveDuration,
  sidecarsFor,
  type ExportResult,
  type ExportSceneRow,
  type ExportStore,
  type ResolvedDuration,
} from "./service";

/** The store contract this service needs: the export store + the job list. */
export interface ExportJobStore extends ExportStore {
  /** ProjectSettings.extra.exportJobs (unvalidated raw JSON) or null. */
  readExportJobs(projectId: string): Promise<unknown | null>;
  writeExportJobs(projectId: string, value: unknown): Promise<void>;
}

/** Options are test-only seams; the live route passes none. */
export interface ExportJobActionOptions {
  /** Forwarded to the orchestrator (tests inject an in-memory audit adapter). */
  ai?: ExecuteOptions;
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function fail(status: number, error: string, code: string, extra: Record<string, unknown> = {}): ExportResult {
  return { status, body: { error, code, ...extra } };
}

function historyEntry(entry: ExportJobHistoryEntry): ExportJobHistoryEntry {
  return entry;
}

/** Keep the newest MAX_JOB_HISTORY entries; report how many were trimmed. */
function trimHistory(history: ExportJobHistoryEntry[]): { history: ExportJobHistoryEntry[]; dropped: number } {
  if (history.length <= MAX_JOB_HISTORY) return { history, dropped: 0 };
  return { history: history.slice(history.length - MAX_JOB_HISTORY), dropped: history.length - MAX_JOB_HISTORY };
}

/**
 * The router's answer, copied VERBATIM. Nothing is prettified, reworded or
 * dropped: `error` is the orchestrator's own message (which names the env vars
 * it knows), `requiredEnv` is its own list, and the attempts are its own records.
 */
function routerAnswerOf(result: Awaited<ReturnType<typeof execute>>, at: string): ExportJobRouterAnswer {
  return {
    capability: EXPORT_JOB_CAPABILITY,
    taskType: EXPORT_JOB_TASK_TYPE,
    status: result.status,
    provider: result.provider ?? null,
    model: result.model ?? null,
    requiredEnv: [...(result.requiredEnv ?? [])],
    error: result.error ?? null,
    attempts: (result.attempts ?? []).map((a) => ({
      provider: a.provider,
      model: a.model ?? null,
      status: a.status,
      error: a.error ?? null,
      at: a.at,
    })),
    generationId: result.generationId ?? null,
    at,
  };
}

/** The state the job lands in, from the orchestrator's own status. */
function stateFromRouterStatus(status: string): ExportJobState {
  if (status === "not_connected") return "blocked";
  if (status === "ok") return "handed_off";
  // A provider was reached (failed / rate_limited / timeout) — never "blocked".
  return "provider_failed";
}

/** The honest "what a job can and cannot be right now" block. */
function stateModelView(): Record<string, unknown> {
  return {
    reachable: reachableJobStates().map((s) => ({
      state: s.state,
      label: s.label,
      terminal: s.terminal,
      means: s.means,
    })),
    unreachable: unreachableJobStates().map((s) => ({
      state: s.state,
      label: s.label,
      means: s.means,
      reason: s.unreachableReason,
    })),
    providerOnlyFields: [...JOB_PROVIDER_ONLY_FIELDS],
    note:
      "This server can reach exactly " +
      `${reachableJobStates().length} of the ${EXPORT_JOB_STATE_INFO.length} states: ` +
      `${reachableJobStates().map((s) => `"${s.state}"`).join(" and ")}. ` +
      `${unreachableJobStates().map((s) => `"${s.state}"`).join(" and ")} require a connected, wired video_enhancement provider and ` +
      "are declared unreachable rather than simulated. There is no progress, percentage, ETA or completion state anywhere in this model.",
  };
}

/** Every response carries this: what a snapshot is, and that it does not move. */
function snapshotRegimeView(): Record<string, unknown> {
  return {
    kind: "request-snapshot",
    immutable: true,
    of: [...SNAPSHOT_OF],
    note:
      "A job stores a SNAPSHOT of its request. The snapshot is written once, at creation, and is never re-read from the project: " +
      "editing the project afterwards does not change an existing job. Create a new job to capture a new snapshot.",
  };
}

function notProducedCounts(jobs: readonly ExportJobRecord[]): Record<string, unknown> {
  return {
    jobCount: jobs.length,
    blocked: jobs.filter((j) => j.state === "blocked").length,
    queued: jobs.filter((j) => j.state === "queued").length,
    handedOff: jobs.filter((j) => j.state === "handed_off").length,
    providerFailed: jobs.filter((j) => j.state === "provider_failed").length,
    filesProduced: 0,
  };
}

/* ------------------------------------------------------------------ */
/* Action handler                                                      */
/* ------------------------------------------------------------------ */

/**
 * Runs one export-JOB action. Never throws for expected failures: invalid input
 * and tenancy problems come back as `{ status, body }`, exactly like the rest of
 * the studio surface. The body returned here IS what the HTTP client sees.
 */
export async function runExportJobAction(
  store: ExportJobStore,
  userId: string,
  raw: unknown,
  opts: ExportJobActionOptions = {},
): Promise<ExportResult> {
  const body = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const action = str(body.action);
  if (!action || !isExportJobAction(action)) {
    return fail(400, "Unknown export-job action.", "unknown_action", {
      note: "Expected one of: " + EXPORT_JOB_ACTIONS.join(", "),
    });
  }
  const projectId = str(body.projectId);
  if (!projectId) return fail(400, "projectId is required.", "project_id_required");

  const project = await store.findOwnedProject(userId, projectId);
  if (!project) return fail(404, "Project not found.", "not_found");

  // A store that cannot persist jobs must say so rather than pretend to store one.
  if (typeof store.readExportJobs !== "function" || typeof store.writeExportJobs !== "function") {
    return fail(500, "Export-job storage is not available in this store.", "job_store_unavailable", {
      note: "The export-job surface needs readExportJobs/writeExportJobs on the project store; nothing was created.",
    });
  }

  const stored = await store.readExportJobs(projectId);
  const normalized = normalizeExportJobs(stored);
  const jobs = normalized.jobs;

  /* ---------------------------------------------------------- getExportJob */
  if (action === "getExportJob") {
    const jobId = str(body.jobId);
    if (!jobId) return fail(400, "jobId is required.", "job_id_required");
    const job = jobs.find((j) => j.id === jobId);
    // A job id is only ever resolved INSIDE the owned project's own list, so a
    // foreign job id is simply not found (no 403, no information leaked).
    if (!job) return fail(404, "Export job not found.", "job_not_found");

    const gate = exportProviderGate("Encoding this job's deliverable");
    return {
      status: 200,
      body: {
        action: "getExportJob",
        projectId,
        projectTitle: project.title,
        job: jobView(job),
        state: job.state,
        stateInfo: EXPORT_JOB_STATE_INFO.find((s) => s.state === job.state) ?? null,
        states: stateModelView(),
        snapshotRegime: snapshotRegimeView(),
        ...notProducedBlock(),
        provider: gate,
        store: {
          unreadable: false,
          dropped: normalized.dropped,
          jobCount: jobs.length,
          source: "ProjectSettings.extra.exportJobs",
        },
        changed: false,
        persisted: false,
        note:
          `Export job ${job.id} is in state "${job.state}". ${snapshotNote(job.snapshot.capturedAt)} ` +
          "Nothing was encoded, muxed or uploaded for this job.",
      },
    };
  }

  /* --------------------------------------------------------- listExportJobs */
  if (action === "listExportJobs") {
    const ordered = [...jobs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    const gate = exportProviderGate("Encoding the requested deliverables");
    return {
      status: 200,
      body: {
        action: "listExportJobs",
        projectId,
        projectTitle: project.title,
        count: ordered.length,
        jobs: ordered.map(jobSummaryView),
        states: stateModelView(),
        snapshotRegime: snapshotRegimeView(),
        counts: notProducedCounts(jobs),
        store: {
          unreadable: normalized.unreadable,
          dropped: normalized.dropped,
          jobCount: jobs.length,
          source: "ProjectSettings.extra.exportJobs",
        },
        provider: gate,
        changed: false,
        persisted: false,
        note:
          (normalized.unreadable
            ? "The stored job list was unreadable and is reported as empty; nothing was repaired or invented. "
            : "") +
          (normalized.dropped.length > 0
            ? `${normalized.dropped.length} stored job record(s) were not readable as jobs and are reported as dropped. `
            : "") +
          `${ordered.length} export job(s) for this project, newest first. Summaries only — use getExportJob for a full snapshot. ` +
          `${DEDUPE_NOTE} ${gate.note}`,
      },
    };
  }

  /* -------------------------------------------------------- createExportJob */
  {
    // The job snapshots the APPLIED preset set only. A preset override would make
    // the snapshot disagree with the project, so it is refused explicitly.
    if (body.presetIds !== undefined && body.presetIds !== null) {
      return fail(
        400,
        "createExportJob does not accept presetIds: a job snapshots the presets APPLIED to the project.",
        "preset_override_not_allowed",
        {
          received: body.presetIds,
          note:
            "Apply the preset set first with action \"applyExportPreset\", then create the job. The job's snapshot is then a record of " +
            "what the project actually says it will deliver, not of what a single request asked for.",
        },
      );
    }

    // An unreadable job list cannot be de-duplicated against, and must not be
    // overwritten by an append that would silently discard it.
    if (normalized.unreadable) {
      return fail(409, "The stored export-job list is unreadable; refusing to append over it.", "job_store_unreadable", {
        note:
          "ProjectSettings.extra.exportJobs is present but is not a job list. Nothing was created and nothing was overwritten. Clear " +
          "or repair that value, then create the job again.",
      });
    }

    const read = await readAssignment(store, projectId);
    const applied = read.assignment;
    if (applied.presetIds.length === 0) {
      return fail(400, "No export preset is applied to this project, so there is nothing to encode.", "no_preset_applied", {
        note:
          "A job snapshots the presets the project has applied (ProjectSettings.extra.exportPreset). Apply at least one with action " +
          "\"applyExportPreset\" (list the eight with \"listExportPresets\"), then create the job. Nothing was created.",
        unreadable: read.unreadable,
        droppedStoredPresetIds: read.dropped,
      });
    }

    const resolved = await resolveDuration(store, projectId, body);
    if (resolved.error) return resolved.error;
    const duration = resolved.duration as ResolvedDuration;
    if (duration.seconds <= 0) {
      return fail(400, "No duration is available to request an encode for.", "duration_unavailable", {
        durationSource: duration.source,
        note:
          "The request carries the duration and derives each output's size estimate from it, so it needs a real length: pass " +
          "durationSeconds, or save an editor timeline, or give the project's scenes durations. Nothing was created.",
      });
    }

    // Every real input, read once: scenes, timeline, project meta, thumbnail.
    const ctx = await loadFinishContext(store, projectId, duration);
    const sidecars = sidecarsFor(projectId, project.title, ctx);
    const readiness = checkPublishReadiness(
      [...PUBLISH_TARGET_IDS],
      readinessInputFor(project.title, ctx, applied.presetIds),
    );

    const outputs = applied.presetIds
      .map((id: ExportPresetId) => findExportPreset(id))
      .filter((p): p is NonNullable<typeof p> => p !== null)
      .map((preset) => jobOutputSpec(preset, project.title, duration.seconds));
    if (outputs.length === 0) {
      return fail(400, "None of the applied preset ids is in the catalogue.", "no_usable_preset", {
        appliedPresetIds: applied.presetIds,
      });
    }

    const sidecarSpecs = jobSidecarSpecs(sidecars);
    const facts: ExportJobRequestFacts = {
      projectId,
      presetIds: applied.presetIds,
      durationSeconds: duration.seconds,
      durationSource: duration.source,
      sidecarStates: sidecarSpecs.map((s) => [s.id, s.contentState] as const),
      cueCount: ctx.plan.cues.length,
    };
    const requestKey = jobRequestKey(facts);
    const capturedAt = new Date().toISOString();

    /* ---- De-duplication: an identical earlier request returns the SAME job. -- */
    const existing = jobs.find((j) => j.requestKey === requestKey);
    if (existing) {
      const gate = exportProviderGate("Encoding this job's deliverable");
      return {
        status: 200,
        body: {
          action: "createExportJob",
          projectId,
          projectTitle: project.title,
          created: false,
          deduplicated: true,
          dedupe: { key: requestKey, basis: DEDUPE_BASIS, note: DEDUPE_NOTE },
          job: jobView(existing),
          state: existing.state,
          stateInfo: EXPORT_JOB_STATE_INFO.find((s) => s.state === existing.state) ?? null,
          states: stateModelView(),
          snapshotRegime: snapshotRegimeView(),
          provider: gate,
          changed: false,
          persisted: false,
          plan: { requested: false, encoded: false, muxed: false, uploaded: false, filesProduced: 0 },
          note:
            `An identical export request already exists as job ${existing.id} (same ${requestKey}), so it was returned unchanged ` +
            `instead of creating a second job. ${snapshotNote(existing.snapshot.capturedAt)} ${gate.note}`,
        },
      };
    }

    if (jobs.length >= MAX_EXPORT_JOBS_PER_PROJECT) {
      return fail(400, `This project already holds ${MAX_EXPORT_JOBS_PER_PROJECT} export jobs (the limit).`, "export_job_limit", {
        jobCount: jobs.length,
        max: MAX_EXPORT_JOBS_PER_PROJECT,
        note:
          "Refused rather than silently overwriting an older job's snapshot. Re-requesting an existing request returns that job " +
          "unchanged; a genuinely new request needs an older job removed first.",
      });
    }

    const jobId = crypto.randomUUID();
    const routerRequest = buildExportJobRouterRequest({
      projectId,
      jobId,
      requestKey,
      capturedAt,
      durationSeconds: duration.seconds,
      durationSource: duration.source,
      outputs,
      sidecars: sidecarSpecs,
    });

    /* ---- The REAL orchestrator call (router + honest gate, no if-statement). - */
    const task: AiTask = {
      id: jobId,
      type: EXPORT_JOB_TASK_TYPE,
      capability: EXPORT_JOB_CAPABILITY,
      projectId,
      // The request object is the task's payload/params/metadata — one shape,
      // declared in ./jobs and asserted by the injected-provider test.
      payload: routerRequest.payload as unknown as Record<string, unknown>,
      params: routerRequest.params,
      metadata: routerRequest.metadata as unknown as Record<string, unknown>,
    };
    const requestedAt = new Date().toISOString();
    let router: ExportJobRouterAnswer;
    let orchestratorThrew: string | null = null;
    try {
      const result = await execute(userId, task, opts.ai ?? {});
      router = routerAnswerOf(result, new Date().toISOString());
    } catch (err) {
      // An orchestrator that throws is NOT a provider answer: the job stays
      // "queued" (the request was made) and nothing is claimed about a provider.
      orchestratorThrew = err instanceof Error ? err.message : String(err);
      router = {
        capability: EXPORT_JOB_CAPABILITY,
        taskType: EXPORT_JOB_TASK_TYPE,
        status: "orchestrator_error",
        provider: null,
        model: null,
        requiredEnv: [],
        error: orchestratorThrew,
        attempts: [],
        generationId: null,
        at: new Date().toISOString(),
      };
    }

    const state: ExportJobState = orchestratorThrew ? "queued" : stateFromRouterStatus(router.status);

    const history: ExportJobHistoryEntry[] = [
      historyEntry({
        at: capturedAt,
        event: "snapshot-captured",
        state: "queued",
        detail:
          `Snapshot taken of ${applied.presetIds.length} applied preset(s) at ${duration.seconds} s (${duration.source}); ` +
          `${outputs.length} output spec(s) and ${sidecarSpecs.length} sidecar slot(s) recorded. No file was produced.`,
      }),
      historyEntry({
        at: requestedAt,
        event: "orchestrator-request",
        state: "queued",
        detail:
          `Request handed to the AI Model Orchestrator: capability "${EXPORT_JOB_CAPABILITY}", task "${EXPORT_JOB_TASK_TYPE}", ` +
          `sources ${outputs.map((o) => o.fileName).join(", ")}. This records that the REQUEST was made, not that work started.`,
      }),
    ];
    if (orchestratorThrew) {
      history.push(
        historyEntry({
          at: router.at,
          event: "orchestrator-error",
          state: "queued",
          detail:
            "The orchestrator call threw before returning an answer, so no provider answer exists to record: " + orchestratorThrew,
        }),
      );
    } else if (router.status === "not_connected") {
      history.push(
        historyEntry({
          at: router.at,
          event: "router:not_connected",
          state: "blocked",
          detail: router.error ?? "The router returned not_connected without a message.",
          routerStatus: router.status,
          requiredEnv: router.requiredEnv,
        }),
      );
    } else if (router.status === "ok") {
      history.push(
        historyEntry({
          at: router.at,
          event: "router:ok",
          state: "handed_off",
          detail:
            `Provider "${router.provider ?? "unknown"}" accepted the request and returned its own output reference. The app has NOT ` +
            "verified an encoded file, so the job is recorded as handed off — never as completed.",
          routerStatus: router.status,
          requiredEnv: router.requiredEnv,
        }),
      );
    } else {
      history.push(
        historyEntry({
          at: router.at,
          event: `router:${router.status}`,
          state: "provider_failed",
          detail:
            (router.error ?? `The router returned ${router.status}.`) +
            ` Attempts: ${router.attempts.length}. Nothing was produced.`,
          routerStatus: router.status,
          requiredEnv: router.requiredEnv,
        }),
      );
    }

    const trimmed = trimHistory(history);
    const record: ExportJobRecord = {
      format: EXPORT_JOB_FORMAT,
      version: EXPORT_JOB_VERSION,
      id: jobId,
      projectId,
      createdBy: userId,
      createdAt: capturedAt,
      updatedAt: new Date().toISOString(),
      requestKey,
      state,
      snapshot: {
        format: EXPORT_JOB_FORMAT,
        version: EXPORT_JOB_VERSION,
        kind: "request-snapshot",
        projectId,
        projectTitle: project.title ?? null,
        capturedAt,
        presetAssignment: {
          presetIds: [...applied.presetIds],
          appliedAt: applied.appliedAt,
          source: "ProjectSettings.extra.exportPreset",
          note:
            "The preset set the project itself has applied" +
            (read.dropped.length > 0
              ? `; ${read.dropped.length} stored id(s) were not in the catalogue and were ignored: ${read.dropped.join(", ")}`
              : ""),
        },
        duration: { seconds: duration.seconds, human: humanDuration(duration.seconds), source: duration.source, note: duration.note },
        outputs,
        sidecars: sidecarSpecs,
        sidecarCounts: { ...sidecars.counts },
        readiness: jobReadinessVerdicts(readiness),
        cueCount: ctx.plan.cues.length,
        of: [...SNAPSHOT_OF],
        note: snapshotNote(capturedAt),
      },
      routerRequest,
      router,
      statusHistory: trimmed.history,
      droppedHistoryEntries: trimmed.dropped,
      progress: null,
      percentComplete: null,
      etaSeconds: null,
      completedAt: null,
      outputUrl: null,
      outputBytes: null,
      filesProduced: 0,
    };

    await store.writeExportJobs(projectId, [...jobs, record]);

    const gate = exportProviderGate("Encoding this job's deliverable");
    const routerEnvNames = router.requiredEnv;
    return {
      status: 200,
      body: {
        action: "createExportJob",
        projectId,
        projectTitle: project.title,
        created: true,
        deduplicated: false,
        dedupe: { key: requestKey, basis: DEDUPE_BASIS, note: DEDUPE_NOTE },
        job: jobView(record),
        state: record.state,
        stateInfo: EXPORT_JOB_STATE_INFO.find((s) => s.state === record.state) ?? null,
        states: stateModelView(),
        snapshotRegime: snapshotRegimeView(),
        snapshot: record.snapshot,
        routerRequest,
        router,
        statusHistory: record.statusHistory,
        // Both env var NAMES are stated, and which is which: the router's own
        // list (the provider slots it knows) and the export surface's gate name.
        requiredEnv: [...new Set([EXPORT_ENCODE_ENV, ...routerEnvNames])].sort(),
        envHint: EXPORT_ENCODE_ENV,
        envNote:
          `The export surface names "${EXPORT_ENCODE_ENV}" — the env var a server operator sets to wire an encoding pipeline. ` +
          (routerEnvNames.length > 0
            ? `The router's own answer additionally names the provider-slot key(s) it knows: ${routerEnvNames.join(", ")}. `
            : "The router's own answer named no env var. ") +
          "Both are NAMES only; no value is read, stored or returned anywhere.",
        ...notProducedBlock(),
        provider: gate,
        changed: true,
        persisted: true,
        plan: { requested: true, encoded: false, muxed: false, uploaded: false, filesProduced: 0 },
        store: {
          unreadable: false,
          dropped: normalized.dropped,
          jobCount: jobs.length + 1,
          source: "ProjectSettings.extra.exportJobs",
        },
        note:
          record.state === "blocked"
            ? `The request was made and the router answered "${router.status}": the job is blocked with the router's own answer ` +
              `recorded verbatim, and it will stay blocked until a provider is connected. ${gate.note}`
            : record.state === "handed_off"
              ? "The request was accepted by a connected provider (handed off). No encoded file has been verified by this app, so no " +
                "completion is claimed."
              : record.state === "provider_failed"
                ? "A provider was reached and every attempt failed; the router's own error is recorded verbatim."
                : "The orchestrator call threw before answering, so the job records the request without a provider answer.",
      },
    };
  }
}

/* Re-exported so the editor service can keep its import surface narrow. */
export { EXPORT_JOB_ACTIONS, EXPORT_JOB_STATES, EXPORT_ENCODE_CAPABILITY, EXPORT_ENCODE_ENV, notProducedBlock };
export type { ExportJobRecord, ExportJobState };
