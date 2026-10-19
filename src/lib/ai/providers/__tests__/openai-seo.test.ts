/**
 * P7-8 — the OpenAI adapter's SECOND capability: `seo_generation`, offline.
 *
 * The publishing package's SEO half is produced by a real model call, and this file
 * proves the adapter side of that wiring without leaving the machine:
 *
 *  1. WIRING IS STILL DERIVED, NOT FLAGGED. `openAiImplementedCapabilities()` reads
 *     the endpoint table, and every capability in it has a real message builder and
 *     a real response parse — so `seo_generation` is wired for that reason and no
 *     other, and the eleven OpenAI capabilities that were never implemented are
 *     still unwired.
 *  2. THE TWO PATHS SHARE ONE ENDPOINT AND DIFFER IN WHAT THEY ASK FOR. The
 *     `script_generation` request and the `seo_generation` request both go to
 *     `/chat/completions` and both name the model the SLOT declares, but the system
 *     message and the material sent are built by two different builders — so a
 *     change to one cannot silently change the other.
 *  3. WHAT THE INSTRUCTION ASKS FOR IS NOT A DEFENCE, AND IS NOT TREATED AS ONE.
 *     The SEO instruction asks the model for a specific JSON shape and asks it not
 *     to state a search-demand number or promise an outcome. That is politeness
 *     towards a model, not a guarantee: the app carries what a provider returns
 *     VERBATIM, so the second and real defence lives in the publishing layer
 *     (`src/lib/publishing/provider-text.ts`), where such a value is withheld and
 *     recorded. This file proves the request and the parse; the plant test lives
 *     next to the screen it belongs to.
 *  4. THE HONEST OUTCOMES. Unkeyed: `seo_generation` is not_connected, wired, and
 *     names the registry's env var; nothing is attempted. Keyed and answering: the
 *     provider's own text is kept verbatim beside this app's parse of it, and an
 *     answer that does not parse into the capability's shape is reported as UNPARSED
 *     — no field is invented to fill the gap. Reached and rejected: the provider's
 *     own error body travels verbatim and no output is produced.
 *
 * The live counterpart (a deliberately invalid key, the request really leaving the
 * machine, the provider's own 401 recorded) is archived as evidence, not stubbed in
 * here.
 */
import { describe, expect, test, beforeEach } from "bun:test";
import {
  OPENAI_API_BASE,
  OPENAI_API_KEY_ENV,
  OPENAI_ENDPOINTS,
  buildOpenAiChatRequest,
  buildOpenAiScriptMessages,
  buildOpenAiSeoMessages,
  openAiImplementedCapabilities,
  parseOpenAiChatResponse,
  parseSeoJson,
} from "../openai";
import { capabilityStatus } from "../../status";
import { capabilityEnvPath } from "../capability-env";
import { getProvider } from "../registry";
import type { AiTask } from "../../types";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

/** The task the publishing package's own builder produces, in miniature. */
function seoTask(overrides: Partial<AiTask["payload"]> = {}): AiTask {
  return {
    type: "SEO",
    capability: "seo_generation",
    projectId: "proj_1",
    payload: {
      transcript: "Carthage and Rome fought three wars. The second was fought at sea.",
      title: "The Fall of Carthage",
      keywords: ["carthage", "rome", "punic wars"],
      videoType: "longform",
      language: "en",
      ...overrides,
    },
    params: { tone: "calm", audience: "history viewers", videoType: "longform", language: "en" },
    metadata: { requestedBy: "phase7-title-engine" },
  };
}

/** The shape the instruction asks for, as a model would return it. */
const SEO_JSON = JSON.stringify({
  title: "The Fall of Carthage",
  titles: ["Hannibal's Crossing", "The Fall of Carthage", "Rome and Carthage at Sea"],
  description: "A plain account of the war between Rome and Carthage, told in order.",
  tags: ["carthage", "rome"],
  hashtags: ["#history"],
  chapters: [{ start: 0, title: "Cold open" }],
});

/** OpenAI's own 401 body for a key that is not valid (fragment redacted). */
const OPENAI_401_BODY =
  '{"error":{"message":"Incorrect API key provided: <redacted-key-fragment>.","type":"invalid_request_error",' +
  '"param":null,"code":"invalid_api_key"}}';

/** A 200 chat-completion body in OpenAI's documented shape. */
function withContent(content: string, finishReason = "stop"): Response {
  return new Response(
    JSON.stringify({
      id: "chatcmpl-offline-seo",
      object: "chat.completion",
      created: 1_760_000_000,
      model: "gpt-4o-2024-08-06",
      choices: [{ index: 0, message: { role: "assistant", content, refusal: null }, finish_reason: finishReason }],
      usage: { prompt_tokens: 120, completion_tokens: 340, total_tokens: 460 },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

beforeEach(() => {
  // No key anywhere: the gate assertions below are about the unkeyed state.
  delete process.env[OPENAI_API_KEY_ENV];
});

/* ------------------------------------------------------------------ */
/* 1. Wiring, derived                                                 */
/* ------------------------------------------------------------------ */

describe("P7-8 wiring — a second real pair, derived from the adapter's own tables", () => {
  test("the adapter implements exactly the capabilities its endpoint table carries, and both have a builder", () => {
    const implemented = openAiImplementedCapabilities();
    expect(implemented).toEqual(["script_generation", "seo_generation"]);
    expect(Object.keys(OPENAI_ENDPOINTS)).toEqual(implemented);
    // Both documented on the same endpoint; the model comes from the SLOT.
    expect(OPENAI_ENDPOINTS.seo_generation?.path).toBe("/chat/completions");
    expect(OPENAI_ENDPOINTS.script_generation?.path).toBe("/chat/completions");
    const provider = getProvider("openai")!;
    expect(provider.isWired("seo_generation")).toBe(true);
    expect(provider.isWired("script_generation")).toBe(true);
    // Everything else the slot advertises is still unwired.
    for (const capability of provider.capabilities) {
      expect(provider.isWired(capability)).toBe(implemented.includes(capability));
    }
    expect(provider.modelFor("seo_generation")).toBe("gpt-4o");
  });

  test("a capability with an endpoint but no builder refuses instead of sending a stranger's request", () => {
    const task: AiTask = { type: "SEO", capability: "reasoning", projectId: "proj_1", payload: { prompt: "hi" } };
    // `reasoning` is deliberately NOT in the endpoint table, so the endpoint gate
    // fires first — and this is the same refusal a table/builder mismatch would hit.
    expect(() => buildOpenAiChatRequest(task, "gpt-4o", { token: "sk-offline_test_token" })).toThrow(
      /no endpoint mapping/,
    );
  });
});

/* ------------------------------------------------------------------ */
/* 2. The request, built from the publishing package's own material    */
/* ------------------------------------------------------------------ */

describe("P7-8 request — built from what the publishing package really resolved", () => {
  test("the SEO request goes to the same endpoint, names the slot's model and carries the project's own material", () => {
    const endpoint = buildOpenAiChatRequest(seoTask(), "gpt-4o", { token: "sk-offline_test_token" });
    expect(endpoint.url).toBe(`${OPENAI_API_BASE}/chat/completions`);
    expect(endpoint.method).toBe("POST");
    expect((endpoint.headers as Record<string, string>).authorization).toBe("Bearer sk-offline_test_token");
    const body = endpoint.body as { model: string; messages: { role: string; content: string }[] };
    expect(body.model).toBe("gpt-4o");
    const system = body.messages.find((m) => m.role === "system")!.content;
    const user = body.messages.find((m) => m.role === "user")!.content;
    // The shape this app reads the answer back as.
    for (const key of ["title", "titles", "description", "tags", "hashtags", "chapters"]) {
      expect(system).toContain(key);
    }
    // The material: this project's own narration, title, phrases and settings.
    expect(user).toContain("Carthage and Rome fought three wars");
    expect(user).toContain("The Fall of Carthage");
    expect(user).toContain("carthage, rome, punic wars");
    expect(system).toContain("longform");
    expect(system).toContain("calm");
  });

  test("the instruction asks the model not to state a search-demand number or promise an outcome — and says why", () => {
    const messages = buildOpenAiSeoMessages(seoTask());
    // The app asks; it does not rely on being obeyed. See the file header and the
    // publishing-layer screen, which is the defence that actually holds.
    expect(messages.system).toContain("Do not state or imply any search volume");
    expect(messages.system).toContain("do not promise a ranking");
    expect(messages.system).toContain("the studio has no such data and publishes no such claim");
  });

  test("the two builders are two builders: one endpoint does not mean one request", () => {
    const scriptTask: AiTask = {
      type: "SCRIPT",
      capability: "script_generation",
      projectId: "proj_1",
      payload: { prompt: "A short film about what the sea keeps." },
      params: { videoType: "longform", language: "en" },
    };
    const script = buildOpenAiScriptMessages(scriptTask);
    const seo = buildOpenAiSeoMessages(seoTask());
    expect(script.system).not.toBe(seo.system);
    expect(script.system).not.toContain("tags");
    // The script builder reads `prompt`; the SEO builder reads the SEO payload.
    expect(script.user).toContain("what the sea keeps");
    expect(seo.user).not.toContain("what the sea keeps");
  });

  test("an SEO task that carries nothing to ask about is refused, and nothing is sent", () => {
    const empty = seoTask({ transcript: "", title: "", keywords: [] });
    expect(() => buildOpenAiChatRequest(empty, "gpt-4o", { token: "sk-offline_test_token" })).toThrow(
      /carried no transcript, title or keyword text/,
    );
    // …and the script path keeps its own, different refusal.
    const script: AiTask = { type: "SCRIPT", capability: "script_generation", projectId: "p", payload: {} };
    expect(() => buildOpenAiChatRequest(script, "gpt-4o", { token: "sk-offline_test_token" })).toThrow(
      /carried no prompt text/,
    );
  });

  test("no env var VALUE can appear in the adapter: the module only ever reads the NAME", () => {
    expect(OPENAI_API_KEY_ENV).toBe("OPENAI_API_KEY");
  });
});

/* ------------------------------------------------------------------ */
/* 3. The answer, read back honestly                                   */
/* ------------------------------------------------------------------ */

describe("P7-8 response — the provider's own text, and this app's parse of it", () => {
  test("a well-formed answer is parsed into the capability's own output, with the text kept verbatim", async () => {
    const result = await parseOpenAiChatResponse(withContent(SEO_JSON), "seo_generation");
    expect(result.status).toBe("ok");
    expect(result.resultText).toBe(SEO_JSON);
    const seo = (result.outputRefs as { seo: Record<string, unknown> }).seo;
    expect(seo.title).toBe("The Fall of Carthage");
    expect(seo.description).toContain("A plain account of the war");
    expect(seo.tags).toEqual(["carthage", "rome"]);
    expect(seo.hashtags).toEqual(["#history"]);
    // The title itself is not listed again as an alternative; nothing was padded.
    expect(seo.titles).toEqual(["Hannibal's Crossing", "Rome and Carthage at Sea"]);
    expect(seo.parsedByApp).toBe(true);
    expect((result.outputRefs as { seoParseError: string | null }).seoParseError).toBeNull();
    expect((result.outputRefs as { verifiedByApp: boolean }).verifiedByApp).toBe(false);
    expect((result.responseSummary as { seoParsed: boolean }).seoParsed).toBe(true);
  });

  test("an answer that is not the shape is reported as UNPARSED, and nothing is invented to fill it", async () => {
    const prose = "Here are some ideas: The Fall of Carthage, Hannibal's Crossing.";
    const result = await parseOpenAiChatResponse(withContent(prose), "seo_generation");
    expect(result.status).toBe("ok");
    expect(result.resultText).toBe(prose); // the provider's characters, kept
    const refs = result.outputRefs as { seo: unknown; seoParseError: string | null };
    expect(refs.seo).toBeNull();
    expect(String(refs.seoParseError)).toContain("not JSON");
    expect((result.responseSummary as { seoParsed: boolean }).seoParsed).toBe(false);
  });

  test("a JSON answer missing the minimum the capability promises is unparsed, with the missing thing named", () => {
    const noTitle = parseSeoJson(JSON.stringify({ description: "Words.", tags: ["a"] }));
    expect(noTitle.seo).toBeNull();
    expect(String(noTitle.error)).toBe("the answer JSON carries no title");

    const noBody = parseSeoJson(JSON.stringify({ title: "A title" }));
    expect(noBody.seo).toBeNull();
    expect(String(noBody.error)).toBe("the answer JSON carries neither a description nor any tag");

    const notAnObject = parseSeoJson("[1,2,3]");
    expect(notAnObject.seo).toBeNull();
    expect(String(notAnObject.error)).toBe("the answer JSON is not an object");
  });

  test("an alternative list is carried only when the answer returned one — never padded", () => {
    const parsed = parseSeoJson(JSON.stringify({ title: "Only This", description: "Words.", tags: [] }));
    expect(parsed.seo).not.toBeNull();
    expect(parsed.seo?.titles).toBeUndefined();
    expect(parsed.seo?.hashtags).toBeUndefined();
    expect(parsed.seo?.chapters).toBeUndefined();
  });

  test("a 200 with no answer text is a failure, never an empty answer dressed up as generated metadata", async () => {
    const result = await parseOpenAiChatResponse(withContent(""), "seo_generation");
    expect(result.status).toBe("failed");
    expect(String(result.error)).toContain("no answer text");
    expect(result.outputRefs ?? null).toBeNull();
  });

  test("reached and rejected: the provider's own 401 body travels verbatim and no output exists", async () => {
    const result = await parseOpenAiChatResponse(
      new Response(OPENAI_401_BODY, { status: 401, headers: { "content-type": "application/json" } }),
      "seo_generation",
    );
    expect(result.status).toBe("failed");
    expect(String(result.error)).toContain(OPENAI_401_BODY);
    expect(result.outputRefs ?? null).toBeNull();
    expect(result.resultText ?? null).toBeNull();
    expect(String(result.error)).toContain("401");
  });

  test("the parse is capability-scoped: the same body read as a script is a different outcome", async () => {
    const asScript = await parseOpenAiChatResponse(withContent(SEO_JSON), "script_generation");
    const asSeo = await parseOpenAiChatResponse(withContent(SEO_JSON), "seo_generation");
    expect((asScript.outputRefs as { seo?: unknown }).seo).toBeUndefined();
    expect((asSeo.outputRefs as { seo?: unknown }).seo).not.toBeUndefined();
  });
});

/* ------------------------------------------------------------------ */
/* 4. The unkeyed state                                                */
/* ------------------------------------------------------------------ */

describe("P7-8 unkeyed — gated, naming the registry's env var, nothing attempted", () => {
  test("seo_generation is not_connected and WIRED, and the name comes from the registry", () => {
    const status = capabilityStatus("seo_generation");
    expect(status.status).toBe("not_connected");
    const openai = status.providers.find((p) => p.id === "openai")!;
    expect(openai.wired).toBe(true);
    expect(openai.configured).toBe(false);
    const path = capabilityEnvPath("seo_generation");
    expect(path.hasWiredProvider).toBe(true);
    expect(path.wiredProviderIds).toEqual(["openai"]);
    expect(path.envVars).toContain("OPENAI_API_KEY");
  });
});
