/**
 * Phase 6 Block 3 — SIDECAR DELIVERABLES (pure, client-safe).
 *
 * What ships ALONGSIDE the video: the subtitle cue file, the chapter markers,
 * the thumbnail and the metadata sidecar. Every entry states one of three
 * honest content states and never blurs them:
 *
 *   "exists"               — the content is rendered here, from data the project
 *                            already holds (the subtitle engine's cues, the
 *                            timeline's scene beats, the project's own title /
 *                            description / tags, a thumbnail asset the project
 *                            already has),
 *   "requires-generation"  — the slot is real but empty; the entry names exactly
 *                            what would have to produce it (and, where that is
 *                            provider work, which env var would enable it),
 *   "empty"                — the project genuinely has nothing for the slot
 *                            (e.g. no cues, because no scene is narrated). Zero
 *                            is a real answer, not a failure.
 *
 * NOTHING IS INVENTED TO FILL A SLOT: no placeholder cue, no generated title, no
 * stock thumbnail, no fabricated chapter. NOTHING IS WRITTEN: this module returns
 * strings and numbers, and every entry carries `produced: false`.
 */
import { formatSrtTime, toSrt, type SubtitleCue, type SubtitlePlan } from "../subtitles/engine";
import { humanDuration } from "./sizing";
import {
  buildChapterPlan,
  type ChapterBeat,
  type ChapterPlan,
} from "./chapters";
import {
  PUBLISH_TARGET_IDS,
  findPublishTarget,
  type PublishTargetId,
  type TextLimits,
} from "./readiness";

export const SIDECAR_MANIFEST_FORMAT = "cavis.export.sidecars";
export const SIDECAR_MANIFEST_VERSION = 1;

export const SIDECAR_KINDS = ["subtitles-srt", "subtitles-vtt", "chapters", "thumbnail", "metadata"] as const;
export type SidecarKind = (typeof SIDECAR_KINDS)[number];

/** How a sidecar's content stands, in exactly three states. */
export type SidecarContentState = "exists" | "requires-generation" | "empty";

export const SIDECAR_TIME_FORMATS = {
  srt: "HH:MM:SS,mmm",
  vtt: "HH:MM:SS.mmm",
  chapters: "M:SS (or H:MM:SS at an hour or longer)",
} as const;

/** A sidecar file longer than this is reported with its length but truncated. */
export const MAX_SIDECAR_CHARS = 400_000;

/* ------------------------------------------------------------------ */
/* WebVTT timecode                                                     */
/* ------------------------------------------------------------------ */

/** Format ms as a WebVTT timestamp HH:MM:SS.mmm (SRT's comma becomes a period). */
export function formatVttTime(ms: number): string {
  return formatSrtTime(ms).replace(",", ".");
}

/** Render a REAL WebVTT document from the engine's cue data. */
export function toVtt(plan: SubtitlePlan): string {
  const head = "WEBVTT";
  if (plan.cues.length === 0) return `${head}\n`;
  const body = plan.cues
    .map((cue) => {
      const start = formatVttTime(cue.startMs);
      const end = formatVttTime(cue.endMs);
      // A cue id line is optional in WebVTT; the SRT index is kept as the id so
      // the two files line up cue-for-cue.
      return `${cue.index}\n${start} --> ${end}\n${cue.text}`;
    })
    .join("\n\n");
  return `${head}\n\n${body}\n`;
}

/* ------------------------------------------------------------------ */
/* Subtitle sidecar                                                    */
/* ------------------------------------------------------------------ */

export interface SubtitleSidecar {
  cueCount: number;
  hasCues: boolean;
  language: string;
  style: string;
  /** Where the cue data came from — always stated. */
  cueSource: string;
  /** Sum of every cue's own duration. */
  totalCueDurationMs: number;
  totalCueDurationHuman: string;
  firstCueStartMs: number | null;
  lastCueEndMs: number | null;
  /** last cue end − first cue start. */
  spanMs: number;
  /** Cues that would not be delivered because they fall outside the video. */
  outsideTimeline: number;
  timelineDurationMs: number;
  /** Fraction of the timeline inside a cue (0..1), or null when no timeline. */
  coveredFractionOfTimeline: number | null;
  srt: string;
  vtt: string;
  srtBytes: number;
  vttBytes: number;
  timecode: typeof SIDECAR_TIME_FORMATS;
  note: string;
}

export interface SubtitleSidecarInput {
  plan: SubtitlePlan;
  timelineDurationMs: number;
  cueSource: string;
  language?: string;
  style?: string;
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/** Build the subtitle sidecar from the subtitle engine's own plan. */
export function buildSubtitleSidecar(input: SubtitleSidecarInput): SubtitleSidecar {
  const cues: SubtitleCue[] = input.plan.cues.slice().sort((a, b) => a.startMs - b.startMs || a.index - b.index);
  const cueCount = cues.length;
  const timelineMs = Number.isFinite(input.timelineDurationMs) ? Math.max(0, Math.round(input.timelineDurationMs)) : 0;
  const totalCueDurationMs = cues.reduce((sum, c) => sum + Math.max(0, c.endMs - c.startMs), 0);
  const firstCueStartMs = cueCount > 0 ? cues[0].startMs : null;
  const lastCueEndMs = cueCount > 0 ? cues[cueCount - 1].endMs : null;
  const spanMs = firstCueStartMs !== null && lastCueEndMs !== null ? Math.max(0, lastCueEndMs - firstCueStartMs) : 0;
  const outsideTimeline = timelineMs > 0 ? cues.filter((c) => c.endMs > timelineMs).length : 0;
  const srt = toSrt({ ...input.plan, cues });
  const vtt = cueCount > 0 ? toVtt({ ...input.plan, cues }) : toVtt({ ...input.plan, cues: [] });

  return {
    cueCount,
    hasCues: cueCount > 0,
    language: input.language ?? input.plan.language,
    style: input.style ?? input.plan.style,
    cueSource: input.cueSource,
    totalCueDurationMs,
    totalCueDurationHuman: humanDuration(totalCueDurationMs / 1000),
    firstCueStartMs,
    lastCueEndMs,
    spanMs,
    outsideTimeline,
    timelineDurationMs: timelineMs,
    coveredFractionOfTimeline: timelineMs > 0 ? round3(Math.min(1, totalCueDurationMs / timelineMs)) : null,
    srt,
    vtt,
    srtBytes: byteLength(srt),
    vttBytes: byteLength(vtt),
    timecode: SIDECAR_TIME_FORMATS,
    note:
      cueCount === 0
        ? "No cues: this project's scenes carry no narration, so the subtitle engine had nothing to subtitle. The SRT is empty " +
          "and the WebVTT carries only its header — a real answer, not a failure. Nothing was invented to fill the cue list."
        : `${cueCount} cue(s) rendered from the subtitle engine's own plan over this project's narrated scenes ` +
          `(${input.cueSource}). ${SIDECAR_TIME_FORMATS.srt} for SRT and ${SIDECAR_TIME_FORMATS.vtt} for WebVTT.`,
  };
}

/** UTF-8 byte length without a Buffer (client-safe). */
export function byteLength(s: string): number {
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s).length;
  let n = 0;
  for (let i = 0; i < s.length; i += 1) {
    const c = s.charCodeAt(i);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : 3;
  }
  return n;
}

/* ------------------------------------------------------------------ */
/* Metadata sidecar                                                    */
/* ------------------------------------------------------------------ */

export interface MetadataSidecarInput {
  title: string | null;
  description: string | null;
  tags: string[] | null;
  titleSource: string;
  descriptionSource: string;
  tagsSource: string;
}

export interface MetadataLimitCheck {
  targetId: PublishTargetId;
  label: string;
  field: "title" | "description" | "tags";
  value: number | null;
  max: number | null;
  status: "pass" | "fail" | "unknown" | "absent";
  basis: string;
}

export interface MetadataSidecar {
  /** The metadata exactly as the project holds it (null where it holds nothing). */
  title: string | null;
  description: string | null;
  tags: string[] | null;
  hashtags: string[];
  counts: { titleChars: number | null; descriptionChars: number | null; tagCount: number | null; tagChars: number | null };
  sources: { title: string; description: string; tags: string };
  /** The per-platform limits the app can state, verbatim from ./readiness. */
  limits: { targetId: PublishTargetId; label: string; aspect: string; limits: TextLimits }[];
  checks: MetadataLimitCheck[];
  json: string;
  bytes: number;
  note: string;
}

function limitsView(targetId: PublishTargetId): { targetId: PublishTargetId; label: string; aspect: string; limits: TextLimits } | null {
  const spec = findPublishTarget(targetId);
  if (!spec) return null;
  return { targetId: spec.id, label: spec.label, aspect: spec.aspect, limits: spec.text };
}

function checkOf(
  targetId: PublishTargetId,
  field: "title" | "description" | "tags",
  value: number | null,
  max: number | null,
  basis: string,
  label: string,
): MetadataLimitCheck | null {
  if (max === null) return null;
  const status: MetadataLimitCheck["status"] = value === null ? "absent" : value <= max ? "pass" : "fail";
  return { targetId, label, field, value, max, status, basis };
}

/**
 * The metadata sidecar: the text the project already holds, its real counts, and
 * the stated per-platform limits. An absent field stays absent — the JSON carries
 * `null` and says where the value would have to come from.
 */
export function buildMetadataSidecar(input: MetadataSidecarInput): MetadataSidecar {
  const title = typeof input.title === "string" && input.title.trim() ? input.title.trim() : null;
  const description = typeof input.description === "string" && input.description.trim() ? input.description.trim() : null;
  const tags = Array.isArray(input.tags) && input.tags.length > 0 ? input.tags.map((t) => String(t).trim()).filter(Boolean) : null;
  const hashtags = (tags ?? []).map((t) => (t.startsWith("#") ? t : `#${t.replace(/^#+/, "")}`));

  const checks: MetadataLimitCheck[] = [];
  const limits: MetadataSidecar["limits"] = [];
  for (const targetId of PUBLISH_TARGET_IDS) {
    const view = limitsView(targetId);
    if (!view) continue;
    limits.push(view);
    const t = view.limits;
    const titleCheck = checkOf(targetId, "title", title ? title.length : null, t.titleMax, t.basis, `Title on ${view.label}`);
    if (titleCheck) checks.push(titleCheck);
    const descCheck = checkOf(
      targetId,
      "description",
      description ? description.length : null,
      t.descriptionMax,
      t.basis,
      `${t.descriptionFieldLabel} on ${view.label}`,
    );
    if (descCheck) checks.push(descCheck);
    const tagCheck = checkOf(
      targetId,
      "tags",
      tags ? tags.reduce((sum, x) => sum + x.length, 0) : null,
      t.tagsMaxChars,
      t.basis,
      `Tags on ${view.label}`,
    );
    if (tagCheck) checks.push(tagCheck);
  }

  const payload = {
    format: "cavis.export.metadata",
    version: 1,
    title,
    description,
    tags,
    hashtags,
    counts: {
      titleChars: title ? title.length : null,
      descriptionChars: description ? description.length : null,
      tagCount: tags ? tags.length : null,
      tagChars: tags ? tags.reduce((sum, x) => sum + x.length, 0) : null,
    },
    sources: { title: input.titleSource, description: input.descriptionSource, tags: input.tagsSource },
    limits: limits.map((l) => ({ targetId: l.targetId, label: l.label, aspect: l.aspect, ...l.limits })),
    checks,
  };
  const json = JSON.stringify(payload, null, 2);

  const missing: string[] = [];
  if (!title) missing.push("title");
  if (!description) missing.push("description");
  if (!tags) missing.push("tags");

  return {
    title,
    description,
    tags,
    hashtags,
    counts: payload.counts,
    sources: payload.sources,
    limits,
    checks,
    json,
    bytes: byteLength(json),
    note:
      missing.length === 0
        ? "Title, description and tags all come from the project's own stored text; no metadata was generated."
        : `The project stores no ${missing.join(", no ")}. ${
            missing.length < 3
              ? "This sidecar is PARTIAL: the fields it does carry are the project's own stored text and are real; the missing ones " +
                "stay null and would need generating. "
              : "Those fields stay null and are reported as needing generation. "
          }The SEO surface and its provider generate them, not this check.`,
  };
}

/* ------------------------------------------------------------------ */
/* The sidecar manifest                                                */
/* ------------------------------------------------------------------ */

export interface SidecarFile {
  id: SidecarKind;
  label: string;
  /** The file name that WOULD be written, or null when nothing exists to write. */
  fileName: string | null;
  mimeType: string;
  container: string;
  contentState: SidecarContentState;
  /** What the project does not hold for this slot, or what would have to produce it. null when nothing is missing. */
  requires: string | null;
  /** The env var NAME a provider-backed generation needs, when that is the answer. */
  requiresEnv: string | null;
  /** The rendered content, when it exists and fits. */
  content: string | null;
  bytes: number | null;
  truncated: boolean;
  /** This is a specification. Nothing was written. */
  produced: false;
  detail: Record<string, unknown>;
  note: string;
}

export interface SidecarManifestInput {
  projectId: string;
  projectTitle: string | null;
  slug: string;
  durationSeconds: number;
  plan: SubtitlePlan;
  cueSource: string;
  timelineDurationMs: number;
  beats: readonly ChapterBeat[];
  thumbnail: { present: boolean; assetId: string | null; name: string | null; widthPx: number | null; heightPx: number | null; status: string | null } ;
  metadata: MetadataSidecarInput;
}

export interface SidecarManifest {
  format: string;
  version: number;
  projectId: string;
  projectTitle: string | null;
  slug: string;
  durationSeconds: number;
  files: SidecarFile[];
  fileCount: number;
  counts: { exists: number; requiresGeneration: number; empty: number };
  subtitles: SubtitleSidecar;
  chapters: ChapterPlan;
  metadata: MetadataSidecar;
  thumbnail: Record<string, unknown>;
  filesProduced: 0;
  produced: false;
  notProduced: string[];
  note: string;
}

/** What a sidecar set does NOT produce, stated on every manifest. */
export const SIDECARS_NOT_PRODUCED = [
  "no sidecar file was written to disk, to object storage or to the export queue — 0 bytes were written",
  "no subtitle file was muxed into any container",
  "no chapter block was written into a description or uploaded to a platform",
  "no thumbnail was generated, cropped, text-composited or uploaded",
  "no metadata was submitted to any platform",
];

function clip(content: string): { content: string; truncated: boolean; bytes: number } {
  const bytes = byteLength(content);
  if (content.length <= MAX_SIDECAR_CHARS) return { content, truncated: false, bytes };
  return {
    content: content.slice(0, MAX_SIDECAR_CHARS) +
      `\n\n[...truncated: this render is ${bytes} bytes and the response carries the first ${MAX_SIDECAR_CHARS} characters. ` +
      "The file itself was not written.]",
    truncated: true,
    bytes,
  };
}

/**
 * Assemble the sidecar deliverables for a project. Pure: same input, same output.
 * `contentState` is derived from the CONTENT, never from the ambition to have it.
 */
export function buildSidecarManifest(input: SidecarManifestInput): SidecarManifest {
  const subtitles = buildSubtitleSidecar({
    plan: input.plan,
    timelineDurationMs: input.timelineDurationMs,
    cueSource: input.cueSource,
  });
  const chapters = buildChapterPlan(input.beats);
  const metadata = buildMetadataSidecar(input.metadata);

  const subtitleState: SidecarContentState = subtitles.hasCues ? "exists" : "empty";
  const chapterState: SidecarContentState = chapters.count > 0 ? "exists" : "empty";
  const thumbnailState: SidecarContentState = input.thumbnail.present ? "exists" : "requires-generation";
  const metadataState: SidecarContentState =
    metadata.title || metadata.description || metadata.tags ? "exists" : "requires-generation";

  const srt = clip(subtitles.srt);
  const vtt = clip(subtitles.vtt);
  const meta = clip(metadata.json);
  // Which metadata fields the project genuinely does not hold. A slot that is
  // half filled is reported as PARTIAL rather than rounded up to "exists".
  const metaMissingFields: string[] = [];
  if (!metadata.title) metaMissingFields.push("title");
  if (!metadata.description) metaMissingFields.push("description");
  if (!metadata.tags) metaMissingFields.push("tags");

  const files: SidecarFile[] = [
    {
      id: "subtitles-srt",
      label: "Subtitle sidecar (SRT)",
      fileName: subtitles.hasCues ? `${input.slug}.srt` : null,
      mimeType: "application/x-subrip",
      container: "text file, UTF-8",
      contentState: subtitleState,
      requires: subtitles.hasCues
        ? null
        : "Narration on the project's scenes (the subtitle engine builds cues from scene narration and the timeline's scene windows), or a speech-to-text provider for the recorded audio",
      requiresEnv: subtitles.hasCues ? null : "TRANSCRIPTION_API_KEY",
      content: subtitles.hasCues ? srt.content : null,
      bytes: subtitles.hasCues ? srt.bytes : null,
      truncated: srt.truncated,
      produced: false,
      detail: {
        cueCount: subtitles.cueCount,
        timecodeFormat: SIDECAR_TIME_FORMATS.srt,
        totalCueDurationMs: subtitles.totalCueDurationMs,
        firstCueStartMs: subtitles.firstCueStartMs,
        lastCueEndMs: subtitles.lastCueEndMs,
        outsideTimeline: subtitles.outsideTimeline,
        cueSource: subtitles.cueSource,
      },
      note: subtitles.note,
    },
    {
      id: "subtitles-vtt",
      label: "Subtitle sidecar (WebVTT)",
      fileName: subtitles.hasCues ? `${input.slug}.vtt` : null,
      mimeType: "text/vtt",
      container: "text file, UTF-8",
      contentState: subtitleState,
      requires: subtitles.hasCues ? null : "The same cue source as the SRT sidecar",
      requiresEnv: subtitles.hasCues ? null : "TRANSCRIPTION_API_KEY",
      content: subtitles.hasCues ? vtt.content : null,
      bytes: subtitles.hasCues ? vtt.bytes : null,
      truncated: vtt.truncated,
      produced: false,
      detail: {
        cueCount: subtitles.cueCount,
        timecodeFormat: SIDECAR_TIME_FORMATS.vtt,
        srtAndVttCueParity: true,
      },
      note: subtitles.hasCues
        ? `Same ${subtitles.cueCount} cue(s) as the SRT file, in WebVTT timecode (${SIDECAR_TIME_FORMATS.vtt}).`
        : "No cues exist, so there is nothing to deliver in WebVTT.",
    },
    {
      id: "chapters",
      label: "Chapter markers",
      fileName: chapters.count > 0 ? `${input.slug}-chapters.txt` : null,
      mimeType: "text/plain",
      container: "text file, UTF-8 (the block the description would carry)",
      contentState: chapterState,
      requires:
        chapters.count > 0
          ? null
          : "Scene beats on the editor timeline (chapter markers are derived from the project's real scene structure)",
      requiresEnv: null,
      content: chapters.count > 0 ? clip(chapters.block).content : null,
      bytes: chapters.count > 0 ? byteLength(chapters.block) : null,
      truncated: false,
      produced: false,
      detail: {
        count: chapters.count,
        beatCount: chapters.beatCount,
        firstStartsAtZero: chapters.firstStartsAtZero,
        meetsYoutubeRequirements: chapters.meetsYoutubeRequirements,
        blockers: chapters.blockers,
        coveredSeconds: chapters.coveredSeconds,
        rules: chapters.rules,
      },
      note: chapters.note,
    },
    {
      id: "thumbnail",
      label: "Thumbnail",
      fileName: input.thumbnail.present ? `${input.slug}-thumbnail` : null,
      mimeType: "image/* (the asset's own type)",
      container: "image file the project already holds",
      contentState: thumbnailState,
      requires: input.thumbnail.present
        ? null
        : "A thumbnail image for the project — generated by the Thumbnail Generator (provider-gated) or uploaded by the user",
      requiresEnv: input.thumbnail.present ? null : "IMAGE_PROVIDER_API_KEY",
      content: null,
      bytes: null,
      truncated: false,
      produced: false,
      detail: {
        selected: input.thumbnail.present,
        assetId: input.thumbnail.assetId,
        name: input.thumbnail.name,
        widthPx: input.thumbnail.widthPx,
        heightPx: input.thumbnail.heightPx,
        status: input.thumbnail.status,
      },
      note: input.thumbnail.present
        ? `The project's own thumbnail asset would be delivered (${input.thumbnail.name ?? "unnamed asset"}). No image was generated, cropped or modified here.`
        : "NO THUMBNAIL SELECTED. Nothing was fabricated to fill the slot — the platform would pick a frame from the video.",
    },
    {
      id: "metadata",
      label: "Metadata sidecar (JSON)",
      fileName: `${input.slug}-metadata.json`,
      mimeType: "application/json",
      container: "text file, UTF-8",
      contentState: metadataState,
      requires:
        metadataState !== "exists"
          ? "Title, description and tags for the project — the SEO surface and its provider generate them"
          : metaMissingFields.length === 0
            ? null
            : `PARTIAL: the project stores no ${metaMissingFields.join(", no ")}. The fields this JSON does carry are the project's ` +
              "own stored text; the missing ones stay null and would be generated by the SEO surface and its provider",
      requiresEnv: metadataState === "exists" && metaMissingFields.length === 0 ? null : "LLM_PROVIDER_API_KEY",
      content: meta.content,
      bytes: meta.bytes,
      truncated: meta.truncated,
      produced: false,
      detail: {
        counts: metadata.counts,
        sources: metadata.sources,
        limitCount: metadata.limits.length,
        checks: metadata.checks,
        /** Fields the project genuinely does not hold — the entry is PARTIAL when this is non-empty. */
        missingFields: metaMissingFields,
        partial: metaMissingFields.length > 0,
      },
      note: metadata.note,
    },
  ];

  const counts = {
    exists: files.filter((f) => f.contentState === "exists").length,
    requiresGeneration: files.filter((f) => f.contentState === "requires-generation").length,
    empty: files.filter((f) => f.contentState === "empty").length,
  };

  return {
    format: SIDECAR_MANIFEST_FORMAT,
    version: SIDECAR_MANIFEST_VERSION,
    projectId: input.projectId,
    projectTitle: input.projectTitle ?? null,
    slug: input.slug,
    durationSeconds: input.durationSeconds,
    files,
    fileCount: files.length,
    counts,
    subtitles,
    chapters,
    metadata,
    thumbnail: files.find((f) => f.id === "thumbnail")?.detail ?? {},
    filesProduced: 0,
    produced: false,
    notProduced: [...SIDECARS_NOT_PRODUCED],
    note:
      `Sidecar deliverables: ${files.length} slot(s) — ${counts.exists} with real content from data the project already holds, ` +
      `${counts.requiresGeneration} that would require generation, ${counts.empty} genuinely empty. ` +
      (metaMissingFields.length > 0
        ? `The metadata sidecar is PARTIAL (the project stores no ${metaMissingFields.join(", no ")}) — the fields it carries are real, ` +
          "the rest are reported as needing generation. "
        : "") +
      `Subtitle cues: ${subtitles.cueCount} (${humanDuration(subtitles.totalCueDurationMs / 1000)} of cue time). ` +
      `Chapters: ${chapters.count}${chapters.meetsYoutubeRequirements ? "" : " (published requirements NOT met — see blockers)"}. ` +
      "No sidecar file was written and no content was invented to fill a slot.",
  };
}
