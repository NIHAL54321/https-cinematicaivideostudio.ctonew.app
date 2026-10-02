import { NextRequest } from "next/server";
import { apiError, apiRateLimit, ok, requireApiUser } from "@/lib/api";
import { duplicateProject } from "@/lib/projects";

export const runtime = "nodejs";

/** POST /api/projects/[id]/duplicate — deep copy with " (Copy)" title. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiUser();
    const { id } = await ctx.params;
    await apiRateLimit(userId, "projects:duplicate", 30);
    const project = await duplicateProject(userId, id);
    return ok({ project }, 201);
  } catch (err) {
    return apiError(err);
  }
}
