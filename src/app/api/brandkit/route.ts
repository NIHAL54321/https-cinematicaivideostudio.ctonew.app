import { NextRequest } from "next/server";
import {
  apiError,
  apiRateLimit,
  ok,
  readJson,
  requireApiUser,
} from "@/lib/api";
import {
  deleteBrandKit,
  getBrandKit,
  parseBrandKitInput,
  resolveKitAssetUrls,
  toBrandKitApi,
  upsertBrandKit,
} from "@/lib/brandkit";

export const runtime = "nodejs";

/**
 * Brand Kit API — tenant-scoped CRUD over the user's persistent brand kit.
 *
 * GET    /api/brandkit        → { kit: BrandKitApi | null }
 * POST   /api/brandkit        → upsert (create-or-update) from a validated body
 * DELETE /api/brandkit        → remove the kit
 *
 * Everything here persists REAL user data. "Generate a logo" style provider
 * actions are intentionally out of scope (the AI orchestrator owns those and
 * honestly reports "Provider Not Connected" until a key is configured).
 */
export async function GET() {
  try {
    const userId = await requireApiUser();
    const kit = await getBrandKit(userId);
    if (!kit) {
      return ok({ kit: null });
    }
    const urls = await resolveKitAssetUrls(userId, kit);
    return ok({ kit: toBrandKitApi(kit, urls) });
  } catch (err) {
    return apiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "brandkit:write", 60);
    const body = await readJson(req);
    const input = parseBrandKitInput(body);
    const kit = await upsertBrandKit(userId, input);
    const urls = await resolveKitAssetUrls(userId, kit);
    return ok({ kit: toBrandKitApi(kit, urls) });
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE() {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "brandkit:write", 30);
    await deleteBrandKit(userId);
    return ok({ status: "ok" });
  } catch (err) {
    return apiError(err);
  }
}
