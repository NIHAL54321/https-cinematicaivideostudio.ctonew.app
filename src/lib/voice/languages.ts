/**
 * Phase 4 — Supported TTS languages.
 *
 * Curated list bundled with the app. The catalog is additive: new languages
 * become available simply by appending entries here (and, for real synthesis,
 * by connecting a TTS provider that supports them — 50+ languages unlock
 * when a provider is connected).
 */

export interface SupportedLanguage {
  code: string;
  name: string;
  nativeName?: string;
}

export const SUPPORTED_LANGUAGES: SupportedLanguage[] = [
  { code: "en", name: "English", nativeName: "English" },
  { code: "es", name: "Spanish", nativeName: "Español" },
  { code: "fr", name: "French", nativeName: "Français" },
  { code: "de", name: "German", nativeName: "Deutsch" },
  { code: "it", name: "Italian", nativeName: "Italiano" },
  { code: "pt", name: "Portuguese", nativeName: "Português" },
  { code: "nl", name: "Dutch", nativeName: "Nederlands" },
  { code: "pl", name: "Polish", nativeName: "Polski" },
  { code: "ru", name: "Russian", nativeName: "Русский" },
  { code: "uk", name: "Ukrainian", nativeName: "Українська" },
  { code: "tr", name: "Turkish", nativeName: "Türkçe" },
  { code: "ar", name: "Arabic", nativeName: "العربية" },
  { code: "hi", name: "Hindi", nativeName: "हिन्दी" },
  { code: "bn", name: "Bengali", nativeName: "বাংলা" },
  { code: "ta", name: "Tamil", nativeName: "தமிழ்" },
  { code: "zh", name: "Chinese (Mandarin)", nativeName: "中文" },
  { code: "ja", name: "Japanese", nativeName: "日本語" },
  { code: "ko", name: "Korean", nativeName: "한국어" },
  { code: "id", name: "Indonesian", nativeName: "Bahasa Indonesia" },
  { code: "vi", name: "Vietnamese", nativeName: "Tiếng Việt" },
];

export function findLanguage(code: string | null | undefined): SupportedLanguage | null {
  if (!code) return null;
  const key = code.trim().toLowerCase();
  return SUPPORTED_LANGUAGES.find((l) => l.code.toLowerCase() === key) ?? null;
}

/** True when the code is in the bundled list (additive — extend the list to add more). */
export function isSupportedLanguage(code: string | null | undefined): boolean {
  return findLanguage(code) !== null;
}
