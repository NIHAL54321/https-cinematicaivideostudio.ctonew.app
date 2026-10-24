/**
 * Start the render worker exactly once per server process.
 *
 * Called from the render API route and from the Export Center page, both of
 * which are server-side. The first such request boots the worker; every later
 * one gets the same instance. This is deliberate: a queued job is picked up
 * again after a server restart on the next page load or API call, without a
 * separate supervisor process that a machine reset could silently leave dead.
 *
 * If Redis is not configured, `startRenderWorker` returns null and nothing is
 * pretended — an enqueue is refused with "Queue Not Connected" instead.
 */
import { startRenderWorker } from "@/workers/render-worker";

type WorkerHandle = ReturnType<typeof startRenderWorker>;

const globalForRender = globalThis as unknown as { __cavsRenderWorker?: WorkerHandle; __cavsRenderWorkerTried?: boolean };

export function ensureRenderWorker(): WorkerHandle {
  if (globalForRender.__cavsRenderWorkerTried) return globalForRender.__cavsRenderWorker ?? null;
  globalForRender.__cavsRenderWorkerTried = true;
  try {
    globalForRender.__cavsRenderWorker = startRenderWorker();
  } catch (err) {
    console.error("[render-worker] failed to start:", err instanceof Error ? err.message : String(err));
    globalForRender.__cavsRenderWorker = null;
  }
  return globalForRender.__cavsRenderWorker ?? null;
}

/** True when this process has a live render worker attached. */
export function renderWorkerRunning(): boolean {
  return Boolean(globalForRender.__cavsRenderWorker);
}
