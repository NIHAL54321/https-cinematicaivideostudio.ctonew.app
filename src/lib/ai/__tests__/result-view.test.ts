/**
 * The classification every result surface renders from. This file pins the two
 * Block 15 defects:
 *
 *   (a) a `failed` result — a provider connected, attempted and answered — was
 *       described as "Provider Not Connected", naming the wrong cause;
 *   (b) the same result printed "none — no provider slot is registered for this
 *       capability", which is false when a slot exists and was attempted.
 *
 * Deterministic, no sleeps, no network, no environment reads.
 */
import { describe, expect, test } from "bun:test";
import { aiResultView, studioStepView } from "../result-view";
import type { AiAttempt, AiResult } from "../types";

/** The provider's own answer, exactly as the app recorded it in Block 14. */
const OPENAI_401 =
  'http 401: { "error": { "message": "Incorrect API key provided: sk-****.", "type": "invalid_request_error", "code": "invalid_api_key", "param": null }, "status": 401 }';

function attempt(partial: Partial<AiAttempt> = {}): AiAttempt {
  return {
    provider: "openai",
    model: "gpt-4o",
    status: "failed",
    latencyMs: 243,
    error: OPENAI_401,
    at: "2026-10-09T06:56:28.000Z",
    ...partial,
  };
}

function makeResult(partial: Partial<AiResult> & Pick<AiResult, "status">): AiResult {
  return {
    capability: "script_generation",
    taskType: "SCRIPT",
    attempts: [],
    ...partial,
  };
}

describe("aiResultView — ok", () => {
  test("a real output is the ok state, with its own text", () => {
    const view = aiResultView(makeResult({ status: "ok", resultText: "real provider text" }));
    expect(view.kind).toBe("ok");
    expect(view.kind === "ok" && view.text).toBe("real provider text");
  });

  test("an ok result with no text still says what happened, and claims no more", () => {
    const view = aiResultView(makeResult({ status: "ok", resultText: null }));
    expect(view.kind === "ok" && view.text).toBe("Generation succeeded through a connected provider.");
  });
});

describe("aiResultView — not_connected (the unkeyed state, unchanged)", () => {
  test("no provider attempted: the state stays not_connected and carries the derived names", () => {
    const view = aiResultView(
      makeResult({
        status: "not_connected",
        requiredEnv: ["OPENAI_API_KEY"],
        error: "Provider Not Connected: no provider is configured and wired for capability \"script_generation\".",
      }),
    );
    expect(view.kind).toBe("not_connected");
    expect(view.kind === "not_connected" && view.envKeys).toEqual(["OPENAI_API_KEY"]);
    expect(view.kind === "not_connected" && view.note).toContain("Provider Not Connected");
  });

  test("a capability with no slot at all carries an empty list (the only case that may say so)", () => {
    const view = aiResultView(makeResult({ status: "not_connected", requiredEnv: [] }));
    expect(view.kind).toBe("not_connected");
    expect(view.kind === "not_connected" && view.envKeys).toEqual([]);
  });
});

describe("aiResultView — attempt_failed (defect (a): a provider was reached)", () => {
  test("a keyed 401 is an ATTEMPT, never 'Provider Not Connected'", () => {
    const view = aiResultView(
      makeResult({
        status: "failed",
        attempts: [attempt()],
        error: OPENAI_401,
        requiredEnv: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
      }),
    );
    // The regression this block exists for:
    expect(view.kind).not.toBe("not_connected");
    expect(view.kind).toBe("attempt_failed");
    if (view.kind !== "attempt_failed") throw new Error("unreachable");
    expect(view.provider).toBe("openai");
    expect(view.model).toBe("gpt-4o");
    expect(view.status).toBe("failed");
    expect(view.providerAnswered).toBe(true);
    expect(view.heading).toBe("Provider Reached — Attempt Rejected");
    // The provider's own message is carried VERBATIM — byte for byte.
    expect(view.providerMessage).toBe(OPENAI_401);
  });

  test("the env list is what the result carried — never dropped, never invented", () => {
    const view = aiResultView(
      makeResult({
        status: "failed",
        attempts: [attempt()],
        error: OPENAI_401,
        requiredEnv: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_AI_API_KEY", "GOOGLE_API_KEY"],
      }),
    );
    if (view.kind !== "attempt_failed") throw new Error("expected attempt_failed");
    expect(view.envKeys.length).toBeGreaterThan(0);
    expect(view.envKeys).toEqual(["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_AI_API_KEY", "GOOGLE_API_KEY"]);
  });

  test("a local error (nothing left the machine) is not described as a provider answer", () => {
    const view = aiResultView(
      makeResult({
        status: "failed",
        attempts: [attempt({ error: "network error: fetch failed" })],
        error: "network error: fetch failed",
        requiredEnv: ["OPENAI_API_KEY"],
      }),
    );
    if (view.kind !== "attempt_failed") throw new Error("expected attempt_failed");
    expect(view.providerAnswered).toBe(false);
    expect(view.heading).toBe("Provider Attempt Failed");
    expect(view.providerMessage).toBe("network error: fetch failed");
  });

  test("rate_limited and timeout keep their own cause, still with the provider named", () => {
    const limited = aiResultView(
      makeResult({
        status: "rate_limited",
        attempts: [attempt({ status: "rate_limited", error: "http 429: rate limited" })],
        requiredEnv: ["OPENAI_API_KEY"],
      }),
    );
    if (limited.kind !== "attempt_failed") throw new Error("expected attempt_failed");
    expect(limited.status).toBe("rate_limited");
    expect(limited.providerAnswered).toBe(true);
    expect(limited.heading).toBe("Provider Reached — Rate Limited");

    const timedOut = aiResultView(
      makeResult({
        status: "timeout",
        attempts: [attempt({ status: "timeout", error: "http 504: upstream timeout" })],
        requiredEnv: ["OPENAI_API_KEY"],
      }),
    );
    if (timedOut.kind !== "attempt_failed") throw new Error("expected attempt_failed");
    expect(timedOut.status).toBe("timeout");
    expect(timedOut.heading).toBe("Provider Reached — Attempt Timed Out");

    const localTimeout = aiResultView(
      makeResult({
        status: "timeout",
        attempts: [attempt({ status: "timeout", error: "request timed out after 120000ms" })],
        requiredEnv: ["OPENAI_API_KEY"],
      }),
    );
    if (localTimeout.kind !== "attempt_failed") throw new Error("expected attempt_failed");
    expect(localTimeout.providerAnswered).toBe(false);
    expect(localTimeout.heading).toBe("Provider Attempt Failed");
  });

  test("the last attempt of an A → B → C → D chain is the one quoted", () => {
    const view = aiResultView(
      makeResult({
        status: "failed",
        attempts: [
          attempt({ provider: "stub-a", model: "a-model", error: "first failed" }),
          attempt({ provider: "stub-b", model: "b-model", error: "http 500: second failed" }),
        ],
        requiredEnv: ["OPENAI_API_KEY"],
      }),
    );
    if (view.kind !== "attempt_failed") throw new Error("expected attempt_failed");
    expect(view.attempts).toHaveLength(2);
    expect(view.provider).toBe("stub-b");
    expect(view.providerMessage).toBe("http 500: second failed");
  });
});

describe("aiResultView — request_failed (no attempt recorded)", () => {
  test("a failure with no attempts is its own state, not a provider answer", () => {
    const view = aiResultView(
      makeResult({ status: "failed", attempts: [], error: "The request failed." }),
    );
    expect(view.kind).toBe("request_failed");
    expect(view.kind === "request_failed" && view.note).toBe("The request failed.");
    expect(view.kind === "request_failed" && view.envKeys).toEqual([]);
  });

  test("the env names a plumbing failure happened to carry are kept", () => {
    const view = aiResultView(
      makeResult({
        status: "failed",
        attempts: [],
        error: "failed to open AIGeneration audit row: boom",
        requiredEnv: ["OPENAI_API_KEY"],
      }),
    );
    if (view.kind !== "request_failed") throw new Error("expected request_failed");
    expect(view.envKeys).toEqual(["OPENAI_API_KEY"]);
  });
});

describe("aiResultView — every status, and only four states", () => {
  test("no status is ever silently rendered as ok, and attempts always beat not_connected", () => {
    const statuses = ["ok", "not_connected", "failed", "rate_limited", "timeout"] as const;
    for (const status of statuses) {
      const withAttempt = aiResultView(makeResult({ status, attempts: [attempt()], requiredEnv: ["OPENAI_API_KEY"] }));
      if (status === "ok") {
        expect(withAttempt.kind).toBe("ok");
      } else if (status === "not_connected") {
        // Structurally impossible for the orchestrator (not_connected means no
        // attempt), but if a result ever came that way the panel still must not
        // claim an attempt happened.
        expect(withAttempt.kind).toBe("not_connected");
      } else {
        expect(withAttempt.kind).toBe("attempt_failed");
      }
      expect(["ok", "not_connected", "attempt_failed", "request_failed"]).toContain(withAttempt.kind);
    }
  });
});

/**
 * `studioStepView` — the SAME four-state reading for a studio ROUTE payload
 * (`connected: boolean` + the orchestrator's own status/attempts), which is what
 * the music / sfx / voice / subtitle / generate surfaces render from. Before this
 * block each of them hard-rendered "Provider Not Connected" for every
 * `connected:false`, so a reached-and-rejected attempt borrowed the wrong cause.
 */
describe("studioStepView — a studio route payload", () => {
  test("no attempts recorded: the unkeyed state, with the payload's own note", () => {
    const view = studioStepView({
      connected: false,
      requiredEnv: ["REPLICATE_API_TOKEN", "RUNWAY_API_KEY"],
      note: "Provider Not Connected: set one of REPLICATE_API_TOKEN, RUNWAY_API_KEY server-side to enable music_generation.",
    });
    expect(view.kind).toBe("not_connected");
    if (view.kind !== "not_connected") throw new Error("unreachable");
    expect(view.envKeys).toEqual(["REPLICATE_API_TOKEN", "RUNWAY_API_KEY"]);
    expect(view.note).toContain("Provider Not Connected");
  });

  test("attempts recorded: a reached-and-rejected attempt is NEVER 'not connected'", () => {
    const view = studioStepView({
      connected: false,
      status: "failed",
      attempts: [
        { provider: "replicate", model: "topazlabs/video-upscale", status: "failed", latencyMs: 199, error: OPENAI_401, at: "t" },
      ],
      error: `The music request could not complete: ${OPENAI_401}. Nothing was fabricated.`,
      requiredEnv: ["REPLICATE_API_TOKEN", "STABILITY_API_KEY"],
      note: "The music request could not complete.",
    });
    expect(view.kind).toBe("attempt_failed");
    if (view.kind !== "attempt_failed") throw new Error("unreachable");
    expect(view.heading).toBe("Provider Reached — Attempt Rejected");
    expect(view.provider).toBe("replicate");
    expect(view.model).toBe("topazlabs/video-upscale");
    expect(view.providerAnswered).toBe(true);
    // Verbatim: the attempt's own message, not the route's sentence around it.
    expect(view.providerMessage).toBe(OPENAI_401);
    expect(view.envKeys).toEqual(["REPLICATE_API_TOKEN", "STABILITY_API_KEY"]);
  });

  test("a local error with an attempt is a different heading, and claims no provider answer", () => {
    const view = studioStepView({
      connected: false,
      attempts: [{ provider: "replicate", model: null, status: "failed", error: "request build failed: no url", at: "t" }],
      requiredEnv: ["REPLICATE_API_TOKEN"],
    });
    if (view.kind !== "attempt_failed") throw new Error("expected attempt_failed");
    expect(view.providerAnswered).toBe(false);
    expect(view.heading).toBe("Provider Attempt Failed");
  });

  test("the status falls back to the recorded attempt when the route forwarded none", () => {
    const view = studioStepView({
      connected: false,
      attempts: [{ provider: "openai", model: "gpt-4o", status: "rate_limited", error: "http 429: slow down", at: "t" }],
      requiredEnv: ["OPENAI_API_KEY"],
    });
    if (view.kind !== "attempt_failed") throw new Error("expected attempt_failed");
    expect(view.status).toBe("rate_limited");
    expect(view.heading).toBe("Provider Reached — Rate Limited");
  });

  test("an empty payload says nothing it cannot support", () => {
    const view = studioStepView({});
    expect(view.kind).toBe("not_connected");
    if (view.kind !== "not_connected") throw new Error("unreachable");
    expect(view.envKeys).toEqual([]);
    expect(view.note).toBe("Provider Not Connected.");
  });
});
