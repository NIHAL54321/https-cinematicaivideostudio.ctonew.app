import { apiError, apiRateLimit, ok, requireApiUser } from "@/lib/api";
import { regenerateScene } from "@/lib/studio/storyboard";

export const runtime = "nodejs";

/**
 * POST /api/projects/[id]/scenes/[sceneId]/regenerate — "Regenerate scene (AI)".
 * Routes through the AI Model Orchestrator (STORYBOARD → reasoning) with the
 * real scene context. With no provider wired, the orchestrator returns its
 * honest "Provider Not Connected" result (status + required env var names);
 * the storyboard renders exactly that. Nothing is ever simulated.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string; sceneId: string }> }) {
  try {
    const userId = await requireApiUser();
    const { id, sceneId } = await ctx.params;
    await apiRateLimit(userId, "scenes:regenerate", 30);
    const result = await regenerateScene(userId, id, sceneId);
    return ok(result);
  } catch (err) {
    return apiError(err);
  }
}
