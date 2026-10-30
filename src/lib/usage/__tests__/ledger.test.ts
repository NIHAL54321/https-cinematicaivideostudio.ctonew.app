/**
 * THE LEDGER'S THREE INVARIANTS, WITH A NEGATIVE CONTROL FOR EACH
 * (Phase 8, block 5).
 *
 * The point of this file is not that the happy path works. It is that each
 * promise the block makes FAILS when it is broken:
 *
 *   1. a balance is derived from the rows — so a store that could rewrite a row
 *      is not a store this interface allows (the interface has no update/delete),
 *      and the guard test proves the scanner that watches for one fires;
 *   2. a spend cannot take a balance below zero — the refusal throws, and no row
 *      is written by the failed attempt;
 *   3. a ledger row cannot exist without its cause — a spend with no usage event
 *      throws, and so does one naming an event that is not this account's.
 */
import { describe, expect, test } from "bun:test";
import {
  deriveBalance,
  LedgerError,
  postAdjust,
  postGrant,
  postSpend,
  summariseLedger,
  type LedgerScope,
  type LedgerStore,
} from "../ledger";
import type { LedgerEntryInput, LedgerEntryRecord } from "../types";

/** An append-only in-memory ledger. Note: no update, no delete, no upsert. */
function memoryLedger(seed: LedgerEntryRecord[] = [], knownEvents: string[] = []) {
  const entries: LedgerEntryRecord[] = [...seed];
  let nextId = 1;
  const scope: LedgerScope = {
    async readEntries(userId) {
      return entries.filter((e) => e.userId === userId);
    },
    async appendEntry(input: LedgerEntryInput) {
      const row: LedgerEntryRecord = {
        ...input,
        id: `led_${nextId++}`,
        usageEventId: input.usageEventId ?? null,
        occurredAt: input.occurredAt ?? new Date(),
      };
      entries.push(row);
      return row;
    },
  };
  const store: LedgerStore = {
    ...scope,
    async runExclusive(_userId, fn) {
      return fn(scope);
    },
    async usageEventBelongsTo(_userId, usageEventId) {
      // With no list given, every id is treated as this account's own; a test
      // that wants a foreign cause passes the ids that DO belong to it.
      return knownEvents.length === 0 ? true : knownEvents.includes(usageEventId);
    },
  };
  return { store, entries };
}

const U = "user_1";

describe("a balance is DERIVED from the ledger and never stored", () => {
  test("the balance is the sum of the rows, and no row carries a balance field", async () => {
    const { store, entries } = memoryLedger();
    await postGrant(store, { userId: U, credits: 100, reason: "development grant: no payment involved" });
    const spend = await postSpend(store, {
      userId: U,
      credits: 30,
      reason: "spend against a metered stage run",
      usageEventId: "evt_1",
    });
    expect(spend.balanceBefore).toBe(100);
    expect(spend.balanceAfter).toBe(70);
    expect(deriveBalance(entries)).toBe(70);
    for (const row of entries) {
      expect("balance" in row).toBe(false);
      expect(Object.keys(row)).not.toContain("balanceAfter");
    }
  });

  test("NEGATIVE CONTROL: the same rows with one rewritten produce a different balance — which is why the interface has no rewrite", async () => {
    const { store, entries } = memoryLedger();
    await postGrant(store, { userId: U, credits: 50, reason: "grant" });
    expect(deriveBalance(entries)).toBe(50);
    // What a mutable counter would allow, done by hand here to show what the
    // absence of an update method prevents:
    (entries[0] as LedgerEntryRecord).amount = 500;
    expect(deriveBalance(entries)).toBe(500);
    // The only defence is that no such method exists on the interface, and that
    // the database refuses it. Both are asserted: here, and in guards.test.ts.
    const surface = Object.keys(store).sort();
    expect(surface).toEqual(["appendEntry", "readEntries", "runExclusive", "usageEventBelongsTo"]);
    expect(surface).not.toContain("update");
    expect(surface).not.toContain("delete");
    expect(surface).not.toContain("upsert");
  });

  test("an account with no rows has NO balance — and the sentence says so rather than printing zero", () => {
    const summary = summariseLedger([]);
    expect(summary.known).toBe(false);
    expect(summary.sentence).toContain("not a balance of zero");
  });
});

describe("a spend cannot take a balance below zero", () => {
  test("a spend larger than the balance throws negative_balance and writes NOTHING", async () => {
    const { store, entries } = memoryLedger();
    await postGrant(store, { userId: U, credits: 10, reason: "grant" });
    const before = entries.length;
    let thrown: unknown = null;
    try {
      await postSpend(store, { userId: U, credits: 11, reason: "too much", usageEventId: "evt_1" });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(LedgerError);
    expect((thrown as LedgerError).code).toBe("negative_balance");
    expect((thrown as LedgerError).message).toContain("cannot go below zero");
    expect(entries.length).toBe(before); // the failed spend left no row
    expect(deriveBalance(entries)).toBe(10);
  });

  test("a spend of exactly the balance is allowed, and leaves zero", async () => {
    const { store, entries } = memoryLedger();
    await postGrant(store, { userId: U, credits: 10, reason: "grant" });
    await postSpend(store, { userId: U, credits: 10, reason: "all of it", usageEventId: "evt_1" });
    expect(deriveBalance(entries)).toBe(0);
  });

  test("an adjustment below zero is refused the same way", async () => {
    const { store, entries } = memoryLedger();
    await postGrant(store, { userId: U, credits: 5, reason: "grant" });
    await expect(
      postAdjust(store, { userId: U, amount: -6, reason: "correction that overdraws" }),
    ).rejects.toMatchObject({ code: "negative_balance" });
    expect(entries.length).toBe(1);
  });
});

describe("a ledger row cannot exist without its cause", () => {
  test("a spend with no usage event is refused", async () => {
    const { store, entries } = memoryLedger();
    await postGrant(store, { userId: U, credits: 10, reason: "grant" });
    await expect(
      // @ts-expect-error — the type requires it; this is the runtime guard for a
      // caller that bypassed the type (a JSON body, a script, a future route).
      postSpend(store, { userId: U, credits: 1, reason: "no cause" }),
    ).rejects.toMatchObject({ code: "missing_cause" });
    expect(entries.length).toBe(1);
  });

  test("a spend naming a usage event that is not this account's is refused", async () => {
    const { store, entries } = memoryLedger([], ["evt_mine"]); // this account owns evt_mine only
    await postGrant(store, { userId: U, credits: 10, reason: "grant" });
    await expect(
      postSpend(store, { userId: U, credits: 1, reason: "borrowed cause", usageEventId: "evt_other_account" }),
    ).rejects.toMatchObject({ code: "unknown_usage_event" });
    expect(entries.length).toBe(1);
  });

  test("a blank or whitespace reason is refused on every kind", async () => {
    const { store, entries } = memoryLedger();
    await expect(postGrant(store, { userId: U, credits: 1, reason: "   " })).rejects.toMatchObject({
      code: "blank_reason",
    });
    await expect(
      postSpend(store, { userId: U, credits: 1, reason: "", usageEventId: "evt_1" }),
    ).rejects.toMatchObject({ code: "blank_reason" });
    await expect(postAdjust(store, { userId: U, amount: 1, reason: "\n\t" })).rejects.toMatchObject({
      code: "blank_reason",
    });
    expect(entries.length).toBe(0);
  });

  test("the sign of each kind is enforced before the row is written", async () => {
    const { store, entries } = memoryLedger();
    await expect(postGrant(store, { userId: U, credits: -5, reason: "negative grant" })).rejects.toMatchObject({
      code: "bad_amount",
    });
    await expect(
      postSpend(store, { userId: U, credits: -5, reason: "negative spend", usageEventId: "evt_1" }),
    ).rejects.toMatchObject({ code: "bad_amount" });
    await expect(postAdjust(store, { userId: U, amount: 0, reason: "nothing moves" })).rejects.toMatchObject({
      code: "bad_amount",
    });
    expect(entries.length).toBe(0);
  });
});

describe("the summary is arithmetic, not a claim", () => {
  test("grants, spends and adjustments are counted and summed separately", async () => {
    const { store, entries } = memoryLedger();
    await postGrant(store, { userId: U, credits: 100, reason: "grant" });
    await postGrant(store, { userId: U, credits: 50, reason: "grant 2" });
    await postSpend(store, { userId: U, credits: 40, reason: "spend", usageEventId: "evt_1" });
    await postAdjust(store, { userId: U, amount: -10, reason: "correction" });
    const summary = summariseLedger(entries);
    expect(summary).toMatchObject({
      balance: 100,
      known: true,
      rows: 4,
      grants: 2,
      spends: 1,
      adjustments: 1,
      granted: 150,
      spent: -40,
      adjusted: -10,
    });
    expect(summary.sentence).toContain("derived on this request as the sum of 4 ledger rows");
    expect(summary.sentence).toContain("No balance is stored anywhere");
  });
});
