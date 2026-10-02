import { NextRequest } from "next/server";
import { apiError, apiRateLimit, ok, readJson, requireApiUser } from "@/lib/api";
import { createVersion, getOwnedProject, listVersions } from "@/lib/projects";

export const runtime = "nodejs";

/** GET /api/projects/[id]/versions — snapshot history (newest first). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiUser();
    const { id } = await ctx.params;
    const versions = await listVersions(userId, id);
    return ok({ versions });
  } catch (err) {
    return apiError(err);
  }
}

/** POST /api/projects/[id]/versions — capture a snapshot on demand. */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiUser();
    const { id } = await ctx.params;
    await apiRateLimit(userId, "projects:version", 60);
    await getOwnedProject(userId, id); // tenant check before any write
    const body = await readJson(req);
    const note =
      typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).note === "string"
        ? ((body as Record<string, unknown>).note as string).trim().slice(0, 200)
        : null;
    const versionId = await createVersion(id, note || "Snapshot saved manually", userId);
    const versions = await listVersions(userId, id);
    return ok({ versionId, versions }, 201);
  } catch (err) {
    return apiError(err);
  }
}
