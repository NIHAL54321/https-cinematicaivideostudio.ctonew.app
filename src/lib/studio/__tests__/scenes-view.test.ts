/**
 * The Scenes tab's pure view: what is sourced, what the summary says, and how a
 * search answer is read. No database, no provider, no browser.
 */
import { describe, expect, test } from "bun:test";
import {
  SOURCE_LABEL,
  licenceSentence,
  readSearchOutcome,
  scenesView,
  summarySentence,
} from "../scenes-view";
import type { ScriptTree, ScriptTreeSceneAsset } from "../pipeline";

function asset(over: Partial<ScriptTreeSceneAsset> = {}): ScriptTreeSceneAsset {
  return {
    id: "asset_1",
    name: "keyboard.mp4",
    kind: "VIDEO",
    role: "VISUAL",
    url: "https://cdn.example/keyboard.mp4",
    provider: "pixabay",
    externalId: "123456",
    pageUrl: "https://pixabay.com/videos/id-123456/",
    author: "Some Author",
    licenseType: "STOCK",
    licenseSource: "Pixabay",
    licenseUrl: "https://pixabay.com/service/license-summary/",
    storedBytes: true,
    sizeBytes: 1024,
    ...over,
  };
}

function scene(id: string, order: number, assets: ScriptTreeSceneAsset[] = []) {
  return {
    id,
    order,
    title: `Scene ${order}`,
    durationSeconds: 20,
    narration: "spoken",
    visualPrompt: "a laptop keyboard",
    status: "DRAFT",
    mediaType: "STOCK",
    camera: "wide",
    clips: null,
    assets,
  };
}

function tree(scenesByChapter: Array<{ title: string; scenes: ReturnType<typeof scene>[] }>): ScriptTree {
  return {
    script: {
      id: "script_1",
      title: "T",
      language: "en",
      style: "documentary",
      chapters: scenesByChapter.map((c, i) => ({
        id: `ch_${i}`,
        order: i + 1,
        title: c.title,
        summary: null,
        scenes: c.scenes,
      })),
    },
    meta: null,
  };
}

describe("scenesView", () => {
  test("numbers scenes across chapters and counts sourced vs unsourced from SceneAsset rows", () => {
    const view = scenesView(
      tree([
        { title: "One", scenes: [scene("s1", 1, [asset()]), scene("s2", 2)] },
        { title: "Two", scenes: [scene("s3", 1)] },
      ]),
    );
    if (view.kind !== "scenes") throw new Error("expected scenes");
    expect(view.scenes.map((s) => s.number)).toEqual([1, 2, 3]);
    expect(view.scenes.map((s) => s.chapterTitle)).toEqual(["One", "One", "Two"]);
    expect(view.scenes.map((s) => s.sourced)).toEqual([true, false, false]);
    expect(view.total).toBe(3);
    expect(view.sourced).toBe(1);
    expect(view.unsourced).toBe(2);
    expect(view.summary).toContain("1 of 3 scenes have a sourced clip, 2 do not");
    expect(view.summary).toContain("An unsourced scene blocks the render");
  });

  test("a project with no scenes is an honest empty state, not a zero summary", () => {
    const view = scenesView(tree([]));
    expect(view.kind).toBe("empty");
    const view2 = scenesView(null);
    expect(view2.kind).toBe("empty");
  });
});

describe("summarySentence", () => {
  test("says all sourced without claiming a match", () => {
    const s = summarySentence(6, 6);
    expect(s).toContain("All 6 scenes have a sourced clip");
    expect(s).toContain("not an illustration of its scene");
  });

  test("names the block when anything is unsourced", () => {
    const s = summarySentence(5, 6);
    expect(s).toContain("5 of 6 scenes have a sourced clip, 1 do not");
    expect(s).toContain("blocks the render");
  });
});

describe("SOURCE_LABEL", () => {
  test("says keyword-found stock, not an illustration", () => {
    expect(SOURCE_LABEL).toContain("Keyword-found stock");
    expect(SOURCE_LABEL).toContain("not an illustration of this scene");
  });
});

describe("readSearchOutcome", () => {
  const candidate = {
    provider: "pixabay",
    externalId: "1",
    title: "Keyboard",
    mediaType: "video",
    url: "https://cdn.example/k.mp4",
    width: 1920,
    height: 1080,
    author: "A",
    license: { type: "STOCK", source: "Pixabay", attributionRequired: false, attribution: "A", licenseUrl: "https://x" },
  };

  test("candidates are candidates", () => {
    const out = readSearchOutcome({
      status: "ok",
      candidates: [candidate],
      query: { keywords: "laptop keyboard" },
      providerResponses: [{ status: "ok", results: [candidate] }],
    });
    expect(out.kind).toBe("ok");
    if (out.kind !== "ok") return;
    expect(out.candidates).toHaveLength(1);
    expect(out.query).toBe("laptop keyboard");
  });

  test("no configured provider is not_connected and invents nothing", () => {
    const out = readSearchOutcome({ status: "not_connected", requiredEnv: ["PIXABAY_API_KEY"] });
    expect(out.kind).toBe("not_connected");
    if (out.kind !== "not_connected") return;
    expect(out.message).toContain("No stock provider is configured");
    expect(out.message).toContain("PIXABAY_API_KEY");
  });

  test("a provider refusal keeps the provider's own words and is never 'no results'", () => {
    const out = readSearchOutcome({
      status: "not_connected",
      requiredEnv: [],
      providerResponses: [{ status: "error", message: "pixabay: HTTP 429 rate limited" }],
    });
    expect(out.kind).toBe("provider_error");
    if (out.kind !== "provider_error") return;
    expect(out.message).toBe("pixabay: HTTP 429 rate limited");
  });

  test("an answered-but-empty result is 'empty', not a refusal", () => {
    const out = readSearchOutcome({
      status: "ok",
      candidates: [],
      providerResponses: [{ status: "ok", results: [] }],
    });
    expect(out.kind).toBe("empty");
  });

  test("a candidate missing its url or licence is not rendered as a candidate", () => {
    const out = readSearchOutcome({
      status: "ok",
      candidates: [{ ...candidate, url: undefined }],
      providerResponses: [{ status: "ok", results: [] }],
    });
    expect(out.kind).toBe("empty");
  });

  test("an unreadable body is an error, never an empty list", () => {
    expect(readSearchOutcome(null).kind).toBe("error");
    expect(readSearchOutcome("nope").kind).toBe("error");
    expect(readSearchOutcome({ status: "weird" }).kind).toBe("error");
  });
});

describe("licenceSentence", () => {
  test("states the stored licence", () => {
    expect(licenceSentence(asset())).toBe("Licence on record: STOCK from Pixabay.");
  });

  test("says when the record names no licence instead of assuming one", () => {
    expect(licenceSentence(asset({ licenseType: null }))).toContain("names no licence type");
    expect(licenceSentence(asset({ licenseSource: null }))).toContain("names no licence source");
  });
});
