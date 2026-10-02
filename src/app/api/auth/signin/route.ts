import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, publicUser, verifyPassword, SESSION_COOKIE } from "@/lib/auth";
import { env } from "@/lib/env";
import { rateLimit, rateLimitHeaders } from "@/lib/rate-limit";

export const runtime = "nodejs";

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
  // Same generic message whether the account exists or not — no user enumeration.
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
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
