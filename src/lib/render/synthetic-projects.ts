/**
 * SYNTHETIC PROJECTS ARE NOT THE USER'S PROJECTS (Phase 8, block 2b, part 6).
 *
 * A synthetic encoder proof needs somewhere to hang its job, its scenes and its
 * artefact rows, so `enqueueSyntheticProofJob` creates a Project for it, titled
 * `SYNTHETIC ENCODER PROOF — 3840×2160 youtube-2160p`. That is a real row in
 * the same table the user's own projects live in, which means every page that
 * lists projects would otherwise offer it in a selector — and a user could pick
 * it, measure it, or read its render as though it were their own work.
 *
 * Synthetic JOBS are already excluded from the render list (`listRenderJobs`
 * filters on `syntheticProof: false`). This module applies the same rule to
 * synthetic PROJECTS, in one place, so a page cannot forget it:
 *
 *   - `syntheticProjectIds(userId)` reads the authoritative marking: the
 *     project ids of RenderJob rows with `syntheticProof = true`. The job's own
 *     column is the marking; the title is a second, independent signal.
 *   - `isSyntheticProject` / `excludeSyntheticProjects` are pure, so a page can
 *     filter a list it already has and a test can prove the filter works.
 *
 * The projects are not deleted and not hidden from the database: the synthetic
 * job's own read-out still names its project, because that is where the proof
 * lives. They are only kept out of the surfaces where a user is choosing their
 * own work.
 */
import { prisma } from "@/lib/db";

/** The prefix of every project title this app creates for a synthetic proof. */
export const SYNTHETIC_PROJECT_TITLE_PREFIX = "SYNTHETIC ENCODER PROOF";

/** True when a project exists only to carry a synthetic encoder proof. */
export function isSyntheticProject(
  project: { id: string; title?: string | null },
  syntheticIds: ReadonlySet<string> | readonly string[] = [],
): boolean {
  const ids = Array.isArray(syntheticIds) ? syntheticIds : Array.from(syntheticIds as ReadonlySet<string>);
  if (ids.includes(project.id)) return true;
  const title = (project.title ?? "").trim().toUpperCase();
  return title.startsWith(SYNTHETIC_PROJECT_TITLE_PREFIX);
}

/** Drop synthetic projects from a list a user is choosing from. */
export function excludeSyntheticProjects<T extends { id: string; title?: string | null }>(
  projects: readonly T[],
  syntheticIds: ReadonlySet<string> | readonly string[] = [],
): T[] {
  return projects.filter((p) => !isSyntheticProject(p, syntheticIds));
}

/**
 * The project ids that carry a synthetic encoder proof, read from the marking
 * in the job's own column. Tenant-scoped: another account's synthetic proofs
 * never enter this list.
 */
export async function syntheticProjectIds(userId: string): Promise<string[]> {
  const rows = await prisma.renderJob.findMany({
    where: { userId, syntheticProof: true },
    select: { projectId: true },
    distinct: ["projectId"],
  });
  return rows.map((r) => r.projectId);
}
