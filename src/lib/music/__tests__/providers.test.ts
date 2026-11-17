/**
 * Provider layer — mapping against a recorded fixture, the registry, and the
 * two unwired slots. No network: the fixture was recorded live on 2026-11-17
 * (endpoint recorded inside the file) and only the fields the adapter reads
 * were kept.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import fixture from "./fixtures/audius-search.json";
import { mapAudiusTrack, audiusProvider } from "../providers/audius";
import { DEFAULT_MUSIC_PROVIDER_ID, musicProvider, musicProviders } from "../providers";
import { ProviderNotConfiguredError, UnknownMusicProviderError } from "../providers/types";

const recorded = fixture as {
  _recorded: { endpoint: string; at: string };
  data: Array<Record<string, unknown>>;
};

describe("audius mapping (recorded fixture)", () => {
  test("the fixture is the recorded shape, not a hand-written stub", () => {
    expect(recorded.data.length).toBe(3);
    expect(recorded._recorded.endpoint).toContain("api.audius.co/v1/tracks/search");
  });

  test("every field of the normalised shape comes from the provider object", () => {
    const track = mapAudiusTrack(recorded.data[0] as never);
    expect(track.providerId).toBe("audius");
    expect(track.providerTrackId).toBe("93v00");
    expect(track.title).toBe("Star Hunter (Cinematic Synthwave)");
    expect(track.artist).toBe("Blythelyبب");
    expect(track.artistHandle).toBe("brokenblythe");
    expect(track.durationSeconds).toBe(292);
    expect(track.genre).toBe("Soundtrack");
    expect(track.mood).toBe("Gritty");
    expect(track.licenceText).toBe("All rights reserved");
    expect(track.isStreamable).toBe(true);
    expect(track.isGated).toBe(false);
    expect(track.permalink).toBe("/brokenblythe/star-hunter-cinematic-synthwave");
  });

  test("a null licence stays null — it is not invented", () => {
    const track = mapAudiusTrack(recorded.data[1] as never);
    expect(track.licenceText).toBeNull();
  });

  test("a missing is_streamable is read as NOT streamable, never as playable", () => {
    const track = mapAudiusTrack({ id: "x", title: "t" });
    expect(track.isStreamable).toBe(false);
    expect(track.isGated).toBe(false);
    expect(track.artist).toBeNull();
    expect(track.durationSeconds).toBeNull();
  });

  test("a track with no id is refused rather than mapped to a blank row", () => {
    expect(() => mapAudiusTrack({ title: "no id" })).toThrow();
  });

  test("the preview URL is a provider URL built server-side and carries the app name", () => {
    const url = audiusProvider.previewUrl("93v00");
    expect(url.startsWith("https://api.audius.co/v1/tracks/93v00/stream?")).toBe(true);
    expect(url).toContain("app_name=");
    // The app ADDRESS is not sent anywhere: no key value can appear in this URL.
    expect(url.toLowerCase()).not.toContain("0x");
  });
});

describe("the provider registry", () => {
  test("three slots, and Audius is the default", () => {
    const ids = musicProviders().map((p) => p.id);
    expect(ids).toEqual(["audius", "epidemic", "unminus"]);
    expect(DEFAULT_MUSIC_PROVIDER_ID).toBe("audius");
  });

  test("audius needs no credential for a read", () => {
    expect(audiusProvider.isConfigured()).toBe(true);
    expect(audiusProvider.requiredEnv).toEqual(["AUDIUS_APP_NAME", "AUDIUS_API_KEY"]);
  });

  test("an unknown id is a typed error, never a fallback", () => {
    expect(() => musicProvider("spotify")).toThrow(UnknownMusicProviderError);
  });

  test("the unwired slots say so and name the env vars they would need", async () => {
    for (const id of ["epidemic", "unminus"]) {
      const provider = musicProvider(id);
      expect(provider.isConfigured()).toBe(false);
      expect(provider.requiredEnv.length).toBeGreaterThan(0);
      let caught: unknown = null;
      try {
        await provider.search({ q: "cinematic", limit: 5 });
      } catch (err) {
        caught = err;
      }
      expect(caught).toBeInstanceOf(ProviderNotConfiguredError);
      const error = caught as ProviderNotConfiguredError;
      expect(error.requiredEnv).toEqual(provider.requiredEnv);
      expect(error.message).toContain(provider.requiredEnv[0]);
      // track() and previewUrl() refuse the same way — never an empty answer.
      expect(() => provider.previewUrl("1")).toThrow(ProviderNotConfiguredError);
    }
  });

  test("no component under src/components references the provider env names", () => {
    const root = join(import.meta.dir, "../../../components");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(name)) continue;
        const text = readFileSync(full, "utf8");
        if (text.includes("AUDIUS_API_KEY") || text.includes("AUDIUS_APP_NAME")) offenders.push(full);
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});
