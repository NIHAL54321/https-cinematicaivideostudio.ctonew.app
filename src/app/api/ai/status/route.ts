import { ok, withApiUser } from "@/lib/api";
import { allCapabilityStatus } from "@/lib/ai/status";

export const runtime = "nodejs";

/**
 * GET /api/ai/status — auth-protected per-capability AI connectivity.
 *
 * Returns the real orchestrator state for all 21 capabilities: which are
 * connected (a provider is configured AND wired) and, for not_connected
 * ones, the server-side env var names that would enable them (names only —
 * never values). The AI studio pages render from this response, so the
 * "Provider Not Connected" state is data-driven, never hardcoded.
 *
 * Shape: { capabilities: CapabilityStatusInfo[], generatedAt }
 */
export async function GET() {
  return withApiUser(async () =>
    ok({
      capabilities: allCapabilityStatus(),
      generatedAt: new Date().toISOString(),
    }),
  );
}
