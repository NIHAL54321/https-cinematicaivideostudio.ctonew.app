import { NextRequest } from "next/server";
import { apiError, apiRateLimit, ok, requireApiUser } from "@/lib/api";
import { matrixView, type SpecTruth } from "@/lib/export/spec-matrix";
import { EXPORT_PRESETS, findExportPreset, listExportPresetViews, specProvenanceTally } from "@/lib/export/presets";
import { withProviderState } from "@/lib/export/spec-status";
import { masterView } from "@/lib/export/youtube-master";
import { recommendPreset, recommendationView } from "@/lib/export/recommend";
import { measureProject } from "@/lib/export/measure";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/studio/export-spec[?projectId=…][&presetId=…][&targetPlatform=…]
 *
 * The whole export specification in one payload:
 *   - `matrix`        every axis and option, each carrying where its truth comes
 *                     from (computed / gated / provider), with the AI upscale
 *                     option's LIVE key state attached at response time,
 *   - `presets`       the seven presets resolved from that matrix, each with the
 *                     value, the reason and the provenance of every axis,
 *   - `master`        the twelve choices of the YouTube delivery master for one
 *                     preset, with the reason for each and the boundary it never
 *                     crosses,
 *   - `recommendation` when a projectId is given: computed from that project's
 *                     own measured facts, with its reasons and — when a fact
 *                     could not be measured — a partial-basis statement naming it.
 *
 * Nothing here produces a file. `producedOnThisBuild` is false throughout, and
 * the statement that says so travels with the payload.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "export-spec:read", 240);

    const projectId = req.nextUrl.searchParams.get("projectId");
    const presetId = req.nextUrl.searchParams.get("presetId");
    const targetPlatform = req.nextUrl.searchParams.get("targetPlatform");

    const matrix = withProviderState(matrixView());
    const preset = findExportPreset(presetId ?? "youtube-2160p") ?? EXPORT_PRESETS[0];

    const tally: Record<SpecTruth, number> = { computed: 0, gated: 0, provider: 0 };
    for (const p of EXPORT_PRESETS) {
      const t = specProvenanceTally(p);
      tally.computed += t.computed;
      tally.gated += t.gated;
      tally.provider += t.provider;
    }

    const payload: Record<string, unknown> = {
      matrix,
      presets: listExportPresetViews(),
      presetCount: EXPORT_PRESETS.length,
      presetAxisProvenanceTally: tally,
      master: masterView(preset),
      producedOnThisBuild: false,
    };

    if (projectId) {
      const measurement = await measureProject({ projectId, userId, targetPlatform });
      if (!measurement) return ok({ error: "Project not found.", code: "not_found" }, 404);
      payload.measurement = measurement;
      payload.recommendation = recommendationView(measurement, recommendPreset(measurement));
    }

    return ok(payload);
  } catch (err) {
    return apiError(err);
  }
}
