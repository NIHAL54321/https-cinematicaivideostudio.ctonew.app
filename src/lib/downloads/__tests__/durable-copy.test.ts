/**
 * THE DURABLE COPY IS FOUND FROM THE ROW, NEVER GUESSED (Phase 8, block 8).
 *
 * The delivered container is stored at a key derived from the artefact row itself
 * (owner, job, kind, digest, extension), so:
 *   - different bytes can never live under the same key;
 *   - the download route can find the copy without a second table;
 *   - an artefact with no known owner gets NO key at all, so a caller cannot
 *     accidentally look for somebody else's object.
 *
 * These tests are pure: they exercise the derivation and the refusal paths that do
 * not touch the network. The live restore (object → file → digest check → HTTP 200)
 * is proved against real MinIO in the block's evidence, not here.
 */
import { describe, expect, test } from "bun:test";
import { deliveryContentType, deliveryObjectKey } from "@/lib/render/delivery-store";
import { restoreFromDurableCopy, type ServeTarget } from "@/lib/downloads/serve";

const SHA = "4f5f5c61a1b2c3d4e5f60718293a4b5c6d7e8f901234567890abcdef1234567";

describe("deliveryObjectKey", () => {
  test("is derived from the row: owner, job, kind, digest prefix and extension", () => {
    const key = deliveryObjectKey({
      userId: "user_1",
      jobId: "job_1",
      kind: "delivered-container",
      sha256: SHA,
      path: "/tmp/cavs-render-output/job_1/container-mux/delivered.mp4",
    });
    expect(key).toBe(`renders/user_1/job_1/delivered-container-${SHA.slice(0, 16)}.mp4`);
  });

  test("different bytes cannot share a key", () => {
    const a = deliveryObjectKey({ userId: "u", jobId: "j", kind: "delivered-container", sha256: SHA, path: "/tmp/x.mp4" });
    const b = deliveryObjectKey({ userId: "u", jobId: "j", kind: "delivered-container", sha256: "0".repeat(64), path: "/tmp/x.mp4" });
    expect(a).not.toBe(b);
  });

  test("a path with no usable extension gets .bin rather than a wrong type", () => {
    const key = deliveryObjectKey({ userId: "u", jobId: "j", kind: "delivered-container", sha256: SHA, path: "/tmp/weird" });
    expect(key.endsWith(".bin")).toBe(true);
  });

  test("a kind with odd characters is sanitised, not pasted into a key", () => {
    const key = deliveryObjectKey({ userId: "u", jobId: "j", kind: "Delivered Container/v2", sha256: SHA, path: "/tmp/x.mp4" });
    expect(key).toContain("delivered-container-v2-");
    expect(key).not.toContain(" ");
  });

  test("the content type is the delivery's own, not application/octet-stream for an mp4", () => {
    expect(deliveryContentType("delivered-container", "/tmp/delivered.mp4")).toBe("video/mp4");
    expect(deliveryContentType("checksum-sidecar", "/tmp/delivered.mp4.sha256")).toBe("text/plain; charset=utf-8");
  });
});

describe("restoreFromDurableCopy — the refusals that never touch the network", () => {
  const target: ServeTarget = {
    artefactId: "art_1",
    jobId: "job_1",
    path: "/tmp/cavs-render-output/job_1/container-mux/delivered.mp4",
    bytes: 180_000_000,
    sha256: SHA,
    kind: "delivered-container",
    filename: "project--youtube-1080p--delivered.mp4",
    synthetic: false,
    provenance: "produced by render job job_1",
    userId: null,
  };

  test("with no owner there is no key, so nothing is looked for", async () => {
    const restore = await restoreFromDurableCopy(target);
    expect(restore.state).toBe("no-object");
    expect(restore.key).toBeNull();
    expect(restore.statement).toContain("no owner is known");
  });
});
