/**
 * GET /api/studio/billing — this account's usage, ledger and plan read-out
 * (Phase 8, block 5).
 *
 *   anonymous → 401 {"error":"Authentication required.","code":"unauthenticated"}
 *   signed in → 200 with the whole derived overview, no-store.
 *
 * There is no request body and no query parameter that changes what is returned:
 * the only account this route can describe is the caller's own. It is the SAME
 * object `/billing` renders — both call `loadBillingOverview()` — so a reader
 * comparing the JSON with the page is comparing one derivation with itself.
 *
 * WHAT IT CANNOT RETURN, and never will from this file: a plan, a price, a
 * subscription status or a balance that is not the sum of this account's own
 * ledger rows. The plans array is empty on this deployment because no product
 * exists, and `plans.emptyReason` says so in words.
 */
import { apiError, requireApiUser } from "@/lib/api";
import { loadBillingOverview } from "@/lib/usage/overview";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireApiUser();
    const overview = await loadBillingOverview(userId);
    return Response.json(overview, { headers: { "cache-control": "private, no-store" } });
  } catch (err) {
    return apiError(err);
  }
}
