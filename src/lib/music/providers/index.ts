/**
 * The music provider registry — BLOCK M1, 2026-11-17.
 *
 * Three slots, one of which is real. An unknown id is a typed error, never a
 * fallback guess: silently serving Audius for "spotify" would make a broken
 * wiring look like a working one.
 */
import { audiusProvider } from "./audius";
import { epidemicProvider } from "./epidemic";
import { unminusProvider } from "./unminus";
import { UnknownMusicProviderError, type MusicProvider } from "./types";

export const DEFAULT_MUSIC_PROVIDER_ID = "audius";

const REGISTRY: Record<string, MusicProvider> = {
  [audiusProvider.id]: audiusProvider,
  [epidemicProvider.id]: epidemicProvider,
  [unminusProvider.id]: unminusProvider,
};

/** Every slot, in display order. Includes the ones that are not wired. */
export function musicProviders(): MusicProvider[] {
  return Object.values(REGISTRY);
}

export function musicProvider(id: string): MusicProvider {
  const provider = REGISTRY[id];
  if (!provider) throw new UnknownMusicProviderError(id);
  return provider;
}

export { audiusProvider, epidemicProvider, unminusProvider };
export * from "./types";
