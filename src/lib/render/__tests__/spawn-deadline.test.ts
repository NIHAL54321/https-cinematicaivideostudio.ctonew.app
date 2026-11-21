/**
 * THE M2 CATALOGUE STALL — both halves, proved on real child processes.
 *
 * The lead's observation on 2026-11-21: an `encode-master` ffmpeg sat in state
 * `S` with `wchan` = `futex_wait_queue`, its `utime` frozen, for ~28 minutes,
 * `master.mp4` stuck at 25,690,164 B, and `kill -TERM` did not end it — while
 * the stage's own 15-minute timeout never fired and no FAILED row was written.
 *
 * These tests establish the mechanism (a full, unread pipe) and hold the fix in
 * place (output to files, deadline enforced by `timeout -s KILL` in its own
 * process). Nothing here needs ffmpeg: the same shape is produced with `bash`.
 */
import { describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { runEncoder, spawnCaptured } from "../executors";

/** A child that writes ~400 KB to stderr and then exits 0 — six pipe buffers' worth. */
const CHATTY = `i=0; while [ $i -lt 4000 ]; do echo "progress line $i 0123456789abcdef0123456789abcdef0123456789abcdef" 1>&2; i=$((i+1)); done`;

function threadStates(pid: number): string[] {
  try {
    return readdirSync(`/proc/${pid}/task`).map((t) => {
      try {
        return readFileSync(`/proc/${pid}/task/${t}/wchan`, "utf8").trim();
      } catch {
        return "";
      }
    });
  } catch {
    return [];
  }
}

describe("the pipe is the block", () => {
  test("a child whose stderr pipe is never read stops writing, blocked in a write wait", async () => {
    // The OLD shape, exactly: pipes, and a parent that is not reading them.
    const child = spawn("bash", ["-c", CHATTY], { stdio: ["ignore", "pipe", "pipe"] });
    const exited = new Promise<number | null>((resolve) => child.on("close", (c) => resolve(c)));

    await new Promise((r) => setTimeout(r, 1_500));

    // Still alive with 400 KB still to print: it cannot be anywhere but blocked.
    expect(child.exitCode).toBeNull();
    const states = threadStates(child.pid as number);
    expect(states.length).toBeGreaterThan(0);
    // The kernel names the same wait differently per syscall path — pipe_write,
    // sock_wait_for_wmem, futex (ffmpeg's blocked main thread waits on the
    // thread doing the write). Any of them is "blocked on its own output".
    expect(states.some((s) => /pipe|sock_wait|futex/.test(s))).toBe(true);

    child.kill("SIGKILL");
    await exited;
  }, 20_000);

  test("with output going to FILES the same child finishes even while this process's loop is blocked", async () => {
    const run = spawnCaptured("bash", ["-c", CHATTY], 30_000);
    // Wedge the event loop on purpose: with pipes this is the deadlock.
    const until = Date.now() + 2_000;
    while (Date.now() < until) {
      /* busy: no timers, no I/O callbacks — the pipe would fill and the child would stop */
    }
    const r = await run;
    expect(r.error).toBeNull();
    expect(r.status).toBe(0);
    expect(r.timedOut).toBe(false);
    // The child's own words survive, capped — 400 KB printed, the tail kept.
    expect(r.stderr).toContain("progress line 3999");
    expect(r.stderr.length).toBeLessThanOrEqual(1024 * 1024);
  }, 30_000);
});

describe("the deadline fires even when the event loop does not", () => {
  test("a child that outlives its budget is SIGKILLed and the stage fails naming the timeout", async () => {
    const t0 = Date.now();
    let message = "";
    try {
      await runEncoder("sleep", ["30"], "encode-master", 1_500);
      throw new Error("runEncoder resolved — a 30 s child under a 1.5 s budget must not succeed");
    } catch (err) {
      message = (err as Error).message;
    }
    const elapsed = Date.now() - t0;
    expect(message).toContain("killed after the");
    expect(message).toContain("stage timeout");
    expect(message).toContain("no orphan encoder is left running");
    // The deadline, not the child's own 30 s: it ended in seconds.
    expect(elapsed).toBeLessThan(10_000);
  }, 20_000);

  test("the child is really gone — no orphan keeps running after the timeout", async () => {
    const run = spawnCaptured("sleep", ["30"], 1_200);
    const r = await run;
    expect(r.timedOut).toBe(true);
    expect(["deadline-wrapper", "deadline-timer"]).toContain(r.stoppedBy);
    // `sleep 30` would still be running if the kill had only reached the wrapper.
    const leftover = spawn("pgrep", ["-f", "sleep 30"], { stdio: ["ignore", "pipe", "ignore"] });
    let out = "";
    leftover.stdout?.on("data", (c: Buffer) => (out += c.toString("utf8")));
    await new Promise<void>((resolve) => leftover.on("close", () => resolve()));
    expect(out.trim()).toBe("");
  }, 20_000);
});
