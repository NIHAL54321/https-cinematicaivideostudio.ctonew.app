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
    /* The tree is returned UNWRAPPED, exactly like its sibling
     * `/api/projects/[id]/script`. It used to be `{ tree }`, while
     * `storyboard-tab.tsx` parsed the body as the tree itself — so `tree.script`
     * was always undefined and the tab rendered "No structure plan yet" on a
     * project whose header read "3 chapters · 6 scenes". One shape, one parser:
     * `readScriptTreeBody()` in src/lib/studio/storyboard-view.ts also accepts
     * the old shape, so a cached body cannot resurrect the false empty state. */
    return ok(tree);
  } catch (err) {
    return apiError(err);
  }
}
