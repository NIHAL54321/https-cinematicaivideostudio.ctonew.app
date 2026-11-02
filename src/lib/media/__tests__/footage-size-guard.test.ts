/**
 * The footage ingest must refuse an oversized clip BEFORE it buffers it.
 *
 * The bug these tests pin, found by block 9 by crashing the server: the
 * `MAX_FOOTAGE_BYTES` check ran AFTER `await res.arrayBuffer()`, so the size
 * limit could only ever fire on a file that had already been read into memory.
 * A 4K Pixabay rendition of 414,533,220 bytes was fetched, buffered, and took
 * the whole app process down — the request never got as far as a 413, and every
 * later request got ECONNREFUSED because there was no server left to answer.
 *
 * The fix is an ordering rule, so the test asserts the ordering: the declared
 * `content-length` is checked before the body is buffered. The post-buffer check
 * stays, because a chunked response declares no length at all.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SOURCE = readFileSync(join(import.meta.dir, "../footage.ts"), "utf8");

describe("ingestStockFootage refuses an oversized clip before buffering it", () => {
  test("the declared-length guard is reached before the body is buffered", () => {
    const guard = SOURCE.indexOf('res.headers.get("content-length")');
    const buffer = SOURCE.indexOf("await res.arrayBuffer()");
    expect(guard).toBeGreaterThan(-1);
    expect(buffer).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(buffer);
  });

  test("the refusal is a typed 413 that says nothing was downloaded or stored", () => {
    const at = SOURCE.indexOf("above this build's");
    expect(at).toBeGreaterThan(-1);
    const window = SOURCE.slice(at - 400, at + 400);
    expect(window).toContain("413");
    expect(window).toContain("nothing was downloaded and nothing was stored");
  });

  test("the body is not read when the guard fires", () => {
    // Between the guard and the buffer call there must be a throw: a guard that
    // falls through would still buffer the clip.
    const guard = SOURCE.indexOf('res.headers.get("content-length")');
    const buffer = SOURCE.indexOf("await res.arrayBuffer()");
    expect(SOURCE.slice(guard, buffer)).toContain("throw new ApiError(");
  });

  test("the post-buffer check is still there for responses with no declared length", () => {
    const buffer = SOURCE.indexOf("await res.arrayBuffer()");
    expect(SOURCE.slice(buffer).indexOf("MAX_FOOTAGE_BYTES")).toBeGreaterThan(-1);
  });
});
