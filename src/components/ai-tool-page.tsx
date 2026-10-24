import type { LucideIcon } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { DEFAULT_ATTEMPTS_LIMIT } from "@/lib/ai/orchestrator";
import { capabilityConnectivity } from "@/lib/ai/providers/capability-connectivity";
import {
  AiCapabilityStatusCard,
  AiCapabilityProvidersCard,
  AiCapabilityConnectivityPanel,
} from "@/components/ai-capability-status";
import {
  groupCapabilities,
  type AiCapabilityItem,
} from "@/lib/product/ai-tool-capabilities";

/**
 * Shared shell for the AI Studio tools.
 *
 * Connectivity is DATA-DRIVEN: the status/panel widgets fetch
 * GET /api/ai/status (real orchestrator state) and render "Provider Not
 * Connected" from the API response, with the required server-side env var
 * names as hints. Nothing is hardcoded and nothing is simulated.
 *
 * The capability list below used to be ONE list under ONE heading — "Planned
 * capabilities" — which was false on every page where part of the list already
 * works in this build. It is now grouped by a standing DERIVED per item
 * (`groupCapabilities`): what this build computes itself, what a wired provider
 * could do right now, what is waiting for a key, what has no adapter, and what
 * has no code path at all. Each heading comes from
 * `CAPABILITY_STANDING_HEADING`; a page with nothing in a group renders no
 * heading for it. The `/ai` routes are dynamic, so the connectivity read happens
 * per request and never freezes into a build.
 */
export function AiToolPage({
  icon: Icon,
  title,
  description,
  capability,
  capabilities,
  formats,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  /** The orchestrator capability this tool maps to (e.g. "script_generation"). */
  capability: string;
  /** The page's items, each carrying its own basis — see ai-tool-capabilities. */
  capabilities: readonly AiCapabilityItem[];
  formats: string;
}) {
  const groups = groupCapabilities(capabilities, capability, capabilityConnectivity(capability));

  return (
    <div>
      <PageHeader
        title={title}
        description={description}
        actions={
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-panel-2 border border-line text-ink-dim">
            <Icon size={18} strokeWidth={1.75} />
          </span>
        }
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <AiCapabilityStatusCard capability={capability} />
        <div className="glass glass-hover p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Formats</p>
          <p className="mt-1.5 text-sm font-medium text-ink">{formats}</p>
        </div>
        <AiCapabilityProvidersCard capability={capability} />
        <div className="glass glass-hover p-4">
          {/* The letter picture this card used to print read like a delivered
              pipeline. The derived fact is the orchestrator's own attempt limit. */}
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Attempt chain</p>
          <p className="mt-1.5 text-sm font-medium text-ink">
            up to {DEFAULT_ATTEMPTS_LIMIT} ranked providers, in order
          </p>
        </div>
      </div>

      <AiCapabilityConnectivityPanel capability={capability} />

      {groups.map((group) => (
        <div key={group.standing} className="mt-6">
          <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-faint">
            {group.heading}
          </p>
          {group.detail ? (
            <p className="mb-3 text-xs text-ink-faint">{group.detail}</p>
          ) : (
            <div className="mb-3" />
          )}
          <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {group.items.map((c) => (
              <li key={c.text} className="glass glass-hover flex items-center gap-2.5 px-4 py-3 text-sm text-ink-dim">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    group.standing === "works-now" || group.standing === "available-now"
                      ? "bg-accent"
                      : "bg-line"
                  }`}
                />
                {c.text}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
