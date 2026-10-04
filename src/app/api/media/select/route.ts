import { NextRequest } from "next/server";
import { LicenseType } from "@prisma/client";
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

const LICENSE_TYPES = Object.values(LicenseType) as readonly string[];

/**
 * Validate the client-supplied `asset` (a ProviderAsset) BEFORE it reaches the
 * database. Only `provider`/`externalId` used to be checked, so any other
 * malformed field (an unknown `license.type`, a missing `url`) surfaced as
 * PrismaClientValidationError and the caller got an untyped
 * `500 {"error":"Something went wrong.","code":"internal"}`. Every rejection
 * here is a typed 400 naming the field that is wrong; nothing is invented and
 * no row is written.
 */
function badAsset(message: string): never {
  throw new ApiError(400, message, "bad_input");
}
function validateProviderAsset(asset: unknown): ProviderAsset {
  if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
    badAsset("asset (ProviderAsset) must be an object.");
  }
  const a = asset as Record<string, unknown>;
  if (typeof a.provider !== "string" || !a.provider) badAsset("asset.provider is required.");
  if (typeof a.externalId !== "string" || !a.externalId) badAsset("asset.externalId is required.");
  if (typeof a.title !== "string" || !a.title) badAsset("asset.title is required.");
  if (a.mediaType !== "image" && a.mediaType !== "video") {
    badAsset('asset.mediaType must be "image" or "video".');
  }
  if (typeof a.url !== "string" || !a.url) badAsset("asset.url is required.");
  if (typeof a.width !== "number" || !Number.isFinite(a.width) || a.width <= 0) {
    badAsset("asset.width must be a positive number.");
  }
  if (typeof a.height !== "number" || !Number.isFinite(a.height) || a.height <= 0) {
    badAsset("asset.height must be a positive number.");
  }
  if (typeof a.author !== "string" || !a.author) badAsset("asset.author is required.");
  const lic = a.license;
  if (!lic || typeof lic !== "object" || Array.isArray(lic)) badAsset("asset.license is required.");
  const l = lic as Record<string, unknown>;
  if (typeof l.type !== "string" || !LICENSE_TYPES.includes(l.type)) {
    badAsset(`asset.license.type must be one of: ${LICENSE_TYPES.join(", ")}.`);
  }
  if (typeof l.source !== "string" || !l.source) badAsset("asset.license.source is required.");
  if (typeof l.licenseUrl !== "string" || !l.licenseUrl) badAsset("asset.license.licenseUrl is required.");
  return asset as ProviderAsset;
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
    const asset = validateProviderAsset(body.asset);
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
