/**
 * Phase 7 Block 3b — THE QUOTATION: characters this app did NOT write, declared
 * inside a sentence this app DID write.
 *
 * THE DEFECT THIS MODULE FIXES. The honesty audit (./audit) phrase-scans the
 * app's own sentences for banned claims, and until this block it had no way to
 * tell the app's words from the project's characters embedded INSIDE one of
 * those sentences. Two modules shipped sentences of exactly that shape —
 * `No content word co-occurs with "guaranteed funnel fixes" in this project's
 * own chapters or scenes` (./keywords) and `first word of the title: "viral"`
 * (./titles) — so a project whose OWN stored text contains a banned word failed
 * its own build with 62 violations. A video about viral marketing is a normal
 * video; the refusal was honest but the invariant was broken.
 *
 * WHAT A QUOTATION IS. One object, three declared parts, and nothing hidden:
 *
 *   {
 *     text:         'the first word of the title: "{WORD}"',   // as it reads
 *     textOrigin:   "template_filled",
 *     templateText: 'the first word of the title: "{WORD}"',   // THE APP'S OWN WORDS
 *     fragments: [ { placeholder: "{WORD}", text: "viral",
 *                    textOrigin: "source_verbatim",
 *                    sources: [ { kind: "project", id: "p1", path: "title" } ],
 *                    from: "the first word of the title, read from Project.title" } ]
 *   }
 *
 * THE AUDIT'S CONTRACT, which is the whole point of the shape:
 *
 *   1. `templateText` is SCANNED as this app's own text. A banned claim cannot
 *      be written there — the app's words stay as checkable as any other.
 *   2. The sentence as it reads is EXEMPT from the scan ONLY when it is
 *      byte-for-byte `templateText` with the declared fragments substituted. A
 *      sentence that does not reproduce its own template plus its own fragments
 *      carries a character nobody declared: that is an `unverifiable_quotation`
 *      violation, and the sentence is phrase-scanned as this app's own words on
 *      top of that, so an app-authored claim cannot ride along inside an
 *      exempted sentence.
 *   3. Every fragment must name the row kind, row id, field path and character
 *      span it was read from, and must say so in plain words. A fragment with no
 *      source row, no placeholder, or a placeholder the template does not use is
 *      a violation too — so the mechanism cannot be used to declare loose text.
 *   4. A `template_filled` value that declares NO fragments is not exempt at all:
 *      it is scanned like any other sentence this app wrote. Absence of a
 *      declaration is never treated as permission.
 *
 * The same exemption shape is what ./provenance already grants a whole-value
 * copy (`source_verbatim`), and a provider's own answer (`provider_verbatim`):
 * text the audit skips is text the producer had to admit it did not write, and
 * now — for a sentence with the project's characters inside it — the producer
 * must be able to show the substitution arithmetic as well.
 *
 * HOW A LATER BLOCK USES THIS (P7-4 thumbnail concepts, P7-5 the quality
 * checker, P7-6 licence/safety surfaces — and P7-8 when a model's answer starts
 * flowing through these paths):
 *
 *   - When a sentence needs the project's own phrase inside it, do NOT
 *     interpolate it. Build a fragment and call `quotation(template, fragments)`;
 *     the audit scans `templateText`, verifies the substitution and counts the
 *     quotation (`quotedSentences` / `quotedFragments` on the audit result).
 *   - When referring to the project is enough — which is most of the time —
 *     name the ROW or the RECORD instead of quoting it (`kw-primary-1`, `Chapter
 *     row <id>`, `Asset row <id>`). That is the cheaper and stronger habit, and
 *     it is what ./keywords, ./chapters and ./licensing now do.
 *   - A fragment's `textOrigin` is `source_verbatim` for the project's own
 *     characters and `provider_verbatim` for a provider's answer: the two
 *     sources this product is allowed to quote without scanning.
 */

import type { SourceRef, TextOrigin } from "./provenance";

/** A `{PLACEHOLDER}` token: what a quotation template reserves for the project. */
export const QUOTATION_PLACEHOLDER_TOKEN = /\{[A-Za-z0-9_]+\}/;
const PLACEHOLDER_TOKEN_GLOBAL = /\{[A-Za-z0-9_]+\}/g;

/** The keys a quotation's sentence may sit under (the "read as it reads" slot). */
export const QUOTED_SLOT_KEYS = ["value", "text", "block", "phrase", "measured"] as const;

/** The key the app's own template is declared under, and the fragments beside it. */
export const QUOTATION_TEMPLATE_KEY = "templateText";
export const QUOTATION_FRAGMENTS_KEY = "fragments";

/** The only two origins this product may quote without scanning the characters. */
export const QUOTED_FRAGMENT_ORIGINS: readonly TextOrigin[] = ["source_verbatim", "provider_verbatim"];

/** One stretch of characters this app did not write, attributed to the row it came from. */
export interface QuotedFragment {
  /** The `{PLACEHOLDER}` in `templateText` these characters take the place of. */
  placeholder: string;
  /** The characters substituted — the project's own, or a provider's own. */
  text: string;
  /** Whose characters they are. Never `rule_authored`: then they are not a quotation. */
  textOrigin: "source_verbatim" | "provider_verbatim";
  /** The row, field and character span the characters were read from. Never empty. */
  sources: SourceRef[];
  /** Where they came from, in plain words, for a reader of the surface. */
  from: string;
}

/** A sentence this app wrote with the project's (or a provider's) characters declared inside it. */
export interface Quotation {
  /** The sentence as it reads, with the quoted characters in place. */
  text: string;
  textOrigin: "template_filled";
  /** This app's own words with their `{PLACEHOLDER}`s intact. The audit scans THIS. */
  templateText: string;
  /** The characters substituted, each attributed to its row. */
  fragments: QuotedFragment[];
}

/** A quoted fragment, built from a project row's characters. */
export function quotedFragment(input: {
  placeholder: string;
  text: string;
  sources: SourceRef[];
  from: string;
  textOrigin?: "source_verbatim" | "provider_verbatim";
}): QuotedFragment {
  return {
    placeholder: input.placeholder,
    text: input.text,
    textOrigin: input.textOrigin ?? "source_verbatim",
    sources: input.sources,
    from: input.from,
  };
}

/** `templateText` with every declared fragment's characters substituted in. */
export function renderQuotation(templateText: string, fragments: readonly QuotedFragment[]): string {
  let out = templateText;
  for (const fragment of fragments) out = out.split(fragment.placeholder).join(fragment.text);
  return out;
}

/**
 * Builds a quotation, and refuses the two mistakes that would make it a lie: a
 * placeholder the template uses but nobody declared, and a fragment the template
 * never uses (characters that are not in the sentence at all).
 */
export function quotation(templateText: string, fragments: readonly QuotedFragment[]): Quotation {
  const used = new Set(templateText.match(PLACEHOLDER_TOKEN_GLOBAL) ?? []);
  const declared = new Set(fragments.map((f) => f.placeholder));
  for (const placeholder of used) {
    if (!declared.has(placeholder)) {
      throw new Error(
        `quotation(): the template uses ${placeholder} but no fragment declares what was substituted into it`,
      );
    }
  }
  for (const fragment of fragments) {
    if (!used.has(fragment.placeholder)) {
      throw new Error(
        `quotation(): fragment ${fragment.placeholder} is not in the template, so its characters are not in the sentence`,
      );
    }
    if (fragment.sources.length === 0) {
      throw new Error(`quotation(): fragment ${fragment.placeholder} quotes characters with no source row`);
    }
  }
  return {
    text: renderQuotation(templateText, fragments),
    textOrigin: "template_filled",
    templateText,
    fragments: [...fragments],
  };
}

/**
 * What the audit found about one object's quotation claim.
 *
 *   "none"       — the object quotes nothing; nothing is exempt.
 *   "unverified" — it declares a template-filled value with no fragments. NOT
 *                  exempt: the audit scans the sentence as this app's own words.
 *                  (This is the shape a package stored before this block has, so
 *                  old saved bytes keep every rule they were built under.)
 *   "verified"   — the sentence is exactly the declared template with the
 *                  declared fragments substituted: exempt, and counted.
 *   "invalid"    — a quotation was declared and does not hold together. The
 *                  problems are violations, and the sentence is scanned too.
 */
export interface QuotationInspection {
  status: "none" | "unverified" | "verified" | "invalid";
  /** The key the sentence-as-it-reads sits under, when there is one. */
  slotKey: string | null;
  /** How many fragments the declaration carries. */
  fragments: number;
  /** Why an invalid declaration is invalid — one sentence per problem. */
  problems: string[];
}

const NONE: QuotationInspection = { status: "none", slotKey: null, fragments: 0, problems: [] };

/** Inspects one object's quotation declaration. Pure; never throws. */
export function inspectQuotation(obj: Record<string, unknown>): QuotationInspection {
  // A quotation is declared by a `template_filled` value and nothing else. An
  // object may legitimately carry a `fragments` list WITHOUT being a quotation
  // itself (a package record carries its own value's declaration beside it), so
  // the origin decides — and only `template_filled` can quote.
  if (obj.textOrigin !== "template_filled") return NONE;
  const declaresFragments = QUOTATION_FRAGMENTS_KEY in obj;
  const template = obj[QUOTATION_TEMPLATE_KEY];
  const rawFragments = obj[QUOTATION_FRAGMENTS_KEY];
  const list = Array.isArray(rawFragments) ? rawFragments : [];
  const problems: string[] = [];

  if (!declaresFragments) {
    // A template-filled value with no fragments: nothing is claimed, so nothing
    // is exempt. The sentence is scanned like any other sentence this app wrote.
    return { status: "unverified", slotKey: null, fragments: 0, problems: [] };
  }

  if (typeof template !== "string" || template.trim().length === 0) {
    problems.push(
      "a quotation must carry the app's own template text (`templateText`) with its {PLACEHOLDER}s, so the app's own words can be checked",
    );
  }
  if (list.length === 0) {
    problems.push("a quotation must declare the fragments substituted into its template (`fragments`), and this one declares none");
  }

  const seen = new Set<string>();
  for (let i = 0; i < list.length; i += 1) {
    const fragment = list[i] as Partial<QuotedFragment> | null;
    const at = `fragments[${i}]`;
    const placeholder = fragment?.placeholder;
    if (typeof placeholder !== "string" || !QUOTATION_PLACEHOLDER_TOKEN.test(placeholder) || placeholder !== placeholder.match(PLACEHOLDER_TOKEN_GLOBAL)?.join("")) {
      problems.push(`${at}.placeholder must be a single {PLACEHOLDER} token`);
    } else {
      if (seen.has(placeholder)) problems.push(`${at}.placeholder "${placeholder}" is declared twice`);
      seen.add(placeholder);
      if (typeof template === "string" && !template.includes(placeholder)) {
        problems.push(`${at}.placeholder "${placeholder}" does not appear in the template, so its characters are not in the sentence`);
      }
    }
    if (typeof fragment?.text !== "string" || fragment.text.length === 0) {
      problems.push(`${at}.text must be the characters substituted into the template`);
    }
    if (typeof fragment?.textOrigin !== "string" || !QUOTED_FRAGMENT_ORIGINS.includes(fragment.textOrigin as TextOrigin)) {
      problems.push(
        `${at}.textOrigin must say whose characters these are — source_verbatim (the project's own) or provider_verbatim (a provider's own)`,
      );
    }
    const sources = fragment?.sources;
    if (!Array.isArray(sources) || sources.length === 0) {
      problems.push(`${at}.sources must name the row, field and span the characters were read from`);
    } else {
      sources.forEach((source, j) => {
        const ref = source as Partial<SourceRef>;
        if (typeof ref?.kind !== "string" || typeof ref?.id !== "string" || !ref.id) {
          problems.push(`${at}.sources[${j}] must carry a row kind and a row id`);
        }
      });
    }
    if (typeof fragment?.from !== "string" || fragment.from.trim().length === 0) {
      problems.push(`${at}.from must say where the characters came from, in plain words`);
    }
  }

  if (typeof template === "string") {
    for (const placeholder of new Set(template.match(PLACEHOLDER_TOKEN_GLOBAL) ?? [])) {
      if (!seen.has(placeholder)) {
        problems.push(
          `the template's placeholder ${placeholder} has no fragment declared for it, so the sentence cannot be reproduced from what is declared`,
        );
      }
    }
  }

  const slots = QUOTED_SLOT_KEYS.filter((key) => typeof obj[key] === "string");
  if (slots.length === 0) {
    problems.push(`a quotation must carry the sentence as it reads under one of: ${QUOTED_SLOT_KEYS.join(", ")}`);
  }

  if (problems.length > 0) {
    return { status: "invalid", slotKey: slots[0] ?? null, fragments: list.length, problems };
  }

  const slotKey = slots[0];
  if (slots.length > 1) {
    problems.push(
      `a quotation carries one sentence; this object holds string values under ${slots.join(", ")}, so which one is quoted cannot be told`,
    );
    return { status: "invalid", slotKey, fragments: list.length, problems };
  }

  const rendered = renderQuotation(template as string, list as QuotedFragment[]);
  if (obj[slotKey] !== rendered) {
    problems.push(
      `the value under \`${slotKey}\` is not \`${QUOTATION_TEMPLATE_KEY}\` with these fragments substituted: it carries characters no declared fragment accounts for`,
    );
    return { status: "invalid", slotKey, fragments: list.length, problems };
  }

  return { status: "verified", slotKey, fragments: list.length, problems: [] };
}
