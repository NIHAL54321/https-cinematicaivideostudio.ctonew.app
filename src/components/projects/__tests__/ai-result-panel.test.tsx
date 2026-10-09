/**
 * The panel in every state it can be in, rendered to HTML with
 * `renderToStaticMarkup` — the same markup the browser received in the Block 15
 * proof. Deterministic: no DOM, no timers, no network.
 *
 * These pin what a user actually reads:
 *   - the unkeyed state is unchanged ("Provider Not Connected");
 *   - a failed attempt says the provider was reached, names it, prints its own
 *     message verbatim, and lists derived env NAMES — never "none — no provider
 *     slot is registered";
 *   - nothing in a failure looks like progress or success.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AiResultPanel } from "@/components/projects/ai-result-panel";
import type { AiResult } from "@/lib/ai/types";

const POST = "http 401: Incorrect API key provided: sk-****. code invalid_api_key";

function makeResult(partial: Partial<AiResult> & Pick<AiResult, "status">): AiResult {
  return { capability: "script_generation", taskType: "SCRIPT", attempts: [], ...partial };
}

function html(result: AiResult): string {
  return renderToStaticMarkup(<AiResultPanel result={result} />);
}

const NO_SLOT_LINE = "none — no provider slot is registered for this capability";
const NOT_CONNECTED_HEADING = "Provider Not Connected";

describe("AiResultPanel — ok", () => {
  test("a real output is rendered as itself, with no not-connected wording", () => {
    const out = html(makeResult({ status: "ok", resultText: "the provider's real text" }));
    expect(out).toContain("the provider&#x27;s real text");
    expect(out).not.toContain(NOT_CONNECTED_HEADING);
  });
});

describe("AiResultPanel — unkeyed (defect-free state, unchanged)", () => {
  test("no provider attempted: heading, body and derived env badges are exactly as before", () => {
    const out = html(
      makeResult({
        status: "not_connected",
        requiredEnv: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY"],
        error: "Provider Not Connected: no provider is configured and wired for capability \"script_generation\".",
      }),
    );
    expect(out).toContain(NOT_CONNECTED_HEADING);
    expect(out).toContain(
      "Every AI step is attempted through the AI Model Orchestrator, and a step with no connected provider",
    );
    expect(out).toContain("OPENAI_API_KEY");
    expect(out).toContain("ANTHROPIC_API_KEY");
    expect(out).not.toContain(NO_SLOT_LINE);
    expect(out).not.toContain("Provider Reached");
  });

  test("only a capability with NO slot prints the none line", () => {
    const out = html(makeResult({ status: "not_connected", requiredEnv: [] }));
    expect(out).toContain(NOT_CONNECTED_HEADING);
    expect(out).toContain(NO_SLOT_LINE);
  });
});

describe("AiResultPanel — keyed attempt failure (defects (a) + (b))", () => {
  const keyed = makeResult({
    status: "failed",
    attempts: [
      {
        provider: "openai",
        model: "gpt-4o",
        status: "failed",
        latencyMs: 243,
        error: POST,
        at: "2026-10-09T06:56:28.000Z",
      },
    ],
    error: POST,
    generationId: "gen-1",
    requiredEnv: ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_AI_API_KEY", "GOOGLE_API_KEY"],
  });

  test("(a) it says the provider was reached and rejected the attempt — not 'Provider Not Connected'", () => {
    const out = html(keyed);
    expect(out).toContain("Provider Reached — Attempt Rejected");
    expect(out).toContain("was reached and it rejected this attempt");
    expect(out).not.toContain(NOT_CONNECTED_HEADING);
    expect(out).not.toContain("a step with no connected provider");
  });

  test("(a) the provider and model are named", () => {
    const out = html(keyed);
    expect(out).toContain("openai");
    expect(out).toContain("gpt-4o");
    expect(out).toContain("Result status:");
  });

  test("(a) the provider's own message is printed verbatim", () => {
    const out = html(keyed);
    expect(out).toContain(POST);
    expect(out).toContain("The provider&#x27;s own message — verbatim");
  });

  test("(b) the env list is derived and non-empty — never the no-slot line", () => {
    const out = html(keyed);
    expect(out).not.toContain(NO_SLOT_LINE);
    expect(out).toContain("Requires server-side env:");
    for (const name of ["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_AI_API_KEY", "GOOGLE_API_KEY"]) {
      expect(out).toContain(name);
    }
  });

  test("(b) when a result carries no names it claims nothing rather than 'no slot registered'", () => {
    const out = html({ ...keyed, requiredEnv: [] });
    expect(out).not.toContain(NO_SLOT_LINE);
    expect(out).toContain("none reported — this result carried no env var name");
  });

  test("nothing in the failure looks like progress or success", () => {
    const out = html(keyed);
    expect(out).not.toContain("border-ok"); // no ok-styled panel
    expect(out).not.toContain("animate-spin"); // no spinner
    expect(out).not.toContain("Generation succeeded");
    expect(out).toContain("Nothing was generated and nothing was simulated.");
  });

  test("a local error (no provider answer) says so instead of quoting a response", () => {
    const out = html({
      ...keyed,
      attempts: [
        { provider: "openai", model: "gpt-4o", status: "failed", latencyMs: 4, error: "network error: fetch failed", at: "x" },
      ],
      error: "network error: fetch failed",
    });
    expect(out).toContain("Provider Attempt Failed");
    expect(out).not.toContain("Provider Reached");
    expect(out).toContain("The recorded error — verbatim");
    expect(out).toContain("network error: fetch failed");
  });

  test("rate_limited keeps its own heading", () => {
    const out = html({
      ...keyed,
      status: "rate_limited",
      attempts: [
        { provider: "openai", model: "gpt-4o", status: "rate_limited", latencyMs: 12, error: "http 429: rate limited", at: "x" },
      ],
      error: "http 429: rate limited",
    });
    expect(out).toContain("Provider Reached — Rate Limited");
    expect(out).toContain("http 429: rate limited");
  });
});

describe("AiResultPanel — request failed before a provider", () => {
  test("a failure with no attempt is named as such, and no cause is invented", () => {
    const out = html(makeResult({ status: "failed", attempts: [], error: "The request failed." }));
    expect(out).toContain("The AI request failed before any provider was reached");
    expect(out).toContain("No provider attempt was recorded");
    expect(out).toContain("The request failed.");
    expect(out).not.toContain(NOT_CONNECTED_HEADING);
    expect(out).not.toContain(NO_SLOT_LINE);
    expect(out).not.toContain("border-ok");
  });
});
