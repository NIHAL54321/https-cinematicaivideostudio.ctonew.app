/**
 * Shared types for the Media Library view logic. Kept separate from
 * library.ts so both the pure helpers and the persistence layer (assets.ts)
 * can import them without circularity.
 */

/** The `metadata.library` envelope stored on each Asset row. */
export interface LibraryMeta {
  favorite?: boolean;
  collections?: string[];
  lastUsedAt?: string; // ISO — "recents" ordering
  tags?: string[];
}

/** The UI-facing library kind filters. */
export type LibraryKindFilter =
  | "all"
  | "image"
  | "video"
  | "audio"
  | "music"
  | "logo"
  | "brand"
  | "generated"
  | "stock"
  | "uploaded";

/**
 * Structural view of an Asset row that the pure helpers operate on. Anything
 * that isn't needed for filtering is optional so tests can pass minimal
 * objects.
 */
export interface LibraryAssetLike {
  id: string;
  kind: string;
  name: string;
  mimeType?: string | null;
  url?: string | null;
  metadata?: Record<string, unknown> | null;
  updatedAt?: string | Date | number | null;
  stockAsset?: { provider?: string | null; externalId?: string | null } | null;
  generatedImage?: unknown | null;
  generatedVideo?: unknown | null;
  licensing?: { attribution?: string | null; source?: string | null; licenseType?: string | null } | null;
}
