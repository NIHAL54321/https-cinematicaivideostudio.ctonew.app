/**
 * Provider abstraction — the contract every AI provider (30+ eventually)
 * implements to plug into the orchestrator.
 *
 * A provider declares which capabilities it can serve, its env-key
 * configuration state (server-side only), its global rank (tie-break
 * preference), scoring metadata, and the async call() that performs one
 * attempt. The task router turns this into an ordered A → B → C → D chain.
 */
import type { AiCapabilityId, AiTask } from "../types";

export interface ProviderCallOptions {
  /** Model override (router-selected by default). */
  model?: string;
  /** Abort signal (timeout is managed by the orchestrator). */
  signal?: AbortSignal;
  /** Per-call timeout in ms (defaults are provider-specific). */
  timeoutMs?: number;
}

/** Fine-grained outcome of ONE provider attempt. */
export type ProviderCallStatus = "ok" | "failed" | "rate_limited" | "timeout";

export interface ProviderCallResult {
  status: ProviderCallStatus;
  /** Structured output refs ({ assetId, externalId, url, resultText, ... }). */
  outputRefs?: Record<string, unknown> | null;
  /** Convenience text output for language capabilities. */
  resultText?: string | null;
  latencyMs?: number | null;
  /** Estimated cost in credits (0..n). */
  costEstimate?: number | null;
  /** Provider-side request id, when available. */
  providerRequestId?: string | null;
  /** Human-readable error (status !== "ok"). */
  error?: string | null;
  /** Truncated/redacted response summary for the audit log. */
  responseSummary?: Record<string, unknown> | null;
}

/** Scoring metadata used by the task router (all 0..1, higher = better). */
export interface ProviderMetadata {
  /** Output quality for the provider's capabilities. */
  quality: number;
  /** Relative speed (latency). */
  speed: number;
  /** Relative cost (higher = cheaper). */
  cost: number;
  /** Maximum output resolution as "WxH", e.g. "3840x2160" (undefined = unknown/low). */
  maxResolution?: string;
  /** ISO language codes the provider supports (undefined = assumed all). */
  supportedLanguages?: string[];
  /** Feature flags: "consistent_characters", "no_watermark", "voice_cloning", ... */
  features?: string[];
}

export interface AiProvider {
  /** Stable id, e.g. "openai". */
  readonly id: string;
  /** Display name, e.g. "OpenAI". */
  readonly name: string;
  /** Capabilities this provider can serve. */
  readonly capabilities: readonly AiCapabilityId[];
  /** Global preference rank — lower wins ties in the router (A before B). */
  readonly rank: number;
  /** Scoring metadata for the router. */
  readonly metadata: ProviderMetadata;

  /** True when the server-side env keys are present. */
  isConfigured(): boolean;
  /**
   * True when a REAL call() implementation exists.
   *
   * Capability-scoped, because a provider can genuinely implement some of its
   * advertised capabilities and not others: Replicate's adapter implements
   * `video_enhancement` and nothing else, OpenAI's implements `script_generation`
   * and `seo_generation` (P7-8) and nothing else — each is wired for exactly the
   * capabilities it implements and unwired for the rest of the capabilities it
   * advertises. Called with no argument it answers the
   * weaker question "is this provider wired for ANY capability?" (used only for
   * display); the router and the orchestrator always pass the capability they
   * are about to attempt.
   *
   * A plain slot built by `slot()` answers false for everything; it is a
   * registered provider with no implementation, and this predicate must never
   * be made true by flipping a flag.
   */
  isWired(capability?: AiCapabilityId): boolean;
  /** The env var names that enable this provider (names only — never values). */
  requiredEnv(): string[];
  /** Default model for a capability this provider serves (null = n/a). */
  modelFor(capability: AiCapabilityId): string | null;
  /** Perform one attempt. Must never fake a result — throw on failure. */
  call(task: AiTask, options?: ProviderCallOptions): Promise<ProviderCallResult>;
}

/**
 * A provider is usable when configured AND wired (never attempted otherwise).
 * Pass the capability being attempted so a provider that is wired for only some
 * of its capabilities is attempted only for those.
 */
export function isProviderReady(p: AiProvider, capability?: AiCapabilityId): boolean {
  return p.isConfigured() && p.isWired(capability);
}

/** Thrown by Phase-1 slots when call() is invoked before real wiring lands. */
export class ProviderNotWiredError extends Error {
  constructor(providerId: string, capability: string) {
    super(
      `Provider "${providerId}" is registered for capability "${capability}" but is not wired yet — ` +
        `no API integration is wired for it in this build. Nothing was simulated or called.`,
    );
    this.name = "ProviderNotWiredError";
  }
}
