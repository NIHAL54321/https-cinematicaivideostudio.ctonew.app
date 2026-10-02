import { NextRequest } from "next/server";
import { ApiError, apiError, apiRateLimit, ok, readJson, requireApiUser } from "@/lib/api";
import { updateAssetInfo } from "@/lib/media/assets";
import { jsonSafe } from "@/lib/media/util";

export const runtime = "nodejs";

/**
 * PUT /api/media/library/asset
 * Rename and/or tag one of the caller's own assets.
 * Body: { assetId, name?, tags? }. Tenant-scoped.
 */
export async function PUT(req: NextRequest) {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "media:library:write", 120);
    const body = (await readJson(req)) as Record<string, unknown>;
    if (typeof body.assetId !== "string" || !body.assetId) {
      throw new ApiError(400, "assetId is required.", "bad_input");
    }
    if (body.name != null && typeof body.name !== "string") {
      throw new ApiError(400, "name must be a string.", "bad_input");
    }
    if (body.tags != null && (!Array.isArray(body.tags) || body.tags.some((t) => typeof t !== "string"))) {
      throw new ApiError(400, "tags must be an array of strings.", "bad_input");
    }
    const asset = await updateAssetInfo(userId, body.assetId, {
      name: typeof body.name === "string" ? body.name : undefined,
      tags: Array.isArray(body.tags) ? (body.tags as string[]) : undefined,
    });
    return ok({ status: "ok", assetId: body.assetId, asset: jsonSafe(asset) });
  } catch (err) {
    return apiError(err);
  }
}
