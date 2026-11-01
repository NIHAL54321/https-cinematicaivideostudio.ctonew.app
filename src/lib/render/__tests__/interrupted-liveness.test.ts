/**
 * GUARD 2 — AN INTERRUPTED STAGE IS NEVER REPORTED AS RUNNING OR SUCCEEDED,
 * AND THE VERDICT SAYS WHICH KIND OF INTERRUPTION IT IS (Phase 8, block 6).
 *
 * THE PROPERTY. A stage row left in state RUNNING by a process that no longer
 * exists has no outcome. It is not running (nothing is working on it) and it is
 * not succeeded (nothing was produced). The read-out must say `interrupted`, and
 * it must say WHICH EVIDENCE it used:
 *
 *   - `interrupted`            — the owning process was OBSERVED gone. A fact.
 *   - `interrupted-by-lease`   — no owner was recorded and the heartbeat is past
 *                                the lease. An INFERENCE, and the sentence says so.
 *
 * THE RECYCLED-PID CASE IS THE POINT OF THE WHOLE FILE. A pid is a number the
 * kernel reuses. "Pid 4242 exists" is not evidence about the process that owned
 * the attempt; the kernel's start time for that pid is. So the tests drive a
 * FABRICATED /proc (a directory tree this test writes) where pid 4242 exists
 * with a DIFFERENT start time from the one the attempt recorded — and the answer
 * must not be `alive`.
 *
 * THE NEGATIVE CONTROLS: the guard is run against a genuinely alive observation
 * (this process, whose start time really is what /proc reports), against the
 * lease verdict while expecting the observed one, and against a fabricated
 * `finished` verdict. Each must throw, and each does.
 */
import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  HEARTBEAT_LEASE_MS,
  currentProcessIdentity,
  deriveAttemptLiveness,
  isDeadVerdict,
  readProcStart,
  type AttemptLiveness,
  type AttemptRowFacts,
} from "../attempt";
import { deriveJobStatus, deriveProgress, deriveStageDisplayState } from "../pipeline";

const HOST = "cavs-test-host";
const NOW = new Date("2026-11-01T12:00:00.000Z");

/**
 * A fabricated `/proc`: `<root>/<pid>/stat` holding exactly the field layout the
 * kernel uses, with `startTime` in field 22 (the 20th value after the command).
 */
function fakeProc(root: string, pid: number, startTime: string): void {
  const dir = join(root, String(pid));
  mkdirSync(dir, { recursive: true });
  const fields = [
    "S", // 3 state
    "1", // 4 ppid
    "4242", // 5 pgrp
    "4242", // 6 session
    "0", // 7 tty_nr
    "-1", // 8 tpgid
    "4194560", // 9 flags
    "100", // 10 minflt
    "0", // 11 cminflt
    "0", // 12 majflt
    "0", // 13 cmajflt
    "1", // 14 utime
    "0", // 15 stime
    "0", // 16 cutime
    "0", // 17 cstime
    "20", // 18 priority
    "0", // 19 nice
    "1", // 20 num_threads
    "0", // 21 itrealvalue
    startTime, // 22 starttime
  ];
  writeFileSync(join(dir, "stat"), `4242 (cavs-test-double) ${fields.join(" ")} 12345 100\n`, "utf8");
}

function attemptRow(over: Partial<AttemptRowFacts> = {}): AttemptRowFacts {
  return {
    attemptNumber: 2,
    state: "RUNNING",
    ownerHost: HOST,
    ownerPid: 4242,
    ownerProcStart: "111",
    heartbeatAt: new Date(NOW.getTime() - 5_000),
    lastStageId: "encode-master",
    startedAt: new Date(NOW.getTime() - 60_000),
    finishedAt: null,
    endedReason: null,
    ...over,
  };
}

function liveness(attempt: AttemptRowFacts, procRoot: string): AttemptLiveness {
  return deriveAttemptLiveness(attempt, { now: () => NOW, host: HOST, procRoot });
}

/* ------------------------------------------------------------------ */
/* THE GUARD                                                           */
/* ------------------------------------------------------------------ */

/**
 * Fails when an attempt whose owner is gone reads as anything other than the
 * interruption the evidence supports — and when the sentence does not say which
 * kind of evidence it used.
 */
function guardNeverRunning(v: AttemptLiveness, expected: "interrupted" | "interrupted-by-lease"): void {
  if (v.verdict === "alive") {
    throw new Error(`GUARD: an attempt whose owner is gone reads as ALIVE — ${v.basis}`);
  }
  if (v.verdict === "finished") {
    throw new Error(`GUARD: an attempt whose owner is gone reads as FINISHED — nothing wrote an ending: ${v.basis}`);
  }
  if (v.verdict !== expected) {
    throw new Error(
      `GUARD: expected "${expected}" but the verdict is "${v.verdict}" — an observed interruption and a lease-based ` +
        `inference must never be reported as one thing: ${v.basis}`,
    );
  }
  if (expected === "interrupted" && !/does not exist|pid was reused|different process|cannot see that process/.test(v.basis)) {
    throw new Error(`GUARD: the "interrupted" verdict does not say the owning process was observed gone: ${v.basis}`);
  }
  if (expected === "interrupted-by-lease" && !/TIME-BASED INFERENCE, not an observation/.test(v.basis)) {
    throw new Error(`GUARD: the lease verdict does not say it is an inference rather than an observation: ${v.basis}`);
  }
}

/* ------------------------------------------------------------------ */
/* 1 — the observation                                                 */
/* ------------------------------------------------------------------ */

describe("liveness is an observation, and it names its evidence", () => {
  test("the owner is gone: verdict interrupted, and the sentence says the process was observed gone", () => {
    const root = mkdtempSync(join(tmpdir(), "cavs-proc-"));
    try {
      // No /proc/4242 at all.
      const v = liveness(attemptRow(), root);
      expect(v.verdict).toBe("interrupted");
      expect(v.observed).toBe(true);
      expect(v.basis).toContain("does not exist");
      expect(v.basis).toContain("the process that owned this attempt is gone");
      expect(v.basis).toContain("encode-master");
      expect(v.basis).toContain(NOW.toISOString().slice(0, 10));
      guardNeverRunning(v, "interrupted");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a RECYCLED pid — same number, different kernel start time — does not read as alive", () => {
    const root = mkdtempSync(join(tmpdir(), "cavs-proc-"));
    try {
      fakeProc(root, 4242, "999"); // the pid exists, but it is a different process
      const v = liveness(attemptRow({ ownerProcStart: "111" }), root);
      expect(v.verdict).toBe("interrupted");
      expect(v.verdict).not.toBe("alive");
      expect(v.basis).toContain("now belongs to a different process");
      expect(v.basis).toContain("the pid was reused");
      expect(v.basis).toContain("999");
      expect(v.basis).toContain("111");
      guardNeverRunning(v, "interrupted");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("POSITIVE CONTROL: the same pid AND the recorded start time does read as alive", () => {
    const root = mkdtempSync(join(tmpdir(), "cavs-proc-"));
    try {
      fakeProc(root, 4242, "111");
      const v = liveness(attemptRow({ ownerProcStart: "111" }), root);
      expect(v.verdict).toBe("alive");
      expect(v.basis).toContain("is alive on this machine");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the check reads the real /proc for a real process — this one", () => {
    const me = currentProcessIdentity();
    expect(me.pid).toBe(process.pid);
    expect(me.procStart).not.toBeNull();
    expect(readProcStart(process.pid)).toBe(me.procStart);
    // A pid that cannot be ours, with a start time that cannot be ours.
    expect(readProcStart(process.pid, "/proc")).not.toBe("0");
  });

  test("an attempt owned by another host is not claimed to have been checked", () => {
    const root = mkdtempSync(join(tmpdir(), "cavs-proc-"));
    try {
      const v = liveness(attemptRow({ ownerHost: "some-other-machine" }), root);
      expect(v.verdict).toBe("interrupted");
      expect(v.basis).toContain("cannot see that process");
      guardNeverRunning(v, "interrupted");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------------------------ */
/* 2 — the lease fallback says it is a fallback                        */
/* ------------------------------------------------------------------ */

describe("when no owner was recorded, the lease is labelled as an inference", () => {
  test("a heartbeat past the lease is interrupted-by-lease, and says it is not an observation", () => {
    const root = mkdtempSync(join(tmpdir(), "cavs-proc-"));
    try {
      const stale = attemptRow({ ownerPid: null, ownerProcStart: null, heartbeatAt: new Date(NOW.getTime() - HEARTBEAT_LEASE_MS - 60_000) });
      const v = liveness(stale, root);
      expect(v.verdict).toBe("interrupted-by-lease");
      expect(v.observed).toBe(false);
      expect(v.basis).toContain("TIME-BASED INFERENCE, not an observation");
      expect(v.basis).toContain("records no owning process");
      guardNeverRunning(v, "interrupted-by-lease");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a heartbeat inside the lease with no owner is unknown — not alive, and it says so", () => {
    const root = mkdtempSync(join(tmpdir(), "cavs-proc-"));
    try {
      const v = liveness(attemptRow({ ownerPid: null, ownerProcStart: null }), root);
      expect(v.verdict).toBe("unknown");
      expect(v.basis).toContain("This build cannot say whether it is still running");
      expect(isDeadVerdict(v.verdict)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("an attempt that wrote its own ending is finished, and its sentence quotes that ending", () => {
    const root = mkdtempSync(join(tmpdir(), "cavs-proc-"));
    try {
      const v = liveness(
        attemptRow({ state: "FAILED", finishedAt: NOW, endedReason: 'stage "container-mux" failed: EISDIR' }),
        root,
      );
      expect(v.verdict).toBe("finished");
      expect(v.basis).toContain("ended as FAILED");
      expect(v.basis).toContain("EISDIR");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

/* ------------------------------------------------------------------ */
/* 3 — what the pipeline read-out does with it                         */
/* ------------------------------------------------------------------ */

describe("the derived stage and job state", () => {
  test("a RUNNING row under a dead owner is INTERRUPTED, and earns no weight", () => {
    expect(deriveStageDisplayState("RUNNING", false)).toBe("INTERRUPTED");
    const rows = [
      { stageId: "resolve-inputs", sequence: 1, state: "SUCCEEDED" as const },
      { stageId: "assemble-timeline", sequence: 2, state: "INTERRUPTED" as const },
    ];
    expect(deriveJobStatus(rows)).toBe("interrupted");
    const p = deriveProgress(rows);
    expect(p.percent).toBe(10);
    expect(p.uncounted.map((u) => u.stageId)).toContain("assemble-timeline");
  });

  test("POSITIVE CONTROL: an INTERRUPTED row is not running and not succeeded — a live owner IS running", () => {
    expect(deriveStageDisplayState("RUNNING", true)).toBe("RUNNING");
    // A row that really succeeded is never retconned by a dead owner.
    expect(deriveStageDisplayState("SUCCEEDED", false)).toBe("SUCCEEDED");
    // And an interrupted job never derives as running or succeeded.
    const interrupted = [{ stageId: "encode-master", sequence: 5, state: "INTERRUPTED" as const }];
    expect(deriveJobStatus(interrupted)).not.toBe("running");
    expect(deriveJobStatus(interrupted)).not.toBe("succeeded");
  });
});

/* ------------------------------------------------------------------ */
/* 4 — THE NEGATIVE CONTROLS                                           */
/* ------------------------------------------------------------------ */

describe("NEGATIVE CONTROLS: the guard fires on a verdict it must not accept", () => {
  test("a genuinely ALIVE observation is rejected when an interruption is required", () => {
    const root = mkdtempSync(join(tmpdir(), "cavs-proc-"));
    try {
      fakeProc(root, 4242, "111");
      const alive = liveness(attemptRow({ ownerProcStart: "111" }), root);
      expect(alive.verdict).toBe("alive");
      expect(() => guardNeverRunning(alive, "interrupted")).toThrow(/GUARD: an attempt whose owner is gone reads as ALIVE/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("the lease inference is rejected when the OBSERVED interruption is required — the two are never conflated", () => {
    const root = mkdtempSync(join(tmpdir(), "cavs-proc-"));
    try {
      const stale = attemptRow({ ownerPid: null, ownerProcStart: null, heartbeatAt: new Date(NOW.getTime() - HEARTBEAT_LEASE_MS - 60_000) });
      const v = liveness(stale, root);
      expect(v.verdict).toBe("interrupted-by-lease");
      expect(() => guardNeverRunning(v, "interrupted")).toThrow(/expected "interrupted" but the verdict is "interrupted-by-lease"/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a fabricated FINISHED verdict is rejected — nothing wrote an ending", () => {
    const fabricated = {
      verdict: "finished",
      observed: true,
      basis: "attempt 2 ended as SUCCEEDED",
      checkedAt: NOW.toISOString(),
      owner: { host: HOST, pid: 4242, procStart: "111" },
      lastHeartbeatAt: NOW.toISOString(),
      heartbeatAgeMs: 0,
      lastStageId: "encode-master",
      leaseMs: HEARTBEAT_LEASE_MS,
    } as AttemptLiveness;
    expect(() => guardNeverRunning(fabricated, "interrupted")).toThrow(/reads as FINISHED/);
  });
});
