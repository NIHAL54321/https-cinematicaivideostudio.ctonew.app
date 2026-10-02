import { NextRequest } from "next/server";
import { apiError, apiRateLimit, ok, requireApiUser } from "@/lib/api";
import { jsonSafe } from "@/lib/media/util";
import { queryLibrary } from "@/lib/media/assets";
import type { LibraryKindFilter } from "@/lib/media/library-types";

export const runtime = "nodejs";

const LIBRARY_KINDS: LibraryKindFilter[] = [
  "all",
  "image",
  "video",
  "audio",
  "music",
  "logo",
  "brand",
  "generated",
  "stock",
  "uploaded",
];

/**
 * GET /api/media/library — tenant-scoped Media Library listing.
 *
 * Lists the caller's OWN assets (never any other tenant's) and filters /
 * searches / pages them with the real pure view logic (queryLibrary →
 * buildLibraryView). Favorites / collections / recents are derived from real
 * Asset.metadata rows. No fake data and no AI here.
 *
 * Query params: kind, q, favorite, collection, page, pageSize.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "media:library", 120);
    const sp = req.nextUrl.searchParams;

    const rawKind = sp.get("kind") ?? "all";
    const kind: LibraryKindFilter = (LIBRARY_KINDS as string[]).includes(rawKind)
      ? (rawKind as LibraryKindFilter)
      : "all";
    const q = sp.get("q") ?? undefined;
    const favorite = sp.get("favorite") === "true" || sp.get("favorite") === "1";
    const collection = sp.get("collection") ?? undefined;
    const page = Number(sp.get("page")) || undefined;
    const pageSize = Number(sp.get("pageSize")) || undefined;

    const view = await queryLibrary(userId, {
      kind,
      q,
      favorite,
      collection,
      page,
      pageSize,
    });

    return ok({
      connected: true,
      items: jsonSafe(view.items),
      total: view.total,
      page: view.page,
      pageSize: view.pageSize,
      filters: view.filters,
      meta: view.meta,
    });
  } catch (err) {
    return apiError(err);
  }
}
