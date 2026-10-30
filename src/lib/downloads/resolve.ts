/**
 * FROM AN ID IN A URL TO A FILE THIS USER MAY HAVE (Phase 8, block 3).
 *
 * Every download route in the app funnels through here, so the tenancy rule, the
 * synthetic rule and the sidecar pairing are decided in ONE place:
 *
 *   audience "user"  — the deliverable. Both exclusions apply, and an artefact
 *                      that fails either is simply NOT FOUND: a foreign id and a
 *                      synthetic id get the same 404, so the response cannot be
 *                      used to probe which artefacts exist.
 *   audience "proof" — the labelled synthetic proof read-out. Tenancy still
 *                      applies; the synthetic markings are REQUIRED, so this route
 *                      can only ever serve something already marked synthetic, and
 *                      it says so in the filename and in the headers.
 */
import { prisma } from "@/lib/db";
import { syntheticProjectIds } from "@/lib/render/synthetic-projects";
import { downloadFilename } from "./centre";
import {
  PRIMARY_ARTEFACT_KINDS,
  SIDECAR_ARTEFACT_KIND,
  deliverableArtefactWhere,
  deliverableWhereForUser,
  proofWhereForUser,
} from "./rule";
import type { ServeTarget } from "./serve";

export type DownloadAudience = "user" | "proof";

const rowInclude = {
  job: {
    select: {
      id: true,
      userId: true,
      presetId: true,
      syntheticProof: true,
      project: { select: { id: true, title: true } },
    },
  },
} as const;

type Row = {
  id: string;
  jobId: string;
  kind: string;
  path: string;
  bytes: number;
  sha256: string;
  job: {
    id: string;
    userId: string;
    presetId: string;
    syntheticProof: boolean;
    project: { id: string; title: string };
  };
};

export const PROOF_PROVENANCE =
  "SYNTHETIC ENCODER PROOF — an encode of a source the encoder generated itself (a testsrc2 pattern and a " +
  "440 Hz tone). Not a project's video, not a customer's video, and not a delivered master.";

export function userProvenance(projectTitle: string, jobId: string): string {
  return `Produced by render job ${jobId} for the project "${projectTitle}" — that project's own pipeline output.`;
}

function toTarget(row: Row, audience: DownloadAudience, synthetic: boolean): ServeTarget {
  return {
    artefactId: row.id,
    jobId: row.jobId,
    path: row.path,
    bytes: row.bytes,
    sha256: row.sha256,
    kind: row.kind,
    filename: downloadFilename({
      projectTitle: row.job.project.title,
      presetId: row.job.presetId,
      kind: row.kind,
      path: row.path,
      synthetic,
    }),
    synthetic,
    provenance: synthetic
      ? PROOF_PROVENANCE
      : userProvenance(row.job.project.title, row.jobId),
  };
}

/**
 * Resolve `artefactId` to a servable file, or null (which every caller turns into
 * a 404 — the same 404 for a foreign id, a synthetic id on the user surface, and an
 * id that never existed).
 */
export async function resolveDownload(input: {
  userId: string;
  artefactId: string;
  audience: DownloadAudience;
  sidecar?: boolean;
}): Promise<ServeTarget | null> {
  const { userId, artefactId, audience } = input;
  const wantSidecar = input.sidecar === true;

  if (audience === "user") {
    const syntheticIds = await syntheticProjectIds(userId);
    const parent = (await prisma.renderArtefact.findFirst({
      where: deliverableArtefactWhere(userId, syntheticIds, artefactId),
      include: rowInclude,
    })) as Row | null;
    if (!parent) return null;
    if (!wantSidecar) return toTarget(parent, "user", false);
    const sidecar = (await prisma.renderArtefact.findFirst({
      where: {
        ...deliverableWhereForUser(userId, syntheticIds, [SIDECAR_ARTEFACT_KIND]),
        jobId: parent.jobId,
      },
      include: rowInclude,
    })) as Row | null;
    return sidecar ? toTarget(sidecar, "user", false) : null;
  }

  const parent = (await prisma.renderArtefact.findFirst({
    where: proofWhereForUser(userId, artefactId),
    include: rowInclude,
  })) as Row | null;
  if (!parent) return null;
  if (!wantSidecar) return toTarget(parent, "proof", true);
  const sidecar = (await prisma.renderArtefact.findFirst({
    where: { ...proofWhereForUser(userId), jobId: parent.jobId, kind: SIDECAR_ARTEFACT_KIND },
    include: rowInclude,
  })) as Row | null;
  return sidecar ? toTarget(sidecar, "proof", true) : null;
}

/** The kinds a user-facing download route may serve (asserted by a test). */
export const USER_DOWNLOAD_KINDS = PRIMARY_ARTEFACT_KINDS;
