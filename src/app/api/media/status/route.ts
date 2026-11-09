import { apiError, ok, requireApiUser } from "@/lib/api";
import { searchAllStockProviders, stockProviderAvailability } from "@/lib/media/providers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/media/status — what stock search can ACTUALLY do on this server.
 *
 * Phase 8 truthful-surfaces block, 2026-11-09. This route exists because the
 * Media Library's banner used to ask a different question from the one a search
 * asks (`GET /api/media?q=…` with no mediaType falls through to the image
 * default) and then stated the image-only answer as "Stock Provider Not
 * Connected" — while a real Pixabay video search on the same server returned
 * 200 with real candidates.
 *
 * Two halves, both honest:
 *
 *  1. `stockProviderAvailability()` — the SAME registry predicate
 *     (`isConfigured()`) the search route uses to decide which providers it will
 *     call. "configured" means the env var is present on this server; it is not
 *     a claim that the provider will answer.
 *  2. `liveProbe` — an actual search, run now, for the first media type a
 *     configured provider can serve. This is how the surface knows a provider
 *     really answers instead of assuming it. When no provider is configured the
 *     probe is `null` and nothing is invented.
 *
 * Response: { source, providers, connected, missing, requiredEnv, liveProbe, checkedAt }
 * Env var NAMES only — never a value.
 */
export async function GET() {
  try {
    await requireApiUser();

    const availability = stockProviderAvailability();
    const mediaType = availability.connectedMediaTypes[0] as "image" | "video" | undefined;

    let liveProbe: {
      mediaType: string;
      status: string;
      candidates: number;
      message: string | null;
      answeredBy: string[];
    } | null = null;

    if (mediaType) {
      // A real request to the provider, with a small count so a status check
      // stays cheap. Every failure mode the adapters can return is reported
      // verbatim; none of them becomes an empty list.
      const responses = await searchAllStockProviders({
        query: "cinematic landscape",
        mediaType,
        count: 3,
      });
      const answered = responses.filter((r) => r.status === "ok");
      const results = answered.flatMap((r) => (r.status === "ok" ? r.results : []));
      const failure = responses.find((r) => r.status === "error");
      liveProbe = {
        mediaType,
        status: answered.length > 0 ? "ok" : failure ? "error" : (responses[0]?.status ?? "error"),
        candidates: results.length,
        message: failure && failure.status === "error" ? failure.message : null,
        answeredBy: [...new Set(results.map((r) => r.provider))],
      };
    }

    return ok({
      source: "stock-providers",
      providers: availability.providers,
      connected: availability.connected.map((p) => ({ id: p.id, name: p.name, mediaTypes: p.mediaTypes })),
      missing: availability.missing.map((p) => ({
        id: p.id,
        name: p.name,
        mediaTypes: p.mediaTypes,
        requiredEnv: p.requiredEnv,
      })),
      requiredEnv: [...new Set(availability.missing.flatMap((p) => p.requiredEnv))],
      liveProbe,
      checkedAt: new Date().toISOString(),
    });
  } catch (err) {
    return apiError(err);
  }
}
