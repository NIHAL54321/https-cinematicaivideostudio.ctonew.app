import { apiError, ok, requireApiUser } from "@/lib/api";
import { getScriptTree } from "@/lib/studio/pipeline";

export const runtime = "nodejs";

/**
 * GET /api/projects/[id]/storyboard — tenant-scoped storyboard tree for the
 * workspace Storyboard tab: Script → Chapters → Scenes with narration, exact
 * durations, template visual prompts, and the persisted structure-plan fields
 * (per-scene mediaType, camera, clips) plus project-level storyboard context
 * (target duration, music mood, subtitle default). Real data only.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiUser();
    const { id } = await ctx.params;
    const tree = await getScriptTree(userId, id);
    return ok({ tree });
  } catch (err) {
    return apiError(err);
  }
}
