import { NextRequest } from "next/server";
import { apiError, apiRateLimit, ok, requireApiUser } from "@/lib/api";
import { permanentDeleteProject } from "@/lib/projects";

export const runtime = "nodejs";

/** DELETE /api/projects/[id]/permanent — hard delete (trash only). */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiUser();
    const { id } = await ctx.params;
    await apiRateLimit(userId, "projects:delete", 60);
    await permanentDeleteProject(userId, id);
    return ok({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
