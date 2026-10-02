/**
 * Stock-media provider registry — the provider-independent abstraction.
 *
 * Mirrors the AI provider pattern: a registry of StockProvider adapters with
 * A→B→C fallback ordering (rank). New providers are added here (and in
 * .env.example) — nothing else in the engine needs to change.
 */
import type { MediaProviderQuery, StockProvider, StockSearchResponse } from "../types";
import { pexels } from "./pexels";
import { unsplash } from "./unsplash";

/** All registered stock providers, ordered by rank (A first). */
export const STOCK_PROVIDERS: StockProvider[] = [pexels, unsplash].sort((a, b) => a.rank - b.rank);

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
