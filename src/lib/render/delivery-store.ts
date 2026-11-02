/**
 * A DELIVERED FILE THAT OUTLIVES THE MACHINE (Phase 8, block 8).
 *
 * Until this block a delivered master existed in exactly one place: a path under
 * `RENDER_OUTPUT_DIR` (`/tmp/cavs-render-output` by default), which this machine
 * wipes on every reset — and it resets roughly hourly. The artefact row survived
 * with its byte count and its SHA-256, and the download centre said so honestly
 * ("produced but gone"). That is a truthful record of a file nobody can have.
 *
 * So the delivered container is now also written to this business's OWN object
 * storage, and the key is DERIVED FROM THE ROW rather than typed anywhere:
 *
 *     renders/<userId>/<jobId>/<kind>-<first 16 hex of the sha256>.<ext>
 *
 * Deriving it matters. The digest is part of the key, so an object can never be
 * silently swapped for different bytes under the same name, and the download
 * surface can find the durable copy from the artefact row alone — there is no
 * second table, no extra column and no cache to fall out of step with the record.
 *
 * What this module does NOT do:
 *   - it does not upload anything it has not measured first (the size and digest
 *     it records are of the file on disk, read again here);
 *   - it does not trust the upload: the object is read BACK OUT of storage and
 *     hashed, and a mismatch throws rather than leaving a key behind that claims
 *     to be the delivery;
 *   - it does not delete the local file. The durable copy is an addition to the
 *     record, not a replacement for it.
 */
import { createHash } from "node:crypto";
import { createReadStream, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  downloadObjectToFile,
  putObject,
  statObjectSize,
  storageBucket,
  storageIsConfigured,
} from "@/lib/storage";

/** Where a delivered artefact's durable copy lives, derived from the row's own facts. */
export function deliveryObjectKey(input: {
  userId: string;
  jobId: string;
  kind: string;
  sha256: string;
  path: string;
}): string {
  const base = input.path.split("/").pop() ?? "";
  const dot = base.lastIndexOf(".");
  const raw = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
  const ext = /^[a-z0-9]{1,8}$/.test(raw) ? raw : "bin";
  const kind = input.kind.replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  return `renders/${input.userId}/${input.jobId}/${kind}-${input.sha256.slice(0, 16)}.${ext}`;
}

/** The content type a stored delivery is written with. Mirrors the download route's own table. */
export function deliveryContentType(kind: string, path: string): string {
  if (kind === "checksum-sidecar" || path.endsWith(".sha256")) return "text/plain; charset=utf-8";
  if (path.endsWith(".mp4")) return "video/mp4";
  if (path.endsWith(".vtt")) return "text/vtt; charset=utf-8";
  return "application/octet-stream";
}

export interface StoredDelivery {
  key: string;
  bucket: string;
  /** Bytes of the local file, counted here rather than taken on trust. */
  bytes: number;
  /** SHA-256 of the local file, computed here. */
  sha256: string;
  /** What object storage itself reported for the key. */
  objectBytesInStorage: number | null;
  /** The digest of the bytes that came back OUT of storage. */
  readBackSha256: string | null;
  /** True only when the object read back is the file that went in. */
  verified: boolean;
  /** One sentence a reader can check. */
  statement: string;
}

function sha256OfFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

/**
 * Store one produced file durably and prove the stored bytes are the produced
 * bytes. Throws (leaving no claim behind) when: storage is not configured, the
 * file is not on disk, its size or digest disagrees with what the stage recorded,
 * or the object read back does not hash to the same digest.
 */
export async function storeDeliveredFile(input: {
  userId: string;
  jobId: string;
  kind: string;
  path: string;
  /** The size and digest the producing stage measured. */
  bytes: number;
  sha256: string;
}): Promise<StoredDelivery> {
  if (!storageIsConfigured()) {
    throw new Error(
      "object storage is not configured (S3_ENDPOINT / S3_ACCESS_KEY / S3_SECRET_KEY / S3_BUCKET), " +
        "so the delivered file was not stored durably",
    );
  }
  const sizeOnDisk = statSync(input.path).size;
  if (sizeOnDisk !== input.bytes) {
    throw new Error(
      `the file at ${input.path} is ${sizeOnDisk} bytes but the stage recorded ${input.bytes} — ` +
        `nothing is stored durably for a file that is not the one measured`,
    );
  }
  const digestNow = sha256OfFile(input.path);
  if (digestNow !== input.sha256) {
    throw new Error(
      `the file at ${input.path} hashes to ${digestNow} but the stage recorded ${input.sha256} — ` +
        `nothing is stored durably for a file that is not the one measured`,
    );
  }

  const key = deliveryObjectKey({
    userId: input.userId,
    jobId: input.jobId,
    kind: input.kind,
    sha256: input.sha256,
    path: input.path,
  });
  // Streamed from disk: a ten-minute master must not be held in this machine's
  // memory to be uploaded.
  await putObject({
    key,
    data: createReadStream(input.path),
    size: input.bytes,
    contentType: deliveryContentType(input.kind, input.path),
  });

  const objectBytesInStorage = await statObjectSize(key);
  const workDir = mkdtempSync(join(tmpdir(), "cavs-delivery-readback-"));
  const copy = join(workDir, "readback.bin");
  let readBackSha256: string | null = null;
  try {
    const written = await downloadObjectToFile(key, copy);
    if (written !== input.bytes) {
      throw new Error(
        `the object at ${key} is ${written} bytes when read back; the delivered file is ${input.bytes} bytes`,
      );
    }
    readBackSha256 = sha256OfFile(copy);
  } finally {
    rmSync(workDir, { recursive: true, force: true });
  }
  if (readBackSha256 !== input.sha256) {
    throw new Error(
      `the object at ${key} hashes to ${readBackSha256} when read back, not the delivered file's ${input.sha256} — ` +
        `the stored copy is not the delivery`,
    );
  }

  return {
    key,
    bucket: storageBucket(),
    bytes: input.bytes,
    sha256: input.sha256,
    objectBytesInStorage,
    readBackSha256,
    verified: objectBytesInStorage === input.bytes && readBackSha256 === input.sha256,
    statement:
      `stored ${input.bytes} bytes at ${key} in bucket ${storageBucket()}; storage reports ` +
      `${objectBytesInStorage} bytes for the key, and the object was read back out and hashed to ` +
      `${readBackSha256}, equal to the delivered file's digest`,
  };
}
