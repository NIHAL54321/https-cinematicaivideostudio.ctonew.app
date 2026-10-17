/**
 * Phase 7 Block 6 — CONTENT SCREENING, and the licence report's own limits.
 *
 * WHAT THIS MODULE IS. Seven risk areas, each with a NAMED RULE that reads this
 * project's own rows, and each with an honest account of the part of the area that
 * this app cannot examine at all. A rule does one thing: it finds characters in the
 * project's own text and reports them as a FLAG — the row, the field, the exact
 * character span, the characters themselves, why the rule fired, and what a person
 * has to check. It does not decide anything.
 *
 * WHAT IT IS NOT, and why the words matter:
 *
 *   - A flag is not a finding of infringement, defamation or anything else. The
 *     rule matched characters; whether those characters are a problem is a legal
 *     judgement this app does not make and cannot make.
 *   - A rule that matched nothing reports EXACTLY THAT — "nothing matching this
 *     rule in the project's own text" — and never "clear", "clean", "safe" or
 *     "pass", because a pattern list finding nothing says nothing about the area.
 *   - The part of every area that needs a model is "not screened — no capability",
 *     and it stays that way until such a capability exists. There is no moderation
 *     capability in this app's registry at all (src/lib/ai/types.ts
 *     AI_CAPABILITIES has twenty-one entries and none of them examines content for
 *     risk), and no adapter for the one detection capability that is registered.
 *     So the bytes of a video, the faces in it, whose voice a track reproduces and
 *     whether a sentence is defamatory are NOT examined by anything here.
 *   - Consequently nothing in this section, in the package, or on the surface may
 *     be read as legal clearance. The report carries that statement in its own
 *     DATA, so no consumer can upgrade it.
 *
 * PROVENANCE. Every flag is a `Field`: the matched characters are
 * `source_verbatim` (the project's own, carried with the row/field/span they were
 * read from, and rendered marked as the project's own — see ./quoted-text), while
 * the rule's own sentences are `rule_authored` and therefore phrase-scanned by
 * ./audit exactly like every other sentence this app writes. App-authored sentence
 * never embeds the project's characters: the words the rule matched are only ever
 * in the `matched` field. That is what keeps a project whose own text contains a
 * banned claim from failing its own build (see ./quotation).
 */
import { derived, emptyNoInput, type Field, type SourceKind, type SourceRef } from "./provenance";
import type { PublishingRuleId } from "./rules";
import type { AssetLicenceEntry, AssetLicenceReport } from "./licensing";
import type { PublishingSource } from "./types";

/** The seven risk areas this block was asked to screen for. */
export const SCREENING_AREA_IDS = [
  "copyright",
  "trademark",
  "defamation",
  "voice_cloning",
  "likeness",
  "synthetic_media",
  "illegal_harmful",
] as const;
export type ScreeningAreaId = (typeof SCREENING_AREA_IDS)[number];

/**
 * What a rule reported. There is deliberately no "pass" member: a rule that found
 * nothing says `nothing_matching_this_rule`, in those words, on the value itself.
 */
export type ScreeningRuleStatus = "flags_found" | "nothing_matching_this_rule";

/** The state of the part of an area that needs a model. There is only one today. */
export type ScreeningCapabilityState = "not_screened_no_capability";

/** The literal phrase the surface and the data both use. Never a synonym. */
export const NOT_SCREENED_PHRASE = "Not screened — no capability";
/** The literal phrase a rule with no match reports. Never "clear" or "pass". */
export const NOTHING_MATCHING_PHRASE = "Nothing matching this rule in the project's own text";

/** One pattern list entry: a name, and the expression that finds it. */
export interface ScreeningProbe {
  id: string;
  label: string;
  /** Serialised source, so the rule's own definition can be printed. */
  pattern: string;
  flags: string;
}

/**
 * What the caller knows about a capability an area would need. The publishing
 * service derives these from the app's own provider registry (names only, never
 * values); the DEFAULT supplied here claims nothing about any provider.
 */
export interface ScreeningCapabilityFact {
  /** Registry capability id, or null when the app has no such capability at all. */
  capabilityId: string | null;
  /** True when that id is a registered capability (src/lib/ai/types.ts). */
  registered: boolean;
  /** Provider slots with a real call() implementation today. */
  wiredProviderIds: string[];
  /** Provider env var NAMES the registry derives. Never values. */
  envVars: string[];
  /** The honest sentence: what an operator would have to add. */
  requirement: string;
}

export type ScreeningCapabilityFacts = Partial<Record<ScreeningAreaId, ScreeningCapabilityFact>>;

/** One character span in the project's own text that a named rule matched. */
export interface ScreeningFlag {
  id: string;
  area: ScreeningAreaId;
  rule: PublishingRuleId;
  probeId: string;
  probeLabel: string;
  /** The row family, the row id, the field, and the span inside that field. */
  rowKind: SourceKind;
  rowId: string;
  field: string;
  span: { start: number; end: number };
  /** The characters the rule matched, copied from the row. Never re-worded. */
  matched: Field<string>;
  /** Why this rule fired, in this app's words. Never contains the project's characters. */
  whyItFired: Field<string>;
  /** What a person must check about this span. */
  humanMustCheck: Field<string>;
}

/** One area's result: what the rule reported, and what could not be screened. */
export interface ScreeningAreaResult {
  area: ScreeningAreaId;
  label: string;
  /** The question a person is trying to answer in this area. */
  question: string;
  status: ScreeningRuleStatus;
  /** The phrase the surface renders for this status. Never "clear". */
  statusLabel: string;
  rule: PublishingRuleId;
  /** What the rule reads, in this app's words. */
  reads: string;
  /** The pattern list the rule applied, printed so a reader can check it. */
  probes: ScreeningProbe[];
  /** How many characters of the project's own text the rule read. */
  charactersRead: Field<number>;
  /** How many fields it read. */
  fieldsRead: number;
  flags: ScreeningFlag[];
  /** Occurrences found beyond the per-area listing cap. Counted, never hidden. */
  flagsNotListed: number;
  /** The part of this area no capability in this app examines. */
  capability: {
    state: ScreeningCapabilityState;
    statusLabel: string;
    capabilityId: string | null;
    registered: boolean;
    wiredProviderIds: string[];
    envVars: string[];
    requirement: string;
    /** What this app cannot determine about the area, said plainly. */
    cannotDetermine: string[];
  };
  /** What a human must check when this area raised no flag. */
  humanMustCheckWhenQuiet: string;
  humanReviewRequired: true;
}

export interface ScreeningPlan {
  kind: "content_screening";
  rule: "R-SCR-AREA";
  /** The eleven/… rule ids this plan can emit, for a consumer that resolves them. */
  areaRule: "R-SCR-AREA";
  flagRule: "R-SCR-FLAG";
  licensingCrossCheckRule: "R-SCR-LICENCE-GAP";
  attributionCrossCheckRule: "R-SCR-ATTRIBUTION-MISSING";
  evaluatedAt: string;
  areas: ScreeningAreaResult[];
  counts: {
    areas: number;
    areasWithFlags: number;
    flags: number;
    areasNothingMatching: number;
    areasNotScreened: number;
    charactersRead: number;
  };
  /** The sentence a reader cannot miss, carried on the data itself. */
  statement: string;
  /** What a rule that matched nothing means — and does not mean. */
  notAPass: string;
  /** What "not screened" means. */
  notScreenedStatement: string;
  /** The plainest form of the posture. */
  notLegalClearance: true;
  clearedForPublication: false;
  humanReviewRequired: true;
  /** The licence data this screening cross-checks, stated as a limit of it. */
  licenceLimits: string[];
  notes: string[];
}

/** How many matching spans per area are listed as flags; the rest are counted. */
export const MAX_FLAGS_PER_AREA = 24;

const STATEMENT =
  "These are screening flags raised by named rules over this project's own rows. Each flag names the row, the field and the character span it read, quotes the characters it matched, and says what a person has to check. " +
  "They are not legal clearance: this app has not cleared this video, or any part of it, for publication, and nothing here states that the video is lawful to publish.";

const NOT_A_PASS =
  "A rule that found nothing matching it says exactly that: its own pattern list did not match this project's text. That is not a pass, not a clearance and not evidence that the area is free of risk — it reports that the rule had nothing to show.";

const NOT_SCREENED_STATEMENT =
  "Not screened — no capability: this app has no way to examine the part of the area that needs one, so it reports that instead of reporting a result. Nothing about those parts of the area is known here.";

const LICENCE_LIMITS = [
  "A licence row records what this app stored about an asset. It is not a copy of the licence, it carries no terms text, and this app cannot read the licence a provider publishes today.",
  "An asset with no licence row is unknown and unverified: this app never treats a missing record as permission.",
  "A licence row says nothing about whether the asset is the licensor's to license, whether the upload was authorised, or whether a model was trained on material that could not be licensed.",
];

/* ------------------------------------------------------------------ */
/* The area definitions. Every word here is this app's own.            */
/* ------------------------------------------------------------------ */

interface AreaDefinition {
  id: ScreeningAreaId;
  label: string;
  question: string;
  rule: PublishingRuleId;
  reads: string;
  probes: ScreeningProbe[];
  why: string;
  humanMustCheck: string;
  humanMustCheckWhenQuiet: string;
  cannotDetermine: string[];
  capabilityLabel: string;
  /** Registry capability id, or null when the app has no such capability. */
  capabilityId: string | null;
}

/** Helper: a word/phrase list expressed as one alternation, escaped. */
function words(...terms: string[]): string {
  const escaped = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return `\\b(?:${escaped.join("|")})\\b`;
}

const QUOTED_PASSAGE = "[\"“][^\"”]{20,}[\"”]";

export const SCREENING_AREAS: readonly AreaDefinition[] = [
  {
    id: "copyright",
    label: "Copyright",
    question:
      "Does this project reproduce someone else's text, lyrics, footage, image or audio, and does the licence record cover the assets it uses?",
    rule: "R-SCR-COPY-RIGHTS",
    reads:
      "The project's title and description, the script's title and logline, every chapter's title and summary, every scene's title and narration, every asset's name — plus the licence rows of the project's own assets.",
    probes: [
      { id: "quoted_passage", label: "A quotation of twenty characters or more", pattern: QUOTED_PASSAGE, flags: "" },
      {
        id: "rights_language",
        label: "Rights or copyright language",
        pattern: words(
          "copyright",
          "copyrighted",
          "all rights reserved",
          "used with permission",
          "courtesy of",
          "excerpt from",
          "reprinted from",
          "fair use",
          "licensed under",
          "adapted from",
          "based on the book",
          "based on the novel",
          "lyrics",
        ),
        flags: "i",
      },
      { id: "copyright_symbol", label: "A copyright symbol", pattern: "©|\\(c\\)", flags: "i" },
    ],
    why:
      "The project's own text carries characters that read as a quotation or as a statement about rights. This app cannot tell whether the quoted characters are the project author's own words or someone else's.",
    humanMustCheck:
      "Check whether these characters are someone else's work, whether any exception or licence covers their use, and whether the video credits them the way the licence requires.",
    humanMustCheckWhenQuiet:
      "Read the finished video and its audio anyway: text cannot show footage, music or still images that may sit inside an asset this app never opened.",
    cannotDetermine: [
      "Whether the project's audio or its footage reproduces something protected — no audio fingerprinting or footage matching is wired.",
      "Whether a quoted passage is a permitted quotation, an exception, or a reproduction that needs a licence.",
      "Whether the assets it holds were uploaded by someone entitled to license them.",
    ],
    capabilityLabel: "A rights and similarity check over the produced media",
    capabilityId: null,
  },
  {
    id: "trademark",
    label: "Trademark",
    question: "Does the project use another trader's name, logo or mark in a way that could be read as use in trade?",
    rule: "R-SCR-TRADEMARK",
    reads:
      "The project's title and description, the script's title and logline, every chapter's title and summary, every scene's title and narration, and every asset's name.",
    probes: [
      { id: "mark_symbol", label: "A registered or unregistered trademark symbol", pattern: "®|™|\\(tm\\)", flags: "i" },
      {
        id: "brand_lexicon",
        label: "A name on this app's short sample list of well-known marks",
        pattern: words(
          "apple",
          "disney",
          "marvel",
          "netflix",
          "nike",
          "adidas",
          "coca-cola",
          "coca cola",
          "pepsi",
          "google",
          "microsoft",
          "amazon",
          "tesla",
          "ferrari",
          "lego",
          "rolex",
          "gucci",
          "harry potter",
          "star wars",
          "iphone",
          "photoshop",
          "bluetooth",
        ),
        flags: "i",
      },
      { id: "logo_word", label: "The words logo, brand or trademark", pattern: words("logo", "brand", "trademark", "branded"), flags: "i" },
    ],
    why:
      "The project's own text names a mark, a symbol or the idea of branding. Naming a product to talk about it and using its mark to sell something are different acts, and this app cannot tell them apart.",
    humanMustCheck:
      "Check whether the mark is used to identify the trademark owner's own goods, or to brand this video; whether a logo appears in any image or footage; and whether the use is descriptive, nominative or a trade use.",
    humanMustCheckWhenQuiet:
      "This rule reads a short fixed sample list, not a trademark register: a mark outside that list raises nothing here, and a logo shown in footage is invisible to a text rule.",
    cannotDetermine: [
      "Whether a mark appears in any image, frame or logo inside an asset — no image or video analysis is wired.",
      "Whether a mark is registered, in which classes, or in which territories — no trademark register is consulted.",
      "Whether a use is descriptive, nominative, comparative or a trade use: that is a legal judgement.",
    ],
    capabilityLabel: "A trademark register lookup and a mark-in-image check",
    capabilityId: null,
  },
  {
    id: "defamation",
    label: "Defamation",
    question: "Does the project assert something about an identifiable person or business that could damage them and is not true?",
    rule: "R-SCR-ALLEGATION",
    reads:
      "The project's title and description, the script's title and logline, every chapter's title and summary, and every scene's title and narration.",
    probes: [
      {
        id: "allegation_lexicon",
        label: "An allegation-shaped word",
        pattern: words(
          "scam",
          "scammer",
          "fraud",
          "fraudulent",
          "criminal",
          "convicted",
          "felon",
          "corrupt",
          "corruption",
          "liar",
          "lied",
          "stole",
          "stolen",
          "embezzled",
          "bribe",
          "bribed",
          "hoax",
          "swindled",
          "blackmail",
          "extortion",
          "accused",
          "allegedly",
          "lawsuit",
          "sued",
        ),
        flags: "i",
      },
    ],
    why:
      "The project's own text contains a word that characterises a person or a business badly. This app can see the word and cannot see who it refers to, whether the statement is true, or whether it is presented as fact or as opinion.",
    humanMustCheck:
      "Identify who the statement is about and whether they are identifiable; whether the statement is one of fact or opinion; and what evidence supports it. Keep the sourcing for any factual assertion.",
    humanMustCheckWhenQuiet:
      "A harmful implication can be built from true statements, pictures and editing; this rule reads words only and cannot see any of that.",
    cannotDetermine: [
      "Whether a statement refers to an identifiable person or business.",
      "Whether a statement is true, defensible, or framed as opinion rather than fact.",
      "Whether an image or a clip creates an implication the text does not carry.",
    ],
    capabilityLabel: "A claim-checking model with access to sources",
    capabilityId: null,
  },
  {
    id: "voice_cloning",
    label: "Voice cloning",
    question: "Does the project reproduce a real person's voice, or present a synthetic voice as that person's?",
    rule: "R-SCR-VOICE-CLONE",
    reads:
      "The project's title and description, the script's title and logline, every scene's title and narration, and every voiceover asset's name.",
    probes: [
      {
        id: "clone_lexicon",
        label: "Voice-cloning or impression language",
        pattern: words(
          "clone",
          "cloned",
          "cloning",
          "impersonation",
          "impersonate",
          "impersonating",
          "deepfake",
          "mimic",
          "mimicking",
        ).concat("|in the voice of|sounds like|sounded like|sounds exactly like|voice impression|synthetic voice|voice actor"),
        flags: "i",
      },
    ],
    why:
      "The project's own text describes copying, imitating or synthesising a voice. This app cannot listen to a track, compare it with a real person's voice, or tell whether a voice in the project is synthetic.",
    humanMustCheck:
      "Check whose voice each voiceover reproduces or imitates, whether that person consented in writing, and whether the video says the voice is synthetic wherever a listener could take it for the real person.",
    humanMustCheckWhenQuiet:
      "The app's voice engine renders speech from text; the rule cannot hear a rendered track, so a cloned or imitated voice raises nothing here unless the project's own words describe it.",
    cannotDetermine: [
      "Whether any rendered voice resembles a real, identifiable person — no speaker verification is wired.",
      "Whose voice a stored voiceover row was built from, beyond the provider and model the row records.",
      "Whether consent exists: this app stores no consent record for a voice.",
    ],
    capabilityLabel: "Speaker verification against a consented voiceprint",
    capabilityId: null,
  },
  {
    id: "likeness",
    label: "Likeness",
    question: "Does the project show or reproduce a real person's face or body, or a synthetic stand-in for one?",
    rule: "R-SCR-LIKENESS",
    reads:
      "The project's title and description, every scene's title and narration, every chapter title, and every image and video asset's name.",
    probes: [
      {
        id: "likeness_lexicon",
        label: "Likeness, lookalike or face-swap language",
        pattern: words(
          "lookalike",
          "look-alike",
          "doppelganger",
          "doppelgänger",
          "likeness",
          "resemblance",
          "face",
          "faces",
          "face-swap",
        ).concat("|face swap|digital double|in the style of|based on a real person|recreation of"),
        flags: "i",
      },
    ],
    why:
      "The project's own text refers to a face, a likeness or a person it reproduces. This app does not open an image, does not find a face in one, and cannot say whether a depicted person is real, synthetic, or a real person shown in a misleading way.",
    humanMustCheck:
      "Check every image and frame for an identifiable person; whether their consent covers this use; and whether a synthetic depiction could be taken for a photograph of a real event or a real person.",
    humanMustCheckWhenQuiet:
      "A face is pixels, not a word: this rule cannot see one, so a video full of identifiable people raises nothing here unless the project's text says so.",
    cannotDetermine: [
      "Whether any image or frame contains a face at all — the app's registry holds a `face_detection` capability and no adapter serves it.",
      "Whether a depicted person is real, and whether a synthetic person resembles a real one.",
      "Whether a person consented to appear: this app stores no model release.",
    ],
    capabilityLabel: "Face detection and likeness matching",
    capabilityId: "face_detection",
  },
  {
    id: "synthetic_media",
    label: "Misleading synthetic media",
    question:
      "Where the project presents synthetic material, does it say so — and could any part of it be taken for a record of real events?",
    rule: "R-SCR-SYNTHETIC-DISCLOSURE",
    reads:
      "The project's description and the script's logline for disclosure language; and, as rows rather than words, every asset's own origin row (stock, generated image, generated video, voiceover).",
    probes: [
      {
        id: "disclosure_lexicon",
        label: "A disclosure or constructed-media word",
        pattern: words(
          "fictional",
          "fabricated",
          "reconstruction",
          "dramatisation",
          "dramatization",
          "reenactment",
          "simulation",
          "satire",
          "parody",
          "illustration",
          "deepfake",
        ).concat("|ai generated|ai-generated|artificially generated|not real|re-creation"),
        flags: "i",
      },
      { id: "origin_word", label: "The word generated", pattern: words("generated", "synthetic", "cgi"), flags: "i" },
    ],
    why:
      "The project's own text describes material as constructed, generated or reconstructed. Whether the video itself says so, in the frame where a viewer could be misled, is not something this app can see.",
    humanMustCheck:
      "Check that anything a reasonable viewer could take for a record of real events carries a disclosure in the video itself — not only in the description — and that the disclosure is accurate about which parts are synthetic.",
    humanMustCheckWhenQuiet:
      "The project's asset rows record where each asset came from; read them in the licence report above, and note that this server has never had a provider return a generated asset.",
    cannotDetermine: [
      "Whether a disclosure appears anywhere in the produced video — no video file exists to read, and no frame analysis is wired.",
      "Whether a synthetic frame would be mistaken for a photograph of a real event.",
      "Whether a provider's output carries provenance metadata this app could read: no such metadata is stored.",
    ],
    capabilityLabel: "A synthetic-media classifier and provenance reading",
    capabilityId: null,
  },
  {
    id: "illegal_harmful",
    label: "Illegal or harmful content",
    question: "Does the project instruct, depict or promote something illegal, dangerous or harmful?",
    rule: "R-SCR-HARM",
    reads:
      "The project's title and description, the script's title and logline, every chapter's title and summary, and every scene's title and narration.",
    probes: [
      {
        id: "harm_lexicon",
        label: "A harm-shaped word",
        pattern: words(
          "bomb",
          "explosive",
          "explosives",
          "weapon",
          "weapons",
          "rifle",
          "poison",
          "poisoned",
          "methamphetamine",
          "heroin",
          "cocaine",
          "fentanyl",
          "suicide",
          "self-harm",
          "terrorist",
          "terrorism",
          "murder",
          "murdered",
          "torture",
          "tortured",
          "trafficking",
        ).concat("|how to make|instructions for making|kill yourself"),
        flags: "i",
      },
    ],
    why:
      "The project's own text contains a word that can describe serious harm. A history of a bombing and a set of instructions for one use different words, and this app cannot reliably tell them apart.",
    humanMustCheck:
      "Read the passage in context: whether it instructs, depicts, glorifies or reports; whether it is age-restricted material a platform expects to be declared; and whether it names a real victim or a real ongoing event.",
    humanMustCheckWhenQuiet:
      "A text list is a coarse instrument: it misses harm carried by images, tone and implication, and it flags words used innocently. Read every passage it did flag.",
    cannotDetermine: [
      "Whether the video depicts or instructs harm through images, demonstrations or sound.",
      "Whether the content falls under a platform's restricted-content rules, and which of them applies.",
      "Whether the treatment of a real victim or a real event is appropriate.",
    ],
    capabilityLabel: "A content-moderation model with a declared policy set",
    capabilityId: null,
  },
];

/* ------------------------------------------------------------------ */
/* Scanning                                                            */
/* ------------------------------------------------------------------ */

interface ScanTarget {
  kind: SourceKind;
  id: string;
  field: string;
  text: string;
}

/** Every field of the project's own words a rule may read. Order is stable. */
export function screeningTargets(source: PublishingSource): ScanTarget[] {
  const targets: ScanTarget[] = [];
  const push = (kind: SourceKind, id: string, field: string, text: string | null): void => {
    if (typeof text === "string" && text.length > 0) targets.push({ kind, id, field, text });
  };
  push("project", source.project.id, "title", source.project.title);
  push("project", source.project.id, "description", source.project.description);
  if (source.script) {
    push("script", source.script.id, "title", source.script.title);
    push("script", source.script.id, "logline", source.script.logline);
  }
  for (const chapter of [...source.chapters].sort((a, b) => a.order - b.order)) {
    push("chapter", chapter.id, "title", chapter.title);
    push("chapter", chapter.id, "summary", chapter.summary);
    for (const scene of [...chapter.scenes].sort((a, b) => a.order - b.order)) {
      push("scene", scene.id, "title", scene.title);
      push("scene", scene.id, "narration", scene.narration);
    }
  }
  for (const asset of [...source.assets].sort((a, b) => a.id.localeCompare(b.id))) {
    push("asset", asset.id, "name", asset.name);
  }
  return targets;
}

interface RawMatch {
  target: ScanTarget;
  probe: ScreeningProbe;
  start: number;
  end: number;
  text: string;
}

function runProbes(targets: ScanTarget[], probes: ScreeningProbe[]): { matches: RawMatch[]; charactersRead: number } {
  const matches: RawMatch[] = [];
  let charactersRead = 0;
  for (const target of targets) {
    charactersRead += target.text.length;
    for (const probe of probes) {
      // A fresh expression per target: a global regex carries state between calls.
      const re = new RegExp(probe.pattern, probe.flags.includes("g") ? probe.flags : `${probe.flags}g`);
      let m: RegExpExecArray | null;
      while ((m = re.exec(target.text)) !== null) {
        if (m[0].length === 0) {
          re.lastIndex += 1;
          continue;
        }
        matches.push({ target, probe, start: m.index, end: m.index + m[0].length, text: m[0] });
        if (matches.length > 4000) return { matches, charactersRead };
      }
    }
  }
  return { matches, charactersRead };
}

function capabilityFor(
  definition: AreaDefinition,
  facts: ScreeningCapabilityFacts,
): ScreeningAreaResult["capability"] {
  const fact = facts[definition.id];
  const requirement =
    fact?.requirement ??
    `No build of this package supplied provider facts for this area, so no provider is claimed and no environment variable is named here. What would be needed is ${definition.capabilityLabel.toLowerCase()}, which is not wired in this build.`;
  return {
    state: "not_screened_no_capability",
    statusLabel: NOT_SCREENED_PHRASE,
    capabilityId: definition.capabilityId,
    registered: fact?.registered ?? false,
    wiredProviderIds: fact?.wiredProviderIds ?? [],
    envVars: fact?.envVars ?? [],
    requirement,
    cannotDetermine: [...definition.cannotDetermine],
  };
}

function flagFromMatch(match: RawMatch, index: number, definition: AreaDefinition, derivedAt: Date): ScreeningFlag {
  const source: SourceRef = {
    kind: match.target.kind,
    id: match.target.id,
    path: match.target.field,
    span: { start: match.start, end: match.end },
  };
  return {
    id: `${definition.id}_${index + 1}_${match.probe.id}_${match.target.kind}_${match.target.id}_${match.start}`,
    area: definition.id,
    rule: definition.rule,
    probeId: match.probe.id,
    probeLabel: match.probe.label,
    rowKind: match.target.kind,
    rowId: match.target.id,
    field: match.target.field,
    span: { start: match.start, end: match.end },
    matched: derived(match.text, definition.rule, [source], {
      textOrigin: "source_verbatim",
      note: `Characters ${match.start}–${match.end} of ${match.target.kind}.${match.target.field} on row ${match.target.id}.`,
    }),
    whyItFired: derived(`${definition.why} The pattern that matched is "${match.probe.label}".`, "R-SCR-FLAG", [source], {
      textOrigin: "rule_authored",
      note: `Raised while evaluating ${definition.rule} at ${derivedAt.toISOString()}.`,
    }),
    humanMustCheck: derived(`${definition.humanMustCheck} The pattern that matched is "${match.probe.label}".`, "R-SCR-FLAG", [source], {
      textOrigin: "rule_authored",
    }),
  };
}

/** A licence gap is a copyright flag raised from a ROW rather than from text. */
function licenceGapFlags(
  licences: AssetLicenceReport,
  derivedAt: Date,
): ScreeningFlag[] {
  return licences.entries
    .filter((entry: AssetLicenceEntry) => entry.verification === "unknown_unverified")
    .map((entry, i) => {
      const source: SourceRef = { kind: "asset", id: entry.assetId, path: "licensing" };
      return {
        id: `copyright_licence_gap_${i + 1}_${entry.assetId}`,
        area: "copyright" as ScreeningAreaId,
        rule: "R-SCR-LICENCE-GAP" as PublishingRuleId,
        probeId: "licence_gap",
        probeLabel: "An asset with no licence row",
        rowKind: "asset" as SourceKind,
        rowId: entry.assetId,
        field: "licensing",
        span: { start: 0, end: 0 },
        matched: derived(entry.assetId, "R-SCR-LICENCE-GAP", [source], {
          textOrigin: "rule_authored",
          note: "This flag is raised from the asset's own row id, not from the project's text: the asset has no licence record to quote.",
        }),
        whyItFired: derived(
          `Asset row ${entry.assetId} has no LicensingMetadata row, so the licence that covers it is unknown and unverified. This app does not treat a missing record as permission.`,
          "R-SCR-LICENCE-GAP",
          [source],
          { textOrigin: "rule_authored" },
        ),
        humanMustCheck: derived(
          "Find the licence that covers this asset before it is published, and record it on the asset's licence row. A stock provider's own licence page is the place to read the terms; this app cannot read it.",
          "R-SCR-LICENCE-GAP",
          [source],
          { textOrigin: "rule_authored", note: `Raised at ${derivedAt.toISOString()}.` },
        ),
      };
    });
}

/**
 * A licence row that states attribution is required, while the description this
 * package assembles never carries the attribution text. Both halves are read from
 * rows: the licence row and the assembled description.
 */
function attributionGapFlags(
  licences: AssetLicenceReport,
  descriptionText: string | null,
  derivedAt: Date,
): ScreeningFlag[] {
  const haystack = (descriptionText ?? "").toLowerCase();
  return licences.entries
    .filter((entry) => entry.attributionRequired.state === "derived" && entry.attributionRequired.value)
    .filter((entry) => {
      const text = entry.attributionText.state === "derived" ? entry.attributionText.value.trim().toLowerCase() : "";
      return text.length > 0 && !haystack.includes(text);
    })
    .map((entry, i) => {
      const source: SourceRef = {
        kind: "licensing",
        id: entry.licensingRowId ?? entry.assetId,
        path: "attribution",
      };
      return {
        id: `copyright_attribution_gap_${i + 1}_${entry.assetId}`,
        area: "copyright" as ScreeningAreaId,
        rule: "R-SCR-ATTRIBUTION-MISSING" as PublishingRuleId,
        probeId: "attribution_missing",
        probeLabel: "Attribution required by the licence row but absent from the description",
        rowKind: "licensing" as SourceKind,
        rowId: entry.licensingRowId ?? entry.assetId,
        field: "attribution",
        span: { start: 0, end: 0 },
        matched: derived(entry.assetId, "R-SCR-ATTRIBUTION-MISSING", [source], {
          textOrigin: "rule_authored",
          note: "Named by asset row id; the attribution characters themselves are shown on the licence report above.",
        }),
        whyItFired: derived(
          `The licence row for asset ${entry.assetId} stores an attribution string, and this app's own description for the project does not contain it. Whether the licence requires the credit on screen, in the description, or in both places is written in the licence, which this app cannot read.`,
          "R-SCR-ATTRIBUTION-MISSING",
          [source],
          { textOrigin: "rule_authored" },
        ),
        humanMustCheck: derived(
          "Read the licence and place the credit where it requires: the description, the video, or both. Copy the attribution text from the licence report above, character for character.",
          "R-SCR-ATTRIBUTION-MISSING",
          [source],
          { textOrigin: "rule_authored", note: `Compared at ${derivedAt.toISOString()}.` },
        ),
      };
    });
}

export interface BuildScreeningInput {
  source: PublishingSource;
  licences: AssetLicenceReport;
  /** The assembled description's text, when the package could compose one. */
  descriptionText: string | null;
  /** Provider facts the caller derived from the app's registry. Defaults claim nothing. */
  capabilities?: ScreeningCapabilityFacts;
  now?: Date;
}

/** Builds the screening plan. Pure: rows in, traced flags out. */
export function buildScreeningPlan(input: BuildScreeningInput): ScreeningPlan {
  const derivedAt = input.now ?? new Date();
  const targets = screeningTargets(input.source);
  const { matches, charactersRead } = runProbes(
    targets,
    SCREENING_AREAS.flatMap((area) => area.probes),
  );

  const licenceFlags = licenceGapFlags(input.licences, derivedAt);
  const attributionFlags = attributionGapFlags(input.licences, input.descriptionText, derivedAt);

  const areas: ScreeningAreaResult[] = SCREENING_AREAS.map((definition) => {
    const own = matches.filter((m) => definition.probes.some((p) => p.id === m.probe.id && m.probe.pattern === p.pattern));
    const extra = definition.id === "copyright" ? [...licenceFlags, ...attributionFlags] : [];
    // Text spans first, in reading order; row-derived flags after them.
    const sorted = [...own].sort((a, b) => {
      const ka = `${a.target.kind}:${a.target.id}:${a.target.field}`;
      const kb = `${b.target.kind}:${b.target.id}:${b.target.field}`;
      return ka === kb ? a.start - b.start : ka.localeCompare(kb);
    });
    const textFlags: ScreeningFlag[] = sorted.map((m, i) => flagFromMatch(m, i, definition, derivedAt));
    const listed = [...textFlags.slice(0, Math.max(0, MAX_FLAGS_PER_AREA - extra.length)), ...extra];
    const status: ScreeningRuleStatus = textFlags.length + extra.length > 0 ? "flags_found" : "nothing_matching_this_rule";
    const areaCharacters = targets.reduce((sum, t) => sum + t.text.length, 0);
    return {
      area: definition.id,
      label: definition.label,
      question: definition.question,
      status,
      statusLabel:
        status === "flags_found"
          ? `Flags raised — ${listed.length + Math.max(0, textFlags.length + extra.length - listed.length)} in this area`
          : NOTHING_MATCHING_PHRASE,
      rule: definition.rule,
      reads: definition.reads,
      probes: definition.probes.map((p) => ({ ...p })),
      charactersRead:
        areaCharacters > 0
          ? derived(areaCharacters, definition.rule, targets.map((t) => ({ kind: t.kind, id: t.id, path: t.field })).slice(0, 40), {
              note:
                "The number of characters in the fields this rule reads on this project. Counted from the rows at build time; an empty project reads nothing and the rule reports that.",
            })
          : emptyNoInput("This project has no text in the fields this rule reads, so the rule had nothing to read.", [
              "a title, description, script, chapter or scene carrying text",
            ]),
      fieldsRead: targets.length,
      flags: listed,
      flagsNotListed: Math.max(0, textFlags.length + extra.length - listed.length),
      capability: capabilityFor(definition, input.capabilities ?? {}),
      humanMustCheckWhenQuiet: definition.humanMustCheckWhenQuiet,
      humanReviewRequired: true,
    };
  });

  const flags = areas.reduce((sum, a) => sum + a.flags.length + a.flagsNotListed, 0);

  const notes: string[] = [];
  if (targets.length === 0) {
    notes.push("This project carries no text in the fields the rules read, so every rule reports that it had nothing to read.");
  }
  if (licenceFlags.length > 0) {
    notes.push(
      `${licenceFlags.length} asset(s) on this project have no licence row. They are raised as copyright flags from their own rows, because the app holds no licence to quote.`,
    );
  }
  if (attributionFlags.length > 0) {
    notes.push(
      `${attributionFlags.length} asset(s) have a licence row stating that attribution is required, and this app's own description does not contain their attribution text.`,
    );
  }
  notes.push(
    "Every area reports its own rule's result AND the part of the area no capability in this app examines. Read both: the second one is why a quiet rule is not a pass.",
  );

  return {
    kind: "content_screening",
    rule: "R-SCR-AREA",
    areaRule: "R-SCR-AREA",
    flagRule: "R-SCR-FLAG",
    licensingCrossCheckRule: "R-SCR-LICENCE-GAP",
    attributionCrossCheckRule: "R-SCR-ATTRIBUTION-MISSING",
    evaluatedAt: derivedAt.toISOString(),
    areas,
    counts: {
      areas: areas.length,
      areasWithFlags: areas.filter((a) => a.status === "flags_found").length,
      flags,
      areasNothingMatching: areas.filter((a) => a.status === "nothing_matching_this_rule").length,
      areasNotScreened: areas.filter((a) => a.capability.state === "not_screened_no_capability").length,
      charactersRead,
    },
    statement: STATEMENT,
    notAPass: NOT_A_PASS,
    notScreenedStatement: NOT_SCREENED_STATEMENT,
    notLegalClearance: true,
    clearedForPublication: false,
    humanReviewRequired: true,
    licenceLimits: [...LICENCE_LIMITS],
    notes,
  };
}
