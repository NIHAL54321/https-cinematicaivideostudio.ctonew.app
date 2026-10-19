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
import { PROVIDER_SCREEN_STATEMENT, screenProviderText, type ProviderValueKind } from "./provider-text";
import type { SourceRef } from "./provenance";
import {
  TITLE_MODEL_REQUEST_FIELDS,
  type ModelTitle,
  type ProviderAuthoredValue,
  type TitleModelAttempt,
  type TitlesModelOutcome,
  type WithheldProviderValue,
} from "./titles";
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

/**
 * The provider's own titles and other SEO values, verbatim — and the screen every
 * one of them passes before it may become a value of this package.
 *
 * NOTHING HERE CAN INVENT A VALUE: the source is `outputRefs.seo` (this app's own
 * parse of the provider's JSON answer, see `parseSeoJson` in the adapter) or, when
 * the answer did not parse into that shape, the provider's raw text, one line per
 * candidate. Every candidate is then screened by ./provider-text: a value that
 * carries a claim this product does not make, or an unsourced search-volume /
 * difficulty / competition / traffic number, is NOT carried — it is recorded in
 * `withheld` with the provider's characters, the matched phrase and the reason.
 *
 * A value reaches `titles` / `providerValues` only through `screenProviderText`
 * returning ok. There is no other path in this module.
 */
export interface ScreenedSeoValues {
  titles: ModelTitle[];
  values: ProviderAuthoredValue[];
  withheld: WithheldProviderValue[];
  /** How many strings the provider returned that the screen inspected. */
  screened: number;
}

/** Strips a list marker the provider's own text may carry, leaving the title's own characters. */
function stripListMarker(line: string): string {
  return line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
}

/** This app's parse of the provider's answer into the capability's output, when present. */
export function seoAnswerFrom(result: AiResult): Record<string, unknown> | null {
  const refs = result.outputRefs ?? {};
  const seo = (refs as { seo?: unknown }).seo;
  return typeof seo === "object" && seo !== null && !Array.isArray(seo) ? (seo as Record<string, unknown>) : null;
}

const nonEmptyString = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v.trim() : null);
const stringList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim() !== "").map((x) => x.trim()) : [];

/**
 * Read one provider answer into: the values this package may carry (each screened
 * ok) and the values it must not (each withheld, verbatim, with its reason).
 */
export function screenedSeoValuesFrom(result: AiResult): ScreenedSeoValues {
  const empty: ScreenedSeoValues = { titles: [], values: [], withheld: [], screened: 0 };
  if (result.status !== "ok") return empty;

  const providerId = result.provider ?? result.attempts[result.attempts.length - 1]?.provider ?? "unknown";
  const model = result.model ?? result.attempts[result.attempts.length - 1]?.model ?? null;
  const at = result.attempts[result.attempts.length - 1]?.at ?? "unknown-time";
  const sourceRef: SourceRef[] = [{ kind: "request", id: `seo_generation:${providerId}:${at}` }];

  const seo = seoAnswerFrom(result);
  /** Every candidate, in the order the provider returned it, with its kind. */
  const candidates: { kind: ProviderValueKind; text: string }[] = [];
  if (seo) {
    const title = nonEmptyString(seo.title);
    if (title) candidates.push({ kind: "title", text: title });
    for (const t of stringList(seo.titles)) candidates.push({ kind: "title", text: t });
    const description = nonEmptyString(seo.description);
    if (description) candidates.push({ kind: "description", text: description });
    for (const t of stringList(seo.tags)) candidates.push({ kind: "tag", text: t });
    for (const h of stringList(seo.hashtags)) candidates.push({ kind: "hashtag", text: h });
  } else {
    // The answer did not parse into the capability's shape: the provider's own text
    // is the only thing there is, read one line at a time. This is the shape a
    // plain-list answer takes, and it is why the fallback exists.
    const text = typeof result.resultText === "string" ? result.resultText : (result.outputRefs as { resultText?: unknown } | null)?.resultText;
    if (typeof text === "string" && text.trim()) {
      for (const line of text.split(/\r?\n/)) {
        const stripped = stripListMarker(line);
        if (stripped) candidates.push({ kind: "title", text: stripped });
      }
    }
  }

  let screened = 0;
  const titles: ModelTitle[] = [];
  const values: ProviderAuthoredValue[] = [];
  const withheld: WithheldProviderValue[] = [];
  const seenTitles = new Set<string>();
  for (const candidate of candidates) {
    screened += 1;
    const verdict = screenProviderText(candidate.text);
    const id = `provider-${candidate.kind}-${withheld.length + (candidate.kind === "title" ? titles.length : values.length) + 1}`;
    if (!verdict.ok) {
      withheld.push({
        id: `withheld-${withheld.length + 1}`,
        kind: candidate.kind,
        textOrigin: "provider_verbatim",
        text: candidate.text,
        matched: verdict.matched,
        providerId,
        model,
        at,
        disposition: "withheld_not_used",
        reason: verdict.reason,
      });
      continue;
    }
    if (candidate.kind === "title") {
      if (titles.length >= MODEL_TITLE_LIMIT) continue;
      const key = candidate.text.toLowerCase();
      if (seenTitles.has(key)) continue;
      seenTitles.add(key);
      titles.push({
        id: `model-title-${titles.length + 1}`,
        text: candidate.text,
        textOrigin: "provider_verbatim",
        providerId,
        model,
        at,
        sources: sourceRef,
        source: "provider_response",
      });
      continue;
    }
    values.push({
      id,
      kind: candidate.kind,
      text: candidate.text,
      textOrigin: "provider_verbatim",
      providerId,
      model,
      at,
      sources: sourceRef,
    });
  }
  return { titles, values, withheld, screened };
}

/**
 * The provider's OWN titles, verbatim and screened. Kept as its own function
 * because it is the one list a surface may present as model-written titles.
 */
export function providerTitlesFrom(result: AiResult): ModelTitle[] {
  return screenedSeoValuesFrom(result).titles;
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
  const screened = screenedSeoValuesFrom(result);
  return {
    status: result.status,
    attempt: attemptFrom(result),
    titles: screened.titles,
    providerValues: screened.values,
    withheld: screened.withheld,
    screen: {
      rule: "R-SEO-PROVIDER-SCREEN",
      screened: screened.screened,
      withheld: screened.withheld.length,
      statement: PROVIDER_SCREEN_STATEMENT,
    },
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
