/**
 * GET    /api/projects/:id/music — the Music tab's view.
 * DELETE /api/projects/:id/music — clears the selection (rows deleted).
 * BLOCK M1, 2026-11-17.
 *
 * Ownership goes through the store's `readProject`, which scopes by `userId`
 * exactly like `getOwnedProject` — another account's project id is a 404 with
 * no detail, never a 403 that confirms the id exists.
 *
 * The GET payload carries the provider slots with their env var NAMES, the
 * current selection with its stored verdict, and counts read from this
 * project's own rows.
 */
import { apiError, ok, requireApiUser } from "@/lib/api";
import { clearMusic, loadMusicView, musicApiError, prismaMusicStore } from "@/lib/music/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiUser();
    const { id } = await ctx.params;
    const view = await loadMusicView({ userId, projectId: id }, { store: prismaMusicStore });
    return ok(view);
  } catch (err) {
    return apiError(musicApiError(err));
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiUser();
    const { id } = await ctx.params;
    const result = await clearMusic({ userId, projectId: id }, { store: prismaMusicStore });
    return ok({ deleted: result.deleted, view: result.view });
  } catch (err) {
    return apiError(musicApiError(err));
  }
}
