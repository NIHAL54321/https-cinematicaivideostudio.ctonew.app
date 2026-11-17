/**
 * The licence decision table — every branch, including the strings that are not
 * permissions. No network, no database: this is the pure function the routes and
 * the panel both depend on.
 */
import { describe, expect, test } from "bun:test";
import { evaluateLicence } from "../licence";

const track = (licenceText: string | null, overrides: { isStreamable?: boolean; isGated?: boolean } = {}) => ({
  licenceText,
  isStreamable: overrides.isStreamable ?? true,
  isGated: overrides.isGated ?? false,
});

describe("rule 1 — the audio itself", () => {
  test("not streamable is refused even with a CC BY licence", () => {
    const verdict = evaluateLicence(track("Attribution CC BY", { isStreamable: false }), "commercial");
    expect(verdict.permitted).toBe(false);
    expect(verdict.reason).toBe("not streamable without an account");
    expect(verdict.basis).toBe("none");
  });

  test("gated is refused even with a CC BY licence", () => {
    const verdict = evaluateLicence(track("Attribution CC BY", { isGated: true }), "commercial");
    expect(verdict.permitted).toBe(false);
    expect(verdict.reason).toBe("not streamable without an account");
  });
});

describe("rule 2 — no licence stated", () => {
  test("null is refused", () => {
    const verdict = evaluateLicence(track(null), "commercial");
    expect(verdict.permitted).toBe(false);
    expect(verdict.reason).toBe("no licence stated by the uploader");
    expect(verdict.basis).toBe("none");
    expect(verdict.licenceText).toBe("");
  });

  test("whitespace-only is refused", () => {
    const verdict = evaluateLicence(track("   "), "personal");
    expect(verdict.permitted).toBe(false);
    expect(verdict.reason).toBe("no licence stated by the uploader");
  });
});

describe("rule 3 — all rights reserved", () => {
  test("refused, case-insensitively, with the uploader's text kept verbatim", () => {
    const verdict = evaluateLicence(track("All Rights Reserved"), "commercial");
    expect(verdict.permitted).toBe(false);
    expect(verdict.reason).toBe("all rights reserved — no sync or commercial use granted");
    expect(verdict.licenceText).toBe("All Rights Reserved");
    expect(verdict.basis).toBe("uploader-claimed");
    expect(verdict.attributionRequired).toBe(false);
  });
});

describe("rule 4 — Creative Commons non-commercial", () => {
  test("CC BY-NC-SA (the form Audius really sends) is refused for non-commercial only", () => {
    const verdict = evaluateLicence(track("Attribution-NonCommercial-ShareAlike CC BY-NC-SA"), "commercial");
    expect(verdict.permitted).toBe(false);
    expect(verdict.reason).toBe("non-commercial only");
  });

  test("CC BY-NC-ND reports the non-commercial reason, not the derivatives one", () => {
    const verdict = evaluateLicence(track("Attribution-NonCommercial-NoDerivs CC BY-NC-ND"), "personal");
    expect(verdict.permitted).toBe(false);
    expect(verdict.reason).toBe("non-commercial only");
  });

  test("'non commercial' spelled out is caught too", () => {
    const verdict = evaluateLicence(track("Creative Commons Attribution Non Commercial 4.0"), "commercial");
    expect(verdict.permitted).toBe(false);
    expect(verdict.reason).toBe("non-commercial only");
  });
});

describe("rule 5 — Creative Commons no derivatives", () => {
  test("CC BY-ND is refused because syncing is a derivative use", () => {
    const verdict = evaluateLicence(track("Attribution-NoDerivs CC BY-ND"), "commercial");
    expect(verdict.permitted).toBe(false);
    expect(verdict.reason).toBe("no derivatives; syncing under video is a derivative use");
  });

  test("'No Derivatives' spelled out is caught", () => {
    const verdict = evaluateLicence(track("CC BY, No Derivatives 4.0"), "personal");
    expect(verdict.permitted).toBe(false);
    expect(verdict.reason).toBe("no derivatives; syncing under video is a derivative use");
  });
});

describe("rule 6 — the only forms treated as a permission", () => {
  test("CC BY is permitted for commercial use with the exact sentence and basis", () => {
    const verdict = evaluateLicence(track("Attribution CC BY"), "commercial");
    expect(verdict.permitted).toBe(true);
    expect(verdict.reason).toBe(
      "Permitted by the uploader's stated CC licence; the licence claim has not been independently verified and attribution is required.",
    );
    expect(verdict.attributionRequired).toBe(true);
    expect(verdict.basis).toBe("uploader-claimed");
    expect(verdict.licenceText).toBe("Attribution CC BY");
  });

  test("CC BY-SA is permitted for personal use", () => {
    const verdict = evaluateLicence(track("Attribution ShareAlike CC BY-SA"), "personal");
    expect(verdict.permitted).toBe(true);
    expect(verdict.attributionRequired).toBe(true);
    expect(verdict.basis).toBe("uploader-claimed");
  });

  test("CC BY is refused for an editorial-only use", () => {
    const verdict = evaluateLicence(track("Attribution CC BY"), "editorial");
    expect(verdict.permitted).toBe(false);
    expect(verdict.reason).toBe("a CC attribution licence does not cover an editorial-only use");
  });
});

describe("rule 7 — anything unrecognised is not a permission", () => {
  test("a string that merely contains CC but is not a CC licence", () => {
    const verdict = evaluateLicence(track("Licensed under CC terms agreed by email"), "commercial");
    expect(verdict.permitted).toBe(false);
    expect(verdict.reason).toBe("licence text not recognised, so not treated as a permission");
  });

  test("'accepted by the uploader' is not read as CC", () => {
    const verdict = evaluateLicence(track("Accepted by the uploader"), "commercial");
    expect(verdict.permitted).toBe(false);
    expect(verdict.reason).toBe("licence text not recognised, so not treated as a permission");
  });

  test("CC0 is not one of the recognised forms, so it is not treated as BY", () => {
    const verdict = evaluateLicence(track("CC0 1.0 Universal"), "commercial");
    expect(verdict.permitted).toBe(false);
    expect(verdict.reason).toBe("licence text not recognised, so not treated as a permission");
  });

  test("a bare 'by' elsewhere is not an attribution term", () => {
    const verdict = evaluateLicence(track("Free for use by anyone, credit if you can"), "commercial");
    expect(verdict.permitted).toBe(false);
  });

  test("a made-up licence string is refused", () => {
    const verdict = evaluateLicence(track("Royalty-free for video"), "commercial");
    expect(verdict.permitted).toBe(false);
    expect(verdict.reason).toBe("licence text not recognised, so not treated as a permission");
    expect(verdict.basis).toBe("uploader-claimed");
  });
});
