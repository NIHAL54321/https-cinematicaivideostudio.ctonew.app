/**
 * The OpenAI adapter — offline proofs (NO NETWORK).
 *
 * Three things are proven here, all without leaving the machine:
 *
 *  1. WIRING IS DERIVED, NOT FLAGGED. `isWired(capability)` is true only for the
 *     capability the adapter really implements (`script_generation`), because a
 *     real buildRequest/parseResponse pair exists; the twelve other capabilities
 *     the OpenAI slot advertises are not wired, and no flag can make them so.
 *  2. THE REQUEST IS SHAPED BY WHAT THE SCRIPT STEP RESOLVES. The task is built by
 *     the app's own builder (`scriptGenerationRouterRequest` in
 *     src/lib/studio/pipeline.ts, the same one the script-writer route and the
 *     workspace's Generate Script use), so the asserted request is the request the
 *     running app makes — tone, video type, duration, structure and the idea/
 *     outline travel, and the model id is the SLOT's own declaration.
 *  3. THE HONEST OUTCOMES. Unkeyed: nothing is attempted, the capability is
 *     not_connected, no fetch happens. Keyed with a FAKE key: the attempt really
 *     happens (asserted on the captured fetch call), OpenAI's own 401 body is
 *     recorded verbatim, and the orchestrator reports `failed` — never `ok`, never
 *     an invented script. A 2xx body with no usable text is a failure too: an
 *     empty answer is never dressed up as a generated script.
 *
 * The live counterpart of (3) is archived as evidence, with the request actually
 * leaving the machine; the fetch here is a stub so the suite stays offline.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  OPENAI_API_BASE,
  OPENAI_API_KEY_ENV,
  OPENAI_ENDPOINTS,
  OpenAiProvider,
  buildOpenAiChatRequest,
  buildOpenAiScriptMessages,
  openAiImplementedCapabilities,
  parseOpenAiChatResponse,
  parseScriptJson,
} from "../openai";
import { HttpProviderBase, mapHttpStatus, type HttpEndpoint } from "../http-provider";
import { providerEnvConfigured } from "../env-keys";
import { allProviders, getProvider, providersFor } from "../registry";
import { isProviderReady } from "../types";
import { allCapabilityStatus, capabilityStatus } from "../../status";
import { capabilityEnvPath } from "../capability-env";
import { routeReadyCandidates } from "../../router";
import { execute, requiredEnvFor, type AiPersistence, type ProviderLogInput } from "../../orchestrator";
import { AI_CAPABILITIES, type AiTask } from "../../types";
import { scriptGenerationRouterRequest } from "../../../studio/pipeline";
import { wiredReadout, wiringBadge } from "../../../product/public-copy";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * The SHAPE OpenAI returned to a deliberately invalid token, with the fragment of
 * the submitted key that OpenAI echoes back redacted to a placeholder. The live
 * run's verbatim body is archived in the Block 13 evidence directory; the key
 * itself is never a real key and its value never appears anywhere.
 */
const OPENAI_401_BODY =
  '{"error":{"message":"Incorrect API key provided: <redacted-key-fragment>. You can find your API ' +
  'key at https://platform.openai.com/account/api-keys.","type":"invalid_request_error","param":null,' +
  '"code":"invalid_api_key"}}';

/** The studio's own shape, as OpenAI would return it in message.content. */
const SCRIPT_JSON = JSON.stringify({
  title: "The Quiet Ocean",
  logline: "A short film about what the sea keeps.",
  language: "en",
  chapters: [
    {
      title: "Cold open",
      summary: "A hook about the deep.",
      scenes: [
        { narration: "Most of the ocean has never been seen.", visualPrompt: "Slow push over black water" },
      ],
    },
  ],
});

/** A 200 chat-completion body in OpenAI's documented shape. */
function completion(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

/** A 200 body whose single choice carries `content` (and optionally finish_reason). */
function withContent(content: string, extra: Record<string, unknown> = {}): Response {
  return completion({
    id: "chatcmpl-offline-1",
    object: "chat.completion",
    created: 1_760_000_000,
    model: "gpt-4o-2024-08-06",
    choices: [{ index: 0, message: { role: "assistant", content, refusal: null }, finish_reason: "stop" }],
    usage: { prompt_tokens: 120, completion_tokens: 340, total_tokens: 460 },
    ...extra,
  });
}

/** A minimal in-memory audit adapter (the orchestrator's persistence seam). */
class MemoryPersistence implements AiPersistence {
  logs: ProviderLogInput[] = [];
  generations: { id: string; updates: Record<string, unknown>[] }[] = [];
  async createGeneration(): Promise<{ id: string }> {
    const row = { id: `gen-${this.generations.length + 1}`, updates: [] as Record<string, unknown>[] };
    this.generations.push(row);
    return { id: row.id };
  }
  async updateGeneration(id: string, data: Record<string, unknown>): Promise<void> {
    this.generations.find((g) => g.id === id)?.updates.push(data);
  }
  async createProviderLog(input: ProviderLogInput): Promise<void> {
    this.logs.push(input);
  }
}

let fetchCalls: { url: string; init: RequestInit }[] = [];
const realFetch = globalThis.fetch;

function stubFetch(responder: (url: string, init: RequestInit) => Response | Promise<Response>) {
  fetchCalls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    fetchCalls.push({ url, init: init ?? {} });
    return responder(url, init ?? {});
  }) as typeof fetch;
}

const savedKey = process.env[OPENAI_API_KEY_ENV];

beforeEach(() => {
  delete process.env[OPENAI_API_KEY_ENV];
  fetchCalls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (savedKey === undefined) delete process.env[OPENAI_API_KEY_ENV];
  else process.env[OPENAI_API_KEY_ENV] = savedKey;
});

/**
 * The task the Script Intelligence action really builds — the same call the route
 * makes: directive text + idea, the studio's own tone/video type/duration, and the
 * outline chapter the user supplied.
 */
function scriptTask(overrides: Partial<Parameters<typeof scriptGenerationRouterRequest>[0]> = {}): AiTask {
  return scriptGenerationRouterRequest({
    prompt:
      "Improve the overall script — tighten the prose and strengthen pacing. Original idea: the deep ocean",
    structure: "user-supplied outline",
    chapters: [{ title: "Outline", summary: "Hook, three acts, payoff." }],
    tone: "cinematic",
    videoType: "shorts",
    durationSeconds: 600,
    ...overrides,
  });
}

/* ------------------------------------------------------------------ */
/* 1. Wiring is derived from a real implementation                     */
/* ------------------------------------------------------------------ */

describe("OpenAI wiring — derived from a real request/response pair", () => {
  test("the registered openai slot IS the real adapter", () => {
    const provider = getProvider("openai");
    expect(provider).toBeInstanceOf(OpenAiProvider);
    expect(provider?.id).toBe("openai");
  });

  test("wired exactly for the capabilities the adapter has an endpoint mapping for", () => {
    const provider = getProvider("openai")!;
    const implemented = openAiImplementedCapabilities();
    expect(implemented).toEqual(["script_generation"]);
    expect(Object.keys(OPENAI_ENDPOINTS)).toEqual(implemented);
    for (const capability of provider.capabilities) {
      expect(provider.isWired(capability)).toBe(implemented.includes(capability));
    }
    expect(provider.isWired("script_generation")).toBe(true);
    expect(provider.isWired("reasoning")).toBe(false);
    expect(provider.isWired("image_generation")).toBe(false);
    expect(provider.isWired("seo_generation")).toBe(false);
    expect(provider.isWired()).toBe(true); // wired for at least one capability
  });

  test("script_generation is served by three slots, exactly one of them wired", () => {
    const path = capabilityEnvPath("script_generation");
    expect(path.providerIds).toEqual(["openai", "anthropic", "google"]);
    expect(path.wiredProviderIds).toEqual(["openai"]);
    expect(path.hasWiredProvider).toBe(true);
    expect(path.envVars).toEqual([
      OPENAI_API_KEY_ENV,
      "ANTHROPIC_API_KEY",
      "GOOGLE_AI_API_KEY",
      "GOOGLE_API_KEY",
    ]);
    // The siblings have no implementation: setting their key must not be sold as
    // equivalent to setting OpenAI's.
    for (const id of ["anthropic", "google"]) {
      expect(path.providers.find((p) => p.providerId === id)?.wired).toBe(false);
    }
  });

  test("the env var name comes from the registry, never from a literal in the adapter", () => {
    expect(OPENAI_API_KEY_ENV).toBe("OPENAI_API_KEY");
    // The adapter reads the registry's own key list; a literal would drift.
    const source = readFileSync(fileURLToPath(new URL("../openai.ts", import.meta.url)), "utf8");
    expect(source).toContain("PROVIDER_ENV_KEYS.openai.envKeys[0]");
    expect(source).toContain("readEnvVar(OPENAI_API_KEY_ENV)");
    // No env var VALUE can appear: the module only ever reads the name.
    expect(source).not.toContain("process.env.");
  });

  test("the two wired capabilities in the product are exactly the two adapters' own", () => {
    const r = wiredReadout();
    expect(r.capabilitiesTotal).toBe(21);
    expect(r.capabilitiesWired).toBe(2);
    expect(r.wiredCapabilities).toEqual(["script_generation", "video_enhancement"]);
    expect(r.wiredProviders.sort()).toEqual(["openai", "replicate"]);
    // The copy a visitor reads follows the registry with no hand-edit:
    expect(wiringBadge()).toBe("2 of 21 AI capabilities wired");
  });

  test("the app's own builder is what the script steps use (no hand-written copy)", () => {
    const pipeline = readFileSync(fileURLToPath(new URL("../../../studio/pipeline.ts", import.meta.url)), "utf8")
      .replace(/\s+/g, " ");
    // Both script steps route through the one builder the tests assert against
    // (one definition + at least the two call sites).
    expect(pipeline.split("scriptGenerationRouterRequest(").length - 1).toBeGreaterThanOrEqual(3);
    expect(pipeline).toContain("capability: \"script_generation\",");
  });
});

/* ------------------------------------------------------------------ */
/* 2. The request, built from what the script step resolves            */
/* ------------------------------------------------------------------ */

describe("OpenAI request — built from the studio's own script inputs (offline)", () => {
  test("endpoint, bearer auth and the studio's settings travel in the body", () => {
    const provider = getProvider("openai")!;
    const task = scriptTask();
    // The model is the SLOT's declaration, exactly as the base/resolver passes it.
    const model = provider.modelFor("script_generation");
    expect(model).toBe("gpt-4o");

    const endpoint = buildOpenAiChatRequest(task, model, { token: "sk-offline_test_token" });
    expect(endpoint.url).toBe(`${OPENAI_API_BASE}/chat/completions`);
    expect(endpoint.method).toBe("POST");
    expect(Object.keys(endpoint.headers ?? {})).toEqual(["authorization", "content-type"]);
    expect(endpoint.headers?.authorization).toBe("Bearer sk-offline_test_token");

    const body = endpoint.body as Record<string, unknown>;
    expect(body.model).toBe("gpt-4o");
    expect(body.response_format).toEqual({ type: "json_object" });
    const messages = body.messages as { role: string; content: string }[];
    expect(messages.map((m) => m.role)).toEqual(["system", "user"]);

    // The system message carries the studio's own resolved settings, as names.
    const system = messages[0].content;
    expect(system).toContain("video type: shorts");
    expect(system).toContain("tone: cinematic");
    expect(system).toContain("target duration: 600 seconds");
    expect(system).toContain("chosen structure: user-supplied outline");
    // …and asks for the app's own script shape.
    expect(system).toContain('"chapters"');
    expect(system).toContain('"narration"');

    // The user message is the studio's own prompt text plus its outline chapter.
    const user = messages[1].content;
    expect(user).toContain("Original idea: the deep ocean");
    expect(user.startsWith("Improve the overall script")).toBe(true);
    expect(user).toContain("Outline: Hook, three acts, payoff.");

    // No network: building a request must never fetch.
    expect(fetchCalls).toHaveLength(0);
  });

  test("a project's Generate Script task travels the same way (language + aspect ratio included)", () => {
    const task = scriptGenerationRouterRequest({
      prompt: "A documentary about tide pools",
      structure: "three_act",
      chapters: [{ title: "Act I", summary: "Establish the pool." }],
      videoType: "longform",
      durationSeconds: 300,
      language: "en",
      aspectRatio: "16:9",
    });
    const { system, user } = buildOpenAiScriptMessages(task);
    expect(system).toContain("video type: longform");
    expect(system).toContain("language: en");
    expect(system).toContain("aspect ratio: 16:9");
    expect(system).toContain("chosen structure: three_act");
    // A setting the step did not resolve is simply not mentioned.
    expect(system).not.toContain("tone:");
    expect(user).toContain("A documentary about tide pools");
    expect(user).toContain("Act I: Establish the pool.");
  });

  test("nothing is sent for an unimplemented capability, a missing model, a missing key or an empty prompt", () => {
    const task = scriptTask();
    // A capability with no mapping: refuse, do not guess an endpoint.
    expect(() => buildOpenAiChatRequest({ ...task, capability: "reasoning" }, "gpt-4o", { token: "x" })).toThrow(
      /no endpoint mapping for capability "reasoning"/,
    );
    // No key: refuse, do not emit an unauthenticated request.
    expect(() => buildOpenAiChatRequest(task, "gpt-4o", { token: "   " })).toThrow(
      /OPENAI_API_KEY is not set/,
    );
    // No model declared by the slot: refuse, do not invent a slug.
    expect(() => buildOpenAiChatRequest(task, null, { token: "x" })).toThrow(/no model declared for capability/);
    // No prompt text at all: nothing to ask for.
    expect(() =>
      buildOpenAiChatRequest(
        scriptGenerationRouterRequest({ prompt: "", structure: "three_act" }),
        "gpt-4o",
        { token: "x" },
      ),
    ).toThrow(/no prompt text/);
    expect(fetchCalls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Response parsing — honest outcomes only                          */
/* ------------------------------------------------------------------ */

describe("OpenAI response parsing", () => {
  test("a 2xx answer yields OpenAI's OWN text verbatim plus the app's own parse of it", async () => {
    const parsed = await parseOpenAiChatResponse(withContent(SCRIPT_JSON));
    expect(parsed.status).toBe("ok");
    // The provider's text, character for character.
    expect(parsed.resultText).toBe(SCRIPT_JSON);
    expect(parsed.providerRequestId).toBe("chatcmpl-offline-1");
    const refs = parsed.outputRefs as Record<string, unknown>;
    expect(refs.provider).toBe("openai");
    expect(refs.responseText).toBe(SCRIPT_JSON);
    // OpenAI's own reported model and token usage, verbatim.
    expect(refs.model).toBe("gpt-4o-2024-08-06");
    expect(refs.usage).toEqual({ prompt_tokens: 120, completion_tokens: 340, total_tokens: 460 });
    expect(refs.finishReason).toBe("stop");
    expect(refs.truncated).toBe(false);
    expect(refs.scriptParseError).toBeNull();
    // The structured script is the app's parse of that text, marked as such.
    const script = refs.script as Record<string, unknown>;
    expect(script.parsedByApp).toBe(true);
    expect(script.title).toBe("The Quiet Ocean");
    expect(script.language).toBe("en");
    const chapters = script.chapters as { title: string; scenes: { narration: string }[] }[];
    expect(chapters[0].title).toBe("Cold open");
    expect(chapters[0].scenes[0].narration).toBe("Most of the ocean has never been seen.");
    // Nothing is claimed as verified, persisted or produced by this app.
    expect(refs.verifiedByApp).toBe(false);
    expect(String(refs.note)).toContain("recorded verbatim");
  });

  test("the provider's answer is never invented: a non-JSON answer is still ok, but unparsed", async () => {
    const parsed = await parseOpenAiChatResponse(withContent("Sure! Here is your script."));
    expect(parsed.status).toBe("ok");
    expect(parsed.resultText).toBe("Sure! Here is your script.");
    const refs = parsed.outputRefs as Record<string, unknown>;
    expect(refs.responseText).toBe("Sure! Here is your script.");
    expect(refs.script).toBeNull();
    expect(String(refs.scriptParseError)).toContain("not JSON");
  });

  test("a truncated answer is flagged with OpenAI's own reason, not presented as finished", async () => {
    const parsed = await parseOpenAiChatResponse(
      completion({
        id: "chatcmpl-offline-2",
        model: "gpt-4o-2024-08-06",
        choices: [
          { index: 0, message: { role: "assistant", content: '{"title":"Half' }, finish_reason: "length" },
        ],
      }),
    );
    expect(parsed.status).toBe("ok");
    const refs = parsed.outputRefs as Record<string, unknown>;
    expect(refs.truncated).toBe(true);
    expect(refs.finishReason).toBe("length");
    expect(String(refs.note)).toContain('finish_reason "length"');
    expect(String(refs.note)).toContain("incomplete");
  });

  test("no choices, empty content or a refusal is a FAILURE — never an empty success", async () => {
    const noChoices = await parseOpenAiChatResponse(completion({ id: "x", choices: [] }));
    expect(noChoices.status).toBe("failed");
    expect(String(noChoices.error)).toContain("no choices");

    const empty = await parseOpenAiChatResponse(withContent("   "));
    expect(empty.status).toBe("failed");
    expect(String(empty.error)).toContain("returned no script text");
    expect(empty.resultText ?? null).toBeNull();

    const refused = await parseOpenAiChatResponse(
      completion({
        id: "chatcmpl-offline-3",
        choices: [{ index: 0, message: { role: "assistant", content: null, refusal: "I can't help with that." }, finish_reason: "stop" }],
      }),
    );
    expect(refused.status).toBe("failed");
    expect(String(refused.error)).toContain("I can't help with that.");
  });

  test("an unrecognisable body is NEVER ok", async () => {
    const html = await parseOpenAiChatResponse(new Response("<html>gateway</html>", { status: 200 }));
    expect(html.status).toBe("failed");
    expect(String(html.error)).toContain("non-JSON body");
    const wrongShape = await parseOpenAiChatResponse(completion({ hello: "world" }));
    expect(wrongShape.status).toBe("failed");
    expect(String(wrongShape.error)).toContain("unrecognised OpenAI chat response");
  });

  test("the app's script parser refuses a partial shape instead of filling the gaps", () => {
    expect(parseScriptJson('{"title":"T","chapters":[]}').error).toContain("no scene narration");
    expect(parseScriptJson('{"logline":"L","chapters":[]}').error).toContain("no title");
    expect(parseScriptJson('{"title":"T"}').error).toContain("no chapters array");
    expect(parseScriptJson("not json").error).toContain("not JSON");
    const ok = parseScriptJson(SCRIPT_JSON);
    expect(ok.error).toBeNull();
    expect(ok.script?.title).toBe("The Quiet Ocean");
  });

  test("provider errors map to the existing categories (never to ok)", () => {
    expect(mapHttpStatus(401)).toBe("failed"); // the fake-key case
    expect(mapHttpStatus(403)).toBe("failed");
    expect(mapHttpStatus(400)).toBe("failed");
    expect(mapHttpStatus(429)).toBe("rate_limited");
    expect(mapHttpStatus(408)).toBe("timeout");
    expect(mapHttpStatus(500)).toBe("failed");
    expect(mapHttpStatus(200)).toBe("ok");
  });
});

/* ------------------------------------------------------------------ */
/* 4. The adapter's own outcomes, and the orchestrator on top of them  */
/* ------------------------------------------------------------------ */

/**
 * NOTE ON IN-SUITE STUBS. `execute()` deliberately routes over the dev-gated test
 * stubs when test mode is on (`providersFor(..., { includeTest: testModeEnabled() })`),
 * and `src/lib/ai/__tests__/orchestrator.test.ts` registers stubs for
 * `script_generation` in this same process. So an `execute()` of a
 * script_generation task can legitimately come back `ok` from a stub even with no
 * key anywhere. The assertions below are therefore scoped to what is unambiguous:
 *   - the ADAPTER's own call() outcome (deterministic, stub-free), and
 *   - whether the REAL openai slot was attempted at all.
 * The end-to-end, stub-free answer for this server — unkeyed `not_connected`, and a
 * keyed attempt whose outcome is OpenAI's own — is proven on the served build and
 * archived in the Block 13 evidence directory.
 */
const openAiAdapter = () => getProvider("openai") as OpenAiProvider;

describe("the adapter's own honest outcomes (no orchestrator, no stubs)", () => {
  test("with no key: call() refuses, builds nothing and sends nothing", async () => {
    const res = await openAiAdapter().call(scriptTask());
    expect(res.status).toBe("failed");
    expect(String(res.error)).toContain("OPENAI_API_KEY is not set");
    expect(res.outputRefs ?? null).toBeNull();
    expect(fetchCalls).toHaveLength(0);
  });

  test("a 401 is a failed attempt carrying OpenAI's own body verbatim", async () => {
    process.env[OPENAI_API_KEY_ENV] = "sk-deliberately_invalid_offline";
    stubFetch(() => new Response(OPENAI_401_BODY, { status: 401, headers: { "content-type": "application/json" } }));

    const res = await openAiAdapter().call(scriptTask());

    // The call really went out, to OpenAI, with the key.
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe(`${OPENAI_API_BASE}/chat/completions`);
    const headers = fetchCalls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-deliberately_invalid_offline");
    // The body was the studio's own request, not a placeholder.
    const sent = JSON.parse(String(fetchCalls[0].init.body)) as Record<string, unknown>;
    expect(sent.model).toBe("gpt-4o");
    expect(Object.keys(sent)).toEqual(["model", "messages", "response_format"]);

    // The outcome is the provider's, not ours.
    expect(res.status).toBe("failed");
    expect(res.error).toBe(`http 401: ${OPENAI_401_BODY}`);
    expect(res.outputRefs ?? null).toBeNull();
    expect(res.resultText ?? null).toBeNull(); // no script text was invented
    expect(res.responseSummary).toEqual({ httpStatus: 401 });
  });

  test("a 429 is rate_limited and a 500 is failed — the error categories are real", async () => {
    process.env[OPENAI_API_KEY_ENV] = "sk-deliberately_invalid_offline";
    stubFetch(() => new Response('{"error":{"message":"rate limit reached"}}', { status: 429 }));
    expect((await openAiAdapter().call(scriptTask())).status).toBe("rate_limited");
    stubFetch(() => new Response('{"error":{"message":"boom"}}', { status: 500 }));
    const broken = await openAiAdapter().call(scriptTask());
    expect(broken.status).toBe("failed");
    expect(String(broken.error)).toContain("http 500");
  });

  test("a transport failure is a failed attempt, not a silent success", async () => {
    process.env[OPENAI_API_KEY_ENV] = "sk-deliberately_invalid_offline";
    stubFetch(() => {
      throw new Error("getaddrinfo ENOTFOUND api.openai.com");
    });
    const res = await openAiAdapter().call(scriptTask());
    expect(res.status).toBe("failed");
    expect(String(res.error)).toContain("network error");
    expect(res.outputRefs ?? null).toBeNull();
    expect(res.resultText ?? null).toBeNull();
  });

  test("a keyed 2xx is the only path to ok — and it carries the provider's text, not a file", async () => {
    process.env[OPENAI_API_KEY_ENV] = "sk-deliberately_invalid_offline";
    stubFetch(() => withContent(SCRIPT_JSON));
    const res = await openAiAdapter().call(scriptTask());
    expect(res.status).toBe("ok");
    expect(res.resultText).toBe(SCRIPT_JSON);
    const refs = res.outputRefs as Record<string, unknown>;
    // OpenAI's own reported model, kept next to the requested one.
    expect(refs.model).toBe("gpt-4o-2024-08-06");
    expect(refs.verifiedByApp).toBe(false);
    // No file, no export, no produced deliverable is ever claimed here.
    expect(refs.filesProduced).toBeUndefined();
  });
});

describe("the orchestrator path, unkeyed (the regression to protect)", () => {
  test("with no key: the openai slot is not configured, nothing is attempted, nothing leaves", async () => {
    expect(providerEnvConfigured("openai")).toBe(false);
    // The REAL-slot view — what production has — offers no candidate at all.
    expect(providersFor("script_generation").filter((p) => isProviderReady(p, "script_generation"))).toEqual([]);
    expect(routeReadyCandidates(scriptTask())).toEqual([]);

    const persistence = new MemoryPersistence();
    const result = await execute("u1", scriptTask(), { persistence });

    // Scoped to the adapter under test: openai is never attempted and never logged.
    expect(result.attempts.every((a) => a.provider !== "openai")).toBe(true);
    expect(persistence.logs.every((l) => l.provider !== "openai")).toBe(true);
    expect(fetchCalls).toHaveLength(0);

    // The served build's own answer for this task is `not_connected` (evidence); the
    // registry already says which names a key would go in.
    expect(capabilityStatus("script_generation").status).toBe("not_connected");
    expect(requiredEnvFor("script_generation")).toEqual(capabilityEnvPath("script_generation").envVars);
    expect(requiredEnvFor("script_generation")).toContain("OPENAI_API_KEY");
  });

  test("with no key: script_generation is not_connected but WIRED, and the status says both", () => {
    const status = capabilityStatus("script_generation");
    expect(status.status).toBe("not_connected");
    const openai = status.providers.find((p) => p.id === "openai")!;
    expect(openai.configured).toBe(false);
    expect(openai.wired).toBe(true);
    // Every capability is still not_connected with no keys anywhere.
    const all = allCapabilityStatus();
    expect(all).toHaveLength(21);
    expect(all.filter((c) => c.status !== "not_connected")).toEqual([]);
    // …and the two wired adapters are visible as wired, per capability.
    expect(all.find((c) => c.capability === "script_generation")!.providers.find((p) => p.id === "openai")!.wired).toBe(true);
    expect(all.find((c) => c.capability === "voice_generation")!.providers.find((p) => p.id === "openai")!.wired).toBe(false);
  });

  test("a slot that advertises the capability without an implementation cannot be attempted", () => {
    class ClaimsButDoesNothing extends HttpProviderBase {
      protected override implementedCapabilities() {
        return ["script_generation" as const];
      }
    }
    const bare = new ClaimsButDoesNothing({
      id: "bare-openai",
      name: "Bare",
      capabilities: ["script_generation"],
      rank: 99,
      metadata: { quality: 1, speed: 1, cost: 1 },
      baseUrl: "https://example.invalid",
      buildRequest: undefined as unknown as () => HttpEndpoint,
      parseResponse: undefined as unknown as () => Promise<Record<string, never>>,
    });
    expect(bare.isWired("script_generation")).toBe(false);
    expect(isProviderReady(bare, "script_generation")).toBe(false);
  });
});

describe("the orchestrator path with a deliberately invalid key", () => {
  test("the attempt leaves the server, OpenAI's own error is recorded, status is failed — never ok", async () => {
    process.env[OPENAI_API_KEY_ENV] = "sk-deliberately_invalid_offline";
    expect(providerEnvConfigured("openai")).toBe(true);
    expect(routeReadyCandidates(scriptTask()).map((c) => c.provider.id)).toEqual(["openai"]);
    expect(capabilityStatus("script_generation").status).toBe("connected");

    stubFetch(() => new Response(OPENAI_401_BODY, { status: 401, headers: { "content-type": "application/json" } }));

    const persistence = new MemoryPersistence();
    // One attempt only: the suite's dev-gated stubs must not stand in for the real
    // adapter's outcome (see the note above this section).
    const result = await execute("u1", scriptTask(), { persistence, attemptsLimit: 1 });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe(`${OPENAI_API_BASE}/chat/completions`);
    expect((fetchCalls[0].init.headers as Record<string, string>).authorization).toBe(
      "Bearer sk-deliberately_invalid_offline",
    );

    // The outcome is the provider's, not ours.
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].provider).toBe("openai");
    expect(result.attempts[0].status).toBe("failed");
    expect(String(result.attempts[0].error)).toBe(`http 401: ${OPENAI_401_BODY}`);
    expect(result.status).toBe("failed");
    expect(result.provider).toBeUndefined(); // no winner was fabricated
    expect(result.outputRefs ?? null).toBeNull();
    expect(result.resultText ?? null).toBeNull(); // and no script text exists

    // …and it is in the audit trail verbatim, with the HTTP status.
    expect(persistence.logs).toHaveLength(1);
    expect(persistence.logs[0].provider).toBe("openai");
    expect(String(persistence.logs[0].errorMessage)).toContain(OPENAI_401_BODY);
    expect(persistence.logs[0].responseSummary).toEqual({ httpStatus: 401 });
    expect(persistence.generations[0].updates.at(-1)?.status).toBe("FAILED");
  });

  test("keyed and answering: the orchestrator returns the provider's text and the slot's model", async () => {
    process.env[OPENAI_API_KEY_ENV] = "sk-deliberately_invalid_offline";
    stubFetch(() => withContent(SCRIPT_JSON));
    const result = await execute("u1", scriptTask(), {
      persistence: new MemoryPersistence(),
      attemptsLimit: 1,
    });
    expect(result.status).toBe("ok");
    expect(result.provider).toBe("openai");
    expect(result.model).toBe("gpt-4o"); // the slot's model, as requested
    expect(result.resultText).toBe(SCRIPT_JSON);
    expect(result.outputRefs?.filesProduced).toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* 5. The wired capability count is derived, in every direction        */
/* ------------------------------------------------------------------ */

describe("the derived wired count follows the registry with no hand-edit", () => {
  test("adding this adapter moved the readout to 2 without a copy change", () => {
    // Computed independently of the copy module: the slots' own answers.
    const wired = AI_CAPABILITIES.filter((c) => providersFor(c).some((p) => p.isWired(c)));
    expect(wired).toEqual(["script_generation", "video_enhancement"]);
    expect(wiredReadout().capabilitiesWired).toBe(wired.length);
    expect(wiringBadge()).toBe(`${wired.length} of ${AI_CAPABILITIES.length} AI capabilities wired`);
    // The other eight providers are still plain slots — nothing else moved.
    const plain = allProviders().filter((p) => !["replicate", "openai"].includes(p.id));
    expect(plain).toHaveLength(8);
    for (const p of plain) expect(p.isWired()).toBe(false);
  });
});
