import Redis from "ioredis";
import { env } from "@/lib/env";

/**
 * Rate limiting foundation.
 *  - Redis-backed (sliding-ish fixed window via INCR + PEXPIRE) when REDIS_URL
 *    is set — shared across processes/instances.
 *  - Graceful in-memory fallback when Redis is unavailable, so API routes never
 *    fail because of the limiter.
 */

export type RateLimitResult = {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
};

let redis: Redis | null = null;
function getRedis(): Redis | null {
  if (!env.redisUrl) return null;
  if (!redis) {
    redis = new Redis(env.redisUrl, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      retryStrategy: () => null, // no reconnect storms — fall back to memory
    });
    redis.connect().catch(() => {});
  }
  return redis;
}

const memory = new Map<string, number[]>(); // key -> hit timestamps
const MEMORY_MAX_KEYS = 10_000;

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<RateLimitResult> {
  const client = getRedis();
  if (client) {
    try {
      const bucket = `rl:${key}`;
      const count = await client.incr(bucket);
      if (count === 1) await client.pexpire(bucket, windowMs);
      const ttl = await client.pttl(bucket);
      return {
        ok: count <= limit,
        limit,
        remaining: Math.max(0, limit - count),
        retryAfterSeconds: Math.max(1, Math.ceil(ttl / 1000)),
      };
    } catch {
      // Redis unreachable — fall through to memory limiter.
    }
  }

  const now = Date.now();
  const hits = (memory.get(key) ?? []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) {
    memory.set(key, hits);
    return {
      ok: false,
      limit,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - hits[0])) / 1000)),
    };
  }
  hits.push(now);
  memory.set(key, hits);
  if (memory.size > MEMORY_MAX_KEYS) {
    const oldest = memory.keys().next().value;
    if (oldest) memory.delete(oldest);
  }
  return { ok: true, limit, remaining: limit - hits.length, retryAfterSeconds: 0 };
}

export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  return {
    "X-RateLimit-Limit": String(r.limit),
    "X-RateLimit-Remaining": String(r.remaining),
    "X-RateLimit-Retry-After": String(r.retryAfterSeconds),
  };
}
