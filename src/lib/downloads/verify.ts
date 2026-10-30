/**
 * A DOWNLOAD IS A CLAIM ABOUT BYTES (Phase 8, block 3).
 *
 * Every artefact row this app writes carries three facts: a path, a byte size and
 * a SHA-256. Until something is served, those are only a *record*. The moment a
 * user clicks download, the product is asserting "these are the bytes we
 * recorded" — so the bytes are checked against the record before a single byte
 * leaves the process, and the answer is one of four honest states:
 *
 *   present       — the file is on disk and its size and digest match the record;
 *   gone          — the record exists, the file does not (the proof files live in
 *                   /tmp, which a reset wipes: this state is expected, not a bug);
 *   size-mismatch — a file is there but it is not the size we recorded;
 *   digest-mismatch — the size matches and the content does not.
 *
 * Nothing here repairs, regenerates or approximates a file. A mismatch is a
 * refusal to serve, never a corrected record and never a 500.
 *
 * WHY TWO PASSES AND NOT ONE. The file could be streamed through a hashing
 * transform and the digest compared afterwards, but by then the status line is
 * already on the wire, so a tampered file would be delivered with a 200 and an
 * apology the client cannot act on. So the file is hashed in one streaming pass
 * (never buffered: `createReadStream` + `crypto`, constant memory) and streamed in
 * a second. Two passes read the disk; neither loads the file into memory.
 */
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

/** What the bytes on disk actually are, as far as this process can tell. */
export type DiskState = "present" | "gone" | "unreadable" | "size-mismatch" | "digest-mismatch";

export interface DiskCheck {
  state: DiskState;
  /** The artefact id this check is about. */
  artefactId: string;
  /** The path that was read. */
  path: string;
  /** Bytes recorded on the artefact row. */
  recordedBytes: number;
  /** SHA-256 recorded on the artefact row. */
  recordedSha256: string;
  /** Bytes actually on disk, or null when there is no file to measure. */
  diskBytes: number | null;
  /** SHA-256 actually computed from the file, or null when there is no file. */
  diskSha256: string | null;
  /** True only when size AND digest match the record. */
  matches: boolean;
  /** One honest sentence, naming what was compared. */
  sentence: string;
}

export interface ArtefactRecord {
  id: string;
  path: string;
  bytes: number;
  sha256: string;
  kind?: string;
}

/** Hash a file in one streaming pass. Constant memory, whatever its size. */
export async function sha256FileStreaming(path: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve());
  });
  return hash.digest("hex");
}

function errCode(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "";
}

/**
 * Cheap check for a LIST surface: is there a file at the recorded path, and is it
 * the recorded size? No hashing — a list of twenty deliverables must not read
 * twenty files. The digest is checked at download time, where it is the point.
 */
export async function checkOnDisk(artefact: ArtefactRecord): Promise<{
  present: boolean;
  diskBytes: number | null;
  sizeMatches: boolean;
}> {
  try {
    const st = await stat(artefact.path);
    if (!st.isFile()) return { present: false, diskBytes: null, sizeMatches: false };
    return { present: true, diskBytes: st.size, sizeMatches: st.size === artefact.bytes };
  } catch {
    return { present: false, diskBytes: null, sizeMatches: false };
  }
}

/**
 * The full check, for a DOWNLOAD: size and digest. This is the gate the route
 * uses, and it is exported so a test can drive every branch with a real file
 * instead of trusting the route's copy of the logic.
 */
export async function checkArtefactOnDisk(artefact: ArtefactRecord): Promise<DiskCheck> {
  const base = {
    artefactId: artefact.id,
    path: artefact.path,
    recordedBytes: artefact.bytes,
    recordedSha256: artefact.sha256,
  };
  let diskBytes: number;
  try {
    const st = await stat(artefact.path);
    if (!st.isFile()) {
      return {
        ...base,
        state: "unreadable",
        diskBytes: null,
        diskSha256: null,
        matches: false,
        sentence:
          `The recorded path ${artefact.path} is not a regular file on this machine, so the recorded ` +
          `${artefact.bytes} bytes / ${artefact.sha256.slice(0, 12)}… cannot be served.`,
      };
    }
    diskBytes = st.size;
  } catch (err) {
    const missing = errCode(err) === "ENOENT";
    return {
      ...base,
      state: missing ? "gone" : "unreadable",
      diskBytes: null,
      diskSha256: null,
      matches: false,
      sentence: missing
        ? `Nothing is at ${artefact.path} any more. The record of ${artefact.bytes} bytes with SHA-256 ` +
          `${artefact.sha256} is what the job produced; the file itself is no longer on this machine, and ` +
          `no copy of it is served in its place.`
        : `The recorded path ${artefact.path} could not be read (${errCode(err) || "unknown error"}), so the ` +
          `recorded ${artefact.bytes} bytes / ${artefact.sha256.slice(0, 12)}… cannot be verified or served.`,
    };
  }
  if (diskBytes !== artefact.bytes) {
    return {
      ...base,
      state: "size-mismatch",
      diskBytes,
      diskSha256: null,
      matches: false,
      sentence:
        `The file at ${artefact.path} is ${diskBytes} bytes; the artefact row records ${artefact.bytes}. ` +
        `The bytes on disk are not the bytes recorded, so nothing is served.`,
    };
  }
  let diskSha256: string;
  try {
    diskSha256 = await sha256FileStreaming(artefact.path);
  } catch (err) {
    return {
      ...base,
      state: "unreadable",
      diskBytes,
      diskSha256: null,
      matches: false,
      sentence:
        `The file at ${artefact.path} is ${diskBytes} bytes but could not be read to compute its digest ` +
        `(${errCode(err) || "unknown error"}), so the recorded SHA-256 ${artefact.sha256} is unverified.`,
    };
  }
  if (diskSha256 !== artefact.sha256) {
    return {
      ...base,
      state: "digest-mismatch",
      diskBytes,
      diskSha256,
      matches: false,
      sentence:
        `The file at ${artefact.path} is ${diskBytes} bytes (as recorded) but hashes to ${diskSha256}, ` +
        `not the recorded SHA-256 ${artefact.sha256}. The content is not what the job produced, so nothing is served.`,
    };
  }
  return {
    ...base,
    state: "present",
    diskBytes,
    diskSha256,
    matches: true,
    sentence:
      `The file at ${artefact.path} is ${diskBytes} bytes and hashes to ${diskSha256}, which is the ` +
      `SHA-256 recorded on the artefact row. The bytes served are the bytes recorded.`,
  };
}
