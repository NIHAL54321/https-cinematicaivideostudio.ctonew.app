import { NextRequest } from "next/server";
import { ApiError, apiError, apiRateLimit, ok, readJson, requireApiUser } from "@/lib/api";
import { addAssetToCollection, removeAssetFromCollection } from "@/lib/media/assets";

export const runtime = "nodejs";

/**
 * POST /api/media/library/collection
 * Add/remove an owned asset from a named collection.
 * Body: { assetId, collection, add:boolean }. Tenant-scoped.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "media:library:write", 120);
    const body = (await readJson(req)) as Record<string, unknown>;
    if (typeof body.assetId !== "string" || !body.assetId) {
      throw new ApiError(400, "assetId is required.", "bad_input");
    }
    if (typeof body.collection !== "string" || !body.collection.trim()) {
      throw new ApiError(400, "collection is required.", "bad_input");
    }
    const add = body.add !== false && body.add !== "false";
    const collection = body.collection.trim();
    const collections = add
      ? await addAssetToCollection(userId, body.assetId, collection)
      : await removeAssetFromCollection(userId, body.assetId, collection);
    return ok({ status: "ok", assetId: body.assetId, collection, add, collections });
  } catch (err) {
    return apiError(err);
  }
}
