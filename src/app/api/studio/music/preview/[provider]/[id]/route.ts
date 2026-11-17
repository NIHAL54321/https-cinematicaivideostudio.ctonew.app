/**
 * GET /api/studio/music/preview/:provider/:id — BLOCK M1, 2026-11-17.
 *
 * Proxies the provider's audio with Range passthrough, so the browser plays a
 * preview from THIS origin and never receives a provider URL or credential:
 * the upstream URL is built server-side by `provider.previewUrl(id)`, the
 * upstream `Location` header is dropped (the fetch follows redirects), and the
 * response carries `Cache-Control: no-store`.
 *
 * A `Range` request header is forwarded as-is and the upstream status (206 for
 * a partial answer) is passed through, which is what makes seeking work.
 */
import { ApiError, apiError, apiRateLimit, requireApiUser } from "@/lib/api";
import { musicProvider } from "@/lib/music/providers";
import { musicApiError } from "@/lib/music/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UPSTREAM_TIMEOUT_MS = 15000;

const FORWARDED_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-range",
  "accept-ranges",
] as const;

export async function GET(
  req: Request,
  ctx: { params: Promise<{ provider: string; id: string }> },
) {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "studio:music-preview", 120);
    const { provider: providerId, id } = await ctx.params;

    const provider = musicProvider(providerId);
    if (!provider.isConfigured()) {
      throw new ApiError(
        503,
        `${provider.label} is not configured: it would need ${provider.requiredEnv.join(" and ")}.`,
        "provider_not_configured",
      );
    }

    const range = req.headers.get("range");
    let upstream: Response;
    try {
      upstream = await fetch(provider.previewUrl(id), {
        headers: range ? { range } : {},
        redirect: "follow",
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch {
      throw new ApiError(
        502,
        `The preview did not answer within ${UPSTREAM_TIMEOUT_MS / 1000} s.`,
        "provider_timeout",
      );
    }

    if (!upstream.ok || !upstream.body) {
      throw new ApiError(502, `The provider answered ${upstream.status} for this preview.`, "provider_error");
    }

    const headers = new Headers({ "Cache-Control": "no-store" });
    for (const name of FORWARDED_RESPONSE_HEADERS) {
      const value = upstream.headers.get(name);
      if (value) headers.set(name, value);
    }
    if (!headers.has("content-type")) headers.set("content-type", "audio/mpeg");

    return new Response(upstream.body, { status: upstream.status, headers });
  } catch (err) {
    return apiError(musicApiError(err));
  }
}
