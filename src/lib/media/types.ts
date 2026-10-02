/**
 * Phase 3 — Media Sources & Stock Footage Engine: shared types.
 *
 * These types describe the PROVIDER-INDEPENDENT stock-media abstraction and
 * the structured semantic query a Scene is turned into. Nothing here fakes AI:
 * a provider either returns real assets from its HTTP API, or reports an honest
 * "not_connected" state with the env vars that would enable it.
 */
import type { LicenseType } from "@prisma/client";

/** The media categories we can search stock for. */
export type StockMediaType = "image" | "video" | "audio";

/** Orientation hint that maps to per-provider orientation params. */
export type SearchOrientation = "landscape" | "portrait" | "square";

/**
 * A normalized stock asset returned by a provider adapter. All adapters must
 * map their real API response onto this shape so the rest of the engine (and
 * the persistence layer) is provider-agnostic. `score` is a 0–1 relevance that
 * providers may set; it is distinct from our deterministic rank.
 */
export interface ProviderAsset {
  provider: string; // provider id, e.g. "pexels"
  externalId: string; // provider-side asset id
  title: string;
  mediaType: "image" | "video";
  /** Direct media file URL (image binary or video file). */
  url: string;
  /** Optional lighter-weight preview / thumbnail URL. */
  previewUrl?: string;
  thumbUrl?: string;
  width: number;
  height: number;
  durationSeconds?: number;
  author: string;
  authorUrl?: string;
  pageUrl?: string;
  license: {
    type: LicenseType;
    source: string;
    attributionRequired: boolean;
    attribution: string;
    licenseUrl: string;
  };
  score?: number; // 0–1 from the provider (optional)
  metadata?: Record<string, unknown>;
}

/** Settings a provider adapter receives for a single search call. */
export interface MediaProviderQuery {
  /** The natural-language / keyword query assembled by the semantic builder. */
  query: string;
  mediaType: StockMediaType;
  orientation?: SearchOrientation;
  durationSeconds?: number;
  count?: number; // requested result count
}

/**
 * Result of one provider search call. Adapters ALWAYS return one of these —
 * they never throw for an unconfigured provider, and they never fabricate
 * results. `not_connected` is the honest state when the provider's env keys
 * are absent (values never returned — only names).
 */
export type StockSearchResponse =
  | { status: "ok"; results: ProviderAsset[] }
  | { status: "not_connected"; requiredEnv: string[] }
  | { status: "error"; message: string };

/**
 * The provider-independent stock-media abstraction, mirroring the AI provider
 * pattern in src/lib/ai. Implement one per stock provider and register it in
 * providers/index.ts.
 */
export interface StockProvider {
  readonly id: string;
  readonly name: string;
  /** Media categories this provider can serve. */
  readonly supports: readonly StockMediaType[];
  /** Preference rank — lower wins the A→B fallback order. */
  readonly rank: number;
  /** True when the server-side env keys are present. */
  isConfigured(): boolean;
  /** Env var NAMES that enable this provider (never values). */
  requiredEnv(): string[];
  /**
   * Perform one real search. Throws only on genuine unexpected failure; an
   * unconfigured provider returns { status: "not_connected" }.
   */
  search(query: MediaProviderQuery, opts?: { signal?: AbortSignal }): Promise<StockSearchResponse>;
}

/** A search outcome returned by the /api/media endpoint. */
export type MediaSearchOutcome =
  | { status: "ok"; candidates: ProviderAsset[] }
  | {
      status: "not_connected";
      requiredEnv: string[];
      providers: { id: string; name: string; requiredEnv: string[] }[];
    };
