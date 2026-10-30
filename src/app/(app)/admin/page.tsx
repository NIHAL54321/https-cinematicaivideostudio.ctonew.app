/**
 * `/admin` — the operator surface (Phase 8, block 4).
 *
 * The guard runs BEFORE the loader, so an ordinary signed-in account never
 * reaches a query: `requireAdminPage()` renders the app's own 404 for them (a
 * 403 would confirm the surface exists) and redirects an anonymous visitor to
 * /signin, exactly like every other page behind the app shell.
 *
 * The page reads `loadAdminOverview()` — the SAME function
 * `GET /api/studio/admin/overview` returns — so the page and the API cannot
 * disagree, and the component it renders carries no figure of its own.
 */
import { AdminOverviewView } from "@/components/admin-overview";
import { requireAdminPage } from "@/lib/admin/guard";
import { loadAdminOverview } from "@/lib/admin/overview";
import { buildAdminViewModel } from "@/lib/admin/view-model";

export const dynamic = "force-dynamic";

export const metadata = { title: "Operator overview" };

export default async function AdminPage() {
  const session = await requireAdminPage();
  const overview = await loadAdminOverview(session.userId);
  return <AdminOverviewView model={buildAdminViewModel(overview)} />;
}
