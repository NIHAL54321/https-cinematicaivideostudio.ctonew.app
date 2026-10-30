/**
 * THE CREDIT LEDGER — three invariants, and the only way to write to it.
 * (Phase 8, block 5)
 *
 * 1. A BALANCE IS DERIVED, NEVER STORED. There is no balance column in the
 *    schema and no `balance` field on a row. `deriveBalance()` sums the ledger
 *    rows on every read, so a balance that disagrees with the rows is not
 *    representable.
 *
 * 2. A SPEND CANNOT TAKE A BALANCE BELOW ZERO. `postSpend()` reads the rows and
 *    refuses — with `LedgerError("negative_balance")` — before anything is
 *    appended. The read and the append happen inside `store.runExclusive()`,
 *    which on Postgres takes an advisory lock on the account, so two concurrent
 *    spends cannot both see the same balance.
 *
 * 3. A LEDGER ROW CANNOT EXIST WITHOUT ITS CAUSE. A SPEND must name the
 *    `usageEventId` that caused it; every row must carry a non-blank reason.
 *    Both are also CHECK constraints in the database, so a write that bypasses
 *    this module is refused too.
 *
 * APPEND-ONLY is a property of the interface, not a convention: `LedgerScope`
 * exposes `readEntries` and `appendEntry` and NOTHING ELSE. There is no update
 * and no delete to call. A guard test fails the build if a mutation path on
 * either table appears anywhere in the source, and the migration installs
 * triggers that make Postgres refuse UPDATE and DELETE as well.
 *
 * A correction is therefore a NEW row: `postAdjust()` with a positive or
 * negative amount and its own reason. Nothing is rewritten.
 */
import type { LedgerEntryInput, LedgerEntryRecord, LedgerKind } from "./types";

export type LedgerErrorCode =
  | "negative_balance"
  | "missing_cause"
  | "blank_reason"
  | "bad_amount"
  | "unknown_usage_event";

export class LedgerError extends Error {
  readonly code: LedgerErrorCode;
  constructor(code: LedgerErrorCode, message: string) {
    super(message);
    this.name = "LedgerError";
    this.code = code;
  }
}

/**
 * The only operations the ledger offers. Note what is ABSENT: no update, no
 * delete, no upsert, no `setBalance`. That absence is the append-only rule.
 */
export interface LedgerScope {
  readEntries(userId: string): Promise<LedgerEntryRecord[]>;
  appendEntry(input: LedgerEntryInput): Promise<LedgerEntryRecord>;
}

/**
 * A scope plus a way to run a read-then-append atomically. The Prisma store
 * implements `runExclusive` with a transaction and `pg_advisory_xact_lock`;
 * an in-memory store runs the callback directly, which is correct for a single
 * process and is what the tests use.
 */
export interface LedgerStore extends LedgerScope {
  runExclusive<T>(userId: string, fn: (scope: LedgerScope) => Promise<T>): Promise<T>;
  /**
   * True when the usage row a SPEND names exists and belongs to this account.
   * A spend whose cause cannot be found is refused rather than written with a
   * dangling reference — the foreign key would refuse it anyway, and this turns
   * that into a sentence a caller can act on.
   */
  usageEventBelongsTo?(userId: string, usageEventId: string): Promise<boolean>;
}

/* ------------------------------------------------------------------ */
/* The derivation                                                      */
/* ------------------------------------------------------------------ */

/**
 * THE BALANCE. Summed from the rows, every time. There is nothing else to read.
 */
export function deriveBalance(entries: readonly LedgerEntryRecord[]): number {
  return entries.reduce((sum, entry) => sum + entry.amount, 0);
}

export interface LedgerSummary {
  /** Sum of the rows — never a stored value. */
  balance: number;
  /** False when the account has no ledger row at all: there is no balance to report. */
  known: boolean;
  rows: number;
  grants: number;
  spends: number;
  adjustments: number;
  granted: number;
  spent: number;
  adjusted: number;
  /** One sentence a page can print, built from the numbers above. */
  sentence: string;
}

export function summariseLedger(entries: readonly LedgerEntryRecord[]): LedgerSummary {
  const grants = entries.filter((e) => e.kind === "GRANT");
  const spends = entries.filter((e) => e.kind === "SPEND");
  const adjustments = entries.filter((e) => e.kind === "ADJUST");
  const granted = grants.reduce((n, e) => n + e.amount, 0);
  const spent = spends.reduce((n, e) => n + e.amount, 0);
  const adjusted = adjustments.reduce((n, e) => n + e.amount, 0);
  const balance = deriveBalance(entries);
  const known = entries.length > 0;
  const sentence = known
    ? `${balance} credit${balance === 1 ? "" : "s"}, derived on this request as the sum of ${entries.length} ledger ` +
      `row${entries.length === 1 ? "" : "s"} (${grants.length} grant${grants.length === 1 ? "" : "s"} +${granted}, ` +
      `${spends.length} spend${spends.length === 1 ? "" : "s"} ${spent}, ${adjustments.length} adjustment` +
      `${adjustments.length === 1 ? "" : "s"} ${adjusted >= 0 ? "+" : ""}${adjusted}). No balance is stored anywhere: ` +
      "there is no column to read, so this number cannot drift from the rows it is made of."
    : "No ledger row exists for this account, so there is no balance to report. That is not a balance of zero — " +
      "zero would be a measurement, and nothing has been measured.";
  return {
    balance,
    known,
    rows: entries.length,
    grants: grants.length,
    spends: spends.length,
    adjustments: adjustments.length,
    granted,
    spent,
    adjusted,
    sentence,
  };
}

/* ------------------------------------------------------------------ */
/* The guards that run before anything is appended                     */
/* ------------------------------------------------------------------ */

export function assertReason(reason: string): void {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new LedgerError("blank_reason", "a ledger row must carry a reason: an unexplained credit movement is not auditable");
  }
}

/** The sign each kind must carry. The database has the same CHECK. */
export function assertAmount(kind: LedgerKind, amount: number): void {
  if (!Number.isInteger(amount)) {
    throw new LedgerError("bad_amount", `a ledger amount must be a whole number of credits, got ${String(amount)}`);
  }
  if (kind === "GRANT" && amount <= 0) {
    throw new LedgerError("bad_amount", `a GRANT must be positive, got ${amount}`);
  }
  if (kind === "SPEND" && amount >= 0) {
    throw new LedgerError("bad_amount", `a SPEND must be negative, got ${amount}`);
  }
  if (kind === "ADJUST" && amount === 0) {
    throw new LedgerError("bad_amount", "an ADJUST of zero would be a row that moves nothing");
  }
}

/** A SPEND must name its cause. The database has the same CHECK. */
export function assertCause(kind: LedgerKind, usageEventId: string | null | undefined): void {
  if (kind === "SPEND" && !usageEventId) {
    throw new LedgerError(
      "missing_cause",
      "a SPEND must name the usage event that caused it — a charge with no cause is refused",
    );
  }
}

/* ------------------------------------------------------------------ */
/* The three ways in                                                    */
/* ------------------------------------------------------------------ */

export interface PostResult {
  entry: LedgerEntryRecord;
  balanceBefore: number;
  balanceAfter: number;
}

export interface GrantRequest {
  userId: string;
  /** Positive magnitude, in credits. */
  credits: number;
  reason: string;
  usageEventId?: string | null;
}

/** Adds credits. A grant needs a reason just as much as a spend does. */
export async function postGrant(store: LedgerStore, req: GrantRequest): Promise<PostResult> {
  return store.runExclusive(req.userId, async (scope) => {
    const entries = await scope.readEntries(req.userId);
    const before = deriveBalance(entries);
    const amount = req.credits;
    assertReason(req.reason);
    assertAmount("GRANT", amount);
    const entry = await scope.appendEntry({
      userId: req.userId,
      kind: "GRANT",
      amount,
      reason: req.reason,
      usageEventId: req.usageEventId ?? null,
    });
    return { entry, balanceBefore: before, balanceAfter: before + amount };
  });
}

export interface SpendRequest {
  userId: string;
  /** Positive magnitude in credits; the row stores it negative. */
  credits: number;
  reason: string;
  /** The usage row that caused this spend. Required. */
  usageEventId: string;
}

/**
 * Takes credits, and REFUSES to take a balance below zero. The refusal happens
 * before the append, inside the exclusive scope, so a failed spend leaves no
 * row behind.
 */
export async function postSpend(store: LedgerStore, req: SpendRequest): Promise<PostResult> {
  return store.runExclusive(req.userId, async (scope) => {
    assertReason(req.reason);
    assertCause("SPEND", req.usageEventId);
    if (!Number.isInteger(req.credits) || req.credits <= 0) {
      throw new LedgerError("bad_amount", `a spend must be a positive whole number of credits, got ${String(req.credits)}`);
    }
    if (store.usageEventBelongsTo) {
      const ok = await store.usageEventBelongsTo(req.userId, req.usageEventId);
      if (!ok) {
        throw new LedgerError(
          "unknown_usage_event",
          `usage event ${req.usageEventId} does not exist on this account, so it cannot be the cause of a spend`,
        );
      }
    }
    const entries = await scope.readEntries(req.userId);
    const before = deriveBalance(entries);
    const after = before - req.credits;
    if (after < 0) {
      throw new LedgerError(
        "negative_balance",
        `this spend of ${req.credits} credits would take the balance from ${before} to ${after}: a balance cannot go ` +
          "below zero, so nothing was written",
      );
    }
    assertAmount("SPEND", -req.credits);
    const entry = await scope.appendEntry({
      userId: req.userId,
      kind: "SPEND",
      amount: -req.credits,
      reason: req.reason,
      usageEventId: req.usageEventId,
    });
    return { entry, balanceBefore: before, balanceAfter: after };
  });
}

export interface AdjustRequest {
  userId: string;
  /** Signed: negative corrects downwards, positive upwards. Never zero. */
  amount: number;
  reason: string;
  usageEventId?: string | null;
}

/** A correction. A NEW row — the row it corrects is never touched. */
export async function postAdjust(store: LedgerStore, req: AdjustRequest): Promise<PostResult> {
  return store.runExclusive(req.userId, async (scope) => {
    assertReason(req.reason);
    assertAmount("ADJUST", req.amount);
    const entries = await scope.readEntries(req.userId);
    const before = deriveBalance(entries);
    const after = before + req.amount;
    if (after < 0) {
      throw new LedgerError(
        "negative_balance",
        `this adjustment of ${req.amount} credits would take the balance from ${before} to ${after}: a balance cannot ` +
          "go below zero, so nothing was written",
      );
    }
    const entry = await scope.appendEntry({
      userId: req.userId,
      kind: "ADJUST",
      amount: req.amount,
      reason: req.reason,
      usageEventId: req.usageEventId ?? null,
    });
    return { entry, balanceBefore: before, balanceAfter: after };
  });
}
