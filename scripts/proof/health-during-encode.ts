/**
 * PROOF: the app server answers /api/health WHILE a real encode runs.
 *
 * It enqueues a real 1080p render through the app's own service (the same code
 * path the Export panel's Render button calls), then polls
 * http://127.0.0.1:3100/api/health every 500 ms, annotating each poll with the
 * stage row that was RUNNING at that moment — read from the database, not
 * guessed. The encode stage is the one that used to block the event loop.
 *
 * Run from /home/team/app with: bun run /tmp/proof/health-during-encode.ts
 */
import { prisma } from "@/lib/db";
import { enqueueRenderJob } from "@/lib/render/service";

const PROJECT_ID = process.env.PROOF_PROJECT_ID ?? "cmwfum4uh0006ffuutb528ciw";
const PRESET = process.env.PROOF_PRESET ?? "youtube-1080p";
const HEALTH = "http://127.0.0.1:3100/api/health";
const MAX_WAIT_MS = 15 * 60 * 1000;

async function healthOnce() {
  const t0 = performance.now();
  try {
    const res = await fetch(HEALTH, { signal: AbortSignal.timeout(30_000) });
    const body = await res.text();
    return { code: res.status, ms: Math.round(performance.now() - t0), bytes: body.length, error: null as string | null };
  } catch (err) {
    return { code: 0, ms: Math.round(performance.now() - t0), bytes: 0, error: (err as Error).message };
  }
}

const project = await prisma.project.findUnique({ where: { id: PROJECT_ID }, select: { id: true, userId: true, title: true } });
if (!project) throw new Error(`project ${PROJECT_ID} does not exist`);

console.log(`project ${project.id} "${project.title}" owner ${project.userId}`);

const enq = await enqueueRenderJob({ userId: project.userId, projectId: project.id, presetId: PRESET });
console.log(`enqueued job ${enq.jobId} (queueJobId ${enq.queueJobId}) preset ${PRESET}`);

interface Poll {
  at: string;
  healthCode: number;
  healthMs: number;
  error: string | null;
  runningStage: string | null;
  stages: string;
}

const polls: Poll[] = [];
const started = Date.now();
let lastStages = "";
let finished = false;

while (Date.now() - started < MAX_WAIT_MS) {
  const rows = await prisma.renderStageRun.findMany({
    where: { jobId: enq.jobId },
    orderBy: { sequence: "asc" },
    select: { stageId: true, state: true, startedAt: true, finishedAt: true },
  });
  const running = rows.find((r) => r.state === "RUNNING")?.stageId ?? null;
  const stages = rows.map((r) => `${r.stageId}:${r.state}`).join(" ");
  if (stages !== lastStages) {
    console.log(`[${new Date().toISOString()}] stages → ${stages || "(none yet)"}`);
    lastStages = stages;
  }
  const h = await healthOnce();
  polls.push({ at: new Date().toISOString(), healthCode: h.code, healthMs: h.ms, error: h.error, runningStage: running, stages });
  if (h.code !== 200) console.log(`  health ${h.code} ${h.error ?? ""} (${h.ms} ms) while ${running ?? "no stage running"}`);

  const job = await prisma.renderJob.findUnique({ where: { id: enq.jobId }, select: { startedAt: true, finishedAt: true } });
  const attempt = await prisma.renderAttempt.findFirst({ where: { jobId: enq.jobId }, orderBy: { attemptNumber: "desc" }, select: { state: true } });
  if (job?.finishedAt || (attempt && attempt.state !== "RUNNING" && rows.length > 0)) {
    finished = true;
    console.log(`[${new Date().toISOString()}] job finished — final stages: ${stages}`);
    break;
  }
  await new Promise((r) => setTimeout(r, 500));
}

const during = polls.filter((p) => p.runningStage === "encode-master");
const okDuring = during.filter((p) => p.healthCode === 200);
const sorted = [...polls].map((p) => p.healthMs).sort((a, b) => a - b);
const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
const max = sorted.length ? sorted[sorted.length - 1] : null;

console.log("\n==== RESULT ====");
console.log(`job ${enq.jobId} · polls ${polls.length} · finished ${finished}`);
console.log(`polls taken WHILE encode-master was RUNNING: ${during.length} · of those HTTP 200: ${okDuring.length}`);
console.log(`health latency over all polls: median ${median} ms · max ${max} ms`);
if (during.length) {
  const dsorted = during.map((p) => p.healthMs).sort((a, b) => a - b);
  console.log(`health latency while encoding: min ${dsorted[0]} ms · median ${dsorted[Math.floor(dsorted.length / 2)]} ms · max ${dsorted[dsorted.length - 1]} ms`);
  console.log(`first poll during the encode: ${JSON.stringify(during[0])}`);
  console.log(`last  poll during the encode: ${JSON.stringify(during[during.length - 1])}`);
}
const bad = polls.filter((p) => p.healthCode !== 200);
console.log(`non-200 health polls: ${bad.length}`);
console.log(`VERDICT: ${during.length > 0 && okDuring.length === during.length ? "PASS — every health poll taken during the encode answered 200" : "NOT PROVEN"}`);
await prisma.$disconnect();
