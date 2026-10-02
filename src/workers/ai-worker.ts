import { Worker } from "bullmq";
import { prisma } from "@/lib/db";
import { getQueueConnection, QUEUES } from "@/lib/queue";
import { isProviderConfigured, type ProviderName } from "@/lib/env";

/**
 * AI Model Orchestrator — worker skeleton (Phase 3 hook).
 *
 * This worker consumes `ai-generation` jobs. In Phase 1 there are no
 * providers wired, so its ONLY behavior is to mark the corresponding
 * AIGeneration record FAILED with an honest "Provider Not Connected" error.
 * It never simulates generation.
 *
 * In a later phase this becomes the A → B → C → D fallback loop:
 *   1. load the AIGeneration row (taskType, prompt, inputRefs)
 *   2. for each configured provider in priority order: call it
 *   3. on success: create Asset + kind extension, update resultRefs,
 *      write a ProviderLog, mark SUCCEEDED
 *   4. on failure: try next provider; if all fail, mark FAILED + ProviderLog
 *
 * Run with:  bun run tsx src/workers/ai-worker.ts   (add tsx as a dev dep)
 */

export interface AiGenerationJobData {
  generationId: string;
}

export async function processAiGeneration(jobData: AiGenerationJobData): Promise<{ status: string }> {
  const generation = await prisma.aIGeneration.findUnique({
    where: { id: jobData.generationId },
  });
  if (!generation) throw new Error(`AIGeneration ${jobData.generationId} not found`);

  if (generation.status === "SUCCEEDED" || generation.status === "FAILED") {
    return { status: generation.status }; // already terminal — no double work
  }

  const provider = generation.provider as ProviderName;
  if (!isProviderConfigured(provider)) {
    const message = `Provider Not Connected: ${provider} (set ${provider.toUpperCase()}_API_KEY or equivalent env var)`;
    await prisma.aIGeneration.update({
      where: { id: generation.id },
      data: { status: "FAILED", errorMessage: message, completedAt: new Date() },
    });
    await prisma.providerLog.create({
      data: {
        userId: generation.userId,
        projectId: generation.projectId,
        aiGenerationId: generation.id,
        provider: generation.provider,
        model: generation.model,
        taskType: generation.taskType,
        status: "FAILED",
        errorMessage: message,
        durationMs: 0,
      },
    });
    return { status: "FAILED" };
  }

  // Phase 3: real provider call goes here (A → B → C → D fallback).
  throw new Error("Provider wiring lands in a later phase — nothing was simulated.");
}

export function startAiWorker() {
  if (!process.env.REDIS_URL) {
    console.warn("[ai-worker] REDIS_URL not set — worker not started.");
    return null;
  }
  const worker = new Worker<AiGenerationJobData>(
    QUEUES.ai,
    async (job) => processAiGeneration(job.data),
    { connection: getQueueConnection() },
  );
  worker.on("failed", (job, err) => {
    console.error(`[ai-worker] job ${job?.id} failed:`, err.message);
  });
  return worker;
}
