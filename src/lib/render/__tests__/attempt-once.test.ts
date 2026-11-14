/**
 * AN ATTEMPT RUNS AT MOST ONCE — the P2002 the retry path used to log.
 *
 * `RenderStageRun` is unique on `(attemptId, stageId)`. The queue can hand the
 * same attempt to the runner twice (a stalled or re-delivered BullMQ message),
 * and when it did, the second execution collided with the FIRST execution's own
 * stage row and threw `Unique constraint failed on (attemptId, stageId)` in the
 * middle of a render.
 *
 * WHAT IS PINNED HERE, through the REAL runner:
 *   1. a re-delivered attempt is REFUSED with a typed error that names the
 *      attempt and how many rows it already has — and NOTHING is written: no
 *      job start, no stage row, no artefact, no attempt;
 *   2. the refusal is keyed on the ATTEMPT, not the job: a NEW attempt for the
 *      same job still runs and succeeds. A guard that blocked the job would
 *      break retries, which is the whole point of attempts.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIPELINE_STAGES } from "../pipeline";
import { EXECUTORS } from "../executors";
import { runRenderPipeline } from "../runner";
import { AttemptAlreadyRunError } from "../types";
import { memoryRenderStore, realStageFile } from "./memory-store";
import type { Probe, ProbeId } from "../probes";

const PROBE_IDS: ProbeId[] = ["project-has-scenes", "storage-writable", "ffmpeg-binary", "ffprobe-binary", "encode-provider-keyed"];

/** Every requisite present — this test is about the attempt, not about the gate. */
function allOkProbes(): Record<ProbeId, Probe> {
  return Object.fromEntries(
    PROBE_IDS.map((id) => [id, async () => ({ ok: true, detail: `${id}: forced ok for this test`, missing: null })]),
  ) as Record<ProbeId, Probe>;
}

/** The file stages, really writing the files they declare. */
function executors(dir: string) {
  return {
    "encode-master": async () => {
      const f = realStageFile(dir, "master.mp4", "MASTER-BYTES-FROM-THE-TEST-DOUBLE", "master-video");
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

const seqOf = (id: string) => PIPELINE_STAGES.find((s) => s.id === id)?.sequence ?? -1;

describe("an attempt runs at most once", () => {
  test("a re-delivered attempt is REFUSED, typed, and writes nothing", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cavs-attempt-once-"));
    const mem = memoryRenderStore({ job: { id: "job1" } });
    try {
      // The first delivery really runs the pipeline and writes its rows.
      const first = await runRenderPipeline("job1", {
        store: mem.store,
        probes: allOkProbes(),
        executors: { ...EXECUTORS, ...executors(dir) } as never,
        outputRoot: dir,
      });
      expect(first.status).toBe("succeeded");
      expect(first.attemptNumber).toBe(1);
      const attemptId = mem.attempts[0].id;
      expect(attemptId).toBe("attempt1");
      const rowsWritten = mem.rows.filter((r) => r.attemptId === attemptId).length;
      expect(rowsWritten).toBeGreaterThan(0);

      // Everything the store holds, snapshotted, so "nothing was written" is
      // measured rather than asserted.
      const writesBefore = mem.writes.length;
      const rowsBefore = mem.rows.length;
      const artefactsBefore = mem.artefacts.length;
      const attemptsBefore = mem.attempts.length;
      const startedAtBefore = mem.job().startedAt;
      const jobStateBefore = mem.job().finishedAt;

      // THE RE-DELIVERY: the same attempt id, exactly as a stalled message
      // would arrive.
      let thrown: unknown = null;
      try {
        await runRenderPipeline("job1", {
          store: mem.store,
          probes: allOkProbes(),
          executors: { ...EXECUTORS, ...executors(dir) } as never,
          outputRoot: dir,
          attemptId,
        });
      } catch (err) {
        thrown = err;
      }

      // It is the TYPED refusal, and it names what it refused.
      expect(thrown).toBeInstanceOf(AttemptAlreadyRunError);
      const refusal = thrown as AttemptAlreadyRunError;
      expect(refusal.name).toBe("AttemptAlreadyRunError");
      expect(refusal.code).toBe("attempt_already_run");
      expect(refusal.jobId).toBe("job1");
      expect(refusal.attemptId).toBe(attemptId);
      expect(refusal.stageRows).toBe(rowsWritten);
      expect(refusal.message).toContain(`render attempt ${attemptId} for job job1 has already run`);
      expect(refusal.message).toContain(`${rowsWritten} stage row`);
      expect(refusal.message).toContain("Nothing was written.");

      // NOTHING WAS WRITTEN — not a stage row, not an artefact, not an attempt,
      // not a job start, and not a single store write of any kind.
      expect(mem.writes.length).toBe(writesBefore);
      expect(mem.rows.length).toBe(rowsBefore);
      expect(mem.artefacts.length).toBe(artefactsBefore);
      expect(mem.attempts.length).toBe(attemptsBefore);
      expect(mem.job().startedAt).toEqual(startedAtBefore);
      expect(mem.job().finishedAt).toEqual(jobStateBefore);
      // The refusal is a guard, not a store refusal: the store was never asked.
      expect(mem.refusals.length).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the guard is keyed on the ATTEMPT: a NEW attempt for the same job still runs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cavs-attempt-new-"));
    const mem = memoryRenderStore({ job: { id: "job1" } });
    try {
      await runRenderPipeline("job1", {
        store: mem.store,
        probes: allOkProbes(),
        executors: { ...EXECUTORS, ...executors(dir) } as never,
        outputRoot: dir,
      });
      expect(mem.attempts.length).toBe(1);

      // A retry, created the way `retryRenderJob` creates one: a NEW attempt row.
      const secondId = await mem.store.createAttempt({
        jobId: "job1",
        attemptNumber: 2,
        startStageId: PIPELINE_STAGES[0].id,
        continuedFromId: "attempt1",
        startedAt: new Date(),
        owner: { host: "test", pid: 1, procStart: null },
      });

      const second = await runRenderPipeline("job1", {
        store: mem.store,
        probes: allOkProbes(),
        executors: { ...EXECUTORS, ...executors(dir) } as never,
        outputRoot: dir,
        attemptId: secondId,
      });

      // It ran: it is attempt 2, it wrote its OWN rows, and attempt 1's rows are
      // untouched beside them.
      expect(second.attemptNumber).toBe(2);
      expect(second.status).toBe("succeeded");
      expect(mem.rowsOf(secondId).length).toBe(PIPELINE_STAGES.length);
      expect(mem.rowsOf("attempt1").length).toBe(PIPELINE_STAGES.length);
      expect(mem.rowsOf(secondId)[0].stageId).toBe(PIPELINE_STAGES[0].id);
      expect(seqOf(PIPELINE_STAGES[0].id)).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
