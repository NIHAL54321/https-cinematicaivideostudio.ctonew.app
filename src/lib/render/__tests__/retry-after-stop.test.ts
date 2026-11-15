/**
 * RETRY AFTER STOP — the defect attempt 2 stopped on.
 *
 * `runRenderPipeline` re-reads the job's `stopRequestedAt` before EVERY stage and
 * halts on it. A stopped job keeps that flag, and `retryRenderJob` used to create
 * a new attempt without clearing it — so the retried attempt stopped again at the
 * same stage the instant it started, and "Retry" in the Export panel did nothing.
 *
 * WHAT IS PINNED HERE, through the REAL runner:
 *   1. attempt 2 WITHOUT the flag cleared stops at the same stage attempt 1 did,
 *      and delivers nothing — the defect, reproduced;
 *   2. `clearStopForRetry` — the exact function `retryRenderJob` calls before it
 *      creates the attempt — reads and clears the two fields, and reports what it
 *      cleared rather than hiding it;
 *   3. attempt 3 then runs PAST that stage, honours the encode attempt 1 already
 *      did, and REACHES DELIVERY: a delivered container on disk whose digest is
 *      the one recorded, plus the checksum sidecar.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXECUTORS } from "../executors";
import { runRenderPipeline } from "../runner";
import { clearStopForRetry, type RenderJobStopPort } from "../service";
import type { Probe, ProbeId } from "../probes";
import { memoryRenderStore, realStageFile, type MemoryRenderStore } from "./memory-store";

const PROBE_IDS: ProbeId[] = ["project-has-scenes", "storage-writable", "ffmpeg-binary", "ffprobe-binary", "encode-provider-keyed"];

/** Every requisite present — this test is about the stop, not about the gate. */
function allOkProbes(): Record<ProbeId, Probe> {
  return Object.fromEntries(
    PROBE_IDS.map((id) => [id, async () => ({ ok: true, detail: `${id}: forced ok for this test`, missing: null })]),
  ) as Record<ProbeId, Probe>;
}

/**
 * The file stages, really writing the files they declare. `stopAfterEncode` is
 * the owner pressing stop while the render is in flight: the encode finishes,
 * and the runner sees the request before the next stage.
 */
function executors(dir: string, mem: MemoryRenderStore, opts: { stopAfterEncode?: boolean } = {}) {
  return {
    "encode-master": async () => {
      const f = realStageFile(dir, "master.mp4", "MASTER-BYTES-FROM-THE-TEST-DOUBLE", "master-video");
      if (opts.stopAfterEncode) {
        const job = mem.job();
        job.stopRequestedAt = new Date(2000);
        job.stopReason = "owner pressed stop during the encode";
      }
      return { record: { encoder: "test double", bytes: f.bytes, sha256: f.sha256 }, files: [f] };
    },
    "container-mux": async () => {
      const f = realStageFile(dir, "delivered.mp4", "DELIVERED-CONTAINER-BYTES", "delivered-container");
      return { record: { container: "test double" }, files: [f] };
    },
    "checksum-artefact": async () => {
      const f = realStageFile(dir, "delivered.mp4.sha256", "digest sidecar", "checksum-sidecar");
      return { record: { sidecar: f.path }, files: [f] };
    },
  };
}

/**
 * The production port's two operations, over the memory store's job object. This
 * is the same code path `prismaRenderJobStopPort()` takes against Postgres; only
 * the storage behind the two calls differs.
 */
function memoryStopPort(mem: MemoryRenderStore): RenderJobStopPort {
  return {
    async read() {
      const job = mem.job();
      return { stopRequestedAt: job.stopRequestedAt, stopReason: job.stopReason };
    },
    async clear() {
      const job = mem.job();
      job.stopRequestedAt = null;
      job.stopReason = null;
    },
  };
}

function sha256Of(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

describe("retry after stop", () => {
  test("a stopped job, retried, runs past the stage it stopped at and reaches delivery", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cavs-retry-after-stop-"));
    const mem = memoryRenderStore({ job: { id: "job1" } });
    try {
      /* 1 — the owner's render, stopped while the encode is in flight. */
      const first = await runRenderPipeline("job1", {
        store: mem.store,
        probes: allOkProbes(),
        executors: { ...EXECUTORS, ...executors(dir, mem, { stopAfterEncode: true }) } as never,
        outputRoot: dir,
      });
      expect(first.status).toBe("stopped");
      expect(first.halted?.stageId).toBe("container-mux");
      expect(mem.attempts[0].state).toBe("STOPPED");
      expect(mem.job().stopRequestedAt).not.toBeNull();

      /* 2 — NEGATIVE CONTROL: the retry as it behaved BEFORE the fix. The flag is
             still on the job, so attempt 2 stops at the same stage, instantly. */
      const uncleared = await runRenderPipeline("job1", {
        store: mem.store,
        probes: allOkProbes(),
        executors: { ...EXECUTORS, ...executors(dir, mem) } as never,
        outputRoot: dir,
      });
      expect(uncleared.attemptNumber).toBe(2);
      expect(uncleared.startStageId).toBe("container-mux");
      expect(uncleared.status).toBe("stopped");
      expect(uncleared.halted?.stageId).toBe("container-mux");
      expect(mem.artefacts.filter((a) => a.artefactKind === "delivered-container").length).toBe(0);

      /* 3 — what `retryRenderJob` now does first: clear the stop, and say what it
             cleared. */
      const cleared = await clearStopForRetry(memoryStopPort(mem), "job1");
      expect(cleared).toEqual({ requestedAt: new Date(2000).toISOString(), reason: "owner pressed stop during the encode" });
      expect(mem.job().stopRequestedAt).toBeNull();
      expect(mem.job().stopReason).toBeNull();
      // Clearing is idempotent and never invents a stop that was not there.
      expect(await clearStopForRetry(memoryStopPort(mem), "job1")).toBeNull();

      /* 4 — attempt 3 runs past the stopped stage and REACHES DELIVERY. */
      const retried = await runRenderPipeline("job1", {
        store: mem.store,
        probes: allOkProbes(),
        executors: { ...EXECUTORS, ...executors(dir, mem) } as never,
        outputRoot: dir,
      });
      expect(retried.attemptNumber).toBe(3);
      expect(retried.startStageId).toBe("container-mux");
      expect(retried.honouredStageIds).toContain("encode-master");
      expect(retried.status).toBe("succeeded");
      expect(retried.progress.percent).toBe(100);

      // The encode attempt 1 did is REUSED, not produced a second time.
      expect(mem.artefacts.filter((a) => a.artefactKind === "master-video").length).toBe(1);

      // And the delivered file is on disk, with the digest that was recorded.
      const delivered = mem.artefacts.find((a) => a.artefactKind === "delivered-container" && a.attemptId === mem.attempts[2].id);
      expect(delivered).toBeDefined();
      expect(existsSync(delivered!.path)).toBe(true);
      expect(sha256Of(delivered!.path)).toBe(delivered!.sha256);
      expect(delivered!.bytes).toBe(Buffer.byteLength("DELIVERED-CONTAINER-BYTES"));
      expect(mem.artefacts.some((a) => a.artefactKind === "checksum-sidecar" && a.attemptId === mem.attempts[2].id)).toBe(true);
      expect(mem.attempts[2].state).toBe("SUCCEEDED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("a job with no stop on it is left alone — the port is never written to", async () => {
    const writes: string[] = [];
    const port: RenderJobStopPort = {
      async read() {
        return { stopRequestedAt: null, stopReason: null };
      },
      async clear() {
        writes.push("clear");
      },
    };
    expect(await clearStopForRetry(port, "job1")).toBeNull();
    expect(writes).toEqual([]);
  });
});
