/**
 * RECORDING METERED WORK, FROM THE CODE PATH THAT DOES THE WORK
 * (Phase 8, block 5)
 *
 * Every function here is called BY the thing it meters:
 *
 *   - `enqueueRenderJob` / `enqueueSyntheticProofJob`  → RENDER_JOB_CREATED
 *     (`src/lib/render/service.ts`, right after the job row is created)
 *   - `runRenderPipeline`                             → RENDER_STAGE_RUN, once
 *     per stage row it writes, with the stage's own outcome (SUCCEEDED, FAILED,
 *     BLOCKED, STOPPED) — `src/lib/render/runner.ts`
 *   - `runRenderPipeline`                             → ENCODER_PROBE, once per
 *     encoder probe it actually ran — same file
 *   - the AI orchestrator's attempt loop              → PROVIDER_CALL_ATTEMPT,
 *     once per candidate call, INCLUDING the ones that failed
 *     (`src/lib/ai/orchestrator.ts`)
 *
 * Nothing is reconstructed afterwards from log files or from stage rows: the
 * row is written at the moment of the action, by the code that took it.
 *
 * A METERING FAILURE IS NOT A WORK FAILURE. `meter()` never throws: if the
 * database refuses the row, the render or the provider call has already
 * happened and must not be undone or reported as failed because of an
 * accounting problem. It returns `{ recorded: false, error }` instead, and the
 * callers that can surface it do; the ones inside the runner (which has no
 * user-facing response) rely on the return value being visible in the run's own
 * output. What this deliberately does NOT do is silently claim a row was
 * written when it was not.
 *
 * WHAT IS NOT HERE, ON PURPOSE: nothing converts a usage row into a charge. A
 * charge needs a price, this build has no approved price and no product, so the
 * product never spends credits by itself. `postSpend()` in `./ledger.ts` exists
 * and is exercised by the fixture script at a rate the FIXTURE declares and
 * labels as not a price. When the owner approves a price, the conversion
 * belongs here — see `plans.ts` for the seam.
 */
import type { UsageEventInput, UsageEventRecord, UsageKind, UsageOutcome } from "./types";
import type { UsageStore } from "./store";

export interface MeterResult {
  recorded: boolean;
  id?: string;
  /** Set only when `recorded` is false: what stopped the row being written. */
  error?: string;
}

let defaultStorePromise: Promise<UsageStore> | null = null;
async function defaultStore(): Promise<UsageStore> {
  if (!defaultStorePromise) {
    // Lazy, so importing this module in a unit test does not construct a
    // Prisma client or touch the network.
    defaultStorePromise = import("./store").then((m) => m.prismaUsageStore);
  }
  return defaultStorePromise;
}

/** The reasons a usage row can be refused before it ever reaches the database. */
export function validateUsageInput(input: UsageEventInput): string | null {
  if (!input.userId || typeof input.userId !== "string") return "a usage row must name the account it belongs to";
  if (!Number.isInteger(input.quantity) || input.quantity < 0) {
    return `a usage quantity must be a non-negative whole number, got ${String(input.quantity)}`;
  }
  if (!input.unit || input.unit.trim().length === 0) return "a usage row must say what its quantity counts";
  if (!input.source || input.source.trim().length === 0) return "a usage row must name the code path that wrote it";
  return null;
}

/** Writes one usage row through `store`. Never throws — see the header. */
export async function meter(input: UsageEventInput, store?: UsageStore): Promise<MeterResult> {
  const invalid = validateUsageInput(input);
  if (invalid) return { recorded: false, error: invalid };
  try {
    const target = store ?? (await defaultStore());
    const row: UsageEventRecord = await target.appendUsageEvent(input);
    return { recorded: true, id: row.id };
  } catch (err) {
    return { recorded: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/* ------------------------------------------------------------------ */
/* The three call-site helpers                                         */
/* ------------------------------------------------------------------ */

/** A render job row was created by `enqueueRenderJob`/`enqueueSyntheticProofJob`. */
export function renderJobCreated(input: {
  userId: string;
  projectId: string;
  renderJobId: string;
  presetId: string;
  synthetic: boolean;
}): UsageEventInput {
  return {
    userId: input.userId,
    projectId: input.projectId,
    renderJobId: input.renderJobId,
    kind: "RENDER_JOB_CREATED",
    quantity: 1,
    unit: "render job",
    outcome: "NOT_APPLICABLE",
    synthetic: input.synthetic,
    source: "src/lib/render/service.ts",
    detail: { presetId: input.presetId },
  };
}

/** One pipeline stage row was written, with the state it was written in. */
export function stageRun(input: {
  userId: string;
  projectId: string;
  renderJobId: string;
  stageId: string;
  state: "SUCCEEDED" | "FAILED" | "BLOCKED" | "STOPPED";
  synthetic: boolean;
  detail?: Record<string, unknown> | null;
}): UsageEventInput {
  const outcome: UsageOutcome = input.state;
  return {
    userId: input.userId,
    projectId: input.projectId,
    renderJobId: input.renderJobId,
    stageId: input.stageId,
    kind: "RENDER_STAGE_RUN",
    quantity: 1,
    unit: "stage run",
    outcome,
    synthetic: input.synthetic,
    source: "src/lib/render/runner.ts",
    detail: input.detail ?? null,
  };
}

/**
 * An encoder probe that was actually run. Only the probes that interrogate the
 * encoder are metered here; a `project-has-scenes` database count is not an
 * encoder probe and is not dressed up as one.
 */
export const METERED_PROBE_IDS: readonly string[] = ["ffmpeg-binary", "ffprobe-binary", "encode-provider-keyed"];

export function encoderProbe(input: {
  userId: string;
  projectId: string;
  renderJobId: string;
  stageId: string;
  probeId: string;
  ok: boolean;
  synthetic: boolean;
  detail: string;
}): UsageEventInput {
  return {
    userId: input.userId,
    projectId: input.projectId,
    renderJobId: input.renderJobId,
    stageId: input.stageId,
    kind: "ENCODER_PROBE",
    quantity: 1,
    unit: "probe",
    outcome: input.ok ? "SUCCEEDED" : "FAILED",
    synthetic: input.synthetic,
    source: "src/lib/render/runner.ts",
    detail: { probeId: input.probeId, evidence: input.detail },
  };
}

/** One provider call ATTEMPT — recorded whether it succeeded or failed. */
export function providerCallAttempt(input: {
  userId: string;
  projectId?: string | null;
  provider: string;
  model: string | null;
  capability: string;
  taskType: string;
  ok: boolean;
  latencyMs?: number | null;
  error?: string | null;
}): UsageEventInput {
  return {
    userId: input.userId,
    projectId: input.projectId ?? null,
    kind: "PROVIDER_CALL_ATTEMPT",
    quantity: 1,
    unit: "call attempt",
    outcome: input.ok ? "SUCCEEDED" : "FAILED",
    // A provider call is never synthetic: no provider has ever been simulated
    // on this build, and a call that did not reach a provider is recorded as a
    // failed attempt rather than as a synthetic success.
    synthetic: false,
    source: "src/lib/ai/orchestrator.ts",
    detail: {
      provider: input.provider,
      model: input.model,
      capability: input.capability,
      taskType: input.taskType,
      latencyMs: input.latencyMs ?? null,
      error: input.error ?? null,
    },
  };
}

/** Re-exported so a caller can type its kind without importing two modules. */
export type { UsageKind };
