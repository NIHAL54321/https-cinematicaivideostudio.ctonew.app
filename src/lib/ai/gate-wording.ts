/**
 * BLOCK 9 — the CLIENT-side provider wording, DERIVED from a gate object.
 *
 * The defect this module exists to remove, stated once: the browser proof of
 * Block 8 found `export-panel.tsx` rendering the handoff badge
 * `no provider connected — nothing is encoded` as an UNCONDITIONAL literal, while
 * the reachable/unreachable split a few lines below it reported `handed_off` and
 * `provider_failed` as REACHABLE. On a server with a key set, `/api/ai/status`
 * says `connected` — so the panel would have contradicted the panel beneath it,
 * and the status page, in the same view. `editor-client.tsx` carried the same
 * class twice: an uppercase label `Provider Not Connected` sitting directly above
 * a body that already branched on `gate.connected`.
 *
 * The rule here, and the reason this is a module rather than inline JSX: a
 * sentence about connectivity may only be chosen from a value that was DERIVED
 * just now on the server. These functions take the gate object the API returned
 * for THIS request (the engines' own `CapabilityProviderGate` / `ProviderGate` —
 * `connected` from `isConfigured() && isWired(capability)`) and never read
 * `process.env`, never import the registry and never cache anything: the same
 * gate that `/api/ai/status` reports decides the wording, so the two surfaces
 * cannot disagree.
 *
 * Three states, and no fourth:
 *   - connected      — the live half says a provider is configured AND wired.
 *                      The wording must not deny it, and must not imply a produced
 *                      file: a hand-off is not an output.
 *   - not connected  — the live half says there is none. The wording may say so
 *                      plainly (and does), because it is a conclusion drawn from
 *                      the current flags, not a stored claim.
 *   - unread         — no gate has come back yet, so nothing is known. It makes NO
 *                      claim in either direction rather than guessing.
 *
 * CLIENT-SAFE: pure functions of their argument, no IO, no env.
 */

/** Badge/label tones, aligned with `src/components/ui.tsx`'s `Badge`. */
export type WordingTone = "neutral" | "ok" | "danger";

/** The only thing wording may be derived from: the gate's live boolean. */
export interface GateConnectivityView {
  connected?: boolean | null;
}

/**
 * `true` / `false` from the gate, or `null` when no read has come back. A gate
 * whose `connected` is not a boolean is treated as unread — never as `false`,
 * because "we do not know" and "there is none" are different sentences and only
 * one of them may be printed without a read.
 */
function connectedOf(gate: GateConnectivityView | null | undefined): boolean | null {
  if (!gate) return null;
  return typeof gate.connected === "boolean" ? gate.connected : null;
}

export interface ProviderGateWording {
  /** The uppercase panel label. */
  label: string;
  tone: WordingTone;
  /** The sentence under the label. */
  body: string;
  /** Which of the three states produced this wording, for machine checks. */
  state: "connected" | "not_connected" | "unread";
}

/**
 * The label + body of the editor's provider gate panel (scene controls, grade
 * renders, framing, auto-editor plans). Used to sit above a body that already
 * branched on `gate.connected` — now both come from one derivation.
 */
export function providerGateWording(gate: GateConnectivityView | null | undefined): ProviderGateWording {
  const connected = connectedOf(gate);
  if (connected === null) {
    return {
      label: "Provider State Unread",
      tone: "neutral",
      body:
        "No provider read has come back for this request yet, so nothing is claimed about what is connected here. " +
        "Nothing was generated, synthesized or faked.",
      state: "unread",
    };
  }
  if (connected) {
    return {
      label: "Provider Connected",
      tone: "ok",
      body:
        "A provider is connected — this plan can be executed through the orchestrator. A hand-off is not an output: " +
        "until the provider's own answer comes back, nothing here claims a generated, synthesized or rendered asset.",
      state: "connected",
    };
  }
  return {
    label: "Provider Not Connected",
    tone: "danger",
    body: "No provider is connected, so nothing was generated, synthesized or faked.",
    state: "not_connected",
  };
}

export interface HandoffBadgeWording {
  /** The handoff badge text. */
  text: string;
  tone: WordingTone;
  state: "connected" | "not_connected" | "unread";
}

/**
 * The export-job handoff badge. Unkeyed it must still say plainly that nothing
 * was encoded; keyed it must not claim no provider is connected, and must not
 * imply a produced file either (the export path hands a request off — it never
 * writes an output, so `filesProduced` is 0 in every state until a produced file
 * is verified).
 */
export function exportHandoffBadgeWording(
  gate: GateConnectivityView | null | undefined,
): HandoffBadgeWording {
  const connected = connectedOf(gate);
  if (connected === null) {
    return {
      text: "provider state not read yet — no encode has been attempted by this app",
      tone: "neutral",
      state: "unread",
    };
  }
  if (connected) {
    return {
      text: "provider connected — hand-off only, not a produced file",
      tone: "ok",
      state: "connected",
    };
  }
  return {
    text: "no provider connected — nothing is encoded",
    tone: "danger",
    state: "not_connected",
  };
}
