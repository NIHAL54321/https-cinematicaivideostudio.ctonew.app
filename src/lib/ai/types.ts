/**
 * AI Model Orchestrator — core types.
 *
 * Self-contained module (no `@/` aliases, no side effects) so it can be
 * imported by tests and by the server without dragging the rest of the app in.
 * Provider API keys NEVER appear here — they live server-side only, read via
 * `src/lib/ai/providers/env-keys.ts`.
 *
 * The module models every AI capability the product needs (21 abstractions)
 * as a typed interface with input/output contracts. Providers plug into
 * capabilities; the task router ranks them; the orchestrator walks the
 * A → B → C → D chain with honest "not_connected" results when nothing is
 * configured. Nothing here is ever simulated.
 */

// ---------------------------------------------------------------------------
// The 21 capability abstractions
// ---------------------------------------------------------------------------

export const AI_CAPABILITIES = [
  "reasoning",
  "script_generation",
  "image_generation",
  "video_generation",
  "voice_generation",
  "speech_recognition",
  "translation",
  "music_generation",
  "sound_effects",
  "image_enhancement",
  "video_enhancement",
  "upscaling",
  "lip_sync",
  "subtitle_generation",
  "scene_detection",
  "object_detection",
  "face_detection",
  "semantic_search",
  "stock_media_search",
  "thumbnail_generation",
  "seo_generation",
] as const;

export type AiCapabilityId = (typeof AI_CAPABILITIES)[number];

export const CAPABILITY_LABELS: Record<AiCapabilityId, string> = {
  reasoning: "Reasoning",
  script_generation: "Script Generation",
  image_generation: "Image Generation",
  video_generation: "Video Generation",
  voice_generation: "Voice Generation (TTS)",
  speech_recognition: "Speech Recognition (STT)",
  translation: "Translation",
  music_generation: "Music Generation",
  sound_effects: "Sound Effects",
  image_enhancement: "Image Enhancement",
  video_enhancement: "Video Enhancement",
  upscaling: "Upscaling",
  lip_sync: "Lip Synchronization",
  subtitle_generation: "Subtitle Generation",
  scene_detection: "Scene Detection",
  object_detection: "Object Detection",
  face_detection: "Face Detection",
  semantic_search: "Semantic Search",
  stock_media_search: "Stock Media Search",
  thumbnail_generation: "Thumbnail Generation",
  seo_generation: "SEO Generation",
};

// ---------------------------------------------------------------------------
// Task vocabulary — the high-level operations users trigger in the studio.
// Each task type maps to a capability (see capabilityForTaskType in router.ts).
// ---------------------------------------------------------------------------

export const AI_TASK_TYPES = [
  "REASON", // generic reasoning / planning
  "SCRIPT", // full script generation
  "STORYBOARD", // scene-by-scene storyboard reasoning
  "IMAGE", // text-to-image
  "VIDEO", // text-to-video
  "VOICE", // text-to-speech voiceover
  "TRANSCRIBE", // speech-to-text
  "TRANSLATE", // translation / dubbing script
  "MUSIC", // music generation
  "SOUND_EFFECT", // sound effect generation
  "ENHANCE_IMAGE", // image enhancement
  "ENHANCE_VIDEO", // video enhancement
  "UPSCALE", // resolution upscale
  "LIP_SYNC", // lip synchronization
  "SUBTITLE", // subtitle generation from audio/transcript
  "DETECT_SCENE", // scene detection on footage
  "DETECT_OBJECT", // object detection
  "DETECT_FACE", // face detection
  "SEARCH_SEMANTIC", // semantic search over media/text
  "SEARCH_STOCK", // stock media search
  "THUMBNAIL", // thumbnail generation
  "SEO", // SEO metadata generation
] as const;

export type AiTaskType = (typeof AI_TASK_TYPES)[number];

// ---------------------------------------------------------------------------
// Common task/result shapes
// ---------------------------------------------------------------------------

/** User plan — mirrors the subscription Plan enum but keeps this module decoupled from Prisma. */
export type AiUserPlan = "FREE" | "PRO" | "STUDIO" | "TEAM";

export interface AiTaskParams {
  /** Output resolution, e.g. "1920x1080", "3840x2160", "1080x1920". */
  resolution?: string;
  /** Output format, e.g. "mp4", "webm", "png", "srt", "vtt", "wav", "mp3". */
  format?: string;
  /** Source language, e.g. "en". */
  language?: string;
  /** Target language (translation / dubbing). */
  targetLanguage?: string;
  /** Intended duration in seconds. */
  durationSeconds?: number;
  /** Aspect ratio, e.g. "16:9", "9:16". */
  aspectRatio?: string;
  /** Preferred voice id. */
  voiceId?: string;
  /** Seed for reproducible generation. */
  seed?: number;
  /** Sampling steps. */
  steps?: number;
  /** Style guide / style reference. */
  style?: string;
  /** Tone, e.g. "cinematic", "educational". */
  tone?: string;
  /** Target audience. */
  audience?: string;
  /** Video shape: long-form YouTube, Shorts, or a clip. */
  videoType?: "longform" | "shorts" | "clip";
  /** Explicit task requirements, e.g. "4k", "consistent_characters", "no_watermark". */
  requirements?: string[];
  [key: string]: unknown;
}

/**
 * A unit of AI work. `capability` is the primary abstraction the router and
 * orchestrator operate on; `type` is the product-level operation (SCRIPT,
 * IMAGE, VOICE, …) used for scoring adjustments and audit mapping.
 */
export interface AiTask {
  /** Optional caller-provided id (otherwise the orchestrator generates one). */
  id?: string;
  type: AiTaskType;
  capability: AiCapabilityId;
  /** Capability input — the typed input contract of the capability (below). */
  payload: Record<string, unknown>;
  params?: AiTaskParams;
  /** Tenant-scoped project context (optional; audio for audit rows). */
  projectId?: string;
  /** Free-form audit extras (never includes secrets). */
  metadata?: Record<string, unknown>;
}

export const AI_RESULT_STATUSES = [
  "ok",
  "not_connected",
  "failed",
  "rate_limited",
  "timeout",
] as const;

export type AiResultStatus = (typeof AI_RESULT_STATUSES)[number];

/** One provider attempt inside the A → B → C → D chain. */
export interface AiAttempt {
  provider: string;
  model: string | null;
  status: Exclude<AiResultStatus, "not_connected">;
  latencyMs?: number | null;
  costEstimate?: number | null;
  error?: string | null;
  providerRequestId?: string | null;
  at: string; // ISO timestamp of the attempt
}

/** Structured orchestrator result — the single return shape of every task. */
export interface AiResult {
  status: AiResultStatus;
  capability: AiCapabilityId;
  taskType: AiTaskType;
  /** Winning provider (when status === "ok"). */
  provider?: string | null;
  /** Winning model (when status === "ok"). */
  model?: string | null;
  /** Structured output refs — { assetId, externalId, url, resultText, ... } depending on capability. */
  outputRefs?: Record<string, unknown> | null;
  /** Convenience text output for language capabilities. */
  resultText?: string | null;
  /** Total wall time across attempts (ms). */
  latencyMs?: number | null;
  /** Total estimated cost in credits across attempts. */
  costEstimate?: number | null;
  /** Human-readable failure explanation (when not ok). */
  error?: string | null;
  /** Set when status === "not_connected": which server-side env vars would enable this capability. */
  requiredEnv?: string[];
  /** Every attempt made, in order (A → B → C → D). */
  attempts: AiAttempt[];
  /** AIGeneration row id — present only when real provider attempts happened. */
  generationId?: string | null;
  /** enqueue() path: true when the task was accepted by the queue. */
  queued?: boolean;
  /** enqueue() path: BullMQ job id when queued. */
  jobId?: string | null;
}

// ---------------------------------------------------------------------------
// Per-capability typed interfaces (all 21).
// Each interface is the contract a provider's call() must honor for that
// capability — the orchestrator is fully typed around these.
// ---------------------------------------------------------------------------

// 1. Reasoning ---------------------------------------------------------------
export interface ReasoningInput {
  prompt: string;
  system?: string;
  temperature?: number;
  maxTokens?: number;
  /** Structured output shape requested, e.g. "storyboard", "chapters", "analysis". */
  mode?: string;
}
export interface ReasoningOutput {
  text: string;
  finishReason?: string;
}
export interface ReasoningCapability {
  readonly id: "reasoning";
  run(input: ReasoningInput): Promise<ReasoningOutput>;
}

// 2. Script generation --------------------------------------------------------
export interface ScriptChapterDraft {
  title: string;
  summary?: string;
  scenes: { narration: string; visualPrompt?: string }[];
}
export interface ScriptGenerationInput {
  idea: string;
  audience?: string;
  tone?: string;
  style?: string;
  language?: string;
  durationSeconds?: number;
  videoType?: "longform" | "shorts";
  chaptersHint?: number;
}
export interface ScriptGenerationOutput {
  title: string;
  logline?: string;
  language: string;
  chapters: ScriptChapterDraft[];
}
export interface ScriptGenerationCapability {
  readonly id: "script_generation";
  run(input: ScriptGenerationInput): Promise<ScriptGenerationOutput>;
}

// 3. Image generation ---------------------------------------------------------
export interface GeneratedMediaRef {
  url: string;
  width?: number;
  height?: number;
  seed?: number;
  mimeType?: string;
}
export interface ImageGenerationInput {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  resolution?: string;
  seed?: number;
  steps?: number;
  style?: string;
  count?: number;
}
export interface ImageGenerationOutput {
  images: GeneratedMediaRef[];
}
export interface ImageGenerationCapability {
  readonly id: "image_generation";
  run(input: ImageGenerationInput): Promise<ImageGenerationOutput>;
}

// 4. Video generation ---------------------------------------------------------
export interface VideoGenerationInput {
  prompt: string;
  negativePrompt?: string;
  aspectRatio?: string;
  resolution?: string;
  durationSeconds?: number;
  fps?: number;
  seed?: number;
}
export interface VideoGenerationOutput {
  video: GeneratedMediaRef & { durationSeconds?: number };
}
export interface VideoGenerationCapability {
  readonly id: "video_generation";
  run(input: VideoGenerationInput): Promise<VideoGenerationOutput>;
}

// 5. Voice generation (TTS) ---------------------------------------------------
export interface VoiceGenerationInput {
  text: string;
  voiceId?: string;
  language?: string;
  speed?: number;
  pitch?: number;
  format?: string; // "mp3", "wav", "ogg"
}
export interface VoiceGenerationOutput {
  audioUrl: string;
  durationSeconds?: number;
  voiceId?: string;
}
export interface VoiceGenerationCapability {
  readonly id: "voice_generation";
  run(input: VoiceGenerationInput): Promise<VoiceGenerationOutput>;
}

// 6. Speech recognition (STT) -------------------------------------------------
export interface TranscriptSegment {
  start: number; // seconds
  end: number;
  text: string;
}
export interface SpeechRecognitionInput {
  audioRef: string; // url or asset ref
  language?: string;
  diarize?: boolean;
}
export interface SpeechRecognitionOutput {
  transcript: string;
  language?: string;
  segments?: TranscriptSegment[];
}
export interface SpeechRecognitionCapability {
  readonly id: "speech_recognition";
  run(input: SpeechRecognitionInput): Promise<SpeechRecognitionOutput>;
}

// 7. Translation ---------------------------------------------------------------
export interface TranslationInput {
  text?: string;
  transcriptRef?: string;
  sourceLanguage?: string;
  targetLanguage: string;
  preserveTone?: boolean;
}
export interface TranslationOutput {
  translatedText: string;
  targetLanguage: string;
}
export interface TranslationCapability {
  readonly id: "translation";
  run(input: TranslationInput): Promise<TranslationOutput>;
}

// 8. Music generation ----------------------------------------------------------
export interface MusicGenerationInput {
  genre?: string;
  mood?: string;
  durationSeconds?: number;
  bpm?: number;
  instruments?: string[];
  format?: string;
}
export interface MusicGenerationOutput {
  audioUrl: string;
  durationSeconds?: number;
  bpm?: number;
}
export interface MusicGenerationCapability {
  readonly id: "music_generation";
  run(input: MusicGenerationInput): Promise<MusicGenerationOutput>;
}

// 9. Sound effects -------------------------------------------------------------
export interface SoundEffectsInput {
  description: string;
  durationSeconds?: number;
  intensity?: "subtle" | "medium" | "strong";
  format?: string;
}
export interface SoundEffectsOutput {
  audioUrl: string;
  durationSeconds?: number;
}
export interface SoundEffectsCapability {
  readonly id: "sound_effects";
  run(input: SoundEffectsInput): Promise<SoundEffectsOutput>;
}

// 10. Image enhancement ---------------------------------------------------------
export interface ImageEnhancementInput {
  imageRef: string;
  enhancements?: string[]; // "denoise", "sharpen", "color_grade", "restore", ...
  strength?: number; // 0..1
}
export interface ImageEnhancementOutput {
  url: string;
  width?: number;
  height?: number;
}
export interface ImageEnhancementCapability {
  readonly id: "image_enhancement";
  run(input: ImageEnhancementInput): Promise<ImageEnhancementOutput>;
}

// 11. Video enhancement ----------------------------------------------------------
export interface VideoEnhancementInput {
  videoRef: string;
  enhancements?: string[]; // "denoise", "stabilize", "color_grade", "interpolate", ...
}
export interface VideoEnhancementOutput {
  url: string;
  durationSeconds?: number;
}
export interface VideoEnhancementCapability {
  readonly id: "video_enhancement";
  run(input: VideoEnhancementInput): Promise<VideoEnhancementOutput>;
}

// 12. Upscaling -------------------------------------------------------------------
export interface UpscalingInput {
  mediaRef: string;
  kind?: "image" | "video";
  scaleFactor?: 2 | 4;
  targetResolution?: string;
}
export interface UpscalingOutput {
  url: string;
  width?: number;
  height?: number;
}
export interface UpscalingCapability {
  readonly id: "upscaling";
  run(input: UpscalingInput): Promise<UpscalingOutput>;
}

// 13. Lip synchronization ----------------------------------------------------------
export interface LipSyncInput {
  videoRef: string;
  audioRef: string;
  language?: string;
}
export interface LipSyncOutput {
  url: string;
}
export interface LipSyncCapability {
  readonly id: "lip_sync";
  run(input: LipSyncInput): Promise<LipSyncOutput>;
}

// 14. Subtitle generation ------------------------------------------------------------
export interface SubtitleCue {
  start: number; // seconds
  end: number;
  text: string;
}
export interface SubtitleGenerationInput {
  audioRef?: string;
  transcriptRef?: string;
  language?: string;
  format?: "srt" | "vtt" | "ass";
  maxLineLength?: number;
}
export interface SubtitleGenerationOutput {
  subtitles: SubtitleCue[];
  file?: { format: string; content: string };
}
export interface SubtitleGenerationCapability {
  readonly id: "subtitle_generation";
  run(input: SubtitleGenerationInput): Promise<SubtitleGenerationOutput>;
}

// 15. Scene detection ---------------------------------------------------------------
export interface SceneDetectionInput {
  videoRef: string;
  threshold?: number; // 0..1
}
export interface SceneDetectionOutput {
  scenes: { start: number; end: number; label?: string }[];
}
export interface SceneDetectionCapability {
  readonly id: "scene_detection";
  run(input: SceneDetectionInput): Promise<SceneDetectionOutput>;
}

// 16. Object detection ----------------------------------------------------------------
export interface DetectionBox {
  label: string;
  confidence: number;
  bbox?: { x: number; y: number; width: number; height: number };
}
export interface ObjectDetectionInput {
  mediaRef: string; // image or video
  objects?: string[]; // filter to these labels
}
export interface ObjectDetectionOutput {
  detections: DetectionBox[];
}
export interface ObjectDetectionCapability {
  readonly id: "object_detection";
  run(input: ObjectDetectionInput): Promise<ObjectDetectionOutput>;
}

// 17. Face detection -------------------------------------------------------------------
export interface FaceDetectionInput {
  mediaRef: string; // image or video
}
export interface FaceDetectionOutput {
  faces: { bbox?: { x: number; y: number; width: number; height: number }; confidence?: number }[];
}
export interface FaceDetectionCapability {
  readonly id: "face_detection";
  run(input: FaceDetectionInput): Promise<FaceDetectionOutput>;
}

// 18. Semantic search -------------------------------------------------------------------
export interface SemanticSearchInput {
  query: string;
  corpusRefs?: string[]; // refs / ids to search over
  collectionId?: string; // server-side indexed collection
  topK?: number;
}
export interface SemanticSearchOutput {
  results: { ref: string; score: number; snippet?: string }[];
}
export interface SemanticSearchCapability {
  readonly id: "semantic_search";
  run(input: SemanticSearchInput): Promise<SemanticSearchOutput>;
}

// 19. Stock media search -----------------------------------------------------------------
export interface StockMediaResult {
  provider: string;
  externalId?: string;
  url: string;
  pageUrl?: string;
  license?: string;
  attribution?: string;
  width?: number;
  height?: number;
  durationSeconds?: number;
}
export interface StockMediaSearchInput {
  query: string;
  mediaType: "video" | "image" | "audio";
  orientation?: "landscape" | "portrait" | "square";
  durationSeconds?: number;
  count?: number;
}
export interface StockMediaSearchOutput {
  results: StockMediaResult[];
}
export interface StockMediaSearchCapability {
  readonly id: "stock_media_search";
  run(input: StockMediaSearchInput): Promise<StockMediaSearchOutput>;
}

// 20. Thumbnail generation ----------------------------------------------------------------
export interface ThumbnailGenerationInput {
  prompt?: string;
  videoRef?: string;
  title?: string;
  style?: string;
  textOverlay?: string;
  aspectRatio?: string; // typically "16:9" (1280x720)
}
export interface ThumbnailGenerationOutput {
  url: string;
  width?: number;
  height?: number;
}
export interface ThumbnailGenerationCapability {
  readonly id: "thumbnail_generation";
  run(input: ThumbnailGenerationInput): Promise<ThumbnailGenerationOutput>;
}

// 21. SEO generation ------------------------------------------------------------------------
export interface SeoGenerationInput {
  transcript?: string;
  transcriptRef?: string;
  title?: string;
  keywords?: string[];
  videoType?: "longform" | "shorts";
  language?: string;
}
export interface SeoGenerationOutput {
  title: string;
  description: string;
  tags: string[];
  chapters?: { start: number; title: string }[];
  hashtags?: string[];
}
export interface SeoGenerationCapability {
  readonly id: "seo_generation";
  run(input: SeoGenerationInput): Promise<SeoGenerationOutput>;
}

/** Union of every capability interface — a provider may implement several. */
export type AnyCapability =
  | ReasoningCapability
  | ScriptGenerationCapability
  | ImageGenerationCapability
  | VideoGenerationCapability
  | VoiceGenerationCapability
  | SpeechRecognitionCapability
  | TranslationCapability
  | MusicGenerationCapability
  | SoundEffectsCapability
  | ImageEnhancementCapability
  | VideoEnhancementCapability
  | UpscalingCapability
  | LipSyncCapability
  | SubtitleGenerationCapability
  | SceneDetectionCapability
  | ObjectDetectionCapability
  | FaceDetectionCapability
  | SemanticSearchCapability
  | StockMediaSearchCapability
  | ThumbnailGenerationCapability
  | SeoGenerationCapability;

/** Capability id → its input type (for generic dispatch). */
export interface CapabilityInputMap {
  reasoning: ReasoningInput;
  script_generation: ScriptGenerationInput;
  image_generation: ImageGenerationInput;
  video_generation: VideoGenerationInput;
  voice_generation: VoiceGenerationInput;
  speech_recognition: SpeechRecognitionInput;
  translation: TranslationInput;
  music_generation: MusicGenerationInput;
  sound_effects: SoundEffectsInput;
  image_enhancement: ImageEnhancementInput;
  video_enhancement: VideoEnhancementInput;
  upscaling: UpscalingInput;
  lip_sync: LipSyncInput;
  subtitle_generation: SubtitleGenerationInput;
  scene_detection: SceneDetectionInput;
  object_detection: ObjectDetectionInput;
  face_detection: FaceDetectionInput;
  semantic_search: SemanticSearchInput;
  stock_media_search: StockMediaSearchInput;
  thumbnail_generation: ThumbnailGenerationInput;
  seo_generation: SeoGenerationInput;
}
