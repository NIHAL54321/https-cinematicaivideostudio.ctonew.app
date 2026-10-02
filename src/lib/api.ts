import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Shared helpers for API route handlers.
 *
 * - ApiError: an error with an HTTP status + machine-readable code. Route
 *   handlers `throw new ApiError(...)` and wrap their body in
 *   `handleApiError` via try/catch (or let a helper do it).
 * - requireApiUser(): resolves the signed-in user from the session cookie,
 *   throwing 401 for anonymous callers. Every tenant-scoped query starts
 *   here — a userId is ALWAYS part of the where clause.
 */

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, message: string, code = "error") {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

export async function requireApiUser(): Promise<string> {
  const session = await getSession();
  if (!session) throw new ApiError(401, "Authentication required.", "unauthenticated");
  return session.userId;
}

/** Throws 429 when the caller exceeds `limit` requests per minute for a scope. */
export async function apiRateLimit(userId: string, scope: string, limit: number): Promise<void> {
  const rl = await rateLimit(`${scope}:${userId}`, limit, 60_000);
  if (!rl.ok) {
    throw new ApiError(429, "Too many requests. Try again shortly.", "rate_limited");
  }
}

export function clientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

/** Reads and JSON-parses a request body. Throws 400 on malformed JSON. */
export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw new ApiError(400, "Invalid request body.", "bad_json");
  }
}

export function ok(data: unknown, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function apiError(err: unknown): NextResponse {
  if (err instanceof ApiError) {
    return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
  }
  console.error("[api] unhandled error:", err);
  return NextResponse.json({ error: "Something went wrong.", code: "internal" }, { status: 500 });
}

/** Wraps a handler: resolves the user, runs the callback, maps errors. */
export function withApiUser<T extends NextResponse>(
  fn: (userId: string) => Promise<T>,
): Promise<NextResponse> {
  return requireApiUser().then(fn).catch(apiError);
}
