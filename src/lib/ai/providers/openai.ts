/**
 * OpenAI adapter — the SECOND real AI provider implementation in this app.
 *
 * WHAT IT IS: a genuine HTTP client for OpenAI's chat-completions API
 * (POST /v1/chat/completions, `Authorization: Bearer <key>`). It is a subclass of
 * `HttpProviderBase`, so it inherits the fetch mechanics (AbortController timeout,
 * HTTP status → ok / rate_limited / timeout / failed, latency capture) and
 * supplies the two things that make a provider real:
 *
 *   buildRequest(task, model)   → the exact HTTP request, built from the task
 *   parseResponse(res, task)    → a ProviderCallResult from the raw response
 *
 * WHAT IT IMPLEMENTS: exactly ONE capability — `script_generation`, the studio's
 * script path. `implementedCapabilities()` is derived from `OPENAI_ENDPOINTS`, the
 * table of capabilities that have a real endpoint + request mapping. OpenAI's slot
 * advertises thirteen capabilities; the twelve that are not in this table stay
 * unwired, and `isWired(capability)` answers accordingly. A provider must not be
 * reported as serving a capability nobody implemented.
 *
 * THE REQUEST IS BUILT FROM WHAT THE SCRIPT STEP RESOLVES: the studio's own idea /
 * directive text (`payload.prompt`), its structure name and outline chapters, and
 * the task params it actually sets — tone, video type, target duration, language,
 * aspect ratio. Nothing is invented at build time. The model id is the SLOT's own
 * declaration for the capability (`modelFor`) — the slot table stays the single
 * owner of model ids, this adapter owns the endpoint and the request/response
 * shape. If the slot declares no model, no request is built and nothing is sent.
 *
 * WHAT IT DOES NOT DO: it never invents an output. `resultText` is OpenAI's own
 * message content verbatim; a response with no usable content is a FAILURE, never
 * an empty success. The structured `ScriptGenerationOutput` shipped in
 * `outputRefs.script` is this app's own parse of that text — the response text
 * itself is always carried alongside it, so a reader can always see the provider's
 * own answer. `verifiedByApp: false`: this app has not persisted, validated or
 * played back anything, so no produced deliverable is claimed.
 *
 * THE ONE THING THAT CANNOT BE VERIFIED ON THIS MACHINE: no OpenAI key exists on
 * this server, so the model id (`gpt-4o`, from the slot table) and the request
 * field names below are UNVERIFIED against the live API. A wrong model or an
 * unsupported field surfaces as OpenAI's own error, recorded verbatim by the base
 * class, never as a fabricated success.
 *
 * SERVER-SIDE ONLY: the API key is read with `readEnvVar` at request-build time and
 * never leaves this module except as an Authorization header.
 */
import type { AiCapabilityId, AiTask } from "../types";
import { PROVIDER_ENV_KEYS, readEnvVar } from "./env-keys";
import {
  HttpProviderBase,
  type HttpEndpoint,
  type HttpProviderConfig,
} from "./http-provider";
import type { ProviderCallResult } from "./types";

/** The env var NAME the provider registry declares for OpenAI (never a value). */
export const OPENAI_API_KEY_ENV = PROVIDER_ENV_KEYS.openai.envKeys[0];

/** OpenAI's public API base. Documented constant — not configurable. */
export const OPENAI_API_BASE = "https://api.openai.com/v1";

/**
 * capability → the OpenAI endpoint path that serves it. THIS TABLE IS THE WIRING:
 * a capability appears here only when a real request builder + response parser
 * exists for it.
 */
export const OPENAI_ENDPOINTS: Partial<Record<AiCapabilityId, { path: string }>> = {
  // The script path: the studio's own idea/structure/tone/duration inputs are
  // turned into one chat request and the answer is read back as the script text.
  script_generation: { path: "/chat/completions" },
};

/** The capabilities this adapter really implements (derived from the table). */
export function openAiImplementedCapabilities(): AiCapabilityId[] {
  return Object.keys(OPENAI_ENDPOINTS) as AiCapabilityId[];
}

/* ------------------------------------------------------------------ */
/* Request building                                                    */
/* ------------------------------------------------------------------ */

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * The JSON shape the studio reads a generated script back as — the app's own
 * `ScriptGenerationOutput` contract (see ../types.ts), restated here as the
 * instruction the model is given. These key names are this studio's vocabulary;
 * they have NOT been checked against a live model (no key on this server), and a
 * model that ignores them produces an unparsed answer that is reported as such —
 * the provider's text is always kept verbatim regardless.
 */
const SCRIPT_JSON_CONTRACT =
  '{"title": string, "logline": string, "language": string, "chapters": [{"title": string, ' +
  '"summary": string, "scenes": [{"narration": string, "visualPrompt": string}]}]}';

export interface OpenAiMessages {
  system: string;
  user: string;
}

/**
 * The chat messages, built from what the SCRIPT STEP resolved at call time.
 * Every value here is copied from the task the studio handed the orchestrator:
 * the idea/directive text, the structure name, the outline chapters, and the
 * params (tone, video type, target duration, language, aspect ratio).
 */
export function buildOpenAiScriptMessages(task: AiTask): OpenAiMessages {
  const payload = obj(task.payload) ?? {};
  const params = obj(task.params) ?? {};

  const idea = str(payload.prompt) ?? str(payload.idea) ?? str(params.idea) ?? "";
  const structure = str(payload.structure);
  const outline = Array.isArray(payload.chapters)
    ? payload.chapters
        .map(obj)
        .filter((c): c is Record<string, unknown> => c !== null)
        .map((c) => {
          const title = str(c.title) ?? "";
          const summary = str(c.summary) ?? "";
          if (title && summary) return `${title}: ${summary}`;
          return title || summary;
        })
        .filter((line) => line !== "")
    : [];

  const language = str(params.language);
  const tone = str(params.tone);
  const videoType = str(params.videoType) ?? str(payload.videoType);
  const aspectRatio = str(params.aspectRatio);
  const durationSeconds = num(params.durationSeconds);

  // The direction lines are the studio's own settings, stated to the model as
  // they are. A setting that was never resolved is simply not mentioned.
  const direction: string[] = [];
  if (videoType) direction.push(`video type: ${videoType}`);
  if (tone) direction.push(`tone: ${tone}`);
  if (durationSeconds !== null) direction.push(`target duration: ${durationSeconds} seconds`);
  if (language) direction.push(`language: ${language}`);
  if (aspectRatio) direction.push(`aspect ratio: ${aspectRatio}`);
  if (structure) direction.push(`chosen structure: ${structure}`);

  const system =
    "You write the narration script for a faceless YouTube video. " +
    "Answer with a single JSON object and nothing else, using exactly this shape: " +
    `${SCRIPT_JSON_CONTRACT}. ` +
    "Each element of chapters[].scenes[].narration is the spoken script text for one scene; " +
    "visualPrompt is the shot description for that scene. " +
    (direction.length > 0 ? `The studio's own settings for this script — ${direction.join("; ")}.` : "");

  const user = outline.length > 0
    ? `${idea}\n\nThe studio's own outline to work from:\n${outline.join("\n")}`
    : idea;

  return { system: system.trim(), user: user.trim() };
}

export interface OpenAiRequestOptions {
  /** The API key to authorise with. Read from env by the provider. */
  token: string;
  /** Override the endpoint path (test seam only; the table is the default). */
  endpointPath?: string;
}

/**
 * Build the exact HTTP request. Throws — and therefore sends nothing — when the
 * capability has no mapping, the slot declares no model, or the key is missing, so
 * an unconfigured server can never emit a request that pretends to be authorised.
 */
export function buildOpenAiChatRequest(
  task: AiTask,
  model: string | null,
  opts: OpenAiRequestOptions,
): HttpEndpoint {
  const mapped = OPENAI_ENDPOINTS[task.capability]?.path ?? opts.endpointPath;
  if (!mapped) {
    throw new Error(
      `OpenAI has no endpoint mapping for capability "${task.capability}" — this adapter implements ` +
        `only: ${openAiImplementedCapabilities().join(", ") || "(none)"}. Nothing was sent.`,
    );
  }
  const token = opts.token.trim();
  if (!token) {
    throw new Error(
      `${OPENAI_API_KEY_ENV} is not set on this server, so no request was built and nothing was sent.`,
    );
  }
  const resolvedModel = str(model);
  if (!resolvedModel) {
    throw new Error(
      `OpenAI has no model declared for capability "${task.capability}" in the provider slot, so no ` +
        `request was built and nothing was sent.`,
    );
  }
  const { system, user } = buildOpenAiScriptMessages(task);
  if (user === "") {
    throw new Error(
      "the task carried no prompt text (payload.prompt), so there was nothing to ask for and nothing was sent.",
    );
  }
  return {
    url: `${OPENAI_API_BASE}${mapped}`,
    method: "POST",
    headers: {
      // OpenAI's documented auth scheme: `Authorization: Bearer <key>`.
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: {
      model: resolvedModel,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      // OpenAI's documented JSON output mode. The system message asks for the
      // shape; this asks the API to guarantee a JSON object comes back.
      response_format: { type: "json_object" },
    },
  };
}

/* ------------------------------------------------------------------ */
/* Response parsing                                                    */
/* ------------------------------------------------------------------ */

/**
 * Map OpenAI's own chat-completion body to a ProviderCallResult.
 *
 *  - a 2xx body with choices[0].message.content → ok. `resultText` is that content
 *    VERBATIM; `outputRefs.script` is this app's own parse of it (present only when
 *    it really parses into the app's shape) and `outputRefs.responseText` always
 *    carries the provider's own text so the two can never be confused.
 *  - a 2xx body with no usable content, no choices, or an unrecognisable shape →
 *    failed, quoting the raw body. Never ok: an empty answer is not a script.
 *  - `finish_reason: "length"` → still ok (OpenAI did answer), flagged
 *    `truncated: true` with the provider's own reason, because the text is provably
 *    incomplete and must not be presented as a finished script.
 *
 * The base class never calls this for a non-2xx status; those are mapped from the
 * HTTP status alone (401/403/5xx → failed, 429/408 → rate_limited/timeout) and the
 * response body is attached to the attempt as `http <status>: <body>`.
 */
export async function parseOpenAiChatResponse(res: Response): Promise<Partial<ProviderCallResult>> {
  const raw = await res.text();
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(raw);
    const asObj = obj(parsed);
    if (!asObj) throw new Error("not an object");
    body = asObj;
  } catch {
    return {
      status: "failed",
      error: `OpenAI returned a non-JSON body (http ${res.status}): ${raw.slice(0, 200)}`,
    };
  }

  const choices = Array.isArray(body.choices) ? body.choices : null;
  if (!choices || choices.length === 0) {
    return {
      status: "failed",
      error:
        `unrecognised OpenAI chat response (http ${res.status}): no choices. ` +
        `Body: ${raw.slice(0, 200)}`,
    };
  }
  const choice = obj(choices[0]) ?? {};
  const message = obj(choice.message) ?? {};
  const content = typeof message.content === "string" ? message.content : "";
  const finishReason = str(choice.finish_reason);
  const refusal = str(message.refusal);
  const requestId = str(body.id);

  if (content.trim() === "") {
    return {
      status: "failed",
      providerRequestId: requestId,
      error:
        `OpenAI returned no script text (http ${res.status}${finishReason ? `, finish_reason "${finishReason}"` : ""}` +
        `${refusal ? `, refusal: ${refusal}` : ""}). Nothing was invented to fill the gap.`,
      responseSummary: { httpStatus: res.status, requestId, finishReason, hasContent: false },
    };
  }

  const usage = obj(body.usage) ?? null;
  const truncated = finishReason === "length";
  const parsedScript = parseScriptJson(content);

  return {
    status: "ok",
    resultText: content,
    providerRequestId: requestId,
    outputRefs: {
      provider: "openai",
      /** OpenAI's own request id, verbatim. */
      requestId,
      /** The model OpenAI itself reports having served, verbatim. */
      model: str(body.model),
      created: num(body.created),
      finishReason,
      /** OpenAI's own token counts, verbatim — nothing here is estimated. */
      usage,
      /** The provider's own answer text, kept next to this app's parse of it. */
      responseText: content,
      /**
       * This app's parse of the text into the `ScriptGenerationOutput` contract.
       * Present ONLY when the text really parses into it; null otherwise, with the
       * reason in `scriptParseError`. It is never assembled from the provider's
       * text by guesswork.
       */
      script: parsedScript.script,
      scriptParseError: parsedScript.error,
      truncated,
      textLength: content.length,
      /** This app has persisted, validated and played back NOTHING. */
      verifiedByApp: false,
      note: truncated
        ? "OpenAI's OWN answer text, flagged by OpenAI's own finish_reason \"length\": the response stopped at " +
          "the model's output limit, so this text is incomplete and is not presented as a finished script. " +
          "This app has verified nothing."
        : "OpenAI's OWN answer text, recorded verbatim. This app has not persisted, validated or played the " +
          "script back, so no produced deliverable is claimed; nothing is billed by this app.",
    },
    responseSummary: {
      httpStatus: res.status,
      requestId,
      model: str(body.model),
      finishReason,
      hasContent: true,
      truncated,
      scriptParsed: parsedScript.script !== null,
    },
  };
}

/**
 * Parse the provider's text into the app's own script shape. Returns the parsed
 * value only when every structural requirement holds; otherwise an error string
 * explaining what was missing. Never fabricates fields.
 */
export function parseScriptJson(text: string): { script: Record<string, unknown> | null; error: string | null } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return {
      script: null,
      error: `the answer text is not JSON (${err instanceof Error ? err.message : String(err)})`,
    };
  }
  const asObj = obj(parsed);
  if (!asObj) return { script: null, error: "the answer JSON is not an object" };
  const title = str(asObj.title);
  const chapters = Array.isArray(asObj.chapters) ? asObj.chapters : null;
  if (!title) return { script: null, error: "the answer JSON carries no title" };
  if (!chapters) return { script: null, error: "the answer JSON carries no chapters array" };

  const shape = chapters.map((c) => {
    const chapter = obj(c) ?? {};
    const scenes = Array.isArray(chapter.scenes) ? chapter.scenes : [];
    return {
      title: str(chapter.title) ?? "",
      summary: str(chapter.summary) ?? "",
      scenes: scenes
        .map(obj)
        .filter((s): s is Record<string, unknown> => s !== null)
        .map((s) => ({
          narration: str(s.narration) ?? "",
          visualPrompt: str(s.visualPrompt) ?? "",
        }))
        .filter((s) => s.narration !== "" || s.visualPrompt !== ""),
    };
  });
  if (!shape.some((c) => c.scenes.length > 0)) {
    return { script: null, error: "the answer JSON carries no scene narration" };
  }
  return {
    script: {
      title,
      logline: str(asObj.logline) ?? null,
      language: str(asObj.language) ?? null,
      chapters: shape,
      /** The parse is this app's, on top of the provider's text. */
      parsedByApp: true,
    },
    error: null,
  };
}

/* ------------------------------------------------------------------ */
/* The provider                                                        */
/* ------------------------------------------------------------------ */

/** The slot facts the adapter needs (the rest of the slot table is unchanged). */
export interface OpenAiProviderConfig {
  id: string;
  name: string;
  capabilities: readonly AiCapabilityId[];
  rank: number;
  metadata: HttpProviderConfig["metadata"];
  models: Partial<Record<AiCapabilityId, string | null>>;
}

/**
 * OpenAI, wired for the capabilities in `OPENAI_ENDPOINTS` and for nothing else.
 * `isWired()` is inherited from `HttpProviderBase`, which derives it from (a) this
 * adapter's declared implemented capabilities and (b) the real
 * buildRequest/parseResponse pair below — never from a flag.
 */
export class OpenAiProvider extends HttpProviderBase {
  constructor(cfg: OpenAiProviderConfig) {
    super({
      id: cfg.id,
      name: cfg.name,
      capabilities: cfg.capabilities,
      rank: cfg.rank,
      metadata: cfg.metadata,
      baseUrl: OPENAI_API_BASE,
      defaultTimeoutMs: 120_000, // a long-form script is a long completion
      buildRequest: (task, model) =>
        buildOpenAiChatRequest(task, model, { token: readEnvVar(OPENAI_API_KEY_ENV) }),
      parseResponse: (res) => parseOpenAiChatResponse(res),
      modelFor: (capability) => cfg.models[capability] ?? null,
    });
  }

  protected implementedCapabilities(): readonly AiCapabilityId[] {
    return openAiImplementedCapabilities();
  }
}

/** Build the adapter from a plain slot definition (see `slots.ts`). */
export function createOpenAiProvider(cfg: OpenAiProviderConfig): OpenAiProvider {
  return new OpenAiProvider(cfg);
}
