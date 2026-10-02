import { randomBytes, scrypt as scryptCb, timingSafeEqual, createHash } from "node:crypto";
import { promisify } from "node:util";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { env } from "@/lib/env";
import { SESSION_COOKIE } from "@/lib/session-cookie";

export { SESSION_COOKIE } from "@/lib/session-cookie";

const scrypt = promisify(scryptCb);
const SCRYPT_KEYLEN = 64;

// ---------------------------------------------------------------------------
// Password hashing — Node built-in scrypt (NIST-approved KDF), no native deps.
// Format: scrypt:<salt-hex>:<derived-key-hex>
// ---------------------------------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, SCRYPT_KEYLEN)) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hex] = stored.split(":");
  if (scheme !== "scrypt" || !salt || !hex) return false;
  const derived = (await scrypt(password, salt, SCRYPT_KEYLEN)) as Buffer;
  const expected = Buffer.from(hex, "hex");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

// ---------------------------------------------------------------------------
// Sessions — opaque token in an httpOnly cookie; only the SHA-256 hash of the
// token is persisted, so a DB leak cannot be replayed as cookies.
// ---------------------------------------------------------------------------

export function sha256hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function sessionTtlMs(): number {
  return env.sessionTtlDays * 24 * 60 * 60 * 1000;
}

export type SessionMeta = { userAgent?: string; ip?: string };

/** Creates a session row and returns the raw token to store in the cookie. */
export async function createSession(userId: string, meta?: SessionMeta): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionTtlMs());
  await prisma.session.create({
    data: {
      userId,
      tokenHash: sha256hex(token),
      expiresAt,
      userAgent: meta?.userAgent ?? null,
      ip: meta?.ip ?? null,
    },
  });
  return { token, expiresAt };
}

export type SessionWithUser = NonNullable<Awaited<ReturnType<typeof getSession>>>;

/** Reads the session cookie and verifies it against the DB. Null when invalid. */
export async function getSession() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: sha256hex(token) },
    include: { user: true },
  });
  if (!session) return null;

  if (session.expiresAt.getTime() < Date.now()) {
    await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    return null;
  }

  // Touch lastSeenAt (fire-and-forget, throttled by only updating every minute).
  if (!session.lastSeenAt || Date.now() - session.lastSeenAt.getTime() > 60_000) {
    prisma.session
      .update({ where: { id: session.id }, data: { lastSeenAt: new Date() } })
      .catch(() => {});
  }

  return session;
}

/** Guard for server components / layouts. Redirects to /signin when anonymous. */
export async function requireUser() {
  const session = await getSession();
  if (!session) redirect("/signin");
  return session;
}

export async function destroySession(token: string): Promise<void> {
  await prisma.session.deleteMany({ where: { tokenHash: sha256hex(token) } });
}

export function publicUser(user: { id: string; email: string; name: string | null; emailVerified: Date | null }) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    emailVerified: user.emailVerified,
  };
}
