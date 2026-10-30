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
import { Readable } from "node:stream";
import { checkArtefactOnDisk } from "./verify";

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
  const check = await checkArtefactOnDisk({
    id: target.artefactId,
    path: target.path,
    bytes: target.bytes,
    sha256: target.sha256,
    kind: target.kind,
  });

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
