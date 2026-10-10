import { apiError, apiRateLimit, ok, readJson, requireApiUser } from "@/lib/api";
import { PublishingHonestyError } from "@/lib/publishing/audit";
import { runPublishingAction } from "@/lib/publishing/service";
import { createPrismaPublishStore } from "@/lib/publishing/store";
export const runtime = "nodejs";

/**
 * POST /api/studio/publishing — Phase 7 Block 1, the publishing package.
 *
 * Body: { action: "build" | "read" | "list", projectId: string, callToAction?: string }
 *
 * `build` derives a publishing package for one project from the rows this app
 * really has — the project's own title/description, its Script, its real
 * Chapter/Scene rows (titles, order, narrative structure and the scenes' own
 * durationSeconds), and its Asset + LicensingMetadata rows — and appends it as a
 * saved version. Every value in the package carries the rule that produced it
 * and the row/field/span it came from, or is explicitly empty and saying which
 * input is missing. `read` returns the newest saved version and RE-AUDITS the
 * stored bytes; `list` returns the saved versions' counts without their payloads.
 *
 * Honesty invariants, enforced at build time (see src/lib/publishing/audit.ts):
 *   - no search-volume, difficulty, competition, trend or estimated-traffic data
 *     exists in this product, and no key of that shape may exist in a package —
 *     the build THROWS if one can be found;
 *   - no rule-authored sentence may contain a banned claim ("optimized",
 *     "high-volume", "will rank", "guaranteed", "viral", …);
 *   - every derived value names a rule from the catalogue (src/lib/publishing/
 *     rules.ts) and at least one source row; every non-derived value names the
 *     input it needs.
 *
 * ONE provider path is asked, and only to record what it says. A build asks the
 * app's own AI orchestrator for the `seo_generation` capability behind the
 * model-backed title list; whatever that call answers is recorded on the package
 * as it came back, and NO TITLE IS ATTRIBUTED TO A MODEL unless a provider
 * really returned one. The rule-derived titles, the
 * chapters, description, keywords, tags, hashtags and pinned comment are
 * produced by deterministic rules and involve no provider at all. The parts of
 * Phase 7 that are not built yet stay declared ABSENT in
 * `honesty.notInThisPackage`, with the provider env var NAMES the registry
 * derives. A licence record that does not exist is reported unknown/unverified —
 * never assumed acceptable — and the licence report states on its own data that
 * it is not legal clearance.
 */
export async function POST(req: Request) {
  try {
    const userId = await requireApiUser();
    await apiRateLimit(userId, "studio:publishing", 60);
    const body = await readJson(req);
    const result = await runPublishingAction(createPrismaPublishStore(), userId, body);
    return ok(result.body, result.status);
  } catch (err) {
    if (err instanceof PublishingHonestyError) {
      // Should be unreachable: the package builder refuses to return a package
      // that fails its own audit. If it ever fires, the response names the exact
      // violations rather than hiding them behind a 500.
      return ok(
        {
          error: "The publishing package failed its own honesty audit and was not produced.",
          code: "honesty_audit_failed",
          violations: err.violations,
        },
        500,
      );
    }
    return apiError(err);
  }
}
