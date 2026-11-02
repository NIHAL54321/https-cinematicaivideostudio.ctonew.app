/**
 * Pixabay stock-media adapter — VIDEOS.
 *
 * Reads PIXABAY_API_KEY from server env. When present, search() calls the real
 * Pixabay API (https://pixabay.com/api/videos/) and returns real video assets
 * with their licence / attribution metadata. When absent, search() returns an
 * honest { status: "not_connected" } naming the env var — it NEVER fabricates
 * results, and a non-200 from Pixabay becomes an honest error string rather
 * than a silent empty list.
 *
 * ── What was READ to write the metadata below (nothing here is assumed) ──────
 * 1. https://pixabay.com/api/docs/ (Pixabay's own API documentation):
 *    - "Our API is a RESTful interface for searching and retrieving royalty-free
 *      images and videos released by Pixabay under the Content License", where
 *      the words "Content License" link to /service/terms/.
 *    - `Search Videos — GET https://pixabay.com/api/videos/` with parameters
 *      key (required), q, lang, id, video_type, category, min_width, min_height,
 *      editors_choice, safesearch, order, page, per_page (accepted 3–200).
 *      NOTE: the videos endpoint documents NO orientation parameter (only the
 *      image endpoint does), so this adapter does not send one and does not
 *      claim to have filtered by orientation.
 *    - The video response fields: id, pageURL, type, tags, duration,
 *      videos.{large,medium,small,tiny}.{url,width,height,size,thumbnail},
 *      views, downloads, likes, comments, user_id, user, userImageURL.
 *    - "user_id, user — User ID and name of the contributor. Profile URL:
 *      https://pixabay.com/users/{USERNAME}-{ID}/" — the authorUrl below is
 *      built from that documented pattern, not guessed.
 * 2. https://pixabay.com/service/license-summary/ ("Content License Summary",
 *    read 2026-11-02): "Use Content for free"; "Use Content without having to
 *    attribute the author (although giving credit is always appreciated by our
 *    community!)"; "Modify or adapt Content into new works". It also says "only
 *    the full Content License is legally binding", and the full licence lives at
 *    https://pixabay.com/service/terms/ — which is the URL stored below.
 *    The same summary's Prohibited Uses include "You cannot sell or distribute
 *    Content (either in digital or physical form) on a Standalone basis"
 *    (standalone = unchanged, no creative effort applied). That is a fact about
 *    the licence, recorded here; this adapter does not and cannot enforce it.
 *
 * So the licence recorded for every Pixabay hit is: name "Pixabay Content
 * License", URL https://pixabay.com/service/terms/, attribution NOT required
 * (recorded anyway, because the licence says credit is appreciated), and
 * LicenseType ROYALTY_FREE — Pixabay's own word for its content in the API docs.
 * The licence NAME has no column of its own in LicensingMetadata (same as Pexels
 * and Unsplash today); it is carried in `metadata.pixabay.licenceName` on the
 * returned asset and in this comment.
 *
 * ── Key handling ────────────────────────────────────────────────────────────
 * The key value is read per call from process.env, put ONLY into the outgoing
 * request URL, and never logged, never returned and never embedded in an error
 * message. `describeHttpFailure` deliberately reports the endpoint path and the
 * status, never the full request URL (which contains the key).
 */
import { providerEnvConfigured, providerRequiredEnv, readEnvVar } from "@/lib/ai/providers/env-keys";
import type { MediaProviderQuery, ProviderAsset, StockProvider, StockSearchResponse } from "../types";

const API = "https://pixabay.com/api/videos/";

/** The four renditions Pixabay documents, largest first in practice. */
const RENDITIONS = ["large", "medium", "small", "tiny"] as const;
type Rendition = (typeof RENDITIONS)[number];

interface PixabayVideoFile {
  url: string;
  width: number;
  height: number;
  size: number;
  thumbnail: string;
}

interface PixabayVideo {
  id: number;
  pageURL?: string;
  type?: string;
  tags?: string;
  duration?: number;
  videos?: Partial<Record<Rendition, PixabayVideoFile>>;
  views?: number;
  downloads?: number;
  likes?: number;
  comments?: number;
  user_id?: number;
  user?: string;
  userImageURL?: string;
}

interface PixabayVideoResponse {
  total: number;
  totalHits: number;
  hits: PixabayVideo[];
}

/**
 * Removes the key from any text that is about to leave this module.
 *
 * The key legitimately travels in the outgoing request URL, so anything that
 * echoes a request back — a provider error body that repeats it, a network
 * error whose message quotes the URL — would otherwise carry it into a response
 * the browser can read. Redacting is cheaper than trusting every upstream error
 * message, and it is what makes "the key never appears in a response" true even
 * for a message this adapter did not compose.
 */
function redactKey(text: string): string {
  const key = readEnvVar("PIXABAY_API_KEY").trim();
  if (!key) return text;
  return text.split(key).join("[redacted]");
}

/**
 * The error text for a non-200. Names the endpoint and the status plus a short
 * slice of the body — never the request URL, because the URL carries the key.
 */
function describeHttpFailure(status: number, body: string): string {
  return `pixabay http ${status}: ${redactKey(body.slice(0, 200))}`;
}

async function pixabayFetch(query: string, count: number): Promise<PixabayVideoResponse> {
  // Pixabay documents per_page as 3–200, so a request for fewer than 3 would be
  // rejected by the API. Clamp instead of sending a value it refuses.
  const perPage = Math.min(Math.max(count, 3), 200);
  const params = new URLSearchParams({
    key: readEnvVar("PIXABAY_API_KEY"),
    q: query,
    per_page: String(perPage),
    safesearch: "true",
  });
  const res = await fetch(`${API}?${params.toString()}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(describeHttpFailure(res.status, body));
  }
  return (await res.json()) as PixabayVideoResponse;
}

/**
 * The largest rendition Pixabay actually returned for this hit, chosen by the
 * pixel count it states for each rendition (a hit may carry only some of the
 * four). Returns null when no rendition carries a URL — in which case the hit
 * cannot be turned into an asset at all and is dropped rather than invented.
 */
function largestRendition(
  videos: PixabayVideo["videos"],
): { rendition: Rendition; file: PixabayVideoFile } | null {
  if (!videos) return null;
  const candidates = RENDITIONS.flatMap((rendition) => {
    const file = videos[rendition];
    if (!file || typeof file.url !== "string" || !file.url) return [];
    const pixels = (file.width ?? 0) * (file.height ?? 0);
    return [{ rendition, file, pixels }];
  });
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.pixels - a.pixels);
  return { rendition: candidates[0].rendition, file: candidates[0].file };
}

/** The documented contributor profile URL, or undefined when Pixabay did not say who made it. */
function authorProfileUrl(v: PixabayVideo): string | undefined {
  if (!v.user) return undefined;
  const handle = v.user_id != null ? `${v.user}-${v.user_id}` : v.user;
  return `https://pixabay.com/users/${encodeURIComponent(handle)}/`;
}

function videoToAsset(v: PixabayVideo): ProviderAsset | null {
  const chosen = largestRendition(v.videos);
  if (!chosen) return null;
  const author = v.user || "Unknown";
  const tags = typeof v.tags === "string" ? v.tags.trim() : "";
  return {
    provider: "pixabay",
    externalId: String(v.id),
    // Pixabay returns tags, not a title. Say what it is rather than inventing one.
    title: tags ? `Pixabay video ${v.id} — ${tags}` : `Pixabay video ${v.id}`,
    mediaType: "video",
    url: chosen.file.url,
    previewUrl: chosen.file.thumbnail,
    thumbUrl: chosen.file.thumbnail,
    // Width/height are the CHOSEN rendition's own values, so they describe the
    // file `url` points at rather than the source video.
    width: chosen.file.width,
    height: chosen.file.height,
    durationSeconds: typeof v.duration === "number" ? v.duration : undefined,
    author,
    authorUrl: authorProfileUrl(v),
    pageUrl: v.pageURL,
    license: {
      type: "ROYALTY_FREE",
      source: "Pixabay",
      // The Content License Summary says attribution is not required (and that
      // credit is appreciated). Recorded anyway so a credit line always exists.
      attributionRequired: false,
      attribution: `${author} via Pixabay`,
      licenseUrl: "https://pixabay.com/service/terms/",
      // No purchase/expiry date is stated by Pixabay for a Content License, so
      // neither is filled in — the columns stay null and the licence report says
      // the record does not say, rather than assuming a licence never expires.
    },
    score: 0.5,
    metadata: {
      pixabay: {
        licenceName: "Pixabay Content License",
        licenceSummaryUrl: "https://pixabay.com/service/license-summary/",
        /** Which rendition the URL/width/height/size above describe. */
        rendition: chosen.rendition,
        /** The byte size Pixabay states for that rendition (not measured here). */
        fileSizeBytes: chosen.file.size,
        fileType: v.type ?? null,
        tags,
        views: v.views ?? null,
        downloads: v.downloads ?? null,
        likes: v.likes ?? null,
        /** Stated by Pixabay; the videos endpoint offers no orientation filter. */
        orientationFilterApplied: false,
      },
    },
  };
}

export const pixabay: StockProvider = {
  id: "pixabay",
  name: "Pixabay",
  supports: ["video"], // this adapter covers Pixabay's videos endpoint only
  rank: 2, // A/B — a real video source, ahead of the image-only Unsplash
  isConfigured: () => providerEnvConfigured("pixabay"),
  requiredEnv: () => providerRequiredEnv("pixabay"),
  async search(query: MediaProviderQuery): Promise<StockSearchResponse> {
    if (!providerEnvConfigured("pixabay")) {
      return { status: "not_connected", requiredEnv: providerRequiredEnv("pixabay") };
    }
    if (query.mediaType !== "video") {
      // Honest refusal rather than a fabricated empty list: this adapter only
      // speaks to /api/videos/.
      return {
        status: "error",
        message: "pixabay (this adapter) provides video search only; it has no image or audio endpoint.",
      };
    }
    const count = query.count ?? 12;
    try {
      const data = await pixabayFetch(query.query, count);
      const results = (data.hits ?? [])
        .map(videoToAsset)
        .filter((a): a is ProviderAsset => a !== null);
      return { status: "ok", results };
    } catch (err) {
      return {
        status: "error",
        message: redactKey(err instanceof Error ? err.message : String(err)),
      };
    }
  },
};
