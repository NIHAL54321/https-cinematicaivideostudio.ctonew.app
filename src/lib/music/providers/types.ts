/**
 * The music provider contract — BLOCK M1, 2026-11-17.
 *
 * A music provider is a source of real tracks with the licence text its
 * uploader stated. Two things are deliberately NOT part of this contract:
 *
 *   1. A "generate music" call. No music-generation provider is wired, and this
 *      interface does not pretend one is; `epidemic` and `unminus` below are
 *      catalogues too, not generators.
 *   2. Any notion that a licence claim is a clearance. `licenceVerdict()` runs
 *      the pure decision table in `../licence.ts` over the text the uploader
 *      stated; nothing here verifies that claim.
 *
 * `previewUrl()` is server-side only. It is called by the preview proxy route
 * and its return value is never put in a response body or header, so the
 * browser never learns a provider URL.
 */

/** What the project intends to do with the music. */
export const INTENDED_USES = ["commercial", "personal", "editorial"] as const;
export type IntendedUse = (typeof INTENDED_USES)[number];

/**
 * A provider track in our own shape. `licenceText` is the provider's verbatim
 * string (null when the uploader stated nothing) — never rewritten, never
 * summarised.
 */
export interface MusicProviderTrack {
  providerId: string;
  providerTrackId: string;
  title: string;
  artist: string | null;
  artistHandle: string | null;
  durationSeconds: number | null;
  genre: string | null;
  mood: string | null;
  licenceText: string | null;
  isStreamable: boolean;
  isGated: boolean;
  /** Public page for the track, when the provider gives one. Not audio. */
  permalink: string | null;
}

export interface MusicSearchQuery {
  q: string;
  genre?: string | null;
  mood?: string | null;
  limit: number;
}

export type LicenceBasis = "explicit" | "uploader-claimed" | "none";

export interface LicenceVerdict {
  permitted: boolean;
  /** One line, shown verbatim in the panel. */
  reason: string;
  attributionRequired: boolean;
  /** The uploader's verbatim licence text, or "" when none was stated. */
  licenceText: string;
  basis: LicenceBasis;
}

export interface MusicProvider {
  id: string;
  label: string;
  /**
   * Env var NAMES this provider reads. Empty for a provider that needs no
   * credential. Names only — never values.
   */
  requiredEnv: string[];
  isConfigured(): boolean;
  search(query: MusicSearchQuery): Promise<MusicProviderTrack[]>;
  track(id: string): Promise<MusicProviderTrack>;
  /** Server-side only: the provider URL the preview proxy fetches. */
  previewUrl(id: string): string;
  /** Runs the shared licence decision table over this track. */
  licenceVerdict(track: MusicProviderTrack, intendedUse: IntendedUse): LicenceVerdict;
}

/** A provider slot that exists but is not wired. Never a silent empty result. */
export class ProviderNotConfiguredError extends Error {
  providerId: string;
  requiredEnv: string[];

  constructor(providerId: string, requiredEnv: string[], detail: string) {
    super(`${providerId} is not configured: ${detail}`);
    this.name = "ProviderNotConfiguredError";
    this.providerId = providerId;
    this.requiredEnv = requiredEnv;
  }
}

/** An id no provider answers to. Never a fallback guess. */
export class UnknownMusicProviderError extends Error {
  providerId: string;

  constructor(providerId: string) {
    super(`Unknown music provider "${providerId}".`);
    this.name = "UnknownMusicProviderError";
    this.providerId = providerId;
  }
}

/**
 * A provider answered badly. The message is OUR sentence about what happened —
 * provider response text is never surfaced to a user.
 */
export class MusicProviderError extends Error {
  providerId: string;
  status: number | null;

  constructor(providerId: string, message: string, status: number | null = null) {
    super(message);
    this.name = "MusicProviderError";
    this.providerId = providerId;
    this.status = status;
  }
}
