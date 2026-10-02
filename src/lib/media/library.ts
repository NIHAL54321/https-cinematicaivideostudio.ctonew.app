/**
 * Phase 3 — Media Library view logic (pure, DB-free).
 *
 * Everything here is a pure function over "asset-like" rows, so the library
 * filtering / ranking / grouping rules can be unit-tested without a database.
 * `queryLibrary` in assets.ts does the tenant-scoped fetch and delegates to
 * `buildLibraryView`.
 *
 * NO fake data and NO AI here: this only groups / sorts / filters rows that
 * already exist in the user's library. Provider keys are referenced by NAME
 * only (never values).
 */
import type { LibraryKindFilter, LibraryAssetLike, LibraryMeta } from "./library-types";

const UPLOADED_KINDS = new Set(["IMAGE", "VIDEO", "AUDIO"]);
const GENERATED_KINDS = new Set(["GENERATED_IMAGE", "GENERATED_VIDEO"]);

/** Read the `metadata.library` envelope (favorites / collections / recents / tags). */
export function readLibraryMeta(metadata: unknown): LibraryMeta {
  const m = (metadata as Record<string, unknown> | null) ?? {};
  const lib = (m.library as Partial<LibraryMeta>) ?? {};
  return { favorite: false, collections: [], ...lib };
}

/** The user-declared upload category (image / video / audio / music / logo / brand). */
export function uploadCategory(asset: LibraryAssetLike): string | undefined {
  const up = ((asset.metadata as Record<string, unknown> | undefined)?.upload ?? {}) as Record<
    string,
    unknown
  >;
  const c = up.category;
  return typeof c === "string" && c.length ? c : undefined;
}

/** Human/source label + attribution for an asset (derived from real rows). */
export function assetSource(asset: LibraryAssetLike): {
  label: string;
  provider?: string;
  attribution?: string;
} {
  if (asset.stockAsset?.provider) {
    return {
      label: asset.stockAsset.provider,
      provider: asset.stockAsset.provider,
      attribution: asset.licensing?.attribution ?? undefined,
    };
  }
  if (uploadCategory(asset) || UPLOADED_KINDS.has(asset.kind)) {
    // Only a genuine user upload if it has upload metadata OR is clearly an
    // uploaded original (not a stock/generated row which carries other kinds).
    if (uploadCategory(asset) || !asset.stockAsset) {
      return { label: "User upload" };
    }
  }
  if (GENERATED_KINDS.has(asset.kind)) {
    return { label: "AI generated" };
  }
  return { label: "Media library" };
}

/** The text we search over: label, tags, source, attribution, provider. */
export function librarySearchText(asset: LibraryAssetLike): string {
  const parts: string[] = [asset.name];
  const lib = readLibraryMeta(asset.metadata);
  parts.push(...(lib.tags ?? []));
  const src = assetSource(asset);
  parts.push(src.label, src.provider ?? "", src.attribution ?? "");
  if (asset.metadata && typeof asset.metadata === "object") {
    const upload = (asset.metadata as Record<string, unknown>).upload as
      | Record<string, unknown>
      | undefined;
    if (typeof upload?.originalName === "string") parts.push(upload.originalName);
  }
  return parts
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Does an asset belong to the given library kind filter? */
export function matchesLibraryKind(
  asset: LibraryAssetLike,
  kind: LibraryKindFilter,
): boolean {
  switch (kind) {
    case "all":
      return true;
    case "image":
      return asset.kind === "IMAGE";
    case "video":
      return asset.kind === "VIDEO";
    case "audio":
      return asset.kind === "AUDIO";
    case "music":
      return asset.kind === "MUSIC";
    case "logo":
      return uploadCategory(asset) === "logo";
    case "brand":
      return uploadCategory(asset) === "brand";
    case "generated":
      // Some generated rows may carry GENERATED_* kind; otherwise fall back to
      // checking the generated relation rows (honest grouping, never fabricated).
      return GENERATED_KINDS.has(asset.kind) || Boolean(asset.generatedImage || asset.generatedVideo);
    case "stock":
      return Boolean(asset.stockAsset);
    case "uploaded":
      return (
        Boolean(uploadCategory(asset)) ||
        (UPLOADED_KINDS.has(asset.kind) && !asset.stockAsset && !asset.generatedImage && !asset.generatedVideo)
      );
    default:
      return true;
  }
}

function ts(v: string | Date | number | null | undefined): string {
  if (v == null) return "";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

/** Recency key: library lastUsedAt, else row updatedAt. */
function recencyKey(asset: LibraryAssetLike): string {
  return readLibraryMeta(asset.metadata).lastUsedAt ?? ts(asset.updatedAt);
}

function byRecency(a: LibraryAssetLike, b: LibraryAssetLike): number {
  return recencyKey(b).localeCompare(recencyKey(a));
}

export interface LibraryViewOptions {
  kind?: LibraryKindFilter;
  q?: string;
  favorite?: boolean;
  collection?: string;
  page?: number;
  pageSize?: number;
}

export interface LibraryViewSummary {
  items: LibraryAssetLike[];
  total: number;
  page: number;
  pageSize: number;
  filters: { kind: LibraryKindFilter; q: string; favorite: boolean; collection?: string };
  meta: {
    favoritesCount: number;
    collections: string[];
    recent: string[]; // asset ids, most-recently-used first
  };
}

/**
 * Filter, order, page and summarize a user's assets. Pure — callers pass real
 * rows fetched tenant-scoped. `recent` in meta always returns the most
 * recently-used asset ids across ALL the user's assets (the "Recent" rail).
 */
export function buildLibraryView(
  all: LibraryAssetLike[],
  opts: LibraryViewOptions = {},
): LibraryViewSummary {
  const kind: LibraryKindFilter = opts.kind ?? "all";
  const q = (opts.q ?? "").trim().toLowerCase();
  const favorite = opts.favorite === true;
  const collection = opts.collection && opts.collection.trim() ? opts.collection.trim() : undefined;
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(200, Math.max(1, opts.pageSize ?? 24));

  const filtered = all
    .filter((a) => {
      if (!matchesLibraryKind(a, kind)) return false;
      const lib = readLibraryMeta(a.metadata);
      if (favorite && !lib.favorite) return false;
      if (collection && !(lib.collections ?? []).includes(collection)) return false;
      if (q && !librarySearchText(a).includes(q)) return false;
      return true;
    })
    .sort(byRecency);

  const total = filtered.length;
  const start = (page - 1) * pageSize;
  const items = filtered.slice(start, start + pageSize);

  // Summary metadata is computed across ALL of the user's assets (not just the
  // filtered page) so the UI always reflects true favorite/collection/recent
  // counts regardless of the active filter.
  const favoriteSet = new Set<string>();
  const collectionSet = new Set<string>();
  for (const a of all) {
    if (readLibraryMeta(a.metadata).favorite) favoriteSet.add(a.id);
    for (const c of readLibraryMeta(a.metadata).collections ?? []) collectionSet.add(c);
  }
  const recent = [...all].sort(byRecency).slice(0, 8).map((a) => a.id);

  return {
    items,
    total,
    page,
    pageSize,
    filters: { kind, q: opts.q ?? "", favorite, collection },
    meta: {
      favoritesCount: favoriteSet.size,
      collections: [...collectionSet].sort(),
      recent,
    },
  };
}

export type { LibraryKindFilter, LibraryAssetLike, LibraryMeta };
