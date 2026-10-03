import { PlugZap } from "lucide-react";
import { Badge } from "@/components/ui";

/**
 * The one honest state for anything that needs an AI provider in Phase 1:
 * "Provider Not Connected". We never simulate generation — when real APIs are
 * wired in later phases, this component disappears in favor of the real tool.
 */
export function ProviderNotConnected({
  providerKeys,
  note,
}: {
  /** The env var names that will power this tool (server-side only). */
  providerKeys: string[];
  note?: string;
}) {
  return (
    <div className="glass flex flex-col items-center gap-4 border-accent-line/30 px-6 py-14 text-center">
      <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-accent-soft border border-accent-line text-accent">
        <PlugZap size={24} strokeWidth={1.75} />
      </span>
      <div>
        <h2 className="font-display text-lg font-semibold text-ink">Provider Not Connected</h2>
        <p className="mx-auto mt-2 max-w-xl text-sm leading-relaxed text-ink-dim">
          AI generation is not wired up yet in Phase 1. When providers are connected in a later phase, this
          studio will call the AI Model Orchestrator (with automatic provider fallback) — nothing is ever
          simulated or faked.
        </p>
        {note ? <p className="mx-auto mt-2 max-w-xl text-xs leading-relaxed text-ink-faint">{note}</p> : null}
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <span className="text-[11px] uppercase tracking-wider text-ink-faint">Requires server-side env:</span>
        {providerKeys.length > 0 ? (
          providerKeys.map((k) => (
            <Badge key={k} tone="neutral" className="font-mono normal-case tracking-normal">
              {k}
            </Badge>
          ))
        ) : (
          // The engine named no env var because none exists for this capability.
          // Printing a placeholder here would tell an operator to set a variable
          // that no code reads — so we say exactly that instead.
          <span className="text-[11px] text-ink-faint" data-testid="provider-no-env-var">
            none — no provider slot is registered for this capability, so no env var would enable it
          </span>
        )}
      </div>
    </div>
  );
}
