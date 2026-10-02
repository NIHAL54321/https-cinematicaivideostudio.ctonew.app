import { apiError, apiRateLimit, ok, readJson, requireApiUser } from "@/lib/api";
import { getOwnedProject } from "@/lib/projects";
import { getScriptTree, type ScriptTreeScene } from "@/lib/studio/pipeline";
import { assignVisualsToStoryboard } from "@/lib/studio/visual-assignment";
import type { VisualScene, VisualSelectionOptions } from "@/lib/studio/visual-selection";

export const runtime = "nodejs";

/**
 * POST /api/studio/visuals — tenant-scoped Visual Selection + Continuity.
 *
 * Given a projectId (server loads the tenant's storyboard scenes) OR a raw
 * `scenes` payload, this runs the DETERMINISTIC visual-selection pipeline:
 * extracts cross-scene continuity, ranks candidate visuals per scene (mScore +
 * rationale) and attaches a primary + alternates. Because the ranking is real
 * rule-based logic, it is NEVER "not_connected" — it works for real. (Only the
 * actual generation of a provider image, if requested elsewhere, reports
 * "Provider Not Connected".)
 */
export async function POST(req: Request) {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "studio:visuals", 30);
    const body = (await readJson(req)) as Record<string, unknown> | null;

    const projectId = body && typeof body.projectId === "string" ? body.projectId : undefined;
    let scenes: VisualScene[];
    let options: VisualSelectionOptions = {};

    if (projectId) {
      // Tenant-scoped: verifies the user owns this project before loading.
      await getOwnedProject(userId, projectId);
      const tree = await getScriptTree(userId, projectId);
      scenes = (tree.script?.chapters ?? []).flatMap((c) => c.scenes.map(toVisualScene));
      options = {
        projectId,
        presetId: tree.meta?.style,
        format: tree.meta?.format,
      };
    } else if (body && Array.isArray(body.scenes)) {
      scenes = body.scenes.filter((s): s is VisualScene => Boolean(s) && typeof s === "object");
      options = {
        presetId: typeof body.presetId === "string" ? body.presetId : (body.presetId as string | null | undefined),
        format: typeof body.format === "string" ? body.format : undefined,
      };
    } else {
      return ok({
        connected: true,
        basedOn: "none",
        error: "Provide a projectId or a `scenes` array to run visual selection.",
      });
    }

    if (!scenes.length) {
      return ok({ connected: true, basedOn: projectId ? "project" : "payload", assignments: [], continuity: null, note: "No scenes to rank." });
    }

    const result = assignVisualsToStoryboard(scenes, options);
    return ok({ connected: true, basedOn: projectId ? "project" : "payload", ...result });
  } catch (err) {
    return apiError(err);
  }
}

/** Map a persisted ScriptTreeScene onto the engine's VisualScene input. */
function toVisualScene(s: ScriptTreeScene): VisualScene {
  return {
    id: s.id,
    order: s.order,
    title: s.title,
    narration: s.narration,
    visualPrompt: s.visualPrompt,
    mediaType: s.mediaType,
    camera: s.camera,
    durationSeconds: s.durationSeconds,
  };
}
