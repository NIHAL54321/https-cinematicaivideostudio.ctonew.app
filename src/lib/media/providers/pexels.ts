/**
 * Pexels stock-media adapter.
 *
 * Reads PEXELS_API_KEY from server env. When present, search() calls the real
 * Pexels API and returns real assets with their license/attribution metadata.
 * When absent, search() returns an honest { status: "not_connected" } — it
 * NEVER fabricates results.
 *
 * Pexels License: free to use for commercial & personal, no attribution
 * required (though attribution is appreciated). Env key name only — the value
 * never leaves the server.
 */
import { providerEnvConfigured, providerRequiredEnv, readEnvVar } from "@/lib/ai/providers/env-keys";
import type { MediaProviderQuery, ProviderAsset, StockProvider, StockSearchResponse } from "../types";

const API = "https://api.pexels.com";

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_url: string;
  alt: string;
  src: {
    original: string;
    large2x: string;
    large: string;
    medium: string;
    small: string;
    portrait: string;
    landscape: string;
    tiny: string;
  };
}
interface PexelsVideoFile {
  link: string;
  width: number;
  height: number;
  quality: string;
  file_type: string;
}
interface PexelsVideo {
  id: number;
  width: number;
  height: number;
  url: string;
  image: string;
  duration: number;
  video_files: PexelsVideoFile[];
  user: { name: string; url: string };
}

async function pexelsFetch<T>(path: string, query: string, count: number): Promise<T> {
  const res = await fetch(`${API}${path}?query=${encodeURIComponent(query)}&per_page=${count}&orientation=landscape`, {
    headers: { Authorization: readEnvVar("PEXELS_API_KEY") },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`pexels http ${res.status}: ${body.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

function tagMediaType(mediaType: MediaProviderQuery["mediaType"]): "image" | "video" {
  return mediaType === "video" ? "video" : "image";
}

function toAsset(p: PexelsPhoto): ProviderAsset {
  return {
    provider: "pexels",
    externalId: String(p.id),
    title: p.alt || `Pexels photo ${p.id}`,
    mediaType: "image",
    url: p.src.original,
    previewUrl: p.src.large,
    thumbUrl: p.src.small,
    width: p.width,
    height: p.height,
    author: p.photographer || "Unknown",
    authorUrl: p.photographer_url,
    pageUrl: p.url,
    license: {
      type: "ROYALTY_FREE",
      source: "Pexels",
      attributionRequired: false,
      attribution: `${p.photographer || "Pexels"} via Pexels`,
      licenseUrl: "https://www.pexels.com/license/",
    },
    score: 0.5,
  };
}

function videoToAsset(v: PexelsVideo): ProviderAsset {
  const file = [...v.video_files].sort((a, b) => b.width - a.width)[0];
  return {
    provider: "pexels",
    externalId: String(v.id),
    title: `Pexels video ${v.id}`,
    mediaType: "video",
    url: file?.link ?? v.video_files[0]?.link ?? "",
    previewUrl: v.image,
    thumbUrl: v.image,
    width: v.width,
    height: v.height,
    durationSeconds: v.duration,
    author: v.user?.name ?? "Unknown",
    authorUrl: v.user?.url,
    pageUrl: v.url,
    license: {
      type: "ROYALTY_FREE",
      source: "Pexels",
      attributionRequired: false,
      attribution: `${v.user?.name ?? "Pexels"} via Pexels`,
      licenseUrl: "https://www.pexels.com/license/",
    },
    score: 0.5,
  };
}

export const pexels: StockProvider = {
  id: "pexels",
  name: "Pexels",
  supports: ["image", "video"],
  rank: 1, // A — preferred stock source
  isConfigured: () => providerEnvConfigured("pexels"),
  requiredEnv: () => providerRequiredEnv("pexels"),
  async search(query: MediaProviderQuery): Promise<StockSearchResponse> {
    if (!this.isConfigured) {
      return { status: "not_connected", requiredEnv: providerRequiredEnv("pexels") };
    }
    const count = Math.min(query.count ?? 12, 80);
    try {
      const kind = tagMediaType(query.mediaType);
      if (kind === "video") {
        const data = await pexelsFetch<{ videos: PexelsVideo[] }>("/videos/search", query.query, count);
        return { status: "ok", results: data.videos.map(videoToAsset) };
      }
      const data = await pexelsFetch<{ photos: PexelsPhoto[] }>("/v1/search", query.query, count);
      return { status: "ok", results: data.photos.map(toAsset) };
    } catch (err) {
      return {
        status: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
