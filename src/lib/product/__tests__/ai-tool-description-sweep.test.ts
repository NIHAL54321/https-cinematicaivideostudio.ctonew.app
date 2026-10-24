/**
 * The AI tool pages' descriptions, swept (P7-7b, 2026-10-23; extended P7-7c).
 *
 * WHAT WENT WRONG (P7-7b): the SEO Studio page told every visitor "All of it is
 * provider-backed: this build produces no title, tag or chapter text until an
 * SEO provider is wired." Both halves were false against this build — 30 titles,
 * chapters, tags and keywords are derived from the project's own rows with no
 * provider at all (./publishing) — and the same page's capability list rendered
 * under "Planned capabilities", so the page contradicted itself.
 *
 * WHAT WENT WRONG (P7-7c): the Subtitle Studio page's description ended
 * "... smart positioning that never covers faces or on-screen text." That is an
 * absolute about a RENDERED FRAME. This build has never rendered one: the
 * positioning engine is a pure planner that dodges the regions it is HANDED,
 * detects nothing itself, and no caption has ever been laid over a picture by
 * this app. A visitor read the promise anyway.
 *
 * WHAT THIS SUITE HOLDS:
 *   1. No AI tool page promises an OUTCOME (findability, ranking, views,
 *      virality, a guarantee). This product holds no search, ranking or traffic
 *      data, so no such sentence can be backed.
 *   2. No AI tool page carries an ABSOLUTE ABOUT RENDERING (a caption never
 *      covering something, a thing always staying inside the frame). Whether a
 *      pixel covers another pixel is a fact about a frame, and no frame exists.
 *   3. The SEO Studio and Subtitle Studio descriptions state what is true, and
 *      each page renders the single-sourced string.
 *   4. Copy is single-sourced so this suite can read it — a sentence typed
 *      straight into JSX cannot be tested, which is how both false ones
 *      survived their own passes.
 *   5. Negative control: the guard is fed the exact sentence that shipped, and
 *      must fail on it. A guard that only passes is not a guard.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { SEO_STUDIO_DESCRIPTION } from "../seo-studio-copy";
import { SUBTITLE_STUDIO_DESCRIPTION } from "../subtitle-studio-copy";
import {
  AI_TOOL_CAPABILITIES,
  CAPABILITY_STANDING_HEADING,
  CAPABILITY_STANDING_ORDER,
  REMOVED_BLANKET_HEADING,
  groupCapabilities,
  standingOf,
  type AiCapabilityItem,
} from "../ai-tool-capabilities";
import type { CapabilityConnectivity } from "@/lib/ai/providers/capability-connectivity";

const APP_ROOT = join(process.cwd(), "src", "app", "(app)", "ai");
const TOOL_PAGE_COMPONENT = join(process.cwd(), "src", "components", "ai-tool-page.tsx");

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

/**
 * Absolutes about a rendered frame.
 *
 * The product plans, derives and stores text. It has never rendered a frame
 * (`ffprobe`/`ffmpeg` are not installed, no export has ever completed), so any
 * sentence asserting what a rendered element DOES to a picture — what it covers,
 * what it stays clear of, what it always fits inside — cannot be backed by
 * anything this build holds. The honest form is to describe the rule and say the
 * frame has not been seen ("it has never rendered or checked a frame"), which
 * these patterns deliberately do not match.
 */
const RENDER_ABSOLUTES: { pattern: RegExp; why: string }[] = [
  {
    pattern: /\bnever (covers|cover|crops|crop|obscures|obscure|overlaps|overlap|hides|hide|blocks|block|touches|touch)\b/i,
    why: "what a rendered element covers is a fact about pixels; this build has never rendered a frame",
  },
  {
    pattern: /\b(always|never) (sits|stays|lands|fits|remains)\b[^.]{0,40}\b(inside|within|clear of|on top of)\b/i,
    why: "placement on a real frame is unverified — no frame exists",
  },
  {
    pattern: /\b(guaranteed|guarantees) to (fit|clear|avoid|stay|land)\b/i,
    why: "nothing about a rendered frame can be guaranteed by a build that has rendered none",
  },
  {
    pattern: /\bno (face|faces|subject|subjects|text) (is|are|will be) (ever )?(covered|obscured|hidden)\b/i,
    why: "nothing here detects a face or a subject, so nothing here can state one is uncovered",
  },
  {
    pattern: /\b(never|always) (visible|readable|legible) (on screen|on-screen|on every)\b/i,
    why: "legibility on a rendered frame has never been measured here",
  },
];

/** The sentence that actually shipped on /ai/subtitle-studio before P7-7c. */
const SHIPPED_SUBTITLE_SENTENCE =
  "Generate precise, readable captions for every video — word and sentence timing from your voice plan, " +
  "automatic line breaks, safe margins, dynamic captions and smart positioning that never covers faces " +
  "or on-screen text.";

/** Single-sourced strings, so the sweep reads the copy a visitor actually sees. */
const SINGLE_SOURCED: Record<string, string> = {
  SEO_STUDIO_DESCRIPTION,
  SUBTITLE_STUDIO_DESCRIPTION,
};

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

/** The `description=` value of an AI tool page, as source text (constants resolved). */
function descriptionOf(file: string): string {
  const src = readFileSync(file, "utf8");
  const m = src.match(/description=(?:"([^"]*)"|\{([^}]*)\})/);
  if (!m) return "";
  const raw = m[1] ?? m[2] ?? "";
  return SINGLE_SOURCED[raw.trim()] ?? raw;
}

/** Every text this suite can read for one tool page: its source, plus resolved copy. */
function surfacesOf(file: string): { surface: string; text: string }[] {
  const out: { surface: string; text: string }[] = [];
  for (const entry of readdirSync(join(file, ".."))) {
    const p = join(file, "..", entry);
    if (!statSync(p).isFile()) continue;
    if (!/\.(tsx|ts)$/.test(entry)) continue;
    out.push({ surface: p.replace(process.cwd() + "/", ""), text: readFileSync(p, "utf8") });
  }
  // A single-sourced constant does not appear in the page source, so read it here.
  const src = readFileSync(file, "utf8");
  for (const [name, value] of Object.entries(SINGLE_SOURCED)) {
    if (src.includes(name)) out.push({ surface: `${name} (${value.length} chars)`, text: value });
  }
  if (src.includes("AI_TOOL_CAPABILITIES")) {
    // The page's capability bullets are single-sourced too, so the sweep reads
    // the words a visitor actually sees rather than a copy of them.
    const slug = file.split("/").slice(-2)[0];
    const items = AI_TOOL_CAPABILITIES[slug] ?? [];
    out.push({
      surface: `AI_TOOL_CAPABILITIES["${slug}"] (joined)`,
      text: items.map((i) => i.text).join("\n"),
    });
  }
  return out;
}

/**
 * The scan itself — the ONE code path the real surfaces and the negative control
 * both go through, so a control that fails proves the guard, not a copy of it.
 */
function scanForRenderAbsolutes(
  entries: { surface: string; text: string }[],
): string[] {
  const offences: string[] = [];
  for (const { surface, text } of entries) {
    for (const { pattern, why } of RENDER_ABSOLUTES) {
      const hit = text.match(pattern);
      if (hit) offences.push(`${surface}: "${hit[0]}" — ${why}`);
    }
  }
  return offences;
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

  test("no AI tool page carries an absolute about a rendered frame", () => {
    const files = pageFiles();
    const entries = files.flatMap((f) => surfacesOf(f));
    // Every tool page contributes at least its own source, and no surface is
    // scanned twice — a sweep that silently reads nothing cannot pass.
    expect(entries.length).toBeGreaterThanOrEqual(files.length);
    expect(new Set(entries.map((e) => e.surface)).size).toBe(entries.length);
    expect(scanForRenderAbsolutes(entries)).toEqual([]);
  });

  test("negative control: the guard fails on the sentence that shipped", () => {
    const offences = scanForRenderAbsolutes([
      {
        surface: "src/app/(app)/ai/subtitle-studio/page.tsx (as it shipped before P7-7c)",
        text: SHIPPED_SUBTITLE_SENTENCE,
      },
    ]);
    expect(offences.length).toBeGreaterThan(0);
    expect(offences[0]).toContain("never covers");
  });

  test("negative control: the guard passes the sentence that replaced it", () => {
    // Proves the control is discriminating rather than matching any 'never'.
    expect(scanForRenderAbsolutes([{ surface: "subtitle", text: SUBTITLE_STUDIO_DESCRIPTION }])).toEqual([]);
    expect(SUBTITLE_STUDIO_DESCRIPTION).toMatch(/never rendered or checked a frame/i);
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

  test("the Subtitle Studio description states what it does and what it has never done", () => {
    // What it does: plans from its own rules over the rows it is given.
    expect(SUBTITLE_STUDIO_DESCRIPTION).toMatch(/own rules/i);
    expect(SUBTITLE_STUDIO_DESCRIPTION).toMatch(/rows you give it/i);
    // It detects nothing itself.
    expect(SUBTITLE_STUDIO_DESCRIPTION).toMatch(/detects no face, text, chart or subject/i);
    // What it has never done: rendered or verified a frame.
    expect(SUBTITLE_STUDIO_DESCRIPTION).toMatch(/never rendered or checked a frame/i);
    // The absolute it replaced is gone, and not merely reworded.
    expect(SUBTITLE_STUDIO_DESCRIPTION).not.toMatch(/never covers/i);
    expect(SUBTITLE_STUDIO_DESCRIPTION).not.toMatch(/smart positioning/i);
  });

  test("the Subtitle Studio capability list claims no detection it does not have", () => {
    const joined = (AI_TOOL_CAPABILITIES["subtitle-studio"] ?? []).map((i) => i.text).join("\n");
    expect(joined).not.toMatch(/avoids faces/i);
    expect(joined).toMatch(/regions you supply/i);
    expect(joined).toMatch(/detects none of them itself/i);
  });

  test("both pages render their single-sourced copy", () => {
    const seo = readFileSync(join(APP_ROOT, "seo-studio", "page.tsx"), "utf8");
    expect(seo).toContain("description={SEO_STUDIO_DESCRIPTION}");
    expect(seo).toContain('from "@/lib/product/seo-studio-copy"');

    const sub = readFileSync(join(APP_ROOT, "subtitle-studio", "page.tsx"), "utf8");
    expect(sub).toContain("description={SUBTITLE_STUDIO_DESCRIPTION}");
    expect(sub).toContain('capabilities={AI_TOOL_CAPABILITIES["subtitle-studio"]}');
    expect(sub).toContain('from "@/lib/product/subtitle-studio-copy"');
    // The old literal must not survive in JSX beside the import.
    expect(sub).not.toMatch(/never covers/);
  });
});

/**
 * The capability lists' STANDINGS (block 0, 2026-10-24).
 *
 * The rendered sweep found one heading — "Planned capabilities" — printed over
 * every feature list on every `/ai` page that renders `AiToolPage`, including
 * nine pages where part of that list is already computed by this build. A
 * heading that says "planned" over working features is a false claim, so the
 * heading is now derived per group and each item carries its basis.
 *
 * These tests hold the derivation, the single source and the headings; the
 * negative control feeds the guard the exact component text that shipped.
 */
function toolPages(): { slug: string; file: string; src: string }[] {
  return pageFiles()
    .map((file) => ({ slug: file.split("/").slice(-2)[0], file, src: readFileSync(file, "utf8") }))
    .filter((p) => p.src.includes("AiToolPage"));
}

/** A connectivity stub, so the derivation is tested without reading this machine. */
function conn(over: Partial<CapabilityConnectivity>): CapabilityConnectivity {
  return {
    capability: "test",
    registered: true,
    status: "not_connected",
    connected: false,
    candidates: [],
    connectedSlots: [],
    configuredSlots: [],
    wiredSlots: [],
    unwiredSlots: [],
    requiredEnv: [],
    envHint: null,
    ...over,
  } as CapabilityConnectivity;
}
const WIRED_SLOT = {
  id: "openai",
  name: "OpenAI",
  rank: 1,
  envKeys: ["OPENAI_API_KEY"],
  allRequired: true,
  configured: false,
  wired: true,
} as CapabilityConnectivity["wiredSlots"][number];

/** The one code path the real surfaces and the negative control both go through. */
function scanBlanketHeading(
  entries: { surface: string; text: string; workingItems: number }[],
): string[] {
  const offences: string[] = [];
  for (const e of entries) {
    if (e.text.includes(REMOVED_BLANKET_HEADING) && e.workingItems > 0) {
      offences.push(
        `${e.surface}: "${REMOVED_BLANKET_HEADING}" is printed over ${e.workingItems} item(s) this build already does`,
      );
    }
  }
  return offences;
}

describe("AI tool capability standings", () => {
  test("every page that renders AiToolPage has an entry, and nothing else does", () => {
    const pages = toolPages();
    expect(pages.length).toBeGreaterThanOrEqual(10);
    expect(new Set(pages.map((p) => p.slug)).size).toBe(pages.length);
    for (const p of pages) {
      expect(AI_TOOL_CAPABILITIES[p.slug]).toBeDefined();
      expect(AI_TOOL_CAPABILITIES[p.slug].length).toBeGreaterThan(0);
    }
    // A list with no page renders nowhere; that is a dead claim, not coverage.
    const slugs = new Set(pages.map((p) => p.slug));
    for (const slug of Object.keys(AI_TOOL_CAPABILITIES)) expect(slugs.has(slug)).toBe(true);
  });

  test("every page takes its items from the single source, not from JSX", () => {
    for (const p of toolPages()) {
      expect(p.src).toContain(`capabilities={AI_TOOL_CAPABILITIES["${p.slug}"]}`);
      expect(p.src).toMatch(/from "@\/lib\/product\/ai-tool-capabilities"/);
      // No inline array survives beside the import.
      expect(p.src).not.toMatch(/capabilities=\{\[/);
    }
  });

  test("every item declares a basis, and every 'works now' claim names real code", () => {
    const offences: string[] = [];
    for (const [slug, items] of Object.entries(AI_TOOL_CAPABILITIES)) {
      for (const item of items) {
        const b = item.basis;
        if (!b || !b.kind) {
          offences.push(`${slug}: "${item.text}" has no basis`);
          continue;
        }
        if (b.kind !== "derived") continue;
        let src = "";
        try {
          src = readFileSync(join(process.cwd(), b.module), "utf8");
        } catch {
          offences.push(`${slug}: "${item.text}" claims ${b.module}, which does not exist`);
          continue;
        }
        if (!src.includes(b.rule)) {
          offences.push(`${slug}: "${item.text}" claims ${b.rule} in ${b.module}, which is not there`);
        }
      }
    }
    expect(offences).toEqual([]);
  });

  test("the standing is derived from connectivity, not typed", () => {
    const providerItem: AiCapabilityItem = { text: "x", basis: { kind: "provider" } };
    const derivedItem: AiCapabilityItem = { text: "y", basis: { kind: "derived", module: "a", rule: "b" } };
    const unbuiltItem: AiCapabilityItem = { text: "z", basis: { kind: "unbuilt", why: "nothing" } };

    // A wired adapter with its key present: available now.
    expect(
      standingOf(providerItem, "cap", conn({ connected: true, wiredSlots: [WIRED_SLOT] })),
    ).toBe("available-now");
    // Wired, no key: waiting for the key (the real state of every provider here).
    expect(standingOf(providerItem, "cap", conn({ wiredSlots: [WIRED_SLOT] }))).toBe("needs-key");
    // No wired adapter at all: not built, and the heading says so.
    expect(standingOf(providerItem, "cap", conn({}))).toBe("no-adapter");
    // The other two bases do not consult connectivity at all.
    expect(standingOf(derivedItem, "cap", conn({}))).toBe("works-now");
    expect(standingOf(unbuiltItem, "cap", conn({}))).toBe("not-built");

    // An item may name its OWN capability — the stock fallback is not served by
    // the video capability, and the registry decides its standing, not this file.
    const stock: AiCapabilityItem = { text: "s", basis: { kind: "provider", capability: "stock_media_search" } };
    expect(standingOf(stock, "video_generation", conn({ connected: true, wiredSlots: [WIRED_SLOT] }))).toBe(
      "available-now",
    );
  });

  test("grouping drops empty groups and orders what works first", () => {
    const groups = groupCapabilities(AI_TOOL_CAPABILITIES["seo-studio"], "seo_generation", conn({}));
    expect(groups.map((g) => g.standing)).toEqual(["works-now", "no-adapter"]);
    // Every group's heading is the single source's, and it is not the blanket one.
    for (const g of groups) {
      expect(g.heading).toBe(CAPABILITY_STANDING_HEADING[g.standing]);
      expect(g.heading).not.toBe(REMOVED_BLANKET_HEADING);
    }
    expect(CAPABILITY_STANDING_ORDER[0]).toBe("works-now");
  });

  test("both kinds of page exist: one with working items, one with none", () => {
    const withWork = Object.entries(AI_TOOL_CAPABILITIES).filter(([, items]) =>
      items.some((i) => i.basis.kind === "derived"),
    );
    const withoutWork = Object.entries(AI_TOOL_CAPABILITIES).filter(([, items]) =>
      items.every((i) => i.basis.kind !== "derived"),
    );
    // If either list were empty the heading would only ever say one thing, and
    // this fix would be a rename rather than a status.
    expect(withWork.length).toBeGreaterThanOrEqual(3);
    expect(withoutWork.length).toBeGreaterThanOrEqual(2);
    // The page whose list is entirely unbuilt still renders its own heading.
    const image = groupCapabilities(AI_TOOL_CAPABILITIES["image-generator"], "image_generation", conn({}));
    expect(image.map((g) => g.standing)).toEqual(["no-adapter"]);
  });

  test("the blanket heading is gone from every surface that could print it", () => {
    const surfaces = [
      { surface: "src/components/ai-tool-page.tsx", text: readFileSync(TOOL_PAGE_COMPONENT, "utf8") },
      ...toolPages().map((p) => ({ surface: p.file.replace(process.cwd() + "/", ""), text: p.src })),
    ];
    for (const s of surfaces) expect(s.text).not.toContain(REMOVED_BLANKET_HEADING);
    // The component prints the derived heading instead.
    const component = readFileSync(TOOL_PAGE_COMPONENT, "utf8");
    expect(component).toContain("groupCapabilities(");
    expect(component).toContain("group.heading");
    expect(component).toContain("capabilityConnectivity(capability)");
  });

  test("negative control: the guard fails on the component text that shipped", () => {
    // The exact JSX the sweep photographed on ten served pages.
    const shipped = [
      '<p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">',
      "  Planned capabilities",
      "</p>",
    ].join("\n");
    const offences = scanBlanketHeading([
      { surface: "src/components/ai-tool-page.tsx (as it shipped before block 0)", text: shipped, workingItems: 5 },
    ]);
    expect(offences.length).toBe(1);
    expect(offences[0]).toContain("already does");
  });

  test("negative control: the guard passes the component as it is now", () => {
    const component = readFileSync(TOOL_PAGE_COMPONENT, "utf8");
    // The same guard, on the same surface, with working items present.
    expect(scanBlanketHeading([{ surface: "ai-tool-page.tsx", text: component, workingItems: 5 }])).toEqual([]);
  });
});
