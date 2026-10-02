/**
 * Provider environment-key registry — the SINGLE source of truth for which
 * server-side env vars enable which provider.
 *
 * SERVER-SIDE ONLY. Never import this from client code, never put a key
 * value into anything the client can read. Env var NAMES are public
 * documentation (shown as hints in the UI); VALUES must stay here.
 *
 * A provider is "configured" when its env keys are present:
 *   - default (any): at least one of the listed keys is set
 *   - allRequired: every listed key must be set (e.g. AZURE_SPEECH_KEY +
 *     AZURE_SPEECH_REGION)
 */

export interface ProviderEnvKeySpec {
  envKeys: string[];
  /** true = ALL keys required; false (default) = ANY key suffices. */
  allRequired?: boolean;
}

/** The full documented provider list. Extend here to add a provider. */
export const PROVIDER_ENV_KEYS: Record<string, ProviderEnvKeySpec> = {
  openai: { envKeys: ["OPENAI_API_KEY"] },
  anthropic: { envKeys: ["ANTHROPIC_API_KEY"] },
  google: { envKeys: ["GOOGLE_AI_API_KEY", "GOOGLE_API_KEY"] }, // either name
  replicate: { envKeys: ["REPLICATE_API_TOKEN"] },
  runway: { envKeys: ["RUNWAY_API_KEY"] },
  elevenlabs: { envKeys: ["ELEVENLABS_API_KEY"] },
  stability: { envKeys: ["STABILITY_API_KEY"] },
  azure: { envKeys: ["AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION"], allRequired: true },
  pexels: { envKeys: ["PEXELS_API_KEY"] },
  unsplash: { envKeys: ["UNSPLASH_ACCESS_KEY"] },
};

export function readEnvVar(name: string): string {
  return process.env[name] ?? "";
}

/** True when the env vars for `providerId` are present (values are never exported). */
export function providerEnvConfigured(providerId: string): boolean {
  const spec = PROVIDER_ENV_KEYS[providerId];
  if (!spec) return false;
  const present = spec.envKeys.filter((k) => readEnvVar(k).trim().length > 0);
  if (spec.allRequired) return present.length === spec.envKeys.length;
  return present.length > 0;
}

/** The env var names that enable `providerId` (for UI hints / audit). */
export function providerRequiredEnv(providerId: string): string[] {
  return PROVIDER_ENV_KEYS[providerId]?.envKeys ?? [];
}

/** All documented provider env var names (for .env.example / docs). */
export function allProviderEnvVars(): string[] {
  return Object.values(PROVIDER_ENV_KEYS).flatMap((s) => s.envKeys);
}
