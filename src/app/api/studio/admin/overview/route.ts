/**
 * GET /api/studio/admin/overview — the operator surface's data (Phase 8, block 4).
 *
 * Three answers, and they are three DIFFERENT answers on purpose:
 *   anonymous            → 401 {"error":"Authentication required.","code":"unauthenticated"}
 *   signed in, ordinary  → 404 {"error":"Not found.","code":"not_found"} — never 403, and
 *                          never a partial object, because a 403 (or a half-filled
 *                          body) would confirm an operator surface exists here.
 *   admin                → 200 with the whole derived overview, no-store.
 *
 * The body is the same object the /admin page renders: `loadAdminOverview()` is
 * called by both, so a reader comparing the JSON with the page is comparing one
 * derivation with itself.
 */
import { apiError } from "@/lib/api";
import { requireAdminApiUser } from "@/lib/admin/guard";
import { loadAdminOverview } from "@/lib/admin/overview";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireAdminApiUser();
    const overview = await loadAdminOverview(userId);
    return Response.json(overview, { headers: { "cache-control": "private, no-store" } });
  } catch (err) {
    return apiError(err);
  }
}
