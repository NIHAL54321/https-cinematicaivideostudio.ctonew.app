/**
 * Unsplash stock-media adapter.
 *
 * Reads UNSPLASH_ACCESS_KEY from server env. When present, search() calls the
 * real Unsplash Search API and returns real photo assets with attribution /
 * license metadata. When absent it returns an honest { status: "not_connected" }.
 *
 * Unsplash License: free to use, attribution not legally required but strongly
 * appreciated — we capture the photographer + author URL so attribution is
 * always available. Unsplash exposes photos only (no video search API), so a
 * video request returns an explicit "unsupported" error rather than fabricating.
 */
import { providerEnvConfigured, providerRequiredEnv, readEnvVar } from "@/lib/ai/providers/env-keys";
import type { MediaProviderQuery, ProviderAsset, StockProvider, StockSearchResponse } from "../types";

const API = "https://api.unsplash.com";

interface UnsplashResult {
  results: {
    id: string;
    width: number;
    height: number;
    urls: { raw: string; full: string; regular: string; small: string; thumb: string };
    user: { name: string; links: { html: string } };
    description: string | null;
    alt_description: string | null;
    links: { html: string };
  }[];
}

async function unsplashFetch(query: string, count: number): Promise<UnsplashResult> {
  const res = await fetch(
    `${API}/search/photos?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`,
    { headers: { Authorization: `Client-ID ${readEnvVar("UNSPLASH_ACCESS_KEY")}` } },
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`unsplash http ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as UnsplashResult;
}

function toAsset(
  r: UnsplashResult["results"][number],
): ProviderAsset {
  return {
    provider: "unsplash",
    externalId: r.id,
    title: r.alt_description || r.description || `Unsplash photo ${r.id}`,
    mediaType: "image",
    url: r.urls.full,
    previewUrl: r.urls.regular,
    thumbUrl: r.urls.small,
    width: r.width,
    height: r.height,
    author: r.user?.name || "Unknown",
    authorUrl: r.user?.links?.html,
    pageUrl: r.links?.html,
    license: {
      type: "ROYALTY_FREE",
      source: "Unsplash",
      attributionRequired: false, // appreciated, not required
      attribution: `${r.user?.name || "Unsplash"} / Unsplash`,
      licenseUrl: "https://unsplash.com/license",
    },
    score: 0.5,
  };
}

export const unsplash: StockProvider = {
  id: "unsplash",
  name: "Unsplash",
  supports: ["image"], // photos only
  rank: 2, // B — fallback after pexels
  isConfigured: () => providerEnvConfigured("unsplash"),
  requiredEnv: () => providerRequiredEnv("unsplash"),
  async search(query: MediaProviderQuery): Promise<StockSearchResponse> {
    if (!providerEnvConfigured("unsplash")) {
      return { status: "not_connected", requiredEnv: providerRequiredEnv("unsplash") };
    }
    if (query.mediaType === "video") {
      return {
        status: "error",
        message: "unsplash does not provide a video search API (images only).",
      };
    }
    const count = Math.min(query.count ?? 12, 30);
    try {
      const data = await unsplashFetch(query.query, count);
      return { status: "ok", results: data.results.map(toAsset) };
    } catch (err) {
      return {
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
