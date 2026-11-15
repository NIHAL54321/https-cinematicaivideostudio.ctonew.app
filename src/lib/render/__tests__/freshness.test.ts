/**
 * THE EXPORT TAB'S FRESHNESS RULE (fix recorded in
 * `evidence/phase8_export_panel/README.md` §4).
 *
 * The defect: after a Retry the panel read `STOPPED / attempt 3 · queued` while
 * attempt 3 was RUNNING in the rows, and only `Re-read` moved it. The cause is
 * that a job's derived status is computed over the stage rows of EVERY attempt,
 * and the stopped attempt's STOPPED rows are never rewritten — so the job keeps
 * deriving `stopped` while its newest attempt runs.
 *
 * These tests drive the rule the panel now uses: poll while the job is
 * non-terminal OR its newest attempt is queued/running.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { shouldKeepPolling, TERMINAL_JOB_STATUSES } from "@/lib/render/freshness";
import type { AttemptReadout, RenderReadout } from "@/lib/render/service";

type AttemptState = AttemptReadout["state"];

function attempt(state: AttemptState, attemptNumber = 3): AttemptReadout {
  return {
    id: `att_${attemptNumber}`,
    attemptNumber,
    recordedState: state === "queued" ? "RUNNING" : state === "running" ? "RUNNING" : "STOPPED",
    state,
    startStageId: "container-mux",
    continuedFromId: null,
    startedAt: "2026-11-15T17:41:40.000Z",
    finishedAt: null,
    lastHeartbeatAt: "2026-11-15T17:41:45.000Z",
    heartbeatCount: 1,
    lastStageId: "container-mux",
    endedReason: null,
    liveness: {
      verdict: "alive",
      observed: true,
      basis: "the process that owns this attempt is alive",
      checkedAt: "2026-11-15T17:41:45.000Z",
      owner: { host: "blaxel", pid: 4242, procStart: "12345" },
      lastHeartbeatAt: "2026-11-15T17:41:45.000Z",
      heartbeatAgeMs: 0,
      lastStageId: "container-mux",
      leaseMs: 60_000,
    },
    stageRowCount: 1,
    reusedArtefacts: null,
  };
}

function readout(status: RenderReadout["status"], latestAttempt: AttemptReadout | null): Pick<RenderReadout, "status" | "latestAttempt"> {
  return { status, latestAttempt };
}

describe("shouldKeepPolling", () => {
  test("no job read yet: nothing to poll", () => {
    expect(shouldKeepPolling(null)).toBe(false);
  });

  test("a queued or running job is polled", () => {
    expect(shouldKeepPolling(readout("queued", null))).toBe(true);
    expect(shouldKeepPolling(readout("running", attempt("running")))).toBe(true);
  });

  /* THE DEFECT: job status stopped (from attempt 2's rows) while attempt 3 is
   * queued or running. The panel must keep polling here. */
  test("a retried attempt is polled even though the job still derives stopped", () => {
    expect(shouldKeepPolling(readout("stopped", attempt("queued")))).toBe(true);
    expect(shouldKeepPolling(readout("stopped", attempt("running")))).toBe(true);
  });

  test("a terminal attempt with a terminal job stops the poll — nothing but a person moves it", () => {
    expect(shouldKeepPolling(readout("stopped", attempt("stopped")))).toBe(false);
    expect(shouldKeepPolling(readout("succeeded", attempt("succeeded")))).toBe(false);
    expect(shouldKeepPolling(readout("failed", attempt("failed")))).toBe(false);
    expect(shouldKeepPolling(readout("blocked", attempt("blocked")))).toBe(false);
    expect(shouldKeepPolling(readout("interrupted", attempt("interrupted")))).toBe(false);
    // An attempt whose owner process is gone is terminal too: a poll cannot fix it.
    expect(shouldKeepPolling(readout("interrupted", attempt("interrupted")))).toBe(false);
  });

  test("every job status the panel calls terminal is in the shared set", () => {
    for (const s of ["blocked", "failed", "stopped", "succeeded", "interrupted"]) {
      expect(TERMINAL_JOB_STATUSES.has(s)).toBe(true);
    }
    for (const s of ["queued", "running"]) expect(TERMINAL_JOB_STATUSES.has(s)).toBe(false);
  });

  /* The rule is only worth anything if the panel actually asks it. */
  test("the Export tab polls through this rule, not the job status alone", () => {
    const src = readFileSync(join(process.cwd(), "src/components/projects/export-tab.tsx"), "utf8");
    expect(src).toContain("shouldKeepPolling");
    expect(src).toContain("if (!shouldKeepPolling(job)) return;");
    expect(src).not.toContain("if (!job || TERMINAL.has(job.status)) return;");
  });
});
