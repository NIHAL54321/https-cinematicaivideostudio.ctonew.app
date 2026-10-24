/**
 * Boot the render worker — EXPLICITLY, from a request, never as an import
 * side effect.
 *
 * WHY THIS FILE EXISTS IN THIS SHAPE
 * A worker started at module scope starts whenever the module is *imported*,
 * and a module is imported by far more than a request: `next build` imports the
 * route and page modules while collecting page data, a test imports them to
 * assert something, a script imports them to read a type. Each of those imports
 * would spawn a BullMQ worker and open a Redis connection in a process that is
 * not serving traffic — during a build, in the test runner, in a one-off script.
 * The build log said so out loud: `[render-worker] ready on queue "rendering"`
 * appeared in the middle of page collection.
 *
 * So the rule is: importing anything in this tree is inert. Only a call to
 * `ensureRenderWorker()` from inside a request handler (or from a server
 * component's render, which also only runs for a request) can start a worker,
 * and even then only when this process is genuinely serving — never during a
 * build or export phase, and never when `CAVS_NO_RENDER_WORKER=1` says so.
 *
 * The worker still runs INSIDE the app server process, once, which is what
 * makes a render a background job: the work belongs to the server, not to the
 * page. A job queued before a restart is picked up on the next request that
 * calls this function.
 *
 * If Redis is not configured, `startRenderWorker` returns null and nothing is
 * pretended — an enqueue is refused with "Queue Not Connected" instead.
 */
import { startRenderWorker } from "@/workers/render-worker";

type WorkerHandle = ReturnType<typeof startRenderWorker>;

const globalForRender = globalThis as unknown as {
  __cavsRenderWorker?: WorkerHandle;
  __cavsRenderWorkerTried?: boolean;
  __cavsRenderWorkerRefusal?: string | null;
};

/**
 * Why a worker must NOT start in this process, or `null` when it may.
 *
 * `next build` sets `NEXT_PHASE=phase-production-build` for the processes that
 * import every route and page module to collect their data; `next export` sets
 * `phase-export`. Neither serves traffic, so neither may hold a queue worker.
 * During `next start` / `next dev` the variable is unset or names a server
 * phase, and booting is allowed.
 */
export function renderWorkerRefusal(): string | null {
  if (process.env.CAVS_NO_RENDER_WORKER === "1") {
    return "CAVS_NO_RENDER_WORKER=1 — this process is declared non-serving, so no worker was started";
  }
  const phase = process.env.NEXT_PHASE;
  if (phase === "phase-production-build" || phase === "phase-export") {
    return `NEXT_PHASE=${phase} — this process is building, not serving, so no worker was started`;
  }
  return null;
}

/**
 * Start the render worker once per server process, if this process may serve.
 * Call this from a request handler or a server component body — never at module
 * scope. Returns the worker handle, or null when nothing was started.
 */
export function ensureRenderWorker(): WorkerHandle {
  const refusal = renderWorkerRefusal();
  if (refusal) {
    // Deliberately does NOT mark the attempt as done: a build process that
    // refused must not poison a later serving process in the same runtime.
    globalForRender.__cavsRenderWorkerRefusal = refusal;
    return null;
  }
  if (globalForRender.__cavsRenderWorkerTried) return globalForRender.__cavsRenderWorker ?? null;
  globalForRender.__cavsRenderWorkerTried = true;
  try {
    globalForRender.__cavsRenderWorker = startRenderWorker();
    globalForRender.__cavsRenderWorkerRefusal = globalForRender.__cavsRenderWorker
      ? null
      : "REDIS_URL is not set — the queue is not connected, so no worker was started";
  } catch (err) {
    console.error("[render-worker] failed to start:", err instanceof Error ? err.message : String(err));
    globalForRender.__cavsRenderWorker = null;
    globalForRender.__cavsRenderWorkerRefusal = `the worker threw on start: ${
      err instanceof Error ? err.message : String(err)
    }`;
  }
  return globalForRender.__cavsRenderWorker ?? null;
}

/** True when this process has a live render worker attached. */
export function renderWorkerRunning(): boolean {
  return Boolean(globalForRender.__cavsRenderWorker);
}

/**
 * The boot state as data — whether a worker is attached, whether a boot has
 * been attempted at all, and the sentence explaining a refusal. A test can read
 * this after importing a module to prove the import did nothing.
 */
export function renderWorkerState(): { running: boolean; attempted: boolean; refusal: string | null } {
  return {
    running: Boolean(globalForRender.__cavsRenderWorker),
    attempted: Boolean(globalForRender.__cavsRenderWorkerTried),
    refusal: globalForRender.__cavsRenderWorkerRefusal ?? null,
  };
}
