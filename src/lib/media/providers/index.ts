/**
 * Stock-media provider registry — the provider-independent abstraction.
 *
 * Mirrors the AI provider pattern: a registry of StockProvider adapters with
 * A→B→C fallback ordering (rank). New providers are added here (and in
 * .env.example) — nothing else in the engine needs to change.
 */
import type { MediaProviderQuery, StockProvider, StockSearchResponse } from "../types";
import { pexels } from "./pexels";
import { pixabay } from "./pixabay";
import { unsplash } from "./unsplash";

/** All registered stock providers, ordered by rank (A first). */
export const STOCK_PROVIDERS: StockProvider[] = [pexels, pixabay, unsplash].sort((a, b) => a.rank - b.rank);

/** Providers that currently have their env keys set. */
export function getConfiguredStockProviders(): StockProvider[] {
  return STOCK_PROVIDERS.filter((p) => p.isConfigured());
}

export function stockProviderById(id: string): StockProvider | undefined {
  return STOCK_PROVIDERS.find((p) => p.id === id);
}

/** The env var NAMES that enable each provider (values never returned). */
export function stockProviderEnvHints(): { id: string; name: string; requiredEnv: string[] }[] {
  return STOCK_PROVIDERS.map((p) => ({ id: p.id, name: p.name, requiredEnv: p.requiredEnv() }));
}

/**
 * ── THE status source for every surface that talks about stock availability ──
 * Phase 8 truthful-surfaces block, 2026-11-09.
 *
 * The Media Library's banner used to answer a different question from the one a
 * search asks: it fired `GET /api/media?q=…` with no `mediaType`, so the route
 * fell through to its image default and reported the IMAGE providers' env names
 * (PEXELS_API_KEY / UNSPLASH_ACCESS_KEY) as "Stock Provider Not Connected" —
 * while the same server answered a real Pixabay VIDEO search with 200 and real
 * candidates, and the library listed Pixabay assets on the same screen.
 *
 * This function is the single answer. `isConfigured()` is the SAME predicate
 * `searchAllStockProviders()` uses to decide which providers it will call, so a
 * provider can never be "available" here and skipped there (or the reverse).
 *
 * `configured` means "this server holds the env var" — nothing more. Whether the
 * provider actually answers is not knowable from an env var, so the status route
 * asks it (see /api/media/status, which runs a real probe search). Availability
 * is observed, never assumed.
 */
export interface StockProviderAvailability {
  id: string;
  name: string;
  configured: boolean;
  /** The media types this provider's adapter can search (e.g. ["video"]). */
  mediaTypes: string[];
  requiredEnv: string[];
}

export interface StockAvailability {
  providers: StockProviderAvailability[];
  connected: StockProviderAvailability[];
  missing: StockProviderAvailability[];
  /** Media types at least one configured provider can search. */
  connectedMediaTypes: string[];
}

export function stockProviderAvailability(): StockAvailability {
  const providers: StockProviderAvailability[] = STOCK_PROVIDERS.map((p) => ({
    id: p.id,
    name: p.name,
    configured: p.isConfigured(),
    mediaTypes: [...p.supports],
    requiredEnv: p.requiredEnv(),
  }));
  const connected = providers.filter((p) => p.configured);
  const missing = providers.filter((p) => !p.configured);
  const connectedMediaTypes = [...new Set(connected.flatMap((p) => p.mediaTypes))];
  return { providers, connected, missing, connectedMediaTypes };
}


/**
 * Run a search across every configured provider that supports the requested
 * media type, in A→B fallback order. Unconfigured providers are skipped (they
 * would only report "not_connected"). Returns one response per provider.
 */
export async function searchAllStockProviders(
  query: MediaProviderQuery,
  opts?: { signal?: AbortSignal },
): Promise<StockSearchResponse[]> {
  const results: StockSearchResponse[] = [];
  const eligible = STOCK_PROVIDERS.filter(
    (p) => p.isConfigured() && p.supports.includes(query.mediaType),
  );
  for (const provider of eligible) {
    try {
      results.push(await provider.search(query, opts));
    } catch (err) {
      results.push({
        status: "error",
        message: `${provider.id}: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  if (results.length === 0) {
    // Honest "not connected" for the whole request when nothing is configured.
    const present = STOCK_PROVIDERS.filter((p) => p.supports.includes(query.mediaType));
    const requiredEnv = [...new Set(present.flatMap((p) => p.requiredEnv()))];
    results.push({ status: "not_connected", requiredEnv });
  }
  return results;
}
