/**
 * GET /api/studio/downloads/[artefactId] — download one produced file.
 *
 * 404 for an id this user may not have: another account's artefact, a synthetic
 * encoder proof, an artefact of a synthetic project, or an id that never existed.
 * All the same answer, so the route is not an oracle.
 *
 * 410 when the row is this user's but the file is no longer on disk — a known
 * state of render output under /tmp, never a 500 and never a fabricated file.
 * 409 when a file is there but is not the size or content that was recorded.
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
    const target = await resolveDownload({ userId, artefactId, audience: "user" });
    if (!target) return notFound("artefact");
    return await serveArtefact(target);
  } catch (err) {
    return apiError(err);
  }
}
