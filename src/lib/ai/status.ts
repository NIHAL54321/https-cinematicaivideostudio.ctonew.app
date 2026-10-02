/**
 * Per-capability connectivity — the honest status surface consumed by
 * GET /api/ai/status and (indirectly, through that API) the AI studio pages.
 *
 * A capability is "connected" only when at least one provider that serves it
 * is configured (env keys present) AND wired (a real call() implementation —
 * Phase 2+). In Phase 1 every capability reports not_connected with its
 * required env var names; nothing is ever implied to work.
 */
import { AI_CAPABILITIES, CAPABILITY_LABELS, type AiCapabilityId } from "./types";
import { allProviders, providersFor } from "./providers/registry";

export interface CapabilityProviderState {
  id: string;
  name: string;
  rank: number;
  configured: boolean; // env keys present
  wired: boolean; // real call() implementation present
}

export interface CapabilityStatusInfo {
  capability: AiCapabilityId;
  label: string;
  status: "connected" | "not_connected";
  /** Env var names (never values) that would enable this capability. */
  requiredEnv: string[];
  providers: CapabilityProviderState[];
}

export function capabilityStatus(capability: AiCapabilityId): CapabilityStatusInfo {
  const providers = providersFor(capability);
  const requiredEnv = [...new Set(providers.flatMap((p) => p.requiredEnv()))].sort();
  const connected = providers.some((p) => p.isConfigured() && p.isWired());
  return {
    capability,
    label: CAPABILITY_LABELS[capability],
    status: connected ? "connected" : "not_connected",
    requiredEnv,
    providers: providers.map((p) => ({
      id: p.id,
      name: p.name,
      rank: p.rank,
      configured: p.isConfigured(),
      wired: p.isWired(),
    })),
  };
}

export function allCapabilityStatus(): CapabilityStatusInfo[] {
  // Ensure slots are registered (idempotent) before reporting.
  void allProviders();
  return AI_CAPABILITIES.map((c) => capabilityStatus(c));
}
