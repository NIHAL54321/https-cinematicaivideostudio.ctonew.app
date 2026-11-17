/**
 * The licence decision table — BLOCK M1, 2026-11-17. Pure, no IO.
 *
 * What this decides: whether the licence text the UPLOADER stated permits this
 * project to put the track under a video. What it does NOT decide: whether that
 * statement is true. A permitted verdict always carries
 * `basis: "uploader-claimed"` and a reason that says so, and it always requires
 * attribution — the panel shows that qualifier beside the badge.
 *
 * The rules run in this order and the first match wins:
 *   1. not streamable / gated          → refused
 *   2. no licence text                 → refused
 *   3. "All rights reserved"           → refused
 *   4. CC with NC                      → refused (non-commercial only)
 *   5. CC with ND                      → refused (syncing is a derivative use)
 *   6. CC BY / BY-SA                   → permitted, attribution required
 *   7. anything else                   → refused (not treated as a permission)
 *
 * Rule 6 permits only when `intendedUse` is `commercial` or `personal`; an
 * `editorial` use is not what BY/BY-SA grants, so it is refused.
 *
 * ── The licence strings this recognises are the ones the provider really
 * sends. Sampled live from Audius on 2026-11-17 over four searches (543
 * results): "All rights reserved", null, and the Creative Commons forms
 *   "Attribution CC BY"
 *   "Attribution ShareAlike CC BY-SA"
 *   "Attribution-NoDerivs CC BY-ND"
 *   "Attribution-NonCommercial-ShareAlike CC BY-NC-SA"
 *   "Attribution-NonCommercial-NoDerivs CC BY-NC-ND"
 * The matching below is written against those words ("Attribution",
 * "NonCommercial", "NoDerivs", "ShareAlike", "CC BY…") rather than against a
 * guessed CC URL, and it deliberately does NOT treat a bare "by" elsewhere in
 * the sentence as an attribution term — "licensed under CC terms agreed by
 * email" is not a CC BY licence.
 */
import type { IntendedUse, LicenceVerdict, MusicProviderTrack } from "./providers/types";

type LicenceInput = Pick<MusicProviderTrack, "licenceText" | "isStreamable" | "isGated">;

function refused(licenceText: string, reason: string, basis: LicenceVerdict["basis"]): LicenceVerdict {
  return {
    permitted: false,
    reason,
    attributionRequired: false,
    licenceText,
    basis,
  };
}

/** Does the text mention Creative Commons at all? */
function mentionsCreativeCommons(normalised: string): boolean {
  if (/creative\s+commons/.test(normalised)) return true;
  // A standalone "cc" token — "accepted", "success" etc. must not match.
  return /(^|[^a-z])cc([^a-z]|$)/.test(normalised);
}

/** An attribution term, not just any "by" in the sentence. */
function hasAttributionTerm(normalised: string): boolean {
  return (
    /attribution/.test(normalised) ||
    /cc[\s-]*by([^a-z]|$)/.test(normalised) ||
    /creative\s+commons[\s-]+by([^a-z]|$)/.test(normalised)
  );
}

export function evaluateLicence(track: LicenceInput, intendedUse: IntendedUse): LicenceVerdict {
  const licenceText = typeof track.licenceText === "string" ? track.licenceText.trim() : "";

  // 1 — the provider itself says the audio cannot be played without an account.
  if (track.isStreamable === false || track.isGated === true) {
    return refused(licenceText, "not streamable without an account", "none");
  }

  // 2 — nothing stated by the uploader.
  if (licenceText.length === 0) {
    return refused(licenceText, "no licence stated by the uploader", "none");
  }

  const lower = licenceText.toLowerCase();

  // 3 — the uploader's own words.
  if (/all\s+rights\s+reserved/.test(lower)) {
    return refused(
      licenceText,
      "all rights reserved — no sync or commercial use granted",
      "uploader-claimed",
    );
  }

  if (mentionsCreativeCommons(lower)) {
    // "NonCommercial" / "non commercial" / "NC" as a licence term.
    const nc = /non-?\s?commercial/.test(lower) || /(^|[^a-z])nc([^a-z]|$)/.test(lower);
    // "NoDerivs" / "no derivatives" / "ND" as a licence term.
    const nd = /no-?\s?deriv/.test(lower) || /(^|[^a-z])nd([^a-z]|$)/.test(lower);
    const by = hasAttributionTerm(lower);

    // 4 — non-commercial first, so a BY-NC-ND string reports the NC reason.
    if (nc) {
      return refused(licenceText, "non-commercial only", "uploader-claimed");
    }
    // 5 — no derivatives.
    if (nd) {
      return refused(
        licenceText,
        "no derivatives; syncing under video is a derivative use",
        "uploader-claimed",
      );
    }
    // 6 — the only forms treated as a permission.
    if (by && (intendedUse === "commercial" || intendedUse === "personal")) {
      return {
        permitted: true,
        reason:
          "Permitted by the uploader's stated CC licence; the licence claim has not been independently verified and attribution is required.",
        attributionRequired: true,
        licenceText,
        basis: "uploader-claimed",
      };
    }
    if (by && intendedUse === "editorial") {
      return refused(
        licenceText,
        "a CC attribution licence does not cover an editorial-only use",
        "uploader-claimed",
      );
    }
  }

  // 7 — everything else, including a string that merely contains "CC".
  return refused(
    licenceText,
    "licence text not recognised, so not treated as a permission",
    "uploader-claimed",
  );
}
