/**
 * WHO MAY SEE WHICH ARTEFACT — one rule, in one place (Phase 8, block 3).
 *
 * A download centre is the last surface where a mistake is unrecoverable: a list
 * that leaks a row is bad, but a DOWNLOAD that serves the wrong bytes hands them
 * over. So the two exclusions this app already has are applied here as data, and
 * every path (list, direct artefact id, download, sidecar) uses this module
 * rather than repeating the condition:
 *
 *   1. TENANCY. The artefact's job must belong to the signed-in user. A foreign
 *      artefact id is a 404 — never a 403, which would confirm the row exists.
 *   2. SYNTHETIC. Neither the artefact nor its job may be a synthetic encoder
 *      proof, and its project may not be one either. This reuses
 *      `src/lib/render/synthetic-projects.ts` for the project half rather than
 *      restating the title marker, and mirrors `listRenderJobs`' own
 *      `syntheticProof: false` filter for the job half.
 *
 * The proof read-out (src/app/api/studio/proofs) is the ONE surface allowed to
 * read synthetic artefacts, and it reads them through `proofArtefactWhere` below
 * — the inverse rule, not a relaxed copy of this one.
 */
import { SYNTHETIC_PROJECT_TITLE_PREFIX } from "@/lib/render/synthetic-projects";

/** Artefact kinds that are a downloadable product file, in reading order. */
export const PRIMARY_ARTEFACT_KINDS = ["delivered-container", "master-video"] as const;

/** The kind of the digest sidecar written next to a delivered container. */
export const SIDECAR_ARTEFACT_KIND = "checksum-sidecar";

export type PrimaryArtefactKind = (typeof PRIMARY_ARTEFACT_KINDS)[number];

/** What a row must carry for the rule to be decidable, without Prisma. */
export interface ArtefactRuleRow {
  id: string;
  kind: string;
  syntheticProof: boolean;
  job: {
    id: string;
    userId: string;
    syntheticProof: boolean;
    project: { id: string; title: string; deletedAt?: Date | null };
  };
}

/**
 * The Prisma `where` for "artefacts this user may download".
 *
 * `syntheticProjectIds` comes from `syntheticProjectIds(userId)` — the same
 * authority the Export Center's project selectors use. The title check is the
 * second, independent signal used by `isSyntheticProject`, applied in SQL too so
 * a project marked only by its title cannot slip through a query.
 */
export function deliverableWhereForUser(
  userId: string,
  syntheticProjectIds: readonly string[],
  kinds: readonly string[] = PRIMARY_ARTEFACT_KINDS,
) {
  // Deliberately NOT `as const`: Prisma's generated `where` types want mutable
  // `string[]`, and a readonly tuple here fails `next build`'s type check.
  return {
    syntheticProof: false,
    kind: { in: [...kinds] as string[] },
    job: {
      userId,
      syntheticProof: false,
      project: {
        deletedAt: null,
        id: { notIn: [...syntheticProjectIds] as string[] },
        NOT: { title: { startsWith: SYNTHETIC_PROJECT_TITLE_PREFIX } },
      },
    },
  };
}

/** The same rule for ONE artefact id — the direct-id and download paths. */
export function deliverableArtefactWhere(
  userId: string,
  syntheticProjectIds: readonly string[],
  artefactId: string,
  kinds: readonly string[] = PRIMARY_ARTEFACT_KINDS,
) {
  return { id: artefactId, ...deliverableWhereForUser(userId, syntheticProjectIds, kinds) };
}

/**
 * The INVERSE rule: a synthetic proof artefact, for the labelled proof read-out
 * and its download. Tenancy still applies; the synthetic markings are required
 * rather than forbidden, on both the artefact and the job.
 */
export function proofWhereForUser(userId: string, artefactId?: string) {
  return {
    ...(artefactId ? { id: artefactId } : {}),
    syntheticProof: true,
    job: { userId, syntheticProof: true },
  } as const;
}

/**
 * The rule again, as a pure predicate, applied to rows a query already returned.
 * Belt and braces: if a future query forgets a clause, the row still does not
 * reach a user, and the test in __tests__/rule.test.ts fails on the forgetting.
 */
export function isDeliverableRow(
  row: ArtefactRuleRow,
  userId: string,
  syntheticProjectIds: readonly string[] = [],
): boolean {
  if (row.syntheticProof) return false;
  if (!row.job || row.job.userId !== userId) return false;
  if (row.job.syntheticProof) return false;
  const project = row.job.project;
  if (!project) return false;
  if (project.deletedAt) return false;
  if (syntheticProjectIds.includes(project.id)) return false;
  if ((project.title ?? "").trim().toUpperCase().startsWith(SYNTHETIC_PROJECT_TITLE_PREFIX)) return false;
  return true;
}
