/**
 * Pexels adapter — the not_connected state has to be REAL.
 *
 * The shipped bug this file pins: `search()` guarded on
 * `if (!this.isConfigured)` — the function itself, which is always truthy — so
 * the guard never fired and a keyless search went to api.pexels.com with an
 * empty Authorization header instead of reporting `not_connected`. The first
 * test is the regression: no key ⇒ not_connected AND zero fetch calls.
 *
 * `fetch` is replaced per test; nothing here reaches the network, and the key
 * used below is a sentinel invented for the assertion, not a real one.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { pexels } from "../pexels";

const SENTINEL_KEY = "sentinel-pexels-key-do-not-use-0123456789";
const realFetch = globalThis.fetch;
const realKey = process.env.PEXELS_API_KEY;
let calls: string[] = [];

function mockFetch(make: (url: string) => Response | Promise<Response>) {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push(url);
    return make(url);
  }) as typeof fetch;
}

const json200 = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

const VIDEO_BODY = {
  videos: [
    {
      id: 42,
      width: 1920,
      height: 1080,
      url: "https://www.pexels.com/video/42/",
      image: "https://images.pexels.com/videos/42/pictures/preview-0.jpg",
      duration: 11,
      video_files: [
        { link: "https://player.vimeo.com/external/42-sd.mp4", width: 960, height: 540, quality: "sd", file_type: "video/mp4" },
        { link: "https://player.vimeo.com/external/42-hd.mp4", width: 1920, height: 1080, quality: "hd", file_type: "video/mp4" },
      ],
      user: { name: "A Photographer", url: "https://www.pexels.com/@someone" },
    },
  ],
};

beforeEach(() => {
  calls = [];
  delete process.env.PEXELS_API_KEY;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (realKey === undefined) delete process.env.PEXELS_API_KEY;
  else process.env.PEXELS_API_KEY = realKey;
});

describe("pexels: with no key it is not_connected and touches no network", () => {
  test("search() returns not_connected, names the env var, and makes ZERO fetch calls", async () => {
    mockFetch(() => json200(VIDEO_BODY));
    const res = await pexels.search({ query: "city at night", mediaType: "video" });
    expect(res.status).toBe("not_connected");
    if (res.status !== "not_connected") return;
    expect(res.requiredEnv).toEqual(["PEXELS_API_KEY"]);
    // The regression itself: the guard must fire BEFORE any request is built.
    expect(calls.length).toBe(0);
  });

  test("a whitespace-only key counts as absent, and still makes no call", async () => {
    process.env.PEXELS_API_KEY = "   ";
    mockFetch(() => json200(VIDEO_BODY));
    const res = await pexels.search({ query: "city", mediaType: "image" });
    expect(res.status).toBe("not_connected");
    expect(calls.length).toBe(0);
  });

  test("NEGATIVE CONTROL: with a key present the same call DOES reach the network", async () => {
    // Proves the guard is a guard and not a permanently-closed door, and that
    // the zero-call assertion above is measuring something real.
    process.env.PEXELS_API_KEY = SENTINEL_KEY;
    mockFetch(() => json200(VIDEO_BODY));
    const res = await pexels.search({ query: "city at night", mediaType: "video" });
    expect(calls.length).toBe(1);
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.results[0]?.externalId).toBe("42");
    expect(res.results[0]?.mediaType).toBe("video");
    expect(new URL(calls[0]).origin + new URL(calls[0]).pathname).toBe("https://api.pexels.com/videos/search");
  });

  test("an image request with a key goes to the photo endpoint, not the video one", async () => {
    process.env.PEXELS_API_KEY = SENTINEL_KEY;
    mockFetch(() =>
      json200({
        photos: [
          {
            id: 7,
            width: 4000,
            height: 3000,
            url: "https://www.pexels.com/photo/7/",
            photographer: "Someone",
            photographer_url: "https://www.pexels.com/@someone",
            alt: "A city at night",
            src: {
              original: "https://images.pexels.com/photos/7/original.jpg",
              large2x: "https://images.pexels.com/photos/7/large2x.jpg",
              large: "https://images.pexels.com/photos/7/large.jpg",
              medium: "https://images.pexels.com/photos/7/medium.jpg",
              small: "https://images.pexels.com/photos/7/small.jpg",
              portrait: "https://images.pexels.com/photos/7/portrait.jpg",
              landscape: "https://images.pexels.com/photos/7/landscape.jpg",
              tiny: "https://images.pexels.com/photos/7/tiny.jpg",
            },
          },
        ],
      }),
    );
    const res = await pexels.search({ query: "city at night", mediaType: "image" });
    expect(res.status).toBe("ok");
    if (res.status !== "ok") return;
    expect(res.results[0]?.mediaType).toBe("image");
    expect(new URL(calls[0]).pathname).toBe("/v1/search");
  });
});
