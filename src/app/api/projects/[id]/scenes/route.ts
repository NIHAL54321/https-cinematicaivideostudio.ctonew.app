import { ApiError, apiError, apiRateLimit, ok, readJson, requireApiUser } from "@/lib/api";
import { addScene } from "@/lib/studio/storyboard";

export const runtime = "nodejs";

/**
 * POST /api/projects/[id]/scenes — add a scene to a chapter.
 * Body: { chapterId: string }
 * Inserts a real Scene row with an engine-derived default duration (budgeting.ts)
 * and a template visual prompt. narration stays null (AI territory). A
 * ProjectVersion snapshot is recorded.
 */
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiUser();
    const { id } = await ctx.params;
    await apiRateLimit(userId, "scenes:add", 60);
    const body = await readJson(req);
    const chapterId =
      typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).chapterId === "string"
        ? ((body as Record<string, unknown>).chapterId as string)
        : "";
    if (!chapterId) throw new ApiError(400, "chapterId is required.", "bad_input");
    const result = await addScene(userId, id, chapterId);
    return ok(result);
  } catch (err) {
    return apiError(err);
  }
}
