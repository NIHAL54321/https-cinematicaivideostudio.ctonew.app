/**
 * Generic HTTP provider base — the template every real HTTP-backed provider
 * extends.
 *
 * It implements the fetch mechanics (timeout via AbortController, HTTP status
 * mapping to ok/rate_limited/timeout/failed, latency + cost capture) and reads
 * its keys from server-side env via env-keys.ts. A provider adds:
 *   - buildRequest(task, model)  →  the endpoint it wants to call
 *   - parseResponse(res, task)   →  ProviderCallResult from the raw response
 *
 * The Replicate adapter (replicate.ts) and the OpenAI adapter (openai.ts) are
 * real subclasses of this base — the first supplies both methods for exactly one
 * capability (`video_enhancement`), the second for two (`script_generation` and,
 * since P7-8, `seo_generation`) — each derives its isWired() from its own
 * endpoint table. Every other slot in slots.ts is still a plain slot whose
 * isWired() is false, so the orchestrator never calls them. The base is fully
 * tested by the dev-gated stub tests.
 */
import type { AiCapabilityId, AiTask } from "../types";
import {
  type AiProvider,
  type ProviderCallResult,
  type ProviderCallStatus,
  type ProviderMetadata,
  ProviderNotWiredError,
} from "./types";
import { providerEnvConfigured, providerRequiredEnv } from "./env-keys";

export interface HttpEndpoint {
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  headers?: Record<string, string>;
  /** JSON body (stringified automatically). */
  body?: unknown;
}

export interface HttpProviderConfig {
  id: string;
  name: string;
  capabilities: readonly AiCapabilityId[];
  rank: number;
  metadata: ProviderMetadata;
  baseUrl: string;
  /** Default headers merged into every request (e.g. Authorization). */
  defaultHeaders?: Record<string, string>;
  /** Override isConfigured() (e.g. sub-resource needs a different key). */
  isConfigured?: () => boolean;
  /** Default per-call timeout in ms. */
  defaultTimeoutMs?: number;
  buildRequest(task: AiTask, model: string | null): Promise<HttpEndpoint> | HttpEndpoint;
  parseResponse(res: Response, task: AiTask, endpoint: HttpEndpoint): Promise<Partial<ProviderCallResult>>;
  /** Default model per capability (fallback for the router). */
  modelFor?(capability: AiCapabilityId): string | null;
}

/** Maps an HTTP status to an honest attempt outcome. */
export function mapHttpStatus(status: number): ProviderCallStatus {
  if (status >= 200 && status < 300) return "ok";
  if (status === 429 || status === 408) return status === 408 ? "timeout" : "rate_limited";
  if (status >= 500) return "failed";
  if (status === 401 || status === 403) return "failed";
  return "failed";
}

export class HttpProviderBase implements AiProvider {
  readonly id: string;
  readonly name: string;
  readonly capabilities: readonly AiCapabilityId[];
  readonly rank: number;
  readonly metadata: ProviderMetadata;
  protected readonly config: HttpProviderConfig;
  private readonly envKeys: string[];

  constructor(config: HttpProviderConfig) {
    this.config = config;
    this.id = config.id;
    this.name = config.name;
    this.capabilities = config.capabilities;
    this.rank = config.rank;
    this.metadata = config.metadata;
    this.envKeys = providerRequiredEnv(config.id);
  }

  isConfigured(): boolean {
    if (this.config.isConfigured) return this.config.isConfigured();
    return providerEnvConfigured(this.id);
  }

  /**
   * The capabilities this provider has a REAL endpoint + input mapping for.
   * A subclass declares them here; the base verifies the pair exists.
   */
  protected implementedCapabilities(): readonly AiCapabilityId[] {
    return [];
  }

  /**
   * Wired = a real buildRequest/parseResponse pair exists, for this capability.
   *
   * Derived, never flagged: this returns true only when the subclass has
   * declared implemented capability AND the config actually carries both
   * functions. A slot that merely claims to be wired (a boolean constant, or an
   * empty/absent pair) cannot make this true.
   */
  isWired(capability?: AiCapabilityId): boolean {
    const implemented = this.implementedCapabilities();
    if (implemented.length === 0) return false;
    if (typeof this.config.buildRequest !== "function") return false;
    if (typeof this.config.parseResponse !== "function") return false;
    return capability ? implemented.includes(capability) : true;
  }

  requiredEnv(): string[] {
    return this.envKeys;
  }

  modelFor(capability: AiCapabilityId): string | null {
    return this.config.modelFor?.(capability) ?? null;
  }

  async call(task: AiTask, options?: { model?: string; signal?: AbortSignal; timeoutMs?: number }): Promise<ProviderCallResult> {
    if (!this.isWired(task.capability)) {
      // Defense in depth: the orchestrator filters on isProviderReady(), so
      // an unwired slot should never reach call(). If it somehow does, fail
      // honestly instead of pretending.
      throw new ProviderNotWiredError(this.id, task.capability);
    }
    const model = options?.model ?? this.modelFor(task.capability);
    const timeoutMs = options?.timeoutMs ?? this.config.defaultTimeoutMs ?? 120_000;

    let endpoint: HttpEndpoint;
    try {
      endpoint = await this.config.buildRequest(task, model);
    } catch (err) {
      return {
        status: "failed",
        error: `request build failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = () => controller.abort();
    options?.signal?.addEventListener("abort", onOuterAbort, { once: true });

    const startedAt = Date.now();
    let res: Response | null = null;
    let networkError: string | null = null;
    try {
      res = await fetch(endpoint.url, {
        method: endpoint.method,
        headers: {
          "content-type": "application/json",
          ...this.config.defaultHeaders,
          ...endpoint.headers,
        },
        body: endpoint.body !== undefined ? JSON.stringify(endpoint.body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      networkError = err instanceof Error ? err.message : String(err);
    } finally {
      clearTimeout(timer);
      options?.signal?.removeEventListener("abort", onOuterAbort);
    }
    const latencyMs = Date.now() - startedAt;

    if (!res) {
      const timedOut = controller.signal.aborted || /abort/i.test(networkError ?? "");
      return {
        status: timedOut ? "timeout" : "failed",
        latencyMs,
        error: timedOut ? `request timed out after ${timeoutMs}ms` : `network error: ${networkError}`,
      };
    }

    const status = mapHttpStatus(res.status);
    const base: ProviderCallResult = { status, latencyMs };
    if (status === "ok") {
      try {
        const parsed = await this.config.parseResponse(res, task, endpoint);
        return { ...base, ...parsed };
      } catch (err) {
        return {
          ...base,
          status: "failed",
          error: `response parse failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    }
    // Non-2xx: read a short error body for the audit trail (never the full payload).
    let detail = `http ${res.status}`;
    try {
      const text = await res.text();
      if (text) detail = `${detail}: ${text.slice(0, 300)}`;
    } catch {
      /* ignore body read errors */
    }
    return {
      ...base,
      error: detail,
      responseSummary: { httpStatus: res.status },
    };
  }
}
