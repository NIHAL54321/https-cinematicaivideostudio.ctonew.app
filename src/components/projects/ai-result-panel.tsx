"use client";

import { ProviderNotConnected } from "@/components/provider-not-connected";
import type { AiResult } from "@/lib/ai/types";

/**
 * Renders a real orchestrator AiResult: success text, or the honest
 * "Provider Not Connected" state with the required server-side env vars.
 * Never fabricates success — it renders exactly what the orchestrator said.
 */
export function AiResultPanel({ result }: { result: AiResult }) {
  if (result.status === "ok") {
    return (
      <div className="rounded-xl border border-ok/25 bg-ok/10 px-4 py-3 text-sm text-ok">
        {result.resultText ?? "Generation succeeded through a connected provider."}
      </div>
    );
  }
  const isNotConnected = result.status === "not_connected";
  return (
    <ProviderNotConnected
      providerKeys={result.requiredEnv ?? []}
      note={
        isNotConnected
          ? result.error ?? "Provider Not Connected."
          : `The AI request failed: ${result.error ?? "unknown error"}. Nothing was simulated.`
      }
    />
  );
}
