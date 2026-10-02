/**
 * Phase 3 — Secure user-upload flow (signed URLs, MinIO/S3).
 *
 * Wraps src/lib/storage.ts for user uploads of images / video / audio / music.
 * Flow:
 *   1. createUploadAsset → creates an Asset row (status UPLOADING) with a
 *      user-scoped s3Key, returns { asset, uploadUrl (presigned PUT), readUrl }.
 *   2. Client PUTs bytes to uploadUrl directly (never through our server).
 *   3. finalizeUpload → marks the row READY and returns a fresh read URL.
 *   4. deleteUpload → removes the row + underlying object.
 * Keys are always user-scoped (userObjectKey), so cross-tenant access is
 * impossible by construction. LicenseType ORIGINAL is set for user content.
 */
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { presignedGetUrl, presignedPutUrl, removeObject, userObjectKey } from "@/lib/storage";
import type { AssetKind } from "@prisma/client";

/** Map a content type + optional hint to an honest AssetKind. */
export function kindForUpload(contentType: string, hint?: string): AssetKind {
  const h = (hint ?? "").toUpperCase();
  if (h === "IMAGE" || h === "VIDEO" || h === "AUDIO" || h === "MUSIC") return h as AssetKind;
  const t = contentType.toLowerCase();
  if (t.startsWith("video/")) return "VIDEO";
  if (t.startsWith("image/")) return "IMAGE";
  if (t.startsWith("audio/")) return "AUDIO";
  return "AUDIO";
}

/** Create an UPLOADING asset + presigned PUT/GET URLs for the given file. */
export async function createUploadAsset(opts: {
  userId: string;
  projectId: string;
  fileName: string;
  contentType: string;
  kind?: string;
}) {
  const { userId, projectId, fileName, contentType } = opts;
  const kind = kindForUpload(contentType, opts.kind);
  const s3Key = userObjectKey(userId, kind.toLowerCase(), fileName);
  const asset = await prisma.asset.create({
    data: {
      projectId,
      userId,
      kind,
      name: fileName,
      status: "UPLOADING",
      mimeType: contentType,
      s3Key,
      metadata: { upload: { originalName: fileName } },
    },
  });
  const uploadUrl = await presignedPutUrl(s3Key);
  const readUrl = await presignedGetUrl(s3Key);
  // Licensing: ORIGINAL (user-uploaded), no external source.
  await prisma.licensingMetadata.create({
    data: {
      assetId: asset.id,
      licenseType: "ORIGINAL",
      source: "User upload",
    },
  });
  return { asset, uploadUrl, readUrl };
}

/** Mark an upload READY and return a fresh read URL. Tenant-checked. */
export async function finalizeUpload(userId: string, assetId: string, patch?: { sizeBytes?: number; width?: number; height?: number; durationSeconds?: number }) {
  const asset = await prisma.asset.findFirst({ where: { id: assetId, userId } });
  if (!asset) throw new ApiError(404, "Asset not found.", "not_found");
  const updated = await prisma.asset.update({
    where: { id: assetId },
    data: {
      status: "READY",
      sizeBytes: patch?.sizeBytes ?? asset.sizeBytes,
      width: patch?.width ?? asset.width,
      height: patch?.height ?? asset.height,
      durationSeconds: patch?.durationSeconds ?? asset.durationSeconds,
    },
  });
  const readUrl = asset.s3Key ? await presignedGetUrl(asset.s3Key) : undefined;
  return { asset: updated, readUrl };
}

/** Return a signed read URL for an owned upload. */
export async function getUploadReadUrl(userId: string, assetId: string): Promise<string | undefined> {
  const asset = await prisma.asset.findFirst({ where: { id: assetId, userId } });
  if (!asset) throw new ApiError(404, "Asset not found.", "not_found");
  if (!asset.s3Key) throw new ApiError(400, "Asset has no stored object.", "no_object");
  return presignedGetUrl(asset.s3Key);
}

/** Delete an owned upload row + its object. Tenant-checked. */
export async function deleteUpload(userId: string, assetId: string): Promise<void> {
  const asset = await prisma.asset.findFirst({ where: { id: assetId, userId } });
  if (!asset) throw new ApiError(404, "Asset not found.", "not_found");
  if (asset.s3Key) await removeObject(asset.s3Key).catch(() => {});
  await prisma.asset.delete({ where: { id: assetId } });
}
