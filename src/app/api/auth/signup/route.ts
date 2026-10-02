import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { createSession, hashPassword, publicUser, SESSION_COOKIE } from "@/lib/auth";
import { env } from "@/lib/env";
import { rateLimit, rateLimitHeaders } from "@/lib/rate-limit";

export const runtime = "nodejs";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clientIp(req: NextRequest): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function setSessionCookie(res: NextResponse, token: string, expiresAt: Date) {
  res.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.cookieSecure,
    path: "/",
    expires: expiresAt,
  });
}

export async function POST(req: NextRequest) {
  const ip = clientIp(req);

  const rlIp = await rateLimit(`signup:ip:${ip}`, 10, 10 * 60 * 1000);
  if (!rlIp.ok) {
    return NextResponse.json(
      { error: "Too many sign-up attempts from this address. Try again later." },
      { status: 429, headers: rateLimitHeaders(rlIp) },
    );
  }

  let body: { email?: unknown; password?: unknown; name?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" ? body.name.trim().slice(0, 60) : "";

  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ error: "Password must be at least 8 characters." }, { status: 400 });
  }

  const rlEmail = await rateLimit(`signup:email:${email}`, 5, 60 * 60 * 1000);
  if (!rlEmail.ok) {
    return NextResponse.json(
      { error: "Too many sign-up attempts for this email. Try again later." },
      { status: 429, headers: rateLimitHeaders(rlEmail) },
    );
  }

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return NextResponse.json(
      { error: "An account with this email already exists. Try signing in." },
      { status: 409 },
    );
  }

  const passwordHash = await hashPassword(password);

  let user;
  try {
    user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        name: name || null,
        subscription: { create: { plan: "FREE" } },
      },
    });
  } catch (err) {
    // Unique violation race (P2002) — treat as already exists.
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "P2002") {
      return NextResponse.json(
        { error: "An account with this email already exists. Try signing in." },
        { status: 409 },
      );
    }
    throw err;
  }

  const { token, expiresAt } = await createSession(user.id, {
    userAgent: req.headers.get("user-agent") ?? undefined,
    ip,
  });

  const res = NextResponse.json({ user: publicUser(user) }, { status: 201 });
  setSessionCookie(res, token, expiresAt);
  return res;
}
