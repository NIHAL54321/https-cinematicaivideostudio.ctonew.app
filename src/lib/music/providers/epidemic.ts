/**
 * Epidemic Sound — a provider SLOT, not a provider. BLOCK M1, 2026-11-17.
 *
 * This file exists so the owner's later decision ("wire Epidemic Sound") is a
 * file to fill in rather than a rewrite of the music layer. Nothing here
 * pretends to work:
 *
 *   - `isConfigured()` is false unconditionally. Even if the env vars below are
 *     set, the adapter is not built, so claiming "configured" would be a lie.
 *   - `search()` / `track()` / `previewUrl()` throw
 *     `ProviderNotConfiguredError` naming the env vars a real adapter would
 *     need. They never return an empty list, because an empty list reads as
 *     "no matches" rather than "not wired".
 *
 * Epidemic Sound's catalogue is licensed by subscription and its API is
 * partner-only; that is why the key names below are the ones an account would
 * issue.
 */
import { evaluateLicence } from "../licence";
import {
  ProviderNotConfiguredError,
  type IntendedUse,
  type LicenceVerdict,
  type MusicProvider,
  type MusicProviderTrack,
} from "./types";

const PROVIDER_ID = "epidemic";
const REQUIRED_ENV = ["EPIDEMIC_API_KEY", "EPIDEMIC_PARTNER_ID"];

function notConfigured(): never {
  throw new ProviderNotConfiguredError(
    PROVIDER_ID,
    REQUIRED_ENV,
    `no adapter is built for it — it would need ${REQUIRED_ENV.join(" and ")} and a partner account`,
  );
}

export const epidemicProvider: MusicProvider = {
  id: PROVIDER_ID,
  label: "Epidemic Sound",
  requiredEnv: REQUIRED_ENV,
  isConfigured() {
    return false;
  },
  async search() {
    return notConfigured();
  },
  async track() {
    return notConfigured();
  },
  previewUrl() {
    return notConfigured();
  },
  licenceVerdict(track: MusicProviderTrack, intendedUse: IntendedUse): LicenceVerdict {
    return evaluateLicence(track, intendedUse);
  },
};
