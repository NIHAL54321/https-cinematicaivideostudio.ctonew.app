import { NextRequest } from "next/server";
import { ApiError, apiError, apiRateLimit, ok, readJson, requireApiUser } from "@/lib/api";
import { ingestStockFootage } from "@/lib/media/footage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/media/ingest  { assetId }
 *
 * Store a stock asset's own bytes in this business's object storage, so the
 * render pipeline has a real file to encode instead of a CDN URL. Tenant-scoped:
 * a foreign asset is a 404. The response is the record written to the Asset row
 * — the stored key, the byte count and the SHA-256 of exactly those bytes, plus
 * the provider/author/page/licence the asset already carried.
 *
 * This does not generate, transform or claim anything about the footage. It
 * moves bytes the provider served into storage we control, and measures them.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "media:ingest", 60);
    const body = (await readJson(req)) as { assetId?: unknown };
    if (typeof body.assetId !== "string" || !body.assetId) {
      throw new ApiError(400, "assetId is required.", "bad_input");
    }
    const result = await ingestStockFootage({ userId, assetId: body.assetId });
    return ok({
      ingested: true,
      alreadyStored: result.alreadyStored,
      assetId: result.assetId,
      footage: result.record,
    });
  } catch (err) {
    return apiError(err);
  }
}
