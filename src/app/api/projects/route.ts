import { NextRequest } from "next/server";
import {
  apiError,
  apiRateLimit,
  ok,
  readJson,
  requireApiUser,
} from "@/lib/api";
import {
  createProject,
  listProjects,
  parseProjectPatch,
  trashCount,
} from "@/lib/projects";

export const runtime = "nodejs";

/** GET /api/projects — list active projects (or trash with ?trash=1). */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireApiUser();
    const trash = req.nextUrl.searchParams.get("trash") === "1";
    const [projects, count] = await Promise.all([listProjects(userId, trash), trashCount(userId)]);
    return ok({ projects, trashCount: count });
  } catch (err) {
    return apiError(err);
  }
}

/** POST /api/projects — create a project (title optional, defaults applied). */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "projects:create", 30);
    const body = await readJson(req);
    const title =
      typeof body === "object" && body !== null && typeof (body as Record<string, unknown>).title === "string"
        ? ((body as Record<string, unknown>).title as string)
        : "Untitled Video";
    const patch = parseProjectPatch({ project: { title } });
    const titleValue = patch.project?.title ?? "Untitled Video";
    const project = await createProject(userId, titleValue);
    return ok({ project }, 201);
  } catch (err) {
    return apiError(err);
  }
}
