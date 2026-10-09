/**
 * Real provider slots — one per provider, declaring capabilities, env keys,
 * scoring metadata and default models. These are the "A / B / C / D" slots the
 * router ranks per capability.
 *
 * Wiring is declared per capability, not per provider: a slot answers isWired()
 * true only for the capabilities a real request/response pair actually exists for
 * (today exactly two — Replicate for `video_enhancement`, OpenAI for
 * `script_generation`; see the UPDATEs below). For every other capability the
 * orchestrator does not attempt a call and the status API reports
 * "not_connected". Wiring another one means: implement call() (extend
 * HttpProviderBase with a real buildRequest/parseResponse) and make that
 * provider's isWired() return true for the capability. No other code changes.
 *
 * UPDATE (2026-10-05): the Replicate slot is no longer a plain slot — it is a
 * real `ReplicateProvider` adapter, wired for `video_enhancement` and nothing
 * else. Its `isWired()` is DERIVED (a real request/response pair exists for that
 * capability), not flipped.
 *
 * UPDATE (2026-10-09): the OpenAI slot is no longer a plain slot either — it is a
 * real `OpenAiProvider` adapter, wired for `script_generation` and nothing else,
 * with the same derived `isWired()`. The remaining EIGHT slots below are still
 * plain slots and still answer false for every capability — two adapters, two
 * capabilities, and the rest un-wired until their own slices.
 */
import type { AiCapabilityId, AiTask } from "../types";
import type { AiProvider, ProviderCallResult } from "./types";
import { ProviderNotWiredError } from "./types";
import { providerEnvConfigured, providerRequiredEnv } from "./env-keys";
import { createReplicateProvider } from "./replicate";
import { createOpenAiProvider } from "./openai";

interface SlotConfig {
  id: string;
  name: string;
  capabilities: readonly AiCapabilityId[];
  rank: number;
  quality: number;
  speed: number;
  cost: number;
  maxResolution?: string;
  supportedLanguages?: string[];
  features?: string[];
  models: Partial<Record<AiCapabilityId, string | null>>;
}

function slot(cfg: SlotConfig): AiProvider {
  return {
    id: cfg.id,
    name: cfg.name,
    capabilities: cfg.capabilities,
    rank: cfg.rank,
    metadata: {
      quality: cfg.quality,
      speed: cfg.speed,
      cost: cfg.cost,
      maxResolution: cfg.maxResolution,
      supportedLanguages: cfg.supportedLanguages,
      features: cfg.features,
    },
    isConfigured: () => providerEnvConfigured(cfg.id),
    isWired: () => false, // Phase 1: no real API integration yet — never fake it.
    requiredEnv: () => providerRequiredEnv(cfg.id),
    modelFor: (capability: AiCapabilityId) => cfg.models[capability] ?? null,
    call: async (_task: AiTask): Promise<ProviderCallResult> => {
      throw new ProviderNotWiredError(cfg.id, _task.capability);
    },
  };
}

const LANG_WIDE = [
  "en", "es", "fr", "de", "it", "pt", "nl", "pl", "ru", "ja", "ko", "zh", "ar", "hi", "tr",
];

/**
 * Provider A→D per capability is NOT fixed by name — the router ranks ALL
 * registered providers by quality/speed/cost/availability so the "A" slot for
 * scripts (e.g. OpenAI) differs from the "A" slot for video (e.g. Google Veo).
 * The top 4 ready candidates become the A → B → C → D chain at execution time.
 */
export const PROVIDER_SLOTS: AiProvider[] = [
  /**
   * OpenAI — the SECOND wired slot. Built by the real `OpenAiProvider` adapter
   * (./openai) instead of the plain `slot()` factory, because a real endpoint +
   * request builder + response parser exists for exactly one of its capabilities
   * (`script_generation`, the script path). The other twelve capabilities it
   * advertises stay unwired: `isWired(capability)` is derived from the adapter's
   * endpoint table, so nothing is claimed that is not built.
   */
  createOpenAiProvider({
    id: "openai", name: "OpenAI", rank: 1,
    capabilities: [
      "reasoning", "script_generation", "seo_generation", "translation",
      "subtitle_generation", "speech_recognition", "semantic_search",
      "image_generation", "thumbnail_generation", "voice_generation",
      "object_detection", "face_detection", "scene_detection",
    ],
    metadata: {
      quality: 0.9, speed: 0.7, cost: 0.5,
      maxResolution: "2048x2048",
      supportedLanguages: LANG_WIDE,
      features: ["consistent_characters"],
    },
    models: {
      reasoning: "gpt-4o", script_generation: "gpt-4o", seo_generation: "gpt-4o",
      translation: "gpt-4o", subtitle_generation: "gpt-4o",
      speech_recognition: "whisper-1", semantic_search: "text-embedding-3-large",
      image_generation: "gpt-image-1", thumbnail_generation: "gpt-image-1",
      voice_generation: "gpt-4o-mini-tts",
      object_detection: "gpt-4o", face_detection: "gpt-4o", scene_detection: "gpt-4o",
    },
  }),
  slot({
    id: "anthropic", name: "Anthropic", rank: 2,
    capabilities: ["reasoning", "script_generation", "seo_generation", "translation", "subtitle_generation"],
    quality: 0.9, speed: 0.6, cost: 0.5,
    supportedLanguages: LANG_WIDE,
    models: {
      reasoning: "claude-3-7-sonnet-latest", script_generation: "claude-3-7-sonnet-latest",
      seo_generation: "claude-3-7-sonnet-latest", translation: "claude-3-7-sonnet-latest",
      subtitle_generation: "claude-3-7-sonnet-latest",
    },
  }),
  slot({
    id: "google", name: "Google AI", rank: 3,
    capabilities: [
      "reasoning", "script_generation", "seo_generation", "translation",
      "speech_recognition", "image_generation", "thumbnail_generation",
      "video_generation", "voice_generation",
      "object_detection", "face_detection", "scene_detection",
    ],
    quality: 0.85, speed: 0.75, cost: 0.6,
    maxResolution: "3840x2160",
    supportedLanguages: LANG_WIDE,
    features: ["consistent_characters"],
    models: {
      reasoning: "gemini-2.5-pro", script_generation: "gemini-2.5-pro",
      seo_generation: "gemini-2.5-pro", translation: "gemini-2.5-pro",
      speech_recognition: "gemini-2.5-flash", image_generation: "imagen-4.0",
      thumbnail_generation: "imagen-4.0", video_generation: "veo-3.1",
      voice_generation: "chirp-3-hd",
      object_detection: "gemini-2.5-flash", face_detection: "gemini-2.5-flash",
      scene_detection: "gemini-2.5-flash",
    },
  }),
  /**
   * Replicate — A WIRED SLOT (one of two). Built by the real `ReplicateProvider`
   * adapter (./replicate) instead of the plain `slot()` factory, because a real
   * endpoint + request builder + response parser exists for exactly one of its
   * capabilities (`video_enhancement`, the export path). The other thirteen
   * capabilities it advertises stay unwired: `isWired(capability)` is derived
   * from the adapter's endpoint table, so nothing is claimed that is not built.
   */
  createReplicateProvider({
    id: "replicate", name: "Replicate", rank: 4,
    capabilities: [
      "image_generation", "thumbnail_generation", "video_generation",
      "upscaling", "image_enhancement", "video_enhancement",
      "sound_effects", "music_generation", "voice_generation", "lip_sync",
      "speech_recognition", "object_detection", "face_detection", "scene_detection",
    ],
    metadata: {
      quality: 0.8, speed: 0.6, cost: 0.7,
      maxResolution: "3840x2160",
      supportedLanguages: LANG_WIDE,
      features: ["voice_cloning"],
    },
    models: {
      image_generation: "flux-1.1-pro", thumbnail_generation: "flux-schnell",
      video_generation: "wan-2.2", upscaling: "real-esrgan-4x",
      image_enhancement: "flux-lora-enhance", video_enhancement: "video-upscaler",
      sound_effects: "stable-audio-2.0", music_generation: "musicgen-melody",
      voice_generation: "rvc-v2", lip_sync: "wav2lip",
      speech_recognition: "whisperx",
      object_detection: "yolov8n", face_detection: "retinaface", scene_detection: "scenedetect",
    },
  }),
  slot({
    id: "runway", name: "Runway", rank: 5,
    capabilities: ["video_generation", "video_enhancement", "upscaling"],
    quality: 0.85, speed: 0.6, cost: 0.4,
    maxResolution: "3840x2160",
    models: { video_generation: "gen-4", video_enhancement: "gen-4", upscaling: "gen-4-upscaler" },
  }),
  slot({
    id: "elevenlabs", name: "ElevenLabs", rank: 6,
    capabilities: ["voice_generation", "speech_recognition", "lip_sync"],
    quality: 0.95, speed: 0.7, cost: 0.5,
    supportedLanguages: LANG_WIDE,
    features: ["voice_cloning"],
    models: {
      voice_generation: "eleven_multilingual_v2",
      speech_recognition: "scribe_v1",
      lip_sync: "elevenlabs-video-dubbing",
    },
  }),
  slot({
    id: "stability", name: "Stability AI", rank: 7,
    capabilities: [
      "image_generation", "thumbnail_generation", "image_enhancement",
      "upscaling", "music_generation", "sound_effects",
    ],
    quality: 0.9, speed: 0.6, cost: 0.5,
    maxResolution: "3840x2160",
    models: {
      image_generation: "sd3.5-large", thumbnail_generation: "sd3.5-large-turbo",
      image_enhancement: "creative-upscaler", upscaling: "stable-image-upscale",
      music_generation: "stable-audio-2.0", sound_effects: "stable-audio-2.0",
    },
  }),
  slot({
    id: "azure", name: "Azure Speech", rank: 8,
    capabilities: ["voice_generation", "speech_recognition"],
    quality: 0.85, speed: 0.8, cost: 0.7,
    supportedLanguages: LANG_WIDE,
    models: { voice_generation: "azure-neural-tts", speech_recognition: "azure-speech-to-text" },
  }),
  slot({
    id: "pexels", name: "Pexels", rank: 9,
    capabilities: ["stock_media_search"],
    quality: 0.8, speed: 0.9, cost: 0.9,
    models: { stock_media_search: null },
  }),
  slot({
    id: "unsplash", name: "Unsplash", rank: 10,
    capabilities: ["stock_media_search"],
    quality: 0.8, speed: 0.9, cost: 0.9,
    models: { stock_media_search: null },
  }),
];
