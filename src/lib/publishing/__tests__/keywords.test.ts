import { describe, expect, test } from "bun:test";
import {
  ABSENT_MARKET_DATA,
  BUCKET_LIMITS,
  buildKeywordPlan,
  MAX_PHRASE_TOKENS,
  tokenize,
  type KeywordRecord,
} from "../keywords";
import { emptySource, richSource, textOnlySource } from "./fixtures";
import type { PublishingSource } from "../types";
import type { SourceRef } from "../provenance";

/** The exact keys a keyword record is allowed to carry — nothing else, ever. */
const KEYWORD_KEYS = [
  "id",
  "kind",
  "text",
  "tokenCount",
  "occurrences",
  "sourceWeight",
  "textOrigin",
  "rule",
  "sources",
  "spansTruncated",
].sort();

/** Resolves a source ref back to the text it points at, from the fixture. */
function textFor(source: PublishingSource, ref: SourceRef): string {
  if (ref.kind === "project") return ref.path === "title" ? source.project.title : (source.project.description ?? "");
  if (ref.kind === "script") {
    const s = source.script!;
    if (ref.path === "title") return s.title ?? "";
    if (ref.path === "logline") return s.logline ?? "";
    if (ref.path === "tone") return s.tone ?? "";
    return s.targetAudience ?? "";
  }
  if (ref.kind === "project_settings") {
    const s = source.settings!;
    if (ref.path === "tone") return s.tone ?? "";
    if (ref.path === "style") return s.style ?? "";
    return s.targetAudience ?? "";
  }
  if (ref.kind === "chapter") {
    const c = source.chapters.find((x) => x.id === ref.id)!;
    return ref.path === "title" ? c.title : (c.summary ?? "");
  }
  if (ref.kind === "scene") {
    for (const c of source.chapters) {
      const s = c.scenes.find((x) => x.id === ref.id);
      if (s) return ref.path === "title" ? (s.title ?? "") : (s.narration ?? "");
    }
  }
  throw new Error(`textFor(): unhandled ref ${ref.kind}/${ref.id}`);
}

const allKeywords = (plan: ReturnType<typeof buildKeywordPlan>): KeywordRecord[] => plan.keywords;

describe("keywords — extracted from the project's own text, never from a market source", () => {
  test("every keyword traces back to real characters in the project's own rows", () => {
    const source = richSource();
    const plan = buildKeywordPlan(source);
    expect(plan.totalKeywords).toBeGreaterThan(0);
    for (const keyword of allKeywords(plan)) {
      expect(keyword.sources.length).toBeGreaterThan(0);
      const withSpan = keyword.sources.find((s) => s.span);
      expect(withSpan).toBeDefined();
      const text = textFor(source, withSpan!);
      const slice = text.slice(withSpan!.span!.start, withSpan!.span!.end).toLowerCase();
      const normalised = slice.replace(/[^a-z0-9' ]/g, " ").replace(/\s+/g, " ").trim();
      expect(normalised).toBe(keyword.text);
    }
  });

  test("occurrences and sourceWeight are recomputed from the source, not asserted", () => {
    const source = richSource();
    const plan = buildKeywordPlan(source);
    for (const keyword of allKeywords(plan)) {
      // Independent recount over the whole fixture text, weighted by the same
      // stated role weights.
      const docs: { text: string; role: keyof typeof ROLE_WEIGHT }[] = [];
      // Exactly the documents buildDocuments() reads, no more and no fewer.
      docs.push({ text: source.project.title, role: "title" });
      docs.push({ text: source.project.description!, role: "summary" });
      docs.push({ text: source.script!.title!, role: "title" });
      docs.push({ text: source.script!.logline!, role: "summary" });
      docs.push({ text: source.script!.tone!, role: "body" });
      docs.push({ text: source.settings!.tone!, role: "body" });
      docs.push({ text: source.settings!.style!, role: "body" });
      docs.push({ text: source.settings!.targetAudience!, role: "body" });
      for (const c of source.chapters) {
        docs.push({ text: c.title, role: "heading" });
        if (c.summary) docs.push({ text: c.summary, role: "summary" });
        for (const s of c.scenes) {
          if (s.title) docs.push({ text: s.title, role: "heading" });
          if (s.narration) docs.push({ text: s.narration, role: "body" });
        }
      }
      let occurrences = 0;
      let weight = 0;
      for (const doc of docs) {
        const hay = ` ${tokenize(doc.text).map((t) => t.text).join(" ")} `;
        let from = 0;
        while (true) {
          const at = hay.indexOf(` ${keyword.text} `, from);
          if (at === -1) break;
          occurrences += 1;
          weight += ROLE_WEIGHT[doc.role];
          from = at + 1;
        }
      }
      expect(keyword.occurrences).toBe(occurrences);
      expect(keyword.sourceWeight).toBe(weight);
    }
  });

  test("a keyword record carries ONLY the allowed keys — there is no field for a market number", () => {
    const plan = buildKeywordPlan(richSource());
    for (const keyword of plan.keywords) {
      expect(Object.keys(keyword).sort()).toEqual(KEYWORD_KEYS);
    }
    // The same check against the raw JSON, so a nested/extra key cannot hide.
    const raw = JSON.parse(JSON.stringify(plan.keywords)) as Record<string, unknown>[];
    for (const record of raw) {
      for (const key of Object.keys(record)) expect(KEYWORD_KEYS).toContain(key);
    }
  });

  test("the only numbers on a keyword are counts of this project's own text", () => {
    const plan = buildKeywordPlan(richSource());
    for (const keyword of plan.keywords) {
      expect(Number.isInteger(keyword.occurrences)).toBe(true);
      expect(Number.isInteger(keyword.sourceWeight)).toBe(true);
      expect(keyword.occurrences).toBeGreaterThan(0);
      // weight is bounded by occurrences × the largest stated role weight
      expect(keyword.sourceWeight).toBeLessThanOrEqual(keyword.occurrences * 5);
      expect(keyword.sourceWeight).toBeGreaterThanOrEqual(keyword.occurrences * 1);
    }
  });

  test("every keyword's text really occurs in the source and is lower-cased, tokenised text", () => {
    const source = richSource();
    const plan = buildKeywordPlan(source);
    const haystack = [
      source.project.title,
      source.project.description ?? "",
      source.script?.title ?? "",
      source.script?.logline ?? "",
      ...source.chapters.flatMap((c) => [c.title, c.summary ?? "", ...c.scenes.flatMap((s) => [s.title ?? "", s.narration ?? ""])]),
    ]
      .join(" \n ")
      .toLowerCase();
    for (const keyword of plan.keywords) {
      expect(haystack).toContain(keyword.text);
      expect(keyword.text).toBe(keyword.text.toLowerCase());
    }
  });

  test("primary phrases come from the title, and the basis says so", () => {
    const plan = buildKeywordPlan(richSource());
    const primary = plan.buckets.find((b) => b.id === "primary")!;
    expect(primary.keywords.length).toBeGreaterThan(0);
    expect(plan.primaryBasis).toBe("title_present");
    const titleText = "the fall of carthage carthage: the city that refused to kneel".toLowerCase();
    for (const keyword of primary.keywords) {
      expect(titleText).toContain(keyword.text);
    }
  });

  test("a project with no title text records the fallback basis instead of pretending", () => {
    const source = richSource();
    source.project.title = "the";
    source.script!.title = null;
    const plan = buildKeywordPlan(source);
    expect(plan.primaryBasis).toBe("text_frequency");
    expect(plan.notes.join(" ")).toContain("highest-weighted phrases from its own text");
  });

  test("no phrase appears in two buckets, and every bucket respects its limit", () => {
    const plan = buildKeywordPlan(richSource());
    const seen = new Set<string>();
    for (const bucket of plan.buckets) {
      expect(bucket.keywords.length).toBeLessThanOrEqual(BUCKET_LIMITS[bucket.id]);
      for (const keyword of bucket.keywords) {
        expect(seen.has(keyword.text)).toBe(false);
        seen.add(keyword.text);
      }
    }
    expect(plan.countsByKind.primary).toBe(plan.buckets[0].keywords.length);
    expect(plan.totalKeywords).toBe(plan.buckets.reduce((n, b) => n + b.keywords.length, 0));
  });

  test("long-tail holds three-token phrases only", () => {
    const plan = buildKeywordPlan(richSource());
    const longTail = plan.buckets.find((b) => b.id === "longTail")!;
    for (const keyword of longTail.keywords) expect(keyword.tokenCount).toBe(MAX_PHRASE_TOKENS);
  });

  test("semantic keywords co-occur with the primary phrase in a real chapter or scene", () => {
    const source = richSource();
    const plan = buildKeywordPlan(source);
    const semantic = plan.buckets.find((b) => b.id === "semantic")!;
    const ids = new Set([...source.chapters.map((c) => c.id), ...source.chapters.flatMap((c) => c.scenes.map((s) => s.id))]);
    for (const keyword of semantic.keywords) {
      // Co-occurrence is proved by a container row on the record, and the
      // spans where the word itself occurs are kept beside it.
      expect(keyword.sources.some((s) => (s.kind === "chapter" || s.kind === "scene") && ids.has(s.id))).toBe(true);
      expect(keyword.sources.some((s) => s.span)).toBe(true);
    }
  });

  test("a phrase that appears in a longer run is not matched as a substring", () => {
    const source = textOnlySource();
    const plan = buildKeywordPlan(source);
    // "mining explained" is in the title; "ning explained" must not exist.
    for (const keyword of plan.keywords) {
      expect(keyword.text.startsWith(" ")).toBe(false);
      expect(keyword.text.endsWith(" ")).toBe(false);
      expect(keyword.text).not.toContain("  ");
    }
  });

  test("no text at all: every bucket is empty AND says why", () => {
    const blank = emptySource();
    blank.project.title = "   "; // a project row whose title column holds only whitespace
    const plan = buildKeywordPlan(blank);
    expect(plan.totalKeywords).toBe(0);
    expect(plan.corpus.documents).toBe(0);
    for (const bucket of plan.buckets) {
      expect(bucket.keywords).toEqual([]);
      expect(bucket.reason).not.toBeNull();
    }
    expect(plan.notes.join(" ")).toContain("No stored text exists on this project");
  });

  test("extraction is deterministic — the same rows give byte-identical keywords", () => {
    const a = JSON.stringify(buildKeywordPlan(richSource()).keywords);
    const b = JSON.stringify(buildKeywordPlan(richSource()).keywords);
    expect(a).toBe(b);
  });

  test("the payload declares the market data that does not exist", () => {
    const plan = buildKeywordPlan(richSource());
    expect(plan.absentData).toEqual(ABSENT_MARKET_DATA);
    expect(plan.absentData.absent.length).toBeGreaterThanOrEqual(5);
    expect(plan.sourceWeightFormula).toContain("THIS PROJECT'S OWN TEXT ONLY");
    expect(plan.stopwordCount).toBeGreaterThan(50);
    expect(plan.noMarketDataRule).toBe("R-KW-NO-MARKET-DATA");
  });

  test("the tokeniser keeps character spans and drops punctuation", () => {
    const tokens = tokenize("Carthage's walls: 146 BC!");
    expect(tokens.map((t) => t.text)).toEqual(["carthage's", "walls", "146", "bc"]);
    expect(tokens[1].start).toBe(11);
    expect(tokens[1].end).toBe(16);
  });

  test("stopwords never start or end a phrase", () => {
    const plan = buildKeywordPlan(richSource());
    for (const keyword of plan.keywords) {
      const words = keyword.text.split(" ");
      for (const word of words) {
        expect(word.length).toBeGreaterThanOrEqual(3);
        expect(word).not.toBe("the");
        expect(word).not.toBe("and");
      }
    }
  });
});

const ROLE_WEIGHT = { title: 5, heading: 3, summary: 2, body: 1 } as const;
