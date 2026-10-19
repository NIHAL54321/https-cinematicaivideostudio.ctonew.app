/**
 * Phase 7 Block 1 — THE RULE CATALOGUE.
 *
 * Every derived value in a publishing package names the rule that produced it,
 * and this file is the one place those ids are resolved to what they actually
 * do. That is the difference between "provenance" and a decorative string: a
 * consumer can take `rule: "R-KW-WEIGHT"`, look it up here, and read the exact
 * weighting without reading the keyword code.
 *
 * Rules are declared here and imported by the modules that apply them, so a rule
 * id can never be printed that is not in this catalogue (the honesty audit
 * checks exactly that).
 */
import { CHAPTER_TIMECODE_BASIS } from "../export/chapters";

export const PUBLISHING_RULES = {
  /* ---------------------------------------------------------------- package */
  "R-PKG-SOURCE-FINGERPRINT": {
    what: "A deterministic FNV-1a 64-bit fingerprint over the ids and updatedAt stamps of every row the package was derived from.",
    basis: "Two packages built from the same rows carry the same fingerprint; a changed row changes it. No cryptographic claim is made — this is a change detector, not a signature.",
  },
  "R-PKG-COUNTS": {
    what: "Every count in `summary` is the length of the array it describes, or a walked count of the Fields in this package.",
    basis: "Counts are measured from this package's own contents at build time; none is stored, estimated or extrapolated.",
  },

  /* --------------------------------------------------------------- chapters */
  "R-CH-ORDER": {
    what: "Chapters in Chapter.order ascending, each chapter's scenes in Scene.order ascending.",
    basis: "The project's own stored narrative order. No chapter or scene is re-ordered, merged, split, added or dropped.",
  },
  "R-CH-TITLE": {
    what: "The chapter title is Chapter.title, character for character.",
    basis: "Chapter.title is a required column, so a chapter either has a title or the project has no chapters. A blank/whitespace title is reported empty-with-reason rather than filled with a positional label such as \"Chapter 1\".",
  },
  "R-CH-SUMMARY": {
    what: "The chapter summary is Chapter.summary, character for character.",
    basis: "Chapter.summary is optional; when it is null the summary is empty-with-reason and no summary text is written.",
  },
  "R-CH-TIMING": {
    what: "A chapter's start and duration are the sum of its scenes' Scene.durationSeconds in narrative order; chapter 1 starts at 0 s.",
    basis: "Only stored scene durations are summed. If ANY scene in the project has a null durationSeconds, no timing is emitted at all (empty-with-reason naming the count of scenes without a duration) — the arithmetic would otherwise be a guess about missing rows.",
  },
  "R-CH-BLOCK": {
    what: "The chapter block is one line per chapter, \"<timecode> <title>\", in chapter order.",
    basis: `${CHAPTER_TIMECODE_BASIS} The shape is the platform's published chapter-line format; this module makes no claim that the project meets the platform's minimums — see ./keywords and the section notes for what is and is not asserted.`,
  },

  /* ------------------------------------------------------------ description */
  "R-DESC-TITLE": {
    what: "The first description line is Project.title, character for character.",
    basis: "The project's own title column. Nothing is appended to it and no keyword is inserted into it.",
  },
  "R-DESC-SUMMARY": {
    what: "The summary paragraph is the FIRST of ProjectSettings.seoDefaults.description, Project.description, Script.logline that is a non-empty string.",
    basis: "Priority is the most specific stored text first: an explicit SEO description the user wrote, then the project's own synopsis, then the script's logline. The chosen source is named on the field; if none exists the section is omitted and all three missing inputs are named.",
  },
  "R-DESC-CHAPTERS": {
    what: "The chapter block from R-CH-BLOCK, verbatim.",
    basis: "Inserted only when the block exists; otherwise the section is omitted with the reason the block is empty.",
  },
  "R-DESC-HASHTAGS": {
    what: "The first HASHTAG_IN_DESCRIPTION_LIMIT hashtags from the hashtag plan, on one line.",
    basis: "Hashtags are placed once, at the end of the description; no hashtag is repeated and none is inserted into prose.",
  },
  "R-DESC-CTA": {
    what: "The call-to-action line is the caller's `callToAction` string, character for character.",
    basis: "This app stores no call-to-action field on a project, so nothing is invented for it. The slot is empty-with-reason unless the caller supplies the text, and when supplied the field is derived FROM THE REQUEST and says so.",
  },
  "R-DESC-ASSEMBLE": {
    what: "Sections in fixed order (title, summary, chapters, hashtags, call to action), separated by a blank line, with omitted sections leaving no placeholder text.",
    basis: "The assembled text is only the concatenation of its sections' own text plus blank lines, so the description can never contain a sentence that is not either the project's own text or the caller's call to action.",
  },

  /* ---------------------------------------------------------- pinned comment */
  "R-PINNED-COMMENT": {
    what: "The pinned comment is one of a small fixed set of templates, selected by which real structure the project has (chapters, then scenes, then neither), with the project's own derived topic phrase substituted in.",
    basis: "The comment is RULE-DERIVED, not model-authored: `authorship` is \"rule_derived\" and `aiAuthored` is false. The template id and the row ids it quotes (the chapter it names) are on the field.",
  },

  /* --------------------------------------------------------------- keywords */
  "R-KW-DOCUMENTS": {
    what: "The keyword corpus is the project's own stored text, one document per source field: Project.title, Project.description, Script.title, Script.logline, ProjectSettings.tone/style/targetAudience, every Chapter.title/summary and every Scene.title/narration.",
    basis: "Only rows of THIS project are read. No external corpus, no keyword database and no third-party service is consulted, so a keyword can always be traced to the characters inside this project that produced it.",
  },
  "R-KW-TOKEN": {
    what: "Text is lower-cased and split into tokens of letters, digits and internal apostrophes; every token keeps its character span in its document.",
    basis: "Deterministic and locale-independent, so the same text always yields the same tokens (and therefore the same keyword list) on any machine.",
  },
  "R-KW-STOPWORDS": {
    what: "A fixed, in-file stopword list is removed before phrases are formed.",
    basis: "The list is part of this file and is inspectable; it is never supplied by a service, so the keyword set cannot change without a commit.",
  },
  "R-KW-GRAMS": {
    what: "Candidate phrases are runs of 1 to 3 consecutive non-stopword tokens inside a document (word-count 1, 2 or 3); a run longer than three yields overlapping 3-token phrases plus their sub-phrases.",
    basis: "Phrases never span a stopword or a document boundary, so a phrase is always a contiguous string that really appears in the project's text.",
  },
  "R-KW-WEIGHT": {
    what: "Each occurrence is weighted by where it occurs: title 5, chapter title / scene title 3, logline / summary / topic 2, narration and other metadata 1. `sourceWeight` is the sum of the weights of a phrase's occurrences.",
    basis: "This is a measure of THIS PROJECT'S OWN TEXT ONLY — how prominently its own words are used. It is not search volume, difficulty, competition, trend or estimated traffic, and no such data exists anywhere in this product.",
  },
  "R-KW-BUCKETS": {
    what: "primary = the highest-`sourceWeight` 1–3-token phrases that ALSO occur in a title-role document (fallback: the highest-weight phrases, recorded as `basis: \"text_frequency\"`); secondary = the next highest-weight phrases; long-tail = phrases of three tokens; related = the remaining highest-weight phrases. A phrase appears in exactly one bucket, in descending sourceWeight within the bucket.",
    basis: "Bucket membership is a pure function of this project's text. The buckets are named groupings of the same extracted phrases — no phrase is invented to fill a bucket, and a bucket that cannot be filled from this project's text is empty and says so.",
  },
  "R-KW-SEMANTIC": {
    what: "`semantic` holds content tokens that occur in the SAME chapter or scene as the top primary phrase but are not already selected, most weighted first, each carrying the chapter/scene row ids it co-occurs in.",
    basis: "Co-occurrence is counted inside this project's own chapters and scenes — never in a search corpus.",
  },
  "R-KW-NO-MARKET-DATA": {
    what: "The keyword plan carries an explicit declaration that this product has no search-volume, difficulty, competition, trend or estimated-traffic data, and no such field exists on any keyword.",
    basis: "See ./audit: the package self-audits at build time and the build fails if any metric-shaped key can be found, so this declaration cannot drift away from the data.",
  },

  /* ------------------------------------------------------- tags & hashtags */
  "R-TAG-EXTRACT": {
    what: "Tags are the primary, secondary and long-tail phrases (in that order), then the stored project metadata (ProjectSettings.tone, .style, .targetAudience), de-duplicated case-insensitively, each keeping the provenance of where it came from.",
    basis: "Every tag is either a phrase extracted from the project's own text or a stored metadata value. No tag is added from a platform suggestion, a keyword tool or a list.",
  },
  "R-TAG-BUDGET": {
    what: "At most TAG_LIMIT tags, and at most TAG_CHAR_BUDGET characters in total; tags that would exceed either bound are reported as skipped rather than trimmed mid-word.",
    basis: "YouTube's published limits for the tags field: 15 tags and 500 characters in total. The character total is measured on the joined string, not estimated. Tags over the bound are LISTED as skipped — this app does not silently drop them.",
  },
  "R-HASHTAG-FORM": {
    what: "A hashtag is \"#\" followed by the phrase's tokens with the first letter of each token capitalised and all other characters lower-cased; tokens are joined with no separator.",
    basis: "A hashtag cannot contain a space, so the phrase's own tokens are joined. The transformation is stated and reversible back to its source phrase, which is recorded on every hashtag.",
  },
  "R-HASHTAG-BUDGET": {
    what: "At most HASHTAG_LIMIT hashtags are produced and at most HASHTAG_IN_DESCRIPTION_LIMIT are placed in the description; the rest are listed but not inserted.",
    basis: "YouTube's published behaviour: a video may carry up to 15 hashtags, more than 15 causes every hashtag to be ignored, and the first three listed appear above the title. This module produces at most the published limit and inserts only the ones that appear above the title.",
  },

  /* ---------------------------------------------------------------- titles */
  "R-TITLE-CATEGORY": {
    what: "A title option belongs to exactly one of the six categories the brief asked for: SEO, curiosity, the attention-pattern category (the brief's word for it is carried on the category record itself, as a declared label), emotional, educational and search-focused. Each category carries a one-line definition of the wording pattern it means and a plain statement that nothing about how the wording is received is known.",
    basis: "The category set is a fixed in-file list, so a category cannot appear that the brief did not ask for. A category that this project's own text cannot fill is empty and says why; it is never filled with a title that the rules did not produce.",
  },
  "R-TITLE-TEMPLATE": {
    what: "Every title option is a fixed in-file template with the project's own words substituted into its placeholders: {SUBJECT} is Project.title, {TOPIC} is the highest-weighted phrase this package extracted from the project's own stored text (title-cased: the first letter of each word is capitalised except the fixed small words a, and, in, of, the, to), and {CHAPTER} is a Chapter.title. The template, with its placeholders, is carried on every option as `templateText`.",
    basis: "The app contributes the template's own connective words and nothing else, and that template is the text the honesty audit phrase-scans — so a banned claim cannot be written by this app while a user's own words (which the audit does not police) can flow through unharmed. Every substituted fragment carries the row, field and character span it was read from. No title was written by a model: `authoredBy` on every option is \"rule_template\".",
  },
  "R-TITLE-SCORE": {
    what: "Each of the six axes on a title is the COUNT of the five named wordings listed for that axis that are present in the title, so every axis is a whole number from 0 to 5. The five named wordings are a fixed in-file list per axis, each evaluated by a stated test, and each axis record carries the per-wording verdicts it counted.",
    basis: "The score is a count of wordings in this title. It is not a measurement of any audience, not a market metric, not a comparison with any other video and not a prediction of how the title will be received — this product holds no data of that kind. Two of the six axes count overlapping wording shapes and the plan says so rather than implying six independent measurements.",
  },
  "R-TITLE-COUNT": {
    what: "`totalTitles` is the length of this plan's own title list, and `meetsMinimum` is that length compared with the minimum of 20 the brief asked for.",
    basis: "Counted from this package's own contents at build time. Nothing is estimated, padded or extrapolated, and a duplicate title is dropped rather than counted twice (the count of dropped duplicates is carried on the plan).",
  },
  "R-TITLE-MODEL-PATH": {
    what: "The plan carries the state of the model-authored title path for the `seo_generation` capability: the request field names the app's own request builder would send, the provider env var NAMES the app's registry derives, and what actually happened when the orchestrator was asked.",
    basis: "The app asks its own AI orchestrator for this capability on every build and records that call's own answer. Where the answer is that the capability cannot be reached, no request was attempted and no title is produced — the state is gated, no placeholder list is printed, and the enabling environment variable is named from the registry. When a provider really answers, its titles are recorded verbatim as provider-authored, naming the provider and model that returned them.",
  },
  "R-SEO-PROVIDER-SCREEN": {
    what: "Every string a provider returns for the `seo_generation` capability — a title, a description, a tag, a hashtag — is screened before it may become a value of this package: a claim of an outcome or of a search result this product does not make, and any search-volume / keyword-difficulty / competition / traffic number, are withheld and recorded verbatim with the provider's matched characters instead of being carried.",
    basis:
      "A provider's characters are a third party's words, so the honesty audit does not phrase-scan them — the right rule, and unchanged by this block. This screen sits IN FRONT of that exemption: nothing screened out can be read as a value of this package at all, and the page shows it only inside a withheld record that names the provider, the matched characters and the reason. It is a phrase-and-shape screen over a list this product already publishes: not a moderation model, not a policy engine and not legal clearance.",
  },

  /* ------------------------------------------------- thumbnails (P7-4) */
  "R-THUMB-CONCEPT": {
    what: "A thumbnail concept is a SPECIFICATION, not a picture: a fixed in-file combination of a dominant subject, an overlay text, a background specification, a style specification, a composition specification, a declared contrast pairing and an aspect, each produced from this project's own rows or from a fixed in-file list of this app's own design tokens.",
    basis:
      "The brief asks for image work and no image provider is connected here, so what is built is the part that can be real without one: the traced specification. No pixel is rendered, no stock image is substituted and no placeholder stands in for one — the image slot is declared absent on every concept (see R-THUMB-IMAGE-ABSENCE).",
  },
  "R-THUMB-TEXT": {
    what: "The overlay text of a concept is one candidate from a ladder built out of this project's own stored text, in a fixed order (Project.title, Script.title, every Chapter.title in order, every Scene.title in order, the highest-weighted phrase this package extracted, and its highest-weighted three-token phrase), de-duplicated case-insensitively; a candidate is dropped and counted when it is longer than the declared overlay word bound. Taken by position: concept n takes candidate n of the ladder.",
    basis:
      "Every candidate is the project's own characters, copied with the row, field and character span it was read from, so the overlay can always be traced to the text inside this project that produced it. The published phrase form is title-cased by the same stated normalisation the title engine uses; that is the only change this app makes to the characters, and it is stated on the value. Nothing is written into the overlay that the project's own rows do not contain.",
  },
  "R-THUMB-SUBJECT": {
    what: "The concept's one dominant subject is one candidate from a fixed ladder of subject roles — the highest-weighted phrase this package extracted, then Project.title, then Script.title, then each Chapter.title in order, then each Scene.title in order — taken by position (concept n takes candidate n of the ladder), de-duplicated, each carrying the row, field and span it was read from.",
    basis:
      "The subject is a row of this project, so a concept cannot name subject matter the project does not contain. The role list is in this app's own source file, so which candidates were available is inspectable, and a candidate is never invented to fill a role.",
  },
  "R-THUMB-BACKGROUND": {
    what: "The background is one entry of a fixed in-file list of background specifications — each naming a field, a separation between the subject and the field, a depth token and a tone hint — taken by which entry the concept's own ladder position selects, together with the project's stored tone/style as the value the choice rested on.",
    basis:
      "This describes the field a thumbnail would be built on, in this app's own design tokens. It is not an image, not a photograph and not a description of one: nothing here was rendered, sampled, fetched or inferred from any picture. The entry list is in this app's own source file, so the whole set of possible backgrounds is inspectable.",
  },
  "R-THUMB-STYLE": {
    what: "The style is one entry of a fixed in-file list of style specifications — each naming a typography family, a stroke token, a palette token and a keying token — taken by the concept's own ladder position, with the project's stored tone/style named as the value it rested on.",
    basis:
      "Every token in the entry is this app's own design vocabulary and is declared in this app's own source file. The style is a specification for work that has not been done: no typography has been set, no palette has been applied and no image exists.",
  },
  "R-THUMB-COMPOSITION": {
    what: "The composition is one entry of a fixed in-file list — each naming a zone for the subject, a different zone for the overlay text, a margin token and a text block shape — taken by the concept's own ladder position. Every entry in the list declares a text zone that is not the subject's zone.",
    basis:
      "The zones are named regions of the frame, not measurements of a picture, and the list is in this app's own source file. A pair of zones is a declaration this app makes, not an observation about any rendered frame.",
  },
  "R-THUMB-ASPECT": {
    what: "The aspect is derived from Project.targetAspectRatio: the stored SIXTEEN_NINE value gives the long-form 16:9 frame and NINE_SIXTEEN gives the Shorts 9:16 frame. Any other stored value, and a null column, give an empty-with-reason value naming that column rather than a chosen aspect.",
    basis:
      "The video's own stored shape decides the frame's shape, so a Shorts project and a long-form project cannot be given the same thumbnail shape by accident. When the column says nothing, the aspect is withdrawn and named, never defaulted.",
  },
  "R-THUMB-MOOD": {
    what: "The mood is this app's own mood token, selected from a fixed in-file tone→mood table using the project's stored Script.tone, then ProjectSettings.tone, then Script.style, then ProjectSettings.style; the token says which stored value it was read against, and a stored value that is not a key of the table gives this app's default mood token with that fact stated.",
    basis:
      "The mood token is this app's own vocabulary and the table is in this app's own source file, so the mapping is inspectable and is a rule rather than a judgement about the video. It is a declared token on a specification and makes no claim about how the finished thumbnail would be received.",
  },
  "R-THUMB-CONTRAST": {
    what: "The contrast pairing is one entry of a fixed in-file list of ink/field token pairings, selected by the concept's own background tone hint through the app's fixed coordination table, so the pairing declared on a concept always matches the tone hint its background declares.",
    basis:
      "The pairing is a DECLARATION of two of this app's own tokens, and it carries no ratio, no measurement and no number of any kind: this product has measured no image, and a ratio would be a measurement of one. See ./audit, which refuses a metric-shaped key anywhere in a package.",
  },
  "R-THUMB-COUNT": {
    what: "`totalConcepts` is the length of this plan's own concept list, `meetsMinimum` compares it with the minimum of 5 the brief asks for and `withinMaximum` compares it with the maximum of 10; `overlayTextsDropped` counts the candidates dropped as longer than the declared overlay word bound and `candidatesDropped` counts the ladder entries dropped as duplicates.",
    basis:
      "Counted from this plan's own contents at build time. Nothing is estimated, padded or extrapolated, and a concept is never added to reach the minimum: a project whose own rows offer fewer distinct overlay texts and subjects than the minimum produces fewer concepts and says so.",
  },
  "R-THUMB-CRITERION": {
    what: "Each of the nine criteria the brief asks for is the COUNT of five named wordings or declared tokens of that concept's own SPECIFICATION that are present, so every criterion is a whole number from 0 to 5, and each carries the five verdicts and the measurement that produced each one.",
    basis:
      "The criterion describes a specification this app wrote. No image exists to measure, so no verdict claims anything about a picture, about what a viewer would notice, or about how anyone would react — and several criteria count the same declared token, which the plan states rather than implying nine independent measurements. It is not search data, not a market metric and not a prediction of any kind.",
  },
  "R-THUMB-IMAGE-ABSENCE": {
    what: "Every concept's image slot is a GATED field: no image exists for it, none was rendered, fetched, generated or substituted, and the field names the provider environment variable NAMES the app's provider registry derives for the `thumbnail_generation` capability, together with which of those slots has a real call() implementation today.",
    basis:
      "There is no image provider on this server, so the honest value of the image slot is an absence with a named requirement. The environment variable names come from the app's own registry (src/lib/ai/providers/capability-env.ts), never from a literal list, so a gate can never print a name no code reads. No placeholder image, stock photograph or stand-in is used anywhere in this plan.",
  },
  "R-THUMB-RECORD": {
    what: "No Thumbnail row (prisma/schema.prisma) is written for any concept in this plan, so no generation status is recorded or reported. The plan carries the statuses this app refuses to write without a provider.",
    basis:
      "A Thumbnail row requires an Asset row and describes an image; writing one for a concept that produced no image would record a thing that does not exist. A PENDING/QUEUED/RUNNING row would additionally report work in progress that is not happening, which this product does not do.",
  },
  "R-THUMB-CONTROL": {
    what: "A control operates on the specification and returns a NEW traced concept whose one named ladder has been advanced by one position (or, for regenerate, whose variation position has been advanced by one), together with a change record naming the control, the part of the specification that moved, the candidate it moved from and to, the rule applied and the rows the new value was read from. A control with nothing to advance refuses and names the input that is missing.",
    basis:
      "The change is a change to the specification, and the record says so: no image changed, none exists, and a control can never report a picture it did not produce. The new concept is derived by the same rules as the original, so its whole specification — including its criteria and its image absence — is traced again from scratch.",
  },
  "R-THUMB-UPSCALE": {
    what: "The upscale control never operates. It is a GATED refusal naming the `upscaling` capability, the provider environment variable NAMES the app's registry derives for it, and the fact that no serving slot has a real call() implementation today.",
    basis:
      "Upscaling applies to an image, and no image exists for any concept in this plan; a control that appeared to enlarge something would be reporting a change that cannot have happened. The capability named is the registry's own id for enlarging an existing image (src/lib/ai/types.ts AI_CAPABILITIES), not a name invented here.",
  },
  "R-THUMB-MODEL-PATH": {
    what: "The plan carries the state of the model-backed concept path for the `thumbnail_generation` capability: the field names the app's own request builder would send, the provider env var NAMES the app's registry derives, and what actually happened when the orchestrator was asked for it.",
    basis:
      "The app asks its own AI orchestrator for this capability on every build and records that call's own answer. Where the answer is that the capability cannot be reached, no request was attempted, no concept is produced by a model and no placeholder concept list is printed. When a provider really answers, its answer is recorded verbatim as provider-authored and named as such; a provider's text never becomes a traced concept specification, because this app did not derive it.",
  },

  /* ---------------------------------------------------------- asset licences */
  "R-LIC-ROW": {
    what: "Provider/source, licence type, attribution text, licence URL, purchase date and expiry are copied from the asset's LicensingMetadata row.",
    basis: "One row per asset (LicensingMetadata.assetId is unique). A null column is reported empty-with-reason naming the column; it is never defaulted.",
  },
  "R-LIC-ATTR": {
    what: "`attributionRequired` is true when LicensingMetadata.attribution holds a non-empty string, and false when the row exists and the column is null/blank.",
    basis: "This is the app's own rule over the stored column, stated so a consumer can disagree with it. It is not legal advice and it is NOT used when no row exists.",
  },
  "R-LIC-EXPIRY": {
    what: "`expired` is true when LicensingMetadata.expiresAt is in the past at the moment the package was derived, false when it is in the future, and empty-with-reason when the column is null.",
    basis: "The comparison is against the derivation timestamp recorded on the package. A null expiry means the record does not say the licence expires — which is not the same as a licence that does not expire.",
  },
  "R-LIC-UNKNOWN": {
    what: "An asset with NO LicensingMetadata row is reported as `unknown_unverified` with every licence field empty-with-reason.",
    basis: "The single most dangerous assumption in a publishing tool is that an asset without a licence record is fine. Here it is not fine and not false: `attributionRequired` is empty, not false, and the entry says the licence is unknown and unverified.",
  },
  "R-LIC-ORIGIN": {
    what: "The asset's provider, model, the provider's own asset id and the provider's page URL, read from the asset's ORIGIN sub-row — StockAsset, GeneratedImage, GeneratedVideo or Voiceover — whichever exists.",
    basis:
      "Which row exists is a fact from the schema's own relation, not an inference from the asset's name or kind. A column the row does not carry is empty-with-reason: the provider is never guessed from a name, a file extension or an asset kind.",
  },

  /* -------------------------------------------- content screening (P7-6) */
  "R-SCR-AREA": {
    what: "One screening area: the named rule that read this project's own text, what it read, the pattern list it applied, how many characters it read, the flags it raised, and the part of the area that no capability in this app examines.",
    basis:
      "Seven areas are screened. Every area states its own rule's result and, separately, the part that needs a model, which is reported as not screened — no capability. A quiet rule reports that its pattern list did not match, which is not a pass; nothing in this section states that a video is lawful to publish.",
  },
  "R-SCR-FLAG": {
    what: "One flag: the row family, row id, field and exact character span a pattern matched, the characters themselves copied verbatim, why the rule fired, and what a person must check.",
    basis:
      "The matched characters are copied from the row and carried as source_verbatim, so the surface marks them as the project's own and this app's prose never contains them. Why-it-fired and what-to-check are this app's own sentences and are phrase-scanned like every other sentence it writes.",
  },
  "R-SCR-COPY-RIGHTS": {
    what: "Copyright: a quotation of twenty characters or more, rights/copyright language, and a copyright symbol, found in the project's title, description, script title and logline, chapter titles and summaries, scene titles and narration and asset names — plus the licence rows of the project's own assets.",
    basis:
      "A pattern list over the project's own text. This app cannot hear audio, cannot match footage, cannot fingerprint music and cannot read the licence a provider publishes, so finding nothing means the list did not match, not that the asset is licensed.",
  },
  "R-SCR-LICENCE-GAP": {
    what: "An asset on this project with no LicensingMetadata row is raised as a copyright flag, naming the asset row.",
    basis:
      "Read from the asset rows and the licence report, not from text. This app never treats a missing licence record as permission, and the flag says so in its own why-it-fired sentence.",
  },
  "R-SCR-ATTRIBUTION-MISSING": {
    what: "A licence row that stores attribution text, where the description this package assembled does not contain that text, is raised as a copyright flag naming the licence row.",
    basis:
      "Both halves are rows: the licence row's attribution column and the assembled description. Whether the licence requires the credit on screen, in the description, or in both places is written in the licence, which this app cannot read — so the flag asks a person to read it.",
  },
  "R-SCR-TRADEMARK": {
    what: "Trademark: a registered or unregistered mark symbol, a name on this app's short fixed sample list of well-known marks, and the words logo, brand or trademark, found in the project's own text.",
    basis:
      "A short sample list, not a trademark register: no register is consulted, no class or territory is checked, and no image is examined, so a logo inside footage raises nothing here.",
  },
  "R-SCR-ALLEGATION": {
    what: "Defamation: an allegation-shaped word found in the project's title, description, script title and logline, chapter titles and summaries, and scene titles and narration.",
    basis:
      "A pattern list of words that characterise a person or business badly. It cannot tell who a statement is about, whether it is true, or whether it is presented as fact or opinion — all of which are the questions a person must answer.",
  },
  "R-SCR-VOICE-CLONE": {
    what: "Voice cloning: voice-cloning, impression, mimicry or synthetic-voice language found in the project's own text and its voiceover asset names.",
    basis:
      "No speaker verification exists in this app, so it cannot compare a rendered track with a real person's voice. The rule reports what the project says about voices and nothing about the audio itself.",
  },
  "R-SCR-LIKENESS": {
    what: "Likeness: lookalike, face-swap, resemblance and likeness language found in the project's own text and the names of its image and video assets.",
    basis:
      "No face detection is wired (the registry holds a `face_detection` capability and no adapter serves it), so a face in a frame raises nothing here unless the project's own words mention it.",
  },
  "R-SCR-SYNTHETIC-DISCLOSURE": {
    what: "Misleading synthetic media: disclosure, reconstruction and generated-media language in the project's own text, evaluated alongside each asset's own origin row (stock, generated image, generated video, voiceover).",
    basis:
      "A text list plus row facts. Whether the produced video carries a disclosure in the frame where a viewer could be misled cannot be read: no produced file exists and no frame analysis is wired.",
  },
  "R-SCR-HARM": {
    what: "Illegal or harmful content: harm-shaped words (weapons, explosives, drugs, self-harm, violence, trafficking, instructions) found in the project's own text.",
    basis:
      "A coarse text list. It cannot see harm carried by images, demonstration or tone, and it flags words used in innocent contexts as readily as harmful ones, so every flag is for a person to read in context.",
  },
  "R-SCR-NO-CAPABILITY": {
    what: "A screening area's model-dependent part: reported as not screened — no capability, naming the capability that would be needed and, where the registry holds one, the provider env var NAMES it derives.",
    basis:
      "This app's capability registry holds no content-moderation capability at all, and the one detection capability relevant to likeness has no adapter. Reporting a result there would be inventing one, so the area reports the absence instead — and it can never appear as a pass.",
  },

  /* ------------------------------------------------- quality checker (P7-5) */
  "R-QUALITY-CHECK": {
    what: "One named check of this package's quality plan. Its state is pass, fail or not measured; every state carries the measurement sentence that produced it — the input read, the value computed, the threshold and where that threshold comes from.",
    basis:
      "A check is measured only from a stored row, a stored cue's timecodes, a produced file's own reported stream facts, or a declared export preset's own numbers. A check whose input does not exist is reported as not measured and NAMES the missing input; it is never reported as a pass, and it is never dropped from the list.",
  },
  "R-QUALITY-SCORE": {
    what: "The 0–100 score: round(100 × the summed weight of the PASSING measured checks ÷ the summed weight of ALL measured checks), using the weights declared per check in src/lib/publishing/quality.ts (they sum to 100).",
    basis:
      "Arithmetic over measured checks only. An unmeasured check is neither in the numerator nor in the denominator, so it can neither inflate nor deflate the number — and when no check was measured there is no score at all, only the statement that nothing could be measured and what would have to exist.",
  },
  "R-QUALITY-PROBE": {
    what: "The produced file's own reported facts: width, height, average and declared frame rate, duration, stream and container bitrates, video codec and the audio streams — read from ffprobe's machine-readable output, or absent with the missing input named.",
    basis:
      "The numbers are whatever the probe reported; a field the probe did not report is empty, never zero. This server has no produced file at all today, so this measurement is absent and every check that depends on it says so rather than assuming a pass.",
  },
  "R-QUALITY-SRT": {
    what: "Cue timings parsed from the stored SRT text of a Subtitle row: cue index, start and end in milliseconds, and the number of rendered lines in each cue.",
    basis:
      "Parsed from the row's own characters by its timecode lines. A block with no timecode is not a cue, so prose parsed as a subtitle track yields zero cues and the track check fails — rather than inventing timings for it.",
  },
  "R-QUALITY-SAFEAREA": {
    what: "The safe area a caption block must sit inside: the frame size measured from the produced file, minus the subtitle engine's own SUBTITLE_SAFE_MARGINS, compared with a block of the widest cue's line count at CAPTION_LINE_HEIGHT_PX, placed at the anchor stored in ProjectSettings.subtitleDefaults.",
    basis:
      "Every input is named and none is assumed: with no stored style, no stored anchor or no measured frame size, the check is not measured and lists exactly which of the three is missing.",
  },
  "R-QUALITY-TIMELINE": {
    what: "The timeline the timing, voice and coverage checks compare against: the sum of every scene's stored durationSeconds, or nothing at all when any scene carries no duration.",
    basis:
      "The same arithmetic the chapter block uses. One scene without a duration withdraws the whole total rather than shortening it, because a partial sum is a guess about the missing rows.",
  },
  "R-QUALITY-RENDER": {
    what: "The newest ExportJob row for the project, by createdAt: its status and its recorded errorMessage.",
    basis:
      "A job that has not reached a terminal status has reported nothing, so it is not measured rather than treated as a success; a FAILED job fails this check and names its own error message verbatim.",
  },
} as const satisfies Record<string, { what: string; basis: string }>;

/** Every rule id this block can emit. */
export type PublishingRuleId = keyof typeof PUBLISHING_RULES;

/** The rule ids, as a runtime list (used by the honesty audit). */
export const PUBLISHING_RULE_IDS = Object.keys(PUBLISHING_RULES) as PublishingRuleId[];

/** Resolve a rule id to its meaning; throws for an unknown id. */
export function explainRule(id: string): { id: string; what: string; basis: string } {
  const rule = (PUBLISHING_RULES as Record<string, { what: string; basis: string }>)[id];
  if (!rule) throw new Error(`explainRule(): unknown rule id "${id}"`);
  return { id, what: rule.what, basis: rule.basis };
}
