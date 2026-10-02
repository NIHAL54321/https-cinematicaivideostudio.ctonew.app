import { NextRequest } from "next/server";
import { apiError, apiRateLimit, ok, requireApiUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { buildSemanticQuery } from "@/lib/media/semantic";
import { rankCandidates } from "@/lib/media/ranking";
import { searchAllStockProviders, stockProviderEnvHints } from "@/lib/media/providers";
import type { MediaSceneInput } from "@/lib/media/semantic";
import type { MediaSearchOutcome } from "@/lib/media/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function str(v: string | null): string | undefined {
  return v && v.length ? v : undefined;
}

/**
 * GET /api/media?sceneId=...&count=...
 * Builds a semantic query from the scene, calls the configured stock providers
 * in A→B fallback order, and returns ranked candidates with full licensing
 * metadata. When no provider is configured it returns an honest
 * { status: "not_connected", requiredEnv }.
 */
export async function GET(req: NextRequest) {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "media:search", 60);
    const sp = req.nextUrl.searchParams;
    const sceneId = sp.get("sceneId");
    const count = Number(sp.get("count") ?? 12);

    // Optional direct-override when no scene exists (testing / standalone).
    const direct = sp.get("q");

    let sceneInput: MediaSceneInput = { count };
    if (sceneId) {
      const scene = await prisma.scene.findFirst({
        where: { id: sceneId, project: { userId } },
      });
      if (!scene) {
        return ok(
          { status: "not_found", message: "Scene not found or not yours." },
          404,
        );
      }
      sceneInput = {
        narration: scene.narration,
        title: scene.title,
        visualPrompt: scene.visualPrompt,
        aspectRatio: scene.aspectRatio,
        count,
      };
      // Optional UI hints that are not stored on the scene row.
      sceneInput.mediaType = str(sp.get("mediaType"));
      sceneInput.camera = str(sp.get("camera"));
      sceneInput.tone = str(sp.get("tone"));
      sceneInput.emotion = str(sp.get("emotion"));
      sceneInput.beat = str(sp.get("beat"));
    } else if (direct) {
      sceneInput = { narration: direct, count };
    } else {
      return ok({ status: "error", message: "Provide sceneId or q." }, 400);
    }

    const query = buildSemanticQuery(sceneInput);
    const responses = await searchAllStockProviders({
      query: query.keywords,
      mediaType: query.mediaType,
      orientation: query.orientation,
      count,
    });

    const providers = stockProviderEnvHints();
    const okProviders = responses.filter((r) => r.status === "ok");
    if (okProviders.length === 0) {
      // Honest not-connected (no provider configured) — never fabricated zeros.
      const outcome: MediaSearchOutcome = {
        status: "not_connected",
        requiredEnv: [...new Set(responses.flatMap((r) => (r as { requiredEnv?: string[] }).requiredEnv ?? []))],
        providers,
      };
      return ok({ ...outcome, query, providerResponses: responses });
    }

    const merged = okProviders.flatMap((r) => (r.status === "ok" ? r.results : []));
    const candidates = rankCandidates(merged, query);
    return ok({
      status: "ok",
      candidates,
      query,
      providers,
      providerResponses: responses,
      source: "stock-provider",
    });
  } catch (err) {
    return apiError(err);
  }
}
