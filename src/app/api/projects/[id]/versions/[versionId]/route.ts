import { NextRequest } from "next/server";
import { apiError, ok, requireApiUser } from "@/lib/api";
import { getVersion, versionSummary } from "@/lib/projects";

export const runtime = "nodejs";

/** GET /api/projects/[id]/versions/[versionId] — full snapshot details. */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string; versionId: string }> }) {
  try {
    const userId = await requireApiUser();
    const { id, versionId } = await ctx.params;
    const version = await getVersion(userId, id, versionId);
    return ok({ version: { ...versionSummary(version), snapshot: version.snapshot } });
  } catch (err) {
    return apiError(err);
  }
}
