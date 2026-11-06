/**
 * Phase 8 block 10 — THE PROJECT'S OWN VIDEO.
 *
 * Enqueues a REAL (non-synthetic) render of the nine-scene fixture project at the
 * shipped 1080p preset through the app's own route, waits for the SERVED app's
 * worker to finish it, and writes the whole read-out to JSON so the evidence pack
 * can quote stage rows rather than a transcript.
 *
 * Nothing here hand-writes an ffmpeg command: the encode stage builds its argv from
 * the job's recorded resolved specification, normalises each of the nine clips to
 * the numbers in that same specification, and cuts or holds each segment to its
 * scene's own declared duration.
 *
 * Usage: bun scripts/fixtures/p8b10-project-render.ts
 * Env:   P8B10_BASE (default http://127.0.0.1:3100), P8B10_EMAIL, P8B10_PASSWORD,
 *        P8B10_PROJECT (default p7a_fix_project), P8B10_PRESET (default youtube-1080p),
 *        P8B10_OUT (default /tmp/p8b10_run.json), P8B10_TIMEOUT_MIN (default 75)
 */
import { writeFileSync } from "node:fs";
import { prisma } from "@/lib/db";

const BASE = process.env.P8B10_BASE ?? "http://127.0.0.1:3100";
const EMAIL = process.env.P8B10_EMAIL ?? "p7a-fixture@cavs.test";
const PASSWORD = process.env.P8B10_PASSWORD ?? "p7a-fixture-password-2026";
const PROJECT = process.env.P8B10_PROJECT ?? "p7a_fix_project";
const PRESET = process.env.P8B10_PRESET ?? "youtube-1080p";
const OUT = process.env.P8B10_OUT ?? "/tmp/p8b10_run.json";
const TIMEOUT_MIN = Number(process.env.P8B10_TIMEOUT_MIN ?? 75);

const log = (...a: unknown[]) => console.log(...a);

async function main() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true, email: true } });
  if (!user) throw new Error(`no account ${EMAIL} on this database`);

  const signin = await fetch(`${BASE}/api/auth/signin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: user.email, password: PASSWORD }),
  });
  if (!signin.ok) throw new Error(`signin answered ${signin.status}: ${(await signin.text()).slice(0, 300)}`);
  const cookie = (signin.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  log(`account        : ${user.email} (${user.id})`);
  log(`session        : ${cookie.split("=")[0]}=… (set by the app's own signin route)`);

  const call = async (path: string, init: RequestInit = {}) => {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { "content-type": "application/json", cookie, ...(init.headers ?? {}) },
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = JSON.parse(text);
    } catch {
      /* keep raw */
    }
    return { status: res.status, json, text };
  };

  /* ---- the project as the pipeline will read it --------------------- */
  const scenes = await prisma.scene.findMany({
    where: { projectId: PROJECT },
    orderBy: { order: "asc" },
    select: {
      id: true,
      order: true,
      title: true,
      durationSeconds: true,
      assets: { select: { asset: { select: { id: true, s3Key: true, sizeBytes: true } } } },
    },
  });
  const declaredTotal = scenes.reduce((n, s) => n + (s.durationSeconds ?? 0), 0);
  log(`project        : ${PROJECT}`);
  log(`scenes         : ${scenes.length}, declared total ${declaredTotal} s`);
  for (const s of scenes) {
    log(`  #${s.order} ${s.id} ${s.durationSeconds} s  asset ${s.assets[0]?.asset.s3Key ?? "(none)"} ${s.assets[0]?.asset.sizeBytes ?? 0} B`);
  }

  /* ---- a REAL render job, through the app's own route --------------- */
  const enq = await call(`/api/studio/render`, { method: "POST", body: JSON.stringify({ action: "enqueue", projectId: PROJECT, presetId: PRESET }) });
  if (enq.status !== 202) throw new Error(`enqueue answered ${enq.status}: ${enq.text.slice(0, 600)}`);
  const jobId = String((enq.json as Record<string, unknown>).jobId);
  log(`\nRENDER JOB     : ${jobId}  (POST /api/studio/render → ${enq.status})`);
  log(`preset         : ${PRESET}`);

  /* ---- wait for the served app's worker ----------------------------- */
  const t0 = Date.now();
  let last = "";
  for (;;) {
    await new Promise((r) => setTimeout(r, 5000));
    const read = await call(`/api/studio/render?jobId=${jobId}`);
    if (read.status !== 200) throw new Error(`read answered ${read.status}: ${read.text.slice(0, 400)}`);
    const job = (read.json as { job: Record<string, unknown> }).job;
    const status = String(job.status);
    const stages = (job.stages as Array<{ id: string; state: string }>) ?? [];
    const done = stages.filter((s) => s.state === "SUCCEEDED").length;
    const running = stages.find((s) => s.state === "RUNNING")?.id ?? "";
    const line = `${status} ${done}/${stages.length} ${running}`;
    if (line !== last) {
      log(`  ${((Date.now() - t0) / 1000).toFixed(0)}s  ${line}`);
      last = line;
    }
    if (["succeeded", "failed", "blocked", "stopped"].includes(status)) {
      log(`\nFINAL          : ${status} after ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      writeFileSync(OUT, JSON.stringify({ projectId: PROJECT, jobId, preset: PRESET, status, declaredTotal, job }, null, 2));
      log(`readout        : ${OUT}`);
      log(`JOB_ID=${jobId}`);
      break;
    }
    if (Date.now() - t0 > TIMEOUT_MIN * 60 * 1000) throw new Error(`render did not finish within ${TIMEOUT_MIN} minutes`);
  }
}

await main();
process.exit(0);
