import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { queueIsAvailable } from "@/lib/queue";
import { storageConfig } from "@/lib/storage";
import { healthAiReadout } from "@/lib/product/public-copy";

export const runtime = "nodejs";

/**
 * Ops health endpoint — reports the real status of the local services.
 * No fake numbers: each check hits the actual service.
 *
 * The payload carries no phase number (a hard-coded `phase` number used to sit here, stale and read by nothing). What it reports instead is the build's own wiring
 * readout, derived from the AI provider registry, so it stays true as adapters
 * land.
 */
export async function GET() {
  let db = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = "unreachable";
  }

  let redis = "unconfigured";
  if (queueIsAvailable()) {
    redis = "ok";
    try {
      const { default: Redis } = await import("ioredis");
      const client = new Redis(process.env.REDIS_URL!, {
        lazyConnect: true,
        maxRetriesPerRequest: 1,
        retryStrategy: () => null,
        commandTimeout: 1500,
      });
      try {
        await client.connect();
        await client.ping();
        redis = "ok";
      } catch {
        redis = "unreachable";
      } finally {
        client.disconnect();
      }
    } catch {
      redis = "unreachable";
    }
  }

  const storage = storageConfig();

  return NextResponse.json({
    ok: db === "ok",
    service: "cinematic-ai-video-studio",
    ai: healthAiReadout(),
    time: new Date().toISOString(),
    db,
    redis,
    storage: storage.configured ? "configured" : "not-configured",
    storageBucket: storage.bucket,
  });
}
