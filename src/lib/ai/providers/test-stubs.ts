/**
 * DEV-GATED TEST STUBS — mechanism tests for the A → B → C → D fallback.
 *
 * These providers deliberately fail (or succeed) on command to prove the
 * orchestrator's fallback ordering and honest result assembly. They are
 * HARD-GATED: registerTestStubs() throws unless CAVS_TEST_MODE=1 or
 * NODE_ENV==="test", and they live in the registry's test-only map which the
 * status API, the router default, and all production routes never see.
 *
 * This is a mechanism test — NOT fake user-facing AI.
 */
import type { AiCapabilityId, AiTask } from "../types";
import type { AiProvider, ProviderCallResult, ProviderCallStatus } from "./types";
import { isProviderReady } from "./types";
import { registerProvider, testModeEnabled } from "./registry";

export type StubBehavior =
  | { mode: "ok" }
  | { mode: "fail"; error?: string }
  | { mode: "rate_limited"; error?: string }
  | { mode: "timeout"; error?: string };

export interface TestStubConfig {
  id: string;
  name: string;
  capabilities: readonly AiCapabilityId[];
  rank: number;
  behavior: StubBehavior | ((task: AiTask) => StubBehavior);
}

export function makeTestStub(cfg: TestStubConfig): AiProvider {
  return {
    id: cfg.id,
    name: cfg.name,
    capabilities: cfg.capabilities,
    rank: cfg.rank,
    metadata: { quality: 0.5, speed: 0.5, cost: 0.5 },
    isConfigured: () => true,
    isWired: () => true, // stubs are fully "wired" so the orchestrator attempts them
    requiredEnv: () => [],
    modelFor: () => `${cfg.id}-model`,
    call: async (task: AiTask): Promise<ProviderCallResult> => {
      const behavior = typeof cfg.behavior === "function" ? cfg.behavior(task) : cfg.behavior;
      if (behavior.mode === "ok") {
        return { status: "ok", outputRefs: { provider: cfg.id, resultText: `ok from ${cfg.id}` }, latencyMs: 5 };
      }
      const status: ProviderCallStatus =
        behavior.mode === "rate_limited" ? "rate_limited" : behavior.mode === "timeout" ? "timeout" : "failed";
      return { status, error: behavior.error ?? `${cfg.id} failed deliberately`, latencyMs: 5 };
    },
  };
}

/** Ensure the guard itself is airtight: stubs must never escape test mode. */
export function assertTestModeEnabled(): void {
  if (!testModeEnabled()) {
    throw new Error(
      "Test stubs must never be registered outside test mode (CAVS_TEST_MODE=1 or NODE_ENV=test). " +
        "This is a hard guard — production must never see these providers.",
    );
  }
}

export function registerTestStubs(stubs: AiProvider[]): void {
  assertTestModeEnabled();
  for (const s of stubs) registerProvider(s, { testOnly: true });
}

export { isProviderReady };
