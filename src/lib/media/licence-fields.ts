/**
 * Phase 3 (touched by Phase 7 Block 2) — licence DATES from a provider asset.
 *
 * Why this is its own module: before this, the media-asset path stored the
 * licence type, source, attribution and URL but silently DROPPED a licence's
 * purchase and expiry dates, so `LicensingMetadata.purchasedAt` / `.expiresAt`
 * could not be filled from any path the app itself offered, and the publishing
 * package's expiry rule had nothing it could ever read. Two rules follow, and
 * both are the point of this file:
 *
 *   1. a date is stored only when the provider really stated it — absent stays
 *      absent, so a licence with no recorded expiry reads as "the record does
 *      not say", never as "this licence has no expiry";
 *   2. a stated date that is not a real date is REJECTED at the API boundary
 *      rather than dropped, because dropping it would change the meaning of the
 *      record in exactly the direction that matters.
 *
 * Pure and dependency-free, so both the API route and the persistence layer use
 * the same rules and a test can cover them without a database.
 */

export interface ProviderLicenceDates {
  purchasedAt?: string;
  expiresAt?: string;
}

/** The two columns a provider asset may fill, and nothing else. */
export const PROVIDER_LICENCE_DATE_FIELDS = ["purchasedAt", "expiresAt"] as const;

export type ProviderLicenceDateField = (typeof PROVIDER_LICENCE_DATE_FIELDS)[number];

/**
 * Validates the optional date fields of a provider asset's licence.
 * Returns null when acceptable, or a message naming the field that is wrong.
 */
export function invalidLicenceDate(license: ProviderLicenceDates): string | null {
  for (const field of PROVIDER_LICENCE_DATE_FIELDS) {
    const raw = license[field];
    if (raw === undefined || raw === null) continue;
    if (typeof raw !== "string" || Number.isNaN(new Date(raw).getTime())) {
      return `asset.license.${field} must be an ISO date string when present.`;
    }
  }
  return null;
}

/**
 * The Prisma-ready columns for a provider asset's licence: only the fields the
 * provider really stated, as real Dates. An unparseable value is omitted (the
 * API refuses it first) so an invalid Date can never reach the database.
 */
export function licenceDatesFromProvider(license: ProviderLicenceDates): {
  purchasedAt?: Date;
  expiresAt?: Date;
} {
  const out: { purchasedAt?: Date; expiresAt?: Date } = {};
  for (const field of PROVIDER_LICENCE_DATE_FIELDS) {
    const raw = license[field];
    if (typeof raw !== "string" || !raw.trim()) continue;
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) continue;
    out[field] = parsed;
  }
  return out;
}
