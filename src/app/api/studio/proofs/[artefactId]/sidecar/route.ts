/**
 * GET /api/studio/proofs/[artefactId]/sidecar — the digest sidecar of a labelled
 * synthetic proof.
 *
 * Same rule as the artefact route: the INVERSE of the user surface (the synthetic
 * marking is required on the artefact and its job, and the row must be this user's),
 * and the same `serveArtefact` gate — the bytes are verified against the recorded
 * size and SHA-256 before the status line is written.
 */
import type { NextRequest } from "next/server";
import { apiError, requireApiUser } from "@/lib/api";
import { resolveDownload } from "@/lib/downloads/resolve";
import { notFound, serveArtefact } from "@/lib/downloads/serve";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ artefactId: string }> }) {
  try {
    const userId = await requireApiUser();
    const { artefactId } = await params;
    const target = await resolveDownload({ userId, artefactId, audience: "proof", sidecar: true });
    if (!target) return notFound("sidecar");
    return await serveArtefact(target);
  } catch (err) {
    return apiError(err);
  }
}
