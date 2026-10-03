/**
 * Capability → environment-variable derivation — the SINGLE derived source of
 * truth for the honest question: "which server-side env var would actually
 * enable capability X?"
 *
 * It derives everything from the two existing sources, and hard-codes nothing:
 *   1. `./env-keys` (PROVIDER_ENV_KEYS) — the only place a provider env var
 *      NAME is ever declared (names only; values are never exported).
 *   2. `./slots` via `./registry` — which provider slots serve which capability.
 *
 * A name printed by a gate is therefore always a name some code reads
 * (`readEnvVar` in `./env-keys`). A gate must never print a name it invented:
 * an operator who sets an unread variable changes nothing, which is exactly the
 * dishonesty this product refuses to ship.
 *
 * When no provider slot serves a capability there is nothing to name, and this
 * module says so instead of printing a placeholder.
 *
 * SERVER-SIDE ONLY (the imported registry reads process.env). Env var NAMES may
 * travel to the UI; values never do.
 */
import { AI_CAPABILITIES, type AiCapabilityId } from "../types";
import { PROVIDER_ENV_KEYS, allProviderEnvVars, providerRequiredEnv } from "./env-keys";
import { providersFor } from "./registry";
/** One provider slot's own env-key requirement (names only). */
export interface CapabilityProviderEnvPath {
  providerId: string;
  providerName: string;
  rank: number;
  /** Registry env var NAMES that enable this provider (never values). */
  envKeys: string[];
  /** true = EVERY listed key is required; false = ANY one of them suffices. */
  allRequired: boolean;
  /** Every key present on this server right now (booleans only — no values). */
  configured: boolean;
  /** A real call() implementation exists for this slot. */
  wired: boolean;
}
export interface CapabilityEnvPath {
  capability: string;
  /** True when the id is one of the 21 registered capabilities. */
  registeredCapability: boolean;
  providers: CapabilityProviderEnvPath[];
  providerIds: string[];
  /** Union of registry env var NAMES over the providers that serve it. */
  envVars: string[];
  /** Human hint built from envVars (`"A or B"`), or null when there is none. */
  envHint: string | null;
  /** True when at least one provider slot serves the capability. */
  hasProvider: boolean;
  wiredProviderIds: string[];
  /** True when at least one serving slot has a real call() implementation. */
  hasWiredProvider: boolean;
  /** Plain-language answer to "which env var would enable this?". */
  summary: string;
}
/**
 * "A" · "A or B" · "A, B or C" — alternatives ACROSS providers: any one of them
 * (with that provider's own keys set) makes the capability enable-able.
 */
export function envNamesPhrase(names: readonly string[]): string {
  if (names.length === 0) return "";
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(", ")} or ${names[names.length - 1]}`;
}
/** True when `name` is declared by the provider env-key registry. */
export function isRegistryEnvVar(name: string): boolean {
  return (allProviderEnvVars() as string[]).includes(name);
}
/** Every env var name declared by the provider registry (names only). */
export function registryEnvVars(): string[] {
  return [...allProviderEnvVars()];
}
/**
 * Derive the env-var path for one capability id. An id that is not a registered
 * capability (e.g. the readiness surface's "media_analysis" bucket) derives to
 * an EMPTY path — no provider, no names — rather than to a made-up name.
 */
export function capabilityEnvPath(capability: string): CapabilityEnvPath {
  const registeredCapability = (AI_CAPABILITIES as readonly string[]).includes(capability);
  // providersFor() filters the slot table by capability; an unknown id yields [].
  const providers = providersFor(capability as AiCapabilityId);
  const rows: CapabilityProviderEnvPath[] = providers.map((p) => {
    const spec = PROVIDER_ENV_KEYS[p.id];
    const envKeys = [...(spec?.envKeys ?? providerRequiredEnv(p.id))];
    return {
      providerId: p.id,
      providerName: p.name,
      rank: p.rank,
      envKeys,
      allRequired: spec?.allRequired === true,
      configured: p.isConfigured(),
      wired: p.isWired(),
    };
  });
  const envVars = [...new Set(rows.flatMap((r) => r.envKeys))];
  const providerIds = rows.map((r) => r.providerId);
  const wiredProviderIds = rows.filter((r) => r.wired).map((r) => r.providerId);
  const hasProvider = rows.length > 0;
  const hasWiredProvider = wiredProviderIds.length > 0;
  const summary = hasProvider
    ? `Capability "${capability}" is served by ${rows.length} provider slot${rows.length === 1 ? "" : "s"} ` +
      `(${rows.map((r) => `${r.providerName}: ${r.envKeys.join(r.allRequired ? " + " : " | ")}`).join("; ")}). ` +
      `Enabled by ${envVars.length === 1 ? "the env var" : "the env vars"} ${envNamesPhrase(envVars)} ` +
      `(names only — never values). ` +
      (hasWiredProvider
        ? `Wired slot${wiredProviderIds.length === 1 ? "" : "s"}: ${wiredProviderIds.join(", ")}.`
        : "No serving slot is wired yet, so no call is attempted today.")
    : `Capability "${capability}" has no provider slot${registeredCapability ? "" : " and is not a registered capability"}: ` +
      "there is no server-side env var that would enable it, so none is named.";
  return {
    capability,
    registeredCapability,
    providers: rows,
    providerIds,
    envVars,
    envHint: envVars.length > 0 ? envNamesPhrase(envVars) : null,
    hasProvider,
    wiredProviderIds,
    hasWiredProvider,
    summary,
  };
}
/** The env var NAMES (never values) that could enable a capability. */
export function capabilityEnvNames(capability: string): string[] {
  return [...capabilityEnvPath(capability).envVars];
}
/** Human hint for a capability ("REPLICATE_API_TOKEN or RUNWAY_API_KEY") or null. */
export function capabilityEnvHint(capability: string): string | null {
  return capabilityEnvPath(capability).envHint;
}
/** Union of the derived names over several capabilities (order preserved). */
export function capabilityEnvNamesFor(capabilities: readonly string[]): string[] {
  const out: string[] = [];
  for (const c of capabilities) {
    for (const n of capabilityEnvNames(c)) if (!out.includes(n)) out.push(n);
  }
  return out;
}
/**
 * The honest sentence a gate appends to its own human reason: what an operator
 * would actually have to set, or — when nothing exists to set — that no provider
 * is wired and no name is printed because one would do nothing.
 */
export function capabilityEnvRequirement(capability: string): string {
  const path = capabilityEnvPath(capability);
  if (!path.hasProvider) {
    return (
      `No provider is wired for "${capability}" — no provider slot serves it, so there is no server-side env var ` +
      `that would enable it and none is named here (setting a name no code reads would change nothing).`
    );
  }
  const plural = path.envVars.length === 1 ? "" : "s";
  return (
    `A server operator enables it by setting the server-side env var${plural} ${envNamesPhrase(path.envVars)} ` +
    `(name${plural} only — never a value) — the same name${plural} the provider registry reads — ` +
    (path.hasWiredProvider
      ? `and the wired slot${path.wiredProviderIds.length === 1 ? "" : "s"} ${path.wiredProviderIds.join(", ")} serve it.`
      : `and wiring the capability. No serving slot is wired yet, so nothing is attempted today.`)
  );
}
/** Every derived path, for status / settings surfaces and the regression tests. */
export function listCapabilityEnvPaths(): CapabilityEnvPath[] {
  return [...AI_CAPABILITIES].map((c) => capabilityEnvPath(c));
}
