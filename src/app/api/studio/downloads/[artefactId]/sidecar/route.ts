/**
 * GET /api/studio/downloads/[artefactId]/sidecar — the digest sidecar.
 *
 * The checksum the pipeline wrote next to the delivered container, served as the
 * file it is: `<sha256>  <path>` in `sha256sum` format. It is a recorded artefact
 * of the same job, verified against its own recorded size and digest like any
 * other file — nothing is generated on the fly to stand in for it.
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
    const target = await resolveDownload({ userId, artefactId, audience: "user", sidecar: true });
    if (!target) return notFound("sidecar");
    return await serveArtefact(target);
  } catch (err) {
    return apiError(err);
  }
}
