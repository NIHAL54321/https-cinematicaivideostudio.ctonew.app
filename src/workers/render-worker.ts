/**
 * The render queue's worker.
 *
 * It runs INSIDE the app server process (started once, on the first request
 * that needs it — see `./worker-boot`), which is what makes a render a
 * background job: the work belongs to the server, not to the page. Closing the
 * browser tab, reloading, or navigating away changes nothing — the job keeps
 * going and the page reads its progress from the database when it comes back.
 *
 * One job at a time (concurrency 1). The machine has ~4 GB of RAM and the
 * encode stage, when it can run at all, is the memory-hungry one; running two
 * encodes at once is how a render farm takes its own server down.
 *
 * The worker does not decide anything: `runRenderPipeline` gates, runs and
 * records. This file only moves a job id from Redis into it and logs the
 * derived outcome, including the progress arithmetic, so the server log holds
 * the same numbers the page shows.
 */
import { Worker } from "bullmq";
import { QUEUES, getQueueConnection } from "@/lib/queue";
import { runRenderPipeline } from "@/lib/render/runner";
import { prismaRenderStore } from "@/lib/render/store";

export interface RenderJobData {
  jobId: string;
}

export function startRenderWorker(): Worker<RenderJobData> | null {
  if (!process.env.REDIS_URL) {
    console.warn("[render-worker] REDIS_URL not set — the render worker was not started.");
    return null;
  }
  const worker = new Worker<RenderJobData>(
    QUEUES.render,
    async (job) => {
      const result = await runRenderPipeline(job.data.jobId, { store: prismaRenderStore() });
      const halted = result.halted
        ? ` halted at ${result.halted.stageId} (${result.halted.state}): ${result.halted.reason}`
        : "";
      console.log(
        `[render-worker] job ${job.data.jobId} → status=${result.status}; progress ${result.progress.arithmetic}; ` +
          `artefacts=${result.artefactsWritten}; stage rows=${result.stageRows.length}.${halted}`,
      );
      return { status: result.status, artefacts: result.artefactsWritten, percent: result.progress.percent };
    },
    { connection: getQueueConnection(), concurrency: 1 },
  );
  worker.on("ready", () => console.log(`[render-worker] ready on queue "${QUEUES.render}"`));
  worker.on("failed", (job, err) => {
    console.error(`[render-worker] job ${job?.id} threw before the pipeline could record it:`, err.message);
  });
  return worker;
}
