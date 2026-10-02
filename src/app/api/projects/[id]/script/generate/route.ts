import { apiError, apiRateLimit, ok, requireApiUser } from "@/lib/api";
import { generateScript } from "@/lib/studio/pipeline";

export const runtime = "nodejs";

/**
 * POST /api/projects/[id]/script/generate — "Generate Script (AI)".
 *
 * Calls the AI Model Orchestrator with the real project context. With no
 * provider wired, the orchestrator returns its honest "Provider Not Connected"
 * result (status + required env var names); the workspace renders exactly
 * that. Nothing is ever simulated.
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiUser();
    const { id } = await ctx.params;
    await apiRateLimit(userId, "studio:script", 30);
    const result = await generateScript(userId, id);
    return ok({ result });
  } catch (err) {
    return apiError(err);
  }
}
