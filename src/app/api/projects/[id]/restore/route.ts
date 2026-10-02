import { NextRequest } from "next/server";
import { apiError, apiRateLimit, ok, requireApiUser } from "@/lib/api";
import { restoreProject } from "@/lib/projects";

export const runtime = "nodejs";

/** POST /api/projects/[id]/restore — bring a trashed project back. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiUser();
    const { id } = await ctx.params;
    await apiRateLimit(userId, "projects:delete", 60);
    const project = await restoreProject(userId, id);
    return ok({ project });
  } catch (err) {
    return apiError(err);
  }
}
