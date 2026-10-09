/**
 * AI Model Orchestrator — the provider-independent heart of the product.
 *
 * execute(userId, task):
 *   1. route → ranked candidate list (router)
 *   2. filter to ready providers (configured AND wired)
 *   3. if none: honest { status: "not_connected", requiredEnv } — no fake
 *      generation, one honest ProviderLog row ("no provider configured")
 *   4. else: walk the A → B → C → D chain, recording every real attempted call
 *      in AIGeneration + ProviderLog (tenant-scoped to userId), returning a
 *      structured AiResult.
 *
 * enqueue(userId, task): same routing/not_connected logic, then pushes the
 * task to the BullMQ "ai" queue as an AIGeneration row (status QUEUED).
 * Worker wiring (consuming those jobs through this orchestrator) is a later
 * task — only the enqueue path ships here.
 *
 * The core has NO static app imports: persistence and queue adapters are
 * injected (defaults are Prisma + BullMQ, loaded lazily) so the fallback
 * mechanism is unit-testable without a database and without `@/` aliases.
 * Nothing is ever simulated.
 */
import type {
  AiAttempt,
  AiResult,
  AiResultStatus,
  AiTask,
  AiUserPlan,
} from "./types";
import type { ProviderCallResult } from "./providers/types";
import { isProviderReady } from "./providers/types";
import { routeTask, type TaskContext } from "./router";
import { providersFor, testModeEnabled } from "./providers/registry";
import { capabilityEnvNames } from "./providers/capability-env";

// ---------------------------------------------------------------------------
// Persistence adapter (tenant-scoped audit trail)
// ---------------------------------------------------------------------------

export interface GenerationCreateInput {
  userId: string;
  projectId?: string | null;
  task: AiTask;
  provider: string;
  model: string | null;
  status: "PENDING" | "QUEUED" | "RUNNING";
}

export interface GenerationUpdateInput {
  status?: "SUCCEEDED" | "FAILED";
  provider?: string;
  model?: string | null;
  resultRefs?: Record<string, unknown> | null;
  errorMessage?: string | null;
  costCredits?: number | null;
  durationMs?: number | null;
  completedAt?: Date | null;
}

export interface ProviderLogInput {
  userId: string;
  projectId?: string | null;
  aiGenerationId?: string | null;
  provider: string;
  model?: string | null;
  taskType: string;
  status: "SUCCEEDED" | "FAILED";
  requestSummary?: Record<string, unknown> | null;
  responseSummary?: Record<string, unknown> | null;
  durationMs?: number | null;
  errorMessage?: string | null;
  providerRequestId?: string | null;
}

export interface AiPersistence {
  createGeneration(input: GenerationCreateInput): Promise<{ id: string }>;
  updateGeneration(id: string, data: GenerationUpdateInput): Promise<void>;
  createProviderLog(input: ProviderLogInput): Promise<void>;
  getUserPlan?(userId: string): Promise<AiUserPlan | null>;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ExecuteOptions {
  /** Override persistence (tests inject an in-memory adapter). */
  persistence?: AiPersistence;
  /** Router context overrides (plan, videoType, resolution, language, requirements). */
  context?: Partial<TaskContext>;
  /** Max provider attempts — the A → B → C → D chain length (default 4). */
  attemptsLimit?: number;
  /** Per-call timeout in ms (passed to the provider). */
  timeoutMs?: number;
}

export const DEFAULT_ATTEMPTS_LIMIT = 4; // A → B → C → D

let defaultPersistencePromise: Promise<AiPersistence> | null = null;
async function loadDefaultPersistence(): Promise<AiPersistence> {
  if (!defaultPersistencePromise) {
    defaultPersistencePromise = import("./persistence").then((m) => m.prismaAiPersistence);
  }
  return defaultPersistencePromise;
}

async function resolvePersistence(opts?: ExecuteOptions): Promise<AiPersistence | null> {
  if (opts?.persistence) return opts.persistence;
  // Lazy default so the pure fallback logic never touches Prisma in tests.
  return loadDefaultPersistence();
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function attemptStatus(r: ProviderCallResult): Exclude<AiResultStatus, "not_connected"> {
  return r.status;
}

function toAiAttempt(providerId: string, model: string | null, r: ProviderCallResult): AiAttempt {
  return {
    provider: providerId,
    model,
    status: attemptStatus(r),
    latencyMs: r.latencyMs ?? null,
    costEstimate: r.costEstimate ?? null,
    error: r.error ?? null,
    providerRequestId: r.providerRequestId ?? null,
    at: new Date().toISOString(),
  };
}

/**
 * Env var NAMES (never values) that would enable a capability. Derived — not
 * hard-coded — from the provider env-key registry plus the capability→provider
 * slot table, so this list can never name a variable no code reads.
 * Empty means no provider slot serves the capability: there is nothing to set.
 */
export function requiredEnvFor(capability: AiTask["capability"]): string[] {
  return capabilityEnvNames(capability);
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

export async function execute(userId: string, task: AiTask, opts: ExecuteOptions = {}): Promise<AiResult> {
  const persistence = await resolvePersistence(opts);
  const attemptsLimit = opts.attemptsLimit ?? DEFAULT_ATTEMPTS_LIMIT;
  const base: AiResult = {
    status: "failed",
    capability: task.capability,
    taskType: task.type,
    attempts: [],
  };

  // Derived ONCE, from the capability registry — the env var NAMES that would
  // enable this capability. Every non-ok result carries them, so no surface can
  // fall back to "no provider slot is registered for this capability" for a
  // capability that HAS a slot: that false line was printed for a keyed step in
  // which a configured, wired provider was reached and answered http 401.
  const capabilityEnv = requiredEnvFor(task.capability);

  const ctx: TaskContext = {
    plan: "FREE",
    videoType: task.params?.videoType,
    resolution: task.params?.resolution,
    language: task.params?.language ?? task.params?.targetLanguage,
    requirements: task.params?.requirements,
    ...(opts.context ?? {}),
  };

  // User plan from persistence when available (tenant-scoped, non-fatal).
  if (!opts.context?.plan && persistence?.getUserPlan) {
    try {
      const plan = await persistence.getUserPlan(userId);
      if (plan) ctx.plan = plan;
    } catch {
      /* plan is a scoring hint only — never fails a task */
    }
  }

  // Route over every provider visible in this context. Test stubs exist and
  // are visible ONLY in test mode (CAVS_TEST_MODE=1 / NODE_ENV=test) — they
  // can never be registered, and therefore never appear, in production.
  const all = providersFor(task.capability, { includeTest: testModeEnabled() });
  const candidates = routeTask(task, ctx, all)
    .filter((c) => isProviderReady(c.provider, task.capability))
    .slice(0, attemptsLimit);

  // ---- Not connected: honest result, NO fake generation. -------------------
  if (candidates.length === 0) {
    const requiredEnv = capabilityEnv;
    const message =
      requiredEnv.length > 0
        ? `Provider Not Connected: no provider is configured and wired for capability "${task.capability}". Set one of the required server-side env vars (names only): ${requiredEnv.join(", ")}.`
        : `Provider Not Connected: no provider slot is registered for capability "${task.capability}", so no server-side env var would enable it and none is named.`;
    if (persistence) {
      try {
        await persistence.createProviderLog({
          userId,
          projectId: task.projectId ?? null,
          provider: "none",
          taskType: task.type,
          status: "FAILED",
          durationMs: 0,
          errorMessage: message,
          requestSummary: {
            capability: task.capability,
            taskType: task.type,
            requiredEnv,
            note: "no provider configured — nothing was attempted, nothing simulated",
          },
        });
      } catch {
        /* audit failure must not mask the honest result */
      }
    }
    return {
      ...base,
      status: "not_connected",
      requiredEnv,
      error: message,
    };
  }

  // ---- Real attempts: create the AIGeneration row, walk A → B → C → D. -----
  const top = candidates[0];
  let generationId: string | null = null;
  if (persistence) {
    try {
      const gen = await persistence.createGeneration({
        userId,
        projectId: task.projectId ?? null,
        task,
        provider: top.provider.id,
        model: top.model,
        status: "RUNNING",
      });
      generationId = gen.id;
    } catch (err) {
      return {
        ...base,
        status: "failed",
        requiredEnv: capabilityEnv,
        error: `failed to open AIGeneration audit row: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const attempts: AiAttempt[] = [];
  let totalLatency = 0;
  let totalCost = 0;
  let lastError: string | null = null;

  for (const candidate of candidates) {
    let callResult: ProviderCallResult;
    try {
      callResult = await candidate.provider.call(task, {
        model: candidate.model ?? undefined,
        timeoutMs: opts.timeoutMs,
      });
    } catch (err) {
      // A provider that throws (e.g. unwired slot called by mistake) is a
      // failed attempt — never propagate, never fake success.
      callResult = {
        status: "failed",
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const attempt = toAiAttempt(candidate.provider.id, candidate.model, callResult);
    attempts.push(attempt);
    totalLatency += attempt.latencyMs ?? 0;
    totalCost += attempt.costEstimate ?? 0;
    if (callResult.error) lastError = callResult.error;

    if (persistence) {
      try {
        await persistence.createProviderLog({
          userId,
          projectId: task.projectId ?? null,
          aiGenerationId: generationId,
          provider: candidate.provider.id,
          model: candidate.model,
          taskType: task.type,
          status: callResult.status === "ok" ? "SUCCEEDED" : "FAILED",
          durationMs: attempt.latencyMs ?? null,
          errorMessage: callResult.status === "ok" ? null : callResult.error ?? null,
          requestSummary: { capability: task.capability, params: task.params ?? {} },
          responseSummary: callResult.responseSummary ?? null,
          providerRequestId: callResult.providerRequestId ?? null,
        });
      } catch {
        /* audit failure must not mask the outcome */
      }
    }

    if (callResult.status === "ok") {
      if (persistence && generationId) {
        try {
          await persistence.updateGeneration(generationId, {
            status: "SUCCEEDED",
            provider: candidate.provider.id,
            model: candidate.model,
            resultRefs: callResult.outputRefs ?? null,
            costCredits: totalCost > 0 ? totalCost : null,
            durationMs: totalLatency,
            completedAt: new Date(),
          });
        } catch {
          /* audit failure must not mask success */
        }
      }
      return {
        ...base,
        status: "ok",
        provider: candidate.provider.id,
        model: candidate.model,
        outputRefs: callResult.outputRefs ?? null,
        resultText: callResult.resultText ?? null,
        latencyMs: totalLatency,
        costEstimate: totalCost > 0 ? totalCost : null,
        attempts,
        generationId,
      };
    }
  }

  // ---- All attempts failed: aggregate the most honest status. --------------
  const allRateLimited = attempts.length > 0 && attempts.every((a) => a.status === "rate_limited");
  const allTimeout = attempts.length > 0 && attempts.every((a) => a.status === "timeout");
  const finalStatus: AiResultStatus = allRateLimited ? "rate_limited" : allTimeout ? "timeout" : "failed";

  if (persistence && generationId) {
    try {
      await persistence.updateGeneration(generationId, {
        status: "FAILED",
        provider: top.provider.id,
        model: top.model,
        errorMessage: lastError ?? `all ${attempts.length} provider(s) failed`,
        costCredits: totalCost > 0 ? totalCost : null,
        durationMs: totalLatency,
        completedAt: new Date(),
      });
    } catch {
      /* audit failure must not mask the outcome */
    }
  }

  return {
    ...base,
    status: finalStatus,
    // A real attempt was made and failed, so this result is NOT "not connected":
    // it carries the same derived env names (names only) so every surface can
    // say which key powers the capability instead of "no provider slot is
    // registered" — which would be false exactly when a key is set.
    requiredEnv: capabilityEnv,
    error: lastError ?? `all ${attempts.length} provider(s) failed (A → B → C → D exhausted)`,
    latencyMs: totalLatency,
    costEstimate: totalCost > 0 ? totalCost : null,
    attempts,
    generationId,
  };
}

/**
 * Async path: route + not_connected check, then create the AIGeneration row
 * (QUEUED) and push a BullMQ job onto the "ai" queue. The worker that drains
 * this queue through the orchestrator is wired in a later task.
 */
export async function enqueue(userId: string, task: AiTask, opts: ExecuteOptions = {}): Promise<AiResult> {
  const persistence = await resolvePersistence(opts);
  const base: AiResult = {
    status: "failed",
    capability: task.capability,
    taskType: task.type,
    attempts: [],
  };

  const ctx: TaskContext = {
    plan: "FREE",
    videoType: task.params?.videoType,
    resolution: task.params?.resolution,
    language: task.params?.language ?? task.params?.targetLanguage,
    requirements: task.params?.requirements,
    ...(opts.context ?? {}),
  };

  const all = providersFor(task.capability, { includeTest: testModeEnabled() });
  const candidates = routeTask(task, ctx, all).filter((c) => isProviderReady(c.provider, task.capability));
  if (candidates.length === 0) {
    // Same honest not_connected path as execute() (no AIGeneration row).
    return execute(userId, task, opts);
  }

  const top = candidates[0];

  // AIGeneration row first (status QUEUED) — created only for real work.
  if (persistence) {
    try {
      const gen = await persistence.createGeneration({
        userId,
        projectId: task.projectId ?? null,
        task,
        provider: top.provider.id,
        model: top.model,
        status: "QUEUED",
      });
      // The AIGeneration row id doubles as the BullMQ job id (idempotent retries).
      return await pushJob({ ...base, generationId: gen.id }, gen.id);
    } catch (err) {
      return {
        ...base,
        status: "failed",
        error: `failed to queue task: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  return pushJob(base, crypto.randomUUID());
}

async function pushJob(base: AiResult, generationId: string): Promise<AiResult> {
  try {
    const queue = await import("@/lib/queue");
    const result = await queue.enqueue(queue.QUEUES.ai, "ai-generation", { generationId }, { jobId: generationId });
    if (!result.queued) {
      return {
        ...base,
        status: "failed",
        error: result.reason,
        generationId,
        queued: false,
      };
    }
    return {
      ...base,
      status: "ok",
      queued: true,
      jobId: result.jobId,
      generationId,
    };
  } catch (err) {
    return {
      ...base,
      status: "failed",
      error: `queue unavailable: ${err instanceof Error ? err.message : String(err)}`,
      generationId,
      queued: false,
    };
  }
}
