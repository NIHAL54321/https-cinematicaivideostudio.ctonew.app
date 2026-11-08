/**
 * The address rule the media fetch runs under (Phase 8, security block).
 *
 * These tests pin the thing a probe proved was missing: `ingestStockFootage`
 * fetched whatever URL a caller had stored, with no scheme check and no address
 * check, so an authenticated user could make the server fetch its own loopback,
 * the private network and the cloud metadata service. The rule is an allow-list
 * by address class, and it is applied to the first request and to every redirect
 * hop.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { assertSafeFetchUrl, blockedAddressReason, guardedFetch, UnsafeFetchError } from "@/lib/media/fetch-guard";

describe("blockedAddressReason", () => {
  const blocked: Array<[string, string]> = [
    ["127.0.0.1", "loopback"],
    ["127.10.20.30", "loopback"],
    ["0.0.0.0", "unspecified"],
    ["10.1.2.3", "private"],
    ["172.16.0.1", "private"],
    ["172.31.255.254", "private"],
    ["192.168.1.1", "private"],
    ["169.254.169.254", "metadata"],
    ["100.64.0.1", "CGNAT"],
    ["198.18.0.1", "benchmarking"],
    ["224.0.0.1", "multicast"],
    ["255.255.255.255", "reserved"],
    ["::1", "IPv6 loopback"],
    ["::", "IPv6 unspecified"],
    ["fd00::1", "unique-local"],
    ["fe80::1", "IPv6 link-local"],
    ["ff02::1", "IPv6 multicast"],
    ["::ffff:127.0.0.1", "IPv4-mapped loopback"],
    ["[::1]", "bracketed IPv6 loopback"],
  ];
  for (const [address, what] of blocked) {
    test(`${address} is refused (${what})`, () => {
      const reason = blockedAddressReason(address);
      expect(reason).not.toBeNull();
      expect(String(reason).length).toBeGreaterThan(10);
    });
  }

  for (const address of ["93.184.216.34", "8.8.8.8", "203.0.113.10", "2606:4700:4700::1111"]) {
    test(`${address} is allowed (public)`, () => {
      expect(blockedAddressReason(address)).toBeNull();
    });
  }
});

describe("assertSafeFetchUrl", () => {
  test("refuses a non-http(s) scheme with its own code", async () => {
    for (const url of ["file:///etc/passwd", "gopher://127.0.0.1:6379/_INFO", "data:text/html,hi", "ftp://example.com/x"]) {
      await expect(assertSafeFetchUrl(url)).rejects.toMatchObject({ code: "unsafe_scheme" });
    }
  });

  test("refuses loopback, metadata and private literals before any connection", async () => {
    for (const url of [
      "http://127.0.0.1:3100/api/health",
      "http://[::1]:3100/",
      "http://169.254.169.254/latest/meta-data/",
      "http://10.0.0.1/",
      "http://192.168.0.1/",
      "http://0.0.0.0:3100/",
    ]) {
      await expect(assertSafeFetchUrl(url)).rejects.toMatchObject({ code: "private_address" });
    }
  });

  test("refuses localhost by name", async () => {
    await expect(assertSafeFetchUrl("http://localhost:3100/")).rejects.toBeInstanceOf(UnsafeFetchError);
  });

  test("refuses credentials in the URL", async () => {
    await expect(assertSafeFetchUrl("http://user:pass@93.184.216.34/")).rejects.toMatchObject({ code: "unsafe_url" });
  });

  test("accepts a public literal address", async () => {
    const url = await assertSafeFetchUrl("https://93.184.216.34/clip.mp4");
    expect(url.hostname).toBe("93.184.216.34");
  });
});

describe("guardedFetch re-checks every redirect hop", () => {
  const realFetch = globalThis.fetch;
  const stub = (handler: (url: string) => Response) => {
    globalThis.fetch = (async (input: RequestInfo | URL) => handler(String(input))) as typeof fetch;
  };

  test("a public host that redirects to loopback is refused at the hop", async () => {
    stub(() => new Response(null, { status: 302, headers: { location: "http://127.0.0.1:3100/api/health" } }));
    try {
      await expect(guardedFetch("https://93.184.216.34/start")).rejects.toMatchObject({ code: "private_address" });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("a public host that redirects to the metadata service is refused at the hop", async () => {
    stub(() => new Response(null, { status: 307, headers: { location: "http://169.254.169.254/latest/meta-data/" } }));
    try {
      await expect(guardedFetch("https://93.184.216.34/start")).rejects.toMatchObject({ code: "private_address" });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("an endless redirect chain stops", async () => {
    stub((url) => new Response(null, { status: 302, headers: { location: url } }));
    try {
      await expect(guardedFetch("https://93.184.216.34/loop")).rejects.toMatchObject({ code: "too_many_redirects" });
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  test("a normal response comes back with its final URL", async () => {
    stub(() => new Response("hello", { status: 200, headers: { "content-type": "video/mp4" } }));
    try {
      const got = await guardedFetch("https://93.184.216.34/clip.mp4");
      expect(got.response.status).toBe(200);
      expect(got.finalUrl).toBe("https://93.184.216.34/clip.mp4");
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});

describe("the ingest path uses the guard and refuses a non-media response", () => {
  const SOURCE = readFileSync(join(import.meta.dir, "../footage.ts"), "utf8");

  test("the fetch goes through guardedFetch, not a bare fetch()", () => {
    expect(SOURCE).toContain("guardedFetch(asset.url");
    expect(SOURCE).not.toContain('fetch(asset.url, { redirect: "follow" })');
  });

  test("the content-type refusal runs before the body is buffered", () => {
    const guard = SOURCE.indexOf("wrong_content_type");
    const buffer = SOURCE.indexOf("await res.arrayBuffer()");
    expect(guard).toBeGreaterThan(-1);
    expect(buffer).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(buffer);
  });
});
