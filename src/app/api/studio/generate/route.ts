import { apiError, apiRateLimit, ok, readJson, requireApiUser } from "@/lib/api";
import { prisma } from "@/lib/db";
import { execute, requiredEnvFor } from "@/lib/ai";
import type { AiTask, AiTaskType, AiCapabilityId, AiResult } from "@/lib/ai";
import { getPreset, applyPreset } from "@/lib/studio/presets";
import { pickCamera, applyCameraToPrompt, type CameraPick } from "@/lib/studio/camera";
import { applyEffects } from "@/lib/studio/effects";
import { restyle } from "@/lib/studio/restyle";
import { createGeneratedAsset } from "@/lib/media/assets";

export const runtime = "nodejs";

export type GenerateAction = "image" | "video" | "variation" | "restyle" | "upscale" | "enhance" | "bg_replace";

const ALLOWED_ACTIONS: GenerateAction[] = [
  "image",
  "video",
  "variation",
  "restyle",
  "upscale",
  "enhance",
  "bg_replace",
];

interface GenerateBody {
  action?: string;
  projectId?: string;
  sceneId?: string;
  topic?: string;
  prompt?: string;
  presetId?: string;
  cameraMove?: string;
  effects?: string[];
  aspectRatio?: string;
  n?: number;
  fromPreset?: string;
  toPreset?: string;
  [key: string]: unknown;
}

/** Which capability + taskType each action dispatches to. */
const ACTION_TARGET: Record<GenerateAction, { capability: AiCapabilityId; taskType: AiTaskType }> = {
  image: { capability: "image_generation", taskType: "IMAGE" },
  video: { capability: "video_generation", taskType: "VIDEO" },
  variation: { capability: "image_generation", taskType: "IMAGE" },
  restyle: { capability: "image_generation", taskType: "IMAGE" },
  upscale: { capability: "upscaling", taskType: "UPSCALE" },
  enhance: { capability: "image_enhancement", taskType: "ENHANCE_IMAGE" },
  bg_replace: { capability: "image_enhancement", taskType: "ENHANCE_IMAGE" },
};

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}
function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Verify a project (when provided) belongs to the user. Returns id or null. */
async function ownedProjectId(userId: string, projectId?: string): Promise<string | null> {
  if (!projectId) return null;
  const project = await prisma.project.findFirst({ where: { id: projectId, userId } });
  return project ? project.id : null;
}

/**
 * Build the final visual prompt deterministically, mirroring the real pipeline:
 *   base content  ->  applyPreset  ->  applyCameraToPrompt  ->  applyEffects
 * The prompt pipeline is REAL and runs whether or not a provider is connected.
 */
function buildPrompt(ctx: {
  action: GenerateAction;
  topic?: string;
  prompt?: string;
  presetId?: string;
  cameraMove?: string;
  effects?: string[];
  sceneVisual?: string | null;
  toPreset?: string;
  fromPreset?: string;
}) {
  const preset = getPreset(ctx.presetId);
  const basePrompt =
    ctx.action === "restyle"
      ? restyle(
          { visualPrompt: ctx.sceneVisual ?? ctx.prompt, title: ctx.topic },
          ctx.fromPreset,
          ctx.toPreset,
        ).restylePrompt
      : (ctx.prompt ?? ctx.topic ?? "a cinematic scene");

  let composed = applyPreset(preset, basePrompt);
  let camera: CameraPick | null = null;
  if (ctx.action === "image" || ctx.action === "video" || ctx.action === "variation") {
    if (ctx.cameraMove) {
      camera = pickCamera({ move: ctx.cameraMove });
      composed = applyCameraToPrompt(composed, camera);
    }
  }
  if (ctx.effects && ctx.effects.length > 0) {
    composed = applyEffects(composed, ctx.effects);
  }
  return { composed, preset, camera };
}

export async function POST(req: Request) {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "studio:generate", 30);
    const body = (await readJson(req)) as GenerateBody;
    const action = body.action as GenerateAction;
    if (!action || !ALLOWED_ACTIONS.includes(action)) {
      return ok({ connected: false, error: "Unknown action.", note: "Expected one of: " + ALLOWED_ACTIONS.join(", ") });
    }

    const projectId = await ownedProjectId(userId, body.projectId);
    const sceneId = str(body.sceneId);
    const topic = str(body.topic);
    const prompt = str(body.prompt);
    const presetId = str(body.presetId) ?? "cinematic";
    const cameraMove = str(body.cameraMove);
    const effects = Array.isArray(body.effects) ? body.effects.filter((e): e is string => typeof e === "string") : [];
    const aspectRatio = str(body.aspectRatio);
    const n = Math.min(4, Math.max(1, num(body.n) ?? 1));

    // Load a scene's existing visual prompt when sceneId is given (used as base).
    let sceneVisual: string | null = null;
    if (sceneId) {
      const scene = await prisma.scene.findFirst({ where: { id: sceneId, projectId: projectId ?? undefined } });
      sceneVisual = scene?.visualPrompt ?? null;
    }

    const { composed, preset, camera } = buildPrompt({
      action,
      topic,
      prompt,
      presetId,
      cameraMove,
      effects,
      sceneVisual,
      fromPreset: str(body.fromPreset),
      toPreset: str(body.toPreset),
    });

    const target = ACTION_TARGET[action];
    const providerContext: Record<string, unknown> = { prompt: composed };
    if (!["image", "video", "variation", "restyle"].includes(action)) {
      providerContext.sourcePrompt = prompt ?? topic ?? composed;
    }

    const task: AiTask = {
      type: target.taskType,
      capability: target.capability,
      payload: providerContext,
      params: {
        aspectRatio,
        videoType: action === "video" ? "clip" : undefined,
        requirements: action === "video" ? ["no_watermark"] : undefined,
      },
      projectId: projectId ?? undefined,
      metadata: { action, presetId, cameraMove: camera?.move.move, effects },
    };

    const result: AiResult = await execute(userId, task);

    // ----- Honest Provider-Not-Connected contract ---------------------------
    if (result.status !== "ok") {
      const requiredEnv = result.requiredEnv && result.requiredEnv.length > 0 ? result.requiredEnv : requiredEnvFor(target.capability);
      return ok({
        connected: false,
        capability: target.capability,
        action,
        requiredEnv, // the exact server-side env var name(s)
        envHint: requiredEnv[0],
        prompt: composed, // the FULLY-BUILT prompt pipeline output
        preset: {
          id: preset.id,
          name: preset.name,
          description: preset.description,
          grading: preset.grading ?? null,
        },
        camera: camera
          ? { move: camera.move.move, shot: camera.shot.id, rationale: camera.rationale }
          : null,
        effects,
        note:
          result.status === "not_connected"
            ? `Provider Not Connected: set one of ${requiredEnv.join(", ")} server-side to enable ${target.capability}. The full prompt below is ready to send.`
            : `The generation request could not complete: ${result.error ?? "unknown error"}. Nothing was fabricated.`,
      });
    }

    // ----- Connected: persist the REAL generated asset ----------------------
    const provider = result.provider ?? null;
    const model = result.model ?? null;
    const out = result.outputRefs as { url?: string; assetId?: string } | null | undefined;
    const assetUrl = out?.url ?? (typeof result.outputRefs?.url === "string" ? result.outputRefs?.url : null);

    if (projectId) {
      const asset = await createGeneratedAsset({
        userId,
        projectId,
        kind: target.capability === "video_generation" ? "GENERATED_VIDEO" : "GENERATED_IMAGE",
        name: `${preset.name} ${action}`,
        url: assetUrl,
        width: aspectRatio ? aspectRatioDimensions(aspectRatio).width : undefined,
        height: aspectRatio ? aspectRatioDimensions(aspectRatio).height : undefined,
        durationSeconds: action === "video" ? 5 : undefined,
        provider,
        model,
        prompt: composed,
        aspectRatio,
        sceneId: sceneId ?? undefined,
        role: "VISUAL",
      });
      return ok({ connected: true, action, asset });
    }

    // No project context: still a real result, but not persisted to a library.
    return ok({
      connected: true,
      action,
      asset: null,
      note: "Generation succeeded but no projectId was provided, so the asset was not persisted to a library.",
      provider,
      model,
      url: assetUrl,
      prompt: composed,
    });
  } catch (err) {
    return apiError(err);
  }
}

/** Simple 2K base mapping for common aspect ratios (used for asset metadata only). */
function aspectRatioDimensions(ratio: string): { width?: number; height?: number } {
  const parts = ratio.split(":").map((x) => Number(x.trim()));
  const w = Number.isFinite(parts[0]) ? parts[0] : 16;
  const h = Number.isFinite(parts[1]) ? parts[1] : 9;
  const scale = 1920 / w;
  return { width: Math.floor(w * scale), height: Math.floor(h * scale) };
}
