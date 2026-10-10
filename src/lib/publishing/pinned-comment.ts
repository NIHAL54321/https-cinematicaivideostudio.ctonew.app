/**
 * Phase 7 Block 1 — PINNED COMMENT, rule-derived and labelled as such.
 *
 * This is NOT model output. It is one of five fixed templates, selected by which
 * real structure the project has, with the project's own derived topic phrase (or
 * its own chapter title) substituted in. The payload says so in the data model:
 * `authorship: "rule_derived"`, `aiAuthored: false`, plus the template id and the
 * template text WITH its placeholders, so the substitution is auditable rather
 * than taken on trust.
 *
 * If no topic phrase and no chapter title exist — because the project stores no
 * text at all — the comment is empty-with-reason. A generic "Thanks for watching"
 * is emitted only when the project genuinely has structure to thank someone for
 * (a chapter or scene), never as filler for an empty project.
 */
import { derived, emptyNoInput, type Field, type SourceRef } from "./provenance";
import { quotation, quotedFragment, renderQuotation, type QuotedFragment } from "./quotation";
import { primaryTopicPhrase, type KeywordPlan } from "./keywords";
import type { ChapterPlanView } from "./chapters";
import type { PublishingSource } from "./types";

export interface PinnedCommentTemplate {
  id: string;
  /** The template with its placeholders, so a reader can see what was substituted. */
  text: string;
}

export const PINNED_COMMENT_TEMPLATES: readonly PinnedCommentTemplate[] = [
  {
    id: "PC-CHAPTERS",
    text: 'Chapters are in the description — "{chapter}" is the first one if you want to jump in. What should {topic} cover next?',
  },
  {
    id: "PC-CHAPTERS-NOTOPIC",
    text: 'Chapters are in the description — "{chapter}" is the first one if you want to jump in.',
  },
  {
    id: "PC-SCENES",
    text: "Thanks for watching. This one covers {topic} — which part should I go deeper on next?",
  },
  {
    id: "PC-SCENES-NOTOPIC",
    text: "Thanks for watching. Which part should I go deeper on next?",
  },
  {
    id: "PC-GENERIC",
    text: "Thanks for watching.",
  },
] as const;

export interface PinnedComment {
  kind: "pinned_comment";
  /** The comment text, or empty-with-reason when nothing could be said honestly. */
  text: Field<string>;
  /** How the words were produced. This app wrote them from a fixed template. */
  authorship: "rule_derived";
  aiAuthored: false;
  modelAuthored: false;
  /** True when a provider would be needed to author a BESPOKE comment instead. */
  bespokeWouldNeedProvider: true;
  rule: "R-PINNED-COMMENT";
  templateId: string;
  templateText: string;
  /**
   * The project's own characters substituted into the template, each attributed
   * to the row it was read from. Empty when the template substitutes nothing (the
   * comment is then entirely this app's own words).
   */
  fragments: QuotedFragment[];
  topicPhrase: Field<string>;
  /** The rows the comment quotes (a chapter title), for traceability. */
  quotes: SourceRef[];
  notes: string[];
}

export function buildPinnedComment(
  source: PublishingSource,
  chapters: ChapterPlanView,
  keywords: KeywordPlan,
): PinnedComment {
  const notes: string[] = [];
  const topicPhrase = primaryTopicPhrase(keywords, source);
  const topic = topicPhrase.state === "derived" ? topicPhrase.value : null;

  const firstTitledChapter = chapters.entries.find((e) => e.title.state === "derived");
  const chapterTitle = firstTitledChapter ? (firstTitledChapter.title as { value: string }).value : null;

  let template: PinnedCommentTemplate;
  const quotes: SourceRef[] = [];
  if (chapterTitle && topic) {
    template = PINNED_COMMENT_TEMPLATES[0];
    quotes.push(...firstTitledChapter!.title.sources, ...topicPhrase.sources);
  } else if (chapterTitle) {
    template = PINNED_COMMENT_TEMPLATES[1];
    quotes.push(...firstTitledChapter!.title.sources);
  } else if (chapters.sceneCount > 0 && topic) {
    template = PINNED_COMMENT_TEMPLATES[2];
    quotes.push(...topicPhrase.sources);
  } else if (chapters.sceneCount > 0) {
    template = PINNED_COMMENT_TEMPLATES[3];
  } else {
    template = PINNED_COMMENT_TEMPLATES[4];
  }

  // The characters this app substitutes into its own template are declared as
  // FRAGMENTS (see ./quotation): the sentence stays the app's, the two quoted
  // stretches stay the project's, and the honesty audit scans the template while
  // checking that the substitution is exactly what is declared. A project whose
  // own words contain a phrase this app's prose may not use therefore still
  // builds, and nothing about the quotation is hidden.
  const fragments: QuotedFragment[] = [];
  if (chapterTitle !== null && template.text.includes("{chapter}")) {
    fragments.push(
      quotedFragment({
        placeholder: "{chapter}",
        text: chapterTitle,
        sources: firstTitledChapter!.title.sources,
        from: `Chapter.title of the project's first chapter row, character for character (chapter row ${firstTitledChapter!.chapterId})`,
      }),
    );
  }
  if (topic !== null && template.text.includes("{topic}")) {
    fragments.push(
      quotedFragment({
        placeholder: "{topic}",
        text: topic,
        sources: topicPhrase.sources,
        from: "the highest-weighted phrase this package extracted from the project's own stored text (see the topic phrase above)",
      }),
    );
  }

  const filled = renderQuotation(template.text, fragments).trim();

  const sources: SourceRef[] = quotes.length > 0 ? quotes : [{ kind: "project", id: source.project.id, path: "id" }];

  notes.push(
    `Written by rule from template ${template.id}; ${quotes.length > 0 ? `${quotes.length} source row(s) are quoted on this comment` : "no source row is quoted"}. No model was called and none is recorded as having answered.`,
  );
  notes.push(
    "A comment written specifically for this video instead of from a template is not part of this block: it would be model-authored, and the app is honest about that state rather than printing templated words as if a model wrote them.",
  );

  // A template with nothing substituted is entirely this app's own words, so it
  // is declared as such and phrase-scanned like any other sentence. A template
  // with the project's characters in it is declared as a QUOTATION instead, with
  // its template and its fragments, so the audit scans the one and checks the
  // other (see ./quotation).
  const text: Field<string> =
    fragments.length === 0
      ? derived(filled, "R-PINNED-COMMENT", sources, {
          textOrigin: "rule_authored",
          note: `Template ${template.id} with nothing substituted into it: every word of this comment was written by this app.`,
        })
      : derived(quotation(template.text, fragments).text, "R-PINNED-COMMENT", sources, {
          textOrigin: "template_filled",
          templateText: template.text,
          fragments,
          note: `Template ${template.id} with its placeholders filled from this project's own rows; the substituted characters are declared as fragments on this comment, with the row each was read from.`,
        });

  if (template.id === "PC-GENERIC") {
    return {
      kind: "pinned_comment",
      text: emptyNoInput(
        "This project stores no chapter, scene or extractable text, so the only template it can support is a bare acknowledgement. Nothing specific enough to pin was written.",
        ["chapter rows, scene rows, or any stored project text"],
        {
          note: `Template PC-GENERIC would read "${template.text}", but a comment with no source row behind it is not worth pinning and is reported empty instead.`,
        },
      ),
      authorship: "rule_derived",
      aiAuthored: false,
      modelAuthored: false,
      bespokeWouldNeedProvider: true,
      rule: "R-PINNED-COMMENT",
      templateId: template.id,
      templateText: template.text,
      fragments,
      topicPhrase,
      quotes: [],
      notes,
    };
  }

  return {
    kind: "pinned_comment",
    text,
    authorship: "rule_derived",
    aiAuthored: false,
    modelAuthored: false,
    bespokeWouldNeedProvider: true,
    rule: "R-PINNED-COMMENT",
    templateId: template.id,
    templateText: template.text,
    fragments,
    topicPhrase,
    quotes,
    notes,
  };
}
