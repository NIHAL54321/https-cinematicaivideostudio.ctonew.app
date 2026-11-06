/**
 * SERVING ONE FILE, HONESTLY (Phase 8, block 3).
 *
 * One function answers every download in this app — a user's deliverable, its
 * digest sidecar, and a labelled synthetic proof — because a second copy of this
 * logic is a second chance to get the checks wrong.
 *
 * What it always does:
 *   - verifies the bytes on disk against the recorded size AND SHA-256 before the
 *     status line is written (`verify.ts`, one streaming hash pass);
 *   - refuses instead of serving when they differ: 410 when the file is gone,
 *     409 when something is there that is not what was recorded;
 *   - reports both the RECORDED and the MEASURED digest and size in response
 *     headers, so the claim in the file can be re-checked by the client;
 *   - streams the body from disk (constant memory) with a `Content-Length`;
 *   - gives the file a meaningful name via `Content-Disposition`.
 *
 * A missing file is never a 500: it is a 410 with a body that names the job, the
 * recorded size and the recorded digest, which are the three things that are
 * still true about it.
 */
import { createReadStream } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { deliveryObjectKey } from "@/lib/render/delivery-store";
import { downloadObjectToFile, statObjectSize, storageBucket, storageIsConfigured } from "@/lib/storage";
import { checkArtefactOnDisk, type DiskCheck } from "./verify";

export interface ServeTarget {
  artefactId: string;
  jobId: string;
  path: string;
  bytes: number;
  sha256: string;
  kind: string;
  filename: string;
  /** True only on the labelled synthetic proof surface. */
  synthetic: boolean;
  /** What the response says this file is, in one sentence. */
  provenance: string;
  /**
   * The owner of the artefact, or null when no durable copy may be looked for.
   * The durable key is derived from it (block 8), so a caller that does not know
   * the owner cannot accidentally find somebody else's object.
   */
  userId: string | null;
}

/** Where a restored file came from, and what that took. */
export type DurableState = "restored" | "no-object" | "size-mismatch" | "digest-mismatch" | "not-configured" | "error";

export interface DurableRestore {
  state: DurableState;
  /** The derived object key, when one could be derived. */
  key: string | null;
  bucket: string | null;
  /** What object storage itself said the object's size is, or null. */
  objectBytes: number | null;
  /** The check run against the restored file, when something was written back. */
  check: DiskCheck | null;
  /** One sentence naming what was compared. */
  statement: string;
}

/**
 * THE DURABLE COPY, RESTORED TO THE PATH THE RECORD NAMES (Phase 8, block 8).
 *
 * A delivered container is stored in this business's own object storage by the
 * mux stage. When the local file is gone — a machine reset wipes
 * `RENDER_OUTPUT_DIR` — the download is not answered with a 410 while a durable
 * copy exists: the object is fetched back to the very path the artefact row
 * names, and then the SAME check runs against it. The download route is not
 * given a second, weaker verification path for restored files; the bytes have to
 * match the recorded size and SHA-256 exactly, or nothing is served.
 *
 * Nothing is restored on a guess: with no `userId` there is no key, with no
 * object at the key there is nothing to restore, and a size or digest that
 * disagrees with the row is a refusal.
 */
export async function restoreFromDurableCopy(target: ServeTarget): Promise<DurableRestore> {
  const nothing = (state: DurableState, statement: string, key: string | null = null, objectBytes: number | null = null): DurableRestore => ({
    state,
    key,
    bucket: storageIsConfigured() ? storageBucket() : null,
    objectBytes,
    check: null,
    statement,
  });

  if (!target.userId) {
    return nothing("no-object", "no owner is known for this artefact, so no durable copy can be derived or looked for");
  }
  if (!storageIsConfigured()) {
    return nothing("not-configured", "object storage is not configured on this deployment, so there is no durable copy to look for");
  }
  const key = deliveryObjectKey({
    userId: target.userId,
    jobId: target.jobId,
    kind: target.kind,
    sha256: target.sha256,
    path: target.path,
  });
  let objectBytes: number | null;
  try {
    objectBytes = await statObjectSize(key);
  } catch (err) {
    return nothing("error", `object storage could not be asked about ${key} (${(err as Error).message})`, key);
  }
  if (objectBytes === null) {
    return nothing("no-object", `no durable copy is stored at ${key}, so the recorded bytes are not on this machine and not in storage either`, key);
  }
  if (objectBytes !== target.bytes) {
    return nothing(
      "size-mismatch",
      `the durable copy at ${key} is ${objectBytes} bytes; the artefact row records ${target.bytes} — a copy of the wrong size is not restored`,
      key,
      objectBytes,
    );
  }
  try {
    mkdirSync(dirname(target.path), { recursive: true });
    const written = await downloadObjectToFile(key, target.path);
    if (written !== target.bytes) {
      return nothing(
        "size-mismatch",
        `the durable copy at ${key} wrote ${written} bytes to ${target.path}; the row records ${target.bytes}`,
        key,
        objectBytes,
      );
    }
  } catch (err) {
    return nothing("error", `the durable copy at ${key} could not be restored (${(err as Error).message})`, key, objectBytes);
  }
  const check = await checkArtefactOnDisk({
    id: target.artefactId,
    path: target.path,
    bytes: target.bytes,
    sha256: target.sha256,
    kind: target.kind,
  });
  if (!check.matches) {
    return {
      state: check.state === "digest-mismatch" ? "digest-mismatch" : "size-mismatch",
      key,
      bucket: storageBucket(),
      objectBytes,
      check,
      statement:
        `the durable copy at ${key} was written back to ${target.path} and then checked: ${check.sentence} ` +
        `The stored copy is not the recorded delivery, so it is not served.`,
    };
  }
  return {
    state: "restored",
    key,
    bucket: storageBucket(),
    objectBytes,
    check,
    statement:
      `nothing was at ${target.path}, so the durable copy at ${key} (${objectBytes} bytes in bucket ` +
      `${storageBucket()}) was fetched back to that path and checked: ${check.sentence}`,
  };
}


export function contentTypeFor(kind: string, path: string): string {
  if (kind === "checksum-sidecar" || path.endsWith(".sha256")) return "text/plain; charset=utf-8";
  if (path.endsWith(".vtt")) return "text/vtt; charset=utf-8";
  if (path.endsWith(".mp4")) return "video/mp4";
  return "application/octet-stream";
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store" },
  });
}

/** A `Content-Disposition` that works for a plain-ASCII slug and is safe either way. */
export function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

/** The status a given disk state earns. Never 500: an absent file is a known state. */
export function statusForDiskState(state: string): { status: number; code: string } {
  switch (state) {
    case "gone":
      return { status: 410, code: "file_gone" };
    case "size-mismatch":
      return { status: 409, code: "size_mismatch" };
    case "digest-mismatch":
      return { status: 409, code: "digest_mismatch" };
    case "unreadable":
      return { status: 409, code: "file_unreadable" };
    default:
      return { status: 409, code: "not_servable" };
  }
}

/**
 * HTTP header values are BYTE strings: a header carrying an em dash, a curly
 * quote or any other non-ASCII character makes `new Headers()` throw, which turns
 * a perfectly good download into a 500. The sentences this app puts in headers are
 * written for humans, so they are transliterated here rather than reworded — and
 * the full sentence is still in the JSON body and on the page.
 */
export function headerSafe(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, "-");
}

export async function serveArtefact(target: ServeTarget): Promise<Response> {
  let check = await checkArtefactOnDisk({
    id: target.artefactId,
    path: target.path,
    bytes: target.bytes,
    sha256: target.sha256,
    kind: target.kind,
  });

  /* The local file is gone, so before refusing, look for the durable copy the mux
   * stage stored. A restored file is checked again by the same function above —
   * there is no weaker path for a file that came back from storage. */
  let restore: DurableRestore | null = null;
  if (!check.matches && check.state === "gone") {
    restore = await restoreFromDurableCopy(target);
    if (restore.state === "restored" && restore.check) check = restore.check;
  }

  if (!check.matches) {
    const { status, code } = statusForDiskState(check.state);
    return json(status, {
      error: check.sentence,
      code,
      state: check.state,
      artefactId: target.artefactId,
      jobId: target.jobId,
      filename: target.filename,
      recordedBytes: target.bytes,
      recordedSha256: target.sha256,
      diskBytes: check.diskBytes,
      diskSha256: check.diskSha256,
      synthetic: target.synthetic,
      /** What was looked for in durable storage, and what came of it. */
      durable: restore
        ? { state: restore.state, key: restore.key, bucket: restore.bucket, objectBytes: restore.objectBytes, statement: restore.statement }
        : null,
    });
  }

  const headers = new Headers({
    "content-type": contentTypeFor(target.kind, target.path),
    "content-length": String(check.diskBytes ?? target.bytes),
    "content-disposition": contentDisposition(target.filename),
    "cache-control": "private, no-store",
    "content-digest": `sha-256=:${Buffer.from(target.sha256, "hex").toString("base64")}:`,
    etag: `"${target.sha256}"`,
    /* The record, and the measurement, side by side. */
    "x-cavs-artefact-id": target.artefactId,
    "x-cavs-job-id": target.jobId,
    "x-cavs-recorded-sha256": target.sha256,
    "x-cavs-recorded-bytes": String(target.bytes),
    "x-cavs-verified-sha256": check.diskSha256 ?? "",
    "x-cavs-verified-bytes": String(check.diskBytes ?? 0),
    "x-cavs-verification": "digest-and-size-match",
    "x-cavs-synthetic": target.synthetic ? "true" : "false",
    "x-cavs-provenance": headerSafe(target.provenance),
    /** Where the bytes served actually came from: the render output directory, or the durable copy. */
    "x-cavs-source": restore?.state === "restored" ? "object-storage" : "render-output",
    ...(restore?.state === "restored" && restore.key
      ? {
          "x-cavs-durable-key": headerSafe(restore.key),
          "x-cavs-durable-bucket": headerSafe(restore.bucket ?? ""),
          "x-cavs-durable-statement": headerSafe(restore.statement),
        }
      : {}),
  });

  const body = Readable.toWeb(createReadStream(target.path)) as unknown as ReadableStream<Uint8Array>;
  return new Response(body, { status: 200, headers });
}

/** The refusal used when a row is not found for this user at all. Same 404 for foreign and synthetic. */
export function notFound(what: "artefact" | "sidecar" | "job"): Response {
  const message =
    what === "sidecar"
      ? "No digest sidecar is recorded for this artefact. The job's own rows are the record; nothing is generated to fill the gap."
      : "Artefact not found.";
  return json(404, { error: message, code: "not_found" });
}
