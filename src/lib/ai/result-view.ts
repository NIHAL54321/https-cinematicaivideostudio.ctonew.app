/**
 * One pure, client-safe reading of an orchestrator `AiResult` — the single place
 * that decides what a NON-ok result actually means.
 *
 * Why this exists: an honest failure described with the WRONG CAUSE is the
 * mirror image of a fake success, and the product shipped exactly that. A keyed
 * step in which the provider was reached and answered `http 401` was rendered
 * with the heading "Provider Not Connected" and with the line "no provider slot
 * is registered for this capability" — both false, because the provider was
 * configured, wired, attempted, and answered. Every surface that renders a
 * result classifies it here first, so no surface can print a cause the state
 * does not support.
 *
 * Client-safe by construction: this module imports TYPES ONLY. The provider
 * registry (which reads `process.env`) is never imported here — every env var
 * NAME this model exposes arrives on the result itself, derived server-side by
 * `requiredEnvFor()` in the orchestrator. Names only; values never travel.
 */
import type { AiAttempt, AiResult } from "./types";

/**
 * True when the recorded message is an HTTP answer FROM the provider (the
 * `http <status>: <body>` shape every `HttpProviderBase` subclass records),
 * as opposed to a local error that never left the machine ("request build
 * failed:", "network error:", "request timed out after …"). Only an HTTP
 * answer proves the provider answered; a local error does not, and the panel
 * must not claim otherwise.
 */
const PROVIDER_HTTP_ANSWER = /^http\s+\d{3}\b/i;

/** Statuses a result can carry once `ok` and `not_connected` are excluded. */
export type AiFailureStatus = "failed" | "rate_limited" | "timeout";

export type AiResultView =
  | { kind: "ok"; text: string }
  | { kind: "not_connected"; envKeys: string[]; note: string }
  | {
      kind: "attempt_failed";
      status: AiFailureStatus;
      heading: string;
      /** Every provider genuinely attempted, in A → B → C → D order. */
      attempts: AiAttempt[];
      /** The last provider attempted — the one whose own message is shown. */
      provider: string;
      model: string | null;
      /** The provider's own message, verbatim. Never rewritten, never summarised. */
      providerMessage: string;
      /** true only when that message is an HTTP answer from the provider. */
      providerAnswered: boolean;
      /** Env var NAMES that power this capability (derived server-side; never values). */
      envKeys: string[];
    }
  | { kind: "request_failed"; envKeys: string[]; note: string };

const ANSWERED_HEADINGS: Record<AiFailureStatus, string> = {
  failed: "Provider Reached — Attempt Rejected",
  rate_limited: "Provider Reached — Rate Limited",
  timeout: "Provider Reached — Attempt Timed Out",
};

/**
 * Classify a result. Four states, and only four:
 *   ok              — a provider returned a real output.
 *   not_connected   — no provider was attempted (the unkeyed state).
 *   attempt_failed  — a provider WAS attempted and the attempt failed.
 *   request_failed  — the request failed with no provider attempt recorded
 *                     (the app's own plumbing, session or network).
 */
export function aiResultView(result: AiResult): AiResultView {
  if (result.status === "ok") {
    return {
      kind: "ok",
      text: result.resultText ?? "Generation succeeded through a connected provider.",
    };
  }

  const envKeys = [...(result.requiredEnv ?? [])];

  if (result.status === "not_connected") {
    return { kind: "not_connected", envKeys, note: result.error ?? "Provider Not Connected." };
  }

  const attempts = result.attempts ?? [];
  const last = attempts[attempts.length - 1];
  if (!last) {
    return {
      kind: "request_failed",
      envKeys,
      note: result.error ?? "The request failed with no error message.",
    };
  }

  const providerMessage = last.error ?? result.error ?? "the provider reported no message";
  const providerAnswered = PROVIDER_HTTP_ANSWER.test(providerMessage);
  return {
    kind: "attempt_failed",
    status: result.status,
    heading: providerAnswered ? ANSWERED_HEADINGS[result.status] : "Provider Attempt Failed",
    attempts,
    provider: last.provider,
    model: last.model ?? null,
    providerMessage,
    providerAnswered,
    envKeys,
  };
}
