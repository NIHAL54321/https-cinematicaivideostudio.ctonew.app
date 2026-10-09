/**
 * The licence dates a provider asset may carry.
 *
 * Before this module, the media path stored a licence's type, source, attribution
 * and URL and dropped its dates, so the Publishing Package's expiry rule had no
 * input it could ever read. These tests pin the two rules that make the stored
 * record honest: a date is stored only when the provider stated it, and a stated
 * date that is not a date is refused rather than dropped.
 */
import { describe, expect, test } from "bun:test";
import { invalidLicenceDate, licenceDatesFromProvider } from "../licence-fields";

describe("licence dates from a provider asset", () => {
  test("absent dates stay absent — never a substituted value", () => {
    expect(licenceDatesFromProvider({})).toEqual({});
    const dates = licenceDatesFromProvider({ purchasedAt: undefined, expiresAt: undefined });
    expect(Object.keys(dates)).toEqual([]);
    expect("expiresAt" in dates).toBe(false);
  });

  test("stated dates are stored as the real Dates they name", () => {
    const dates = licenceDatesFromProvider({
      purchasedAt: "2026-01-02T03:04:05.000Z",
      expiresAt: "2027-01-01T00:00:00.000Z",
    });
    expect(dates.purchasedAt?.toISOString()).toBe("2026-01-02T03:04:05.000Z");
    expect(dates.expiresAt?.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  test("an expiry in the past is stored as stated, not corrected", () => {
    const dates = licenceDatesFromProvider({ expiresAt: "2020-01-01T00:00:00.000Z" });
    expect(dates.expiresAt?.toISOString()).toBe("2020-01-01T00:00:00.000Z");
    expect(dates.expiresAt!.getTime()).toBeLessThan(Date.now());
  });

  test("a blank string is treated as not stated", () => {
    expect(licenceDatesFromProvider({ expiresAt: "   " })).toEqual({});
  });

  test("an unparseable date is never stored as an invalid Date", () => {
    expect(licenceDatesFromProvider({ expiresAt: "not-a-date" })).toEqual({});
  });

  test("the API boundary refuses a stated date that is not a date, naming the field", () => {
    expect(invalidLicenceDate({})).toBeNull();
    expect(invalidLicenceDate({ expiresAt: "2027-01-01T00:00:00.000Z" })).toBeNull();
    expect(invalidLicenceDate({ expiresAt: "not-a-date" })).toBe(
      "asset.license.expiresAt must be an ISO date string when present.",
    );
    expect(invalidLicenceDate({ purchasedAt: "yesterday" })).toBe(
      "asset.license.purchasedAt must be an ISO date string when present.",
    );
    // A number is not an ISO string either, even when it would parse.
    expect(invalidLicenceDate({ expiresAt: 1770000000000 as unknown as string })).toBe(
      "asset.license.expiresAt must be an ISO date string when present.",
    );
  });
});
