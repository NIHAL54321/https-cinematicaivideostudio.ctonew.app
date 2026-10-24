import { Queue } from "bullmq";
import IORedis from "ioredis";
import { env } from "@/lib/env";

/**
 * Redis + BullMQ queue foundation.
 *
 * Three queues are declared up front so every phase builds on them:
 *   - ai:       AI Model Orchestrator work (script, image, video, voice, music…)
 *   - render:   long-form / short-form rendering jobs
 *   - exports:  platform exports
 *
 * When REDIS_URL is unset, queues are unavailable and callers should surface a
 * clear "Queue Not Connected" state (mirroring Provider Not Connected) instead
 * of pretending work was queued.
 */

export const QUEUES = {
  ai: "ai-generation",
  render: "rendering",
  export: "exports",
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

export function queueIsAvailable(): boolean {
  return Boolean(env.redisUrl);
}

let connection: IORedis | null = null;

/** One shared ioredis connection for all BullMQ queues/workers. */
export function getQueueConnection(): IORedis {
  if (!env.redisUrl) throw new Error("REDIS_URL is not set — queues unavailable.");
  if (!connection) {
    connection = new IORedis(env.redisUrl, {
      maxRetriesPerRequest: null, // BullMQ requirement
      enableReadyCheck: false,
    });
  }
  return connection;
}

/**
 * True once a real Redis connection object exists in this process.
 *
 * Exists so a test can prove that importing a module did NOT open a connection:
 * an import that boots a worker would flip this to true as a side effect.
 */
export function queueConnectionOpened(): boolean {
  return connection !== null;
}

const queueCache = new Map<QueueName, Queue>();

export function getQueue<T = any>(name: QueueName): Queue<T, any, any> {
  const existing = queueCache.get(name) as Queue<T, any, any> | undefined;
  if (existing) return existing;
  const q = new Queue<T, any, any>(name, { connection: getQueueConnection() });
  queueCache.set(name, q);
  return q;
}

export async function enqueue(
  name: QueueName,
  jobName: string,
  data: unknown,
  opts?: { jobId?: string; delayMs?: number; attempts?: number },
): Promise<{ queued: true; jobId?: string } | { queued: false; reason: string }> {
  if (!queueIsAvailable()) {
    return { queued: false, reason: "Queue Not Connected: REDIS_URL is not configured." };
  }
  const job = await getQueue(name).add(jobName, data, {
    jobId: opts?.jobId,
    delay: opts?.delayMs,
    attempts: opts?.attempts ?? 3,
    removeOnComplete: { age: 60 * 60 * 24 * 7 },
    removeOnFail: { age: 60 * 60 * 24 * 14 },
  });
  return { queued: true, jobId: job.id };
}
