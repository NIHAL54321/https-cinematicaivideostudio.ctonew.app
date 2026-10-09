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

  const filled = template.text
    .replace("{chapter}", chapterTitle ?? "")
    .replace("{topic}", topic ?? "")
    .trim();

  const sources: SourceRef[] = quotes.length > 0 ? quotes : [{ kind: "project", id: source.project.id, path: "id" }];

  notes.push(
    `Written by rule from template ${template.id}; ${quotes.length > 0 ? `${quotes.length} source row(s) are quoted on this comment` : "no source row is quoted"}. No model was called and none is recorded as having answered.`,
  );
  notes.push(
    "A comment written specifically for this video instead of from a template is not part of this block: it would be model-authored, and the app is honest about that state rather than printing templated words as if a model wrote them.",
  );

  const text: Field<string> = derived(filled, "R-PINNED-COMMENT", sources, {
    textOrigin: "template_filled",
    note: `Template ${template.id} with its placeholders filled from this project's own rows.`,
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
    topicPhrase,
    quotes,
    notes,
  };
}
