/**
 * Phase 7 Block 3b follow-up — the RENDER half of the quotation fix.
 *
 * `./quotation` proves a sentence is a quotation (the app's own template + the
 * project's declared fragments, reproducing character for character) and `./audit`
 * refuses to exempt one that is not. What those two cannot do is tell a SURFACE
 * which characters of the rendered sentence are the project's. `quoted-text.ts`
 * does exactly that, and these tests hold it to two rules:
 *
 *   1. the marked characters are exactly the substituted fragments — the app's
 *      own wording around them is never marked, and the segments still
 *      concatenate back to the sentence as it reads, character for character;
 *   2. a value that is not a verified quotation is never marked: no fragments, a
 *      non-`template_filled` origin, or a sentence carrying characters no
 *      declared fragment accounts for, all render as this app's own sentence.
 *
 * Rule 2 is the one that matters for a reader: marking is evidence of authorship,
 * so it is refused wherever the evidence is missing.
 */
import { describe, expect, test } from "bun:test";
import { inspectQuotation, quotation, quotationSegments, quotedFragment, renderQuotation } from "../quotation";
import { derived, type SourceRef } from "../provenance";
import { quotedCharacters, quotedSegments } from "../quoted-text";
import { studioValue } from "../studio-view";

const SOURCE: SourceRef[] = [{ kind: "project", id: "p1", path: "title", span: { start: 18, end: 28 } }];

/**
 * The real P7-3 shape, taken from the shipped package: a verdict this app wrote,
 * naming the title's first word. The word inside the quotation marks is the
 * project's, and it is the only part of the sentence that is.
 */
function measurementQuote(word: string) {
  return quotation('first word of the title: "{WORD}"', [
    quotedFragment({
      placeholder: "{WORD}",
      text: word,
      sources: SOURCE,
      from: "the first word of the title, read from Project.title character for character",
    }),
  ]);
}

/** A value as the view model builds it for that row. */
function quotedValue(word: string) {
  const quote = measurementQuote(word);
  return studioValue(
    "First-word measurement",
    derived(quote.text, "R-TITLE-TEMPLATE", SOURCE, {
      textOrigin: "template_filled",
      templateText: quote.templateText,
      fragments: quote.fragments,
      note: "The verdict is this app's own; the word inside the quotation marks is the project's.",
    }),
  );
}

describe("quotationSegments — which characters are the project's", () => {
  test("marks exactly the substituted fragment, and nothing of the app's wording", () => {
    const segments = quotationSegments('first word of the title: "{WORD}"', measurementQuote("viral").fragments);
    expect(segments).toEqual([
      { text: 'first word of the title: "', quoted: false },
      {
        text: "viral",
        quoted: true,
        from: "the first word of the title, read from Project.title character for character",
        textOrigin: "source_verbatim",
      },
      { text: '"', quoted: false },
    ]);
    expect(quotedCharacters(segments)).toEqual(["viral"]);
  });

  test("the segments concatenate back to the sentence as it reads, character for character", () => {
    const cases: { template: string; fragments: string[] }[] = [
      { template: "{A} and {B}", fragments: ["one", "two"] },
      { template: "{A}{A}", fragments: ["x"] },
      { template: "no placeholder here", fragments: [] },
      { template: "{A} — a dash is this app's", fragments: ["phrase"] },
      { template: "a {A} b {B} c", fragments: ["1", "2"] },
    ];
    for (const testCase of cases) {
      const slots = [...new Set(testCase.template.match(/\{[A-Za-z0-9_]+\}/g) ?? [])];
      const built = slots.map((placeholder, i) =>
        quotedFragment({
          placeholder,
          text: testCase.fragments[i] ?? `unused-${i}`,
          sources: SOURCE,
          from: "a fixture fragment",
        }),
      );
      const segments = quotationSegments(testCase.template, built);
      // The same characters ./audit renders when it checks the substitution.
      expect(segments.map((s) => s.text).join("")).toBe(renderQuotation(testCase.template, built));
      expect(quotedCharacters(segments)).toEqual(
        (testCase.template.match(/\{[A-Za-z0-9_]+\}/g) ?? []).map(
          (placeholder) => testCase.fragments[slots.indexOf(placeholder)] ?? "",
        ),
      );
    }
  });

  test("a repeated placeholder is marked at every occurrence it was substituted into", () => {
    const quote = quotation("{WORD} then {WORD} again", measurementQuote("viral").fragments);
    const segments = quotationSegments(quote.templateText, quote.fragments);
    expect(quotedCharacters(segments)).toEqual(["viral", "viral"]);
    expect(segments.map((s) => s.text).join("")).toBe(quote.text);
  });

  test("a placeholder no fragment declares stays unquoted — it is this app's own characters", () => {
    const renamed = measurementQuote("viral").fragments.map((fragment) => ({ ...fragment, placeholder: "{KNOWN}" }));
    const segments = quotationSegments('{KNOWN} then "{UNKNOWN}"', renamed);
    expect(quotedCharacters(segments)).toEqual(["viral"]);
    expect(segments.map((s) => s.text).join("")).toBe('viral then "{UNKNOWN}"');
  });
});

describe("quotedSegments — a value that quotes is marked, one that does not is not", () => {
  test("the real measured-quote value marks the project's word and leaves the app's verdict unmarked", () => {
    const segments = quotedSegments(quotedValue("viral"));
    expect(segments).not.toBeNull();
    expect(quotedCharacters(segments!)).toEqual(["viral"]);
    expect(segments!.map((s) => s.text).join("")).toBe('first word of the title: "viral"');
    expect(segments!.filter((s) => !s.quoted).map((s) => s.text).join("")).toBe('first word of the title: ""');
  });

  test("the two halves of the fix agree: the audit verifies exactly what the surface marks", () => {
    const quote = measurementQuote("viral");
    const declaration = {
      value: quote.text,
      textOrigin: quote.textOrigin,
      templateText: quote.templateText,
      fragments: quote.fragments,
    };
    expect(inspectQuotation(declaration).status).toBe("verified");
    expect(quotedSegments(quotedValue("viral"))).not.toBeNull();
    // One character added to the sentence and nobody declared it: the audit calls
    // the declaration unverifiable, and the surface refuses to mark anything.
    const tamperedValue = studioValue(
      "First-word measurement",
      derived(`${quote.text}!`, "R-TITLE-TEMPLATE", SOURCE, {
        textOrigin: "template_filled",
        templateText: quote.templateText,
        fragments: quote.fragments,
      }),
    );
    expect(inspectQuotation({ ...declaration, value: `${quote.text}!` }).status).toBe("invalid");
    expect(quotedSegments(tamperedValue)).toBeNull();
  });

  test("a template_filled value that declares no fragments is never marked", () => {
    const value = studioValue(
      "Pinned comment",
      derived("a sentence this app wrote", "R-PINNED-TEXT", SOURCE, { textOrigin: "template_filled" }),
    );
    expect(quotedSegments(value)).toBeNull();
  });

  test("a value whose characters are its own declared copy is not marked", () => {
    const value = studioValue(
      "Project phrase",
      derived("a phrase taken from the project", "R-TAG-EXTRACT", SOURCE, { textOrigin: "source_verbatim" }),
    );
    expect(quotedSegments(value)).toBeNull();
  });

  test("an empty or gated value is not marked — it carries no sentence at all", () => {
    expect(
      quotedSegments(
        studioValue("Missing input", { state: "empty_no_input", reason: "no such row", requires: ["a row"] }),
      ),
    ).toBeNull();
    expect(
      quotedSegments(
        studioValue("Model-written title", {
          state: "gated_provider",
          reason: "no provider key is set",
          requires: ["a provider key"],
          envVars: ["OPENAI_API_KEY"],
        }),
      ),
    ).toBeNull();
  });

  test("a template with no placeholder in it marks nothing, even when fragments are declared", () => {
    const value = studioValue(
      "Filled value",
      derived("a sentence this app wrote", "R-PINNED-TEXT", SOURCE, {
        textOrigin: "template_filled",
        templateText: "a sentence this app wrote",
        fragments: measurementQuote("viral").fragments,
      }),
    );
    expect(quotedSegments(value)).toBeNull();
  });

  test("a value whose text is not a string is not marked", () => {
    expect(quotedSegments(studioValue("Scene count", derived(4, "R-CHAP-SCENE-COUNT", SOURCE)))).toBeNull();
  });

  test("several fragments: each project phrase is marked and the app's separators are not", () => {
    const quote = quotation(
      "{TAG_1}, {TAG_2}",
      [
        quotedFragment({
          placeholder: "{TAG_1}",
          text: "viral marketing",
          sources: SOURCE,
          from: "a phrase from the project's own text by R-TAG-EXTRACT",
        }),
        quotedFragment({
          placeholder: "{TAG_2}",
          text: "guaranteed growth",
          sources: SOURCE,
          from: "a phrase from the project's own text by R-TAG-EXTRACT",
        }),
      ],
    );
    const value = studioValue(
      "Tag line",
      derived(quote.text, "R-TAG-EXTRACT", SOURCE, {
        textOrigin: "template_filled",
        templateText: quote.templateText,
        fragments: quote.fragments,
      }),
    );
    const segments = quotedSegments(value);
    expect(segments).not.toBeNull();
    expect(quotedCharacters(segments!)).toEqual(["viral marketing", "guaranteed growth"]);
    expect(segments!.map((s) => s.text).join("")).toBe("viral marketing, guaranteed growth");
    // The comma between them is this app's own character, and it is unmarked.
    expect(segments!.filter((s) => !s.quoted).map((s) => s.text).join("")).toBe(", ");
  });
});
