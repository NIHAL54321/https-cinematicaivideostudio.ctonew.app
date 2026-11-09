/**
 * Render counts — ONE derivation, shared by every surface that shows a number
 * of renders. Phase 8 truthful-surfaces block.
 *
 * ── Why this module exists ──────────────────────────────────────────────────
 * On 2026-11-09 the Dashboard read `Renders: 0` for an account whose delivered
 * render the Export Center listed in full. Both pages queried the same database;
 * they just queried DIFFERENT TABLES:
 *
 *   - `RenderJob`  — the render pipeline's own table. It carries the attempts,
 *                    the ordered stage runs, the artefacts and the
 *                    `syntheticProof` marking. This is the authoritative record
 *                    of "a render was requested / produced" and it is what
 *                    `listRenderJobs()` (and therefore the Export Center's render
 *                    pipeline panel) reads.
 *   - `RenderingJob` — the older export-queue table. It still has meaning (it is
 *                    a queue row), but nothing in the current pipeline writes it,
 *                    so counting it and labelling the number "Renders" denied
 *                    every render the pipeline had actually produced.
 *
 * The rule this module enforces: a surface may count only what it names. So the
 * counts are computed once, here, and each surface labels the table it shows.
 * `rendersStat()` is pure so both directions — rows exist / rows absent — are
 * unit-tested without a database.
 */
import { prisma } from "@/lib/db";

export interface RenderCounts {
  /** `RenderJob` rows that are the account's own (synthetic encoder proofs excluded). */
  pipelineJobs: number;
  /** `RenderingJob` rows — the older export queue, counted separately, never merged. */
  legacyQueueJobs: number;
  /** `ExportJob` rows. */
  exportJobs: number;
}

/**
 * Read all three counts for one account.
 *
 * `syntheticProof: false` is the same exclusion `listRenderJobs()` applies: a
 * synthetic encoder proof is never a user's render and must never be counted as
 * one.
 */
export async function readRenderCounts(userId: string): Promise<RenderCounts> {
  const [pipelineJobs, legacyQueueJobs, exportJobs] = await Promise.all([
    prisma.renderJob.count({ where: { userId, syntheticProof: false } }),
    prisma.renderingJob.count({ where: { userId } }),
    prisma.exportJob.count({ where: { userId } }),
  ]);
  return { pipelineJobs, legacyQueueJobs, exportJobs };
}

export interface StatLine {
  label: string;
  value: number;
  hint: string;
}

function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}

/**
 * The Dashboard's "Renders" card, derived from the counts above.
 *
 * The value is ALWAYS `RenderJob` rows — the table the Export Center's render
 * pipeline reads — so the two surfaces cannot disagree. The hint names the
 * table, and if the older queue still holds rows they are named on their own
 * line rather than being added into the same number.
 */
export function rendersStat(counts: RenderCounts): StatLine {
  const n = counts.pipelineJobs;
  const pipeline =
    n === 0
      ? "No RenderJob rows yet — a render you start is recorded in the RenderJob table"
      : `${n} ${plural(n, "RenderJob row", "RenderJob rows")} in the render pipeline — the table the Export Center reads`;
  const legacy =
    counts.legacyQueueJobs > 0
      ? ` The older export queue also holds ${counts.legacyQueueJobs} ${plural(
          counts.legacyQueueJobs,
          "RenderingJob row",
          "RenderingJob rows",
        )}, counted separately and never added to this number.`
      : "";
  return { label: "Renders", value: n, hint: `${pipeline}.${legacy}` };
}
