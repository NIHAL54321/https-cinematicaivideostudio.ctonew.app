/**
 * GUARD 3 — A RETRY NEVER MUTATES OR DELETES A PREVIOUS ATTEMPT'S ROWS
 * (Phase 8, block 6).
 *
 * THE PROPERTY. A retry is a NEW ATTEMPT beside the old one. Attempt 1's stage
 * rows, artefact rows and attempt row are a record of what really happened; a
 * later attempt that rewrote them would be editing history to make itself look
 * better — the exact failure block 5 refused for the credit ledger, where the
 * database trigger refuses UPDATE and DELETE on the ledger tables.
 *
 * THE STANDARD HERE IS THE SAME ONE: THE STORE REFUSES, rather than the test
 * trusting that nothing would try. `memory-store.ts` throws `RenderStoreRefusal`
 * on any write aimed at an attempt that has ended — `finishStageRun`,
 * `createArtefact`, `heartbeat`, a second `finishAttempt`, `deleteStageRun`,
 * `deleteAttempt` — and logs the refusal. So this file asserts two separate
 * things:
 *
 *   1. the real retry path never even ATTEMPTS such a write (the write log is
 *      empty after attempt 1 closed), and attempt 1's rows are byte-identical
 *      before and after attempt 2 ran;
 *   2. every such write is REFUSED when attempted by hand — the negative
 *      controls below, which are the same shape as block 5's trigger transcript:
 *      the refusal is printed, and the rows are read back unchanged afterwards.
 *
 * A store that silently accepted the write would make (1) meaningless, which is
 * why the refusal lives in the double rather than in an expectation.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EXECUTORS } from "../executors";
import { runRenderPipeline } from "../runner";
import { memoryRenderStore, realStageFile, RenderStoreRefusal } from "./memory-store";
import { StageFailure } from "../types";
import type { Probe, ProbeId } from "../probes";

const PROBE_IDS: ProbeId[] = ["project-has-scenes", "storage-writable", "ffmpeg-binary", "ffprobe-binary", "encode-provider-keyed"];

function allOkProbes(): Record<ProbeId, Probe> {
  return Object.fromEntries(
    PROBE_IDS.map((id) => [id, async () => ({ ok: true, detail: `${id}: forced ok for this test`, missing: null })]),
  ) as Record<ProbeId, Probe>;
}

function executors(dir: string, opts: { failMux?: boolean } = {}) {
  return {
    "encode-master": async () => {
      const f = realStageFile(dir, "master.mp4", "MASTER-BYTES-FROM-THE-TEST-DOUBLE", "master-video");
      return { record: { encoder: "test double", bytes: f.bytes }, files: [f] };
    },
    "container-mux": async () => {
      if (opts.failMux) throw new StageFailure("container-mux: EISDIR writing the delivered container (test double)");
      const f = realStageFile(dir, "delivered.mp4", "DELIVERED-CONTAINER-BYTES", "delivered-container");
      return { record: { container: "test double" }, files: [f] };
    },
    "checksum-artefact": async () => {
      const f = realStageFile(dir, "delivered.mp4.sha256", "digest sidecar", "checksum-sidecar");
      return { record: { sidecar: f.path }, files: [f] };
    },
  };
}

/** Run attempt 1 (fails at container-mux) and attempt 2 (the retry) on one store. */
async function failedThenRetried(dir: string) {
  const mem = memoryRenderStore({ job: { id: "job1" } });
  const first = await runRenderPipeline("job1", {
    store: mem.store,
    probes: allOkProbes(),
    executors: { ...EXECUTORS, ...executors(dir, { failMux: true }) } as never,
    outputRoot: dir,
  });
  const attempt1Before = mem.snapshot("attempt1");
  const second = await runRenderPipeline("job1", {
    store: mem.store,
    probes: allOkProbes(),
    executors: { ...EXECUTORS, ...executors(dir) } as never,
    outputRoot: dir,
  });
  return { mem, first, second, attempt1Before };
}

/* ------------------------------------------------------------------ */
/* 1 — the real retry leaves the closed attempt exactly as it was      */
/* ------------------------------------------------------------------ */

describe("a real retry leaves attempt 1 untouched", () => {
  test("attempt 1's row, stage rows and artefacts are byte-identical after attempt 2 succeeded", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cavs-immutable-"));
    try {
      const { mem, first, second, attempt1Before } = await failedThenRetried(dir);
      expect(first.status).toBe("failed");
      expect(second.status).toBe("succeeded");
      expect(second.attemptNumber).toBe(2);

      // 1. The record is byte-identical.
      expect(mem.snapshot("attempt1")).toBe(attempt1Before);

      // 2. Nothing wrote to attempt 1 after it closed, and nothing was refused.
      expect(mem.writesAfterClose("attempt1")).toEqual([]);
      expect(mem.refusals).toEqual([]);

      // 3. The closed attempt still says exactly what happened to it.
      const a1 = mem.attempts.find((a) => a.id === "attempt1")!;
      expect(a1.state).toBe("FAILED");
      expect(a1.endedReason).toContain('stage "container-mux" failed');
      expect(mem.rowsOf("attempt1").map((r) => `${r.stageId}:${r.state}`)).toEqual([
        "resolve-inputs:SUCCEEDED",
        "assemble-timeline:SUCCEEDED",
        "audio-mix-plan:SUCCEEDED",
        "subtitle-plan:SUCCEEDED",
        "encode-master:SUCCEEDED",
        "container-mux:FAILED",
      ]);
      // 4. And the failure's own error text was not softened by the retry.
      expect(mem.rowsOf("attempt1").find((r) => r.stageId === "container-mux")!.errorMessage).toContain("EISDIR");

      // 5. The retry's rows are its own.
      expect(mem.rowsOf("attempt2").map((r) => r.stageId)).toEqual(["container-mux", "checksum-artefact"]);
      expect(mem.rows.filter((r) => r.stageId === "container-mux").length).toBe(2);
      expect(mem.rows.filter((r) => r.stageId === "container-mux").map((r) => r.attemptId).sort()).toEqual([
        "attempt1",
        "attempt2",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------------------------ */
/* 2 — THE NEGATIVE CONTROLS: the store refuses                        */
/* ------------------------------------------------------------------ */

describe("NEGATIVE CONTROLS: every write aimed at a closed attempt is refused", () => {
  test("UPDATE a closed attempt's stage row, DELETE it, UPDATE the attempt, DELETE the attempt — all refused", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cavs-immutable-neg-"));
    try {
      const { mem } = await failedThenRetried(dir);
      const failedRow = mem.rowsOf("attempt1").find((r) => r.stageId === "container-mux")!;
      const before = mem.snapshot("attempt1");

      // (a) Rewrite the failed stage row as SUCCEEDED — the classic lie.
      await expect(
        mem.store.finishStageRun(failedRow.id, { state: "SUCCEEDED", finishedAt: new Date(), artefactCount: 1 }),
      ).rejects.toThrow(RenderStoreRefusal);
      expect(mem.refusals.at(-1)!.reason).toContain("CLOSED");
      expect(mem.refusals.at(-1)!.reason).toContain("append-only");

      // (b) DELETE the stage row.
      expect(() => mem.deleteStageRun(failedRow.id)).toThrow(/CLOSED/);

      // (c) Re-open the attempt by overwriting its ending.
      await expect(
        mem.store.finishAttempt("attempt1", { state: "SUCCEEDED", finishedAt: new Date(), endedReason: "nothing to see here" }),
      ).rejects.toThrow(/CLOSED/);

      // (d) Heartbeat a closed attempt back to life.
      await expect(mem.store.heartbeat("attempt1", new Date(), "container-mux")).rejects.toThrow(/CLOSED/);

      // (e) DELETE the attempt row itself.
      expect(() => mem.deleteAttempt("attempt1")).toThrow(/CLOSED/);

      // Every one of the five was logged as a refusal...
      expect(mem.refusals.map((r) => r.op)).toEqual([
        "finishStageRun",
        "deleteStageRun",
        "finishAttempt",
        "heartbeat",
        "deleteAttempt",
      ]);
      // ...and after all five attempts the record is still byte-identical.
      expect(mem.snapshot("attempt1")).toBe(before);
      expect(mem.attempts.find((a) => a.id === "attempt1")!.state).toBe("FAILED");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("POSITIVE CONTROL: the same writes are ACCEPTED on an OPEN attempt — the refusal is about closure, not about writing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cavs-immutable-open-"));
    try {
      const { mem } = await failedThenRetried(dir);
      const id = await mem.store.createAttempt({
        jobId: "job1",
        attemptNumber: 3,
        startStageId: "encode-master",
        continuedFromId: "attempt2",
        startedAt: new Date(),
        owner: { host: "cavs-test-host", pid: process.pid, procStart: "1" },
      });
      const runId = await mem.store.createStageRun({
        jobId: "job1",
        attemptId: id,
        stageId: "encode-master",
        sequence: 5,
        startedAt: new Date(),
        syntheticProof: false,
      });
      // All of these are allowed while the attempt is open.
      await mem.store.heartbeat(id, new Date(), "encode-master");
      await mem.store.finishStageRun(runId, { state: "SUCCEEDED", finishedAt: new Date(), artefactCount: 0 });
      await mem.store.finishAttempt(id, { state: "SUCCEEDED", finishedAt: new Date(), endedReason: "test" });
      expect(mem.rowsOf(id).map((r) => r.state)).toEqual(["SUCCEEDED"]);
      // ...and now that it is closed, the same write is refused.
      await expect(mem.store.finishStageRun(runId, { state: "FAILED", finishedAt: new Date(), artefactCount: 0 })).rejects.toThrow(
        /CLOSED/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
