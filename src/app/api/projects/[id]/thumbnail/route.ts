/**
 * GET /api/projects/[id]/thumbnail
 * Phase 8 Audio/Subtitle/Thumbnail block, Block B, 2026-11-15.
 *
 * The Thumbnail tab's payload: the BRIEF the product would use (title, key text,
 * target frame — each naming the row and field it was read from), the plain
 * statement that no thumbnail image exists, and the capability's own provider
 * facts (which slots serve `thumbnail_generation`, which env var names would
 * enable it, and how many Thumbnail rows this project actually has).
 *
 * There is no POST here: no image provider is configured, so no route in this app
 * can produce a thumbnail and none pretends to.
 */
import { apiError, ok, requireApiUser } from "@/lib/api";
import { loadThumbnailView } from "@/lib/studio/thumbnail-view";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiUser();
    const { id } = await ctx.params;
    const view = await loadThumbnailView({ userId, projectId: id });
    return ok(view);
  } catch (err) {
    return apiError(err);
  }
}
