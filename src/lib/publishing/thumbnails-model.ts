/**
 * Phase 7 Block 4 — THE MODEL-BACKED THUMBNAIL-CONCEPT PATH (server only).
 *
 * This is the ONE place the thumbnail block asks the app's AI orchestrator for
 * anything. It exists so that the concepts panel is not a dead end: when a
 * provider is genuinely wired and keyed for the `thumbnail_generation` capability,
 * the same build that produces the traced concepts also carries what that provider
 * really answered, verbatim, attributed to the provider and model that answered.
 *
 * WHICH CAPABILITY, AND WHY: `thumbnail_generation`, not the generic sibling
 * `image_generation`. The app's own registry (src/lib/ai/types.ts — AI_CAPABILITIES)
 * carries a capability for exactly this work, its slots declare
 * thumbnail-generation models (openai: gpt-image-1, google: imagen-4.0,
 * replicate: flux-schnell, stability: sd3.5-large-turbo), and the route
 * (src/lib/ai/router.ts) already maps the THUMBNAIL task type onto it. Asking for
 * the capability the product actually built for thumbnails is the request an
 * adapter written later would have to satisfy; asking for the generic one would
 * describe a request this feature does not make.
 *
 * WHAT IT IS TODAY: no slot serving `thumbnail_generation` has a real call()
 * implementation, so the answer this capability gets is `not_connected` whatever a
 * server operator has set. That answer is recorded as it is, the concept panel
 * renders the gated state naming
 * the environment variable names the registry derives, and NO CONCEPT IS
 * ATTRIBUTED TO A MODEL. There is no path in this file that can produce a
 * plausible-looking concept without a provider having returned it:
 * `providerConceptsFrom` refuses to build one unless the result's status is "ok"
 * and the provider's own output really carried text.
 *
 * WHY THE REQUEST IS BUILT HERE: the app's adapters are shaped by the request the
 * running app really makes (the same reason `seoGenerationRouterRequest` and
 * `scriptGenerationRouterRequest` live beside the features that use them). A test
 * can therefore assert against the app's own builder instead of a hand-written
 * copy of it.
 *
 * Server-only: it reads the provider registry (which reads process.env) and it is
 * imported only by the publishing service, which the API route wires up. Env var
 * NAMES may travel to the UI; VALUES never do, and none is read here.
 */
import { execute, type AiResult, type AiTask, type ExecuteOptions } from "@/lib/ai";
import { capabilityEnvPath, capabilityEnvRequirement } from "@/lib/ai/providers/capability-env";
import type { KeywordPlan } from "./keywords";
import type { PublishingSource } from "./types";
import type { ModelThumbnailConcept, ThumbnailsModelOutcome } from "./thumbnails";
import { THUMBNAIL_MODEL_REQUEST_FIELDS } from "./thumbnails";

/**
 * The registry capability whose absence a concept's image slot reports. Named here
 * as one constant so the gate, the plan and the tests cannot drift apart.
 */
export const THUMBNAIL_IMAGE_CAPABILITY_NAME = "thumbnail_generation";
/** The registry capability the upscale control is gated on. */
export const UPSCALE_CAPABILITY_NAME = "upscaling";

/** The provider facts a gate may name (names only; never values). */
export interface ThumbnailGateFacts {
  capability: string;
  envVars: string[];
  wiredProviderIds: string[];
  requirement: string;
}

/** How many provider-returned entries this app will carry. The provider's own list is not rewritten. */
export const MODEL_CONCEPT_LIMIT = 20;
/** The transcript sent to a provider is this project's own narration, bounded. */
export const MODEL_TRANSCRIPT_LIMIT = 4000;
/** How many of this project's own phrase candidates are offered to a provider. */
export const MODEL_CANDIDATE_LIMIT = 12;

/** The provider-requested video shape, derived from the project's own stored aspect ratio. */
export function modelVideoType(source: PublishingSource): "longform" | "shorts" {
  return source.project.targetAspectRatio === "NINE_SIXTEEN" ? "shorts" : "longform";
}

/**
 * The `thumbnail_generation` task this app really builds, from the project's own
 * rows and the phrases this same package extracted from them. One owner, so the
 * adapter that eventually serves the capability is shaped by the request the
 * running app makes.
 *
 * The payload's field names are declared on the plan (`requestFieldNames`) and
 * asserted in a test against this builder, so the plan cannot describe a request
 * the app does not build.
 */
export function thumbnailGenerationRouterRequest(source: PublishingSource, keywords: KeywordPlan): AiTask {
  const narration: string[] = [];
  const candidateTitles: string[] = [];
  for (const chapter of [...source.chapters].sort((a, b) => a.order - b.order)) {
    if (chapter.title.trim()) candidateTitles.push(chapter.title.trim());
    for (const scene of [...chapter.scenes].sort((a, b) => a.order - b.order)) {
      if (scene.narration && scene.narration.trim()) narration.push(scene.narration.trim());
      if (scene.title && scene.title.trim()) candidateTitles.push(scene.title.trim());
    }
  }
  const transcript = narration.join("\n\n").slice(0, MODEL_TRANSCRIPT_LIMIT);
  const overlayCandidates = candidateTitles.slice(0, MODEL_CANDIDATE_LIMIT);

  return {
    type: "THUMBNAIL",
    capability: "thumbnail_generation",
    projectId: source.project.id,
    payload: {
      transcript,
      title: source.project.title,
      keywords: keywords.keywords.slice(0, 20).map((k) => k.text),
      videoType: modelVideoType(source),
      aspectRatio: source.project.targetAspectRatio ?? "",
      overlayCandidates,
    },
    params: {
      tone: source.script?.tone ?? source.settings?.tone ?? undefined,
      audience: source.script?.targetAudience ?? source.settings?.targetAudience ?? undefined,
      videoType: modelVideoType(source),
      aspectRatio: source.project.targetAspectRatio ?? undefined,
    },
    metadata: {
      /** Names only — nothing secret, and no provider response is invented. */
      requestedBy: "phase7-thumbnail-concepts",
      ruleDerivedConceptsOnly: false,
    },
  };
}

/** Strips a list marker the provider's own text may carry, leaving its own characters. */
function stripListMarker(line: string): string {
  return line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim();
}

/**
 * The provider's OWN answer, verbatim. Returns an empty list unless the result is
 * ok and its output really carried text: this function cannot invent a concept.
 *
 * A provider's answer is NOT turned into a traced concept. A traced concept's every
 * value carries a rule and a row of this project, and this app did not derive the
 * provider's words — so they are carried as provider-authored text
 * (`provider_verbatim`) and kept apart from the rule-derived concepts, exactly the
 * way a provider's titles are kept apart from the rule-derived titles.
 */
export function providerConceptsFrom(result: AiResult): ModelThumbnailConcept[] {
  if (result.status !== "ok") return [];
  const refs = result.outputRefs ?? {};
  const provider = result.provider ?? "unknown";
  const model = result.model ?? null;

  const raw: string[] = [];
  const listish = (refs as { concepts?: unknown }).concepts;
  if (Array.isArray(listish)) {
    for (const item of listish) if (typeof item === "string") raw.push(item.trim());
  }
  const single = (refs as { concept?: unknown }).concept;
  if (typeof single === "string" && single.trim()) raw.push(single.trim());
  const text = typeof result.resultText === "string" ? result.resultText : (refs as { resultText?: unknown }).resultText;
  if (typeof text === "string" && text.trim()) {
    for (const line of text.split(/\r?\n/)) {
      const stripped = stripListMarker(line);
      if (stripped) raw.push(stripped);
    }
  }

  // An image reference the provider's own answer carried. Recorded as the
  // provider's own string; nothing is fetched, stored or shown from it.
  let imageRef: string | null = null;
  for (const key of ["image", "imageUrl", "url", "outputUrl"] as const) {
    const value = (refs as Record<string, unknown>)[key];
    if (typeof value === "string" && value.trim()) {
      imageRef = value.trim();
      break;
    }
  }
  const urls = (refs as { urls?: unknown }).urls;
  if (imageRef === null && Array.isArray(urls)) {
    for (const item of urls) {
      if (typeof item === "string" && item.trim()) {
        imageRef = item.trim();
        break;
      }
    }
  }

  const out: ModelThumbnailConcept[] = [];
  const seen = new Set<string>();
  for (const candidate of raw) {
    if (out.length >= MODEL_CONCEPT_LIMIT) break;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      id: `model-concept-${out.length + 1}`,
      text: candidate,
      imageRef,
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
 * The provider's own words go into `providerAnswer` as a DECLARED verbatim value;
 * the orchestrator's own sentence about the attempt goes into
 * `orchestratorMessage`. The two are never mixed, and this app paraphrases neither.
 */
export function attemptFrom(result: AiResult): ThumbnailsModelOutcome["attempt"] {
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

/** The orchestrator's own answer, mapped to the shape the plan carries. */
export function outcomeFromAiResult(result: AiResult): ThumbnailsModelOutcome {
  return {
    status: result.status,
    attempt: attemptFrom(result),
    concepts: providerConceptsFrom(result),
    requiredEnv: Array.isArray(result.requiredEnv) ? [...result.requiredEnv] : [],
    nothingAttempted: result.attempts.length === 0,
    orchestratorMessage: typeof result.error === "string" ? result.error : null,
  };
}

/**
 * Asks the app's own AI orchestrator for model-authored thumbnail concepts. Its
 * `not_connected` answer is returned as it stands, and it never fabricates a concept.
 */
export async function askThumbnailConcepts(
  userId: string,
  source: PublishingSource,
  keywords: KeywordPlan,
  opts: ExecuteOptions = {},
): Promise<ThumbnailsModelOutcome> {
  const task = thumbnailGenerationRouterRequest(source, keywords);
  const result = await execute(userId, task, opts);
  return outcomeFromAiResult(result);
}

/**
 * The provider facts a gate may name, derived from the app's own registry — never
 * a literal list, and never a value. Used by the publishing service for the
 * thumbnail_generation gate and the upscaling gate.
 *
 * The names come from `capabilityEnvPath` (src/lib/ai/providers/capability-env.ts),
 * the single derived source of truth for "which server-side env var would actually
 * enable capability X", and the requirement sentence is that module's own. A gate
 * built from these facts can therefore never print a name no code reads.
 */
export function thumbnailImageGateFacts(): ThumbnailGateFacts {
  return gateFactsFor(THUMBNAIL_IMAGE_CAPABILITY_NAME);
}

export function upscaleGateFacts(): ThumbnailGateFacts {
  return gateFactsFor(UPSCALE_CAPABILITY_NAME);
}

function gateFactsFor(capability: string): ThumbnailGateFacts {
  const path = capabilityEnvPath(capability);
  return {
    capability,
    envVars: [...path.envVars],
    wiredProviderIds: [...path.wiredProviderIds],
    requirement: capabilityEnvRequirement(capability),
  };
}

export { THUMBNAIL_MODEL_REQUEST_FIELDS };
