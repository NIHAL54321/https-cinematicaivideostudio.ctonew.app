import { NextRequest } from "next/server";
import {
  apiError,
  apiRateLimit,
  ok,
  readJson,
  requireApiUser,
} from "@/lib/api";
import {
  getProjectDetail,
  parseProjectPatch,
  softDeleteProject,
  updateProjectAndVersion,
} from "@/lib/projects";

export const runtime = "nodejs";

/** GET /api/projects/[id] — single project detail (tenant-scoped). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiUser();
    const { id } = await ctx.params;
    const project = await getProjectDetail(userId, id);
    return ok({ project });
  } catch (err) {
    return apiError(err);
  }
}

/**
 * PATCH /api/projects/[id] — auto-save update.
 * Body: { project: { title?, description?, status?, targetAspectRatio?,
 *        targetDurationSeconds? }, settings?: { ... } }
 * Only provided fields are touched. A ProjectVersion snapshot is written when
 * something actually changed.
 */
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiUser();
    const { id } = await ctx.params;
    await apiRateLimit(userId, "projects:update", 300);
    const body = await readJson(req);
    const patch = parseProjectPatch(body);
    const { changed, project } = await updateProjectAndVersion(userId, id, patch);
    return ok({ project, changed });
  } catch (err) {
    return apiError(err);
  }
}

/** DELETE /api/projects/[id] — soft delete (moves to trash). */
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireApiUser();
    const { id } = await ctx.params;
    await apiRateLimit(userId, "projects:delete", 60);
    await softDeleteProject(userId, id);
    return ok({ ok: true });
  } catch (err) {
    return apiError(err);
  }
}
