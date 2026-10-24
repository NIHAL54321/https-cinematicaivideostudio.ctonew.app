import { NextRequest } from "next/server";
import { apiError, apiRateLimit, ok, readJson, requireApiUser } from "@/lib/api";
import { ensureRenderWorker } from "@/lib/render/worker-boot";
import {
  enqueueRenderJob,
  isRenderAction,
  listRenderJobs,
  readRenderJob,
  stopRenderJob,
} from "@/lib/render/service";
import { PIPELINE_STAGES, PIPELINE_VERSION } from "@/lib/render/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Boot the queue worker on the first request that touches this route. The job
// then belongs to the server process, not to the browser tab that asked for it.
ensureRenderWorker();

/**
 * GET /api/studio/render?jobId=…   → one job's read-out (tenant-scoped)
 * GET /api/studio/render?projectId=… (or nothing) → recent jobs for the caller
 *
 * The read-out's `status` and `progress` are DERIVED from the stage rows on
 * every read; there is no status column and no stored percentage.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "render:read", 600);
    const jobId = req.nextUrl.searchParams.get("jobId");
    if (jobId) {
      const job = await readRenderJob({ userId, jobId });
      return ok({ job });
    }
    const projectId = req.nextUrl.searchParams.get("projectId");
    const jobs = await listRenderJobs({ userId, projectId });
    return ok({
      jobs,
      pipeline: {
        version: PIPELINE_VERSION,
        stages: PIPELINE_STAGES.map((s) => ({
          id: s.id,
          sequence: s.sequence,
          title: s.title,
          weight: s.weight,
          produces: s.produces,
          requires: s.requires,
          reports: s.reports ?? [],
        })),
      },
    });
  } catch (err) {
    return apiError(err);
  }
}

/**
 * POST /api/studio/render
 * Body: { action: "enqueue", projectId, presetId?, fixture? }
 *     | { action: "stop", jobId, reason? }
 *     | { action: "read", jobId }
 *     | { action: "list", projectId? }
 *
 * A project or job that belongs to another account is a 404 — never a 403.
 */
export async function POST(req: NextRequest) {
  try {
    const userId = await requireApiUser();
    const body = (await readJson(req)) as Record<string, unknown>;
    const action = body.action;
    if (!isRenderAction(action)) {
      return ok({ error: "Unknown action.", code: "unknown_action" }, 400);
    }
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

    if (action === "enqueue") {
      await apiRateLimit(userId, "render:enqueue", 30);
      const projectId = str(body.projectId);
      if (!projectId) return ok({ error: "projectId is required.", code: "missing_project" }, 400);
      const result = await enqueueRenderJob({
        userId,
        projectId,
        presetId: str(body.presetId),
        fixture: body.fixture === true,
      });
      return ok({ queued: true, jobId: result.jobId, queueJobId: result.queueJobId ?? null }, 202);
    }

    if (action === "stop") {
      await apiRateLimit(userId, "render:stop", 60);
      const jobId = str(body.jobId);
      if (!jobId) return ok({ error: "jobId is required.", code: "missing_job" }, 400);
      const job = await stopRenderJob({ userId, jobId, reason: str(body.reason) });
      return ok({ job });
    }

    if (action === "read") {
      const jobId = str(body.jobId);
      if (!jobId) return ok({ error: "jobId is required.", code: "missing_job" }, 400);
      const job = await readRenderJob({ userId, jobId });
      return ok({ job });
    }

    const jobs = await listRenderJobs({ userId, projectId: str(body.projectId) });
    return ok({ jobs });
  } catch (err) {
    return apiError(err);
  }
}
