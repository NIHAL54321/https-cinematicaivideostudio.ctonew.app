import { describe, expect, test } from "bun:test";
import { buildChapters } from "../chapters";
import { DESCRIPTION_CHARACTER_LIMIT, buildDescription } from "../description";
import { buildKeywordPlan } from "../keywords";
import { buildPinnedComment, PINNED_COMMENT_TEMPLATES } from "../pinned-comment";
import { buildTagPlan, HASHTAG_IN_DESCRIPTION_LIMIT, TAG_CHAR_BUDGET, TAG_LIMIT } from "../tags";
import { emptySource, richSource, textOnlySource } from "./fixtures";
import type { PublishingSource } from "../types";

function parts(source: PublishingSource) {
  const chapters = buildChapters(source);
  const keywords = buildKeywordPlan(source);
  const tags = buildTagPlan(source, keywords);
  const description = buildDescription(source, chapters, tags);
  const pinnedComment = buildPinnedComment(source, chapters, keywords);
  return { chapters, keywords, tags, description, pinnedComment };
}

describe("description — composed only from the project's own data", () => {
  test("title line is the project's own title, verbatim, with its source", () => {
    const { description } = parts(richSource());
    const title = description.sections.find((s) => s.id === "title")!;
    expect(title.included).toBe(true);
    expect(title.text.state === "derived" && title.text.value).toBe("The Fall of Carthage");
    expect(title.text.sources).toEqual([{ kind: "project", id: "proj_rich", path: "title" }]);
    expect(title.text.textOrigin).toBe("source_verbatim");
  });

  test("summary takes the most specific stored text and names which one it used", () => {
    const source = richSource();
    const { description } = parts(source);
    const summary = description.sections.find((s) => s.id === "summary")!;
    expect(summary.text.state === "derived" && summary.text.value).toBe(source.project.description!);
    expect(summary.text.sources[0].path).toBe("description");

    source.settings!.seoDefaultsDescription = "Written by the user for the description field.";
    const second = parts(source).description.sections.find((s) => s.id === "summary")!;
    expect(second.text.state === "derived" && second.text.value).toBe("Written by the user for the description field.");
    expect(second.text.sources[0].path).toBe("seoDefaults.description");

    const third = richSource();
    third.project.description = null;
    third.settings = null;
    const logline = parts(third).description.sections.find((s) => s.id === "summary")!;
    expect(logline.text.state === "derived" && logline.text.value).toBe(third.script!.logline!);
    expect(logline.text.sources[0].path).toBe("logline");
  });

  test("a missing summary omits the section and names all three missing inputs", () => {
    const source = richSource();
    source.project.description = null;
    source.script = null;
    const { description } = parts(source);
    const summary = description.sections.find((s) => s.id === "summary")!;
    expect(summary.included).toBe(false);
    expect(summary.text.state).toBe("empty_no_input");
    if (summary.text.state === "empty_no_input") {
      expect(summary.text.requires).toEqual([
        "ProjectSettings.seoDefaults.description",
        "Project.description",
        "Script.logline",
      ]);
    }
    expect(description.omitted.some((o) => o.id === "summary")).toBe(true);
  });

  test("no chapters: the chapter section is omitted with the real reason", () => {
    const { description } = parts(textOnlySource());
    const chapters = description.sections.find((s) => s.id === "chapters")!;
    expect(chapters.included).toBe(false);
    if (chapters.text.state === "empty_no_input") expect(chapters.text.reason).toContain("no chapter data");
    expect(description.includedSections).toEqual(["title", "summary", "hashtags"]);
  });

  test("the assembled text is only the included sections, in order, separated by blank lines", () => {
    const source = richSource();
    source.request = { callToAction: "Tell me which part of the siege you want next." };
    const { description } = parts(source);
    expect(description.text.state).toBe("derived");
    expect(description.includedSections).toEqual(["title", "summary", "chapters", "hashtags", "call_to_action"]);
    if (description.text.state === "derived") {
      const hashtagSection = description.sections.find((s) => s.id === "hashtags")!;
      const expected = [
        source.project.title,
        source.project.description!,
        "0:00 The Second Punic War\n5:00 The Third Punic War",
        hashtagSection.text.value as string,
        "Tell me which part of the siege you want next.",
      ].join("\n\n");
      expect(description.text.value).toBe(expected);
      expect(description.characterCount).toBe(expected.length);
      expect(description.withinLimit).toBe(true);
      expect(description.characterLimit).toBe(DESCRIPTION_CHARACTER_LIMIT);
    }
    // Every character of the description came from a named source: the
    // assembly has no sentence of its own.
    expect(description.text.sources.length).toBeGreaterThanOrEqual(5);
  });

  test("the call-to-action slot is empty-with-reason unless the caller supplies text", () => {
    const none = parts(richSource()).description.sections.find((s) => s.id === "call_to_action")!;
    expect(none.included).toBe(false);
    if (none.text.state === "empty_no_input") {
      expect(none.text.reason).toContain("no CTA column on a project");
      expect(none.text.requires).toEqual(["a callToAction string on the build request"]);
    }
    const supplied = richSource();
    supplied.request = { callToAction: "Subscribe for the next one." };
    const cta = parts(supplied).description.sections.find((s) => s.id === "call_to_action")!;
    expect(cta.included).toBe(true);
    expect(cta.text.sources[0]).toEqual({ kind: "request", id: "callToAction", path: "body.callToAction" });
  });

  test("a project with nothing at all produces no description and says why", () => {
    const blank = emptySource();
    blank.project.title = "";
    const { description } = parts(blank);
    expect(description.includedSections).toEqual([]);
    expect(description.text.state).toBe("empty_no_input");
    expect(description.characterCount).toBe(0);
    expect(description.withinLimit).toBe(true);
  });
});

describe("tags and hashtags", () => {
  test("tags come from the keywords then the stored metadata, each with provenance", () => {
    const source = richSource();
    const { tags, keywords } = parts(source);
    expect(tags.tagCount).toBeGreaterThan(0);
    const keywordTags = tags.tags.filter((t) => t.origin === "keyword");
    const metaTags = tags.tags.filter((t) => t.origin === "metadata");
    expect(keywordTags.length).toBeGreaterThan(0);
    for (const tag of keywordTags) {
      expect(keywords.keywords.some((k) => k.text === tag.text)).toBe(true);
      expect(tag.sources.length).toBeGreaterThan(0);
      expect(tag.textOrigin).toBe("source_verbatim");
    }
    for (const tag of metaTags) {
      expect(["documentary", "cinematic", "history enthusiasts"]).toContain(tag.text);
      expect(tag.sources[0].kind).toBe("project_settings");
    }
  });

  test("stored metadata becomes a tag, and a value that is also text is not duplicated", () => {
    const source = richSource();
    source.project.title = "Deep sea mining";
    source.project.description = null;
    source.script = null;
    source.chapters = [];
    source.settings = {
      seoDefaultsDescription: null,
      language: "en",
      tone: "documentary",
      style: "3D",
      targetAudience: null,
    };
    const { tags } = parts(source);
    // "3D" cannot be a keyword (its token is too short for the extractor), so it
    // reaches the tag list as stored metadata and says so.
    const styleTag = tags.tags.find((t) => t.text === "3D");
    expect(styleTag).toBeDefined();
    expect(styleTag!.origin).toBe("metadata");
    expect(styleTag!.sources).toEqual([{ kind: "project_settings", id: "proj_rich", path: "style" }]);
    // "documentary" IS in the project's own text, so it is a keyword tag; the
    // metadata copy is de-duplicated rather than listed twice.
    const occurrences = tags.tags.filter((t) => t.text.toLowerCase() === "documentary");
    expect(occurrences.length).toBeLessThanOrEqual(1);
    if (occurrences.length === 1) expect(occurrences[0].origin).toBe("keyword");
  });

  test("the tag budget is measured, not estimated, and stays inside the platform limits", () => {
    const { tags } = parts(richSource());
    expect(tags.tagCount).toBeLessThanOrEqual(TAG_LIMIT);
    expect(tags.tagCharacters).toBeLessThanOrEqual(TAG_CHAR_BUDGET);
    expect(tags.tagCharacters).toBe(tags.tags.map((t) => t.text).join(",").length);
    expect(tags.withinBudget).toBe(true);
    expect(tags.tagCharactersBasis).toContain("measured");
  });

  test("over-budget candidates are LISTED as skipped with a reason, not silently dropped", () => {
    const source = richSource();
    // Long words make long phrases, so 15 tags can cross the 500-character
    // budget; whichever ones do must be reported.
    source.project.title = "Extraterritorial jurisdictional harmonisation";
    source.project.description =
      "Extraterritorial jurisdictional harmonisation requires multinational organisations to reconcile incompatible regulatory frameworks across jurisdictions.";
    source.settings = { seoDefaultsDescription: null, language: "en", tone: null, style: null, targetAudience: null };
    source.script = null;
    const { tags } = parts(source);
    expect(tags.tagCharacters).toBeLessThanOrEqual(TAG_CHAR_BUDGET);
    expect(tags.tagCount).toBeLessThanOrEqual(TAG_LIMIT);
    if (tags.skipped.length > 0) {
      for (const skipped of tags.skipped) {
        expect(skipped.text.length).toBeGreaterThan(0);
        // The reason always names the bound that was hit.
        expect(skipped.reason).toMatch(/characters|tag limit/);
      }
      expect(tags.notes.join(" ")).toContain("skipped");
    }
    // Whatever happened, the accounting is exact.
    expect(tags.tagCharacters).toBe(tags.tags.map((t) => t.text).join(",").length);
  });

  test("hashtags are formed from keyword phrases and are reversible to them", () => {
    const source = richSource();
    const { tags, keywords } = parts(source);
    expect(tags.hashtagCount).toBeGreaterThan(0);
    expect(tags.hashtagCount).toBeLessThanOrEqual(tags.hashtagLimit);
    for (const hashtag of tags.hashtags) {
      expect(hashtag.text.startsWith("#")).toBe(true);
      expect(hashtag.text).not.toContain(" ");
      expect(keywords.keywords.some((k) => k.text === hashtag.phrase)).toBe(true);
      const rebuilt = `#${hashtag.phrase
        .split(" ")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join("")}`;
      expect(hashtag.text).toBe(rebuilt);
      expect(hashtag.sources.length).toBeGreaterThan(0);
    }
  });

  test("only the first hashtags are placed in the description; the rest are named", () => {
    const { tags } = parts(richSource());
    expect(tags.hashtagCount).toBeGreaterThan(HASHTAG_IN_DESCRIPTION_LIMIT);
    expect(tags.notPlacedInDescription.length).toBe(tags.hashtagCount - HASHTAG_IN_DESCRIPTION_LIMIT);
    expect(tags.hashtagLine.state).toBe("derived");
    if (tags.hashtagLine.state === "derived") {
      expect(tags.hashtagLine.value.split(" ").length).toBe(HASHTAG_IN_DESCRIPTION_LIMIT);
      expect(tags.hashtagLine.value).toBe(tags.hashtags.slice(0, HASHTAG_IN_DESCRIPTION_LIMIT).map((h) => h.text).join(" "));
    }
  });

  test("no hashtag is repeated", () => {
    const { tags } = parts(richSource());
    const seen = new Set(tags.hashtags.map((h) => h.text.toLowerCase()));
    expect(seen.size).toBe(tags.hashtags.length);
  });

  test("a project with no text and no settings produces no tags and says why", () => {
    const blank = emptySource();
    blank.project.title = "";
    const { tags } = parts(blank);
    expect(tags.tagCount).toBe(0);
    expect(tags.tags).toEqual([]);
    expect(tags.hashtagCount).toBe(0);
    expect(tags.hashtagLine.state).toBe("empty_no_input");
    expect(tags.notes.join(" ")).toContain("No tag could be derived");
  });
});

describe("pinned comment — rule-derived, and labelled as such", () => {
  test("the data model says how the words were produced", () => {
    const { pinnedComment } = parts(richSource());
    expect(pinnedComment.authorship).toBe("rule_derived");
    expect(pinnedComment.aiAuthored).toBe(false);
    expect(pinnedComment.modelAuthored).toBe(false);
    expect(pinnedComment.rule).toBe("R-PINNED-COMMENT");
    expect(pinnedComment.templateId).toBe("PC-CHAPTERS");
    expect(PINNED_COMMENT_TEMPLATES.map((t) => t.id)).toContain(pinnedComment.templateId);
  });

  test("the comment is built from the project's own topic and a real chapter row", () => {
    const source = richSource();
    const { pinnedComment } = parts(source);
    expect(pinnedComment.text.state).toBe("derived");
    if (pinnedComment.text.state === "derived") {
      expect(pinnedComment.text.value).toContain("The Second Punic War");
      expect(pinnedComment.text.textOrigin).toBe("template_filled");
    }
    expect(pinnedComment.topicPhrase.state).toBe("derived");
    expect(pinnedComment.quotes.some((q) => q.kind === "chapter" && q.id === "ch_1")).toBe(true);
    if (pinnedComment.topicPhrase.state === "derived") {
      const plan = buildKeywordPlan(source);
      expect(plan.keywords.some((k) => k.text === pinnedComment.topicPhrase.value)).toBe(true);
    }
  });

  test("the template and its placeholders are recorded, so the substitution is auditable", () => {
    const { pinnedComment } = parts(richSource());
    expect(pinnedComment.templateText).toContain("{chapter}");
    expect(pinnedComment.templateText).toContain("{topic}");
    if (pinnedComment.text.state === "derived") {
      expect(pinnedComment.text.value).not.toContain("{");
      expect(pinnedComment.text.note).toContain(pinnedComment.templateId);
    }
  });

  test("with scenes but no titled chapter the comment switches template", () => {
    const source = textOnlySource();
    source.chapters = [
      {
        id: "ch_x",
        scriptId: "scr_x",
        order: 1,
        title: "",
        summary: null,
        scenes: [
          { id: "sc_x", order: 1, title: null, narration: "Deep sea mining is a contested idea.", durationSeconds: 30, status: "DRAFT" },
        ],
      },
    ];
    const { pinnedComment } = parts(source);
    expect(pinnedComment.templateId).toBe("PC-SCENES");
    expect(pinnedComment.quotes.length).toBeGreaterThan(0);
  });

  test("a project with nothing to say gets an empty comment with a reason, not filler", () => {
    const blank = emptySource();
    blank.project.title = "";
    const { pinnedComment } = parts(blank);
    expect(pinnedComment.text.state).toBe("empty_no_input");
    if (pinnedComment.text.state === "empty_no_input") {
      expect(pinnedComment.text.reason).toContain("specific enough to pin");
      expect(pinnedComment.text.requires.length).toBeGreaterThan(0);
    }
    expect(pinnedComment.templateId).toBe("PC-GENERIC");
    expect(pinnedComment.quotes).toEqual([]);
  });
});
