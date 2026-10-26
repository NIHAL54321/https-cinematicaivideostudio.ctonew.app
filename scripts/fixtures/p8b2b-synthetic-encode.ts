/**
 * Phase 8 block 2b — run the pipeline's OWN seven stages against a declared
 * synthetic source, with a preset's resolved specification, and print exactly
 * what happened. Nothing here is hand-typed ffmpeg: the encode stage builds its
 * argv from the job's recorded spec via encodeCommandPlan().
 */
import { prisma } from "@/lib/db";
import { runRenderPipeline } from "@/lib/render/runner";
import { prismaRenderStore } from "@/lib/render/store";
import { renderOutputDir } from "@/lib/render/probes";
import { findExportPreset, resolvedSpecCore, resolvePreset, PRESET_CHOICES, type ExportPresetSpec } from "@/lib/export/presets";
import { sha256OfJson } from "@/lib/export/spec-fingerprint";
import { PIPELINE_VERSION } from "@/lib/render/pipeline";
import {
  SYNTHETIC_MARKER,
  SYNTHETIC_STATEMENT,
  generateSyntheticSource,
} from "@/lib/render/synthetic-source";
import { join } from "node:path";

const presetId = process.argv[2] ?? "youtube-1080p";
const durationSeconds = Number(process.argv[3] ?? 2);

/**
 * QHD 1440p has NO shipped preset: `presets.ts` ships seven, and the matrix
 * declares `qhd-1440p` as "a legal 16:9 size; no preset delivers it today".
 * So the 1440p attempt is a FIXTURE-DECLARED specification — the 1080p preset's
 * axes re-resolved at 2560×1440 through the product's own resolvePreset(), with
 * the level COMPUTED by the matrix (2560×1440×30 luma/s needs H.264 4.2). It
 * goes down the identical pipeline path, and it is not a preset the product
 * offers: nothing on any product surface claims a 1440p export.
 */
function fixtureQhd1440p(): ExportPresetSpec {
  const base = PRESET_CHOICES.find((p) => p.id === "youtube-1080p");
  if (!base) throw new Error("the 1080p preset the 1440p fixture derives from is missing");
  return resolvePreset({
    ...base,
    id: "youtube-1440p" as typeof base.id,
    label: "FIXTURE-ONLY YouTube QHD (1440p SDR) — not a shipped preset",
    platform: "YouTube long-form (fixture-declared 1440p)",
    choice: { ...base.choice, resolutionId: "qhd-1440p", level: "5.0" },
    rateControl: {
      targetVideoBitrateKbps: 16_000,
      maxVideoBitrateKbps: 32_000,
      basis:
        "declared for this fixture attempt only: 2× the 1080p preset's published 8 Mbps figure, which is the ratio the 1440p / 1080p pixel counts have (3,686,400 ÷ 2,073,600 = 1.78, rounded up to 2). No published 1440p figure is quoted here because none was consulted.",
    },
    reasons: {
      ...base.reasons,
      resolution:
        "2560×1440 — the matrix's declared QHD 16:9 size, resolved by the product's own resolvePreset(). No shipped preset delivers this resolution; this specification exists only for this fixture attempt.",
    },
    subtitleTrackNote: "Same timed-text track declaration; nothing is muxed.",
    deliveryNotes: [
      "FIXTURE-DECLARED 1440p specification: not a shipped preset, and no product surface offers a 1440p export.",
      "The synthetic source is generated AT 2560×1440, so this is a straight encode of a QHD frame — not an upscale of a 1080p one.",
    ],
  });
}

const preset = presetId === "youtube-1440p" ? fixtureQhd1440p() : findExportPreset(presetId);
if (!preset) throw new Error(`no preset ${presetId}`);

const user = await prisma.user.findFirst({ select: { id: true, email: true } });
if (!user) throw new Error("no user in the database to own the synthetic project");

const req = {
  widthPx: preset.widthPx,
  heightPx: preset.heightPx,
  frameRate: preset.video.frameRate,
  durationSeconds,
};
const sourceDir = join(renderOutputDir(), SYNTHETIC_MARKER, "sources");
const gen = generateSyntheticSource(req, sourceDir);
if (!gen.ok) throw new Error(gen.failure ?? "source generation failed");
const source = gen.declaration;

console.log("=== DECLARED SYNTHETIC SOURCE ===");
console.log(`pattern          : ${source.pattern}`);
console.log(`tone             : ${source.tone}`);
console.log(`duration         : ${source.durationSeconds} s`);
console.log(`resolution       : ${source.widthPx}x${source.heightPx}`);
console.log(`frame rate       : ${source.frameRate} fps`);
console.log(`frame count      : ${source.frameCount}`);
console.log(`generator argv   : ffmpeg ${source.generatorArgv.join(" ")}`);
console.log(`source path      : ${source.path}`);
console.log(`source bytes     : ${source.bytes}`);
console.log(`source sha256    : ${source.sha256}`);
console.log(`generator said   : ${source.generatorSaid}`);
console.log(`generation wall  : ${gen.wallClockMs} ms`);

const specCore = resolvedSpecCore(preset);
const projectMark = `${SYNTHETIC_MARKER} — a generated test source, not a project`;
const created = await prisma.$transaction(async (tx) => {
  const project = await tx.project.create({
    data: {
      userId: user.id,
      title: `SYNTHETIC ENCODER PROOF — ${preset.widthPx}×${preset.heightPx} ${preset.id}`,
      description: SYNTHETIC_STATEMENT,
    },
    select: { id: true },
  });
  const script = await tx.script.create({ data: { projectId: project.id, title: projectMark, logline: SYNTHETIC_STATEMENT }, select: { id: true } });
  const chapter = await tx.chapter.create({ data: { scriptId: script.id, projectId: project.id, title: projectMark, order: 0, summary: SYNTHETIC_STATEMENT }, select: { id: true } });
  const scene = await tx.scene.create({
    data: { chapterId: chapter.id, projectId: project.id, order: 0, title: projectMark, durationSeconds: source.durationSeconds, status: "READY" },
    select: { id: true },
  });
  const asset = await tx.asset.create({
    data: {
      projectId: project.id,
      userId: user.id,
      kind: "VIDEO",
      name: `${SYNTHETIC_MARKER}-source.mp4`,
      status: "READY",
      mimeType: "video/mp4",
      sizeBytes: BigInt(source.bytes ?? 0),
      width: source.widthPx,
      height: source.heightPx,
      durationSeconds: source.durationSeconds,
      s3Key: source.path,
      metadata: { marker: SYNTHETIC_MARKER, synthetic: true, statement: SYNTHETIC_STATEMENT, pathKind: "local-filesystem-path, not an object key", sourceSha256: source.sha256 },
    },
    select: { id: true },
  });
  await tx.sceneAsset.create({ data: { sceneId: scene.id, assetId: asset.id, role: "VISUAL", order: 0 } });
  const job = await tx.renderJob.create({
    data: {
      projectId: project.id,
      userId: user.id,
      presetId: preset.id,
      presetLabel: preset.label,
      presetSpec: specCore as never,
      presetSpecSha256: sha256OfJson(specCore),
      specVersion: preset.specVersion,
      pipelineVersion: PIPELINE_VERSION,
      fixture: false,
      syntheticProof: true,
      syntheticSource: source as never,
    },
    select: { id: true },
  });
  return { projectId: project.id, jobId: job.id };
});

console.log(`\njob ${created.jobId} (syntheticProof=true) on project ${created.projectId}`);

const t0 = Date.now();
const result = await runRenderPipeline(created.jobId, { store: prismaRenderStore() });
const totalMs = Date.now() - t0;

console.log("\n=== PIPELINE RESULT ===");
console.log(`status           : ${result.status}`);
console.log(`stage rows       : ${result.stageRows.map((r) => `${r.stageId}=${r.state}`).join("  ")}`);
console.log(`artefacts written: ${result.artefactsWritten}`);
console.log(`progress         : ${result.progress.percent}%  (${result.progress.arithmetic})`);
console.log(`pipeline wall    : ${totalMs} ms`);
if (result.halted) console.log(`halted           : ${result.halted.stageId} ${result.halted.state} — ${result.halted.reason}`);

const rows = await prisma.renderStageRun.findMany({ where: { jobId: created.jobId }, orderBy: { sequence: "asc" } });
console.log("\n=== STAGE TIMINGS (from each row's own startedAt/finishedAt) ===");
for (const r of rows) {
  const ms = r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null;
  const enc = (r.output as { encodeWallClockMs?: number } | null)?.encodeWallClockMs;
  console.log(
    `${String(r.sequence).padStart(2)} ${r.stageId.padEnd(18)} ${r.state.padEnd(10)} ` +
      `${ms === null ? "   (no finish)" : `${String(ms).padStart(7)} ms`}` +
      (typeof enc === "number" ? `   encoder wall ${enc} ms` : ""),
  );
}
for (const r of rows) {
  const ms = r.finishedAt ? r.finishedAt.getTime() - r.startedAt.getTime() : null;
  console.log(`\n--- ${r.stageId} [${r.state}] ${ms ?? "?"} ms syntheticProof=${r.syntheticProof} artefacts=${r.artefactCount}`);
  console.log(JSON.stringify(r.output, null, 2)?.slice(0, 4000));
}
const arts = await prisma.renderArtefact.findMany({ where: { jobId: created.jobId }, orderBy: { createdAt: "asc" } });
console.log("\n=== ARTEFACT ROWS ===");
for (const a of arts) console.log(`${a.kind}  syntheticProof=${a.syntheticProof}  ${a.bytes} bytes  ${a.sha256}  ${a.path}`);
console.log(`\nJOB_ID=${created.jobId}`);
console.log(`PROJECT_ID=${created.projectId}`);
process.exit(0);
