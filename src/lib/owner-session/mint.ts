/**
 * OWNER AUTO SIGN-IN — the minting logic (Phase 8, owner-session block).
 *
 * WHAT THIS FILE DOES, IN ONE SENTENCE: given the gate and an optional token the
 * caller already presented, it makes sure the named account EXISTS and that the
 * caller holds a REAL session for it — through the same `createSession` the
 * sign-in route uses, so the hashing, the TTL, the cookie flags and the `Session`
 * row are identical to a password sign-in.
 *
 * WHY IT TAKES ITS DEPENDENCIES AS ARGUMENTS: this file imports no database, no
 * `next/headers` and no crypto, so the unit tests drive it with an in-memory
 * store and observe exactly what it did (how many sessions it created, whether
 * it created the account once or twice). The Prisma-backed store is a separate
 * module, `./store.ts`, whose `createSession` IS `@/lib/auth`'s `createSession` —
 * a test asserts that identity, so this cannot drift into "a second way to make
 * a session".
 *
 * THE PASSWORD ON A CREATED ACCOUNT IS RANDOM AND IS THROWN AWAY. The account is
 * created because a route needs a user row to hang a session on, not because
 * anybody should be able to sign into it with a password. The plaintext never
 * leaves the function, is never logged and is not stored; the row holds only its
 * scrypt hash. If the owner wants to sign in manually they can reset it.
 */

import type { OwnerGate } from "./gate";

export interface OwnerAccount {
  id: string;
  email: string;
}

export interface OwnerSessionRecord {
  id: string;
  userId: string;
  expiresAt: Date;
}

export interface OwnerSessionMeta {
  userAgent?: string;
  ip?: string;
}

/**
 * The five things this logic needs from the outside world. Every one of them is
 * the same call the rest of the app makes; none is a shortcut.
 */
export interface OwnerSessionStore {
  findUserByEmail(email: string): Promise<OwnerAccount | null>;
  createUser(input: { email: string; passwordHash: string; name: string }): Promise<OwnerAccount>;
  findSessionByTokenHash(tokenHash: string): Promise<OwnerSessionRecord | null>;
  createSession(userId: string, meta?: OwnerSessionMeta): Promise<{ token: string; expiresAt: Date }>;
}

export interface OwnerSessionDeps {
  store: OwnerSessionStore;
  hashPassword(password: string): Promise<string>;
  sha256hex(value: string): string;
  /** Cryptographically random, URL-safe, never logged. Injectable for tests. */
  randomPassword(): string;
  log?: (line: string) => void;
}

export type OwnerSessionOutcome =
  /** The flag is off: nothing was created, nothing was signed in. */
  | { kind: "disabled"; reason: string }
  /** The caller already held a valid session for the named account. */
  | { kind: "reused"; userId: string; email: string }
  /** A new session row was created and the caller must receive its token. */
  | { kind: "minted"; userId: string; email: string; token: string; expiresAt: Date; accountCreated: boolean };

/**
 * Makes sure a user row exists for the address the flag names.
 *
 * The create is not a "first user" fallback — it is this ONE address, looked up
 * by its unique email, and the row it creates is the row the session will point
 * at. If two requests race, the loser re-reads the winner's row rather than
 * failing the request.
 */
export async function ensureOwnerAccount(
  deps: Pick<OwnerSessionDeps, "store" | "hashPassword" | "randomPassword" | "log">,
  email: string,
): Promise<{ account: OwnerAccount; created: boolean }> {
  const existing = await deps.store.findUserByEmail(email);
  if (existing) return { account: existing, created: false };

  // Random, single-use, discarded. The row gets only the scrypt hash of it.
  const password = deps.randomPassword();
  const passwordHash = await deps.hashPassword(password);
  try {
    const account = await deps.store.createUser({ email, passwordHash, name: "Owner" });
    deps.log?.(
      `[owner-session] created account ${email} for owner auto sign-in ` +
        `(password is random, was never logged, and is not derivable from anything stored)`,
    );
    return { account, created: true };
  } catch (err) {
    // A concurrent request created it between the read and the write. The unique
    // constraint on User.email is the arbiter; re-read rather than fail.
    const raced = await deps.store.findUserByEmail(email);
    if (raced) return { account: raced, created: false };
    throw err;
  }
}

/**
 * The whole decision, in one place: off means off, a valid session means reuse,
 * anything else means one new session for the named account.
 */
export async function mintOwnerSession(
  deps: OwnerSessionDeps,
  opts: { gate: OwnerGate; presentedToken?: string | null; meta?: OwnerSessionMeta },
): Promise<OwnerSessionOutcome> {
  const { gate } = opts;
  if (!gate.enabled) return { kind: "disabled", reason: gate.reason };

  const { account, created } = await ensureOwnerAccount(deps, gate.email);

  // A token the caller already holds is reused when it is genuinely valid AND
  // belongs to this account. It is never "upgraded": a token that belongs to
  // somebody else is left alone and simply not treated as this account's.
  const presented = opts.presentedToken?.trim();
  if (presented) {
    const record = await deps.store.findSessionByTokenHash(deps.sha256hex(presented));
    if (record && record.userId === account.id && record.expiresAt.getTime() > Date.now()) {
      return { kind: "reused", userId: account.id, email: account.email };
    }
  }

  const { token, expiresAt } = await deps.store.createSession(account.id, opts.meta);
  return { kind: "minted", userId: account.id, email: account.email, token, expiresAt, accountCreated: created };
}
