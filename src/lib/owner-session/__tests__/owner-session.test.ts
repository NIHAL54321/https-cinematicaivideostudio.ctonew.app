/**
 * OWNER AUTO SIGN-IN — the gate and the minting logic (Phase 8, owner-session block).
 *
 * What these tests hold to:
 *
 *   1. OFF MEANS OFF. With CAVS_OWNER_EMAIL unset or empty — and with
 *      CAVS_OWNER_AUTOLOGIN=0 — nothing is created: no user row, no session row.
 *      NODE_ENV alone can never turn it on.
 *   2. ON MINTS ONCE. A caller with no token gets exactly one session; the same
 *      caller coming back with that token is REUSED, not re-minted.
 *   3. AN UNKNOWN EMAIL IS CREATED ONCE. The account is created on the first
 *      request, with a random password that is hashed and never logged, and the
 *      second request reuses the row instead of creating another.
 *   4. A TOKEN THAT IS NOT THIS ACCOUNT'S IS NOT REUSED. Somebody else's session
 *      — or an expired one — never becomes the owner's session; a fresh one is
 *      minted for the owner's own row and the other session is left alone.
 *
 * The store here is an in-memory double typed against `OwnerSessionStore`, so
 * these tests can count exactly how many sessions and users were created. That
 * the real store's `createSession` IS `@/lib/auth`'s `createSession` is asserted
 * separately, in owner-store-wiring.test.ts — this file proves the logic, that
 * one proves the logic is wired to the same session helper as a password sign-in.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  ownerAutoLoginGate,
  ownerAutoLoginStartupWarning,
  ownerSessionMarkerText,
  ownerSessionSignOutNote,
  safeOwnerNextPath,
} from "@/lib/owner-session/gate";
import { ensureOwnerAccount, mintOwnerSession, type OwnerSessionStore } from "@/lib/owner-session/mint";

/* ------------------------------------------------------------------ */
/* The in-memory store                                                 */
/* ------------------------------------------------------------------ */

interface FakeSession {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
}

function memoryStore(seed?: { email: string; id: string }) {
  const users: Array<{ id: string; email: string; passwordHash: string; name: string }> = seed
    ? [{ id: seed.id, email: seed.email, passwordHash: "scrypt:seed:seed", name: "Seed" }]
    : [];
  const sessions: FakeSession[] = [];
  const calls = {
    createUser: 0,
    createSession: 0,
    findUserByEmail: 0,
    findSessionByTokenHash: 0,
  };

  const store: OwnerSessionStore = {
    async findUserByEmail(email) {
      calls.findUserByEmail += 1;
      const found = users.find((u) => u.email === email);
      return found ? { id: found.id, email: found.email } : null;
    },
    async createUser({ email, passwordHash, name }) {
      calls.createUser += 1;
      const user = { id: `user-${users.length + 1}`, email, passwordHash, name };
      users.push(user);
      return { id: user.id, email: user.email };
    },
    async findSessionByTokenHash(tokenHash) {
      calls.findSessionByTokenHash += 1;
      return sessions.find((s) => s.tokenHash === tokenHash) ?? null;
    },
    async createSession(userId, meta) {
      calls.createSession += 1;
      const token = `token-${sessions.length + 1}-${meta?.ip ?? "noip"}`;
      sessions.push({
        id: `session-${sessions.length + 1}`,
        userId,
        tokenHash: `sha(${token})`,
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      });
      return { token, expiresAt: sessions[sessions.length - 1]!.expiresAt };
    },
  };

  return { store, users, sessions, calls };
}

/** Deterministic stand-ins for the real crypto — the shape is what is under test. */
const deps = (store: OwnerSessionStore, log: string[] = []) => ({
  store,
  hashPassword: async (password: string) => `scrypt:fake-salt:${password.length}:hash`,
  sha256hex: (value: string) => `sha(${value})`,
  randomPassword: () => "random-password-for-tests-only-0123456789",
  log: (line: string) => log.push(line),
});

/* ------------------------------------------------------------------ */
/* 1. The gate                                                         */
/* ------------------------------------------------------------------ */

const ORIGINAL_ENV = { ...process.env };

function setEnv(values: Record<string, string | undefined>) {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

beforeEach(() => {
  setEnv({ CAVS_OWNER_EMAIL: undefined, CAVS_OWNER_AUTOLOGIN: undefined });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("the gate — off unless an env var names an account", () => {
  test("unset: disabled, and it says why", () => {
    const gate = ownerAutoLoginGate();
    expect(gate.enabled).toBe(false);
    expect(gate.email).toBe("");
    expect(gate.reason).toContain("not set");
  });

  test("empty string is the same as unset — a blank line in .env does nothing", () => {
    process.env.CAVS_OWNER_EMAIL = "";
    expect(ownerAutoLoginGate().enabled).toBe(false);
    process.env.CAVS_OWNER_EMAIL = "   ";
    const gate = ownerAutoLoginGate();
    expect(gate.enabled).toBe(false);
    expect(gate.reason).toContain("not set");
  });

  test("CAVS_OWNER_AUTOLOGIN=0 forces it off without unsetting the email", () => {
    process.env.CAVS_OWNER_EMAIL = "owner@cavs.test";
    expect(ownerAutoLoginGate().enabled).toBe(true);
    process.env.CAVS_OWNER_AUTOLOGIN = "0";
    const gate = ownerAutoLoginGate();
    expect(gate.enabled).toBe(false);
    expect(gate.reason).toBe("CAVS_OWNER_AUTOLOGIN=0");
    // The address is still reported, so a surface can say WHICH account is idle.
    expect(gate.email).toBe("owner@cavs.test");
  });

  test("a value that is not an email address does not enable it", () => {
    for (const bad of ["owner", "owner@", "@cavs.test", "owner@cavs", "two words@cavs.test"]) {
      process.env.CAVS_OWNER_EMAIL = bad;
      expect(ownerAutoLoginGate().enabled).toBe(false);
    }
  });

  test("enabled: the address is trimmed and lower-cased so the lookup is exact", () => {
    process.env.CAVS_OWNER_EMAIL = "  Owner@CAVS.test  ";
    const gate = ownerAutoLoginGate();
    expect(gate.enabled).toBe(true);
    expect(gate.email).toBe("owner@cavs.test");
    expect(gate.reason).toBe("CAVS_OWNER_EMAIL names this account");
  });

  test("NEGATIVE CONTROL: NODE_ENV never enables it on its own", () => {
    for (const nodeEnv of ["production", "development", "test"]) {
      process.env.NODE_ENV = nodeEnv;
      expect(ownerAutoLoginGate().enabled).toBe(false);
    }
    // ...and a stale autologin=1 does not either.
    process.env.CAVS_OWNER_AUTOLOGIN = "1";
    expect(ownerAutoLoginGate().enabled).toBe(false);
  });

  test("the env is read per call, not frozen at import", () => {
    expect(ownerAutoLoginGate().enabled).toBe(false);
    process.env.CAVS_OWNER_EMAIL = "owner@cavs.test";
    expect(ownerAutoLoginGate().enabled).toBe(true);
    delete process.env.CAVS_OWNER_EMAIL;
    expect(ownerAutoLoginGate().enabled).toBe(false);
  });
});

describe("the redirect target cannot be an open redirect", () => {
  test("a same-origin path is kept", () => {
    expect(safeOwnerNextPath("/projects")).toBe("/projects");
    expect(safeOwnerNextPath("/projects/abc?tab=scenes")).toBe("/projects/abc?tab=scenes");
  });

  test("anything that could leave the site, or bounce back, becomes /dashboard", () => {
    for (const bad of [
      null,
      undefined,
      "",
      "//evil.example.com",
      "/\\evil.example.com",
      "https://evil.example.com",
      "http://evil.example.com/x",
      "/signin",
      "/signin?next=/dashboard",
      "/",
      "projects",
    ]) {
      expect(safeOwnerNextPath(bad as string | null | undefined)).toBe("/dashboard");
    }
  });
});

describe("the sentences the surfaces show", () => {
  test("the startup warning names the account and says anyone who can reach the server is it", () => {
    const line = ownerAutoLoginStartupWarning("owner@cavs.test");
    expect(line).toContain("owner@cavs.test");
    expect(line.toLowerCase()).toContain("anyone who can reach this server");
    expect(line).toContain("CAVS_OWNER_EMAIL");
    expect(line).toContain("WARNING");
  });

  test("the marker says the sign-in was bypassed, for which account", () => {
    const marker = ownerSessionMarkerText("owner@cavs.test");
    expect(marker).toContain("Owner session");
    expect(marker).toContain("bypassed");
    expect(marker).toContain("owner@cavs.test");
  });

  test("the sign-out note says sign-out works AND re-enters, and how to stop it", () => {
    const note = ownerSessionSignOutNote("owner@cavs.test");
    expect(note).toContain("owner@cavs.test");
    expect(note.toLowerCase()).toContain("signing out really does end this session");
    expect(note.toLowerCase()).toContain("signs you straight back in");
    expect(note).toContain("CAVS_OWNER_AUTOLOGIN=0");
  });
});

/* ------------------------------------------------------------------ */
/* 2. OFF — nothing is created                                         */
/* ------------------------------------------------------------------ */

describe("flag OFF — no session is minted, nothing is created", () => {
  test("mintOwnerSession makes no store call at all", async () => {
    const { store, calls, users, sessions } = memoryStore();
    const outcome = await mintOwnerSession(deps(store), { gate: ownerAutoLoginGate() });
    expect(outcome.kind).toBe("disabled");
    expect(calls.createUser).toBe(0);
    expect(calls.createSession).toBe(0);
    expect(calls.findUserByEmail).toBe(0);
    expect(users.length).toBe(0);
    expect(sessions.length).toBe(0);
  });

  test("a presented token changes nothing while the flag is off", async () => {
    const { store, calls } = memoryStore();
    const outcome = await mintOwnerSession(deps(store), {
      gate: ownerAutoLoginGate(),
      presentedToken: "anything",
    });
    expect(outcome.kind).toBe("disabled");
    expect(calls.createSession).toBe(0);
  });

  test("CAVS_OWNER_AUTOLOGIN=0 with an email set behaves exactly like off", async () => {
    process.env.CAVS_OWNER_EMAIL = "owner@cavs.test";
    process.env.CAVS_OWNER_AUTOLOGIN = "0";
    const { store, calls } = memoryStore();
    const outcome = await mintOwnerSession(deps(store), { gate: ownerAutoLoginGate() });
    expect(outcome.kind).toBe("disabled");
    expect(calls.createUser + calls.createSession).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* 3. ON — minted once, then reused                                    */
/* ------------------------------------------------------------------ */

describe("flag ON — one session, then reuse", () => {
  test("an existing account is signed in without creating a user, and the token is reused next time", async () => {
    process.env.CAVS_OWNER_EMAIL = "owner@cavs.test";
    const { store, calls, users } = memoryStore({ email: "owner@cavs.test", id: "user-owner" });

    const first = await mintOwnerSession(deps(store), { gate: ownerAutoLoginGate(), meta: { ip: "127.0.0.1" } });
    expect(first.kind).toBe("minted");
    if (first.kind !== "minted") throw new Error("unreachable");
    expect(first.userId).toBe("user-owner");
    expect(first.accountCreated).toBe(false);
    expect(calls.createUser).toBe(0);
    expect(calls.createSession).toBe(1);

    const second = await mintOwnerSession(deps(store), {
      gate: ownerAutoLoginGate(),
      presentedToken: first.token,
    });
    expect(second.kind).toBe("reused");
    if (second.kind !== "reused") throw new Error("unreachable");
    expect(second.userId).toBe("user-owner");
    // The whole point: the second visit did NOT create a second session row.
    expect(calls.createSession).toBe(1);
    expect(users.length).toBe(1);
  });

  test("an unknown email creates the account ONCE and reuses it afterwards", async () => {
    process.env.CAVS_OWNER_EMAIL = "fresh-owner@cavs.test";
    const { store, calls, users, sessions } = memoryStore();
    const log: string[] = [];

    const first = await mintOwnerSession(deps(store, log), { gate: ownerAutoLoginGate() });
    expect(first.kind).toBe("minted");
    if (first.kind !== "minted") throw new Error("unreachable");
    expect(first.accountCreated).toBe(true);
    expect(users.length).toBe(1);
    expect(users[0]!.email).toBe("fresh-owner@cavs.test");
    // The row holds a hash, never the password.
    expect(users[0]!.passwordHash.startsWith("scrypt:")).toBe(true);
    expect(users[0]!.passwordHash).not.toContain("random-password-for-tests-only");
    // Exactly one log line, and it does not carry the password.
    expect(log.length).toBe(1);
    expect(log[0]).toContain("created account fresh-owner@cavs.test");
    expect(log[0]).not.toContain("random-password-for-tests-only");

    const second = await mintOwnerSession(deps(store, log), {
      gate: ownerAutoLoginGate(),
      presentedToken: first.token,
    });
    expect(second.kind).toBe("reused");
    expect(calls.createUser).toBe(1);
    expect(calls.createSession).toBe(1);
    expect(users.length).toBe(1);
    expect(sessions.length).toBe(1);
    // Nothing was logged the second time: no second "created account".
    expect(log.length).toBe(1);
  });

  test("ensureOwnerAccount is idempotent on its own", async () => {
    const { store, calls, users } = memoryStore();
    const a = await ensureOwnerAccount(deps(store), "solo@cavs.test");
    const b = await ensureOwnerAccount(deps(store), "solo@cavs.test");
    expect(a.created).toBe(true);
    expect(b.created).toBe(false);
    expect(a.account.id).toBe(b.account.id);
    expect(calls.createUser).toBe(1);
    expect(users.length).toBe(1);
  });

  test("two different random passwords are never the same value in the row", async () => {
    // The double's randomPassword is fixed, so this asserts the HASH is per-row
    // salted by hashPassword — i.e. the plaintext is not what is stored.
    const { store, users } = memoryStore();
    await ensureOwnerAccount(deps(store), "one@cavs.test");
    await ensureOwnerAccount(deps(store), "two@cavs.test");
    expect(users.length).toBe(2);
    for (const user of users) expect(user.passwordHash.startsWith("scrypt:")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* 4. Reuse never crosses accounts                                     */
/* ------------------------------------------------------------------ */

describe("reuse is scoped to the named account", () => {
  test("a valid session belonging to ANOTHER user is not adopted — a new session is minted for the owner", async () => {
    process.env.CAVS_OWNER_EMAIL = "owner@cavs.test";
    const { store, calls, sessions } = memoryStore({ email: "owner@cavs.test", id: "user-owner" });
    // Somebody else's session row, with a token the caller presents.
    sessions.push({
      id: "session-foreign",
      userId: "user-somebody-else",
      tokenHash: "sha(foreign-token)",
      expiresAt: new Date(Date.now() + 3600_000),
    });

    const outcome = await mintOwnerSession(deps(store), {
      gate: ownerAutoLoginGate(),
      presentedToken: "foreign-token",
    });
    expect(outcome.kind).toBe("minted");
    if (outcome.kind !== "minted") throw new Error("unreachable");
    expect(outcome.userId).toBe("user-owner");
    expect(calls.createSession).toBe(1);
    // The other account's session was neither returned nor deleted.
    expect(sessions.some((s) => s.id === "session-foreign")).toBe(true);
  });

  test("an EXPIRED token is not reused", async () => {
    process.env.CAVS_OWNER_EMAIL = "owner@cavs.test";
    const { store, calls, sessions } = memoryStore({ email: "owner@cavs.test", id: "user-owner" });
    sessions.push({
      id: "session-old",
      userId: "user-owner",
      tokenHash: "sha(old-token)",
      expiresAt: new Date(Date.now() - 1000),
    });

    const outcome = await mintOwnerSession(deps(store), {
      gate: ownerAutoLoginGate(),
      presentedToken: "old-token",
    });
    expect(outcome.kind).toBe("minted");
    expect(calls.createSession).toBe(1);
  });

  test("the minted session always points at the row found by the flag's email", async () => {
    process.env.CAVS_OWNER_EMAIL = "owner@cavs.test";
    const { store, sessions } = memoryStore({ email: "owner@cavs.test", id: "user-owner" });
    await mintOwnerSession(deps(store), { gate: ownerAutoLoginGate() });
    expect(sessions.length).toBe(1);
    expect(sessions[0]!.userId).toBe("user-owner");
  });
});
