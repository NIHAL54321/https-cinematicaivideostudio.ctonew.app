/**
 * IS THAT ATTEMPT STILL RUNNING? — answered by LOOKING, not by guessing.
 *
 * THE PROBLEM THIS SOLVES. When the process running a render dies (a killed
 * server, a machine reset, an OOM kill), nothing writes a final row: the writer
 * is the thing that died. The database is left holding a stage row in state
 * RUNNING and an attempt that never ended, and the product used to report that
 * job as "running" forever. That is a lie a user cannot act on.
 *
 * THE RULE. A RUNNING attempt records WHO owns it — the host, the pid, and that
 * process's own start time as the kernel reports it (`/proc/<pid>/stat`, field
 * 22). A later read asks the kernel whether that exact process still exists. If
 * it does not, the attempt is INTERRUPTED: a fact observed at read time, not a
 * verdict inferred from how long ago the row was written.
 *
 * WHY THE START TIME AND NOT JUST THE PID. Pids are recycled. On a busy machine
 * a new process can inherit the dead one's pid within minutes, and "pid 4211
 * exists" would then be true about a completely different program. Comparing the
 * kernel's start time for that pid with the one recorded when the attempt began
 * makes the check about THE process, not about the number.
 *
 * AND WHEN THE OBSERVATION IS IMPOSSIBLE, IT SAYS SO. An attempt whose owner ran
 * on another host, or one created before this block existed, cannot be checked
 * this way. For those the module falls back to the heartbeat stamp and labels
 * the verdict `interrupted-by-lease` / `unknown`, with the words that say which
 * kind of evidence it used. A fallback that pretends to be an observation is
 * exactly the failure mode this file exists to prevent.
 */
import { hostname } from "node:os";
import { readFileSync } from "node:fs";

/** Who is running this attempt. */
export interface ProcessIdentity {
  host: string;
  pid: number;
  /**
   * The process's start time, from `/proc/<pid>/stat` field 22 (clock ticks
   * since boot). `null` when it could not be read — the read-out then says the
   * check was weaker rather than claiming the pid was enough.
   */
  procStart: string | null;
}

/**
 * How old a heartbeat may be before an attempt with NO owning process is called
 * interrupted. Only ever used on the fallback path.
 */
export const HEARTBEAT_LEASE_MS = 120_000;

/**
 * How often a running stage re-stamps its attempt. A long encode would otherwise
 * have a heartbeat from the moment the stage started, which reads as "stale"
 * even while ffmpeg is working.
 */
export const HEARTBEAT_INTERVAL_MS = 5_000;

/**
 * The kernel's start time for a pid, or null when there is no such process (or
 * no /proc to read — the check degrades, it does not throw).
 */
export function readProcStart(pid: number, procRoot = "/proc"): string | null {
  try {
    const stat = readFileSync(`${procRoot}/${pid}/stat`, "utf8");
    // Field 2 is the command in parentheses and may itself contain spaces and
    // parentheses, so the fields are counted from the LAST ")". Field 3 is the
    // first field after it, which makes the kernel's start time field 22 the
    // 20th value after the closing parenthesis.
    const close = stat.lastIndexOf(")");
    if (close < 0) return null;
    const rest = stat.slice(close + 1).trim().split(/\s+/);
    // rest[0] is field 3 (state) → field 22 is rest[19].
    return rest[19] ?? null;
  } catch {
    return null;
  }
}

/** The identity of THIS process — recorded on an attempt when it starts. */
export function currentProcessIdentity(): ProcessIdentity {
  return { host: hostname(), pid: process.pid, procStart: readProcStart(process.pid) };
}

export interface ProcessCheck {
  /** True only when the exact process that owned the attempt is still there. */
  alive: boolean;
  /** The observation, in words — always names what was looked at. */
  observed: string;
}

/**
 * Ask the kernel about a recorded owner.
 *
 * Returns `alive: true` only on positive evidence. Every other outcome is
 * `false` with the reason: a pid that is gone, a pid that now belongs to a
 * different process, a host this server cannot inspect, or a pid it never had.
 */
export function checkOwnerProcess(
  owner: { host: string | null; pid: number | null; procStart: string | null },
  host = hostname(),
  procRoot = "/proc",
): ProcessCheck {
  if (owner.pid === null) {
    return { alive: false, observed: "this attempt records no owning pid, so no process could be looked for" };
  }
  if (owner.host && owner.host !== host) {
    return {
      alive: false,
      observed: `this attempt was owned by pid ${owner.pid} on host "${owner.host}", and this server runs on "${host}" — it cannot see that process, so it does not claim to have checked it`,
    };
  }
  const start = readProcStart(owner.pid, procRoot);
  if (start === null) {
    return {
      alive: false,
      observed: `pid ${owner.pid} does not exist on this machine (/proc/${owner.pid}/stat could not be read) — the process that owned this attempt is gone`,
    };
  }
  if (owner.procStart !== null && start !== owner.procStart) {
    return {
      alive: false,
      observed: `pid ${owner.pid} now belongs to a different process: the kernel reports start time ${start}, and the attempt recorded ${owner.procStart} — the original owner is gone and the pid was reused`,
    };
  }
  return {
    alive: true,
    observed: `pid ${owner.pid} is alive on this machine and its kernel start time (${start}) is the one the attempt recorded${
      owner.procStart === null ? " — no start time was recorded, so this rests on the pid alone" : ""
    }`,
  };
}

/**
 * What a reader is told about an attempt's liveness.
 *
 *  - `alive`               — the owning process was observed, right now.
 *  - `finished`            — the attempt ended and wrote its own ending.
 *  - `interrupted`         — the owner is OBSERVED gone. A fact.
 *  - `interrupted-by-lease`— no owner recorded; the heartbeat is older than the
 *                            lease. An inference, and it says so.
 *  - `unknown`             — neither possible: no owner, heartbeat inside lease.
 */
export type LivenessVerdict = "alive" | "finished" | "interrupted" | "interrupted-by-lease" | "unknown";

export interface AttemptLiveness {
  verdict: LivenessVerdict;
  /** True when this verdict came from looking at a process. */
  observed: boolean;
  /** The sentence a person reads. */
  basis: string;
  checkedAt: string;
  owner: { host: string | null; pid: number | null; procStart: string | null };
  lastHeartbeatAt: string | null;
  heartbeatAgeMs: number | null;
  /** The stage the attempt was last seen working in. */
  lastStageId: string | null;
  leaseMs: number;
}

export interface AttemptRowFacts {
  attemptNumber: number;
  state: "RUNNING" | "SUCCEEDED" | "FAILED" | "BLOCKED" | "STOPPED";
  ownerHost: string | null;
  ownerPid: number | null;
  ownerProcStart: string | null;
  heartbeatAt: Date;
  lastStageId: string | null;
  startedAt: Date;
  finishedAt: Date | null;
  endedReason: string | null;
}

/**
 * The liveness of one attempt, derived on every read.
 *
 * `deps` exists so a test can drive this against a fabricated /proc and a fixed
 * clock — never so production can pretend.
 */
export function deriveAttemptLiveness(
  attempt: AttemptRowFacts,
  deps: {
    now?: () => Date;
    host?: string;
    procRoot?: string;
    leaseMs?: number;
  } = {},
): AttemptLiveness {
  const now = deps.now ?? (() => new Date());
  const host = deps.host ?? hostname();
  const procRoot = deps.procRoot ?? "/proc";
  const leaseMs = deps.leaseMs ?? HEARTBEAT_LEASE_MS;
  const at = now();
  const heartbeatAgeMs = at.getTime() - attempt.heartbeatAt.getTime();
  const owner = { host: attempt.ownerHost, pid: attempt.ownerPid, procStart: attempt.ownerProcStart };
  const base = {
    checkedAt: at.toISOString(),
    owner,
    lastHeartbeatAt: attempt.heartbeatAt.toISOString(),
    heartbeatAgeMs,
    lastStageId: attempt.lastStageId,
    leaseMs,
  };

  if (attempt.state !== "RUNNING") {
    return {
      ...base,
      verdict: "finished",
      observed: true,
      basis:
        `attempt ${attempt.attemptNumber} ended as ${attempt.state}` +
        (attempt.finishedAt ? ` at ${attempt.finishedAt.toISOString()}` : "") +
        (attempt.endedReason ? ` — ${attempt.endedReason}` : " — no ending sentence was recorded"),
    };
  }

  const check = checkOwnerProcess(owner, host, procRoot);
  if (owner.pid !== null) {
    return {
      ...base,
      verdict: check.alive ? "alive" : "interrupted",
      observed: true,
      basis: check.alive
        ? `attempt ${attempt.attemptNumber} is running: ${check.observed}; it was last seen working in "${attempt.lastStageId ?? "(no stage recorded)"}" and last heartbeated at ${attempt.heartbeatAt.toISOString()}`
        : `attempt ${attempt.attemptNumber} stopped without an outcome: ${check.observed}. It was last seen working in "${attempt.lastStageId ?? "(no stage recorded)"}" and last heartbeated at ${attempt.heartbeatAt.toISOString()}. No stage row was rewritten to say this — the attempt's own row is the evidence.`,
    };
  }

  // No owning process recorded (an attempt that predates attempt tracking).
  if (heartbeatAgeMs > leaseMs) {
    return {
      ...base,
      verdict: "interrupted-by-lease",
      observed: false,
      basis:
        `attempt ${attempt.attemptNumber} records no owning process, so its liveness could not be observed. Its last heartbeat was ` +
        `${Math.round(heartbeatAgeMs / 1000)}s ago, past the ${Math.round(leaseMs / 1000)}s lease, so it is reported as interrupted — ` +
        `this is a TIME-BASED INFERENCE, not an observation, and the row that would prove it is missing.`,
    };
  }
  return {
    ...base,
    verdict: "unknown",
    observed: false,
    basis:
      `attempt ${attempt.attemptNumber} records no owning process, so nothing could be looked at; its last heartbeat was ` +
      `${Math.round(heartbeatAgeMs / 1000)}s ago, inside the ${Math.round(leaseMs / 1000)}s lease. This build cannot say whether it is still running.`,
  };
}

/** True when the verdict means nothing is working on this attempt any more. */
export function isDeadVerdict(v: LivenessVerdict): boolean {
  return v === "interrupted" || v === "interrupted-by-lease" || v === "finished";
}
