/**
 * BLOCK M2 — THE THREE DELIVERIES (synthetic bed, permitted CC track, no music).
 *
 * Drives the product's OWN routes for every step:
 *
 *   1. POST   /api/projects/:id/music/select   (or DELETE, or the fixture's own
 *                                               synthetic row) — the selection
 *   2. GET    /api/projects/:id/music          — the Music tab's view, and the
 *                                               sentence the Export panel shows
 *   3. POST   /api/studio/render {enqueue}     — a REAL render job at the shipped
 *                                               1080p preset, run by the served
 *                                               app's own worker
 *   4. GET    /api/studio/downloads/<id>       — the delivered container,
 *                                               downloaded and re-hashed on the
 *                                               written file
 *
 * Nothing here hand-writes an ffmpeg encode command. The measurements ARE
 * hand-run ffmpeg: ebur128 for integrated loudness and true peak, and a
 * one-second RMS trace (asetnsamples + astats) for the fade and the ducking,
 * read off the DELIVERED FILES themselves.
 *
 * Usage: bun scripts/fixtures/m2-music-deliveries.ts [synthetic|catalogue|none ...]
 * Env:   M2_BASE (default http://127.0.0.1:3100), M2_EMAIL, M2_PASSWORD,
 *        M2_PROJECT (default p7a_fix_project), M2_PRESET (default youtube-1080p),
 *        M2_TRACK (default ZOR97), M2_OUT (default /home/team/render-out/phase8_music_mixing),
 *        M2_TIMEOUT_MIN (default 40), M2_PRUNE=1 to delete a job's stage dir after
 *        its delivery has been downloaded and hashed.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/db";
import { musicInclusionSentence, parseEbur128Summary } from "@/lib/render/music-mix";
import { readProjectMusic } from "@/lib/render/store";

const BASE = process.env.M2_BASE ?? "http://127.0.0.1:3100";
const EMAIL = process.env.M2_EMAIL ?? "p7a-fixture@cavs.test";
const PASSWORD = process.env.M2_PASSWORD ?? "p7a-fixture-password-2026";
const PROJECT = process.env.M2_PROJECT ?? "p7a_fix_project";
const PRESET = process.env.M2_PRESET ?? "youtube-1080p";
const TRACK = process.env.M2_TRACK ?? "ZOR97";
const OUT = process.env.M2_OUT ?? "/home/team/render-out/phase8_music_mixing";
const TIMEOUT_MIN = Number(process.env.M2_TIMEOUT_MIN ?? 40);
const PRUNE = process.env.M2_PRUNE === "1";
const CASES = (process.argv.slice(2).length ? process.argv.slice(2) : ["synthetic", "catalogue", "none"]) as Case[];
type Case = "synthetic" | "catalogue" | "none";

const log = (...a: unknown[]) => console.log(...a);
const sha256File = (path: string): { bytes: number; sha256: string } => {
  const h = createHash("sha256");
  const buf = readFileSync(path);
  h.update(buf);
  return { bytes: buf.length, sha256: h.digest("hex") };
};

/* ---------------- ffmpeg measurements, on real files ---------------- */

function ffprobe(path: string): Record<string, unknown> {
  const text = execFileSync(
    "ffprobe",
    ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", path],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  return JSON.parse(text) as Record<string, unknown>;
}

function ebur128(path: string): { integratedLufs: number | null; truePeakDbfs: number | null; raw: string } {
  // ffmpeg writes its ebur128 report to stderr; `2>&1` captures it and the
  // app's own parser (parseEbur128Summary) reads the figures out of it.
  const captured = execFileSync(
    "bash",
    ["-lc", `ffmpeg -hide_banner -nostats -i ${JSON.stringify(path)} -map 0:a:0 -af ebur128=peak=true -f null - 2>&1`],
    { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const parsed = parseEbur128Summary(captured);
  return { ...parsed, raw: captured };
}

/** One RMS figure per second, from the delivered file's own samples. */
function rmsPerSecond(path: string): Array<{ t: number; rms: number }> {
  const text = execFileSync(
    "bash",
    [
      "-lc",
      `ffmpeg -hide_banner -nostats -v error -i ${JSON.stringify(path)} -map 0:a:0 -af "aformat=channel_layouts=mono,asetnsamples=n=48000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-" -f null - 2>/dev/null`,
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  const out: Array<{ t: number; rms: number }> = [];
  let t: number | null = null;
  for (const line of text.split("\n")) {
    const pt = /pts_time:([0-9.]+)/.exec(line);
    if (pt) t = Number(pt[1]);
    const rm = /lavfi\.astats\.Overall\.RMS_level=(-?[0-9.]+|-inf)/.exec(line);
    if (rm && t !== null) {
      out.push({ t: Math.round(t * 100) / 100, rms: rm[1] === "-inf" ? -120 : Number(rm[1]) });
    }
  }
  return out;
}

/* ---------------- the app's own routes ---------------- */

async function main() {
  mkdirSync(join(OUT, "downloads"), { recursive: true });
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true, email: true } });
  if (!user) throw new Error(`no account ${EMAIL} on this database — run scripts/fixtures/p7a-world.sh`);
  const signin = await fetch(`${BASE}/api/auth/signin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: user.email, password: PASSWORD }),
  });
  if (!signin.ok) throw new Error(`signin answered ${signin.status}: ${(await signin.text()).slice(0, 300)}`);
  const cookie = (signin.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  log(`account  : ${user.email} (${user.id})`);

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
    return { status: res.status, json, text, headers: res.headers };
  };

  const results: Record<string, unknown> = {};

  for (const kase of CASES) {
    log(`\n================ ${kase.toUpperCase()} ================`);

    /* 1 — the selection, through the app's routes (or the fixture's own row) */
    let selectionStep: Record<string, unknown>;
    if (kase === "synthetic") {
      const row = await prisma.asset.findUnique({ where: { id: "m2_synthetic_bed" }, select: { id: true, name: true, metadata: true } });
      if (!row) throw new Error("the synthetic fixture row m2_synthetic_bed is missing — run scripts/fixtures/m2-music-world.sh");
      selectionStep = {
        how: "the fixture row written by scripts/fixtures/m2-music-world.sh — declared synthetic ON the row (metadata.music.syntheticTestAsset=true)",
        assetId: row.id,
        name: row.name,
      };
    } else if (kase === "catalogue") {
      const sel = await call(`/api/projects/${PROJECT}/music/select`, {
        method: "POST",
        body: JSON.stringify({ provider: "audius", providerTrackId: TRACK, intendedUse: "commercial" }),
      });
      log(`select   : POST /api/projects/${PROJECT}/music/select -> ${sel.status}`);
      if (sel.status !== 200) throw new Error(`the catalogue selection was refused: ${sel.status} ${sel.text.slice(0, 600)}`);
      selectionStep = { how: `POST /api/projects/${PROJECT}/music/select {provider:"audius", providerTrackId:"${TRACK}"}`, status: sel.status, response: sel.json };
    } else {
      const cleared = await call(`/api/projects/${PROJECT}/music`, { method: "DELETE" });
      log(`clear    : DELETE /api/projects/${PROJECT}/music -> ${cleared.status}`);
      if (cleared.status !== 200) throw new Error(`clearing the selection answered ${cleared.status}: ${cleared.text.slice(0, 400)}`);
      selectionStep = { how: `DELETE /api/projects/${PROJECT}/music`, status: cleared.status, response: cleared.json };
    }

    /* 2 — what the pipeline reads, and the sentence the panel prints */
    const facts = await readProjectMusic(PROJECT);
    const panelSentence = musicInclusionSentence({ music: facts });
    const view = await call(`/api/projects/${PROJECT}/music`);
    log(`facts    : ${facts ? `${facts.title} (permitted=${facts.verdict.permitted})` : "null — no selection"}`);
    log(`panel    : ${panelSentence}`);

    /* 3 — the render, through the app's own route */
    const enq = await call(`/api/studio/render`, {
      method: "POST",
      body: JSON.stringify({ action: "enqueue", projectId: PROJECT, presetId: PRESET }),
    });
    if (enq.status !== 202) throw new Error(`enqueue answered ${enq.status}: ${enq.text.slice(0, 600)}`);
    const jobId = String((enq.json as Record<string, unknown>).jobId);
    log(`job      : ${jobId} (POST /api/studio/render -> ${enq.status})`);

    const t0 = Date.now();
    let job: Record<string, unknown> = {};
    let last = "";
    for (;;) {
      await new Promise((r) => setTimeout(r, 5000));
      const read = await call(`/api/studio/render?jobId=${jobId}`);
      if (read.status !== 200) throw new Error(`read answered ${read.status}: ${read.text.slice(0, 400)}`);
      job = (read.json as { job: Record<string, unknown> }).job;
      const status = String(job.status);
      const stages = (job.stages as Array<{ id: string; state: string }>) ?? [];
      const line = `${status} ${stages.filter((s) => s.state === "SUCCEEDED").length}/${stages.length} ${stages.find((s) => s.state === "RUNNING")?.id ?? ""}`;
      if (line !== last) {
        log(`  ${((Date.now() - t0) / 1000).toFixed(0)}s  ${line}`);
        last = line;
      }
      if (["succeeded", "failed", "blocked", "stopped"].includes(status)) break;
      if (Date.now() - t0 > TIMEOUT_MIN * 60 * 1000) throw new Error(`job ${jobId} did not finish within ${TIMEOUT_MIN} minutes`);
    }
    log(`final    : ${String(job.status)} after ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    writeFileSync(join(OUT, `job-${kase}.json`), JSON.stringify(job, null, 2));
    if (String(job.status) !== "succeeded") {
      writeFileSync(join(OUT, `case-${kase}.json`), JSON.stringify({ kase, jobId, status: job.status, job, selectionStep, panelSentence }, null, 2));
      throw new Error(`job ${jobId} ended ${String(job.status)} — see ${join(OUT, `job-${kase}.json`)}`);
    }

    /* 4 — the delivered container, downloaded through the app's own route */
    const centre = await call(`/api/studio/downloads`);
    const files = ((centre.json as { files?: Array<Record<string, unknown>> }).files ?? []) as Array<Record<string, unknown>>;
    const artefact = files.find((f) => f.jobId === jobId && f.kind === "delivered-container");
    if (!artefact) throw new Error(`no delivered-container artefact for job ${jobId} in GET /api/studio/downloads`);
    const artefactId = String(artefact.artefactId);
    const dest = join(OUT, "downloads", `m2-${kase}.mp4`);
    const dl = await fetch(`${BASE}/api/studio/downloads/${artefactId}`, { headers: { cookie } });
    if (dl.status !== 200) throw new Error(`download answered ${dl.status}: ${(await dl.text()).slice(0, 400)}`);
    const bytes = Buffer.from(await dl.arrayBuffer());
    writeFileSync(dest, bytes);
    const written = sha256File(dest);
    const headerSha = dl.headers.get("x-cavs-verified-sha256");
    const headerSource = dl.headers.get("x-cavs-source");
    log(`download : ${dl.status} ${written.bytes} B -> ${dest}`);
    log(`sha256   : ${written.sha256}`);
    log(`recorded : ${String(artefact.recordedSha256)} (row) · ${String(headerSha)} (header) · source ${String(headerSource)}`);
    if (written.sha256 !== artefact.recordedSha256 || written.sha256 !== headerSha) {
      throw new Error("the written file's digest does not match the row and the header");
    }

    /* 5 — the measurements, on the written file and on the bed */
    const probe = ffprobe(dest);
    const loud = ebur128(dest);
    const trace = rmsPerSecond(dest);
    const stages = (job.stages as Array<Record<string, unknown>>) ?? [];
    const fetchStage = stages.find((s) => s.id === "music-fetch") as { record?: Record<string, unknown> } | undefined;
    const encodeStage = stages.find((s) => s.id === "encode-master") as { record?: Record<string, unknown> } | undefined;
    const muxStage = stages.find((s) => s.id === "container-mux") as { record?: Record<string, unknown> } | undefined;
    const bedFile = ((fetchStage?.record?.files as Array<{ path?: string }> | undefined) ?? [])[0]?.path ?? null;
    const bedLoud = bedFile && existsSync(bedFile) ? ebur128(bedFile) : null;
    const bedDigest = bedFile && existsSync(bedFile) ? sha256File(bedFile) : null;

    const caseRecord = {
      kase,
      jobId,
      status: job.status,
      selectionStep,
      musicFactReadByThePipeline: facts,
      panelSentence,
      musicTabViewStatus: view.status,
      delivery: {
        artefactId,
        url: `${BASE}/api/studio/downloads/${artefactId}`,
        downloadedStatus: dl.status,
        servedFrom: headerSource,
        writtenPath: dest,
        writtenBytes: written.bytes,
        writtenSha256: written.sha256,
        recordedBytes: artefact.recordedBytes,
        recordedSha256: artefact.recordedSha256,
        headerSha256: headerSha,
        digestMatches: true,
      },
      ffprobe: probe,
      loudnessMeasuredOnTheDeliveredFile: {
        label: "MEASURED with ffmpeg ebur128 on the downloaded file — not estimated",
        integratedLufs: loud.integratedLufs,
        truePeakDbfs: loud.truePeakDbfs,
      },
      bed: bedFile
        ? {
            path: bedFile,
            exists: existsSync(bedFile),
            bytes: bedDigest?.bytes ?? null,
            sha256: bedDigest?.sha256 ?? null,
            loudnessMeasured: bedLoud
              ? { label: "MEASURED with ffmpeg ebur128 on the bed the music-fetch stage wrote", integratedLufs: bedLoud.integratedLufs, truePeakDbfs: bedLoud.truePeakDbfs }
              : null,
          }
        : null,
      musicFetchStageRecord: fetchStage?.record ?? null,
      encodeMasterMusicMix: (encodeStage?.record as { musicMix?: unknown } | undefined)?.musicMix ?? null,
      containerMuxAudioAndProvenance: muxStage?.record
        ? {
            audioContent: (muxStage.record as Record<string, unknown>).audioContent,
            musicProduced: (muxStage.record as Record<string, unknown>).musicProduced,
            musicProvenance: (muxStage.record as Record<string, unknown>).musicProvenance,
            ffprobeReadBack: (muxStage.record as Record<string, unknown>).ffprobeReadBack,
          }
        : null,
      oneSecondRmsTraceOfTheDeliveredFile: trace,
    };
    writeFileSync(join(OUT, `case-${kase}.json`), JSON.stringify(caseRecord, null, 2));
    writeFileSync(
      join(OUT, `download-${kase}-sha256.txt`),
      `${written.sha256}  m2-${kase}.mp4\n${written.bytes} bytes\n`,
    );
    log(`loudness : ${String(loud.integratedLufs)} LUFS integrated, true peak ${String(loud.truePeakDbfs)} dBFS (measured on the downloaded file)`);
    if (bedLoud) log(`bed      : ${String(bedLoud.integratedLufs)} LUFS integrated (measured on the fetched bed)`);

    results[kase] = caseRecord;

    if (PRUNE) {
      const dir = join("/home/team/render-out", jobId);
      if (existsSync(dir)) {
        const size = execFileSync("du", ["-sh", dir], { encoding: "utf8" }).split("\t")[0];
        rmSync(dir, { recursive: true, force: true });
        log(`pruned   : ${dir} (${size}) — the stage dir is a cache; the durable copy is in object storage`);
      }
    }
  }

  writeFileSync(join(OUT, "summary.json"), JSON.stringify(results, null, 2));
  log(`\nwrote ${join(OUT, "summary.json")}`);
}

await main();
process.exit(0);
