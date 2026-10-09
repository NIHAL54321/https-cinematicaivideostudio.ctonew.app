/**
 * Phase 7 Block 1 — THE HONESTY AUDIT.
 *
 * Phase 7's single most dangerous trap is a number that LOOKS like market data.
 * This product has no source of search volume, keyword difficulty, competition,
 * trend or estimated traffic — so a publishing package must be incapable of
 * carrying one, and a test must FAIL if one can be manufactured.
 *
 * Two mechanisms, both real (not test-only helpers):
 *
 *   1. `FORBIDDEN_METRIC_KEY` — a key of that shape is forbidden ANYWHERE in a
 *      package, at any depth, in any subtree and under any exemption. There is
 *      deliberately no exemption for it: the honesty declaration names the
 *      metrics it lacks in VALUES (strings), never as keys.
 *   2. `BANNED_CLAIMS` — a phrase no RULE-AUTHORED sentence may contain
 *      ("optimized", "high-volume", "will rank", "guaranteed", "viral", …).
 *      Text copied from the project's own rows is exempt, because a user's own
 *      words are the user's; a project titled "Viral Marketing" must not fail a
 *      build. That exemption is not a loophole: every string value must declare
 *      its `textOrigin`, so text the audit skips is text the producer had to
 *      admit came from a source verbatim.
 *
 * `buildPublishingPackage` runs this on its own output and THROWS if it fails,
 * so a package that could mislead cannot be produced, let alone saved.
 */
import { PUBLISHING_RULES, explainRule } from "./rules";
import { isFieldLike } from "./provenance";

export interface AuditViolation {
  path: string;
  kind:
    | "forbidden_metric_key"
    | "banned_claim"
    | "malformed_field"
    | "unknown_rule"
    | "unlabelled_text_origin"
    | "env_name_mismatch";
  detail: string;
}

export interface AuditResult {
  ok: boolean;
  violationCount: number;
  /** How many object keys and string values were inspected — proof the walk ran. */
  inspectedKeys: number;
  inspectedStrings: number;
  checkedAt: string;
  violations: AuditViolation[];
}

/** Key names that would mean market data exists. Forbidden at any depth. */
export const FORBIDDEN_METRIC_KEY =
  /(volume|difficulty|competition|competitor|traffic|impressions?|popularity|demand|monthly_?search|search_?count|search_?volume|keyword_?search|\bsearch|trend|\bcpc\b|cost_?per_?click|ranking|rank_?position|seo_?score|keyword_?score|\bsv\b|\bkd\b|\bmsv\b)/i;

/** Exactly these bare keys are also refused, because they are tool shorthand. */
export const FORBIDDEN_EXACT_KEYS = ["sv", "kd", "msv", "cpc", "msv%", "kd%", "sv%"];

/** Phrases no rule-authored sentence in a publishing package may contain. */
export const BANNED_CLAIMS = [
  "optimized",
  "optimised",
  "optimize",
  "optimise",
  "optimization",
  "optimisation",
  "high-volume",
  "high volume",
  "will rank",
  "rank higher",
  "ranking higher",
  "boost your views",
  "grow your channel",
  "guaranteed",
  "guarantee",
  "viral",
  "best-performing",
  "top-ranking",
  "seo-friendly",
  "search-optimised",
  "search-optimized",
];

/**
 * Subtree keys whose STRING VALUES may legitimately name the metrics this
 * product does not have (the honesty declaration, and the notes that explain a
 * missing input). The KEY scan is not exempted — none of these keys is itself a
 * metric name.
 */
export const HONESTY_VALUE_EXEMPT_KEYS = [
  "honesty",
  "absentData",
  "statement",
  "absent",
  "notInThisPackage",
  "selfAudit",
];

export const ALLOWED_TEXT_ORIGINS = ["source_verbatim", "rule_authored", "template_filled"];

export interface AuditOptions {
  /** When given, gate env var NAMES must equal this set exactly (server-side check). */
  expectedEnvNames?: readonly string[];
  /** The timestamp stamped on the report (injectable so tests are deterministic). */
  now?: Date;
}

/** Runs the full honesty audit over any JSON-ish value. Returns every violation. */
export function auditPublishingPackage(root: unknown, opts: AuditOptions = {}): AuditResult {
  const violations: AuditViolation[] = [];
  let inspectedKeys = 0;
  let inspectedStrings = 0;
  /** Every env var NAME any gate or declaration in this package prints. */
  const envNamesSeen = new Set<string>();

  const checkText = (value: string, path: string): void => {
    const lower = value.toLowerCase();
    for (const phrase of BANNED_CLAIMS) {
      if (lower.includes(phrase)) {
        violations.push({
          path,
          kind: "banned_claim",
          detail: `rule-authored text contains the banned claim "${phrase}"`,
        });
        return;
      }
    }
  };

  const checkFieldShape = (node: Record<string, unknown>, path: string): void => {
    const state = node.state;
    if (state === "derived") {
      const rule = node.rule;
      if (typeof rule !== "string" || !rule.trim()) {
        violations.push({ path, kind: "malformed_field", detail: "derived field without a rule id" });
      } else if (!(rule in PUBLISHING_RULES)) {
        violations.push({ path, kind: "unknown_rule", detail: `rule "${rule}" is not in the rule catalogue` });
      } else {
        explainRule(rule);
      }
      const sources = node.sources;
      if (!Array.isArray(sources) || sources.length === 0) {
        violations.push({ path, kind: "malformed_field", detail: "derived field with no source rows" });
      } else {
        sources.forEach((s, i) => {
          const ref = s as { kind?: unknown; id?: unknown };
          if (typeof ref?.kind !== "string" || typeof ref?.id !== "string" || !ref.id) {
            violations.push({
              path: `${path}.sources[${i}]`,
              kind: "malformed_field",
              detail: "source ref must carry a row kind and id",
            });
          }
        });
      }
      if (typeof node.value === "string") {
        const origin = node.textOrigin;
        if (typeof origin !== "string" || !ALLOWED_TEXT_ORIGINS.includes(origin)) {
          violations.push({
            path: `${path}.textOrigin`,
            kind: "unlabelled_text_origin",
            detail: "a string value must declare textOrigin as source_verbatim or rule_authored",
          });
        }
      }
    } else if (state === "empty_no_input") {
      if (typeof node.reason !== "string" || !node.reason.trim()) {
        violations.push({ path, kind: "malformed_field", detail: "empty field without a reason" });
      }
      if (!Array.isArray(node.requires) || node.requires.length === 0) {
        violations.push({ path, kind: "malformed_field", detail: "empty field without `requires`" });
      }
      if (node.value !== null) {
        violations.push({ path, kind: "malformed_field", detail: "a non-derived field must have a null value" });
      }
    } else {
      if (typeof node.reason !== "string" || !node.reason.trim()) {
        violations.push({ path, kind: "malformed_field", detail: "gated field without a reason" });
      }
      if (!Array.isArray(node.requires) || node.requires.length === 0) {
        violations.push({ path, kind: "malformed_field", detail: "gated field without `requires`" });
      }
      const envVars = node.envVars;
      if (!Array.isArray(envVars) || envVars.length === 0) {
        violations.push({ path, kind: "malformed_field", detail: "gated field without env var names" });
      } else if (opts.expectedEnvNames) {
        const expected = [...opts.expectedEnvNames].sort().join(",");
        const actual = [...(envVars as string[])].sort().join(",");
        if (expected !== actual) {
          violations.push({
            path: `${path}.envVars`,
            kind: "env_name_mismatch",
            detail: `gate names [${actual}] but the provider registry derives [${expected}]`,
          });
        }
      }
      if (node.value !== null) {
        violations.push({ path, kind: "malformed_field", detail: "a non-derived field must have a null value" });
      }
    }
  };

  const visit = (node: unknown, path: string, valueExempt: boolean): void => {
    if (isFieldLike(node)) {
      checkFieldShape(node as unknown as Record<string, unknown>, path);
    }
    if (typeof node === "string") {
      inspectedStrings += 1;
      if (!valueExempt) checkText(node, path);
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((item, i) => visit(item, `${path}[${i}]`, valueExempt));
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const obj = node as Record<string, unknown>;
    // Text is skipped by the phrase scan for exactly two declared reasons: it
    // came from the project's rows unchanged (source_verbatim), or it is a fixed
    // template with source fragments substituted in (template_filled — the
    // template itself is scanned separately, as `templateText`).
    const declaresVerbatim =
      obj.textOrigin === "source_verbatim" || obj.textOrigin === "template_filled";
    for (const [key, value] of Object.entries(obj)) {
      inspectedKeys += 1;
      const childPath = path ? `${path}.${key}` : key;
      if (FORBIDDEN_METRIC_KEY.test(key) || FORBIDDEN_EXACT_KEYS.includes(key.toLowerCase())) {
        violations.push({
          path: childPath,
          kind: "forbidden_metric_key",
          detail:
            "this product has no search-volume / difficulty / competition / traffic data; a key of this shape may not exist in a publishing package",
        });
      }
      // A plan-level `rule: "R-…"` must resolve too, so a rule id can never be
      // printed that is not in the catalogue.
      if ((key === "rule" || key === "weightRule") && typeof value === "string") {
        if (!(value in PUBLISHING_RULES)) {
          violations.push({
            path: childPath,
            kind: "unknown_rule",
            detail: `rule "${value}" is not in the rule catalogue`,
          });
        }
      }
      // Collect gated env var names (names only, never values) so the whole
      // package's set can be checked against the registry's own derivation.
      if (key === "envVars" && Array.isArray(value)) {
        for (const name of value) if (typeof name === "string" && name) envNamesSeen.add(name);
      }
      const exemptSubtree = HONESTY_VALUE_EXEMPT_KEYS.includes(key);
      // Text copied verbatim from the project's own rows is not phrase-scanned.
      const copiedText = declaresVerbatim && (key === "value" || key === "text" || key === "block" || key === "phrase");
      visit(value, childPath, valueExempt || exemptSubtree || copiedText);
    }
  };

  visit(root, "", false);

  // The package as a whole must not name a provider variable the registry does
  // not derive — checked by UNION, so a gate or a declaration that prints an
  // invented name is caught even if another one prints the right name.
  if (opts.expectedEnvNames && envNamesSeen.size > 0) {
    const expected = [...opts.expectedEnvNames].sort().join(",");
    const actual = [...envNamesSeen].sort().join(",");
    if (expected !== actual) {
      violations.push({
        path: "envVars",
        kind: "env_name_mismatch",
        detail: `the package names env var(s) [${actual}] but the app's provider registry derives [${expected}]`,
      });
    }
  }

  return {
    ok: violations.length === 0,
    violationCount: violations.length,
    inspectedKeys,
    inspectedStrings,
    checkedAt: (opts.now ?? new Date()).toISOString(),
    violations,
  };
}

/** Thrown when a package fails its own honesty audit — a build-time guard. */
export class PublishingHonestyError extends Error {
  violations: AuditViolation[];
  constructor(violations: AuditViolation[]) {
    super(
      `publishing package failed its honesty audit with ${violations.length} violation(s): ` +
        violations
          .slice(0, 5)
          .map((v) => `${v.path} (${v.kind})`)
          .join("; ") +
        (violations.length > 5 ? `; +${violations.length - 5} more` : ""),
    );
    this.name = "PublishingHonestyError";
    this.violations = violations;
  }
}

/** Runs the audit and throws if anything is wrong. */
export function assertPublishingPackage(root: unknown, opts: AuditOptions = {}): AuditResult {
  const result = auditPublishingPackage(root, opts);
  if (!result.ok) throw new PublishingHonestyError(result.violations);
  return result;
}
