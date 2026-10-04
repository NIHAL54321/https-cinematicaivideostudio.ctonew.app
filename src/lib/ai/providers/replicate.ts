/**
 * Replicate adapter — the FIRST real AI provider implementation in this app.
 *
 * WHAT IT IS: a genuine HTTP client for Replicate's prediction API
 * (POST /v1/models/{owner}/{name}/predictions, `Authorization: Token <key>`).
 * It is a subclass of `HttpProviderBase`, so it inherits the fetch mechanics
 * (AbortController timeout, HTTP status → ok / rate_limited / timeout / failed,
 * latency capture) and supplies the two things that make a provider real:
 *
 *   buildRequest(task, model)   → the exact HTTP request, built from the task
 *   parseResponse(res, task)    → a ProviderCallResult from the raw response
 *
 * WHAT IT IMPLEMENTS: exactly ONE capability — `video_enhancement`, the export
 * path. `implementedCapabilities()` is derived from `REPLICATE_MODEL_PATHS`, the
 * table of capabilities that have a real endpoint + input mapping. Replicate's
 * slot advertises fourteen capabilities; the thirteen that are not in this table
 * stay unwired, and `isWired(capability)` answers accordingly. That is the whole
 * point: a provider must not be reported as serving a capability nobody
 * implemented.
 *
 * WHAT IT DOES NOT DO: it never invents an output. A 2xx response is parsed into
 * Replicate's OWN reference for the prediction (id, status, poll url, and an
 * output only when Replicate itself returned one). The app has not downloaded,
 * decoded or verified any file, so nothing here ever claims a produced file and
 * `filesProduced` stays 0 on every job.
 *
 * THE ONE THING THAT CANNOT BE VERIFIED ON THIS MACHINE: the model slug below
 * (`topazlabs/video-upscale`) is the third-party model this capability is mapped
 * to. No key exists on this server, so its existence and its input schema are
 * UNVERIFIED: a wrong slug or a wrong input field name surfaces as Replicate's
 * own error, recorded verbatim, never as a fabricated success.
 *
 * SERVER-SIDE ONLY: the API token is read with `readEnvVar` at request-build
 * time and never leaves this module except as an Authorization header.
 */
import type { AiCapabilityId, AiTask } from "../types";
import { PROVIDER_ENV_KEYS, readEnvVar } from "./env-keys";
import {
  HttpProviderBase,
  type HttpEndpoint,
  type HttpProviderConfig,
} from "./http-provider";
import type { ProviderCallResult } from "./types";

/** The env var NAME the provider registry declares for Replicate (never a value). */
export const REPLICATE_TOKEN_ENV = PROVIDER_ENV_KEYS.replicate.envKeys[0];

/** Replicate's public API base. Documented constant — not configurable. */
export const REPLICATE_API_BASE = "https://api.replicate.com/v1";

/**
 * capability → the Replicate model path that serves it, plus the model id the
 * provider slot declares. THIS TABLE IS THE WIRING: a capability appears here
 * only when a real request builder + response parser exists for it.
 */
export const REPLICATE_MODEL_PATHS: Partial<Record<AiCapabilityId, { modelPath: string }>> = {
  // The export path: the preset's resolved encode spec is handed to a video
  // upscaler. Slug is the declared mapping — see the header note on verification.
  video_enhancement: { modelPath: "topazlabs/video-upscale" },
};

/** The capabilities this adapter really implements (derived from the table). */
export function replicateImplementedCapabilities(): AiCapabilityId[] {
  return Object.keys(REPLICATE_MODEL_PATHS) as AiCapabilityId[];
}

/* ------------------------------------------------------------------ */
/* Request building                                                    */
/* ------------------------------------------------------------------ */

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);
const obj = (v: unknown): Record<string, unknown> | null =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/**
 * The prediction input, built from what the EXPORT JOB already resolved — the
 * preset's container / codec / bitrate / loudness / colour parameters, the
 * duration and its source, and the input reference. Nothing is invented here:
 * every value is copied from the task the job service handed the orchestrator.
 *
 * Field names are this app's own encode-request vocabulary, stated as such. They
 * have NOT been checked against a live model's input schema (no key exists on
 * this server); a model that rejects one surfaces Replicate's own error.
 */
export function buildReplicateInput(task: AiTask): Record<string, unknown> {
  const payload = obj(task.payload) ?? {};
  const deliverable = obj(payload.deliverable) ?? {};
  const video = obj(deliverable.video) ?? {};
  const audio = obj(deliverable.audio) ?? {};
  const colour = obj(deliverable.colour) ?? {};
  const rateControl = obj(video.rateControl) ?? {};
  const outputs = Array.isArray(payload.outputs) ? payload.outputs.map(obj).filter(Boolean) : [];
  const sidecars = Array.isArray(payload.sidecarsToMux) ? payload.sidecarsToMux.map(obj).filter(Boolean) : [];

  return {
    // The input reference. It is the project's own editor timeline inside this
    // app — no rendered or uploaded source file exists, and the task says so.
    video: str(payload.videoRef) ?? str(task.params?.videoRef) ?? null,
    video_ref_kind: str(payload.videoRefKind) ?? null,

    // Duration, and the source it was resolved from (never guessed).
    duration_seconds: num(payload.durationSeconds) ?? num(task.params?.durationSeconds) ?? null,
    duration_source: str(payload.durationSource) ?? null,

    // Container / video / audio / colour — the deliverable preset's own values.
    container: str(deliverable.container) ?? null,
    resolution: str(deliverable.resolution) ?? null,
    aspect_ratio: str(deliverable.aspect) ?? null,
    width_px: num(deliverable.widthPx),
    height_px: num(deliverable.heightPx),
    video_codec: str(video.codec) ?? null,
    video_codec_family: str(video.codecFamily) ?? null,
    video_profile: str(video.profile) ?? null,
    video_level: str(video.level) ?? null,
    pixel_format: str(video.pixelFormat) ?? null,
    frame_rate: num(video.frameRate),
    bitrate_kbps: num(video.bitrateKbps),
    max_bitrate_kbps: num(video.maxBitrateKbps),
    rate_control_mode: str(rateControl.mode) ?? null,
    crf: num(rateControl.crf),
    audio_codec: str(audio.codec) ?? null,
    audio_sample_rate_hz: num(audio.sampleRateHz),
    audio_channels: num(audio.channels),
    audio_channel_layout: str(audio.channelLayout) ?? null,
    audio_bitrate_kbps: num(audio.bitrateKbps),
    loudness_target_lufs: num(audio.loudnessTargetLufs) ?? num(payload.loudnessTargetLufs),
    true_peak_dbfs: num(audio.truePeakDbfs) ?? num(payload.truePeakDbfs),
    colour_display: str(colour.display) ?? null,
    colour_standard: str(colour.standard) ?? null,
    colour_transfer: str(colour.transfer) ?? null,
    peak_nits: num(colour.peakNits),
    reference_white_nits: num(colour.referenceWhiteNits),
    max_cll: num(colour.maxCLL),
    max_fall: num(colour.maxFALL),

    // Sidecars the job asked to mux, each with its honest content state.
    sidecars: sidecars.map((s) => ({
      id: str(s?.id) ?? null,
      file_name: str(s?.fileName) ?? null,
      mime_type: str(s?.mimeType) ?? null,
      content_state: str(s?.contentState) ?? null,
      bytes: num(s?.bytes),
    })),

    // Multi-preset jobs travel as ONE request naming every output.
    outputs: outputs.map((o) => ({
      preset_id: str(o?.presetId) ?? null,
      file_name: str(o?.fileName) ?? null,
      container: str(o?.container) ?? null,
      resolution: str(o?.resolution) ?? null,
      aspect: str(o?.aspect) ?? null,
    })),

    // Audit identity — which stored job this prediction belongs to.
    project_id: str(task.projectId) ?? null,
    job_id: str(obj(task.metadata)?.jobId) ?? null,
    request_key: str(obj(task.metadata)?.requestKey) ?? null,
  };
}

export interface ReplicateRequestOptions {
  /** The API token to authorise with. Read from env by the provider. */
  token: string;
  /** Override the model path (test seam only; the table is the default). */
  modelPath?: string;
}

/**
 * Build the exact HTTP request. Throws — and therefore sends nothing — when the
 * capability has no mapping or the token is missing, so an unconfigured server
 * can never emit a request that pretends to be authorised.
 */
export function buildReplicatePredictionRequest(
  task: AiTask,
  _model: string | null,
  opts: ReplicateRequestOptions,
): HttpEndpoint {
  const mapped = REPLICATE_MODEL_PATHS[task.capability]?.modelPath ?? opts.modelPath;
  if (!mapped) {
    throw new Error(
      `Replicate has no endpoint mapping for capability "${task.capability}" — this adapter implements ` +
        `only: ${replicateImplementedCapabilities().join(", ") || "(none)"}. Nothing was sent.`,
    );
  }
  const token = opts.token.trim();
  if (!token) {
    throw new Error(
      `${REPLICATE_TOKEN_ENV} is not set on this server, so no request was built and nothing was sent.`,
    );
  }
  return {
    url: `${REPLICATE_API_BASE}/models/${mapped}/predictions`,
    method: "POST",
    headers: {
      // Replicate's documented auth scheme: `Authorization: Token <token>`.
      authorization: `Token ${token}`,
      "content-type": "application/json",
    },
    body: { input: buildReplicateInput(task) },
  };
}

/* ------------------------------------------------------------------ */
/* Response parsing                                                    */
/* ------------------------------------------------------------------ */

/**
 * Map Replicate's own prediction body to a ProviderCallResult.
 *
 *  - `succeeded`  → ok, carrying Replicate's output reference.
 *  - `starting` / `processing` → ok, carrying Replicate's OWN reference to the
 *    accepted request (id + poll url). No output exists yet and none is implied.
 *  - `failed` / `canceled` → failed, carrying Replicate's own error verbatim.
 *  - anything unrecognisable → failed, quoting the raw body — never ok.
 *
 * The base class never calls this for a non-2xx status; those are mapped from the
 * HTTP status alone (401/403/5xx → failed, 429/408 → rate_limited/timeout) and
 * the response body is attached to the attempt as `http <status>: <body>`.
 */
export async function parseReplicatePredictionResponse(res: Response): Promise<Partial<ProviderCallResult>> {
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
      error: `Replicate returned a non-JSON body (http ${res.status}): ${raw.slice(0, 200)}`,
    };
  }

  const id = str(body.id);
  const predictionStatus = str(body.status);
  if (!id || !predictionStatus) {
    return {
      status: "failed",
      error:
        `unrecognised Replicate prediction response (http ${res.status}): no prediction id/status. ` +
        `Body: ${raw.slice(0, 200)}`,
    };
  }
  const urls = obj(body.urls) ?? {};
  const pollUrl = str(urls.get);
  const hasOutput = body.output !== null && body.output !== undefined;

  if (predictionStatus === "failed" || predictionStatus === "canceled") {
    const providerError = str(body.error) ?? `Replicate reported the prediction as "${predictionStatus}"`;
    return {
      status: "failed",
      providerRequestId: id,
      error: `Replicate prediction ${id} ${predictionStatus}: ${providerError}`,
      responseSummary: { httpStatus: res.status, predictionId: id, predictionStatus },
    };
  }

  const finished = predictionStatus === "succeeded";
  return {
    status: "ok",
    providerRequestId: id,
    outputRefs: {
      provider: "replicate",
      predictionId: id,
      predictionStatus,
      /** Replicate's own output — present only when Replicate produced one. */
      output: finished ? (body.output ?? null) : null,
      pollUrl,
      /** This app has downloaded, decoded and verified NOTHING. */
      verifiedByApp: false,
      note: finished
        ? "Replicate's OWN output reference for a finished prediction. This app has not downloaded or verified the " +
          "file, so no produced file is claimed: filesProduced stays 0."
        : "Replicate ACCEPTED the request and returned its own prediction reference. No output exists yet, and this app " +
          "claims none: no progress, percentage or ETA is known or reported.",
    },
    responseSummary: { httpStatus: res.status, predictionId: id, predictionStatus, hasOutput },
  };
}

/* ------------------------------------------------------------------ */
/* The provider                                                        */
/* ------------------------------------------------------------------ */

/** The slot facts the adapter needs (the rest of the slot table is unchanged). */
export interface ReplicateProviderConfig {
  id: string;
  name: string;
  capabilities: readonly AiCapabilityId[];
  rank: number;
  metadata: HttpProviderConfig["metadata"];
  models: Partial<Record<AiCapabilityId, string | null>>;
}

/**
 * Replicate, wired for the capabilities in `REPLICATE_MODEL_PATHS` and for
 * nothing else. `isWired()` is inherited from `HttpProviderBase`, which derives
 * it from (a) this adapter's declared implemented capabilities and (b) the real
 * buildRequest/parseResponse pair below — never from a flag.
 */
export class ReplicateProvider extends HttpProviderBase {
  constructor(cfg: ReplicateProviderConfig) {
    super({
      id: cfg.id,
      name: cfg.name,
      capabilities: cfg.capabilities,
      rank: cfg.rank,
      metadata: cfg.metadata,
      baseUrl: REPLICATE_API_BASE,
      defaultTimeoutMs: 180_000, // upscaling a long-form export is slow work
      buildRequest: (task, model) =>
        buildReplicatePredictionRequest(task, model, { token: readEnvVar(REPLICATE_TOKEN_ENV) }),
      parseResponse: (res) => parseReplicatePredictionResponse(res),
      modelFor: (capability) => cfg.models[capability] ?? null,
    });
  }

  protected implementedCapabilities(): readonly AiCapabilityId[] {
    return replicateImplementedCapabilities();
  }
}

/** Build the adapter from a plain slot definition (see `slots.ts`). */
export function createReplicateProvider(cfg: ReplicateProviderConfig): ReplicateProvider {
  return new ReplicateProvider(cfg);
}
