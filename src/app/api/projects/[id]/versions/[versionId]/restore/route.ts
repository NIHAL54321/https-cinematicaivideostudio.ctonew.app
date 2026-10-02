import { NextRequest } from "next/server";
import { apiError, apiRateLimit, ok, requireApiUser } from "@/lib/api";
import { restoreVersion } from "@/lib/projects";

export const runtime = "nodejs";

/** POST /api/projects/[id]/versions/[versionId]/restore — restore a snapshot. */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string; versionId: string }> }) {
  try {
    const userId = await requireApiUser();
    const { id, versionId } = await ctx.params;
    await apiRateLimit(userId, "projects:version", 60);
    const project = await restoreVersion(userId, id, versionId);
    return ok({ project });
  } catch (err) {
    return apiError(err);
  }
}
