import { apiError, ok, requireApiUser } from "@/lib/api";
import { getScriptTree } from "@/lib/studio/pipeline";

export const runtime = "nodejs";

/**
 * GET /api/projects/[id]/script — tenant-scoped script tree for the
 * workspace Script tab: Script → Chapters → Scenes with real durations,
 * template visual prompts and (null until a provider is connected) narration.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiUser();
    const { id } = await ctx.params;
    const tree = await getScriptTree(userId, id);
    return ok(tree);
  } catch (err) {
    return apiError(err);
  }
}
