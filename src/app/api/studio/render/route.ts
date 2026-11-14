import { NextRequest } from "next/server";
import { apiError, apiRateLimit, ok, readJson, requireApiUser } from "@/lib/api";
import { ensureRenderWorker } from "@/lib/render/worker-boot";
import {
  enqueueRenderJob,
  enqueueSyntheticProofJob,
  isRenderAction,
  listRenderJobs,
  readRenderJob,
  retryRenderJob,
  stopRenderJob,
} from "@/lib/render/service";
import { PIPELINE_STAGES, PIPELINE_VERSION } from "@/lib/render/pipeline";
import { loadDownloadCentre } from "@/lib/downloads/centre";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// NOTE: no worker is started at module scope. Importing this module must be
// inert — `next build` imports it to collect page data, and a worker started on
// import would open a Redis connection in a process that is not serving. The
// boot happens inside each handler instead, on the first real request.

/**
 * GET /api/studio/render?jobId=…   → one job's read-out (tenant-scoped)
 * GET /api/studio/render?projectId=… (or nothing) → recent jobs for the caller
 *
 * The read-out's `status` and `progress` are DERIVED from the stage rows on
 * every read; there is no status column and no stored percentage.
 */
export async function GET(req: NextRequest) {
  try {
    // The first request that touches this route boots the queue worker, once.
    // The job then belongs to the server process, not to the browser tab.
    ensureRenderWorker();
    const userId = await requireApiUser();
    await apiRateLimit(userId, "render:read", 600);
    const jobId = req.nextUrl.searchParams.get("jobId");
    if (jobId) {
      const job = await readRenderJob({ userId, jobId });
      /* ?delivery=1 (Export panel block, 2026-11-14): the delivered-file facts for
       * THIS job, taken from the same derivation the Download Centre uses
       * (`loadDownloadCentre` → `deriveDownloadCentre`). Not a second source of
       * truth: whether the bytes are on this disk, whether the durable object is
       * in storage at the recorded size, the download href, the filename and the
       * sentence are all the download centre's own. The Export tab therefore
       * cannot offer a link to a file the download route would answer 410 for. */
      if (req.nextUrl.searchParams.get("delivery") === "1") {
        const centre = await loadDownloadCentre({ userId });
        return ok({ job, delivery: { files: centre.files.filter((f) => f.jobId === jobId) } });
      }
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
    // Same rule as GET: boot on a real request, never on import.
    ensureRenderWorker();
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

    /**
     * RETRY FROM THE FIRST STAGE THAT DID NOT SUCCEED (Phase 8 block 6).
     *
     * A retry is a NEW ATTEMPT: it creates one attempt row and one queue message,
     * starts at the first stage that did not succeed, and reuses the file
     * artefacts earlier attempts produced after re-measuring each one. It does
     * not edit, delete or rewrite any earlier attempt's rows.
     *
     * Refusals are specific: 404 for a job that is not the caller's (never 403),
     * 409 when the owning process is still alive or when every stage is already
     * honoured, and 503 when the queue is not connected.
     */
    if (action === "retry") {
      await apiRateLimit(userId, "render:retry", 30);
      const jobId = str(body.jobId);
      if (!jobId) return ok({ error: "jobId is required.", code: "missing_job" }, 400);
      const result = await retryRenderJob({ userId, jobId });
      return ok(
        {
          queued: true,
          jobId: result.jobId,
          attemptId: result.attemptId,
          attemptNumber: result.attemptNumber,
          startStageId: result.startStageId,
          continuedFromId: result.continuedFromId,
          honoured: result.honoured,
          reused: result.reused,
          refused: result.refused,
          basis: result.basis,
          job: result.job,
        },
        202,
      );
    }

    /**
     * A SYNTHETIC ENCODER PROOF: generate a declared test source with the
     * encoder, then run the SAME seven-stage pipeline on it with the preset's own
     * resolved specification. This exists so that "an encode really happened on
     * this machine" can be shown through the app's own stage rather than by a
     * hand-typed command line — and everything it creates is marked synthetic in
     * its own columns. It is not a user's render and never appears in one.
     */
    if (action === "synthetic-proof") {
      await apiRateLimit(userId, "render:synthetic-proof", 5);
      const dur = body.durationSeconds;
      const durationSeconds =
        typeof dur === "number" && Number.isFinite(dur) && dur > 0 && dur <= 30 ? dur : undefined;
      const result = await enqueueSyntheticProofJob({
        userId,
        presetId: str(body.presetId),
        durationSeconds,
      });
      return ok(
        {
          queued: true,
          jobId: result.jobId,
          projectId: result.projectId,
          queueJobId: result.queueJobId ?? null,
          syntheticProof: true,
          source: result.source,
          note:
            "This job encodes a generated test source (testsrc2 + 440 Hz sine) that the encoder produced. It is not a " +
            "user's project and not a delivered master; it is excluded from the project's render list.",
        },
        202,
      );
    }

    const jobs = await listRenderJobs({ userId, projectId: str(body.projectId) });
    return ok({ jobs });
  } catch (err) {
    return apiError(err);
  }
}
