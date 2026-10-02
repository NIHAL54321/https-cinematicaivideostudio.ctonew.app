import { ApiError, apiError, apiRateLimit, ok, readJson, requireApiUser } from "@/lib/api";
import { moveScene } from "@/lib/studio/storyboard";

export const runtime = "nodejs";

/**
 * POST /api/projects/[id]/scenes/[sceneId]/move — reorder a scene within its
 * chapter. Body: { direction: "up" | "down" }. Order changes persist; a
 * ProjectVersion snapshot is recorded.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string; sceneId: string }> }) {
  try {
    const userId = await requireApiUser();
    const { id, sceneId } = await ctx.params;
    await apiRateLimit(userId, "scenes:move", 60);
    const body = await readJson(req);
    const direction =
      typeof body === "object" && body !== null ? (body as Record<string, unknown>).direction : undefined;
    if (direction !== "up" && direction !== "down") {
      throw new ApiError(400, "direction must be \"up\" or \"down\".", "bad_input");
    }
    const result = await moveScene(userId, id, sceneId, direction);
    return ok(result);
  } catch (err) {
    return apiError(err);
  }
}
