import { apiError, apiRateLimit, ok, requireApiUser } from "@/lib/api";
import { generateHook } from "@/lib/studio/pipeline";

export const runtime = "nodejs";

/**
 * POST /api/projects/[id]/hook/generate — "Generate Hook (AI)".
 *
 * Routes a hook-generation request through the AI Model Orchestrator
 * (reasoning capability). Phase 1: honest "Provider Not Connected" result.
 * (Template-based hook options are also available client-side via
 * src/lib/studio/hooks.ts and are always labeled as templates.)
 */
export async function POST(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiUser();
    const { id } = await ctx.params;
    await apiRateLimit(userId, "studio:hook", 30);
    const result = await generateHook(userId, id);
    return ok({ result });
  } catch (err) {
    return apiError(err);
  }
}
