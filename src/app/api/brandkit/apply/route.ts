import { NextRequest } from "next/server";
import {
  ApiError,
  apiError,
  apiRateLimit,
  ok,
  readJson,
  requireApiUser,
} from "@/lib/api";
import { applyBrandKitToProject } from "@/lib/brandkit";

export const runtime = "nodejs";

/**
 * POST /api/brandkit/apply — apply the user's brand kit defaults to one of
 * their projects' settings. Tenant-scoped: ownership is verified before any
 * write, and the merge keeps explicit project settings intact.
 *
 * Body: { projectId: string }
 * → { applied: true, projectId, changed: boolean }
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "brandkit:apply", 30);
    const body = (await readJson(req)) as Record<string, unknown>;
    const projectId = typeof body.projectId === "string" ? body.projectId : undefined;
    if (!projectId) throw new ApiError(400, "projectId is required.", "bad_input");
    const result = await applyBrandKitToProject(userId, projectId);
    return ok(result);
  } catch (err) {
    return apiError(err);
  }
}
