/**
 * REAL FOOTAGE ON DISK (Phase 8, block 7b).
 *
 * A stock asset as `/api/media/select` creates it has a provider CDN `url` and
 * **no stored object**: nothing of it is in this business's own storage, so the
 * render pipeline has no file to encode. This module closes that gap the only
 * honest way: it fetches the provider's own bytes once, stores them in object
 * storage under a key derived from the bytes themselves, reads them BACK OUT of
 * storage and digests what came back, and records all of it on the Asset row.
 *
 * What it deliberately does NOT do:
 *   - it does not claim the bytes are the provider's if the digest read back
 *     from storage differs from the digest of what was fetched (it throws);
 *   - it does not invent a licence, an author or a page URL — those are copied
 *     from the StockAsset / LicensingMetadata rows that the provider's answer
 *     already produced;
 *   - it does not touch `purchasedAt` / `expiresAt`, which stay null because
 *     Pixabay states no purchase and no expiry for its Content Licence.
 */
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import { authorFromAttribution } from "@/lib/media/licence-fields";
import {
  downloadObjectToFile,
  putObject,
  statObjectSize,
  storageBucket,
  storageIsConfigured,
} from "@/lib/storage";

/** Refuse anything absurd before it reaches storage: this machine has ~1.2 GB RAM. */
export const MAX_FOOTAGE_BYTES = 200 * 1024 * 1024;

/** What was recorded on the Asset row's `metadata.footage` after a successful ingest. */
export interface FootageRecord {
  /** The object key in S3-compatible storage. This is what `Asset.s3Key` holds. */
  storedKey: string;
  bucket: string;
  /** Bytes as counted from the file written locally, then confirmed by storage. */
  bytes: number;
  /** SHA-256 of exactly those bytes. */
  sha256: string;
  contentType: string;
  /** The provider CDN URL the bytes were fetched from (kept, never used as a path). */
  sourceUrl: string;
  fetchedAt: string;
  /** What the provider said about the rendition: size/type it served, if it did. */
  servedContentLength: number | null;
  servedContentType: string | null;
  /** Provenance copied from the rows, not typed here. */
  provider: string | null;
  providerAssetId: string | null;
  author: string | null;
  pageUrl: string | null;
  licenseType: string | null;
  licenseSource: string | null;
  licenseUrl: string | null;
  attribution: string | null;
  /** Null unless the provider actually stated a date — Pixabay states neither. */
  purchasedAt: string | null;
  expiresAt: string | null;
  /** How the stored bytes were verified, in the record's own words. */
  verification: string;
}

/** A key derived from the bytes: the same clip ingested twice lands on one key. */
export function footageObjectKey(opts: { userId: string; assetId: string; sha256: string; ext: string }): string {
  const ext = opts.ext.replace(/^\./, "").replace(/[^a-z0-9]/gi, "").toLowerCase() || "bin";
  return `footage/${opts.userId}/${opts.assetId}-${opts.sha256.slice(0, 16)}.${ext}`;
}

function extFor(contentType: string, url: string): string {
  const t = contentType.toLowerCase();
  if (t.includes("mp4")) return "mp4";
  if (t.includes("webm")) return "webm";
  if (t.includes("quicktime")) return "mov";
  if (t.includes("jpeg")) return "jpg";
  if (t.includes("png")) return "png";
  const m = /\.([a-z0-9]{2,4})(?:\?|$)/i.exec(url);
  return m ? m[1] : "bin";
}

export interface IngestResult {
  assetId: string;
  /** True when the object was already in storage and only re-verified. */
  alreadyStored: boolean;
  record: FootageRecord;
}

/**
 * Fetch a stock asset's own bytes once, store them, and prove the stored bytes
 * are the fetched bytes.
 *
 * Throws (writing nothing to `Asset.s3Key`) when: the asset is not the caller's,
 * it has no provider URL, storage is not configured, the fetch fails, the file
 * is larger than MAX_FOOTAGE_BYTES, or the bytes read back out of storage do not
 * hash to the bytes that went in.
 */
export async function ingestStockFootage(input: { userId: string; assetId: string }): Promise<IngestResult> {
  const asset = await prisma.asset.findFirst({
    where: { id: input.assetId, userId: input.userId, deletedAt: null },
    include: { stockAsset: true, licensing: true },
  });
  // 404, never 403: a foreign asset is indistinguishable from a missing one.
  if (!asset) throw new ApiError(404, "Asset not found.", "not_found");
  if (!asset.url) {
    throw new ApiError(
      400,
      "This asset has no provider URL to fetch from, so there are no bytes to store.",
      "no_source_url",
    );
  }
  if (!storageIsConfigured()) {
    throw new ApiError(
      503,
      "Object storage is not configured (S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY / S3_BUCKET), so footage cannot be stored.",
      "storage_unconfigured",
    );
  }

  const existing = (asset.metadata as { footage?: FootageRecord } | null)?.footage ?? null;

  // Already ingested: re-verify the object rather than fetch it again. A stored
  // key that no longer holds the recorded bytes is an error, not a no-op.
  if (asset.s3Key && existing?.sha256) {
    const sizeInStorage = await statObjectSize(asset.s3Key);
    if (sizeInStorage === existing.bytes) {
      const workDir = mkdtempSync(join(tmpdir(), "cavs-footage-verify-"));
      const copy = join(workDir, `verify.${extFor(existing.contentType, existing.sourceUrl)}`);
      try {
        await downloadObjectToFile(asset.s3Key, copy);
        const sha = sha256OfFile(copy);
        if (sha !== existing.sha256) {
          throw new ApiError(
            500,
            `The object at ${asset.s3Key} no longer hashes to the digest recorded on the asset ` +
              `(${existing.sha256.slice(0, 12)}… vs ${sha.slice(0, 12)}…) — the stored footage is not the footage that was ingested.`,
            "stored_bytes_altered",
          );
        }
        return {
          assetId: asset.id,
          alreadyStored: true,
          record: {
            ...existing,
            verification:
              `already stored: storage reports ${sizeInStorage} bytes, and the object was read back out and hashed to ` +
              `${sha}, which is the digest recorded on the asset`,
          },
        };
      } finally {
        rmSync(workDir, { recursive: true, force: true });
      }
    }
  }

  // 1. FETCH the provider's bytes, once, server-side.
  const res = await fetch(asset.url, { redirect: "follow" });
  if (!res.ok) {
    throw new ApiError(
      502,
      `The provider's CDN answered ${res.status} for ${asset.url} — nothing was stored.`,
      "fetch_failed",
    );
  }
  // Refuse an oversized clip from the response HEADERS, before a single body
  // byte is buffered. This check used to run only AFTER `arrayBuffer()`, so a
  // 414,533,220-byte 4K rendition was read into this machine's memory and took
  // the whole server process with it (measured 2026-11-02) instead of answering
  // 413. The post-buffer check below stays: a chunked response declares no
  // length, and that is the one case this cannot catch in advance.
  const declaredLength = numOrNull(res.headers.get("content-length"));
  if (declaredLength !== null && declaredLength > MAX_FOOTAGE_BYTES) {
    await res.body?.cancel();
    throw new ApiError(
      413,
      `The provider's CDN declares ${declaredLength} bytes for ${asset.url}, above this build's ` +
        `${MAX_FOOTAGE_BYTES}-byte footage limit — nothing was downloaded and nothing was stored.`,
      "too_large",
    );
  }
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength === 0) {
    throw new ApiError(502, `The provider's CDN returned 0 bytes for ${asset.url} — nothing was stored.`, "fetch_empty");
  }
  if (buf.byteLength > MAX_FOOTAGE_BYTES) {
    throw new ApiError(
      413,
      `The clip is ${buf.byteLength} bytes, above this build's ${MAX_FOOTAGE_BYTES}-byte footage limit.`,
      "too_large",
    );
  }

  // 2. DIGEST what was fetched, then STORE it under a key derived from the digest.
  const sha256 = createHash("sha256").update(buf).digest("hex");
  const contentType = res.headers.get("content-type")?.split(";")[0]?.trim() || asset.mimeType || "application/octet-stream";
  const key = footageObjectKey({ userId: input.userId, assetId: asset.id, sha256, ext: extFor(contentType, asset.url) });
  await putObject({ key, data: buf, size: buf.byteLength, contentType });

  // 3. READ IT BACK. The size comes from storage; the digest comes from bytes
  //    storage returned. A key that merely repeats an in-memory digest proves
  //    nothing, so the object is fetched down and hashed again.
  const sizeInStorage = await statObjectSize(key);
  const workDir = mkdtempSync(join(tmpdir(), "cavs-footage-readback-"));
  const copy = join(workDir, `readback.${extFor(contentType, asset.url)}`);
  let readBackSha: string;
  let readBackBytes: number;
  try {
    readBackBytes = await downloadObjectToFile(key, copy);
    readBackSha = sha256OfFile(copy);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
  if (sizeInStorage !== buf.byteLength || readBackBytes !== buf.byteLength || readBackSha !== sha256) {
    throw new ApiError(
      500,
      `The stored object does not match what was fetched (fetched ${buf.byteLength} B / ${sha256.slice(0, 12)}…, ` +
        `storage reports ${sizeInStorage} B, read back ${readBackBytes} B / ${readBackSha.slice(0, 12)}…). ` +
        `The asset's s3Key was left unchanged.`,
      "stored_bytes_mismatch",
    );
  }

  const record: FootageRecord = {
    storedKey: key,
    bucket: storageBucket(),
    bytes: buf.byteLength,
    sha256,
    contentType,
    sourceUrl: asset.url,
    fetchedAt: new Date().toISOString(),
    servedContentLength: numOrNull(res.headers.get("content-length")),
    servedContentType: res.headers.get("content-type"),
    provider: asset.stockAsset?.provider ?? null,
    providerAssetId: asset.stockAsset?.externalId ?? null,
    author: authorFromAttribution(asset.licensing?.attribution ?? null),
    pageUrl: asset.stockAsset?.pageUrl ?? null,
    licenseType: asset.licensing?.licenseType ?? null,
    licenseSource: asset.licensing?.source ?? null,
    licenseUrl: asset.licensing?.licenseUrl ?? null,
    attribution: asset.licensing?.attribution ?? null,
    purchasedAt: asset.licensing?.purchasedAt?.toISOString() ?? null,
    expiresAt: asset.licensing?.expiresAt?.toISOString() ?? null,
    verification:
      `fetched ${buf.byteLength} bytes from ${asset.url}; storage reports ${sizeInStorage} bytes for key ${key}; ` +
      `the object was read back out and hashed to ${sha256}, equal to the digest of what was fetched`,
  };

  const metadata = (asset.metadata as Record<string, unknown> | null) ?? {};
  await prisma.asset.update({
    where: { id: asset.id },
    data: {
      s3Key: key,
      sizeBytes: BigInt(buf.byteLength),
      // The CDN URL is KEPT — it is the provider's own address for the clip, and
      // dropping it would lose the link between the stored bytes and its source.
      metadata: { ...metadata, footage: record } as never,
    },
  });

  return { assetId: asset.id, alreadyStored: false, record };
}

function sha256OfFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function numOrNull(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
