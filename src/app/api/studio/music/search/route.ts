/**
 * GET /api/studio/music/search — BLOCK M1, 2026-11-17.
 *
 * Returns normalised provider tracks WITH the licence verdict for each, so the
 * Music tab never has to decide what is exportable. The verdict is computed
 * server-side by the shared decision table; `intendedUse` is optional and
 * defaults to commercial (a monetised channel).
 *
 * Validation lives in `src/lib/music/query.ts` and is unit-tested: an empty `q`
 * is a 400 and a `limit` above 50 is a 400. An unknown provider id is a 400 and
 * an unwired slot is a 503 naming its env vars — never an empty list.
 */
import { apiError, apiRateLimit, ok, requireApiUser } from "@/lib/api";
import { parseIntendedUse, parseMusicSearchParams } from "@/lib/music/query";
import { DEFAULT_MUSIC_PROVIDER_ID } from "@/lib/music/providers";
import { musicApiError, searchMusic } from "@/lib/music/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "studio:music-search", 30);
    const url = new URL(req.url);
    const query = parseMusicSearchParams(url.searchParams);
    const providerId = url.searchParams.get("provider")?.trim() || DEFAULT_MUSIC_PROVIDER_ID;
    const intendedUse = parseIntendedUse(url.searchParams.get("intendedUse")) ?? "commercial";
    const view = await searchMusic({ providerId, query, intendedUse }, {});
    return ok(view);
  } catch (err) {
    return apiError(musicApiError(err));
  }
}
