/**
 * The AI tool pages' descriptions, swept (P7-7b, 2026-10-23).
 *
 * WHAT WENT WRONG: the SEO Studio page told every visitor "All of it is
 * provider-backed: this build produces no title, tag or chapter text until an
 * SEO provider is wired." Both halves were false against this build — 30 titles,
 * chapters, tags and keywords are derived from the project's own rows with no
 * provider at all (./publishing) — and the same page's capability list rendered
 * under "Planned capabilities", so the page contradicted itself. The sentence
 * survived P7-8's pass because that pass swept the auto-editor's gate, not this
 * page's description.
 *
 * WHAT THIS SUITE HOLDS:
 *   1. No AI tool page description promises an OUTCOME (findability, ranking,
 *      views, virality, a guarantee). This product holds no search, ranking or
 *      traffic data, so no such sentence can be backed.
 *   2. The SEO Studio description states what is true: the rule-derived path
 *      needs no provider, and `seo_generation` is the one provider-backed step.
 *   3. Every description is a single-sourced string that this suite can read —
 *      a sentence typed straight into JSX cannot be tested, which is how the
 *      false one survived.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SEO_STUDIO_DESCRIPTION } from "../seo-studio-copy";

const APP_ROOT = join(process.cwd(), "src", "app", "(app)", "ai");

/** Outcome promises no surface in this product may make. */
const OUTCOME_PROMISES: { pattern: RegExp; why: string }[] = [
  { pattern: /get found/i, why: "findability is an outcome; this product has no search data" },
  { pattern: /\boptimiz(e|ed|ing)\b/i, why: "the app optimizes nothing and measures no outcome" },
  { pattern: /\brank(s|ed|ing)? (higher|first|#1)\b/i, why: "no ranking data exists" },
  { pattern: /\bguarantee(d)?\b/i, why: "nothing about a video's reception can be guaranteed" },
  { pattern: /\bviral\b/i, why: "virality is an outcome this product cannot measure" },
  { pattern: /\bboost(s|ed|ing)?\b/i, why: "no traffic or view effect is measurable here" },
  { pattern: /grow (your|the) (audience|channel|subscribers)/i, why: "audience growth is an outcome" },
  { pattern: /(search volume|keyword difficulty|competition score|estimated traffic|monthly searches)/i,
    why: "this product has no source for any market figure" },
];

function pageFiles(): string[] {
  return readdirSync(APP_ROOT)
    .filter((d) => statSync(join(APP_ROOT, d)).isDirectory())
    .map((d) => join(APP_ROOT, d, "page.tsx"))
    .filter((p) => {
      try {
        return statSync(p).isFile();
      } catch {
        return false;
      }
    });
}

/** The `description=` value of an AI tool page, as source text. */
function descriptionOf(file: string): string {
  const src = readFileSync(file, "utf8");
  const m = src.match(/description=(?:"([^"]*)"|\{([^}]*)\})/);
  return m ? (m[1] ?? m[2] ?? "") : "";
}

describe("AI tool page descriptions", () => {
  test("every page is found (the sweep cannot pass by scanning nothing)", () => {
    const files = pageFiles();
    expect(files.length).toBeGreaterThanOrEqual(10);
    for (const f of files) expect(descriptionOf(f).length).toBeGreaterThan(20);
  });

  test("no description promises an outcome this product cannot measure", () => {
    const offences: string[] = [];
    for (const file of pageFiles()) {
      const desc = descriptionOf(file);
      for (const { pattern, why } of OUTCOME_PROMISES) {
        if (pattern.test(desc)) {
          offences.push(`${file}: ${pattern} — ${why}`);
        }
      }
    }
    expect(offences).toEqual([]);
  });

  test("the SEO Studio description no longer denies the rule-derived path", () => {
    // The exact false sentence that shipped and rendered.
    expect(SEO_STUDIO_DESCRIPTION).not.toMatch(/produces no title, tag or chapter text/i);
    expect(SEO_STUDIO_DESCRIPTION).not.toMatch(/all of it is provider-backed/i);
  });

  test("the SEO Studio description states what is true and names the gated step", () => {
    // Titles/tags/chapters come from the app's own rules over the project's rows.
    expect(SEO_STUDIO_DESCRIPTION).toMatch(/own rules/i);
    expect(SEO_STUDIO_DESCRIPTION).toMatch(/own rows/i);
    expect(SEO_STUDIO_DESCRIPTION).toMatch(/no provider needed/i);
    // The one provider-backed step is named, and it is conditional, not claimed.
    expect(SEO_STUDIO_DESCRIPTION).toMatch(/seo_generation/);
    expect(SEO_STUDIO_DESCRIPTION).toMatch(/would write/i);
    expect(SEO_STUDIO_DESCRIPTION).toMatch(/environment variable/i);
  });

  test("the SEO Studio page renders the single-sourced description", () => {
    const src = readFileSync(
      join(APP_ROOT, "seo-studio", "page.tsx"),
      "utf8",
    );
    expect(src).toContain("description={SEO_STUDIO_DESCRIPTION}");
    expect(src).toContain('from "@/lib/product/seo-studio-copy"');
  });
});
