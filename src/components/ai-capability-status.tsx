"use client";

/**
 * Client-side connectivity widgets for the AI studio pages.
 *
 * They fetch GET /api/ai/status (auth-protected, same-origin) and render the
 * REAL orchestrator state per capability — "Provider Not Connected" is
 * data-driven (driven by the API response), never hardcoded. Env var NAMES
 * come from the API for hints; env var VALUES never leave the server.
 *
 * This file must NOT import anything from src/lib/ai (server-only).
 */
import { useEffect, useState } from "react";
import { PlugZap } from "lucide-react";
import { Badge } from "@/components/ui";
import { ProviderNotConnected } from "@/components/provider-not-connected";

export interface CapabilityProviderDto {
  id: string;
  name: string;
  rank: number;
  configured: boolean;
  wired: boolean;
}

export interface CapabilityStatusDto {
  capability: string;
  label: string;
  status: "connected" | "not_connected";
  requiredEnv: string[];
  providers: CapabilityProviderDto[];
}

interface StatusResponse {
  capabilities: CapabilityStatusDto[];
  generatedAt: string;
}

// One shared fetch per page load — several widgets on the same page reuse it.
let statusPromise: Promise<CapabilityStatusDto[]> | null = null;

function fetchCapabilities(): Promise<CapabilityStatusDto[]> {
  if (!statusPromise) {
    statusPromise = fetch("/api/ai/status", { credentials: "same-origin", headers: { accept: "application/json" } })
      .then((res) => {
        if (!res.ok) throw new Error(`status api ${res.status}`);
        return res.json() as Promise<StatusResponse>;
      })
      .then((data) => data.capabilities)
      .catch((err) => {
        statusPromise = null; // allow retry on next mount
        throw err;
      });
  }
  return statusPromise;
}

type LoadState =
  | { phase: "loading" }
  | { phase: "error"; message: string }
  | { phase: "ready"; info: CapabilityStatusDto | undefined };

function useCapabilityStatus(capability: string): LoadState {
  const [state, setState] = useState<LoadState>({ phase: "loading" });
  useEffect(() => {
    let cancelled = false;
    fetchCapabilities()
      .then((caps) => {
        if (!cancelled) setState({ phase: "ready", info: caps.find((c) => c.capability === capability) });
      })
      .catch((err: unknown) => {
        if (!cancelled) setState({ phase: "error", message: err instanceof Error ? err.message : String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, [capability]);
  return state;
}

function requiredEnvHint(info: CapabilityStatusDto | undefined): string {
  if (!info || info.requiredEnv.length === 0) return "No provider slots registered";
  return `Requires server-side env: ${info.requiredEnv.join(", ")}`;
}

/* ------------------------------------------------------------------ */
/* Status stat card                                                    */
/* ------------------------------------------------------------------ */

export function AiCapabilityStatusCard({ capability }: { capability: string }) {
  const state = useCapabilityStatus(capability);
  return (
    <div className="glass glass-hover p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Status</p>
      <div className="mt-1.5">
        {state.phase === "loading" && <p className="text-sm font-medium text-ink-dim">Checking…</p>}
        {state.phase === "error" && (
          <p className="text-sm font-medium text-danger" title={state.message}>
            Unavailable
          </p>
        )}
        {state.phase === "ready" && state.info?.status === "connected" && (
          <p className="text-sm font-medium text-ok" title={requiredEnvHint(state.info)}>
            Connected
          </p>
        )}
        {state.phase === "ready" && state.info?.status !== "connected" && (
          <p className="text-sm font-medium text-accent" title={requiredEnvHint(state.info)}>
            Not Connected
          </p>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Providers wired card                                                */
/* ------------------------------------------------------------------ */

export function AiCapabilityProvidersCard({ capability }: { capability: string }) {
  const state = useCapabilityStatus(capability);
  return (
    <div className="glass glass-hover p-4">
      <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Providers wired</p>
      <p className="mt-1.5 text-sm font-medium text-ink" title={requiredEnvHint(state.phase === "ready" ? state.info : undefined)}>
        {state.phase === "loading" && "Checking…"}
        {state.phase === "error" && "Unavailable"}
        {state.phase === "ready" &&
          (state.info && state.info.providers.filter((p) => p.wired).length > 0
            ? state.info.providers
                .filter((p) => p.wired)
                .map((p) => p.name)
                .join(", ")
            : "None yet")}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The big data-driven "Provider Not Connected" / connected panel      */
/* ------------------------------------------------------------------ */

export function AiCapabilityConnectivityPanel({ capability }: { capability: string }) {
  const state = useCapabilityStatus(capability);

  if (state.phase === "loading") {
    return (
      <div className="glass flex flex-col items-center gap-4 border-accent-line/30 px-6 py-14 text-center">
        <p className="text-sm text-ink-dim">Checking AI provider connectivity…</p>
      </div>
    );
  }
  if (state.phase === "error") {
    return (
      <div className="glass flex flex-col items-center gap-4 border-danger/30 px-6 py-14 text-center">
        <h2 className="font-display text-lg font-semibold text-ink">Connectivity Check Failed</h2>
        <p className="mx-auto max-w-xl text-sm leading-relaxed text-ink-dim">
          Could not reach the AI status service. Connectivity cannot be verified right now — nothing has been
          simulated or generated.
        </p>
      </div>
    );
  }

  const info = state.info;
  if (!info) {
    return (
      <div className="glass flex flex-col items-center gap-4 border-accent-line/30 px-6 py-14 text-center">
        <h2 className="font-display text-lg font-semibold text-ink">Unknown Capability</h2>
        <p className="mx-auto max-w-xl text-sm leading-relaxed text-ink-dim">
          “{capability}” is not a registered AI capability on this server.
        </p>
      </div>
    );
  }

  const wired = info.providers.filter((p) => p.wired);
  const configured = info.providers.filter((p) => p.configured);

  if (info.status === "connected") {
    return (
      <div className="glass flex flex-col items-center gap-4 border-ok/25 px-6 py-14 text-center">
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-ok/10 border border-ok/25 text-ok">
          <PlugZap size={24} strokeWidth={1.75} />
        </span>
        <div>
          <h2 className="font-display text-lg font-semibold text-ink">{info.label} Connected</h2>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-ink-dim">
            Ready through {wired.map((p) => p.name).join(", ")}. Tasks are routed through the AI Model
            Orchestrator, which falls through to the next ranked provider when one fails.
          </p>
        </div>
      </div>
    );
  }

  // not_connected — the honest state, fully data-driven from the API.
  const note =
    configured.length > 0
      ? `API keys are set for ${configured.map((p) => p.name).join(", ")}, but no adapter serving this capability is wired yet — connectivity stays "not connected" until one is.`
      : `No API keys are configured for this capability on the server. Add one of the env vars below to .env and restart — nothing is simulated.`;

  return (
    <ProviderNotConnected
      providerKeys={info.requiredEnv}
      note={note}
    />
  );
}
