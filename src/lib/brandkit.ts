/**
 * Phase 3 — Brand Kit foundation.
 *
 * One persistent, per-tenant brand identity that feeds forward into the rest
 * of the pipeline. A kit holds REAL user data only: brand name, logo / intro /
 * outro / watermark assets, a color palette, fonts, and default preferences
 * for voice, subtitles, music and thumbnails. It is CRUD **CRUD + auto-apply**:
 *
 *   - `getBrandKit` / `upsertBrandKit` / `deleteBrandKit` — tenant-scoped rows.
 *   - `buildBrandDefaultsPatch(kit)` — the settings a kit implies, in the
 *     exact shape the project settings / wizard expects (pure, tested).
 *   - `mergeBrandKitIntoSettings(kit, existing)` — apply a kit to a project's
 *     settings with "explicit project settings win" semantics (pure, tested).
 *   - `applyBrandKitToProject` — persists the merge to the real DB through the
 *     project auto-save path (so version history is preserved).
 *
 * Nothing here fakes AI: asset uploads are real (signed-URL media upload), and
 * any provider-dependent "generate a logo" action is deliberately out of scope
 * here (that's the orchestrator's job and would honestly report
 * "Provider Not Connected").
 */
import { Prisma } from "@prisma/client";
import { ApiError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getUploadReadUrl } from "@/lib/media/uploads";
import {
  getOwnedProject,
  updateProjectAndVersion,
  type ProjectPatch,
} from "@/lib/projects";
// Option vocabulary (pure constants — re-exported below for existing refs).
import {
  BRAND_FONTS,
  MUSIC_GENRES,
  MUSIC_MOODS,
  SUBTITLE_POSITIONS,
  SUBTITLE_STYLES,
  THUMBNAIL_LAYOUTS,
  THUMBNAIL_TEMPLATES,
  VOICE_GENDERS,
  VOICE_LANGUAGES,
  VOICE_TONES,
} from "@/lib/brandkit-options";
export {
  BRAND_FONTS,
  MUSIC_GENRES,
  MUSIC_MOODS,
  SUBTITLE_POSITIONS,
  SUBTITLE_STYLES,
  THUMBNAIL_LAYOUTS,
  THUMBNAIL_TEMPLATES,
  VOICE_GENDERS,
  VOICE_LANGUAGES,
  VOICE_TONES,
};

// ---------------------------------------------------------------------------
// Types — the user-facing kit shape (JSON-serializable, client-safe)
// ---------------------------------------------------------------------------
export interface BrandColors {
  primary?: string;
  secondary?: string;
  accent?: string;
  background?: string;
  text?: string;
}
export interface BrandFonts {
  heading?: string;
  body?: string;
}
export interface VoicePreferences {
  language?: string;
  gender?: string;
  tone?: string;
  sampleRate?: number;
  pitch?: number;
  speed?: number;
}
export interface SubtitlePreferences {
  style?: string;
  position?: string;
  size?: number;
  color?: string;
  font?: string;
}
export interface MusicPreferences {
  mood?: string;
  genre?: string;
  energy?: number;
  volume?: number;
}
export interface ThumbnailPreferences {
  template?: string;
  textOverlay?: string;
  layout?: string;
  colors?: BrandColors;
}
/** Shape returned by the API / passed to the client editor. */
export interface BrandKitApi {
  id: string;
  name: string;
  colors: BrandColors | null;
  fonts: BrandFonts | null;
  voicePreferences: VoicePreferences | null;
  subtitlePreferences: SubtitlePreferences | null;
  musicPreferences: MusicPreferences | null;
  thumbnailPreferences: ThumbnailPreferences | null;
  logoAssetId: string | null;
  logoUrl: string | null;
  watermark: { enabled: boolean; assetId: string | null; url: string | null };
  intro: {
    assetId: string | null;
    durationSeconds: number | null;
    url: string | null;
  };
  outro: {
    assetId: string | null;
    durationSeconds: number | null;
    url: string | null;
  };
}
/** Input accepted by `upsertBrandKit` (partial update semantics). */
export interface BrandKitInput {
  name?: string;
  colors?: BrandColors | null;
  fonts?: BrandFonts | null;
  voicePreferences?: VoicePreferences | null;
  subtitlePreferences?: SubtitlePreferences | null;
  musicPreferences?: MusicPreferences | null;
  thumbnailPreferences?: ThumbnailPreferences | null;
  logoAssetId?: string | null;
  watermark?: { enabled?: boolean; assetId?: string | null };
  intro?: { assetId?: string | null; durationSeconds?: number | null };
  outro?: { assetId?: string | null; durationSeconds?: number | null };
}

// KV = a kit "row-like" value with JSON preference columns + media ids.
export type KitLike = {
  name: string;
  colors: Prisma.JsonValue | null;
  fonts: Prisma.JsonValue | null;
  voicePreferences: Prisma.JsonValue | null;
  subtitlePreferences: Prisma.JsonValue | null;
  musicPreferences: Prisma.JsonValue | null;
  thumbnailPreferences: Prisma.JsonValue | null;
  logoAssetId: string | null;
  introAssetId: string | null;
  outroAssetId: string | null;
  watermarkAssetId: string | null;
  watermarkEnabled: boolean;
  introDurationSeconds: number | null;
  outroDurationSeconds: number | null;
};

// ---------------------------------------------------------------------------
// Low-level JSON helpers (pure)
// ---------------------------------------------------------------------------
function asObj(v: Prisma.JsonValue | null | undefined): Record<string, unknown> {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return {};
}
function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function pickDefined(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) {
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out;
}
function hasAny(o: Record<string, unknown>): boolean {
  return Object.values(o).some((v) => v !== undefined && v !== null);
}
const HEX = /^#([0-9a-f]{6})$/;
/** Normalize a hex color (accepts #rgb / #rrggbb) → lowercase #rrggbb, else undefined. */
export function normalizeHex(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  let s = value.trim();
  if (/^#([0-9a-f]{3})$/i.test(s)) {
    s = `#${s.slice(1).split("").map((c) => c + c).join("")}`;
  }
  return HEX.test(s.toLowerCase()) ? s.toLowerCase() : undefined;
}
/** Deep-equality for plain JSON values (used to avoid no-op version bumps). */
export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isObj(a) && isObj(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => deepEqual(a[k], b[k]));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Validation — parse + normalize an incoming kit patch (throws 400 on error)
// ---------------------------------------------------------------------------
function str(v: unknown, field: string, max = 200): string {
  if (typeof v !== "string") throw new ApiError(400, `Field "${field}" must be a string.`, "bad_input");
  return v.trim().slice(0, max);
}
function nullableId(v: unknown, field: string): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string" || !v.trim()) return null;
  return v.trim();
}
function num(v: unknown, field: string, min: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) {
    throw new ApiError(400, `Field "${field}" must be a number between ${min} and ${max}.`, "bad_input");
  }
  return n;
}
function pick<T extends string>(v: unknown, field: string, allowed: readonly T[]): T | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string" || !(allowed as readonly string[]).includes(v)) {
    throw new ApiError(400, `Field "${field}" must be one of: ${allowed.join(", ")}.`, "bad_input");
  }
  return v as T;
}
function parseColors(v: unknown, field: string): BrandColors | null {
  if (v === null) return null;
  if (!isObj(v)) throw new ApiError(400, `Field "${field}" must be an object.`, "bad_input");
  const out: BrandColors = {};
  for (const key of ["primary", "secondary", "accent", "background", "text"] as const) {
    const hex = normalizeHex(v[key]);
    if (hex) out[key] = hex;
    else if (v[key] !== undefined && v[key] !== null) {
      throw new ApiError(400, `Field "${field}.${key}" must be a valid hex color.`, "bad_input");
    }
  }
  return out;
}
function parseFonts(v: unknown): BrandFonts | null {
  if (v === null) return null;
  if (!isObj(v)) throw new ApiError(400, "Field \"fonts\" must be an object.", "bad_input");
  const out: BrandFonts = {};
  if (v.heading !== undefined && v.heading !== null) out.heading = str(v.heading, "fonts.heading");
  if (v.body !== undefined && v.body !== null) out.body = str(v.body, "fonts.body");
  return out;
}
function parseVoice(v: unknown): VoicePreferences | null {
  if (v === null) return null;
  if (!isObj(v)) throw new ApiError(400, "Field \"voicePreferences\" must be an object.", "bad_input");
  const out: VoicePreferences = {};
  if (v.language !== undefined && v.language !== null) out.language = pick(v.language, "voicePreferences.language", VOICE_LANGUAGES);
  if (v.gender !== undefined && v.gender !== null) out.gender = pick(v.gender, "voicePreferences.gender", VOICE_GENDERS);
  if (v.tone !== undefined && v.tone !== null) out.tone = pick(v.tone, "voicePreferences.tone", VOICE_TONES);
  if (v.sampleRate !== undefined && v.sampleRate !== null) out.sampleRate = num(v.sampleRate, "voicePreferences.sampleRate", 8000, 48000);
  if (v.pitch !== undefined && v.pitch !== null) out.pitch = num(v.pitch, "voicePreferences.pitch", 0.5, 2);
  if (v.speed !== undefined && v.speed !== null) out.speed = num(v.speed, "voicePreferences.speed", 0.5, 2);
  return out;
}
function parseSubtitles(v: unknown): SubtitlePreferences | null {
  if (v === null) return null;
  if (!isObj(v)) throw new ApiError(400, "Field \"subtitlePreferences\" must be an object.", "bad_input");
  const out: SubtitlePreferences = {};
  if (v.style !== undefined && v.style !== null) out.style = pick(v.style, "subtitlePreferences.style", SUBTITLE_STYLES);
  if (v.position !== undefined && v.position !== null) out.position = pick(v.position, "subtitlePreferences.position", SUBTITLE_POSITIONS);
  if (v.size !== undefined && v.size !== null) out.size = num(v.size, "subtitlePreferences.size", 8, 200);
  const color = normalizeHex(v.color);
  if (color) out.color = color;
  else if (v.color !== undefined && v.color !== null) throw new ApiError(400, "Field \"subtitlePreferences.color\" must be a valid hex color.", "bad_input");
  if (v.font !== undefined && v.font !== null) out.font = str(v.font, "subtitlePreferences.font");
  return out;
}
function parseMusic(v: unknown): MusicPreferences | null {
  if (v === null) return null;
  if (!isObj(v)) throw new ApiError(400, "Field \"musicPreferences\" must be an object.", "bad_input");
  const out: MusicPreferences = {};
  if (v.mood !== undefined && v.mood !== null) out.mood = pick(v.mood, "musicPreferences.mood", MUSIC_MOODS);
  if (v.genre !== undefined && v.genre !== null) out.genre = pick(v.genre, "musicPreferences.genre", MUSIC_GENRES);
  if (v.energy !== undefined && v.energy !== null) out.energy = num(v.energy, "musicPreferences.energy", 0, 100);
  if (v.volume !== undefined && v.volume !== null) out.volume = num(v.volume, "musicPreferences.volume", 0, 100);
  return out;
}
function parseThumbnails(v: unknown): ThumbnailPreferences | null {
  if (v === null) return null;
  if (!isObj(v)) throw new ApiError(400, "Field \"thumbnailPreferences\" must be an object.", "bad_input");
  const out: ThumbnailPreferences = {};
  if (v.template !== undefined && v.template !== null) out.template = pick(v.template, "thumbnailPreferences.template", THUMBNAIL_TEMPLATES);
  if (v.layout !== undefined && v.layout !== null) out.layout = pick(v.layout, "thumbnailPreferences.layout", THUMBNAIL_LAYOUTS);
  if (v.textOverlay !== undefined && v.textOverlay !== null) out.textOverlay = str(v.textOverlay, "thumbnailPreferences.textOverlay", 200);
  if (v.colors !== undefined && v.colors !== null) out.colors = parseColors(v.colors, "thumbnailPreferences.colors") ?? undefined;
  return out;
}
function parseDuration(v: unknown, field: string): number | null {
  if (v === null) return null;
  return num(v, field, 0, 120);
}
/** Validate + normalize an incoming kit body (partial update safe). */
export function parseBrandKitInput(body: unknown): BrandKitInput {
  if (!isObj(body)) throw new ApiError(400, "Body must be a JSON object.", "bad_input");
  const raw = body;
  const out: BrandKitInput = {};
  if (raw.name !== undefined) out.name = str(raw.name, "name", 120) || "Default";
  if (raw.colors !== undefined) out.colors = parseColors(raw.colors, "colors");
  if (raw.fonts !== undefined) out.fonts = parseFonts(raw.fonts);
  if (raw.voicePreferences !== undefined) out.voicePreferences = parseVoice(raw.voicePreferences);
  if (raw.subtitlePreferences !== undefined) out.subtitlePreferences = parseSubtitles(raw.subtitlePreferences);
  if (raw.musicPreferences !== undefined) out.musicPreferences = parseMusic(raw.musicPreferences);
  if (raw.thumbnailPreferences !== undefined) out.thumbnailPreferences = parseThumbnails(raw.thumbnailPreferences);
  if (raw.logoAssetId !== undefined) out.logoAssetId = nullableId(raw.logoAssetId, "logoAssetId");
  if (raw.watermark !== undefined) {
    if (raw.watermark === null) out.watermark = { assetId: null };
    else if (isObj(raw.watermark)) {
      out.watermark = {
        enabled: raw.watermark.enabled === undefined ? undefined : Boolean(raw.watermark.enabled),
        assetId: nullableId(raw.watermark.assetId, "watermark.assetId"),
      };
    } else throw new ApiError(400, "Field \"watermark\" must be an object.", "bad_input");
  }
  if (raw.intro !== undefined) {
    if (raw.intro === null) out.intro = { assetId: null };
    else if (isObj(raw.intro)) {
      out.intro = {
        assetId: nullableId(raw.intro.assetId, "intro.assetId"),
        durationSeconds: raw.intro.durationSeconds === undefined ? undefined : parseDuration(raw.intro.durationSeconds, "intro.durationSeconds"),
      };
    } else throw new ApiError(400, "Field \"intro\" must be an object.", "bad_input");
  }
  if (raw.outro !== undefined) {
    if (raw.outro === null) out.outro = { assetId: null };
    else if (isObj(raw.outro)) {
      out.outro = {
        assetId: nullableId(raw.outro.assetId, "outro.assetId"),
        durationSeconds: raw.outro.durationSeconds === undefined ? undefined : parseDuration(raw.outro.durationSeconds, "outro.durationSeconds"),
      };
    } else throw new ApiError(400, "Field \"outro\" must be an object.", "bad_input");
  }
  return out;
}

// ---------------------------------------------------------------------------
// Settings mapping (pure) — build the project-settings shape a kit implies
// ---------------------------------------------------------------------------
/** The settings block a kit implies (used to seed a fresh project). */
export type BrandSettingsPatch = {
  language?: string;
  voiceoverDefaults?: Record<string, unknown>;
  subtitleDefaults?: Record<string, unknown>;
  musicDefaults?: Record<string, unknown>;
  extra?: Record<string, unknown>;
};

/** Kit JSON preferences → an isolated project-settings block (no merging). */
export function buildBrandDefaultsPatch(kit: KitLike): BrandSettingsPatch {
  const voice = asObj(kit.voicePreferences);
  const subs = asObj(kit.subtitlePreferences);
  const music = asObj(kit.musicPreferences);
  const thumb = asObj(kit.thumbnailPreferences);
  const colors = asObj(kit.colors);
  const fonts = asObj(kit.fonts);
  const patch: BrandSettingsPatch = {};
  if (typeof voice.language === "string" && voice.language) patch.language = voice.language;
  const voiceDefaults = pickDefined({
    language: voice.language,
    gender: voice.gender,
    tone: voice.tone,
    sampleRate: voice.sampleRate,
    pitch: voice.pitch,
    speed: voice.speed,
  });
  if (hasAny(voiceDefaults)) patch.voiceoverDefaults = voiceDefaults;
  const subDefaults = pickDefined({
    style: subs.style,
    position: subs.position,
    size: subs.size,
    color: subs.color,
    font: subs.font,
  });
  if (hasAny(subDefaults)) patch.subtitleDefaults = subDefaults;
  const musicDefaults = pickDefined({
    mood: music.mood,
    genre: music.genre,
    energy: music.energy,
    volume: music.volume,
  });
  if (hasAny(musicDefaults)) patch.musicDefaults = musicDefaults;
  const brand: Record<string, unknown> = {};
  const c = pickDefined(colors);
  if (hasAny(c)) brand.colors = c;
  const f = pickDefined(fonts);
  if (hasAny(f)) brand.fonts = f;
  if (kit.watermarkEnabled || kit.watermarkAssetId || kit.logoAssetId) {
    brand.watermark = {
      enabled: kit.watermarkEnabled,
      assetId: kit.watermarkAssetId ?? undefined,
      logoAssetId: kit.logoAssetId ?? undefined,
    };
  }
  if (kit.introAssetId || kit.introDurationSeconds != null) {
    brand.intro = {
      assetId: kit.introAssetId ?? undefined,
      durationSeconds: kit.introDurationSeconds ?? undefined,
    };
  }
  if (kit.outroAssetId || kit.outroDurationSeconds != null) {
    brand.outro = {
      assetId: kit.outroAssetId ?? undefined,
      durationSeconds: kit.outroDurationSeconds ?? undefined,
    };
  }
  const t = pickDefined(thumb);
  if (hasAny(t)) brand.thumbnail = t;
  if (Object.keys(brand).length) patch.extra = { brand };
  return patch;
}

// -- merge helpers for apply (explicit project settings win) ----------------
function mergeFlat(kitObj: Record<string, unknown> | undefined, existingObj: Record<string, unknown>): Record<string, unknown> {
  const out = { ...(kitObj ?? {}) };
  for (const [k, v] of Object.entries(existingObj)) {
    if (v === undefined || v === null) continue; // nothing explicit → kit wins
    out[k] = v; // project's explicit value wins
  }
  return pickDefined(out);
}
/** Merge the kit's brand block into the project's existing extra.brand. */
export function mergeBrandBlock(
  kitExtra: Record<string, unknown> | undefined,
  existingExtra: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  const kitBrand = (kitExtra?.brand && isObj(kitExtra.brand)) ? (kitExtra.brand as Record<string, unknown>) : {};
  const exBrand = (existingExtra?.brand && isObj(existingExtra.brand)) ? (existingExtra.brand as Record<string, unknown>) : {};
  if (!hasAny(kitBrand) && !hasAny(exBrand)) return undefined;
  const brand: Record<string, unknown> = { ...kitBrand };
  for (const [k, v] of Object.entries(exBrand)) {
    if (v === undefined || v === null) continue;
    if (k === "colors" || k === "fonts" || k === "thumbnail") {
      const base = (brand[k] && isObj(brand[k])) ? (brand[k] as Record<string, unknown>) : {};
      const ex = v as Record<string, unknown>;
      brand[k] = mergeFlat(base, ex);
    } else {
      brand[k] = v; // watermark / intro / outro: project explicit wins wholesale
    }
  }
  return Object.keys(brand).length ? { brand: pickDefined(brand) } : undefined;
}

/** Existing projects' settings (projectId omitted — merge is key-based). */
export type ProjectSettingsLike = {
  language: string | null;
  voiceoverDefaults: Prisma.JsonValue | null;
  subtitleDefaults: Prisma.JsonValue | null;
  musicDefaults: Prisma.JsonValue | null;
  seoDefaults?: Prisma.JsonValue | null;
  extra: Prisma.JsonValue | null;
} | null;

/**
 * Build a settings patch that applies a kit to a project's existing settings.
 * Project-explicit values win; kit defaults fill the gaps. Only fields that
 * actually change are returned (so a no-op apply writes no version snapshot).
 */
export function mergeBrandKitIntoSettings(
  kit: KitLike,
  existing: ProjectSettingsLike,
): BrandSettingsPatch {
  const desired = buildBrandDefaultsPatch(kit);
  const out: BrandSettingsPatch = {};
  const ex = (existing ?? {}) as Record<string, unknown>;
  // language: the column default "en" is not an explicit choice → kit may win.
  const wantLang = desired.language;
  if (wantLang !== undefined) {
    const have = ex.language;
    const explicit = typeof have === "string" && have.length > 0 && have !== "en";
    const effective = explicit ? have : wantLang;
    if (effective !== (typeof have === "string" ? have : null)) out.language = effective;
  }
  // voice/subtitle/music: per-key merge where project explicit values win.
  // Only write when the merged result actually differs from what's stored,
  // so a no-op apply is a true no-op (no spurious version snapshot).
  for (const key of ["voiceoverDefaults", "subtitleDefaults", "musicDefaults"] as const) {
    const want = desired[key];
    if (!want || typeof want !== "object") continue;
    const existingRaw = ex[key] as Prisma.JsonValue | null | undefined;
    const effective = mergeFlat(want as Record<string, unknown>, asObj(existingRaw ?? null));
    if (Object.keys(effective).length === 0) continue;
    const existingPlain = existingRaw === null || existingRaw === undefined ? null : asObj(existingRaw);
    if (existingPlain !== null && deepEqual(effective, existingPlain)) continue; // no-op
    out[key] = effective;
  }
  // extra.brand: project brand values win; same idempotency guard.
  const existingExtraRaw = ex.extra as Prisma.JsonValue | null | undefined;
  const mergedExtra = mergeBrandBlock(desired.extra, asObj(existingExtraRaw ?? null));
  if (mergedExtra) {
    const existingPlain = existingExtraRaw === null || existingExtraRaw === undefined ? null : asObj(existingExtraRaw);
    if (existingPlain === null || !deepEqual(mergedExtra, existingPlain)) out.extra = mergedExtra;
  }
  return out;
}

// ---------------------------------------------------------------------------
// DB layer (tenant-scoped CRUD)
// ---------------------------------------------------------------------------
export type BrandKitRow = Prisma.BrandKitGetPayload<{}>;

export async function getBrandKit(userId: string): Promise<BrandKitRow | null> {
  return prisma.brandKit.findFirst({ where: { userId } });
}

/** Insert-or-update the user's single kit (userId is the tenant key). */
export async function upsertBrandKit(userId: string, input: BrandKitInput): Promise<BrandKitRow> {
  const existing = await getBrandKit(userId);
  const data: Prisma.BrandKitUncheckedUpdateInput = {
    name: input.name ?? undefined,
    logoAssetId: input.logoAssetId === undefined ? undefined : input.logoAssetId ?? null,
  };
  type JsonField = "colors" | "fonts" | "voicePreferences" | "subtitlePreferences" | "musicPreferences" | "thumbnailPreferences";
  // Keep JSON merge logic explicit per field.
  const setJson = (
    field: JsonField,
    patch: Record<string, unknown> | null | undefined,
    existingVal: Prisma.JsonValue | null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ) => {
    if (patch === undefined) return;
    if (patch === null) {
      (data as unknown as Record<string, unknown>)[field] = Prisma.JsonNull;
      return;
    }
    const merged = mergeFlat(patch, asObj(existingVal));
    (data as unknown as Record<string, unknown>)[field] = merged as Prisma.InputJsonValue;
  };
  setJson("colors", input.colors as Record<string, unknown> | null | undefined, existing?.colors ?? null);
  setJson("fonts", input.fonts as Record<string, unknown> | null | undefined, existing?.fonts ?? null);
  setJson("voicePreferences", input.voicePreferences as Record<string, unknown> | null | undefined, existing?.voicePreferences ?? null);
  setJson("subtitlePreferences", input.subtitlePreferences as Record<string, unknown> | null | undefined, existing?.subtitlePreferences ?? null);
  setJson("musicPreferences", input.musicPreferences as Record<string, unknown> | null | undefined, existing?.musicPreferences ?? null);
  setJson("thumbnailPreferences", input.thumbnailPreferences as Record<string, unknown> | null | undefined, existing?.thumbnailPreferences ?? null);
  if (input.watermark?.enabled !== undefined) data.watermarkEnabled = input.watermark.enabled;
  if (input.watermark?.assetId !== undefined) data.watermarkAssetId = input.watermark.assetId ?? null;
  if (input.intro?.assetId !== undefined) data.introAssetId = input.intro.assetId ?? null;
  if (input.intro?.durationSeconds !== undefined) data.introDurationSeconds = input.intro.durationSeconds ?? null;
  if (input.outro?.assetId !== undefined) data.outroAssetId = input.outro.assetId ?? null;
  if (input.outro?.durationSeconds !== undefined) data.outroDurationSeconds = input.outro.durationSeconds ?? null;

  if (existing) {
    return prisma.brandKit.update({ where: { id: existing.id }, data });
  }
  const createData: Prisma.BrandKitUncheckedCreateInput = { userId };
  Object.assign(createData, data);
  return prisma.brandKit.create({ data: createData });
}

/** Delete the user's kit. Asset refs & project links are set null (FK). */
export async function deleteBrandKit(userId: string): Promise<void> {
  const existing = await getBrandKit(userId);
  if (existing) await prisma.brandKit.delete({ where: { id: existing.id } });
}

/** Resolve fresh signed read URLs for a kit's assets (errors → undefined). */
export async function resolveKitAssetUrls(
  userId: string,
  kit: BrandKitRow,
): Promise<{ logo?: string; intro?: string; outro?: string; watermark?: string }> {
  const tryUrl = async (id: string | null): Promise<string | undefined> => {
    if (!id) return undefined;
    try {
      return (await getUploadReadUrl(userId, id)) ?? undefined;
    } catch {
      return undefined;
    }
  };
  const [logo, intro, outro, watermark] = await Promise.all([
    tryUrl(kit.logoAssetId),
    tryUrl(kit.introAssetId),
    tryUrl(kit.outroAssetId),
    tryUrl(kit.watermarkAssetId),
  ]);
  return { logo, intro, outro, watermark };
}

/** Map a kit row to the client/API shape (with resolved asset read URLs). */
export function toBrandKitApi(row: BrandKitRow, urls: { logo?: string; intro?: string; outro?: string; watermark?: string } = {}): BrandKitApi {
  return {
    id: row.id,
    name: row.name,
    colors: row.colors ? (asObj(row.colors) as BrandColors) : null,
    fonts: row.fonts ? (asObj(row.fonts) as BrandFonts) : null,
    voicePreferences: row.voicePreferences ? (asObj(row.voicePreferences) as VoicePreferences) : null,
    subtitlePreferences: row.subtitlePreferences ? (asObj(row.subtitlePreferences) as SubtitlePreferences) : null,
    musicPreferences: row.musicPreferences ? (asObj(row.musicPreferences) as MusicPreferences) : null,
    thumbnailPreferences: row.thumbnailPreferences ? (asObj(row.thumbnailPreferences) as ThumbnailPreferences) : null,
    logoAssetId: row.logoAssetId,
    logoUrl: urls.logo ?? null,
    watermark: {
      enabled: row.watermarkEnabled,
      assetId: row.watermarkAssetId,
      url: urls.watermark ?? null,
    },
    intro: {
      assetId: row.introAssetId,
      durationSeconds: row.introDurationSeconds ?? null,
      url: urls.intro ?? null,
    },
    outro: {
      assetId: row.outroAssetId,
      durationSeconds: row.outroDurationSeconds ?? null,
      url: urls.outro ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Auto-apply
// ---------------------------------------------------------------------------
/**
 * Persist a kit's defaults into an owned project's settings, using the SAME
 * auto-save path as the Create Video wizard (`updateProjectAndVersion`), so
 * project version history is preserved. Explicit project settings win. Also
 * links the project to the kit (brandKitId) for the forward pipeline.
 */
export async function applyBrandKitToProject(
  userId: string,
  projectId: string,
): Promise<{ applied: boolean; projectId: string; changed: boolean }> {
  const kit = await getBrandKit(userId);
  if (!kit) throw new ApiError(404, "Create a brand kit before applying it to a project.", "no_brand_kit");
  await getOwnedProject(userId, projectId);
  const existing = await prisma.projectSettings.findUnique({ where: { projectId } });
  const settingsPatch = mergeBrandKitIntoSettings(kit, existing as ProjectSettingsLike);
  // No-op guard: link the kit even if nothing to copy.
  await prisma.project.update({ where: { id: projectId }, data: { brandKitId: kit.id } });
  const patch: ProjectPatch = Object.keys(settingsPatch).length ? { settings: settingsPatch } : {};
  const result = patch.settings
    ? await updateProjectAndVersion(userId, projectId, patch)
    : { changed: false };
  return { applied: true, projectId, changed: result.changed };
}
