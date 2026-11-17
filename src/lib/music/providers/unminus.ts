/**
 * Unminus — a provider SLOT, not a provider. BLOCK M1, 2026-11-17.
 *
 * Unminus is a small free-music catalogue with no documented public search
 * API. This file records the slot and refuses honestly:
 *
 *   - `isConfigured()` is false unconditionally; no adapter is built, so a set
 *     key would not make it true.
 *   - `search()` / `track()` / `previewUrl()` throw
 *     `ProviderNotConfiguredError` naming the env var a real adapter would
 *     need. Never an empty list.
 */
import { evaluateLicence } from "../licence";
import {
  ProviderNotConfiguredError,
  type IntendedUse,
  type LicenceVerdict,
  type MusicProvider,
  type MusicProviderTrack,
} from "./types";

const PROVIDER_ID = "unminus";
const REQUIRED_ENV = ["UNMINUS_API_KEY"];

function notConfigured(): never {
  throw new ProviderNotConfiguredError(
    PROVIDER_ID,
    REQUIRED_ENV,
    `no adapter is built for it — it would need ${REQUIRED_ENV[0]} and a documented catalogue API`,
  );
}

export const unminusProvider: MusicProvider = {
  id: PROVIDER_ID,
  label: "Unminus",
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
