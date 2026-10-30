/**
 * THE GUARDS, AND THE PROOF THAT EACH ONE FIRES (Phase 8, block 5).
 *
 * Every scanner below is run twice: once against the REAL source (where it must
 * find nothing) and once against a SAMPLE of the thing it is meant to catch
 * (where it must fire). A scanner that has only ever been run against clean
 * code has not been tested — it may simply match nothing at all.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BILLING_SURFACE_FILES,
  collectSources,
  CURRENCY_LITERAL_PATTERN,
  findLedgerCreateSites,
  LEDGER_MUTATION_PATTERN,
  scanForCurrencyLiterals,
  scanForHardcodedTextFigures,
  scanForLedgerMutations,
  scanForPaidStatusClaims,
  scanForStoredBalance,
} from "../guard";
import { OWNER_APPROVED_PLANS } from "../plans";

const SRC = join(process.cwd(), "src");
const SOURCES = collectSources(SRC);
const read = (rel: string) => readFileSync(join(process.cwd(), rel), "utf8");

describe("append-only: no update, no delete, no upsert on either table", () => {
  test("the real source contains none", () => {
    const offenders = scanForLedgerMutations(SOURCES);
    expect(offenders.map((f) => f.rel)).toEqual([]);
  });

  test("NEGATIVE CONTROL: the scanner fires on each mutation verb", () => {
    const samples = [
      "await prisma.creditLedgerEntry.update({ where: { id } , data: { amount: 0 } });",
      "await prisma.creditLedgerEntry.updateMany({ data: { reason: 'x' } });",
      "await prisma.creditLedgerEntry.delete({ where: { id } });",
      "await prisma.creditLedgerEntry.deleteMany({});",
      "await prisma.creditLedgerEntry.upsert({ where: { id }, create: {}, update: {} });",
      "await prisma.usageEvent.update({ where: { id }, data: { quantity: 0 } });",
      "await prisma.usageEvent.deleteMany({});",
    ];
    for (const src of samples) {
      expect(LEDGER_MUTATION_PATTERN.test(src)).toBe(true);
      expect(scanForLedgerMutations([{ rel: "sample.ts", src }]).length).toBe(1);
    }
    expect(scanForLedgerMutations([{ rel: "clean.ts", src: "await prisma.creditLedgerEntry.create({ data })" }])).toEqual([]);
  });

  test("a ledger row is created in exactly ONE place, and it is the adapter", () => {
    const sites = findLedgerCreateSites(SOURCES);
    expect(sites).toEqual(["src/lib/usage/store.ts"]);
  });
});

describe("a balance is derived, never stored", () => {
  test("the schema declares no balance column", () => {
    const schema = read("prisma/schema.prisma");
    expect(scanForStoredBalance(schema)).toBe(false);
  });

  test("NEGATIVE CONTROL: the scanner fires on a schema that stores one", () => {
    expect(scanForStoredBalance('model Account {\n  id String @id\n  balance Int @default(0)\n}')).toBe(true);
    expect(scanForStoredBalance('model Account {\n  creditBalance BigInt @default(0)\n}')).toBe(true);
    expect(scanForStoredBalance('model Account {\n  credits Int @default(0)\n}')).toBe(false);
  });
});

describe("no price is invented", () => {
  test("the plans module carries no currency amount", () => {
    expect(scanForCurrencyLiterals(read("src/lib/usage/plans.ts"))).toEqual([]);
  });

  test("the owner-approved plan list is empty — no plan exists on this build", () => {
    expect(OWNER_APPROVED_PLANS.length).toBe(0);
  });

  test("NEGATIVE CONTROL: the currency scanner fires on a price", () => {
    expect(scanForCurrencyLiterals('const price = "$19";')).toHaveLength(1);
    expect(scanForCurrencyLiterals("const price = 29 USD;")).toHaveLength(1);
    expect(scanForCurrencyLiterals("const price = 9.99/mo;")).toHaveLength(1);
    // A comment saying what must NOT be done is not a price.
    expect(scanForCurrencyLiterals('// never write "$19" here')).toEqual([]);
    expect(CURRENCY_LITERAL_PATTERN.test("const label = 'Pro plan';")).toBe(false);
  });
});

describe("no page claims a paid or active subscription", () => {
  test("the real source contains no such sentence", () => {
    // guard.ts is the file that DEFINES the pattern, so it necessarily contains
    // the phrases it looks for; it is not a page and it renders nothing.
    const scanned = SOURCES.filter((f) => f.rel !== "src/lib/usage/guard.ts");
    const offenders = scanForPaidStatusClaims(scanned);
    expect(offenders.map((f) => f.rel)).toEqual([]);
  });

  test("NEGATIVE CONTROL: the scanner fires on each claim", () => {
    for (const src of [
      "<p>Your subscription is active.</p>",
      "<p>You are subscribed to the Pro plan.</p>",
      "<p>Subscription active since yesterday.</p>",
      "<p>Upgrade now to unlock rendering.</p>",
      "<p>Payment received — thank you.</p>",
    ]) {
      expect(scanForPaidStatusClaims([{ rel: "sample.tsx", src }]).length).toBe(1);
    }
    expect(scanForPaidStatusClaims([{ rel: "clean.tsx", src: "<p>No plan exists on this deployment.</p>" }])).toEqual([]);
  });
});

describe("no figure is typed into the billing surface", () => {
  test("the billing page, component and route contain no digit in a text node", () => {
    const files = BILLING_SURFACE_FILES.map((rel) => ({ rel, src: read(rel) }));
    expect(scanForHardcodedTextFigures(files)).toEqual([]);
  });

  test("NEGATIVE CONTROL: the scanner fires on a typed figure, and not on an attribute or an expression", () => {
    const hits = scanForHardcodedTextFigures([
      { rel: "a.tsx", src: '<p className="text-[11px]">3 of 21 capabilities</p>' },
      { rel: "b.tsx", src: "<p>{count} rows</p>" },
      { rel: "c.tsx", src: '<p className="text-[11px]">{count} rows</p>' },
    ]);
    expect(hits.map((h) => h.rel)).toEqual(["a.tsx"]);
    expect(hits[0].text).toContain("3 of 21");
  });
});
