/**
 * GUARD 1 — A RETRY NEVER RE-RUNS A STAGE THAT ALREADY SUCCEEDED (Phase 8, block 6).
 *
 * THE PROPERTY. A retry starts at the FIRST DECLARED STAGE THAT DID NOT SUCCEED.
 * Every stage before it was done by an earlier attempt, its work is recorded on
 * that attempt's rows, and running it again would be doing the same work twice
 * and paying for it twice.
 *
 * HOW IT IS PINNED, three ways:
 *   1. through the REAL runner, twice on one job: attempt 1 really fails at
 *      `container-mux`, attempt 2 really starts there and writes no row for the
 *      five stages it honoured;
 *   2. through `computeResumePoint` directly, including the case that matters
 *      most — the LATEST row across attempts decides, so a later attempt's
 *      failure moves the resume point back to it;
 *   3. a succeeded FILE stage whose file no longer matches its row is NOT
 *      honoured, because a row is not a file.
 *
 * THE NEGATIVE CONTROL, and it is not a formality: the same guard is run against
 * a store that has LOST the history (`hideHistory`), which is exactly what a
 * resume point computed as an earlier stage looks like from the outside. The
 * retry then starts at stage 1 and re-runs the encode, and the guard throws. A
 * second control fires the guard's other clause with a fabricated result that
 * wrote a row for a stage it claimed to honour.
 */
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PIPELINE_STAGES } from "../pipeline";
import { EXECUTORS } from "../executors";
import { probeArtefactFile, runRenderPipeline } from "../runner";
import { computeResumePoint, type HistoryRow } from "../recovery";
import { memoryRenderStore, realStageFile } from "./memory-store";
import { StageFailure } from "../types";
import type { Probe, ProbeId } from "../probes";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

const PROBE_IDS: ProbeId[] = ["project-has-scenes", "storage-writable", "ffmpeg-binary", "ffprobe-binary", "encode-provider-keyed"];

/** Every requisite present — this test is about the retry, not about the gate. */
function allOkProbes(): Record<ProbeId, Probe> {
  return Object.fromEntries(
    PROBE_IDS.map((id) => [id, async () => ({ ok: true, detail: `${id}: forced ok for this test`, missing: null })]),
  ) as Record<ProbeId, Probe>;
}

/**
 * The file stages, really writing the files they declare. `failMux` makes
 * `container-mux` throw AFTER `encode-master` has succeeded and recorded a real
 * master file — the exact shape a genuine failure leaves behind.
 */
function executors(dir: string, opts: { failMux?: boolean } = {}) {
  return {
    "encode-master": async () => {
      const f = realStageFile(dir, "master.mp4", "MASTER-BYTES-FROM-THE-TEST-DOUBLE", "master-video");
      return { record: { encoder: "test double", bytes: f.bytes, sha256: f.sha256 }, files: [f] };
    },
    "container-mux": async () => {
      if (opts.failMux) {
        throw new StageFailure("container-mux: the encoder refused to write the delivered container (test double)");
      }
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

/* ------------------------------------------------------------------ */
/* THE GUARD                                                           */
/* ------------------------------------------------------------------ */

interface RetryEvidence {
  attemptNumber: number;
  /** The stage the retry actually started at. */
  startStageId: string;
  /** The stages it said it would NOT run. */
  honouredStageIds: string[];
  /** The stage rows it actually wrote. */
  rowsWrittenByAttempt: Array<{ stageId: string }>;
  /** The first declared stage whose latest row was not SUCCEEDED. */
  firstUnsuccessfulStageId: string;
}

/**
 * Fails when a retry re-ran work that had already succeeded. Both clauses are
 * the same property seen from two sides: the resume point must not be EARLIER
 * than the first stage that did not succeed, and no honoured stage may have a
 * row written by the retrying attempt.
 */
function guardRetryDidNotRerun(e: RetryEvidence): void {
  const rerun = e.rowsWrittenByAttempt.filter((r) => e.honouredStageIds.includes(r.stageId));
  if (rerun.length > 0) {
    throw new Error(
      `GUARD: attempt ${e.attemptNumber} wrote a stage row for honoured stage(s) ${rerun
        .map((r) => r.stageId)
        .join(", ")} — a retry must not re-run a stage that already succeeded`,
    );
  }
  if (seqOf(e.startStageId) < seqOf(e.firstUnsuccessfulStageId)) {
    throw new Error(
      `GUARD: the retry started at "${e.startStageId}" (sequence ${seqOf(e.startStageId)}), which is EARLIER than the ` +
        `first stage that did not succeed ("${e.firstUnsuccessfulStageId}", sequence ${seqOf(e.firstUnsuccessfulStageId)}) — ` +
        `work that already succeeded would be paid for twice`,
    );
  }
}

/* ------------------------------------------------------------------ */
/* 1 — through the real runner, twice                                  */
/* ------------------------------------------------------------------ */

describe("a retry through the real runner", () => {
  test("attempt 2 starts at the failed stage, reuses the master, and writes no row for the five it honoured", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cavs-retry-"));
    const mem = memoryRenderStore({ job: { id: "job1" } });
    try {
      const first = await runRenderPipeline("job1", {
        store: mem.store,
        probes: allOkProbes(),
        executors: { ...EXECUTORS, ...executors(dir, { failMux: true }) } as never,
        outputRoot: dir,
      });
      expect(first.status).toBe("failed");
      expect(first.halted?.stageId).toBe("container-mux");
      expect(first.attemptNumber).toBe(1);
      expect(mem.attempts.length).toBe(1);
      expect(mem.attempts[0].state).toBe("FAILED");
      // The master really exists and is recorded against attempt 1.
      const master = mem.artefacts.find((a) => a.artefactKind === "master-video")!;
      expect(master.attemptId).toBe("attempt1");

      const second = await runRenderPipeline("job1", {
        store: mem.store,
        probes: allOkProbes(),
        executors: { ...EXECUTORS, ...executors(dir) } as never,
        outputRoot: dir,
      });

      // It is a NEW attempt, it starts where the failure was, and the five
      // stages before it are honoured rather than re-run.
      expect(second.attemptNumber).toBe(2);
      expect(second.startStageId).toBe("container-mux");
      expect(second.honouredStageIds).toEqual([
        "resolve-inputs",
        "assemble-timeline",
        "audio-mix-plan",
        "subtitle-plan",
        "encode-master",
      ]);
      expect(second.status).toBe("succeeded");
      expect(second.progress.percent).toBe(100);

      // It wrote exactly two rows, for the two stages it actually ran.
      expect(second.stageRows.map((r) => r.stageId)).toEqual(["container-mux", "checksum-artefact"]);
      expect(mem.rowsOf("attempt2").map((r) => r.stageId)).toEqual(["container-mux", "checksum-artefact"]);
      // And "encode-master" still has ONE row in the whole store — attempt 1's.
      expect(mem.rows.filter((r) => r.stageId === "encode-master").length).toBe(1);
      expect(mem.rows.filter((r) => r.stageId === "encode-master")[0].attemptId).toBe("attempt1");

      // The master was REUSED, not produced again: one artefact row, from attempt 1.
      expect(second.reusedArtefacts.map((a) => a.kind)).toEqual(["master-video"]);
      expect(second.reusedArtefacts[0].fromAttemptNumber).toBe(1);
      expect(second.reusedArtefacts[0].sha256).toBe(master.sha256);
      expect(mem.artefacts.filter((a) => a.artefactKind === "master-video").length).toBe(1);
      // Only the two stages attempt 2 ran produced new artefact rows.
      expect(mem.artefacts.filter((a) => a.attemptId === "attempt2").map((a) => a.artefactKind).sort()).toEqual([
        "checksum-sidecar",
        "delivered-container",
      ]);

      // THE GUARD: it passes on the real thing.
      guardRetryDidNotRerun({
        attemptNumber: second.attemptNumber,
        startStageId: second.startStageId,
        honouredStageIds: second.honouredStageIds,
        rowsWrittenByAttempt: second.stageRows,
        firstUnsuccessfulStageId: "container-mux",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("NEGATIVE CONTROL: a resume point computed as an earlier stage re-runs the encode, and the guard throws", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cavs-retry-neg-"));
    // The store has LOST the history: `stageHistory` answers with nothing, which
    // is what "the resume point was computed as an earlier stage" looks like.
    const mem = memoryRenderStore({ job: { id: "job1" }, hideHistory: true });
    try {
      const first = await runRenderPipeline("job1", {
        store: mem.store,
        probes: allOkProbes(),
        executors: { ...EXECUTORS, ...executors(dir, { failMux: true }) } as never,
        outputRoot: dir,
      });
      expect(first.status).toBe("failed");

      const second = await runRenderPipeline("job1", {
        store: mem.store,
        probes: allOkProbes(),
        executors: { ...EXECUTORS, ...executors(dir) } as never,
        outputRoot: dir,
      });
      // The break is real: it started at stage 1 again.
      expect(second.startStageId).toBe("resolve-inputs");
      expect(second.honouredStageIds).toEqual([]);
      // ...and the encode really ran a second time: two master-video rows now.
      expect(mem.artefacts.filter((a) => a.artefactKind === "master-video").length).toBe(2);

      expect(() =>
        guardRetryDidNotRerun({
          attemptNumber: second.attemptNumber,
          startStageId: second.startStageId,
          honouredStageIds: ["resolve-inputs", "assemble-timeline", "audio-mix-plan", "subtitle-plan", "encode-master"],
          rowsWrittenByAttempt: second.stageRows,
          firstUnsuccessfulStageId: "container-mux",
        }),
      ).toThrow(/GUARD: attempt 2 wrote a stage row for honoured stage\(s\) resolve-inputs/);

      expect(() =>
        guardRetryDidNotRerun({
          attemptNumber: second.attemptNumber,
          startStageId: second.startStageId,
          honouredStageIds: [],
          rowsWrittenByAttempt: second.stageRows,
          firstUnsuccessfulStageId: "container-mux",
        }),
      ).toThrow(/GUARD: the retry started at "resolve-inputs" \(sequence 1\), which is EARLIER/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------------------------ */
/* 2 — the rule itself, from the rows                                  */
/* ------------------------------------------------------------------ */

describe("computeResumePoint — the latest row across attempts decides", () => {
  const probeNothing = () => ({ present: false, bytes: null, sha256: null, detail: "not looked at by this test" });

  test("a later attempt's failure moves the resume point back to that stage", () => {
    const rows: HistoryRow[] = [
      { attemptId: "a1", attemptNumber: 1, stageId: "resolve-inputs", sequence: 1, state: "SUCCEEDED" },
      { attemptId: "a1", attemptNumber: 1, stageId: "assemble-timeline", sequence: 2, state: "SUCCEEDED" },
      { attemptId: "a2", attemptNumber: 2, stageId: "resolve-inputs", sequence: 1, state: "FAILED" },
    ];
    const resume = computeResumePoint({
      stages: PIPELINE_STAGES,
      attempts: [
        { id: "a1", attemptNumber: 1 },
        { id: "a2", attemptNumber: 2 },
      ],
      rows,
      artefacts: [],
      probe: probeNothing,
    });
    // Attempt 1 succeeded at stage 1; attempt 2 failed at it. The LATEST row
    // wins, so the resume point is stage 1 — not stage 2.
    expect(resume.startStageId).toBe("resolve-inputs");
    expect(resume.basis).toContain('"resolve-inputs" is FAILED on attempt 2');
  });

  test("a stage with no row on any attempt is where a retry starts", () => {
    const rows: HistoryRow[] = [
      { attemptId: "a1", attemptNumber: 1, stageId: "resolve-inputs", sequence: 1, state: "SUCCEEDED" },
      { attemptId: "a1", attemptNumber: 1, stageId: "assemble-timeline", sequence: 2, state: "SUCCEEDED" },
      { attemptId: "a1", attemptNumber: 1, stageId: "encode-master", sequence: 5, state: "FAILED" },
      { attemptId: "a2", attemptNumber: 2, stageId: "encode-master", sequence: 5, state: "SUCCEEDED" },
    ];
    const resume = computeResumePoint({
      stages: PIPELINE_STAGES,
      attempts: [
        { id: "a1", attemptNumber: 1 },
        { id: "a2", attemptNumber: 2 },
      ],
      rows,
      artefacts: [],
      probe: probeNothing,
    });
    // 1 and 2 succeeded, 5 succeeded on the retry — but 3 never ran at all.
    expect(resume.startStageId).toBe("audio-mix-plan");
    expect(resume.honoured.map((h) => h.stageId)).toEqual(["resolve-inputs", "assemble-timeline"]);
    expect(resume.basis).toContain("has no row on any attempt");
  });

  test("a SUCCEEDED file stage whose file no longer matches its row is NOT honoured", () => {
    const resume = computeResumePoint({
      stages: PIPELINE_STAGES,
      attempts: [{ id: "a1", attemptNumber: 1 }],
      rows: [
        { attemptId: "a1", attemptNumber: 1, stageId: "resolve-inputs", sequence: 1, state: "SUCCEEDED" },
        { attemptId: "a1", attemptNumber: 1, stageId: "assemble-timeline", sequence: 2, state: "SUCCEEDED" },
        { attemptId: "a1", attemptNumber: 1, stageId: "audio-mix-plan", sequence: 3, state: "SUCCEEDED" },
        { attemptId: "a1", attemptNumber: 1, stageId: "subtitle-plan", sequence: 4, state: "SUCCEEDED" },
        { attemptId: "a1", attemptNumber: 1, stageId: "encode-master", sequence: 5, state: "SUCCEEDED" },
      ],
      artefacts: [
        {
          attemptId: "a1",
          stageId: "encode-master",
          kind: "master-video",
          path: "/tmp/cavs-does-not-exist/master.mp4",
          bytes: 1234,
          sha256: "a".repeat(64),
        },
      ],
      probe: probeArtefactFile,
    });
    expect(resume.startStageId).toBe("encode-master");
    expect(resume.reused).toEqual([]);
    expect(resume.refused.length).toBe(1);
    expect(resume.refused[0].detail).toContain("is not on disk");
    expect(resume.basis).toContain("no longer matches its row");
  });
});
