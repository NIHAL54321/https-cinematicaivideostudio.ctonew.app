/**
 * Pixabay adapter tests — the four states the registry design promises:
 *   not_connected (no key) · ok (real 200 mapped) · error (non-200 surfaced)
 *   and "the key value never leaves the module".
 *
 * `fetch` is replaced per test; nothing here reaches the network, and the key
 * used in these tests is a sentinel invented for the assertion, not a real one.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { pixabay } from "../pixabay";
import { STOCK_PROVIDERS, searchAllStockProviders } from "../index";

const SENTINEL_KEY = "sentinel-pixabay-key-do-not-use-0123456789";
const realFetch = globalThis.fetch;
const realKey = process.env.PIXABAY_API_KEY;
const realPexels = process.env.PEXELS_API_KEY;
const realUnsplash = process.env.UNSPLASH_ACCESS_KEY;

/** One hit shaped exactly like Pixabay's documented video response. */
const HIT = {
  id: 125,
  pageURL: "https://pixabay.com/videos/id-125/",
  type: "film",
  tags: "flowers, yellow, blossom",
  duration: 12,
  videos: {
    large: {
      url: "https://cdn.pixabay.com/video/2015/08/08/125-135736646_large.mp4",
      width: 1920,
      height: 1080,
      size: 6615235,
      thumbnail: "https://cdn.pixabay.com/video/2015/08/08/125-135736646_large.jpg",
    },
    medium: {
      url: "https://cdn.pixabay.com/video/2015/08/08/125-135736646_medium.mp4",
      width: 1280,
      height: 720,
      size: 3562083,
      thumbnail: "https://cdn.pixabay.com/video/2015/08/08/125-135736646_medium.jpg",
    },
    small: {
      url: "https://cdn.pixabay.com/video/2015/08/08/125-135736646_small.mp4",
      width: 640,
      height: 360,
      size: 1030736,
      thumbnail: "https://cdn.pixabay.com/video/2015/08/08/125-135736646_small.jpg",
    },
    tiny: {
      url: "https://cdn.pixabay.com/video/2015/08/08/125-135736646_tiny.mp4",
      width: 480,
      height: 270,
      size: 426799,
      thumbnail: "https://cdn.pixabay.com/video/2015/08/08/125-135736646_tiny.jpg",
    },
  },
  views: 4462,
  downloads: 1464,
  likes: 18,
  comments: 0,
  user_id: 1281706,
  user: "Coverr-Free-Footage",
  userImageURL: "https://cdn.pixabay.com/user/2015/10/16/09-28-45-303_250x250.png",
};

const body = (hits: unknown[], totalHits = hits.length) =>
  JSON.stringify({ total: totalHits, totalHits, hits });

let calls: string[] = [];
function mockFetch(respond: (url: string) => Response | Promise<Response>) {
  calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    return respond(url);
  }) as typeof fetch;
}
const json200 = (payload: string) =>
  new Response(payload, { status: 200, headers: { "content-type": "application/json" } });

beforeEach(() => {
  process.env.PIXABAY_API_KEY = SENTINEL_KEY;
});
afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.PIXABAY_API_KEY;
  else process.env.PIXABAY_API_KEY = realKey;
  if (realPexels === undefined) delete process.env.PEXELS_API_KEY;
  else process.env.PEXELS_API_KEY = realPexels;
  if (realUnsplash === undefined) delete process.env.UNSPLASH_ACCESS_KEY;
  else process.env.UNSPLASH_ACCESS_KEY = realUnsplash;
});

describe("pixabay: registration", () => {
  test("registered in rank order pexels → pixabay → unsplash", () => {
    expect(STOCK_PROVIDERS.map((p) => p.id)).toEqual(["pexels", "pixabay", "unsplash"]);
    expect(pixabay.rank).toBe(2);
    expect(pixabay.supports).toEqual(["video"]);
    expect(pixabay.requiredEnv()).toEqual(["PIXABAY_API_KEY"]);
  });
});

describe("pixabay: not configured", () => {
  test("no key → honest not_connected naming PIXABAY_API_KEY, and nothing is requested", async () => {
    delete process.env.PIXABAY_API_KEY;
    mockFetch(() => json200(body([HIT])));
    const res = await pixabay.search({ query: "artificial intelligence cinematic", mediaType: "video" });
    expect(res).toEqual({ status: "not_connected", requiredEnv: ["PIXABAY_API_KEY"] });
    expect(calls.length).toBe(0);
    expect(pixabay.isConfigured()).toBe(false);
  });

  test("a blank key is not a key", async () => {
    process.env.PIXABAY_API_KEY = "   ";
    mockFetch(() => json200(body([HIT])));
    const res = await pixabay.search({ query: "x", mediaType: "video" });
    expect(res.status).toBe("not_connected");
    expect(calls.length).toBe(0);
  });

  test("registry search with nothing configured names PIXABAY_API_KEY for a video query", async () => {
    delete process.env.PIXABAY_API_KEY;
    delete process.env.PEXELS_API_KEY;
    delete process.env.UNSPLASH_ACCESS_KEY;
    mockFetch(() => json200(body([])));
    const responses = await searchAllStockProviders({ query: "ocean", mediaType: "video" });
    expect(responses.length).toBe(1);
    const [only] = responses;
    expect(only.status).toBe("not_connected");
    if (only.status === "not_connected") {
      expect(only.requiredEnv).toContain("PIXABAY_API_KEY");
    }
    expect(calls.length).toBe(0);
  });
});

describe("pixabay: a mocked 200 is mapped from the real fields", () => {
  test("largest rendition chosen; every value comes from the response", async () => {
    mockFetch(() => json200(body([HIT], 500)));
    const res = await pixabay.search({ query: "flowers", mediaType: "video", count: 12 });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.results.length).toBe(1);
    const a = res.results[0];
    expect(a.provider).toBe("pixabay");
    expect(a.externalId).toBe("125");
    expect(a.mediaType).toBe("video");
    expect(a.url).toBe(HIT.videos.large.url);
    expect(a.width).toBe(1920);
    expect(a.height).toBe(1080);
    expect(a.durationSeconds).toBe(12);
    expect(a.author).toBe("Coverr-Free-Footage");
    // The documented profile-URL pattern: /users/{USERNAME}-{ID}/
    expect(a.authorUrl).toBe("https://pixabay.com/users/Coverr-Free-Footage-1281706/");
    expect(a.pageUrl).toBe("https://pixabay.com/videos/id-125/");
    expect(a.previewUrl).toBe(HIT.videos.large.thumbnail);
    expect(a.thumbUrl).toBe(HIT.videos.large.thumbnail);
    expect(a.title).toBe("Pixabay video 125 — flowers, yellow, blossom");
    expect(a.license.type).toBe("ROYALTY_FREE");
    expect(a.license.source).toBe("Pixabay");
    expect(a.license.attributionRequired).toBe(false);
    expect(a.license.attribution).toBe("Coverr-Free-Footage via Pixabay");
    expect(a.license.licenseUrl).toBe("https://pixabay.com/service/terms/");
    // No purchase/expiry date is stated by Pixabay, so none is invented.
    expect(a.license.purchasedAt).toBeUndefined();
    expect(a.license.expiresAt).toBeUndefined();
    const meta = a.metadata?.pixabay as Record<string, unknown>;
    expect(meta.rendition).toBe("large");
    expect(meta.fileSizeBytes).toBe(6615235);
    expect(meta.licenceName).toBe("Pixabay Content License");
    expect(meta.licenceSummaryUrl).toBe("https://pixabay.com/service/license-summary/");
  });

  test("when the largest rendition is absent the largest PRESENT one is chosen and named", async () => {
    const { large: _drop, ...rest } = HIT.videos;
    mockFetch(() => json200(body([{ ...HIT, videos: rest }])));
    const res = await pixabay.search({ query: "flowers", mediaType: "video" });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    const a = res.results[0];
    expect(a.url).toBe(HIT.videos.medium.url);
    expect(a.width).toBe(1280);
    expect(a.height).toBe(720);
    expect((a.metadata?.pixabay as Record<string, unknown>).rendition).toBe("medium");
  });

  test("a hit with no rendition URL is dropped, never invented", async () => {
    mockFetch(() => json200(body([{ id: 9, pageURL: "https://pixabay.com/videos/id-9/" }])));
    const res = await pixabay.search({ query: "x", mediaType: "video" });
    expect(res).toEqual({ status: "ok", results: [] });
  });

  test("per_page is clamped to the range Pixabay documents (3–200)", async () => {
    mockFetch(() => json200(body([])));
    await pixabay.search({ query: "x", mediaType: "video", count: 1 });
    expect(new URL(calls[0]).searchParams.get("per_page")).toBe("3");
    await pixabay.search({ query: "x", mediaType: "video", count: 500 });
    expect(new URL(calls[1]).searchParams.get("per_page")).toBe("200");
  });

  test("the request goes to the documented videos endpoint with the query and safesearch", async () => {
    mockFetch(() => json200(body([])));
    await pixabay.search({ query: "artificial intelligence cinematic", mediaType: "video" });
    const u = new URL(calls[0]);
    expect(u.origin + u.pathname).toBe("https://pixabay.com/api/videos/");
    expect(u.searchParams.get("q")).toBe("artificial intelligence cinematic");
    expect(u.searchParams.get("safesearch")).toBe("true");
    // The videos endpoint documents no orientation parameter, so none is sent.
    expect(u.searchParams.has("orientation")).toBe(false);
  });
});

describe("pixabay: failures are errors, never empty results", () => {
  test("non-200 becomes an error string naming the status", async () => {
    mockFetch(() => new Response('{"error":"Invalid API key"}', { status: 400 }));
    const res = await pixabay.search({ query: "x", mediaType: "video" });
    expect(res.status).toBe("error");
    if (res.status !== "error") return;
    expect(res.message).toContain("pixabay http 400");
    expect(res.message).toContain("Invalid API key");
  });

  test("429 is an error, not an empty list", async () => {
    mockFetch(() => new Response("Too many requests", { status: 429 }));
    const res = await pixabay.search({ query: "x", mediaType: "video" });
    expect(res.status).toBe("error");
  });

  test("a thrown fetch is an error too", async () => {
    mockFetch(() => {
      throw new Error("network down");
    });
    const res = await pixabay.search({ query: "x", mediaType: "video" });
    expect(res).toEqual({ status: "error", message: "network down" });
  });

  test("a non-video request is refused rather than answered with an empty list", async () => {
    mockFetch(() => json200(body([HIT])));
    const res = await pixabay.search({ query: "x", mediaType: "image" });
    expect(res.status).toBe("error");
    expect(calls.length).toBe(0);
  });
});

describe("pixabay: the key value never leaves the module", () => {
  test("no returned response, and no thrown/logged text, contains the key", async () => {
    const logged: string[] = [];
    const originals = {
      log: console.log,
      info: console.info,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    };
    for (const name of Object.keys(originals) as (keyof typeof originals)[]) {
      console[name] = (...args: unknown[]) => {
        logged.push(args.map((a) => (typeof a === "string" ? a : String(a))).join(" "));
      };
    }
    try {
      // 1. a normal 200
      mockFetch(() => json200(body([HIT])));
      const okRes = await pixabay.search({ query: "flowers", mediaType: "video" });
      // 2. a non-200 whose body happens to echo the request
      mockFetch(
        () =>
          new Response(
            JSON.stringify({ error: `bad request for key ${SENTINEL_KEY}` }),
            { status: 400 },
          ),
      );
      const errRes = await pixabay.search({ query: "flowers", mediaType: "video" });
      // 3. a fetch that throws a message containing the full URL (and thus the key)
      mockFetch((url) => {
        throw new Error(`socket hang up on ${url}`);
      });
      const thrownRes = await pixabay.search({ query: "flowers", mediaType: "video" });
      // 4. the not_connected path
      delete process.env.PIXABAY_API_KEY;
      const offRes = await pixabay.search({ query: "flowers", mediaType: "video" });

      for (const res of [okRes, errRes, thrownRes, offRes]) {
        expect(JSON.stringify(res)).not.toContain(SENTINEL_KEY);
      }
      expect(logged.join("\n")).not.toContain(SENTINEL_KEY);
      // The key DOES go to Pixabay — that is the only place it is used.
      expect(calls.every((c) => c.includes(SENTINEL_KEY))).toBe(true);
      // …and an echoed key in the error path is redacted, not carried.
      if (errRes.status === "error") expect(errRes.message).toContain("[redacted]");
      if (thrownRes.status === "error") expect(thrownRes.message).toContain("[redacted]");
    } finally {
      Object.assign(console, originals);
    }
  });
});
