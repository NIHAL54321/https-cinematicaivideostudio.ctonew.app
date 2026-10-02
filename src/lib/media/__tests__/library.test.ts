import { describe, expect, test } from "bun:test";
import {
  buildLibraryView,
  matchesLibraryKind,
  uploadCategory,
  assetSource,
} from "../library";
import type { LibraryAssetLike } from "../library-types";

let seq = 0;
function asset(partial: Partial<LibraryAssetLike> & { kind: string; name: string }): LibraryAssetLike {
  seq += 1;
  return {
    id: `asset-${seq}`,
    kind: partial.kind,
    name: partial.name,
    metadata: partial.metadata ?? null,
    updatedAt: partial.updatedAt ?? `2026-08-${String((seq % 28) + 1).padStart(2, "0")}T00:00:00Z`,
    stockAsset: partial.stockAsset ?? null,
    generatedImage: partial.generatedImage ?? null,
    generatedVideo: partial.generatedVideo ?? null,
    licensing: partial.licensing ?? null,
  };
}

const fav = (meta: Record<string, unknown>) => ({ library: { favorite: true, ...meta } });

describe("buildLibraryView: kind filtering", () => {
  test("all returns everything", () => {
    const rows = [
      asset({ kind: "IMAGE", name: "a" }),
      asset({ kind: "VIDEO", name: "b" }),
      asset({ kind: "AUDIO", name: "c" }),
    ];
    expect(buildLibraryView(rows, { kind: "all" }).items.length).toBe(3);
  });
  test("image / video / audio map to AssetKind", () => {
    const rows = [asset({ kind: "IMAGE", name: "a" }), asset({ kind: "VIDEO", name: "b" }), asset({ kind: "AUDIO", name: "c" })];
    expect(buildLibraryView(rows, { kind: "image" }).items.map((i) => i.name)).toEqual(["a"]);
    expect(buildLibraryView(rows, { kind: "video" }).items.map((i) => i.name)).toEqual(["b"]);
    expect(buildLibraryView(rows, { kind: "audio" }).items.map((i) => i.name)).toEqual(["c"]);
  });
  test("stock groups by stockAsset relation", () => {
    const rows = [
      asset({ kind: "IMAGE", name: "stocky", stockAsset: { provider: "pexels", externalId: "x" } }),
      asset({ kind: "IMAGE", name: "own" }),
    ];
    expect(buildLibraryView(rows, { kind: "stock" }).items.length).toBe(1);
    expect(buildLibraryView(rows, { kind: "stock" }).items[0].name).toBe("stocky");
  });
  test("generated groups by GENERATED_* kind or generated relations", () => {
    const rows = [
      asset({ kind: "GENERATED_IMAGE", name: "g1" }),
      asset({ kind: "IMAGE", name: "g2", generatedImage: { id: "x" } }),
      asset({ kind: "IMAGE", name: "not" }),
    ];
    const view = buildLibraryView(rows, { kind: "generated" });
    expect(view.items.length).toBe(2);
    expect(view.items.map((i) => i.name).sort()).toEqual(["g1", "g2"]);
  });
  test("uploaded groups by upload category or plain original kind", () => {
    const rows = [
      asset({ kind: "IMAGE", name: "u1", metadata: { upload: { originalName: "me.jpg" } } }),
      asset({ kind: "VIDEO", name: "u2" }),
      asset({ kind: "IMAGE", name: "stock", stockAsset: { provider: "pexels", externalId: "x" } }),
    ];
    const view = buildLibraryView(rows, { kind: "uploaded" });
    expect(view.items.map((i) => i.name).sort()).toEqual(["u1", "u2"]);
  });
  test("logo/brand group by upload category", () => {
    const rows = [
      asset({ kind: "IMAGE", name: "logo", metadata: { upload: { category: "logo" } } }),
      asset({ kind: "IMAGE", name: "brand", metadata: { upload: { category: "brand" } } }),
      asset({ kind: "IMAGE", name: "other" }),
    ];
    expect(buildLibraryView(rows, { kind: "logo" }).items[0].name).toBe("logo");
    expect(buildLibraryView(rows, { kind: "brand" }).items[0].name).toBe("brand");
  });
});

describe("buildLibraryView: favorite / collection / search", () => {
  test("favorite filter only returns favorited assets, counts across all", () => {
    const rows = [
      asset({ kind: "IMAGE", name: "f", metadata: fav({}) }),
      asset({ kind: "IMAGE", name: "nf" }),
    ];
    const view = buildLibraryView(rows, { favorite: true });
    expect(view.items.map((i) => i.name)).toEqual(["f"]);
    expect(view.meta.favoritesCount).toBe(1);
  });
  test("collection filter + meta.collections lists every collection", () => {
    const rows = [
      asset({ kind: "IMAGE", name: "a", metadata: { library: { collections: ["drafts", "final"] } } }),
      asset({ kind: "IMAGE", name: "b", metadata: { library: { collections: ["final"] } } }),
      asset({ kind: "IMAGE", name: "c" }),
    ];
    const view = buildLibraryView(rows, { collection: "final" });
    expect(view.items.length).toBe(2);
    expect(view.meta.collections).toEqual(["drafts", "final"]);
  });
  test("search matches name, tags, source/attribution", () => {
    const rows = [
      asset({ kind: "IMAGE", name: "Sunset over hills", metadata: { library: { tags: ["golden", "nature"] } } }),
      asset({ kind: "IMAGE", name: "Portrait", stockAsset: { provider: "unsplash", externalId: "x" } }),
    ];
    expect(buildLibraryView(rows, { q: "golden" }).items[0].name).toBe("Sunset over hills");
    expect(buildLibraryView(rows, { q: "unsplash" }).items[0].name).toBe("Portrait");
    expect(buildLibraryView(rows, { q: "nope" }).items.length).toBe(0);
  });
});

describe("buildLibraryView: paging + meta.recent", () => {
  const rows = Array.from({ length: 10 }, (_, i) =>
    asset({ kind: "IMAGE", name: `img-${i}`, updatedAt: `2026-08-${String(i + 1).padStart(2, "0")}T00:00:00Z` }),
  );
  test("paging pages by recency", () => {
    const view = buildLibraryView(rows, { page: 2, pageSize: 4 });
    expect(view.total).toBe(10);
    expect(view.items.length).toBe(4);
    expect(view.page).toBe(2);
    // Ordered newest-first (updatedAt desc) so page 2 is ids 5..8.
    expect(view.items[0].name).toBe("img-5");
  });
  test("meta.recent returns most recently used ids across all", () => {
    const view = buildLibraryView(rows, { kind: "image", q: "img-1" });
    expect(view.meta.recent.length).toBeGreaterThan(0);
    // Recent is computed from ALL rows regardless of the applied filter.
    expect(view.meta.recent[0]).toBe("asset-10");
  });
});

describe("library helpers", () => {
  test("uploadCategory reads metadata.upload.category", () => {
    expect(uploadCategory(asset({ kind: "IMAGE", name: "x", metadata: { upload: { category: "logo" } } }))).toBe("logo");
    expect(uploadCategory(asset({ kind: "IMAGE", name: "y" }))).toBeUndefined();
  });
  test("assetSource labels stock vs upload vs generated honestly", () => {
    expect(assetSource(asset({ kind: "IMAGE", name: "s", stockAsset: { provider: "pexels", externalId: "x" } })).label).toBe("pexels");
    expect(assetSource(asset({ kind: "IMAGE", name: "u", metadata: { upload: { originalName: "a.jpg" } } })).label).toBe("User upload");
    expect(assetSource(asset({ kind: "GENERATED_IMAGE", name: "g" })).label).toBe("AI generated");
  });
  test("matchesLibraryKind is exhaustive and safe", () => {
    const row = asset({ kind: "IMAGE", name: "x" });
    expect(matchesLibraryKind(row, "all")).toBe(true);
    expect(matchesLibraryKind(row, "video")).toBe(false);
  });
});
