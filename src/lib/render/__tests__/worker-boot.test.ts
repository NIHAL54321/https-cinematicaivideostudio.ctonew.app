/**
 * Phase 8 block 1, follow-up — importing a module must be INERT.
 *
 * The defect this pins down: `src/app/api/studio/render/route.ts` called
 * `ensureRenderWorker()` at module scope, so merely *importing* the module
 * started a BullMQ worker and opened a Redis connection. `next build` imports
 * every route and page module to collect page data, so the build log carried
 * `[render-worker] ready on queue "rendering"` in the middle of page
 * collection — a queue worker running inside the build.
 *
 * The tests below set a REDIS_URL that is deliberately reachable-looking, so
 * that a side effect *would* happen if it were still there: the assertion is
 * not "nothing could connect", it is "nothing tried".
 *
 * Bun runs each test file in its own module registry, so the imports here are
 * the first and only import of these modules in this process.
 */
import { afterAll, afterEach, describe, expect, test } from "bun:test";

// Set BEFORE the dynamic imports below, so the modules under test see a
// configured Redis. If a worker were started on import, it would really try.
const BOGUS_REDIS = "redis://127.0.0.1:6399/15";
process.env.REDIS_URL = BOGUS_REDIS;
delete process.env.NEXT_PHASE;
delete process.env.CAVS_NO_RENDER_WORKER;

const g = globalThis as unknown as {
  __cavsRenderWorker?: unknown;
  __cavsRenderWorkerTried?: boolean;
  __cavsRenderWorkerRefusal?: string | null;
};

afterEach(() => {
  // A failing test must not leak its env into the next one — the boot state is
  // process-global, so test order must not be load-bearing.
  delete process.env.NEXT_PHASE;
  delete process.env.CAVS_NO_RENDER_WORKER;
});

afterAll(() => {
  // Leave the process as we found it.
  delete process.env.REDIS_URL;
  delete process.env.NEXT_PHASE;
  delete process.env.CAVS_NO_RENDER_WORKER;
  delete g.__cavsRenderWorker;
  delete g.__cavsRenderWorkerTried;
  delete g.__cavsRenderWorkerRefusal;
});

describe("importing the render surface starts no worker and opens no Redis connection", () => {
  test("importing the render API route module is inert", async () => {
    const queue = await import("@/lib/queue");
    const boot = await import("@/lib/render/worker-boot");

    expect(boot.renderWorkerState()).toEqual({ running: false, attempted: false, refusal: null });
    expect(queue.queueConnectionOpened()).toBe(false);
    expect(g.__cavsRenderWorker).toBeUndefined();

    // The module really is the one that used to boot at import: it exports the
    // handlers, and importing it left the boot state untouched.
    const route = await import("@/app/api/studio/render/route");
    expect(typeof route.GET).toBe("function");
    expect(typeof route.POST).toBe("function");

    expect(boot.renderWorkerState()).toEqual({ running: false, attempted: false, refusal: null });
    expect(queue.queueConnectionOpened()).toBe(false);
    expect(g.__cavsRenderWorkerTried).toBeUndefined();
  });

  test("importing the Export Center page module is inert", async () => {
    const queue = await import("@/lib/queue");
    const boot = await import("@/lib/render/worker-boot");

    const page = await import("@/app/(app)/export-center/page");
    expect(typeof page.default).toBe("function");

    expect(boot.renderWorkerState().attempted).toBe(false);
    expect(boot.renderWorkerRunning()).toBe(false);
    expect(queue.queueConnectionOpened()).toBe(false);
    expect(g.__cavsRenderWorkerTried).toBeUndefined();
  });

  test("importing the panel module is inert", async () => {
    const queue = await import("@/lib/queue");
    const boot = await import("@/lib/render/worker-boot");

    const panel = await import("@/components/render/render-pipeline-panel");
    expect(typeof panel.RenderPipelinePanel).toBe("function");

    expect(boot.renderWorkerState().attempted).toBe(false);
    expect(queue.queueConnectionOpened()).toBe(false);
  });

  test("importing the worker-boot module alone is inert", async () => {
    const queue = await import("@/lib/queue");
    const boot = await import("@/lib/render/worker-boot");

    expect(typeof boot.ensureRenderWorker).toBe("function");
    expect(boot.renderWorkerRunning()).toBe(false);
    expect(boot.renderWorkerState().attempted).toBe(false);
    expect(queue.queueConnectionOpened()).toBe(false);
  });
});

describe("the boot is explicit, and refuses where a worker must not run", () => {
  test("during a production build the boot refuses, names the phase, and stays un-attempted", async () => {
    process.env.NEXT_PHASE = "phase-production-build";
    const boot = await import("@/lib/render/worker-boot");
    const queue = await import("@/lib/queue");

    const refusal = boot.renderWorkerRefusal();
    expect(refusal).toContain("NEXT_PHASE=phase-production-build");
    expect(refusal).toContain("building, not serving");

    // Calling it is still inert: no worker, no Redis connection.
    expect(boot.ensureRenderWorker()).toBeNull();
    expect(boot.renderWorkerRunning()).toBe(false);
    expect(queue.queueConnectionOpened()).toBe(false);

    // Crucially the refusal does NOT burn the one attempt, so a serving process
    // in the same runtime can still boot later.
    expect(boot.renderWorkerState().attempted).toBe(false);

    delete process.env.NEXT_PHASE;
  });

  test("during a production export the boot refuses", async () => {
    process.env.NEXT_PHASE = "phase-export";
    const boot = await import("@/lib/render/worker-boot");
    expect(boot.renderWorkerRefusal()).toContain("phase-export");
    expect(boot.ensureRenderWorker()).toBeNull();
    delete process.env.NEXT_PHASE;
  });

  test("CAVS_NO_RENDER_WORKER=1 is an explicit opt-out for any process", async () => {
    process.env.CAVS_NO_RENDER_WORKER = "1";
    const boot = await import("@/lib/render/worker-boot");
    expect(boot.renderWorkerRefusal()).toContain("CAVS_NO_RENDER_WORKER=1");
    expect(boot.ensureRenderWorker()).toBeNull();
    expect(boot.renderWorkerRunning()).toBe(false);
    delete process.env.CAVS_NO_RENDER_WORKER;
  });

  test("a serving process is allowed to boot — the gate is a gate, not a wall", async () => {
    const boot = await import("@/lib/render/worker-boot");
    // No NEXT_PHASE and no opt-out: this process may serve.
    expect(boot.renderWorkerRefusal()).toBeNull();
  });
});
