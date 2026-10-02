import { apiError, apiRateLimit, ok, readJson, requireApiUser } from "@/lib/api";
import { deleteScene, parseScenePatch, updateScene } from "@/lib/studio/storyboard";

export const runtime = "nodejs";

/**
 * PATCH /api/projects/[id]/scenes/[sceneId] — edit a scene (tenant-scoped).
 * Body: { narration?: string | null, durationSeconds?: number, title?: string }
 * Narration/duration/title edits are real user content, persisted to the Scene
 * row; a ProjectVersion snapshot is written when something changed.
 */
export async function PATCH(req: Request, ctx: { params: Promise<{ id: string; sceneId: string }> }) {
  try {
    const userId = await requireApiUser();
    const { id, sceneId } = await ctx.params;
    await apiRateLimit(userId, "scenes:update", 120);
    const body = await readJson(req);
    const patch = parseScenePatch(body);
    const result = await updateScene(userId, id, sceneId, patch);
    return ok(result);
  } catch (err) {
    return apiError(err);
  }
}

/** DELETE /api/projects/[id]/scenes/[sceneId] — remove the scene row (tenant-scoped). */
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string; sceneId: string }> }) {
  try {
    const userId = await requireApiUser();
    const { id, sceneId } = await ctx.params;
    await apiRateLimit(userId, "scenes:delete", 60);
    const result = await deleteScene(userId, id, sceneId);
    return ok(result);
  } catch (err) {
    return apiError(err);
  }
}
