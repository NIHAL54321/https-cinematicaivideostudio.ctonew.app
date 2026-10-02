import { NextRequest } from "next/server";
import { ApiError, apiError, apiRateLimit, ok, readJson, requireApiUser } from "@/lib/api";
import {
  createUploadAsset,
  deleteUpload,
  finalizeUpload,
  getUploadReadUrl,
} from "@/lib/media/uploads";
import { jsonSafe } from "@/lib/media/util";

export const runtime = "nodejs";

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length ? v : undefined;
}

/**
 * Secure user-upload flow (signed URLs through MinIO/S3, user-scoped keys).
 *
 * POST /api/media/upload
 *   Body A (initiate): { fileName, contentType, kind?, projectId? }
 *     → creates an Asset (UPLOADING) and returns { asset, uploadUrl, readUrl }.
 *   Body B (finalize): { assetId, sizeBytes?, width?, height?, durationSeconds? }
 *     → marks the row READY and returns a fresh readUrl.
 * GET  /api/media/upload?assetId=... → signed read URL for an owned upload.
 * DELETE /api/media/upload?assetId=... → delete row + object.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "media:upload", 60);
    const body = (await readJson(req)) as Record<string, unknown>;

    // Finalize path.
    const assetId = str(body.assetId);
    if (assetId) {
      const result = await finalizeUpload(userId, assetId, {
        sizeBytes: typeof body.sizeBytes === "number" ? body.sizeBytes : undefined,
        width: typeof body.width === "number" ? body.width : undefined,
        height: typeof body.height === "number" ? body.height : undefined,
        durationSeconds:
          typeof body.durationSeconds === "number" ? body.durationSeconds : undefined,
      });
      return ok({ status: "ok", ...(jsonSafe(result) as Record<string, unknown>) });
    }

    // Initiate path.
    const fileName = str(body.fileName);
    const contentType = str(body.contentType);
    const projectId = str(body.projectId);
    if (!fileName || !contentType || !projectId) {
      throw new ApiError(
        400,
        "fileName, contentType and projectId are required.",
        "bad_input",
      );
    }
    await apiRateLimit(userId, "media:upload:create", 20);
    const result = await createUploadAsset({
      userId,
      projectId,
      fileName,
      contentType,
      kind: str(body.kind),
    });
    return ok({ status: "ok", ...(jsonSafe(result) as Record<string, unknown>) }, 201);
  } catch (err) {
    return apiError(err);
  }
}

export async function GET(req: NextRequest) {
  try {
    const userId = await requireApiUser();
    const assetId = req.nextUrl.searchParams.get("assetId");
    if (!assetId) throw new ApiError(400, "assetId is required.", "bad_input");
    const readUrl = await getUploadReadUrl(userId, assetId);
    return ok({ status: "ok", assetId, readUrl });
  } catch (err) {
    return apiError(err);
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const userId = await requireApiUser();
    const assetId = req.nextUrl.searchParams.get("assetId");
    if (!assetId) throw new ApiError(400, "assetId is required.", "bad_input");
    await deleteUpload(userId, assetId);
    return ok({ status: "ok", deleted: assetId });
  } catch (err) {
    return apiError(err);
  }
}
