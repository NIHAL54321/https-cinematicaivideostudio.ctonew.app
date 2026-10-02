/**
 * Brand Kit select-option sets — PURE constants only, no server imports.
 *
 * Imported by both the server library (src/lib/brandkit.ts, which re-exports
 * them for validation) and the client editor (src/components/brand/*), so the
 * option vocabulary stays a single source of truth. Keep this file dependency
 * free — client components bundle it.
 */
export const BRAND_FONTS = ["Inter", "Space Grotesk", "System UI"] as const;
export const VOICE_LANGUAGES = ["en", "es", "fr", "de", "pt", "hi", "ja"] as const;
export const VOICE_GENDERS = ["female", "male", "neutral"] as const;
export const VOICE_TONES = ["warm", "bright", "serious", "energetic", "soft", "documentary"] as const;
export const SUBTITLE_STYLES = ["clean", "pop", "classic", "minimal"] as const;
export const SUBTITLE_POSITIONS = ["bottom", "top", "center"] as const;
export const MUSIC_MOODS = ["cinematic", "epic", "calm", "upbeat", "ambient", "tense"] as const;
export const MUSIC_GENRES = ["orchestral", "electronic", "lofi", "rock", "jazz", "world"] as const;
export const THUMBNAIL_TEMPLATES = ["dense", "clean", "bold", "minimal", "split"] as const;
export const THUMBNAIL_LAYOUTS = ["center", "left", "right", "stacked"] as const;