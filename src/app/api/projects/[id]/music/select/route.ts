/**
 * POST /api/projects/:id/music/select — BLOCK M1, 2026-11-17.
 *
 * Body: `{ provider, providerTrackId }`. Nothing else is read — a title, artist,
 * duration or licence text sent by the client is ignored, because the track is
 * re-fetched from the provider server-side and the verdict is computed from the
 * provider's own answer.
 *
 * A track whose licence does not permit the project's intended use is a 422
 * carrying the verdict's verbatim reason, and NOTHING is written. A foreign
 * project id is a 404.
 */
import { ApiError, apiError, apiRateLimit, ok, readJson, requireApiUser } from "@/lib/api";
import { parseIntendedUse } from "@/lib/music/query";
import { musicApiError, prismaMusicStore, selectMusic } from "@/lib/music/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ApiError(400, `\`${field}\` is required.`, "bad_request");
  }
  return value.trim();
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "studio:music-select", 30);
    const { id } = await ctx.params;
    const body = (await readJson(req)) as Record<string, unknown>;

    const providerId = requiredString(body.provider, "provider");
    const providerTrackId = requiredString(body.providerTrackId, "providerTrackId");
    const intendedUse = parseIntendedUse(
      typeof body.intendedUse === "string" ? body.intendedUse : null,
    );

    const result = await selectMusic(
      { userId, projectId: id, providerId, providerTrackId, intendedUse },
      { store: prismaMusicStore },
    );
    return ok({ selection: result.selection, view: result.view });
  } catch (err) {
    return apiError(musicApiError(err));
  }
}
