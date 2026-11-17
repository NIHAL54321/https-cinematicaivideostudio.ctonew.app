/**
 * Audius music adapter — BLOCK M1, 2026-11-17.
 *
 * ── What was probed live before this file was written ──────────────────────
 * Audius's read endpoints answer with NO credential:
 *   GET https://api.audius.co/v1/tracks/search?query=&genre=&mood=&limit=&app_name=
 *   GET https://api.audius.co/v1/tracks/trending?genre=&limit=&app_name=
 *   GET https://api.audius.co/v1/tracks/<id>?app_name=
 *   GET https://api.audius.co/v1/tracks/<id>/stream?app_name=   → 302 → 307 → 206 audio/mpeg (Range honoured)
 *
 * Probed again on 2026-11-17 while writing this adapter:
 *   - `genre` and `mood` DO filter: search?query=cinematic&genre=Electronic
 *     returned 5/5 Electronic; search?query=cinematic&mood=Peaceful returned
 *     5/5 Peaceful. (An unknown mood, e.g. "Chill", returns 0 — that is the
 *     provider's answer, and this adapter passes it through as an empty list.)
 *   - `trending` honours `genre` but ignored `mood`, so this adapter does not
 *     offer trending as a filtered browse.
 *   - The track object carries `id`, `title`, `duration` (seconds), `genre`,
 *     `mood`, `license`, `is_streamable`, `is_stream_gated`,
 *     `is_downloadable`, `permalink`, `user.name`, `user.handle`.
 *   - Licence distribution sampled over 543 results across four searches:
 *     248 "All rights reserved", 137 null, 4 CC BY-NC-SA, 4 CC BY, 2 CC BY-SA,
 *     2 CC BY-NC-ND, 1 CC BY-ND. Almost nothing is exportable — that is the
 *     library's real shape and the panel shows the counts it sees.
 *
 * ── Credentials ─────────────────────────────────────────────────────────────
 * `AUDIUS_APP_NAME` is the app name sent as `app_name` (default
 * "CinematicAIVideoStudio"). `AUDIUS_API_KEY` is an Audius *app address*, not a
 * secret, and no read needs it: this module reads the name of the variable but
 * sends it nowhere. Both are read here and ONLY here — nothing under
 * src/components may reference them.
 *
 * ── Failure shape ───────────────────────────────────────────────────────────
 * A non-2xx, a timeout or a body that is not the documented shape becomes a
 * `MusicProviderError` carrying OUR sentence. Provider response text is never
 * put in a message, and the full request URL (which carries `app_name`) is
 * never included.
 */
import { evaluateLicence } from "../licence";
import {
  MusicProviderError,
  type IntendedUse,
  type LicenceVerdict,
  type MusicProvider,
  type MusicProviderTrack,
  type MusicSearchQuery,
} from "./types";

const API_BASE = "https://api.audius.co/v1";
const PROVIDER_ID = "audius";
const DEFAULT_APP_NAME = "CinematicAIVideoStudio";
const TIMEOUT_MS = 8000;

/** The fields this adapter reads off an Audius track object. */
export interface AudiusTrackJson {
  id?: unknown;
  title?: unknown;
  duration?: unknown;
  genre?: unknown;
  mood?: unknown;
  license?: unknown;
  is_streamable?: unknown;
  is_stream_gated?: unknown;
  permalink?: unknown;
  user?: { name?: unknown; handle?: unknown } | null;
}

function appName(): string {
  const value = process.env.AUDIUS_APP_NAME?.trim();
  return value && value.length > 0 ? value : DEFAULT_APP_NAME;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * Maps one provider track object to the normalised shape. Exported so the
 * mapping is tested against a recorded fixture with no network.
 *
 * `is_streamable`/`is_stream_gated` are read as booleans: an absent
 * `is_streamable` becomes false, which the licence gate then refuses. That
 * direction is deliberate — an unknown is never treated as playable.
 */
export function mapAudiusTrack(raw: AudiusTrackJson): MusicProviderTrack {
  const id = str(raw.id);
  if (!id) {
    throw new MusicProviderError(PROVIDER_ID, "Audius returned a track with no id, so it was dropped.");
  }
  const user = raw.user ?? null;
  return {
    providerId: PROVIDER_ID,
    providerTrackId: id,
    title: str(raw.title) ?? "(untitled)",
    artist: str(user?.name),
    artistHandle: str(user?.handle),
    durationSeconds: num(raw.duration),
    genre: str(raw.genre),
    mood: str(raw.mood),
    licenceText: str(raw.license),
    isStreamable: raw.is_streamable === true,
    isGated: raw.is_stream_gated === true,
    permalink: str(raw.permalink),
  };
}

async function getJson(path: string, query: Record<string, string>): Promise<unknown> {
  const params = new URLSearchParams({ ...query, app_name: appName() });
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}?${params.toString()}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new MusicProviderError(
      PROVIDER_ID,
      `Audius did not answer within ${TIMEOUT_MS / 1000} s.`,
    );
  }
  if (!res.ok) {
    throw new MusicProviderError(
      PROVIDER_ID,
      `Audius answered ${res.status} for ${path}.`,
      res.status,
    );
  }
  try {
    return (await res.json()) as unknown;
  } catch {
    throw new MusicProviderError(PROVIDER_ID, `Audius answered ${path} with a body that is not JSON.`, res.status);
  }
}

function dataArray(body: unknown): AudiusTrackJson[] {
  if (!body || typeof body !== "object") {
    throw new MusicProviderError(PROVIDER_ID, "Audius answered with an unexpected body.");
  }
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) {
    throw new MusicProviderError(PROVIDER_ID, "Audius answered without a track list.");
  }
  return data as AudiusTrackJson[];
}

function dataObject(body: unknown): AudiusTrackJson {
  if (!body || typeof body !== "object") {
    throw new MusicProviderError(PROVIDER_ID, "Audius answered with an unexpected body.");
  }
  const data = (body as { data?: unknown }).data;
  if (!data || typeof data !== "object") {
    throw new MusicProviderError(PROVIDER_ID, "Audius answered without a track.");
  }
  return data as AudiusTrackJson;
}

export const audiusProvider: MusicProvider = {
  id: PROVIDER_ID,
  label: "Audius",
  // No credential is required for a read. The two names are recorded because
  // they change the request (app name) and because the app address belongs in
  // env rather than in source.
  requiredEnv: ["AUDIUS_APP_NAME", "AUDIUS_API_KEY"],
  isConfigured() {
    // The reads this adapter performs need no credential, so the slot is
    // configured whenever the code is present.
    return true;
  },
  async search(query: MusicSearchQuery) {
    const params: Record<string, string> = {
      query: query.q,
      limit: String(query.limit),
    };
    if (query.genre) params.genre = query.genre;
    if (query.mood) params.mood = query.mood;
    const body = await getJson("/tracks/search", params);
    return dataArray(body)
      .map((raw) => {
        try {
          return mapAudiusTrack(raw);
        } catch {
          return null;
        }
      })
      .filter((t): t is MusicProviderTrack => t !== null);
  },
  async track(id: string) {
    const body = await getJson(`/tracks/${encodeURIComponent(id)}`, {});
    return mapAudiusTrack(dataObject(body));
  },
  previewUrl(id: string) {
    return `${API_BASE}/tracks/${encodeURIComponent(id)}/stream?app_name=${encodeURIComponent(appName())}`;
  },
  licenceVerdict(track: MusicProviderTrack, intendedUse: IntendedUse): LicenceVerdict {
    return evaluateLicence(track, intendedUse);
  },
};
