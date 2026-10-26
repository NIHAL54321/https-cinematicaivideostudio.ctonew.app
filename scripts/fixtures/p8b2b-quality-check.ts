/**
 * Phase 8 block 2b — the Phase 7 quality checker's FIRST FILE-BASED MEASUREMENT.
 *
 * It runs the checker against the file the encoder really produced (the delivered
 * artefact of a SUCCEEDED synthetic-proof render job), and it supplies the
 * `syntheticProof` declaration so the plan itself carries, in a required field,
 * that these numbers are of a synthetic proof file and NOT of a customer's video.
 *
 * What it does NOT do: it invents no export job row, no subtitle track, no
 * thumbnail plan, and no delivery target. Checks that need those inputs report
 * NOT MEASURED and name what is missing — which is the honest answer, and is half
 * the result being reported.
 */
import { prisma } from "@/lib/db";
import { buildQualityPlan } from "@/lib/publishing/quality";
import { measureLoudness, probeProducedFile } from "@/lib/publishing/media-probe";
import type { PublishingSource } from "@/lib/publishing/types";
import { SYNTHETIC_MARKER } from "@/lib/render/synthetic-source";
import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

const argJobId = process.argv[2] ?? null;

const job = argJobId
  ? await prisma.renderJob.findUnique({ where: { id: argJobId }, select: { id: true, projectId: true, presetId: true, syntheticProof: true } })
  : await (async () => {
      // RenderJob carries NO status column: a job's outcome is read from its stage
      // rows, so the job is found through the artefact a finished render wrote.
      const art = await prisma.renderArtefact.findFirst({
        where: { syntheticProof: true, kind: { contains: "delivered" } },
        orderBy: { createdAt: "desc" },
        select: { jobId: true },
      });
      if (!art) return null;
      return prisma.renderJob.findUnique({ where: { id: art.jobId }, select: { id: true, projectId: true, presetId: true, syntheticProof: true } });
    })();
if (!job) throw new Error("no synthetic-proof render job found to measure");
if (!job.syntheticProof) throw new Error(`job ${job.id} is not a synthetic proof — this fixture measures synthetic proofs only`);
const stages = await prisma.renderStageRun.findMany({ where: { jobId: job.id }, orderBy: { sequence: "asc" }, select: { stageId: true, state: true } });
console.log(`stage rows        : ${stages.map((s) => `${s.stageId}=${s.state}`).join("  ")}`);

const delivered = await prisma.renderArtefact.findFirst({
  where: { jobId: job.id, kind: { contains: "delivered" } },
  orderBy: { createdAt: "desc" },
  select: { kind: true, path: true, bytes: true, sha256: true },
});
if (!delivered) throw new Error(`job ${job.id} has no delivered artefact row`);
const path = delivered.path;
const onDisk = statSync(path);
const actualSha = createHash("sha256").update(readFileSync(path)).digest("hex");

console.log("=== THE FILE THIS MEASURES ===");
console.log(`render job        : ${job.id}  (syntheticProof=${job.syntheticProof})`);
console.log(`preset            : ${job.presetId}`);
console.log(`artefact kind     : ${delivered.kind}`);
console.log(`path              : ${path}`);
console.log(`bytes on disk     : ${onDisk.size}   (row says ${delivered.bytes})`);
console.log(`sha256 on disk    : ${actualSha}`);
console.log(`sha256 on the row : ${delivered.sha256}`);
console.log(`row matches file  : ${actualSha === delivered.sha256}`);

const project = await prisma.project.findUnique({ where: { id: job.projectId }, select: { id: true, title: true, description: true, updatedAt: true } });
if (!project) throw new Error(`the synthetic project ${job.projectId} is gone`);

/**
 * The source is the SYNTHETIC project's own row, and nothing else is supplied:
 * no export job, no subtitle track, no audio track, no thumbnail plan.
 */
const source: PublishingSource = {
  project: {
    id: project.id,
    title: project.title,
    description: project.description,
    targetAspectRatio: "SIXTEEN_NINE",
    targetDurationSeconds: null,
    updatedAt: project.updatedAt.toISOString(),
  } as PublishingSource["project"],
  settings: null,
  script: null,
  chapters: [],
  assets: [],
  subtitleTracks: [],
  audioTracks: [],
  exportJobs: [],
  subtitleDefaults: null,
};

const file = probeProducedFile(path);
const loudness = measureLoudness(path);
const plan = buildQualityPlan({
  source,
  file,
  loudness,
  syntheticProof: { jobId: job.id, sourcePath: path, marker: SYNTHETIC_MARKER },
  thumbnails: null,
});

console.log("\n=== WHOSE FILE (the plan's own required field) ===");
console.log(`kind              : ${plan.measurementSubject.kind}`);
console.log(`sentence          : ${plan.measurementSubject.sentence}`);
console.log(`file measurement  : ${plan.fileMeasurement.statement}`);
console.log(`loudness          : ${plan.loudnessMeasurement.statement}`);

console.log("\n=== THE SEVENTEEN CHECKS ===");
for (const c of plan.checks) {
  console.log(`${c.id.padEnd(20)} w=${String(c.weight).padStart(3)}  ${c.state.padEnd(12)} ${c.measurement.slice(0, 150)}`);
}
const measured = plan.checks.filter((c) => c.state !== "not_measured");
console.log(`\nmeasured          : ${measured.length} of ${plan.checks.length}  [${measured.map((c) => c.id).join(", ")}]`);
console.log(`not measured      : ${plan.checks.length - measured.length}`);

console.log("\n=== THE SCORE ===");
console.log(`score             : ${plan.score.score.state === "derived" ? plan.score.score.value : `(none: ${plan.score.score.state})`}`);
console.log(`basis             : ${plan.score.basis}`);
console.log(`arithmetic        : ${plan.score.arithmetic}`);
console.log(`measured weight   : ${plan.score.measuredWeight} of ${plan.score.totalWeight} declared`);
for (const c of measured) console.log(`   ${c.id}: weight ${c.weight}, ${c.state}`);

console.log("\n=== THE PLAIN SENTENCE ===");
console.log(
  "These measurements were taken on a SYNTHETIC PROOF FILE that the encoder generated itself — not on a customer's video, and not on the fixture project. " +
    "No project's video has been produced on this machine.",
);
process.exit(0);
