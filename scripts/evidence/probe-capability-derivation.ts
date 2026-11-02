/**
 * Evidence probe: is the operator's capability line DERIVED, or typed?
 *
 * Run it twice in the same process — once with PIXABAY_API_KEY absent and once
 * with it present — and compare. The AI capability matrix is rebuilt from
 * `capabilityStatus()` on each call, which reads the environment lazily, so a
 * hand-typed figure cannot follow the key and a derived one must.
 *
 * It also prints the STOCK registry's live state (booleans and env-var NAMES
 * only — never a value), because that is the registry a Pixabay key actually
 * changes, and it is a different registry from the AI orchestrator's.
 *
 *   . /etc/profile.d/cto-env-vars.sh
 *   cd /home/team/app && bun scripts/evidence/probe-capability-derivation.ts
 */
import { allCapabilityStatus } from "@/lib/ai/status";
import { buildCapabilityMatrix } from "@/lib/admin/sections";
import { STOCK_PROVIDERS } from "@/lib/media/providers";

function snapshot(label: string) {
  const m = buildCapabilityMatrix(allCapabilityStatus());
  return {
    label,
    aiCapabilitiesTotal: m.total,
    aiAdaptersBuilt: m.adaptersBuilt,
    aiUsableNow: m.wired,
    headline: m.headline,
    stockMediaSearchRow: m.rows.find((r) => r.capability === "stock_media_search") ?? null,
  };
}

const saved = process.env.PIXABAY_API_KEY;
delete process.env.PIXABAY_API_KEY;
const withoutKey = snapshot("PIXABAY_API_KEY absent");
if (saved !== undefined) process.env.PIXABAY_API_KEY = saved;
const withKey = snapshot(`PIXABAY_API_KEY present (${saved === undefined ? "no — not in this shell" : "yes, value never printed"})`);

const stock = STOCK_PROVIDERS.map((p) => ({
  id: p.id,
  name: p.name,
  supports: [...p.supports],
  rank: p.rank,
  configuredNow: p.isConfigured(),
  requiredEnv: p.requiredEnv(),
}));

const out = {
  aiMatrix: { withoutKey, withKey },
  aiNumbersChangedWhenTheStockKeyAppeared:
    withoutKey.aiAdaptersBuilt !== withKey.aiAdaptersBuilt || withoutKey.aiUsableNow !== withKey.aiUsableNow,
  stockRegistry: stock,
  stockConfiguredCount: stock.filter((s) => s.configuredNow).length,
};
console.log(JSON.stringify(out, null, 2));
