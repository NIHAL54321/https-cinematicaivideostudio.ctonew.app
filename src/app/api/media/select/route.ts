import { NextRequest } from "next/server";
import { ApiError, apiError, apiRateLimit, ok, readJson, requireApiUser } from "@/lib/api";
import { createStockAsset, getOwnedScene } from "@/lib/media/assets";
import { jsonSafe } from "@/lib/media/util";
import type { ProviderAsset, } from "@/lib/media/types";

export const runtime = "nodejs";

interface SelectBody {
  sceneId?: unknown;
  asset?: unknown;
  role?: unknown;
}

/**
 * POST /api/media/select
 * Assign a chosen stock asset to a scene. Tenant-scoped: verifies the scene
 * belongs to the caller, persists the asset (Asset + StockAsset +
 * LicensingMetadata) and the SceneAsset join row. Body:
 *   { sceneId, asset: ProviderAsset, role?: SceneAssetRole }
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "media:select", 120);
    const body = (await readJson(req)) as SelectBody;
    if (typeof body.sceneId !== "string" || !body.sceneId) {
      throw new ApiError(400, "sceneId is required.", "bad_input");
    }
    const asset = body.asset as ProviderAsset | undefined;
    if (!asset || typeof asset !== "object" || !asset.provider || !asset.externalId) {
      throw new ApiError(400, "asset (ProviderAsset) is required.", "bad_input");
    }
    const role = (body.role as string | undefined) ?? "VISUAL";

    const scene = await getOwnedScene(userId, body.sceneId);
    const persisted = await createStockAsset({
      userId,
      projectId: scene.project.id,
      source: asset,
      sceneId: scene.id,
      role: role as never,
    });
    return ok({ status: "ok", asset: jsonSafe(persisted), sceneId: scene.id }, 201);
  } catch (err) {
    return apiError(err);
  }
}
