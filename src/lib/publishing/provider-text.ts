/**
 * Phase 7 Block 8 — THE SCREEN A PROVIDER'S OWN WORDS PASS THROUGH.
 *
 * THE PROBLEM THIS SOLVES. The honesty audit (./audit) refuses a banned claim in
 * text THIS APP WROTE, and deliberately does not phrase-scan text a provider
 * wrote — a third party's words are the third party's, exactly as a user's own
 * words are the user's (see ALLOWED_TEXT_ORIGINS in ./audit). That is the right
 * rule, and P7-8 does not weaken it. But it leaves a new question that Phase 7
 * had never had to answer, because until now no provider could write anything
 * into a publishing package: what happens when a model answers "guaranteed
 * ranking" or attaches a search-volume number to a title?
 *
 * WHAT THIS MODULE DECIDES, IN ONE SENTENCE: such a value is WITHHELD — it is not
 * carried as one of the package's values, and it is recorded verbatim in a
 * `withheld` record that says what it was, which provider wrote it, and why this
 * app will not present it. The page then shows it only inside that record, as the
 * provider's own text that this product declines to use.
 *
 * WHY WITHHOLD RATHER THAN QUOTE-AND-KEEP. Quoting it as provider-authored text
 * would pass the audit (provider_verbatim is exempt, correctly) and would be
 * technically honest — but the value would still sit in the package as one of its
 * title options, where a reader, an export or a downstream consumer takes it for
 * the studio's own proposal. The brief for this block says a model's claim must
 * not "become an unmarked claim on the page". Withholding is the mechanism that
 * makes that true by construction: nothing screened out can be read as a value of
 * this package at all.
 *
 * WHY THE AUDIT IS UNCHANGED UNDERNEATH IT. The audit still refuses every banned
 * claim in this app's own prose (BANNED_CLAIMS is imported here, not edited
 * there), still refuses a metric-shaped KEY at any depth, and still exempts a
 * provider's verbatim characters only when the object really declares them as
 * provider characters under a quoted slot. What this module adds is a SECOND,
 * narrower gate in front of that exemption: a provider's characters may only
 * enter the package as a carried value if they contain no claim this product
 * refuses to make and no metric-shaped number. The audit's rules are not relaxed
 * anywhere; the surface that renders a withheld value marks it as provider text
 * the product withheld, and never as the studio's own words.
 *
 * WHAT IT IS NOT: not a moderation model, not a policy engine, not a check on
 * whether a title is good, and not legal clearance. It is a phrase-and-shape
 * screen over a list this product already publishes, and it says so wherever its
 * result is shown.
 */
import { BANNED_CLAIMS } from "./audit";

/**
 * Metric-shaped text a provider might volunteer. These are the same facts
 * ./audit refuses as KEYS, recognised here as WORDS, because a number a model
 * wrote is exactly the market data this product has no source for — whether it
 * arrives as a key or as a sentence.
 */
export const METRIC_SHAPED_TEXT: readonly RegExp[] = [
  /\bsearch\s+volume\b/i,
  /\bmonthly\s+search(?:es)?\b/i,
  /\bkeyword\s+difficulty\b/i,
  /\bsearch\s+difficulty\b/i,
  /\bkeyword\s+score\b/i,
  /\bseo\s+score\b/i,
  /\bcompetition\s+(?:score|level|index)\b/i,
  /\bestimated\s+traffic\b/i,
  /\btraffic\s+estimate\b/i,
  /\bmonthly\s+(?:traffic|views|clicks)\b/i,
  /\bcost\s+per\s+click\b/i,
  /\bcpc\b/i,
  /\b(?:kd|sv|msv)\s*[:=]\s*\d/i,
  /\brank(?:s|ed|ing)?\s*(?:#|number|no\.)\s*\d/i,
  /\b\d[\d,.]*\s*(?:searches|impressions|clicks|visits|views\s+per)\b/i,
];

/** What kind of value a provider returned — carried into the withheld record. */
export type ProviderValueKind = "title" | "description" | "tag" | "hashtag";

/** The provider's characters that triggered a refusal, declared as theirs. */
export interface ScreenedPhrase {
  textOrigin: "provider_verbatim";
  phrase: string;
}

/** The result of screening one stretch of a provider's text. */
export type ScreenResult =
  | { ok: true }
  | {
      ok: false;
      /** The provider's own characters that triggered it, under a quoted slot key. */
      matched: ScreenedPhrase;
      /** Why this app will not carry it. THIS APP'S OWN words, phrase-scanned. */
      reason: string;
    };

/** This app's own sentence for a claim it will not repeat. No banned phrase in it. */
export const WITHHELD_CLAIM_REASON =
  "the provider's own wording contains a claim of an outcome or a search result this product does not make, so this app " +
  "declines to carry it as one of its own values. It is kept here, character for character, as the provider's text that " +
  "was withheld.";

/** This app's own sentence for a number it cannot source. */
export const WITHHELD_METRIC_REASON =
  "the provider's own wording carries a number about search volume, difficulty, competition or traffic, and this product has " +
  "no source for any such figure, so this app declines to carry it as one of its own values. It is kept here, character for " +
  "character, as the provider's text that was withheld.";

/**
 * Screen one value a provider returned. Cheap, deterministic and total: every
 * string is either carried or withheld with a stated reason, and there is no
 * third outcome.
 *
 * The order matters only for which reason is reported: a claim is reported as a
 * claim, and a metric-shaped number is reported as unsourced data.
 */
export function screenProviderText(text: string): ScreenResult {
  const lower = text.toLowerCase();
  for (const phrase of BANNED_CLAIMS) {
    if (lower.includes(phrase)) {
      return {
        ok: false,
        matched: { textOrigin: "provider_verbatim", phrase },
        reason: WITHHELD_CLAIM_REASON,
      };
    }
  }
  for (const pattern of METRIC_SHAPED_TEXT) {
    const match = pattern.exec(text);
    if (match) {
      return {
        ok: false,
        matched: { textOrigin: "provider_verbatim", phrase: match[0] },
        reason: WITHHELD_METRIC_REASON,
      };
    }
  }
  return { ok: true };
}

/** What the screen did, counted — so a reader can see how many values were withheld. */
export interface ProviderScreenSummary {
  rule: "R-SEO-PROVIDER-SCREEN";
  /** How many strings a provider returned that were screened. */
  screened: number;
  /** How many of them this app declined to carry. */
  withheld: number;
  /** The screen's own statement, unchanged everywhere it is shown. */
  statement: string;
}

export const PROVIDER_SCREEN_STATEMENT =
  "Every string a provider returned is screened before it may become a value of this package: a claim of an outcome or a " +
  "search result this product does not make, and a number about search volume, difficulty, competition or traffic, are " +
  "both withheld and recorded instead of carried. This is a phrase-and-shape screen over a list this product already " +
  "publishes — not a moderation model, not a policy engine and not legal clearance.";
