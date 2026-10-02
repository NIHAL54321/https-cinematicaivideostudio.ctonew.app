import { NextRequest } from "next/server";
import { ApiError, apiError, apiRateLimit, ok, readJson, requireApiUser } from "@/lib/api";
import { setAssetFavorite } from "@/lib/media/assets";

export const runtime = "nodejs";

/**
 * POST /api/media/library/favorite
 * Toggle favorite on one of the caller's own assets. Body: { assetId, favorite }.
 * Tenant-scoped (setAssetFavorite → getOwnedAsset proves ownership).
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "media:library:write", 120);
    const body = (await readJson(req)) as Record<string, unknown>;
    if (typeof body.assetId !== "string" || !body.assetId) {
      throw new ApiError(400, "assetId is required.", "bad_input");
    }
    const favorite = body.favorite === true || body.favorite === "true";
    const lib = await setAssetFavorite(userId, body.assetId, favorite);
    return ok({ status: "ok", assetId: body.assetId, favorite, library: lib });
  } catch (err) {
    return apiError(err);
  }
}
