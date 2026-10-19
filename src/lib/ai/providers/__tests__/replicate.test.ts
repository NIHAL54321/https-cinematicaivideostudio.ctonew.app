/**
 * The Replicate adapter — offline proofs (NO NETWORK).
 *
 * Three things are proven here, all without leaving the machine:
 *
 *  1. WIRING IS DERIVED, NOT FLAGGED. `isWired(capability)` is true only for the
 *     capability the adapter really implements (`video_enhancement`), because a
 *     real buildRequest/parseResponse pair exists; a slot that merely declares a
 *     capability — or supplies no pair — is not wired.
 *  2. THE REQUEST IS SHAPED BY A REAL EXPORT PRESET. The task is built the same
 *     way the export job builds it (`buildExportJobRouterRequest` over
 *     `jobOutputSpec` for a real catalogue preset), and the request body's
 *     container / codec / bitrate / loudness / colour / duration / input
 *     reference are asserted against that preset's own values.
 *  3. THE HONEST OUTCOMES. Unkeyed: nothing is attempted, the capability is
 *     not_connected, no fetch happens. Keyed with a FAKE key: the attempt really
 *     happens (asserted on the captured fetch call), Replicate's own 401 body is
 *     recorded verbatim, the orchestrator reports `failed` — never `ok`, never a
 *     fabricated hand-off — and the export job's state is `provider_failed`.
 *
 * The live counterpart of (3) is archived as evidence, with the request actually
 * leaving the machine; the fetch here is a stub so the suite stays offline.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import {
  REPLICATE_API_BASE,
  REPLICATE_MODEL_PATHS,
  REPLICATE_TOKEN_ENV,
  ReplicateProvider,
  buildReplicateInput,
  buildReplicatePredictionRequest,
  parseReplicatePredictionResponse,
  replicateImplementedCapabilities,
} from "../replicate";
import { HttpProviderBase, mapHttpStatus, type HttpEndpoint } from "../http-provider";
import { providerEnvConfigured } from "../env-keys";
import { allProviders, getProvider, providersFor } from "../registry";
import { isProviderReady } from "../types";
import { allCapabilityStatus } from "../../status";
import { capabilityEnvPath } from "../capability-env";
import { routeReadyCandidates } from "../../router";
import { execute, type AiPersistence, type ProviderLogInput } from "../../orchestrator";
import { AI_CAPABILITIES, type AiTask } from "../../types";
import { buildExportJobRouterRequest, jobOutputSpec } from "../../../export/jobs";
import { findExportPreset } from "../../../export/presets";
import { EXPORT_ENCODE_CAPABILITY, exportProviderConnected, exportProviderGate, exportServingSlots } from "../../../export/service";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** The exact body Replicate returned to a deliberately invalid token, verbatim. */
const REPLICATE_401_BODY =
  '{"title":"Unauthenticated","detail":"You did not pass a valid authentication token","status":401}';

/** A 200 prediction body in Replicate's documented shape. */
function prediction(body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
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

const savedToken = process.env[REPLICATE_TOKEN_ENV];

beforeEach(() => {
  delete process.env[REPLICATE_TOKEN_ENV];
  fetchCalls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
  if (savedToken === undefined) delete process.env[REPLICATE_TOKEN_ENV];
  else process.env[REPLICATE_TOKEN_ENV] = savedToken;
});

/** The task an export job really builds, from a REAL catalogue preset. */
function exportTaskFor(presetId: string, durationSeconds = 754): AiTask {
  const preset = findExportPreset(presetId);
  if (!preset) throw new Error(`unknown preset in test: ${presetId}`);
  return buildExportJobRouterRequest({
    projectId: "proj-1",
    jobId: "job-1",
    requestKey: "sha256:deadbeef",
    capturedAt: "2026-10-05T00:00:00.000Z",
    durationSeconds,
    durationSource: "project target duration",
    outputs: [jobOutputSpec(preset, "Proof Project", durationSeconds)],
    sidecars: [],
  }) as unknown as AiTask;
}

/* ------------------------------------------------------------------ */
/* 1. Wiring is derived from a real implementation                     */
/* ------------------------------------------------------------------ */

describe("Replicate wiring — derived from a real request/response pair", () => {
  test("the registered replicate slot IS the real adapter", () => {
    const provider = getProvider("replicate");
    expect(provider).toBeInstanceOf(ReplicateProvider);
    expect(provider?.id).toBe("replicate");
  });

  test("wired exactly for the capabilities the adapter has an endpoint mapping for", () => {
    const provider = getProvider("replicate")!;
    const implemented = replicateImplementedCapabilities();
    expect(implemented).toEqual(["video_enhancement"]);
    expect(Object.keys(REPLICATE_MODEL_PATHS)).toEqual(implemented);
    // For every capability the slot advertises: wired iff it is implemented.
    for (const capability of provider.capabilities) {
      expect(provider.isWired(capability)).toBe(implemented.includes(capability));
    }
    expect(provider.isWired("video_enhancement")).toBe(true);
    expect(provider.isWired("image_generation")).toBe(false);
    expect(provider.isWired("voice_generation")).toBe(false);
    expect(provider.isWired()).toBe(true); // wired for at least one capability
  });

  test("the wired capabilities in the whole product are exactly the three with real adapters", () => {
    const wiredPaths = AI_CAPABILITIES.filter((c) => capabilityEnvPath(c).hasWiredProvider);
    // Block 13 added the second adapter (OpenAI, script_generation), so this list
    // moved from ["video_enhancement"] to two entries; P7-8 gave that same OpenAI
    // adapter a SECOND wired capability (`seo_generation`), so it is three. Both
    // moves are derived from the adapters' own tables — no list was hand-edited.
    // Everything else is still unwired, which the loop below checks per capability.
    expect(wiredPaths).toEqual(["script_generation", "video_enhancement", "seo_generation"]);
    expect(wiredPaths).toContain("video_enhancement");
    const path = capabilityEnvPath("video_enhancement");
    expect(path.wiredProviderIds).toEqual(["replicate"]);
    expect(path.providerIds).toEqual(["replicate", "runway"]);
    // Runway serves the capability but has NO implementation: it must not be
    // reported as wired just because it is in the same slot list.
    expect(path.providers.find((p) => p.providerId === "runway")?.wired).toBe(false);
  });

  test("the other eight slot providers stay unwired for every capability they advertise", () => {
    // Two slots carry real adapters (replicate, openai); the rest are plain slots.
    const others = allProviders().filter((p) => !["replicate", "openai"].includes(p.id));
    expect(others.length).toBe(8);
    for (const p of others) {
      expect(p.isWired()).toBe(false);
      for (const c of p.capabilities) expect(p.isWired(c)).toBe(false);
      // and none of them can be attempted for anything
      for (const c of p.capabilities) expect(isProviderReady(p, c)).toBe(false);
    }
  });

  test("a claimed capability without a real pair is NOT wired (no flag can fake it)", () => {
    // A subclass that declares the capability but supplies no implementation.
    class ClaimsButDoesNothing extends HttpProviderBase {
      protected override implementedCapabilities() {
        return ["video_enhancement" as const];
      }
    }
    const bare = new ClaimsButDoesNothing({
      id: "bare",
      name: "Bare",
      capabilities: ["video_enhancement"],
      rank: 99,
      metadata: { quality: 1, speed: 1, cost: 1 },
      baseUrl: "https://example.invalid",
      buildRequest: undefined as unknown as () => HttpEndpoint,
      parseResponse: undefined as unknown as () => Promise<Record<string, never>>,
    });
    expect(bare.isWired("video_enhancement")).toBe(false);
    // The same class WITHOUT the declaration is not wired either.
    class NoDeclaration extends HttpProviderBase {}
    const silent = new NoDeclaration({
      id: "silent",
      name: "Silent",
      capabilities: ["video_enhancement"],
      rank: 99,
      metadata: { quality: 1, speed: 1, cost: 1 },
      baseUrl: "https://example.invalid",
      buildRequest: () => ({ url: "https://example.invalid", method: "POST" }),
      parseResponse: async () => ({}),
    });
    expect(silent.isWired()).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* 2. The request, built from a real export preset                     */
/* ------------------------------------------------------------------ */

describe("Replicate request — built from a real export preset (offline)", () => {
  test("endpoint, auth header and the preset's own parameters travel in the body", () => {
    const preset = findExportPreset("youtube-1080p")!;
    const task = exportTaskFor("youtube-1080p");
    const endpoint = buildReplicatePredictionRequest(task, "video-upscaler", { token: "r8_offline_test_token" });

    // --- endpoint + auth header ---
    expect(endpoint.url).toBe(`${REPLICATE_API_BASE}/models/topazlabs/video-upscale/predictions`);
    expect(endpoint.method).toBe("POST");
    expect(Object.keys(endpoint.headers ?? {})).toEqual(["authorization", "content-type"]);
    expect(endpoint.headers?.authorization).toBe("Token r8_offline_test_token");
    // The token comes from the registry's own env var name, read at build time.
    expect(REPLICATE_TOKEN_ENV).toBe("REPLICATE_API_TOKEN");
    expect(providerEnvConfigured("replicate")).toBe(false); // no key in this suite

    // --- the body carries the deliverable the export job already resolved ---
    const input = (endpoint.body as { input: Record<string, unknown> }).input;
    expect(input.video).toBe("project-timeline://proj-1");
    expect(String(input.video_ref_kind)).toContain("no rendered or uploaded source file exists");
    expect(input.duration_seconds).toBe(754);
    expect(input.duration_source).toBe("project target duration");
    expect(input.job_id).toBe("job-1");
    expect(input.request_key).toBe("sha256:deadbeef");
    expect(input.project_id).toBe("proj-1");

    // container / video / audio / colour — every value is the PRESET's own value
    expect(input.container).toBe(preset.container);
    expect(input.container).toBe("mp4");
    expect(input.resolution).toBe(preset.resolution);
    expect(input.aspect_ratio).toBe(preset.aspect);
    expect(input.video_codec).toBe(preset.video.codec);
    expect(input.video_profile).toBe(preset.video.profile);
    expect(input.pixel_format).toBe(preset.video.pixelFormat);
    expect(input.frame_rate).toBe(preset.video.frameRate);
    expect(input.bitrate_kbps).toBe(preset.video.rateControl.targetVideoBitrateKbps);
    expect(input.max_bitrate_kbps).toBe(preset.video.rateControl.maxVideoBitrateKbps);
    expect(input.rate_control_mode).toBe(preset.video.rateControl.mode);
    expect(input.audio_codec).toBe(preset.audio.codec);
    expect(input.audio_sample_rate_hz).toBe(preset.audio.sampleRateHz);
    expect(input.audio_channels).toBe(preset.audio.channels);
    expect(input.loudness_target_lufs).toBe(preset.audio.loudnessTargetLufs);
    expect(input.true_peak_dbfs).toBe(preset.audio.truePeakDbfs);
    expect(input.colour_display).toBe(preset.colour.display);
    expect(input.colour_standard).toBe(preset.colour.standard);
    expect(input.colour_transfer).toBe(preset.colour.transfer);
    expect(input.peak_nits).toBe(preset.colour.peakNits);
    expect(input.reference_white_nits).toBe(preset.colour.referenceWhiteNits);
    expect(input.max_cll).toBe(preset.colour.maxCLL);
    expect(input.max_fall).toBe(preset.colour.maxFALL);

    // No network: building a request must never fetch.
    expect(fetchCalls).toHaveLength(0);
  });

  test("an HDR preset's own colour values travel, and a 4K preset routes its requirement", () => {
    const hdr = findExportPreset("youtube-2160p-hdr")!;
    const task = exportTaskFor(hdr.id, 120);
    const input = buildReplicateInput(task);
    expect(input.colour_display).toBe(hdr.colour.display);
    expect(input.colour_standard).toBe(hdr.colour.standard);
    expect(input.peak_nits).toBe(hdr.colour.peakNits);
    expect(input.max_cll).toBe(hdr.colour.maxCLL);
    expect(input.duration_seconds).toBe(120);
    expect((task.params as { requirements: string[] }).requirements).toEqual(["4k"]);
  });

  test("nothing is sent for an unimplemented capability or without a key", () => {
    const task = exportTaskFor("youtube-1080p");
    // A capability with no mapping: refuse, do not guess an endpoint.
    expect(() =>
      buildReplicatePredictionRequest({ ...task, capability: "voice_generation" }, null, { token: "x" }),
    ).toThrow(/no endpoint mapping for capability "voice_generation"/);
    // No token: refuse, do not emit an unauthenticated request.
    expect(() => buildReplicatePredictionRequest(task, null, { token: "   " })).toThrow(
      /REPLICATE_API_TOKEN is not set/,
    );
    expect(fetchCalls).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* 3. Response parsing — honest outcomes only                          */
/* ------------------------------------------------------------------ */

describe("Replicate response parsing", () => {
  test("a finished prediction yields Replicate's OWN output reference, unverified by this app", async () => {
    const parsed = await parseReplicatePredictionResponse(
      prediction({
        id: "abc123",
        status: "succeeded",
        output: "https://replicate.delivery/xyz/out.mp4",
        urls: { get: "https://api.replicate.com/v1/predictions/abc123" },
      }),
    );
    expect(parsed.status).toBe("ok");
    expect(parsed.providerRequestId).toBe("abc123");
    const refs = parsed.outputRefs as Record<string, unknown>;
    expect(refs.predictionId).toBe("abc123");
    expect(refs.predictionStatus).toBe("succeeded");
    expect(refs.output).toBe("https://replicate.delivery/xyz/out.mp4");
    expect(refs.verifiedByApp).toBe(false);
    expect(String(refs.note)).toContain("filesProduced stays 0");
  });

  test("an accepted-but-unfinished prediction claims no output, no progress, no ETA", async () => {
    const parsed = await parseReplicatePredictionResponse(
      prediction({
        id: "abc124",
        status: "starting",
        output: null,
        urls: { get: "https://api.replicate.com/v1/predictions/abc124" },
      }),
    );
    expect(parsed.status).toBe("ok");
    const refs = parsed.outputRefs as Record<string, unknown>;
    expect(refs.output).toBeNull();
    expect(refs.pollUrl).toBe("https://api.replicate.com/v1/predictions/abc124");
    // No provider-only field is invented: no progress, percentage or ETA.
    expect(refs.progress).toBeUndefined();
    expect(refs.percentComplete).toBeUndefined();
    expect(refs.etaSeconds).toBeUndefined();
    expect(refs.completedAt).toBeUndefined();
  });

  test("a failed prediction carries Replicate's own error text, verbatim", async () => {
    const parsed = await parseReplicatePredictionResponse(
      prediction({ id: "abc125", status: "failed", error: "CUDA out of memory", output: null }),
    );
    expect(parsed.status).toBe("failed");
    expect(parsed.error).toBe("Replicate prediction abc125 failed: CUDA out of memory");
    expect(parsed.providerRequestId).toBe("abc125");
  });

  test("canceled is a failure, and an unrecognisable body is NEVER ok", async () => {
    const canceled = await parseReplicatePredictionResponse(prediction({ id: "abc126", status: "canceled" }));
    expect(canceled.status).toBe("failed");
    const html = await parseReplicatePredictionResponse(new Response("<html>gateway</html>", { status: 200 }));
    expect(html.status).toBe("failed");
    expect(String(html.error)).toContain("non-JSON body");
    const wrongShape = await parseReplicatePredictionResponse(prediction({ hello: "world" }));
    expect(wrongShape.status).toBe("failed");
    expect(String(wrongShape.error)).toContain("unrecognised Replicate prediction response");
  });

  test("provider errors map to the existing categories (never to ok)", () => {
    expect(mapHttpStatus(401)).toBe("failed"); // the fake-key case
    expect(mapHttpStatus(403)).toBe("failed");
    expect(mapHttpStatus(422)).toBe("failed");
    expect(mapHttpStatus(500)).toBe("failed");
    expect(mapHttpStatus(429)).toBe("rate_limited");
    expect(mapHttpStatus(408)).toBe("timeout");
    expect(mapHttpStatus(200)).toBe("ok");
    expect(mapHttpStatus(201)).toBe("ok");
  });
});

/* ------------------------------------------------------------------ */
/* 4. The orchestrator path — unkeyed and fake-keyed                   */
/* ------------------------------------------------------------------ */

const enhanceTask = (): AiTask => exportTaskFor("youtube-1080p", 60);

describe("the orchestrator path, unkeyed (the regression to protect)", () => {
  test("with no key: not ready, not_connected, zero attempts, zero fetches", async () => {
    expect(providerEnvConfigured("replicate")).toBe(false);
    expect(providersFor("video_enhancement").filter((p) => isProviderReady(p, "video_enhancement"))).toEqual([]);
    expect(routeReadyCandidates(enhanceTask())).toEqual([]);

    const persistence = new MemoryPersistence();
    const result = await execute("u1", enhanceTask(), { persistence });
    expect(result.status).toBe("not_connected");
    expect(result.attempts).toEqual([]);
    expect(result.requiredEnv).toEqual(["REPLICATE_API_TOKEN", "RUNWAY_API_KEY"]);
    // Nothing left the machine and no AIGeneration row exists.
    expect(fetchCalls).toHaveLength(0);
    expect(persistence.generations).toHaveLength(0);
    expect(persistence.logs).toHaveLength(1);
    expect(persistence.logs[0].provider).toBe("none");
  });

  test("with no key: all 21 capabilities are not_connected", () => {
    const all = allCapabilityStatus();
    expect(all).toHaveLength(21);
    expect(all.filter((c) => c.status !== "not_connected")).toEqual([]);
    // The wiring is still visible and honest: replicate is wired for the one
    // capability it implements, and only for that one.
    const ve = all.find((c) => c.capability === "video_enhancement")!;
    expect(ve.providers.find((p) => p.id === "replicate")?.wired).toBe(true);
    const ig = all.find((c) => c.capability === "image_generation")!;
    expect(ig.providers.find((p) => p.id === "replicate")?.wired).toBe(false);
  });
});

describe("the orchestrator path with a deliberately invalid key", () => {
  test("the attempt leaves the server, Replicate's own error is recorded, status is failed — never ok", async () => {
    process.env[REPLICATE_TOKEN_ENV] = "r8_deliberately_invalid_offline";
    expect(providerEnvConfigured("replicate")).toBe(true);
    const ready = routeReadyCandidates(enhanceTask()).map((c) => c.provider.id);
    expect(ready).toEqual(["replicate"]);

    stubFetch(() =>
      new Response(REPLICATE_401_BODY, {
        status: 401,
        headers: { "content-type": "application/problem+json" },
      }),
    );

    const persistence = new MemoryPersistence();
    const result = await execute("u1", enhanceTask(), { persistence });

    // The call really went out, to Replicate, with the key.
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0].url).toBe(`${REPLICATE_API_BASE}/models/topazlabs/video-upscale/predictions`);
    const headers = fetchCalls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Token r8_deliberately_invalid_offline");

    // The outcome is the provider's, not ours.
    expect(result.status).toBe("failed");
    expect(result.provider).toBeUndefined(); // no winner was fabricated
    expect(result.outputRefs ?? null).toBeNull(); // and no output reference exists
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0].provider).toBe("replicate");
    expect(result.attempts[0].status).toBe("failed");
    expect(String(result.attempts[0].error)).toBe(`http 401: ${REPLICATE_401_BODY}`);

    // …and it is in the audit trail verbatim, with the HTTP status.
    expect(persistence.logs).toHaveLength(1);
    expect(persistence.logs[0].provider).toBe("replicate");
    expect(String(persistence.logs[0].errorMessage)).toContain(REPLICATE_401_BODY);
    expect(persistence.logs[0].responseSummary).toEqual({ httpStatus: 401 });
    expect(persistence.generations[0].updates.at(-1)?.status).toBe("FAILED");
  });

  test("a 429 is rate_limited and a 500 is failed — the error categories are real", async () => {
    process.env[REPLICATE_TOKEN_ENV] = "r8_deliberately_invalid_offline";
    stubFetch(() => new Response('{"detail":"too many requests"}', { status: 429 }));
    const limited = await execute("u1", enhanceTask(), { persistence: new MemoryPersistence() });
    expect(limited.status).toBe("rate_limited");

    stubFetch(() => new Response('{"detail":"boom"}', { status: 500 }));
    const broken = await execute("u1", enhanceTask(), { persistence: new MemoryPersistence() });
    expect(broken.status).toBe("failed");
    expect(String(broken.error)).toContain("http 500");
  });

  test("a transport failure is a failed attempt, not a silent success", async () => {
    process.env[REPLICATE_TOKEN_ENV] = "r8_deliberately_invalid_offline";
    stubFetch(() => {
      throw new Error("getaddrinfo ENOTFOUND api.replicate.com");
    });
    const result = await execute("u1", enhanceTask(), { persistence: new MemoryPersistence() });
    expect(result.status).toBe("failed");
    expect(String(result.error)).toContain("network error");
    expect(result.outputRefs ?? null).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* 5. The export surface's connected flag is DERIVED                  */
/* ------------------------------------------------------------------ */

describe("the export gate responds to reality", () => {
  test("unkeyed: connected is false because no key is set, and the note says why", () => {
    expect(exportProviderConnected()).toBe(false);
    const gate = exportProviderGate("Encoding this job's deliverable");
    expect(gate.capability).toBe(EXPORT_ENCODE_CAPABILITY);
    expect(gate.connected).toBe(false);
    expect(gate.requiredEnv).toEqual(["REPLICATE_API_TOKEN", "RUNWAY_API_KEY"]);
    // It now names what IS wired, and warns that the unwired slot's key alone
    // would still change nothing.
    expect(gate.wiredProviders.map((p) => p.id)).toEqual(["replicate"]);
    expect(gate.unwiredProviders.map((p) => p.id)).toEqual(["runway"]);
    expect(gate.note).toContain("IS wired");
    expect(gate.note).toContain("nothing was attempted");
    expect(gate.note).toContain("filesProduced stays 0");
    expect(gate.note).toContain("UNWIRED slot");
    expect(gate.note).toContain("REPLICATE_API_TOKEN");
    expect(gate.connectedBasis).toContain("configured");
    const { wired, unwired } = exportServingSlots();
    expect(wired.map((w) => w.configured)).toEqual([false]);
    expect(unwired.map((w) => w.envKeys)).toEqual([["RUNWAY_API_KEY"]]);
  });

  test("fake key: connected flips to true because the adapter is real — and still claims no file", () => {
    process.env[REPLICATE_TOKEN_ENV] = "r8_deliberately_invalid";
    expect(exportProviderConnected()).toBe(true);
    const gate = exportProviderGate("Encoding this job's deliverable");
    expect(gate.connected).toBe(true);
    expect(gate.requiredEnv).toEqual(["REPLICATE_API_TOKEN", "RUNWAY_API_KEY"]);
    expect(gate.note).toContain("connected, wired provider");
    expect(gate.note).toContain("filesProduced stays 0");
    expect(gate.connectedProviders.map((p) => p.id)).toEqual(["replicate"]);
  });
});
