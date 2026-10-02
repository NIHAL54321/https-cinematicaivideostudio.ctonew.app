/**
 * Provider registry — where providers (real slots + dev-gated test stubs) are
 * registered and looked up by capability. The router and status API read from
 * here; the orchestrator executes through here.
 *
 * Test stubs live in a SEPARATE map and can only be registered when
 * CAVS_TEST_MODE=1 (or NODE_ENV==="test") — they are never visible to the
 * status API, the router default, or any production code path.
 */
import type { AiCapabilityId } from "../types";
import type { AiProvider } from "./types";
import { PROVIDER_SLOTS } from "./slots";

const realProviders = new Map<string, AiProvider>();
const testProviders = new Map<string, AiProvider>();
let seeded = false;

/**
 * Test mode is the ONLY context where test stubs exist and are visible:
 * CAVS_TEST_MODE=1 or NODE_ENV==="test". Production (NODE_ENV=production,
 * no flag) can never see or reach them.
 */
export function testModeEnabled(): boolean {
  return process.env.CAVS_TEST_MODE === "1" || process.env.NODE_ENV === "test";
}

/** Registers the Phase-1 provider slots exactly once (idempotent). */
export function seedDefaultProviders(): void {
  if (seeded) return;
  for (const p of PROVIDER_SLOTS) realProviders.set(p.id, p);
  seeded = true;
}

export interface RegisterOptions {
  /** Register into the dev-gated test map (only allowed in test mode). */
  testOnly?: boolean;
}

export function registerProvider(p: AiProvider, opts: RegisterOptions = {}): void {
  if (opts.testOnly) {
    if (!testModeEnabled()) {
      throw new Error(
        "registerProvider(testOnly) is FORBIDDEN outside test mode — test stub providers must never " +
          "be reachable from the UI or production API routes.",
      );
    }
    testProviders.set(p.id, p);
    return;
  }
  realProviders.set(p.id, p);
}

export function getProvider(id: string, opts: { includeTest?: boolean } = {}): AiProvider | undefined {
  seedDefaultProviders();
  return realProviders.get(id) ?? (opts.includeTest ? testProviders.get(id) : undefined);
}

/** Providers able to serve a capability. Real slots by default. */
export function providersFor(
  capability: AiCapabilityId,
  opts: { includeTest?: boolean } = {},
): AiProvider[] {
  seedDefaultProviders();
  const all = [...realProviders.values(), ...(opts.includeTest ? testProviders.values() : [])];
  return all
    .filter((p) => p.capabilities.includes(capability))
    .sort((a, b) => a.rank - b.rank);
}

export function allProviders(opts: { includeTest?: boolean } = {}): AiProvider[] {
  seedDefaultProviders();
  const all = [...realProviders.values(), ...(opts.includeTest ? testProviders.values() : [])];
  return all.sort((a, b) => a.rank - b.rank);
}

/** Test-mode introspection (used by the dev-gated tests). */
export function registeredTestProviders(): AiProvider[] {
  return [...testProviders.values()].sort((a, b) => a.rank - b.rank);
}
