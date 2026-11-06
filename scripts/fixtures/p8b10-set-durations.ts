/**
 * Phase 8 block 10 — THE FIXTURE TIMELINE THIS MACHINE CAN ACTUALLY ENCODE.
 *
 * The fixture project's nine scenes declare 600 s in total (that is the script the
 * p7a world was built from). Encoding 600 s at the shipped 1080p preset's own
 * settings needs roughly 600 MB for the master plus 600 MB for the delivered
 * container, against ~1.3 GB free on this machine — and about 50 minutes of
 * encoding on a machine that resets roughly hourly.
 *
 * So every scene is set to 20 s: a 180 s timeline, which fits. This is a
 * MACHINE-CAPACITY DECISION ON FIXTURE DATA, NOT A PRODUCT LIMIT: no preset was
 * weakened, no encoder setting was changed, and the duration is the project's own
 * `Scene.durationSeconds` — the same field a real project would carry. The
 * sentence below is written into the project's own record so the fixture cannot
 * later be mistaken for a 600-second film.
 *
 * Usage: bun scripts/fixtures/p8b10-set-durations.ts [seconds] [--dry-run]
 */
import { prisma } from "@/lib/db";

const PROJECT = process.env.P8B10_PROJECT ?? "p7a_fix_project";
const SECONDS = Number(process.argv[2] ?? 20);
const DRY = process.argv.includes("--dry-run");

const SENTENCE =
  `Timeline cut to ${SECONDS} s per scene (fixture decision, ${new Date().toISOString().slice(0, 10)}): ` +
  `the nine-scene script declares 600 s in total, and encoding 600 s at the shipped 1080p preset needs ~1.2 GB of ` +
  `render output against ~1.3 GB of free disk on this machine. This is a MACHINE-CAPACITY DECISION ON FIXTURE DATA, ` +
  `NOT A PRODUCT LIMIT: no preset or encoder setting was weakened, and the shipped preset still declares what it declares.`;

async function main() {
  const project = await prisma.project.findUnique({ where: { id: PROJECT }, select: { id: true, title: true, description: true } });
  if (!project) throw new Error(`no project ${PROJECT}`);
  const scenes = await prisma.scene.findMany({ where: { projectId: PROJECT }, orderBy: { order: "asc" }, select: { id: true, order: true, durationSeconds: true } });
  if (scenes.length === 0) throw new Error(`project ${PROJECT} has no scenes`);
  const before = scenes.reduce((n, s) => n + (s.durationSeconds ?? 0), 0);
  console.log(`project ${project.id} "${project.title}" — ${scenes.length} scene(s), ${before} s declared in total`);
  for (const s of scenes) console.log(`  scene #${s.order} ${s.id}: ${s.durationSeconds} s → ${SECONDS} s`);

  if (DRY) {
    console.log("dry run — nothing written");
    return;
  }
  for (const s of scenes) {
    await prisma.scene.update({ where: { id: s.id }, data: { durationSeconds: SECONDS } });
  }
  const description = project.description?.includes("MACHINE-CAPACITY DECISION") ? project.description : `${project.description ?? ""} ${SENTENCE}`.trim();
  await prisma.project.update({ where: { id: PROJECT }, data: { description } });

  const after = await prisma.scene.findMany({ where: { projectId: PROJECT }, select: { durationSeconds: true } });
  const total = after.reduce((n, s) => n + (s.durationSeconds ?? 0), 0);
  console.log(`\nafter: ${total} s across ${after.length} scene(s) (was ${before} s)`);
  console.log(`project record now says: ${SENTENCE}`);
}

await main();
process.exit(0);
