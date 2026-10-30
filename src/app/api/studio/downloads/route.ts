/**
 * GET /api/studio/downloads — the download centre's own data, as JSON.
 *
 * The same `loadDownloadCentre` the page renders, so the API and the page cannot
 * disagree: files that are present, files whose bytes are gone, and the per-project
 * reasons for having nothing, all derived from rows plus `stat()`.
 */
import { apiError, requireApiUser } from "@/lib/api";
import { loadDownloadCentre } from "@/lib/downloads/centre";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const userId = await requireApiUser();
    const centre = await loadDownloadCentre({ userId });
    return Response.json(centre, { headers: { "cache-control": "private, no-store" } });
  } catch (err) {
    return apiError(err);
  }
}
