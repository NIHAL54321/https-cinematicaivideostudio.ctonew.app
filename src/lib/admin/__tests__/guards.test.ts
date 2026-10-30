/**
 * THE ADMIN DASHBOARD'S HONESTY GUARDS (Phase 8, block 4).
 *
 * Four guards, each with a NEGATIVE CONTROL — a test that proves the guard can
 * actually fail. A guard whose failure mode is never exercised is decoration, so
 * every one of these drives the bad input as well as the good one:
 *
 *   1. no figure is typed into the component (the negative control is a source
 *      string that DOES contain a figure, checked against the same function);
 *   2. the money section never carries a number, in either branch — and the
 *      sentence changes when the facts change, so it cannot be a constant;
 *   3. the capability matrix cannot report a capability as usable without a
 *      provider row that is configured AND has a call() — a tampered status that
 *      claims "connected" with no such row makes the builder throw;
 *   4. the encoder line is derived from the live probes — failing probes produce
 *      "no encoder answered", and the version string comes from the probe's own
 *      output rather than from the facts module.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildCapabilityMatrix,
  buildEncoderSection,
  buildMoneySection,
  derivePresetFit,
  type MoneyFacts,
  type ProbeFact,
} from "@/lib/admin/sections";
import { AI_CAPABILITIES } from "@/lib/ai/types";
import type { CapabilityStatusInfo } from "@/lib/ai/status";

const ROOT = join(process.cwd());

/* ================================================================== */
/* 1. No figure is typed into the component                            */
/* ================================================================== */

/**
 * Removes the parts of a component that are not a rendered figure: comments,
 * CSS class names, and string literals (which are attribute values or keys).
 * What is left is JSX TEXT — what a reader actually reads — plus expressions.
 */
export function renderedTextOf(src: string): string {
  // A small scanner rather than a regex: JSX text is whatever sits OUTSIDE tags,
  // outside `{...}` expressions, outside strings and outside comments. Doing it by
  // hand means a `>` inside an expression (`rows.length > 0`) cannot be mistaken
  // for the end of a tag — which is exactly how a regex version let a figure slip.
  const out: string[] = [];
  let braceDepth = 0;
  let inTag = false;
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (ch === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      i += 1;
      while (i < src.length && src[i] !== ch) {
        if (src[i] === "\\") i += 1;
        i += 1;
      }
      i += 1;
      continue;
    }
    if (ch === "{") {
      braceDepth += 1;
      i += 1;
      continue;
    }
    if (ch === "}") {
      braceDepth = Math.max(0, braceDepth - 1);
      i += 1;
      continue;
    }
    if (braceDepth === 0) {
      if (ch === "<") {
        inTag = true;
        i += 1;
        continue;
      }
      if (ch === ">") {
        inTag = false;
        i += 1;
        continue;
      }
      if (!inTag) out.push(ch);
    }
    i += 1;
  }
  return out.join("");
}

describe("no admin figure is typed into the component", () => {
  const files = ["src/components/admin-overview.tsx", "src/app/(app)/admin/page.tsx"];

  test("the rendering files contain no digit in rendered text", () => {
    for (const rel of files) {
      const text = renderedTextOf(readFileSync(join(ROOT, rel), "utf8"));
      const offending = text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /\d/.test(line));
      expect({ file: rel, offending }).toEqual({ file: rel, offending: [] });
    }
  });

  test("NEGATIVE CONTROL: the same function catches a typed figure", () => {
    const bad = `<p className="text-[13px]">3 of 21 capabilities are wired</p>;`;
    const text = renderedTextOf(bad);
    expect(/\d/.test(text)).toBe(true);
    expect(text).toContain("3 of 21");
  });

  test("the component reads no data source of its own", () => {
    const src = readFileSync(join(ROOT, "src/components/admin-overview.tsx"), "utf8");
    for (const forbidden of ["@/lib/db", "node:fs", "node:child_process", "process.env", "fetch(", "Date.now"]) {
      expect({ forbidden, present: src.includes(forbidden) }).toEqual({ forbidden, present: false });
    }
  });
});

/* ================================================================== */
/* 2. Money: words, never a figure                                     */
/* ================================================================== */

const noMoney: MoneyFacts = {
  stripeKeyPresent: false,
  providerLinkedSubscription: false,
  paymentRouteFound: false,
  paymentRouteScan: "walked every route file under src/app/api",
  envNamesChecked: ["STRIPE_SECRET_KEY"],
  checkedAt: "2026-10-30T00:00:00.000Z",
};

describe("the money section never shows a figure", () => {
  /** The prose of the section — the stamp is a time, kept out of this string. */
  const proseOf = (section: { headline: string; statements: string[]; figures: readonly never[] }) =>
    JSON.stringify({ headline: section.headline, statements: section.statements, figures: section.figures });

  test("with no payment surface, the section carries no digit at all", () => {
    const section = buildMoneySection(noMoney);
    expect(proseOf(section)).not.toMatch(/\d/);
    expect(section.figures).toEqual([]);
    expect(section.paymentsPossible).toBe(false);
    expect(section.headline).toContain("No payments are possible on this deployment");
  });

  test("NEGATIVE CONTROL: with a payment surface present the sentence changes and still carries no figure", () => {
    const section = buildMoneySection({ ...noMoney, stripeKeyPresent: true });
    expect(section.paymentsPossible).toBe(true);
    expect(section.headline).not.toContain("No payments are possible on this deployment");
    expect(proseOf(section)).not.toMatch(/\d/);
  });

  test("the schema still has no revenue, balance, invoice or transaction table", () => {
    // If one is ever added, this fails and forces the money section to be
    // revisited rather than left claiming there is nothing to read.
    const schema = readFileSync(join(ROOT, "prisma/schema.prisma"), "utf8");
    const models = [...schema.matchAll(/^model\s+(\w+)/gm)].map((m) => m[1]);
    const moneyShaped = models.filter((m) => /revenue|balance|invoice|transaction|payment|charge|refund/i.test(m));
    expect(moneyShaped).toEqual([]);
  });
});

/* ================================================================== */
/* 3. The capability matrix cannot be widened without a real row       */
/* ================================================================== */

function statusFor(
  capability: string,
  providers: Array<{ id: string; name: string; configured: boolean; wired: boolean }>,
  claimed: "connected" | "not_connected" = "not_connected",
): CapabilityStatusInfo {
  return {
    capability: capability as CapabilityStatusInfo["capability"],
    label: capability,
    status: claimed,
    requiredEnv: ["SOME_KEY"],
    envNote: "a note",
    providers: providers.map((p, index) => ({ ...p, rank: index + 1 })),
  };
}

describe("the capability matrix reports only what a provider row supports", () => {
  test("usable (wired) never exceeds the number of capabilities with an adapter", () => {
    const statuses: CapabilityStatusInfo[] = [
      statusFor("a", [{ id: "p", name: "P", configured: true, wired: true }], "connected"),
      statusFor("b", [{ id: "p", name: "P", configured: false, wired: true }]),
      statusFor("c", [{ id: "p", name: "P", configured: false, wired: false }]),
    ];
    const matrix = buildCapabilityMatrix(statuses);
    expect(matrix.total).toBe(3);
    expect(matrix.wired).toBe(1);
    expect(matrix.adaptersBuilt).toBe(2);
    expect(matrix.rows.map((r) => r.state)).toEqual(["wired", "key missing", "unbuilt"]);
    expect(matrix.wired).toBeLessThanOrEqual(matrix.adaptersBuilt);
  });

  test("NEGATIVE CONTROL: a status claiming 'connected' with no configured provider throws", () => {
    const tampered = [statusFor("a", [{ id: "p", name: "P", configured: false, wired: true }], "connected")];
    expect(() => buildCapabilityMatrix(tampered)).toThrow(/disagree/);
  });

  test("NEGATIVE CONTROL: a status denying 'connected' while a configured provider exists throws", () => {
    const tampered = [statusFor("a", [{ id: "p", name: "P", configured: true, wired: true }], "not_connected")];
    expect(() => buildCapabilityMatrix(tampered)).toThrow(/disagree/);
  });

  test("every capability the app registers appears exactly once", () => {
    const statuses = AI_CAPABILITIES.map((c) => statusFor(c, []));
    const matrix = buildCapabilityMatrix(statuses);
    expect(matrix.total).toBe(AI_CAPABILITIES.length);
    expect(new Set(matrix.rows.map((r) => r.capability)).size).toBe(AI_CAPABILITIES.length);
    expect(matrix.wired).toBe(0);
    expect(matrix.adaptersBuilt).toBe(0);
  });
});

/* ================================================================== */
/* 4. The encoder line is a live probe, not a stored fact              */
/* ================================================================== */

function probe(probeId: string, ok: boolean, detail: string, missing: string | null = null): ProbeFact {
  return { probeId, ok, detail, missing, checkedAt: "2026-10-30T00:00:00.000Z" };
}

const okProbes = [
  probe("ffmpeg-binary", true, "spawn ffmpeg -version → exit 0; ffmpeg version 9.9.9-fake-build"),
  probe("ffprobe-binary", true, "spawn ffprobe -version → exit 0; ffprobe version 9.9.9-fake-build"),
  probe("storage-writable", true, "wrote, read back and unlinked 64 bytes in /tmp/x"),
];

const badProbes = [
  probe("ffmpeg-binary", false, "spawn ffmpeg -version → ENOENT (spawnSync ffmpeg ENOENT)", "ffmpeg binary — not installed on this machine (ENOENT)"),
  probe("ffprobe-binary", false, "spawn ffprobe -version → ENOENT (spawnSync ffprobe ENOENT)", "ffprobe binary — not installed on this machine (ENOENT)"),
  probe("storage-writable", true, "wrote, read back and unlinked 64 bytes in /tmp/x"),
];

describe("the encoder section states what the probes answered", () => {
  test("failing probes produce 'no encoder answered', never 'installed'", () => {
    const section = buildEncoderSection({
      checkedAt: "2026-10-30T00:00:00.000Z",
      probes: badProbes,
      memoryAvailableKb: 1000,
      memoryTotalKb: 2000,
      presetFit: [],
    });
    expect(section.binariesAnswered).toBe(false);
    expect(section.headline).toContain("No encoder answered a live probe on this request");
    // It may repeat the PROBE's own words ("not installed on this machine"), but it
    // must never claim an encoder is present or quote a stored "installed: yes".
    expect(section.headline).not.toContain("An encoder answered");
    expect(section.headline).not.toMatch(/installed:?\s*yes/i);
    expect(section.headline).toContain("ENOENT");
  });

  test("the version string comes from the probe's own output, not from a constant", () => {
    const section = buildEncoderSection({
      checkedAt: "2026-10-30T00:00:00.000Z",
      probes: okProbes,
      memoryAvailableKb: 1000,
      memoryTotalKb: 2000,
      presetFit: [],
    });
    expect(section.binariesAnswered).toBe(true);
    expect(section.headline).toContain("9.9.9-fake-build");
  });

  test("the section is stamped with the caller's clock, so it cannot be a stored value", () => {
    const first = buildEncoderSection({
      checkedAt: "2026-10-30T00:00:01.000Z",
      probes: okProbes,
      memoryAvailableKb: null,
      memoryTotalKb: null,
      presetFit: [],
    });
    const second = buildEncoderSection({
      checkedAt: "2026-10-30T00:00:02.000Z",
      probes: okProbes,
      memoryAvailableKb: null,
      memoryTotalKb: null,
      presetFit: [],
    });
    expect(first.checkedAt).toBe("2026-10-30T00:00:01.000Z");
    expect(second.checkedAt).toBe("2026-10-30T00:00:02.000Z");
    expect(first.memorySentence).toContain("could not be read");
  });

  test("preset fit is 'unknown' for a preset no run ever attempted, and never 'fits'", () => {
    const fit = derivePresetFit(999_999_999);
    const unknowns = fit.filter((f) => f.verdict === "unknown");
    expect(unknowns.length).toBeGreaterThan(0);
    for (const row of unknowns) expect(row.basis).toContain("unmeasured");
    // The one preset with a recorded run at its own defaults is decided by the
    // memory measured now, in both directions.
    const withMemory = fit.find((f) => f.presetId === "youtube-2160p")!;
    expect(withMemory.verdict).toBe("fits");
    const withoutMemory = derivePresetFit(1).find((f) => f.presetId === "youtube-2160p")!;
    expect(withoutMemory.verdict).toBe("does not fit");
    const unreadable = derivePresetFit(null).find((f) => f.presetId === "youtube-2160p")!;
    expect(unreadable.verdict).toBe("does not fit");
    expect(unreadable.basis).toContain("could not be read");
  });
});
