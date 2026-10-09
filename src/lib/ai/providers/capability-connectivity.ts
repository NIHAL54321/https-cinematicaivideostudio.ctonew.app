/**
 * Engine provider gates — ONE derived implementation, called at RESPONSE time.
 *
 * Before this module each engine carried its own gate constant
 * (`COLOR_PROVIDER_CONNECTED = false`, `FRAMING_PROVIDER_CONNECTED = false`,
 * `REPURPOSE_PROVIDER_CONNECTED = false`, `AUTO_EDITOR_PROVIDER_CONNECTED =
 * false`). A constant like that asserts a fact about THIS MACHINE, and it can
 * only ever be true for the machine it was written on: on a server that has a
 * wired adapter and its key set, the gate would still say "not connected" while
 * `/api/ai/status` said "connected" — two surfaces of the same app contradicting
 * each other in the same response.
 *
 * Everything below is DERIVED, on every call, from the same two sources the
 * status API and the orchestrator use:
 *   1. the capability→provider slot table (`./registry` → `providersFor`),
 *   2. the provider env-key registry (`./env-keys`) — env var NAMES only, never
 *      values — and the capability→env derivation built on it
 *      (`./capability-env`).
 * `connected` is literally the status API's own predicate: a provider counts
 * only when it is `isConfigured() && isWired(capability)`. Nothing here is
 * cached, so a key added or removed mid-process changes the next answer.
 *
 * WORDING RULE (the invariant this module exists to keep):
 *   - a gate may state a REQUIREMENT ("this work needs a provider that is
 *     configured AND wired"), and
 *   - a gate may state a conclusion about connectivity ONLY when that conclusion
 *     was derived just now from the registry (`reason` below),
 *   - and a gate may never assert a fixed fact about this server's keys —
 *     "no key is set", "provider not connected" — because that sentence can be
 *     false on a server where it is printed.
 * Every claim about keys here lives inside `reason`, which is computed at call
 * time from the registry's own `configured` / `wired` flags.
 *
 * A gate also carries `engineDispatches`: whether THIS ENGINE has a code path
 * that hands work to a provider. That is a fact about the code, not a claim
 * about the server's keys — all four engines below have no such call site, so
 * `connected` tells the operator what the registry holds while
 * `engineDispatches` tells them what this engine would do with it.
 *
 * SERVER-SIDE ONLY (it reads process.env through the registry). Env var NAMES
 * may travel to the UI; values never do.
 */
import { AI_CAPABILITIES, type AiCapabilityId } from "../types";
import { capabilityStatus } from "../status";
import { capabilityEnvPath, capabilityEnvRequirement, envNamesPhrase } from "./capability-env";
export type CapabilityConnectionStatus = "connected" | "not_connected";
/** One provider slot, with BOTH of its live flags readable. */
export interface ServingSlotState {
  id: string;
  name: string;
  rank: number;
  /** Registry env var NAMES that enable this slot (never values). */
  envKeys: string[];
  /** true = EVERY listed key is required; false = ANY one of them suffices. */
  allRequired: boolean;
  /** Every key for this slot is present on this server right now. */
  configured: boolean;
  /** A real request/parse implementation exists for this capability. */
  wired: boolean;
}
/** Live connectivity for ONE capability. Read at call time; never cached. */
export interface CapabilityConnectivity {
  capability: string;
  /** True when the id is one of the 21 registered capabilities. */
  registered: boolean;
  /** Literally the status API's own answer for this capability. */
  status: CapabilityConnectionStatus;
  /** `status === "connected"` — configured AND wired, right now. */
  connected: boolean;
  /** Provider ids that serve the capability, wired or not. */
  candidates: string[];
  /** Slots that are configured AND wired right now. */
  connectedSlots: string[];
  /** Slots whose keys are present (wired or not) — a key alone is not enough. */
  configuredSlots: string[];
  wiredSlots: ServingSlotState[];
  unwiredSlots: ServingSlotState[];
  /** Union of the serving slots' registry env var NAMES (never values). */
  requiredEnv: string[];
  envHint: string | null;
  /** WHY, at this moment — derived, so it cannot claim a key is missing here. */
  reason: string;
}
function dedupe(values: readonly string[]): string[] {
  const out: string[] = [];
  for (const v of values) if (!out.includes(v)) out.push(v);
  return out;
}
/** "a" · "a and b" · "a, b and c". */
function andPhrase(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  return `${values.slice(0, -1).join(", ")} and ${values[values.length - 1]}`;
}
/** The env var NAMES (never values) a slot's keys are spelled with. */
function slotKeys(slot: ServingSlotState): string {
  return slot.envKeys.join(slot.allRequired ? " + " : " | ");
}
/**
 * The derived sentence describing what is true for one capability RIGHT NOW.
 * The three branches are mutually exclusive and each is checked against the
 * live flags, so the branch that says "no key for a wired slot is set" is only
 * ever reached when no wired slot is configured.
 */
function connectivityReason(
  capability: string,
  registered: boolean,
  slots: readonly ServingSlotState[],
  connectedSlots: readonly string[],
): string {
  if (!registered) {
    return `"${capability}" is not a registered capability, so no provider slot can serve it and no env var would enable it`;
  }
  if (connectedSlots.length > 0) {
    const phrase = connectedSlots
      .map((id) => {
        const slot = slots.find((s) => s.id === id);
        return slot ? `${id} (${slotKeys(slot)})` : id;
      })
      .join(", ");
    return `${phrase} is configured AND wired for "${capability}" right now, so a request to it would genuinely be attempted`;
  }
  const wired = slots.filter((s) => s.wired);
  if (wired.length > 0) {
    const ids = wired.map((s) => s.id).join(", ");
    const keys = envNamesPhrase(dedupe(wired.flatMap((s) => s.envKeys)));
    return `${ids} is wired for "${capability}" but no key for a wired slot (${keys}) is set on this server right now`;
  }
  const ids = slots.map((s) => s.id).join(", ");
  return (
    `no slot serving "${capability}" is wired yet — ${ids} exist as plain slots with no request/parse ` +
    `implementation, so "${capability}" is not wired`
  );
}
/** Live connectivity for one capability. Derived per call from the registry. */
export function capabilityConnectivity(capability: string): CapabilityConnectivity {
  const registered = (AI_CAPABILITIES as readonly string[]).includes(capability);
  const path = capabilityEnvPath(capability);
  const status = registered ? capabilityStatus(capability as AiCapabilityId) : null;
  const byId = new Map((status?.providers ?? []).map((p) => [p.id, p]));
  const slots: ServingSlotState[] = path.providers.map((row) => ({
    id: row.providerId,
    name: row.providerName,
    rank: row.rank,
    envKeys: [...row.envKeys],
    allRequired: row.allRequired,
    configured: byId.get(row.providerId)?.configured ?? row.configured,
    wired: byId.get(row.providerId)?.wired ?? row.wired,
  }));
  // The SAME predicate the status API reports — one source, so the two surfaces
  // cannot disagree: a provider counts only when configured AND wired.
  const connectedSlots = slots.filter((s) => s.configured && s.wired).map((s) => s.id);
  const statusValue: CapabilityConnectionStatus =
    status?.status === "connected" ? "connected" : "not_connected";
  return {
    capability,
    registered,
    status: statusValue,
    connected: statusValue === "connected",
    candidates: slots.map((s) => s.id),
    connectedSlots,
    configuredSlots: slots.filter((s) => s.configured).map((s) => s.id),
    wiredSlots: slots.filter((s) => s.wired),
    unwiredSlots: slots.filter((s) => !s.wired),
    requiredEnv: [...path.envVars],
    envHint: path.envHint,
    reason: connectivityReason(capability, registered, slots, connectedSlots),
  };
}
/** Just the derived boolean, for callers that need nothing else. */
export function isCapabilityConnected(capability: string): boolean {
  return capabilityConnectivity(capability).connected;
}
/**
 * The operator requirement over ONE OR SEVERAL capabilities, derived from the
 * registry (never a literal). The single-capability case is delegated verbatim
 * to `capabilityEnvRequirement` so the wording has one implementation; the
 * multi-capability case unions the names and states per-capability which slots
 * are wired, because a key for an UNWIRED slot would still change nothing.
 */
export function capabilityEnvRequirementFor(capabilities: readonly string[]): string {
  if (capabilities.length === 0) return capabilityEnvRequirement("");
  if (capabilities.length === 1) return capabilityEnvRequirement(capabilities[0]);
  const paths = capabilities.map((c) => capabilityEnvPath(c)).filter((p) => p.hasProvider);
  if (paths.length === 0) return capabilityEnvRequirement(capabilities[0]);
  const envVars = dedupe(paths.flatMap((p) => p.envVars));
  const plural = envVars.length === 1 ? "" : "s";
  const wiredRows = dedupe(
    paths.flatMap((p) => p.providers.filter((r) => r.wired).map((r) => `${r.providerId}: ${r.envKeys.join(r.allRequired ? " + " : " | ")}`)),
  );
  const unwiredRows = dedupe(
    paths.flatMap((p) => p.providers.filter((r) => !r.wired).map((r) => `${r.providerId}: ${r.envKeys.join(r.allRequired ? " + " : " | ")}`)),
  );
  return (
    `A server operator enables it by setting the server-side env var${plural} ${envNamesPhrase(envVars)} ` +
    `(name${plural} only — never a value) — the same name${plural} the provider registry reads. ` +
    `Wired slots: ${wiredRows.length > 0 ? wiredRows.join("; ") : "none"}. ` +
    `Unwired slots (a key for these would still change nothing until the slot itself is wired): ` +
    `${unwiredRows.length > 0 ? unwiredRows.join("; ") : "none"}.`
  );
}
/** The gate every engine returns. Server-side shape; env var NAMES only. */
export interface CapabilityProviderGate {
  /** The capability this gate reports as its own. */
  capability: string;
  /** DERIVED: true only when every required capability is configured AND wired. */
  connected: boolean;
  /**
   * A CODE fact, never a claim about this server's keys: true only when this
   * engine has a call site that hands the work to a provider. All four engines
   * that use this module today contain no such call site.
   */
  engineDispatches: boolean;
  /** Env var NAMES (never values) a server operator must set — from the registry. */
  requiredEnv: string[];
  envHint: string | null;
  /** Live connectivity, one entry per REQUIRED capability, for machine checks. */
  connectivity: CapabilityConnectivity[];
  /** How `connected` was derived, in one sentence. */
  connectedBasis: string;
  note: string;
}
export interface EngineGateSpec {
  /** The primary capability (what `capability` reports). */
  capability: string;
  /** Every capability this work needs; defaults to `[capability]`. AND semantics. */
  capabilities?: readonly string[];
  /** What the caller wanted, e.g. "Baking a LUT into real pixels". */
  what: string;
  /** The engine's own honest sentence about what it did NOT produce. */
  notProduced: string;
  /** true only when this engine has a call site that dispatches to a provider. */
  engineDispatches: boolean;
  /** Optional extra sentence appended before the operator requirement. */
  extra?: string;
}
/**
 * Build the honest gate for one engine. Called fresh on every response: nothing
 * about connectivity is decided at import time.
 */
export function derivedProviderGate(spec: EngineGateSpec): CapabilityProviderGate {
  const capabilities = spec.capabilities && spec.capabilities.length > 0 ? [...spec.capabilities] : [spec.capability];
  const connectivity = capabilities.map((c) => capabilityConnectivity(c));
  const requiredEnv = dedupe(connectivity.flatMap((c) => c.requiredEnv));
  const connected = connectivity.every((c) => c.connected);
  const needs =
    capabilities.length === 1
      ? `a provider that is configured AND wired for "${capabilities[0]}"`
      : `a provider that is configured AND wired for every one of ${andPhrase(capabilities.map((c) => `"${c}"`))}`;
  const rightNow = `Right now ${connectivity.map((c) => c.reason).join("; and ")}.`;
  const dispatchClause = spec.engineDispatches
    ? connected
      ? "This engine does dispatch that work to a provider, so the request would genuinely be sent to it — " +
        "a hand-off is still not a produced file."
      : "This engine does dispatch that work to a provider, but there is none configured AND wired to dispatch to, " +
        "so nothing was attempted."
    : "This engine has no code path that dispatches to a provider, so nothing was attempted here and setting a key " +
      "would not by itself make this engine produce the work.";
  const connectedBasis = connected
    ? `Every required capability is configured AND wired right now (${connectivity.map((c) => `${c.capability}: ${c.connectedSlots.join("+")}`).join(", ")}).`
    : `Not reachable right now — ${connectivity
        .filter((c) => !c.connected)
        .map((c) => `${c.capability}: ${c.reason}`)
        .join("; ")}.`;
  const note =
    `${spec.what} needs ${needs}. ${rightNow} ${dispatchClause} ${spec.notProduced}` +
    (spec.extra ? ` ${spec.extra}` : "") +
    ` ${capabilityEnvRequirementFor(capabilities)}`;
  return {
    capability: spec.capability,
    connected,
    engineDispatches: spec.engineDispatches,
    requiredEnv,
    envHint: envNamesPhrase(requiredEnv),
    connectivity,
    connectedBasis,
    note,
  };
}
