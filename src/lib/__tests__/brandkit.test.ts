import { describe, expect, test } from "bun:test";
import {
  buildBrandDefaultsPatch,
  deepEqual,
  mergeBrandBlock,
  mergeBrandKitIntoSettings,
  normalizeHex,
  parseBrandKitInput,
  type KitLike,
} from "../brandkit";

function kit(partial: Partial<KitLike> = {}): KitLike {
  return {
    name: "Acme",
    colors: null,
    fonts: null,
    voicePreferences: null,
    subtitlePreferences: null,
    musicPreferences: null,
    thumbnailPreferences: null,
    logoAssetId: null,
    introAssetId: null,
    outroAssetId: null,
    watermarkAssetId: null,
    watermarkEnabled: false,
    introDurationSeconds: null,
    outroDurationSeconds: null,
    ...partial,
  };
}

describe("normalizeHex", () => {
  test("normalizes #rgb and #rrggbb to lowercase 6-digit", () => {
    expect(normalizeHex("#F80")).toBe("#ff8800");
    expect(normalizeHex("#E8B45A")).toBe("#e8b45a");
  });
  test("returns undefined for invalid values", () => {
    expect(normalizeHex("red")).toBeUndefined();
    expect(normalizeHex("#12345")).toBeUndefined();
    expect(normalizeHex(42)).toBeUndefined();
  });
});

describe("parseBrandKitInput", () => {
  test("parses a full kit body", () => {
    const out = parseBrandKitInput({
      name: "  My Brand  ",
      colors: { primary: "#F80", accent: "#e8b45a" },
      fonts: { heading: "Space Grotesk" },
      voicePreferences: { language: "en", gender: "female", sampleRate: 44100, pitch: 1.1, speed: 0.9 },
      thumbnailPreferences: { template: "bold" },
      watermark: { enabled: true, assetId: "a1" },
      intro: { assetId: "i1", durationSeconds: 5 },
    });
    expect(out.name).toBe("My Brand");
    expect(out.colors).toEqual({ primary: "#ff8800", accent: "#e8b45a" });
    expect(out.voicePreferences?.sampleRate).toBe(44100);
    expect(out.watermark).toEqual({ enabled: true, assetId: "a1" });
    expect(out.intro).toEqual({ assetId: "i1", durationSeconds: 5 });
  });
  test("rejects invalid hex and out-of-range values", () => {
    expect(() => parseBrandKitInput({ colors: { primary: "nope" } })).toThrow();
    expect(() => parseBrandKitInput({ voicePreferences: { sampleRate: 99 } })).toThrow();
    expect(() => parseBrandKitInput({ voicePreferences: { language: "xx" } })).toThrow();
  });
  test("handles null clears and partial inputs", () => {
    const out = parseBrandKitInput({ colors: null, name: "X" });
    expect(out.colors).toBeNull();
    expect(out.name).toBe("X");
    expect(out.voicePreferences).toBeUndefined();
  });
});

describe("buildBrandDefaultsPatch", () => {
  test("builds voice/subtitle/music/extra blocks from JSON prefs", () => {
    const patch = buildBrandDefaultsPatch(
      kit({
        colors: { primary: "#e8b45a" } as unknown as null,
        fonts: { heading: "Space Grotesk" } as unknown as null,
        voicePreferences: { language: "es", gender: "male", sampleRate: 48000 } as unknown as null,
        subtitlePreferences: { style: "clean", size: 48 } as unknown as null,
        musicPreferences: { mood: "epic", volume: 70 } as unknown as null,
        thumbnailPreferences: { template: "bold" } as unknown as null,
        watermarkEnabled: true,
        watermarkAssetId: "w1",
        introAssetId: "i1",
        introDurationSeconds: 4,
      }),
    );
    expect(patch.language).toBe("es");
    expect(patch.voiceoverDefaults).toEqual({ language: "es", gender: "male", sampleRate: 48000 });
    expect(patch.subtitleDefaults).toEqual({ style: "clean", size: 48 });
    expect(patch.musicDefaults).toEqual({ mood: "epic", volume: 70 });
    expect(patch.extra?.brand).toMatchObject({
      colors: { primary: "#e8b45a" },
      fonts: { heading: "Space Grotesk" },
      watermark: { enabled: true, assetId: "w1" },
      intro: { assetId: "i1", durationSeconds: 4 },
      thumbnail: { template: "bold" },
    });
  });
  test("returns no patch for an empty kit", () => {
    expect(buildBrandDefaultsPatch(kit())).toEqual({});
  });
});

describe("mergeBrandKitIntoSettings", () => {
  const filled = kit({
    colors: { primary: "#111111" } as unknown as null,
    voicePreferences: { language: "fr", gender: "female", sampleRate: 44100 } as unknown as null,
    subtitlePreferences: { style: "pop", size: 60 } as unknown as null,
    musicPreferences: { mood: "calm", volume: 40 } as unknown as null,
    watermarkEnabled: true,
  });

  test("fills gaps when project settings are unset", () => {
    const patch = mergeBrandKitIntoSettings(filled, null);
    expect(patch.language).toBe("fr");
    expect(patch.voiceoverDefaults).toMatchObject({ gender: "female" });
    expect(patch.subtitleDefaults).toMatchObject({ style: "pop" });
    expect(patch.musicDefaults?.volume).toBe(40);
    expect(patch.extra?.brand).toMatchObject({ watermark: { enabled: true } });
  });

  test("explicit project settings win over kit defaults", () => {
    const existing = {
      language: "de",
      voiceoverDefaults: { gender: "male" },
      subtitleDefaults: { style: "classic" },
      musicDefaults: { volume: 90 },
      extra: null,
    };
    const patch = mergeBrandKitIntoSettings(filled, existing);
    // language: non-default explicit value wins
    expect(patch.language).toBeUndefined();
    // per-key merge: project gender wins, kit sampleRate fills the gap
    expect(patch.voiceoverDefaults).toMatchObject({ gender: "male", sampleRate: 44100 });
    expect(patch.voiceoverDefaults?.language).toBe("fr");
    expect(patch.subtitleDefaults).toMatchObject({ style: "classic", size: 60 });
    expect(patch.musicDefaults?.volume).toBe(90);
    expect(patch.musicDefaults?.mood).toBe("calm");
  });

  test("kit language beats the column default 'en' (not an explicit choice)", () => {
    const patch = mergeBrandKitIntoSettings(filled, { language: "en", voiceoverDefaults: null, subtitleDefaults: null, musicDefaults: null, extra: null });
    expect(patch.language).toBe("fr");
  });

  test("no-op apply returns no fields (nothing to change)", () => {
    const first = mergeBrandKitIntoSettings(filled, null);
    // feed the applied values back as "existing" → merge should be empty
    const reapply = mergeBrandKitIntoSettings(filled, {
      language: first.language ?? null,
      voiceoverDefaults: (first.voiceoverDefaults ?? null) as never,
      subtitleDefaults: (first.subtitleDefaults ?? null) as never,
      musicDefaults: (first.musicDefaults ?? null) as never,
      extra: (first.extra ?? null) as never,
    });
    expect(Object.keys(reapply).length).toBe(0);
  });
});

describe("mergeBrandBlock", () => {
  test("project brand sub-values win, kit fills the rest", () => {
    const merged = mergeBrandBlock(
      { brand: { colors: { primary: "#aaaaaa" }, fonts: { heading: "Inter" }, watermark: { enabled: true } } },
      { brand: { colors: { primary: "#ffffff" }, outro: { assetId: "o1" } } },
    );
    expect(merged?.brand).toMatchObject({
      colors: { primary: "#ffffff" },
      fonts: { heading: "Inter" },
      watermark: { enabled: true },
      outro: { assetId: "o1" },
    });
  });
  test("returns undefined when both blocks are empty", () => {
    expect(mergeBrandBlock(undefined, undefined)).toBeUndefined();
  });
});

describe("deepEqual", () => {
  test("compares plain JSON values", () => {
    expect(deepEqual({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual([1, 2], [1, 3])).toBe(false);
  });
});
