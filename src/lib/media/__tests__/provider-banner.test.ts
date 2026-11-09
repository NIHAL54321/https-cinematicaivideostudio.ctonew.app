/**
 * The Media Library's stock-provider banner — both directions.
 *
 * Phase 8 truthful-surfaces block, 2026-11-09. The banner used to fire
 * `GET /api/media?q=…` with no mediaType, which the route answers for IMAGES,
 * so a working Pixabay VIDEO key rendered "Stock Provider Not Connected" with
 * PEXELS_API_KEY / UNSPLASH_ACCESS_KEY chips — above a grid of real Pixabay
 * video assets on the same screen.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { stockBannerView } from "../provider-banner";
import { stockProviderAvailability } from "../providers";

const PIXABAY = { id: "pixabay", name: "Pixabay", mediaTypes: ["video"] };
const PEXELS = { id: "pexels", name: "Pexels", mediaTypes: ["image", "video"], requiredEnv: ["PEXELS_API_KEY"] };
const UNSPLASH = { id: "unsplash", name: "Unsplash", mediaTypes: ["image"], requiredEnv: ["UNSPLASH_ACCESS_KEY"] };

describe("banner — a provider that answered is never described as 'not connected'", () => {
  const view = stockBannerView({
    connected: [PIXABAY],
    missing: [PEXELS, UNSPLASH],
    liveProbe: { mediaType: "video", status: "ok", candidates: 3, answeredBy: ["pixabay"] },
  });

  test("the title names the provider that is actually available, with its media type", () => {
    expect(view.show).toBe(true);
    expect(view.title).toContain("Pixabay");
    expect(view.title).toContain("video");
    expect(view.title).not.toContain("Not Connected");
  });

  test("the body reports the live answer and names precisely what is still missing", () => {
    expect(view.tone).toBe("ok");
    expect(view.body).toContain("live video search");
    expect(view.body).toContain("3 candidates");
    expect(view.body).toContain("Pexels");
    expect(view.body).toContain("PEXELS_API_KEY");
    expect(view.body).toContain("Unsplash");
    expect(view.body).toContain("UNSPLASH_ACCESS_KEY");
    // The image-only gap is named as such — a video key does not make images work.
    expect(view.body).toContain("image/video search needs one of those");
  });

  test("the env chips are the missing providers' names only, never the connected one", () => {
    expect(view.chips).toEqual(["PEXELS_API_KEY", "UNSPLASH_ACCESS_KEY"]);
  });
});

describe("banner — with no key at all it says so, and names the env vars", () => {
  const view = stockBannerView({
    connected: [],
    missing: [PEXELS, { ...PIXABAY, requiredEnv: ["PIXABAY_API_KEY"] }, UNSPLASH],
    liveProbe: null,
  });

  test("the honest absence sentence survives for a genuinely unconfigured server", () => {
    expect(view.show).toBe(true);
    expect(view.tone).toBe("warn");
    expect(view.title).toBe("Stock Provider Not Connected.");
    expect(view.body).toContain("Pexels");
    expect(view.body).toContain("Pixabay");
    expect(view.body).toContain("No search results are fabricated");
  });

  test("every env name a reader would have to set is present as a chip", () => {
    expect(view.chips).toContain("PEXELS_API_KEY");
    expect(view.chips).toContain("PIXABAY_API_KEY");
    expect(view.chips).toContain("UNSPLASH_ACCESS_KEY");
  });
});

describe("banner — configured but silent is its own sentence, not 'not connected'", () => {
  const view = stockBannerView({
    connected: [PIXABAY],
    missing: [PEXELS, UNSPLASH],
    liveProbe: { mediaType: "video", status: "error", candidates: 0, message: "pixabay: HTTP 429" },
  });

  test("it reports the provider's own failure instead of claiming the key is absent", () => {
    expect(view.tone).toBe("warn");
    expect(view.title).toContain("configured, but no provider answered");
    expect(view.body).toContain("HTTP 429");
    expect(view.title).not.toContain("Not Connected");
    expect(view.body).not.toContain("No stock provider is configured");
  });
});

describe("the banner's source of truth is the search route's own predicate", () => {
  const saved = { PIXABAY_API_KEY: process.env.PIXABAY_API_KEY, PEXELS_API_KEY: process.env.PEXELS_API_KEY };
  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  test("with PIXABAY_API_KEY set, Pixabay is reported configured — and it is video-only", () => {
    process.env.PIXABAY_API_KEY = "test-key-not-used";
    delete process.env.PEXELS_API_KEY;
    const availability = stockProviderAvailability();
    const pixabay = availability.providers.find((p) => p.id === "pixabay");
    expect(pixabay?.configured).toBe(true);
    expect(pixabay?.mediaTypes).toEqual(["video"]);
    expect(availability.connected.map((p) => p.id)).toContain("pixabay");
    expect(availability.connectedMediaTypes).toContain("video");
  });

  test("with no keys set, nothing is reported configured and the env names are the honest gap", () => {
    delete process.env.PIXABAY_API_KEY;
    delete process.env.PEXELS_API_KEY;
    const availability = stockProviderAvailability();
    const configuredIds = availability.connected.map((p) => p.id);
    expect(configuredIds).not.toContain("pixabay");
    expect(configuredIds).not.toContain("pexels");
    expect(availability.missing.flatMap((p) => p.requiredEnv)).toContain("PIXABAY_API_KEY");
  });
});
