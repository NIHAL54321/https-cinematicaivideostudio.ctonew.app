import { apiError, apiRateLimit, ok, readJson, requireApiUser } from "@/lib/api";
import { scriptWriterAiHook, scriptWriterIntelligence, type ScriptWriterIntelligenceAction } from "@/lib/studio/pipeline";

export const runtime = "nodejs";

/**
 * POST /api/studio/script-writer — AI actions for the standalone AI Script
 * Writer studio (Generate Hook (AI) + Script Intelligence).
 *
 * Everything here routes through the AI Model Orchestrator. In Phase 1 no
 * provider is wired, so the orchestrator returns its honest "Provider Not
 * Connected" result — the studio renders exactly that. Nothing is simulated.
 *
 * Body:
 *   { action: "hook", topic, tone?, videoType? }                                          -> reasoning
 *   { action: "intelligence", directive: "improve|engaging|emotional|concise|professional|retention",
 *     topic, tone?, videoType?, durationSeconds?, outline? }                              -> script_generation
 */
export async function POST(req: Request) {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "studio:script-writer", 30);
    const body = (await readJson(req)) as Record<string, unknown>;

    const action = body.action;
    const topic = typeof body.topic === "string" ? body.topic : "";
    const tone = typeof body.tone === "string" ? body.tone : undefined;
    const videoType = typeof body.videoType === "string" ? body.videoType : undefined;
    const durationSeconds =
      typeof body.durationSeconds === "number" && Number.isFinite(body.durationSeconds)
        ? body.durationSeconds
        : undefined;
    const outline = typeof body.outline === "string" ? body.outline : undefined;

    if (action === "hook") {
      const result = await scriptWriterAiHook(userId, { topic, tone, videoType });
      return ok({ result });
    }

    if (action === "intelligence") {
      const directive = body.directive;
      const allowed: ScriptWriterIntelligenceAction[] = [
        "improve",
        "engaging",
        "emotional",
        "concise",
        "professional",
        "retention",
      ];
      if (typeof directive !== "string" || !(allowed as string[]).includes(directive)) {
        return ok({ result: null, error: "Unknown intelligence directive." });
      }
      const result = await scriptWriterIntelligence(userId, directive as ScriptWriterIntelligenceAction, {
        topic,
        tone,
        videoType,
        durationSeconds,
        outline,
      });
      return ok({ result });
    }

    return ok({ result: null, error: "Unknown action." });
  } catch (err) {
    return apiError(err);
  }
}
