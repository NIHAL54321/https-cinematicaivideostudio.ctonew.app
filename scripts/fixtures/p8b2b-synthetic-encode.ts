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
import { findExportPreset, resolvedSpecCore } from "@/lib/export/presets";
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

const preset = findExportPreset(presetId);
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
for (const r of rows) {
  console.log(`\n--- ${r.stageId} [${r.state}] syntheticProof=${r.syntheticProof} artefacts=${r.artefactCount}`);
  console.log(JSON.stringify(r.output, null, 2)?.slice(0, 4000));
}
const arts = await prisma.renderArtefact.findMany({ where: { jobId: created.jobId }, orderBy: { createdAt: "asc" } });
console.log("\n=== ARTEFACT ROWS ===");
for (const a of arts) console.log(`${a.kind}  syntheticProof=${a.syntheticProof}  ${a.bytes} bytes  ${a.sha256}  ${a.path}`);
console.log(`\nJOB_ID=${created.jobId}`);
console.log(`PROJECT_ID=${created.projectId}`);
process.exit(0);
