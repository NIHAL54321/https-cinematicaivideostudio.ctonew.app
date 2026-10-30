/**
 * Prisma-backed persistence adapter for the AI Model Orchestrator.
 *
 * Every row is tenant-scoped (userId is always part of the where/create).
 * Loaded LAZILY by the orchestrator so the pure fallback logic never imports
 * Prisma in unit tests. Provider env keys never pass through here — only
 * names and results.
 */
import { prisma } from "@/lib/db";
import { Prisma, type GenerationTaskType } from "@prisma/client";
import type { AiTask, AiTaskType } from "./types";
import { meter } from "@/lib/usage/metering";
import type { AiPersistence, GenerationCreateInput, GenerationUpdateInput, ProviderLogInput } from "./orchestrator";

/** Safe JSON cast for Prisma Json fields (values are plain serializable data). */
function json(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return v as Prisma.InputJsonValue;
}

/** AiTaskType → Prisma GenerationTaskType enum. */
const TASK_TYPE_MAP: Record<AiTaskType, GenerationTaskType> = {
  REASON: "OTHER",
  SCRIPT: "SCRIPT_WRITER",
  STORYBOARD: "STORYBOARD",
  IMAGE: "IMAGE_GENERATION",
  VIDEO: "VIDEO_GENERATION",
  VOICE: "VOICEOVER",
  TRANSCRIBE: "SUBTITLE_GENERATION",
  TRANSLATE: "TRANSLATION",
  MUSIC: "MUSIC",
  SOUND_EFFECT: "SOUND_EFFECT",
  ENHANCE_IMAGE: "IMAGE_GENERATION",
  ENHANCE_VIDEO: "VIDEO_GENERATION",
  UPSCALE: "VIDEO_GENERATION",
  LIP_SYNC: "VIDEO_GENERATION",
  SUBTITLE: "SUBTITLE_GENERATION",
  DETECT_SCENE: "OTHER",
  DETECT_OBJECT: "OTHER",
  DETECT_FACE: "OTHER",
  SEARCH_SEMANTIC: "OTHER",
  SEARCH_STOCK: "OTHER",
  THUMBNAIL: "THUMBNAIL_GENERATION",
  SEO: "SEO",
};

export function toGenerationTaskType(type: AiTaskType): GenerationTaskType {
  return TASK_TYPE_MAP[type] ?? "OTHER";
}

/** Pick payload refs (keys that look like refs) for the audit trail. */
function pickRefs(payload: Record<string, unknown>): Record<string, unknown> {
  const refs: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (/ref|id|url|path/i.test(k) && typeof v === "string") refs[k] = v.slice(0, 500);
  }
  return refs;
}

export const prismaAiPersistence: AiPersistence = {
  /**
   * METERING (Phase 8, block 5): the orchestrator's attempt loop calls this for
   * every candidate provider call, successful or not. `meter()` never throws —
   * a provider call that happened is not un-happened by an accounting failure.
   */
  async recordUsage(input) {
    return meter(input);
  },
  async createGeneration(input: GenerationCreateInput) {
    const task = input.task;
    const payload = task.payload ?? {};
    const prompt = typeof payload.prompt === "string" ? payload.prompt.slice(0, 4000) : null;
    const negativePrompt = typeof payload.negativePrompt === "string" ? payload.negativePrompt.slice(0, 4000) : null;
    const row = await prisma.aIGeneration.create({
      data: {
        userId: input.userId,
        projectId: input.projectId ?? null,
        taskType: toGenerationTaskType(task.type),
        provider: input.provider,
        model: input.model,
        status: input.status,
        prompt,
        negativePrompt,
        inputRefs: json({
          ...pickRefs(payload),
          params: task.params ?? {},
          capability: task.capability,
        }),
        metadata: json(task.metadata),
        startedAt: new Date(),
      },
    });
    return { id: row.id };
  },

  async updateGeneration(id: string, data: GenerationUpdateInput) {
    await prisma.aIGeneration.update({
      where: { id },
      data: {
        status: data.status,
        provider: data.provider,
        model: data.model,
        resultRefs: json(data.resultRefs),
        errorMessage: data.errorMessage,
        costCredits: data.costCredits ?? undefined,
        durationMs: data.durationMs ?? undefined,
        completedAt: data.completedAt ?? undefined,
      },
    });
  },

  async createProviderLog(input: ProviderLogInput) {
    await prisma.providerLog.create({
      data: {
        userId: input.userId,
        projectId: input.projectId ?? null,
        aiGenerationId: input.aiGenerationId ?? null,
        provider: input.provider,
        model: input.model,
        taskType: toGenerationTaskType(input.taskType as AiTaskType),
        status: input.status,
        requestSummary: json(input.requestSummary),
        responseSummary: json(input.responseSummary),
        durationMs: input.durationMs ?? undefined,
        errorMessage: input.errorMessage,
        requestRef: input.providerRequestId ?? undefined,
      },
    });
  },

  async getUserPlan(userId: string) {
    const sub = await prisma.subscription.findUnique({ where: { userId }, select: { plan: true } });
    return sub ? (sub.plan as "FREE" | "PRO" | "STUDIO" | "TEAM") : null;
  },
};
