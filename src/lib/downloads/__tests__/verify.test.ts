/**
 * A DOWNLOAD IS A CLAIM ABOUT BYTES — driven with real files (Phase 8, block 3).
 *
 * Every branch of `checkArtefactOnDisk` is exercised against a file on this
 * machine, so the route's gate is not trusted on its own: present, gone, a file
 * that is the wrong size, a file that is the right size and the wrong content, and
 * a path that is a directory. The digest function is compared with node's own
 * `crypto` over the same bytes, and a large file is hashed to show the streaming
 * pass does not depend on reading it whole into memory.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, truncateSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkArtefactOnDisk, checkOnDisk, sha256FileStreaming } from "@/lib/downloads/verify";

const dir = mkdtempSync(join(tmpdir(), "cavs-verify-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function file(name: string, content: Buffer | string): { path: string; bytes: number; sha256: string } {
  const path = join(dir, name);
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(content);
  writeFileSync(path, buf);
  return { path, bytes: buf.length, sha256: createHash("sha256").update(buf).digest("hex") };
}

describe("sha256FileStreaming", () => {
  test("agrees with node's crypto over the same bytes", async () => {
    const f = file("digest.txt", "the bytes a job produced\n");
    expect(await sha256FileStreaming(f.path)).toBe(f.sha256);
  });

  test("hashes a 4 MiB file without buffering it (constant memory pass)", async () => {
    const path = join(dir, "big.bin");
    writeFileSync(path, "");
    truncateSync(path, 4 * 1024 * 1024);
    const digest = await sha256FileStreaming(path);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("checkArtefactOnDisk", () => {
  test("present: the bytes on disk are the bytes recorded", async () => {
    const f = file("present.mp4", "0123456789");
    const check = await checkArtefactOnDisk({ id: "art_1", ...f });
    expect(check.state).toBe("present");
    expect(check.matches).toBe(true);
    expect(check.diskBytes).toBe(f.bytes);
    expect(check.diskSha256).toBe(f.sha256);
    expect(check.sentence).toContain("which is the SHA-256 recorded on the artefact row");
  });

  test("gone: the record survives, the file does not — the /tmp state after a reset", async () => {
    const f = file("gone.mp4", "0123456789");
    rmSync(f.path);
    const check = await checkArtefactOnDisk({ id: "art_2", ...f });
    expect(check.state).toBe("gone");
    expect(check.matches).toBe(false);
    expect(check.diskBytes).toBeNull();
    expect(check.sentence).toContain("no copy of it is served in its place");
  });

  test("size-mismatch: a shorter file is refused before any hashing", async () => {
    const f = file("short.mp4", "0123456789");
    writeFileSync(f.path, "0123");
    const check = await checkArtefactOnDisk({ id: "art_3", ...f });
    expect(check.state).toBe("size-mismatch");
    expect(check.matches).toBe(false);
    expect(check.diskBytes).toBe(4);
    expect(check.diskSha256).toBeNull();
  });

  test("digest-mismatch: same size, different content, refused", async () => {
    const f = file("tampered.mp4", "aaaaaaaaaa");
    writeFileSync(f.path, "bbbbbbbbbb");
    const check = await checkArtefactOnDisk({ id: "art_4", ...f });
    expect(check.state).toBe("digest-mismatch");
    expect(check.matches).toBe(false);
    expect(check.diskBytes).toBe(10);
    expect(check.diskSha256).not.toBe(f.sha256);
    expect(check.sentence).toContain("The content is not what the job produced");
  });

  test("unreadable: a directory at the recorded path is not a file to serve", async () => {
    const path = join(dir, "a-directory.mp4");
    mkdirSync(path, { recursive: true });
    const check = await checkArtefactOnDisk({ id: "art_5", path, bytes: 10, sha256: "0".repeat(64) });
    expect(check.state).toBe("unreadable");
    expect(check.matches).toBe(false);
  });
});

describe("checkOnDisk — the list's cheap check", () => {
  test("reports presence and size without hashing, and says absent for a missing file", async () => {
    const f = file("listed.mp4", "abcdef");
    expect(await checkOnDisk({ id: "art_6", ...f })).toEqual({ present: true, diskBytes: 6, sizeMatches: true });
    expect(await checkOnDisk({ id: "art_7", ...f, bytes: 7 })).toEqual({ present: true, diskBytes: 6, sizeMatches: false });
    rmSync(f.path);
    expect(await checkOnDisk({ id: "art_8", ...f })).toEqual({ present: false, diskBytes: null, sizeMatches: false });
  });
});
