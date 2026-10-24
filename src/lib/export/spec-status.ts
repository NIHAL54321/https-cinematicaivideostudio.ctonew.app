/**
 * THE MATRIX, WITH ITS PROVIDER KEY STATE ATTACHED AT RESPONSE TIME
 * (Phase 8, block 2a).
 *
 * `./spec-matrix` is pure and client-safe, so it cannot read `process.env`. The
 * one provider-backed option in it — the AI upscale, capability
 * `video_enhancement` — therefore carries only the CAPABILITY NAME, and the
 * question "is a key set right now?" is answered here, on every response, by the
 * same derivation the status API and every engine gate use
 * (`capabilityConnectivity`): a provider counts only when it is configured AND
 * wired.
 *
 * WHY NOT A CONSTANT: a typed `aiUpscaleAvailable: false` asserts a fact about
 * THIS machine and goes stale the moment a key is added or removed. The state
 * below is recomputed per call, so a key added mid-process changes the next
 * answer, and a key removed changes it back.
 *
 * SERVER-SIDE ONLY (it reads process.env through the provider registry). Env var
 * NAMES travel to the UI; values never do.
 */
import { capabilityConnectivity } from "@/lib/ai/providers/capability-connectivity";
import { UPSCALE_MODES } from "./spec-matrix";

/** The capability the AI upscale option is handed to. */
export const AI_UPSCALE_CAPABILITY = "video_enhancement";

export interface ProviderState {
  capability: string;
  /** Derived right now: configured AND wired. Never a typed constant. */
  connected: boolean;
  /** The env var NAMES that would enable it — names only, never values. */
  requiredEnv: string[];
  /** The derivation's own sentence, printed verbatim. */
  reason: string;
  checkedAt: string;
}

/** The live key state for the AI upscale option. */
export function aiUpscaleState(): ProviderState {
  const c = capabilityConnectivity(AI_UPSCALE_CAPABILITY);
  return {
    capability: AI_UPSCALE_CAPABILITY,
    connected: c.connected,
    requiredEnv: [...(c.requiredEnv ?? [])],
    reason: c.reason,
    checkedAt: new Date().toISOString(),
  };
}

/** The upscale axis, with the provider option's key state filled in. */
export function upscaleOptionsWithState(): Array<Record<string, unknown>> {
  const state = aiUpscaleState();
  return UPSCALE_MODES.map((o) => ({
    ...o,
    provenance: { ...o.provenance },
    providerState: o.provenance.truth === "provider" ? state : null,
    /** True only when the provider answered a real key just now. */
    availableNow: o.provenance.truth === "provider" ? state.connected : o.provenance.truth === "computed",
  }));
}

/** Attach the live provider state to a matrix view produced by `matrixView()`. */
export function withProviderState(view: Record<string, unknown>): Record<string, unknown> {
  const state = aiUpscaleState();
  const axes = view.axes as Array<{ axis: string; options: Array<Record<string, unknown>> }>;
  return {
    ...view,
    providerState: state,
    axes: axes.map((a) =>
      a.axis === "upscaleModes"
        ? {
            ...a,
            options: a.options.map((o) => ({
              ...o,
              providerState: (o.provenance as { truth: string }).truth === "provider" ? state : null,
            })),
          }
        : a,
    ),
  };
}
