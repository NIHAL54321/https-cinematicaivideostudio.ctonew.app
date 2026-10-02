import { apiError, apiRateLimit, ok, requireApiUser } from "@/lib/api";
import { duplicateScene } from "@/lib/studio/storyboard";

export const runtime = "nodejs";

/**
 * POST /api/projects/[id]/scenes/[sceneId]/duplicate — copies the scene row
 * (new id, "(copy)" title, same narration/prompt/duration) inserted directly
 * after the original. A ProjectVersion snapshot is recorded.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string; sceneId: string }> }) {
  try {
    const userId = await requireApiUser();
    const { id, sceneId } = await ctx.params;
    await apiRateLimit(userId, "scenes:duplicate", 60);
    const result = await duplicateScene(userId, id, sceneId);
    return ok(result);
  } catch (err) {
    return apiError(err);
  }
}
