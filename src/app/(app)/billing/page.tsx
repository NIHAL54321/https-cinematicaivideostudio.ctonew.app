/**
 * `/billing` — what this account has used, what its ledger says, and what plans
 * exist (Phase 8, block 5).
 *
 * The page is a thin shell: `loadBillingOverview()` does every query and
 * `BillingOverviewView` renders what it returned. There is no figure in this
 * file and none in the component — a guard test scans both for a digit inside a
 * rendered text node and fails the build if one appears.
 *
 * THE PLANS SECTION IS THE POINT. Today no plan exists, and the page does not
 * draw an empty grid or a "coming soon" card: it prints the reason, which is
 * derived on this request from four probes (is a payment provider configured;
 * does any code path create a payment object; does any subscription row carry a
 * provider id; has the owner approved a plan). When those change, the sentence
 * changes with them.
 */
import { BillingOverviewView } from "@/components/billing-overview";
import { requireUser } from "@/lib/auth";
import { loadBillingOverview } from "@/lib/usage/overview";

export const metadata = { title: "Usage & credits" };
export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const session = await requireUser();
  const overview = await loadBillingOverview(session.userId);
  return <BillingOverviewView overview={overview} />;
}
