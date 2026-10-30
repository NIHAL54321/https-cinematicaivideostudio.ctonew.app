/**
 * GET /api/studio/proofs/[artefactId] — download one LABELLED synthetic proof.
 *
 * This is the only route that will serve a synthetic artefact, and it serves it
 * through the same `serveArtefact` as every other download: the digest and size
 * are verified before the status line, the body is streamed, and the response
 * carries `x-cavs-synthetic: true` plus the provenance sentence so the file's own
 * response says what it is. The filename it is saved under starts with
 * `SYNTHETIC-PROOF--`, so a renamed download still says so.
 *
 * `resolveDownload(..., audience: "proof")` applies the INVERSE rule: the row must
 * carry the synthetic marking on both the artefact and its job, and must belong to
 * this user. Anything else — including a real deliverable id — is the same 404.
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
    const target = await resolveDownload({ userId, artefactId, audience: "proof" });
    if (!target) return notFound("artefact");
    return await serveArtefact(target);
  } catch (err) {
    return apiError(err);
  }
}
