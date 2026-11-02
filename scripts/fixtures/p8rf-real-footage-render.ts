/**
 * Phase 8 block 7b — THE FIRST REAL PROJECT VIDEO.
 *
 * Drives the product's OWN routes, in order, and prints what each one answered:
 *
 *   1. GET  /api/media?sceneId=…&mediaType=video   — real Pixabay candidates
 *   2. POST /api/media/select                      — the Asset + StockAsset +
 *                                                    LicensingMetadata rows
 *   3. POST /api/media/ingest                      — the clip's bytes stored in
 *                                                    object storage, its digest
 *                                                    recorded, `s3Key` set
 *   4. POST /api/studio/render {action:"enqueue"}  — a REAL (non-synthetic)
 *                                                    render job at the 1080p preset,
 *                                                    run by the served app's own
 *                                                    seven-stage pipeline
 *
 * Nothing here hand-writes an ffmpeg command: the encode stage builds its argv
 * from the job's recorded resolved specification, and normalises each clip to
 * the numbers in that same specification.
 *
 * Usage:  bun scripts/fixtures/p8rf-real-footage-render.ts
 * Env:    P8RF_BASE (default http://127.0.0.1:3100), P8RF_EMAIL, P8RF_PASSWORD,
 *         P8RF_PRESET (default youtube-1080p), P8RF_MODEL=project|search
 */
import { writeFileSync } from "node:fs";
import { prisma } from "@/lib/db";

const BASE = process.env.P8RF_BASE ?? "http://127.0.0.1:3100";
const EMAIL = process.env.P8RF_EMAIL ?? "p7a-fixture@cavs.test";
const PASSWORD = process.env.P8RF_PASSWORD ?? "p7a-fixture-password-2026";
const PRESET = process.env.P8RF_PRESET ?? "youtube-1080p";
const OUT = process.env.P8RF_OUT ?? "/tmp/p8rf_run.json";

const log = (...a: unknown[]) => console.log(...a);

async function main() {
  /* ---- who we are -------------------------------------------------- */
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true, email: true } });
  if (!user) throw new Error(`no account ${EMAIL} on this database`);
  log(`account          : ${user.email} (${user.id})`);

  const signin = await fetch(`${BASE}/api/auth/signin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: user.email, password: PASSWORD }),
  });
  if (!signin.ok) throw new Error(`signin answered ${signin.status}: ${(await signin.text()).slice(0, 300)}`);
  const cookie = (signin.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error("signin answered OK but set no session cookie");
  log(`session cookie   : ${cookie.split("=")[0]}=… (set by the app's own signin route)`);

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
      /* keep the raw text below */
    }
    return { status: res.status, json, text };
  };

  /* ---- 1. the project, with ONE scene ------------------------------ */
  const title = process.env.P8RF_TITLE ?? "Real footage, one scene — a Pixabay clip encoded by this pipeline";
  const existing = await prisma.project.findFirst({ where: { userId: user.id, title, deletedAt: null }, select: { id: true } });
  let projectId: string;
  let sceneId: string;
  if (existing && process.env.P8RF_REUSE === "1") {
    projectId = existing.id;
    const sc = await prisma.scene.findFirst({ where: { projectId }, orderBy: { order: "asc" }, select: { id: true } });
    if (!sc) throw new Error("reused project has no scene");
    sceneId = sc.id;
  } else {
    const created = await prisma.$transaction(async (tx) => {
      const project = await tx.project.create({
        data: { userId: user.id, title, description: "One scene carrying one stock clip, so the delivered file can be traced to it." },
        select: { id: true },
      });
      const script = await tx.script.create({ data: { projectId: project.id, title, logline: "A single scene." }, select: { id: true } });
      const chapter = await tx.chapter.create({ data: { scriptId: script.id, projectId: project.id, title, order: 0 }, select: { id: true } });
      const scene = await tx.scene.create({
        data: {
          chapterId: chapter.id,
          projectId: project.id,
          order: 1,
          title: "A ship at the harbour",
          visualPrompt: "cruise ship harbour sea",
          durationSeconds: 20,
          status: "DRAFT",
        },
        select: { id: true },
      });
      return { projectId: project.id, sceneId: scene.id };
    });
    projectId = created.projectId;
    sceneId = created.sceneId;
  }
  log(`project          : ${projectId}  ("${title}")`);
  log(`scene            : ${sceneId}`);

  /* ---- 2. REAL candidates from the provider ------------------------ */
  const search = await call(`/api/media?sceneId=${sceneId}&mediaType=video`);
  if (search.status !== 200) throw new Error(`media search answered ${search.status}: ${search.text.slice(0, 300)}`);
  const body = search.json as Record<string, unknown>;
  const list = (Array.isArray(body.candidates) ? body.candidates : Array.isArray(body.assets) ? body.assets : Array.isArray(body.results) ? body.results : Array.isArray(body.items) ? body.items : null) as
    | Record<string, unknown>[]
    | null;
  if (!list) throw new Error(`media search answered 200 but no candidate array: keys=${Object.keys(body).join(",")}`);
  log(`candidates       : ${list.length} from ${String((body.provider as string) ?? (body.providerState as unknown as string) ?? "?")}`);
  const chosen = (list.find((c) => String(c.externalId) === "3713") ?? list[0]) as Record<string, unknown>;
  log(`chosen candidate : ${String(chosen.provider)}/${String(chosen.externalId)} — ${String(chosen.title)}`);

  /* ---- 3. select it onto the scene --------------------------------- */
  const selected = await call(`/api/media/select`, { method: "POST", body: JSON.stringify({ sceneId, asset: chosen }) });
  if (selected.status !== 200 && selected.status !== 201) throw new Error(`select answered ${selected.status}: ${selected.text.slice(0, 400)}`);
  const selJson = selected.json as Record<string, unknown>;
  const assetId = String(
    (selJson.assetId as string) ?? ((selJson.asset as Record<string, unknown>)?.id as string) ?? "",
  );
  if (!assetId) throw new Error(`select answered ${selected.status} but no asset id: ${selected.text.slice(0, 300)}`);
  log(`asset row        : ${assetId} (POST /api/media/select → ${selected.status})`);

  /* ---- 4. the bytes, into our own storage -------------------------- */
  const ingest = await call(`/api/media/ingest`, { method: "POST", body: JSON.stringify({ assetId }) });
  if (ingest.status !== 200) throw new Error(`ingest answered ${ingest.status}: ${ingest.text.slice(0, 600)}`);
  const ing = ingest.json as { footage: Record<string, unknown>; alreadyStored: boolean };
  log(`ingest           : ${ingest.status}  alreadyStored=${ing.alreadyStored}`);
  log(`  object key     : ${String(ing.footage.storedKey)}`);
  log(`  bucket         : ${String(ing.footage.bucket)}`);
  log(`  bytes          : ${String(ing.footage.bytes)}`);
  log(`  sha256         : ${String(ing.footage.sha256)}`);
  log(`  contentType    : ${String(ing.footage.contentType)}`);
  log(`  verification   : ${String(ing.footage.verification)}`);

  /* ---- 5. READ the facts the pipeline will read -------------------- */
  const sceneRow = await prisma.scene.findUnique({
    where: { id: sceneId },
    select: {
      id: true,
      order: true,
      durationSeconds: true,
      assets: { select: { asset: { select: { id: true, kind: true, s3Key: true, url: true, sizeBytes: true, metadata: true, stockAsset: true, licensing: true } } } },
    },
  });
  log(`scene assets     : ${sceneRow?.assets.length ?? 0}`);
  log(`scene asset s3Key: ${sceneRow?.assets[0]?.asset.s3Key ?? "(none)"}`);

  /* ---- 6. a REAL render job, through the app's own route ----------- */
  const enq = await call(`/api/studio/render`, { method: "POST", body: JSON.stringify({ action: "enqueue", projectId, presetId: PRESET }) });
  if (enq.status !== 202) throw new Error(`enqueue answered ${enq.status}: ${enq.text.slice(0, 500)}`);
  const jobId = String((enq.json as Record<string, unknown>).jobId);
  log(`\nRENDER JOB       : ${jobId}  (POST /api/studio/render {action:"enqueue"} → ${enq.status})`);
  log(`preset           : ${PRESET}`);

  /* ---- 7. wait for the served app's worker ------------------------- */
  const t0 = Date.now();
  let last = "";
  for (;;) {
    await new Promise((r) => setTimeout(r, 3000));
    const read = await call(`/api/studio/render?jobId=${jobId}`);
    if (read.status !== 200) throw new Error(`read answered ${read.status}: ${read.text.slice(0, 400)}`);
    const job = (read.json as { job: Record<string, unknown> }).job;
    const status = String(job.status);
    const pct = (job.progress as { percent?: number })?.percent;
    const line = `${status} ${pct ?? "?"}%`;
    if (line !== last) {
      log(`  ${((Date.now() - t0) / 1000).toFixed(1)}s  ${line}`);
      last = line;
    }
    if (["succeeded", "failed", "blocked", "stopped"].includes(status)) {
      log(`\nFINAL            : ${status} after ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      writeFileSync(OUT, JSON.stringify({ projectId, sceneId, assetId, jobId, preset: PRESET, status, job, footage: ing.footage, readout: job }, null, 2));
      log(`readout written  : ${OUT}`);
      break;
    }
    if (Date.now() - t0 > 15 * 60 * 1000) throw new Error("render did not finish within 15 minutes");
  }
  log(`\nJOB_ID=${jobId}`);
  log(`PROJECT_ID=${projectId}`);
  log(`SCENE_ID=${sceneId}`);
  log(`ASSET_ID=${assetId}`);
}

await main();
process.exit(0);
