/**
 * THE GUARDS THAT KEEP THE ACCOUNTING HONEST (Phase 8, block 5).
 *
 * These are source scanners, and they exist because the rules this block
 * promises are rules that a later edit could quietly break:
 *
 *   - the ledger is APPEND-ONLY: no `update`, `delete` or `upsert` on either
 *     table may appear anywhere in the source;
 *   - the ledger is written in ONE place: exactly one `creditLedgerEntry.create`;
 *   - a balance is DERIVED: no `balance` column in the schema;
 *   - no price is invented: no currency amount in the plans module;
 *   - no page or route claims a paid/active subscription that no row supports;
 *   - no figure is typed into the billing surface: the numbers come from rows.
 *
 * Every scanner takes the text it scans as an argument, so a test can run it
 * against a deliberately-broken SAMPLE and prove it fires. A scanner that has
 * only ever been run against clean code has not been tested at all.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export interface SourceFile {
  rel: string;
  src: string;
}

/** Every `.ts`/`.tsx` file under `dir`, skipping tests and dependencies. */
export function collectSources(dir: string, out: SourceFile[] = [], skipTests = true): SourceFile[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    if (skipTests && entry === "__tests__") continue;
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) collectSources(full, out, skipTests);
    else if (/\.(ts|tsx)$/.test(entry)) out.push({ rel: relative(process.cwd(), full), src: readFileSync(full, "utf8") });
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 1. Append-only                                                      */
/* ------------------------------------------------------------------ */

/** A write that would rewrite or remove an existing row. */
export const LEDGER_MUTATION_PATTERN =
  /\b(creditLedgerEntry|usageEvent)\.(update|updateMany|delete|deleteMany|upsert)\s*\(/;

export function scanForLedgerMutations(files: readonly SourceFile[]): SourceFile[] {
  return files.filter((f) => LEDGER_MUTATION_PATTERN.test(f.src));
}

/** Every place a ledger row is created. There must be exactly one. */
export const LEDGER_CREATE_PATTERN = /\bcreditLedgerEntry\.create\s*\(/g;

export function findLedgerCreateSites(files: readonly SourceFile[]): string[] {
  const sites: string[] = [];
  for (const file of files) {
    const matches = file.src.match(LEDGER_CREATE_PATTERN);
    if (matches) for (let i = 0; i < matches.length; i += 1) sites.push(file.rel);
  }
  return sites;
}

/* ------------------------------------------------------------------ */
/* 2. A balance is derived, never stored                               */
/* ------------------------------------------------------------------ */

/** A column that would store a balance. */
export const STORED_BALANCE_PATTERN = /^\s*(balance|creditBalance|creditsBalance)\s+(Int|BigInt|Float|Decimal)\b/m;

export function scanForStoredBalance(schemaText: string): boolean {
  return STORED_BALANCE_PATTERN.test(schemaText);
}

/* ------------------------------------------------------------------ */
/* 3. No invented price                                                */
/* ------------------------------------------------------------------ */

/** A currency amount: "$19", "19 USD", "€9.99", "19/mo". */
export const CURRENCY_LITERAL_PATTERN = /(\$\s*\d)|(\b\d+(\.\d{1,2})?\s*(USD|EUR|GBP|usd|eur|gbp)\b)|(\b\d+(\.\d{1,2})?\s*\/\s*(mo|month)\b)/;

export function scanForCurrencyLiterals(text: string): string[] {
  const hits: string[] = [];
  for (const line of text.split("\n")) {
    // A comment explaining what must NOT be done is not a price.
    if (/^\s*(\*|\/\/|\/\*)/.test(line)) continue;
    if (CURRENCY_LITERAL_PATTERN.test(line)) hits.push(line.trim());
  }
  return hits;
}

/* ------------------------------------------------------------------ */
/* 4. No unsupported subscription claim                                */
/* ------------------------------------------------------------------ */

/**
 * A sentence that would tell a reader they have a paid or active subscription.
 * Matched case-insensitively against every page, route and component.
 */
export const PAID_STATUS_CLAIM_PATTERN =
  /\b(your (plan|subscription) is|you are (on the|subscribed)|subscription (is )?active|active subscription|paid (plan|subscriber)|billing is active|upgrade now|you have been charged|payment (received|confirmed))\b/i;

export function scanForPaidStatusClaims(files: readonly SourceFile[]): SourceFile[] {
  return files.filter((f) => PAID_STATUS_CLAIM_PATTERN.test(f.src));
}

/* ------------------------------------------------------------------ */
/* 5. No figure typed into the billing surface                         */
/* ------------------------------------------------------------------ */

/**
 * A digit inside a JSX TEXT NODE. Attribute values (class names, aria labels,
 * sizes) are not text nodes and are not matched; neither is a `{…}` expression,
 * because a figure inside an expression is computed from the model.
 */
export const JSX_TEXT_DIGIT_PATTERN = />\s*[^<>{}]*\d[^<>{}]*\s*</g;

export function scanForHardcodedTextFigures(files: readonly SourceFile[]): Array<{ rel: string; text: string }> {
  const hits: Array<{ rel: string; text: string }> = [];
  for (const file of files) {
    for (const match of file.src.matchAll(JSX_TEXT_DIGIT_PATTERN)) {
      hits.push({ rel: file.rel, text: match[0].replace(/\s+/g, " ").slice(0, 120) });
    }
  }
  return hits;
}

/* ------------------------------------------------------------------ */
/* Convenience: the surfaces this block added                          */
/* ------------------------------------------------------------------ */

export const BILLING_SURFACE_FILES = [
  "src/app/(app)/billing/page.tsx",
  "src/components/billing-overview.tsx",
  "src/app/api/studio/billing/route.ts",
] as const;

export function readSource(rel: string): string {
  return readFileSync(join(process.cwd(), rel), "utf8");
}
