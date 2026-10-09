"use client";

import { AlertTriangle } from "lucide-react";
import { ProviderNotConnected } from "@/components/provider-not-connected";
import { Badge } from "@/components/ui";
import { aiResultView, type AiResultView } from "@/lib/ai/result-view";
import type { AiResult } from "@/lib/ai/types";

/**
 * Renders a real orchestrator AiResult — and nothing else. It describes the
 * state it was given, in that state's own terms:
 *
 *   ok             → the provider's real output
 *   not_connected  → "Provider Not Connected" (no provider was attempted)
 *   attempt_failed → a provider WAS reached and its own answer is shown
 *                    verbatim (this used to be labelled "Provider Not
 *                    Connected", which named the wrong cause)
 *   request_failed → the request failed with no provider attempt recorded
 *
 * Never fabricates success, and never invents a cause: if it did not happen,
 * this panel does not say it did.
 */
export function AiResultPanel({ result }: { result: AiResult }) {
  return <AiResultViewPanel view={aiResultView(result)} />;
}

/**
 * The panel driven by an ALREADY-CLASSIFIED view, for surfaces whose payload is
 * not an orchestrator `AiResult` (the studio routes, which answer with
 * `connected: boolean` plus the orchestrator's own attempts). Those surfaces
 * classify with `studioStepView()` and render through here — one implementation,
 * so a sibling can no longer grow its own "Provider Not Connected" heading for a
 * reached-and-rejected attempt.
 */
export function AiResultViewPanel({ view }: { view: AiResultView }) {
  switch (view.kind) {
    case "ok":
      return (
        <div className="rounded-xl border border-ok/25 bg-ok/10 px-4 py-3 text-sm text-ok">
          {view.text}
        </div>
      );
    case "not_connected":
      // The unkeyed state, unchanged: no provider was attempted, so the honest
      // answer is still "Provider Not Connected" with the derived env names.
      return <ProviderNotConnected providerKeys={view.envKeys} note={view.note} />;
    case "attempt_failed":
      return <ProviderAttemptFailed view={view} />;
    case "request_failed":
      return <AiRequestFailed view={view} />;
  }
}

/** The env-var row: names derived server-side from the provider registry. */
function EnvRequirements({ envKeys, emptyText }: { envKeys: string[]; emptyText: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] uppercase tracking-wider text-ink-faint">Requires server-side env:</span>
      {envKeys.length > 0 ? (
        envKeys.map((k) => (
          <Badge key={k} tone="neutral" className="font-mono normal-case tracking-normal">
            {k}
          </Badge>
        ))
      ) : (
        <span className="text-[11px] text-ink-faint" data-testid="provider-no-env-var">
          {emptyText}
        </span>
      )}
    </div>
  );
}

type AttemptFailedView = Extract<AiResultView, { kind: "attempt_failed" }>;

/**
 * A connected provider was attempted and the attempt failed. This panel names
 * the provider, prints the provider's own message verbatim, and states whether
 * a provider actually answered — it never claims a cause the recorded attempt
 * does not show.
 */
export function ProviderAttemptFailed({ view }: { view: AttemptFailedView }) {
  const providerLine = view.model ? `${view.provider} · ${view.model}` : view.provider;
  return (
    <div
      className="glass flex flex-col gap-4 border-danger/30 px-6 py-8"
      data-testid="provider-attempt-failed"
      data-provider-answered={view.providerAnswered ? "true" : "false"}
      data-attempt-status={view.status}
    >
      <div className="flex items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-danger/40 bg-danger/10 text-danger">
          <AlertTriangle size={22} strokeWidth={1.75} />
        </span>
        <div>
          <h2 className="font-display text-lg font-semibold text-ink" data-testid="provider-attempt-heading">
            {view.heading}
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-dim">
            {view.providerAnswered
              ? "A provider was connected for this step, the app sent it a real request, and the provider answered with an error — it was reached and it rejected this attempt. Its own answer is printed below, exactly as it came back."
              : "A provider was selected for this step and the attempt did not complete, so no provider answer was recorded. What is printed below is the error the app recorded, not a provider response."}
          </p>
        </div>
      </div>

      <dl className="grid gap-1.5 text-xs text-ink-dim">
        <div className="flex flex-wrap items-center gap-2">
          <dt className="uppercase tracking-wider text-ink-faint">Provider attempted:</dt>
          <dd className="font-mono text-ink" data-testid="attempt-failed-provider">
            {providerLine}
          </dd>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <dt className="uppercase tracking-wider text-ink-faint">Attempts recorded:</dt>
          <dd className="font-mono text-ink">{view.attempts.map((a) => a.provider).join(" → ")}</dd>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <dt className="uppercase tracking-wider text-ink-faint">Result status:</dt>
          <dd className="font-mono text-ink" data-testid="attempt-failed-status">
            {view.status}
          </dd>
        </div>
      </dl>

      <div>
        <p className="text-[11px] uppercase tracking-wider text-ink-faint">
          {view.providerAnswered ? "The provider's own message — verbatim" : "The recorded error — verbatim"}
        </p>
        <p
          className="mt-1 whitespace-pre-wrap break-words rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-xs text-ink-dim"
          data-testid="attempt-failed-message"
        >
          {view.providerMessage}
        </p>
        <p className="mt-1.5 text-[11px] text-ink-faint">Nothing was generated and nothing was simulated.</p>
      </div>

      <EnvRequirements
        envKeys={view.envKeys}
        emptyText="none reported — this result carried no env var name"
      />
    </div>
  );
}

type RequestFailedView = Extract<AiResultView, { kind: "request_failed" }>;

/**
 * The request failed with no provider attempt recorded — the app's own
 * plumbing, session or network, not a provider. Says exactly that, and names
 * no env var unless the result carried a derived one.
 */
export function AiRequestFailed({ view }: { view: RequestFailedView }) {
  return (
    <div className="glass flex flex-col gap-4 border-danger/30 px-6 py-8" data-testid="ai-request-failed">
      <div className="flex items-start gap-4">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border border-danger/40 bg-danger/10 text-danger">
          <AlertTriangle size={22} strokeWidth={1.75} />
        </span>
        <div>
          <h2 className="font-display text-lg font-semibold text-ink" data-testid="ai-request-failed-heading">
            The AI request failed before any provider was reached
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-ink-dim">
            No provider attempt was recorded for this step, so this is not a provider answering — the request did
            not get that far. Nothing was generated and nothing was simulated.
          </p>
        </div>
      </div>
      <p
        className="whitespace-pre-wrap break-words rounded-lg border border-line bg-panel-2 px-3 py-2 font-mono text-xs text-ink-dim"
        data-testid="ai-request-failed-message"
      >
        {view.note}
      </p>
      {view.envKeys.length > 0 ? (
        <EnvRequirements
          envKeys={view.envKeys}
          emptyText="none reported — this result carried no env var name"
        />
      ) : null}
    </div>
  );
}
