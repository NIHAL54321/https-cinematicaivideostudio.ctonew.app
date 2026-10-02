import { apiError, apiRateLimit, ok, readJson, requireApiUser } from "@/lib/api";
import { magicCreate, parseCreateVideoInput } from "@/lib/studio/pipeline";

export const runtime = "nodejs";

/**
 * POST /api/studio/magic-create — the Create Video wizard's CREATE action.
 *
 * Runs the real deterministic steps (analyze input → select structure → build
 * the duration-budgeted plan → persist Project/Settings/Script/Chapter/Scene
 * rows), then attempts ONE AI step (script generation) through the AI Model
 * Orchestrator. In Phase 1 that step honestly returns "Provider Not Connected"
 * and the pipeline stops — the response includes the persisted project so the
 * user can open it immediately.
 *
 * Body: { inputType, sourceText, format, durationSeconds, style, language, voice, title? }
 */
export async function POST(req: Request) {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "studio:create", 30);
    const body = await readJson(req);
    const input = parseCreateVideoInput(body);
    const result = await magicCreate(userId, input);
    return ok(result);
  } catch (err) {
    return apiError(err);
  }
}
