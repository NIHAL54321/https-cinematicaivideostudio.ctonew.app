/**
 * Phase 7 Block 2 — the Creator Studio page's own words, and its sources.
 *
 * Two things are proved here:
 *
 *   1. every string this page writes (all of them live in ../studio-copy) passes
 *      the package's BANNED_CLAIMS list, makes no forward promise, and names no
 *      market metric — the metrics this product lacks are named ONLY in the
 *      package's own declaration, which the page renders as data;
 *   2. the page's source files write no prose of their own: the same scans are
 *      run over the .tsx files and the view module, so a banned claim or a
 *      promise added inline is caught by a test rather than by a review.
 *
 * Both scans are proved non-vacuous by a canary: a string that does contain a
 * banned claim, a promise and a metric name must be reported.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { BANNED_CLAIMS } from "../audit";
import * as COPY from "../studio-copy";

/** Phrases that only exist in a promise about a future this build does not have. */
const FORWARD_PROMISES = [
  "coming soon",
  "will be able",
  "will arrive",
  "arrives in",
  "in a future",
  "future release",
  "in a later",
  "planned for",
  "ships in",
  "roadmap",
  "stay tuned",
  "shortly",
];

/**
 * Market-metric names. The app's own prose may not contain one of these: the
 * declaration that this product HAS none of them belongs to the package, and the
 * page shows that declaration as data.
 */
const MARKET_METRIC_NAMES = [
  "search volume",
  "search-volume",
  "keyword difficulty",
  "competition",
  "competitor",
  "estimated traffic",
  "search traffic",
  "impressions",
  "popularity",
  "trend data",
  "ranking position",
  "cost per click",
];

function scanProse(text: string): string[] {
  const lower = text.toLowerCase();
  const found: string[] = [];
  for (const phrase of BANNED_CLAIMS) if (lower.includes(phrase)) found.push(`banned claim: ${phrase}`);
  for (const phrase of FORWARD_PROMISES) if (lower.includes(phrase)) found.push(`forward promise: ${phrase}`);
  for (const phrase of MARKET_METRIC_NAMES) if (lower.includes(phrase)) found.push(`market metric named: ${phrase}`);
  return found;
}

function stringsIn(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (Array.isArray(value)) {
    for (const item of value) stringsIn(item, out);
    return out;
  }
  if (typeof value === "object" && value !== null) {
    for (const item of Object.values(value)) stringsIn(item, out);
  }
  return out;
}

const PAGE_FILES = [
  "src/app/(app)/projects/[id]/creator-studio/page.tsx",
  "src/app/(app)/projects/[id]/creator-studio/creator-studio-client.tsx",
  "src/lib/publishing/studio-view.ts",
  "src/lib/publishing/studio-copy.ts",
];

/**
 * The files that RENDER. The view module (studio-view.ts) is not here on
 * purpose: its `note` strings are part of the view that the package's own audit
 * scans before it can be rendered, which is a stronger check than this scan.
 */
const RENDER_FILES = [
  "src/app/(app)/projects/[id]/creator-studio/page.tsx",
  "src/app/(app)/projects/[id]/creator-studio/creator-studio-client.tsx",
];

describe("creator studio copy — the page's own words", () => {
  test("every string the page writes passes the banned-claim, promise and metric scans", () => {
    const strings = stringsIn(COPY);
    expect(strings.length).toBeGreaterThan(60);
    const problems: string[] = [];
    for (const s of strings) {
      for (const problem of scanProse(s)) problems.push(`${problem} — in "${s.slice(0, 70)}"`);
    }
    expect(problems).toEqual([]);
  });

  test("the scan is not vacuous", () => {
    const nasty = "This description is fully optimized and it will be able to give you the search volume you want.";
    const found = scanProse(nasty);
    expect(found).toContain("banned claim: optimized");
    expect(found).toContain("forward promise: will be able");
    expect(found).toContain("market metric named: search volume");
  });

  test("the page's files write no prose of their own that the scans would reject", () => {
    for (const file of PAGE_FILES) {
      const text = readFileSync(file, "utf8");
      // Comments and code are scanned too: a banned claim in a comment is one
      // edit away from being a banned claim on the screen.
      expect(scanProse(text)).toEqual([]);
    }
  });

  test("the page does not import a market-metric name from anywhere", () => {
    for (const file of PAGE_FILES) {
      const text = readFileSync(file, "utf8");
      for (const phrase of MARKET_METRIC_NAMES) {
        expect(text.toLowerCase().includes(phrase)).toBe(false);
      }
    }
  });

  test("the state chips, the legend and the section headings are all real copy", () => {
    expect(COPY.STATE_CHIP.derived).toBe("Derived");
    expect(COPY.STATE_CHIP.empty_no_input).toContain("Empty");
    expect(COPY.STATE_CHIP.gated_provider).toContain("Gated");
    expect(COPY.STATE_LEGEND.length).toBe(3);
    for (const section of Object.values(COPY.SECTION_COPY)) {
      // The screening section's heading is SCREENING_COPY.sectionHeading (asserted
      // below), because the statement "not legal clearance" belongs in the heading
      // rather than only in the body. Every other section still carries its own.
      if ("title" in section) expect(section.title.length).toBeGreaterThan(2);
      expect(section.basis.length).toBeGreaterThan(10);
    }
    expect(COPY.SCREENING_COPY.sectionHeading.length).toBeGreaterThan(10);
  });

  test("the page files hold no sentence of their own — prose lives in the copy module", () => {
    // Heuristic, and a deliberate one: a string literal with three or more words
    // that does not look like a Tailwind class or a data hook must be a sentence,
    // and every sentence the page shows belongs in ../studio-copy.
    const known = new Set(
      stringsIn(COPY)
        .map((s) => s.toLowerCase())
        .concat(Object.values(COPY.ORIGIN_PHRASE).map((v) => v.toLowerCase())),
    );
    const classHints = [
      "text-", "border", "flex", "grid", "gap", "bg-", "px-", "py-", "mt-", "mb-", "ml-", "mr-", "w-",
      "h-", "max-", "min-", "font-", "space-", "items-", "inline", "block", "absolute", "relative",
      "sr-only", "whitespace", "cursor-", "select-", "overflow", "rounded", "shadow", "uppercase",
      "tracking", "leading", "break-", "shrink", "hidden", "truncate",
    ];
    const offenders: string[] = [];
    for (const file of RENDER_FILES) {
      const source = readFileSync(file, "utf8");
      for (const literal of source.match(/"[^"\n]*"|`[^`]*`/g) ?? []) {
        const text = literal.slice(1, -1).trim();
        if (text.split(/\s+/).length < 3) continue;
        if (classHints.some((hint) => text.includes(hint))) continue;
        if (text.includes("${") || /^[a-z0-9./:-]+$/i.test(text.replace(/ /g, ""))) continue;
        if (known.has(text.toLowerCase())) continue;
        offenders.push(`${file}: ${text.slice(0, 90)}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
