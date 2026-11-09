/**
 * OWNER AUTO SIGN-IN — the Prisma-backed store (Phase 8, owner-session block).
 *
 * Every method here is the app's own existing call. `createSession` is not a
 * re-implementation: it is `@/lib/auth`'s `createSession`, the exact function the
 * sign-in route uses, so the token hashing (SHA-256 of a 32-byte random token,
 * stored as `tokenHash`), the TTL (`SESSION_TTL_DAYS`) and the `Session` row are
 * the same ones a password sign-in produces. `owner-store-wiring.test.ts` asserts
 * that identity, because "the same helper" is a claim that should fail loudly if
 * someone ever replaces it with a lookalike.
 */
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { createSession, hashPassword, sha256hex } from "@/lib/auth";
import type { OwnerSessionDeps, OwnerSessionStore } from "./mint";

export const prismaOwnerStore: OwnerSessionStore = {
  findUserByEmail(email) {
    return prisma.user.findUnique({ where: { email }, select: { id: true, email: true } });
  },
  createUser({ email, passwordHash, name }) {
    return prisma.user.create({
      data: { email, passwordHash, name, role: "USER" },
      select: { id: true, email: true },
    });
  },
  findSessionByTokenHash(tokenHash) {
    return prisma.session.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, expiresAt: true },
    });
  },
  // Not a wrapper and not a lookalike: the same function object the sign-in
  // route calls. `owner-store-wiring.test.ts` compares the references.
  createSession,
};

export const ownerSessionDeps: OwnerSessionDeps = {
  store: prismaOwnerStore,
  hashPassword,
  sha256hex,
  randomPassword: () => randomBytes(32).toString("base64url"),
  log: (line) => console.log(line),
};
