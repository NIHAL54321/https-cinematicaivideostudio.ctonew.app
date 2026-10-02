import { ApiError, apiError, apiRateLimit, ok, readJson, requireApiUser } from "@/lib/api";
import { replaceVisual } from "@/lib/studio/storyboard";

export const runtime = "nodejs";

/**
 * POST /api/projects/[id]/scenes/[sceneId]/visual — replace the scene's visual.
 * Body: { mode: "template" | "ai" } (default "template").
 *
 * - template: deterministic re-roll of the visual prompt via visual-prompts.ts
 *   (structure, labeled template). Persisted to the Scene row.
 * - ai: routes through the AI Model Orchestrator (image_generation). Phase 1
 *   honestly returns its real result — "Provider Not Connected" — and nothing
 *   is persisted or fabricated.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string; sceneId: string }> }) {
  try {
    const userId = await requireApiUser();
    const { id, sceneId } = await ctx.params;
    await apiRateLimit(userId, "scenes:visual", 30);
    const body = await readJson(req);
    const mode =
      typeof body === "object" && body !== null ? (body as Record<string, unknown>).mode : undefined;
    if (mode !== "template" && mode !== "ai") {
      throw new ApiError(400, "mode must be \"template\" or \"ai\".", "bad_input");
    }
    const result = await replaceVisual(userId, id, sceneId, mode);
    return ok(result);
  } catch (err) {
    return apiError(err);
  }
}
