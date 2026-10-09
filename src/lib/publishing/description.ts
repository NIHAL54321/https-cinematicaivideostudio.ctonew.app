/**
 * Phase 7 Block 1 — DESCRIPTION, composed only from the project's real data.
 *
 * The five sections and their inputs:
 *   title           Project.title
 *   summary         the first of ProjectSettings.seoDefaults.description,
 *                   Project.description, Script.logline that is non-empty
 *   chapters        the derived chapter block (/chapters)
 *   hashtags        the first few hashtags (/tags)
 *   call to action  the caller's own text — this app stores no CTA field
 *
 * A section whose input is missing is OMITTED and carries the reason, naming the
 * input it wanted. No placeholder line, no "add your description here", and no
 * invented prose: the assembled text is the concatenation of its sections' own
 * text plus blank lines, so a description can never contain a sentence that came
 * from neither the project nor the caller.
 *
 * The description's length is MEASURED on the assembled string and compared with
 * the platform's published 5000-character limit.
 */
import { derived, emptyNoInput, type Field, type SourceRef } from "./provenance";
import type { ChapterPlanView } from "./chapters";
import type { TagPlan } from "./tags";
import type { PublishingRuleId } from "./rules";
import type { PublishingSource } from "./types";

/** YouTube's published maximum description length. */
export const DESCRIPTION_CHARACTER_LIMIT = 5000;

export type DescriptionSectionId = "title" | "summary" | "chapters" | "hashtags" | "call_to_action";

export interface DescriptionSection {
  id: DescriptionSectionId;
  label: string;
  rule: PublishingRuleId;
  /** True exactly when `text` is derived (never true for an omitted section). */
  included: boolean;
  text: Field<string>;
}

export interface DescriptionPlan {
  kind: "description";
  assembleRule: "R-DESC-ASSEMBLE";
  sectionOrder: DescriptionSectionId[];
  sections: DescriptionSection[];
  includedSections: DescriptionSectionId[];
  omitted: { id: DescriptionSectionId; label: string; reason: string; requires: string[] }[];
  /** The assembled description, or empty-with-reason when nothing could be composed. */
  text: Field<string>;
  characterCount: number;
  characterLimit: number;
  withinLimit: boolean;
  notes: string[];
}

const LABELS: Record<DescriptionSectionId, string> = {
  title: "Title line",
  summary: "Summary",
  chapters: "Chapters",
  hashtags: "Hashtags",
  call_to_action: "Call to action",
};

export function buildDescription(
  source: PublishingSource,
  chapters: ChapterPlanView,
  tags: TagPlan,
): DescriptionPlan {
  const notes: string[] = [];
  const { project, settings, script } = source;

  /* ------------------------------------------------------------ title */
  const titleText = project.title.trim();
  const titleSection: DescriptionSection = {
    id: "title",
    label: LABELS.title,
    rule: "R-DESC-TITLE",
    included: titleText.length > 0,
    text: titleText
      ? derived(titleText, "R-DESC-TITLE", [{ kind: "project", id: project.id, path: "title" }], {
          textOrigin: "source_verbatim",
          note: "The project's own title, copied character for character.",
        })
      : emptyNoInput(
          "This project's own title column holds no text, so there is no title line to write. No title was invented for it.",
          ["a non-blank Project.title"],
        ),
  };

  /* ---------------------------------------------------------- summary */
  const candidates: { text: string; ref: SourceRef }[] = [];
  if (settings?.seoDefaultsDescription?.trim()) {
    candidates.push({
      text: settings.seoDefaultsDescription.trim(),
      ref: { kind: "project_settings", id: project.id, path: "seoDefaults.description" },
    });
  }
  if (project.description?.trim()) {
    candidates.push({ text: project.description.trim(), ref: { kind: "project", id: project.id, path: "description" } });
  }
  if (script?.logline?.trim()) {
    candidates.push({ text: script.logline.trim(), ref: { kind: "script", id: script.id, path: "logline" } });
  }
  const chosen = candidates[0] ?? null;
  const summarySection: DescriptionSection = {
    id: "summary",
    label: LABELS.summary,
    rule: "R-DESC-SUMMARY",
    included: chosen !== null,
    text: chosen
      ? derived(chosen.text, "R-DESC-SUMMARY", [chosen.ref], {
          textOrigin: "source_verbatim",
          note: `Taken from ${chosen.ref.kind}(${chosen.ref.id}).${chosen.ref.path} — the most specific stored text this project has.`,
        })
      : emptyNoInput(
          "This project stores no summary text: ProjectSettings.seoDefaults.description, Project.description and Script.logline are all empty or absent, so the summary section is omitted.",
          ["ProjectSettings.seoDefaults.description", "Project.description", "Script.logline"],
        ),
  };

  /* --------------------------------------------------------- chapters */
  const chaptersSection: DescriptionSection = {
    id: "chapters",
    label: LABELS.chapters,
    rule: "R-DESC-CHAPTERS",
    included: chapters.block.state === "derived",
    text:
      chapters.block.state === "derived"
        ? derived(chapters.block.value, "R-DESC-CHAPTERS", chapters.block.sources, {
            textOrigin: "source_verbatim",
            note: "The chapter block from R-CH-BLOCK, inserted unchanged.",
          })
        : emptyNoInput(
            chapters.block.reason || "No chapter block could be derived from this project's rows.",
            chapters.block.requires,
          ),
  };

  /* --------------------------------------------------------- hashtags */
  const hashtagsSection: DescriptionSection = {
    id: "hashtags",
    label: LABELS.hashtags,
    rule: "R-DESC-HASHTAGS",
    included: tags.hashtagLine.state === "derived",
    text:
      tags.hashtagLine.state === "derived"
        ? derived(tags.hashtagLine.value, "R-DESC-HASHTAGS", tags.hashtagLine.sources, {
            textOrigin: "source_verbatim",
            note: "The hashtag line, placed once at the end of the description.",
          })
        : emptyNoInput(tags.hashtagLine.reason, tags.hashtagLine.requires),
  };

  /* ---------------------------------------------------- call to action */
  const cta = typeof source.request?.callToAction === "string" ? source.request.callToAction.trim() : "";
  const ctaSection: DescriptionSection = {
    id: "call_to_action",
    label: LABELS.call_to_action,
    rule: "R-DESC-CTA",
    included: cta.length > 0,
    text: cta
      ? derived(cta, "R-DESC-CTA", [{ kind: "request", id: "callToAction", path: "body.callToAction" }], {
          textOrigin: "source_verbatim",
          note: "Supplied by the caller in the request. This app stores no call-to-action field on a project, so nothing is written here unless a caller writes it.",
        })
      : emptyNoInput(
          "This project stores no call-to-action text (there is no CTA column on a project), and the caller supplied none, so the section is omitted. Nothing was written for it.",
          ["a callToAction string on the build request"],
        ),
  };

  const sections: DescriptionSection[] = [
    titleSection,
    summarySection,
    chaptersSection,
    hashtagsSection,
    ctaSection,
  ];

  const included = sections.filter((s) => s.included);
  const omitted = sections
    .filter((s) => !s.included && s.text.state === "empty_no_input")
    .map((s) => ({
      id: s.id,
      label: s.label,
      reason: (s.text as { reason: string }).reason,
      requires: (s.text as { requires: string[] }).requires,
    }));

  if (omitted.length > 0) {
    notes.push(
      `${omitted.length} description section(s) were omitted because their input is missing: ${omitted
        .map((o) => `${o.label} (${o.requires.join(" | ")})`)
        .join("; ")}.`,
    );
  }

  const assembled = included.map((s) => (s.text as { value: string }).value).join("\n\n");
  const text: Field<string> =
    included.length === 0
      ? emptyNoInput(
          "No description section could be composed: this project stores no usable text for any of the five sections.",
          ["Project.title", "a summary source", "chapter rows", "extractable text for hashtags"],
        )
      : derived(assembled, "R-DESC-ASSEMBLE", included.flatMap((s) => s.text.sources), {
          textOrigin: "source_verbatim",
          note: `The ${included.length} included section(s), separated by a blank line. The assembled text contains no sentence beyond those sections' own text.`,
        });

  return {
    kind: "description",
    assembleRule: "R-DESC-ASSEMBLE",
    sectionOrder: ["title", "summary", "chapters", "hashtags", "call_to_action"],
    sections,
    includedSections: included.map((s) => s.id),
    omitted,
    text,
    characterCount: assembled.length,
    characterLimit: DESCRIPTION_CHARACTER_LIMIT,
    withinLimit: assembled.length <= DESCRIPTION_CHARACTER_LIMIT,
    notes,
  };
}
