import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, hashPassword, publicUser, verifyPassword, SESSION_COOKIE } from "@/lib/auth";
import { env } from "@/lib/env";
import { rateLimit, rateLimitHeaders } from "@/lib/rate-limit";

export const runtime = "nodejs";

/**
 * A real scrypt hash of a random string, computed once per process. It is only
 * ever passed to verifyPassword() so that a sign-in for an address with no
 * account costs the same KDF work as one for an address that has an account.
 */
let decoyHash: string | null = null;
async function decoyPasswordHash(): Promise<string> {
  if (!decoyHash) decoyHash = await hashPassword(`decoy-${Date.now()}-${Math.random()}`);
  return decoyHash;
}

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);

  const rlIp = await rateLimit(`signin:ip:${ip}`, 20, 60 * 1000);
  if (!rlIp.ok) {
    return NextResponse.json(
      { error: "Too many sign-in attempts. Try again shortly." },
      { status: 429, headers: rateLimitHeaders(rlIp) },
    );
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!email || !password) {
    return NextResponse.json({ error: "Email and password are required." }, { status: 400 });
  }

  const rlEmail = await rateLimit(`signin:email:${email}`, 10, 60 * 1000);
  if (!rlEmail.ok) {
    return NextResponse.json(
      { error: "Too many attempts for this account. Try again shortly." },
      { status: 429, headers: rateLimitHeaders(rlEmail) },
    );
  }

  const user = await prisma.user.findUnique({ where: { email } });
  // The same work is done whether or not the account exists. The wording was
  // already identical, but the KDF only ran for a real account, so an existing
  // address took ~50 ms longer than an imaginary one — a timing oracle that
  // says "this account exists" without saying a word. Measured by
  // scripts/security/probe.ts, which compares the medians of both cases.
  const storedHash = user?.passwordHash ?? (await decoyPasswordHash());
  const passwordOk = await verifyPassword(password, storedHash);
  // Same generic message whether the account exists or not — no user enumeration.
  if (!user || !passwordOk) {
    return NextResponse.json({ error: "Invalid email or password." }, { status: 401 });
  }

  const { token, expiresAt } = await createSession(user.id, {
    userAgent: req.headers.get("user-agent") ?? undefined,
    ip,
  });

  const res = NextResponse.json({ user: publicUser(user) });
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.cookieSecure,
    path: "/",
    expires: expiresAt,
  });
  return res;
}
