/**
 * IS THIS RENDER STILL MOVING? — the one question the Export tab's poll asks.
 *
 * WHY THIS EXISTS (fix recorded in `evidence/phase8_export_panel/README.md` §4)
 * The panel stopped polling the moment the JOB's derived status was terminal.
 * After a Retry that is exactly the wrong answer: the job's status is derived
 * from the stage rows of EVERY attempt, and the stopped attempt's STOPPED rows
 * are never rewritten — so a job whose attempt 3 is RUNNING still derives
 * `stopped`, the panel showed `STOPPED / attempt 3 · queued`, and only a manual
 * `Re-read` moved it. Nothing shown was false; it was stale.
 *
 * So a job is worth polling while EITHER the job itself is non-terminal OR the
 * NEWEST attempt is `queued` or `running`. Only when both say nothing can move
 * does the poll stop — and a terminal attempt (succeeded/failed/blocked/
 * stopped/interrupted) is never polled, because nothing but a person moves it.
 */
import type { RenderReadout } from "./service";

/** States nothing will move without a person: polling stops on these. */
export const TERMINAL_JOB_STATUSES = new Set(["blocked", "failed", "stopped", "succeeded", "interrupted"]);

/** An attempt state that a later read could still change. */
const LIVE_ATTEMPT_STATES = new Set(["queued", "running"]);

export function shouldKeepPolling(
  readout: Pick<RenderReadout, "status" | "latestAttempt"> | null,
): boolean {
  if (!readout) return false;
  if (!TERMINAL_JOB_STATUSES.has(readout.status)) return true;
  const latest = readout.latestAttempt;
  return latest !== null && LIVE_ATTEMPT_STATES.has(latest.state);
}
