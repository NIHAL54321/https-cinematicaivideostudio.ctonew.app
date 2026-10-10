/**
 * Phase 7 Block 3 — THE MODEL-BACKED TITLE PATH (server only).
 *
 * This is the ONE place the titles feature asks the app's AI orchestrator for
 * anything. It exists so that the panel which shows titles is not a dead end: when
 * a provider is genuinely wired and keyed for the `seo_generation` capability, the
 * same build that produces the rule-derived titles also carries what that provider
 * really answered, verbatim, attributed to the provider and model that answered.
 *
 * WHAT IT IS TODAY: nothing is both wired and keyed for `seo_generation` on this
 * server, so the orchestrator is asked and answers `not_connected`. That answer is
 * recorded as it is, the panel renders the gated state naming the environment
 * variable the registry derives, and NO TITLE IS ATTRIBUTED TO A MODEL. There is no path in this file
 * that can produce a plausible-looking list without a provider having returned it:
 * `outcomeFromAiResult` refuses to build a title unless the result's status is
 * "ok" and the provider's own output really contained text.
 *
 * WHY THE REQUEST IS BUILT HERE: the app's adapters are shaped by the request the
 * running app actually makes (the same reason `scriptGenerationRouterRequest`
 * lives in the studio pipeline). A test can therefore assert against the app's own
 * builder instead of a hand-written copy of it — see __tests__/titles-model.test.ts.
 *
 * Server-only: it reads the provider registry (which reads process.env) and it is
 * imported only by the publishing service, which the API route wires up. Env var
 * NAMES may travel to the UI; VALUES never do, and none is read here.
 */
import { execute, type AiResult, type AiTask, type ExecuteOptions } from "@/lib/ai";
import type { KeywordPlan } from "./keywords";
import { TITLE_MODEL_REQUEST_FIELDS, type ModelTitle, type TitleModelAttempt, type TitlesModelOutcome } from "./titles";
import type { PublishingSource } from "./types";

/** How many provider-returned titles this app will carry. The provider's own list is not rewritten. */
export const MODEL_TITLE_LIMIT = 40;
/** The transcript sent to a provider is this project's own narration, bounded. */
export const MODEL_TRANSCRIPT_LIMIT = 4000;

/** The provider-requested video shape, derived from the project's own stored aspect ratio. */
export function modelVideoType(source: PublishingSource): "longform" | "shorts" {
  return source.project.targetAspectRatio === "NINE_SIXTEEN" ? "shorts" : "longform";
}

/**
 * The `seo_generation` task this app really builds, from the project's own rows
 * and the phrases this same package extracted from them. One owner, so the
 * adapter that eventually serves the capability is shaped by the request the
 * running app makes.
 *
 * The payload's field names are declared on the plan (`requestFieldNames`) and are
 * asserted in a test against this builder, so the plan cannot describe a request
 * the app does not build.
 */
export function seoGenerationRouterRequest(source: PublishingSource, keywords: KeywordPlan): AiTask {
  const narration: string[] = [];
  for (const chapter of [...source.chapters].sort((a, b) => a.order - b.order)) {
    for (const scene of [...chapter.scenes].sort((a, b) => a.order - b.order)) {
      if (scene.narration && scene.narration.trim()) narration.push(scene.narration.trim());
    }
  }
  const transcript = narration.join("\n\n").slice(0, MODEL_TRANSCRIPT_LIMIT);

  return {
    type: "SEO",
    capability: "seo_generation",
    projectId: source.project.id,
    payload: {
      transcript,
      title: source.project.title,
      keywords: keywords.keywords.slice(0, 20).map((k) => k.text),
      videoType: modelVideoType(source),
      language: source.script?.language ?? source.settings?.language ?? "en",
    },
    params: {
      tone: source.script?.tone ?? source.settings?.tone ?? undefined,
      audience: source.script?.targetAudience ?? source.settings?.targetAudience ?? undefined,
      videoType: modelVideoType(source),
      language: source.script?.language ?? source.settings?.language ?? "en",
    },
    metadata: {
      /** Names only — nothing secret, and no provider response is invented. */
      requestedBy: "phase7-title-engine",
      ruleDerivedTitlesOnly: false,
    },
  };
}

/** Strips a list marker the provider's own text may carry, leaving the title's own characters. */
function stripListMarker(line: string): string {
  return line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
}

/**
 * The provider's OWN titles, verbatim. Returns an empty list unless the result is
 * ok and its output really carried text: this function cannot invent a title.
 */
export function providerTitlesFrom(result: AiResult): ModelTitle[] {
  if (result.status !== "ok") return [];
  const refs = result.outputRefs ?? {};
  const provider = result.provider ?? "unknown";
  const model = result.model ?? null;

  const raw: string[] = [];
  const listish = (refs as { titles?: unknown }).titles;
  if (Array.isArray(listish)) {
    for (const item of listish) if (typeof item === "string") raw.push(item.trim());
  }
  const single = (refs as { title?: unknown }).title;
  if (typeof single === "string" && single.trim()) raw.push(single.trim());
  const text = typeof result.resultText === "string" ? result.resultText : (refs as { resultText?: unknown }).resultText;
  if (typeof text === "string" && text.trim()) {
    for (const line of text.split(/\r?\n/)) {
      const stripped = stripListMarker(line);
      if (stripped) raw.push(stripped);
    }
  }

  const out: ModelTitle[] = [];
  const seen = new Set<string>();
  for (const candidate of raw) {
    if (out.length >= MODEL_TITLE_LIMIT) break;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `model-title-${out.length + 1}`,
      text: candidate,
      textOrigin: "provider_verbatim",
      providerId: provider,
      model,
      source: "provider_response",
    });
  }
  return out;
}

/**
 * The single attempt the orchestrator made, or null when nothing was attempted.
 *
 * The provider's own words go into `providerAnswer` as a DECLARED verbatim value;
 * the orchestrator's own sentence about the attempt goes into
 * `orchestratorMessage`. The two are never mixed and this app never paraphrases
 * either one.
 */
export function attemptFrom(result: AiResult): TitleModelAttempt | null {
  const last = result.attempts[result.attempts.length - 1];
  if (!last) return null;
  return {
    status: last.status,
    providerId: last.provider,
    model: last.model ?? null,
    latencyMs: last.latencyMs ?? null,
    at: last.at,
    orchestratorMessage: typeof result.error === "string" ? result.error : null,
    providerAnswer:
      typeof last.error === "string" && last.error.trim()
        ? {
            textOrigin: "provider_verbatim",
            text: last.error,
            providerId: last.provider,
            model: last.model ?? null,
            at: last.at,
          }
        : null,
  };
}

/**
 * The orchestrator's own answer, mapped to the shape the plan carries. A title is
 * present here only if the result was ok AND carried text.
 */
export function outcomeFromAiResult(result: AiResult): TitlesModelOutcome {
  return {
    status: result.status,
    attempt: attemptFrom(result),
    titles: providerTitlesFrom(result),
    requiredEnv: Array.isArray(result.requiredEnv) ? [...result.requiredEnv] : [],
    nothingAttempted: result.attempts.length === 0,
    orchestratorMessage: typeof result.error === "string" ? result.error : null,
  };
}

/**
 * Asks the app's own AI orchestrator for model-authored titles. Its `not_connected`
 * answer is returned as it stands, and it never fabricates a title.
 */
export async function askSeoTitles(
  userId: string,
  source: PublishingSource,
  keywords: KeywordPlan,
  opts: ExecuteOptions = {},
): Promise<TitlesModelOutcome> {
  const task = seoGenerationRouterRequest(source, keywords);
  const result = await execute(userId, task, opts);
  return outcomeFromAiResult(result);
}

export { TITLE_MODEL_REQUEST_FIELDS };
