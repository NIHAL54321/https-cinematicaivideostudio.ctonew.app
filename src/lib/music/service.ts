/**
 * The music service — BLOCK M1, 2026-11-17.
 *
 * Everything the routes need, with the database behind a `MusicStore` interface
 * so the licence refusal ("writes zero rows") and the tenancy 404 are proved by
 * tests against a memory double rather than by trusting the route text.
 *
 * ── What a selection is ────────────────────────────────────────────────────
 * Three rows, per the existing schema: `Asset(kind: MUSIC)` + `Music` +
 * `LicensingMetadata`. The provider track id, the artist and handle, the
 * VERBATIM licence text, the verdict and its basis, and when it was evaluated
 * all live in `Asset.metadata.music` (the preferred home in the spec — no
 * migration was needed, so none was written). `ProjectSettings.musicDefaults`
 * keeps the per-project preference and is merged, never overwritten.
 *
 * ── What it refuses to trust ───────────────────────────────────────────────
 * `selectMusic` re-fetches the track from the provider by id. A client-supplied
 * title, artist, duration or licence is never read, so a caller cannot make an
 * "all rights reserved" track look permitted by sending its own licence text.
 * When the licence does not permit the project's intended use the call throws
 * a 422 carrying the verdict's own reason and writes nothing.
 */
import { ApiError } from "@/lib/api";
import { prisma } from "@/lib/db";
import { Prisma } from "@prisma/client";
import { evaluateLicence } from "./licence";
import { musicProvider, musicProviders } from "./providers";
import {
  INTENDED_USES,
  MusicProviderError,
  ProviderNotConfiguredError,
  UnknownMusicProviderError,
  type IntendedUse,
  type LicenceVerdict,
  type MusicProvider,
  type MusicProviderTrack,
  type MusicSearchQuery,
} from "./providers/types";

/** The one sentence every music surface repeats. */
export const NO_MUSIC_IN_DELIVERY_NOTE =
  "No music is in any delivered file yet: this block selects a track and records its licence. Mixing music into a render is the next block, and until it lands the Export panel's delivered files carry no music track.";

export const LICENCE_CLAIM_NOTE =
  "A licence claim is the uploader's, not a verified clearance: this product reads the licence text the uploader stated and has not confirmed it with the rights holder.";

// ---------------------------------------------------------------------------
// View types (shared with the client via `import type`)
// ---------------------------------------------------------------------------

export interface MusicProviderStatus {
  id: string;
  label: string;
  configured: boolean;
  /** Env var NAMES only. Never values. */
  requiredEnv: string[];
}

export interface MusicTrackRow {
  track: MusicProviderTrack;
  verdict: LicenceVerdict;
}

export interface MusicSearchView {
  provider: MusicProviderStatus;
  query: MusicSearchQuery;
  intendedUse: IntendedUse;
  tracks: MusicTrackRow[];
  counts: { total: number; exportAllowed: number; previewOnly: number };
  /** Genre and mood values the provider returned for THIS search. */
  facets: { genres: string[]; moods: string[] };
}

export interface MusicSelectionView {
  assetId: string;
  provider: string;
  providerTrackId: string;
  title: string;
  artist: string | null;
  artistHandle: string | null;
  durationSeconds: number | null;
  genre: string | null;
  mood: string | null;
  licenceText: string | null;
  verdict: LicenceVerdict;
  intendedUse: IntendedUse;
  evaluatedAt: string;
  permalink: string | null;
}

export interface MusicView {
  projectId: string;
  intendedUse: IntendedUse;
  providers: MusicProviderStatus[];
  selection: MusicSelectionView | null;
  counts: { musicAssets: number; exportAllowed: number; previewOnly: number };
  note: string;
  licenceNote: string;
}

// ---------------------------------------------------------------------------
// Store contract
// ---------------------------------------------------------------------------

export interface WriteSelectionInput {
  userId: string;
  projectId: string;
  track: MusicProviderTrack;
  verdict: LicenceVerdict;
  intendedUse: IntendedUse;
  evaluatedAt: string;
}

export interface MusicStore {
  /** The project, scoped by user. null means "no such project for this user". */
  readProject(userId: string, projectId: string): Promise<{ id: string; musicDefaults: unknown } | null>;
  readSelection(projectId: string): Promise<MusicSelectionView | null>;
  countMusicAssets(projectId: string): Promise<number>;
  /** Replaces any existing selection; returns what was written. */
  writeSelection(input: WriteSelectionInput): Promise<MusicSelectionView>;
  /** Deletes the selection rows; returns how many were deleted. */
  clearSelection(projectId: string): Promise<number>;
  mergeProjectMusicDefaults(projectId: string, patch: Record<string, unknown>): Promise<void>;
}

// ---------------------------------------------------------------------------
// Derived facts
// ---------------------------------------------------------------------------

/** The project's intended use, from its own settings. Default: commercial. */
export function projectIntendedUse(musicDefaults: unknown): IntendedUse {
  if (musicDefaults && typeof musicDefaults === "object") {
    const value = (musicDefaults as { intendedUse?: unknown }).intendedUse;
    if (typeof value === "string" && (INTENDED_USES as readonly string[]).includes(value)) {
      return value as IntendedUse;
    }
  }
  // A monetised channel is commercial use; that is the stricter of the two uses
  // a CC BY licence permits, so nothing is permitted here that personal use
  // would not also permit.
  return "commercial";
}

export function providerStatus(provider: MusicProvider): MusicProviderStatus {
  return {
    id: provider.id,
    label: provider.label,
    configured: provider.isConfigured(),
    requiredEnv: [...provider.requiredEnv],
  };
}

/**
 * Turns provider tracks into the rows the panel shows, with the verdict for
 * each — so the UI never decides what is exportable. Counts and facets are
 * counted from the rows returned here, not from a constant.
 */
export function buildSearchView(
  provider: MusicProvider,
  query: MusicSearchQuery,
  intendedUse: IntendedUse,
  tracks: MusicProviderTrack[],
): MusicSearchView {
  const rows: MusicTrackRow[] = tracks.map((track) => ({
    track,
    verdict: provider.licenceVerdict(track, intendedUse),
  }));
  const exportAllowed = rows.filter((r) => r.verdict.permitted).length;
  const genres = new Set<string>();
  const moods = new Set<string>();
  for (const row of rows) {
    if (row.track.genre) genres.add(row.track.genre);
    if (row.track.mood) moods.add(row.track.mood);
  }
  return {
    provider: providerStatus(provider),
    query,
    intendedUse,
    tracks: rows,
    counts: { total: rows.length, exportAllowed, previewOnly: rows.length - exportAllowed },
    facets: { genres: [...genres].sort(), moods: [...moods].sort() },
  };
}

/** Maps a provider-layer failure onto the HTTP status the route returns. */
export function musicApiError(err: unknown): unknown {
  if (err instanceof UnknownMusicProviderError) {
    return new ApiError(400, err.message, "unknown_provider");
  }
  if (err instanceof ProviderNotConfiguredError) {
    return new ApiError(
      503,
      `${err.providerId} is not configured: it would need ${err.requiredEnv.join(" and ")}.`,
      "provider_not_configured",
    );
  }
  if (err instanceof MusicProviderError) {
    return new ApiError(502, err.message, "provider_error");
  }
  return err;
}

// ---------------------------------------------------------------------------
// Service operations
// ---------------------------------------------------------------------------

export interface MusicDeps {
  store: MusicStore;
  /** Injected in tests so the refusal path never needs the network. */
  provider?: MusicProvider;
}

export async function loadMusicView(
  input: { userId: string; projectId: string },
  deps: MusicDeps,
): Promise<MusicView> {
  const project = await deps.store.readProject(input.userId, input.projectId);
  if (!project) throw new ApiError(404, "Project not found.", "not_found");

  const intendedUse = projectIntendedUse(project.musicDefaults);
  const [selection, musicAssets] = await Promise.all([
    deps.store.readSelection(input.projectId),
    deps.store.countMusicAssets(input.projectId),
  ]);

  return {
    projectId: project.id,
    intendedUse,
    providers: MUSIC_PROVIDER_STATUS(),
    selection,
    counts: {
      musicAssets,
      exportAllowed: selection && selection.verdict.permitted ? 1 : 0,
      previewOnly: selection && !selection.verdict.permitted ? 1 : 0,
    },
    note: NO_MUSIC_IN_DELIVERY_NOTE,
    licenceNote: LICENCE_CLAIM_NOTE,
  };
}

/** Provider status rows, read from the registry at call time. */
function MUSIC_PROVIDER_STATUS(): MusicProviderStatus[] {
  return musicProviders().map(providerStatus);
}

export async function searchMusic(
  input: { providerId: string; query: MusicSearchQuery; intendedUse: IntendedUse },
  deps: Pick<MusicDeps, "provider">,
): Promise<MusicSearchView> {
  const provider = deps.provider ?? musicProvider(input.providerId);
  if (!provider.isConfigured()) {
    throw new ApiError(
      503,
      `${provider.label} is not configured: it would need ${provider.requiredEnv.join(" and ")}.`,
      "provider_not_configured",
    );
  }
  const tracks = await provider.search(input.query);
  return buildSearchView(provider, input.query, input.intendedUse, tracks);
}

export async function selectMusic(
  input: {
    userId: string;
    projectId: string;
    providerId: string;
    providerTrackId: string;
    intendedUse?: IntendedUse | null;
  },
  deps: MusicDeps,
): Promise<{ view: MusicView; selection: MusicSelectionView }> {
  const project = await deps.store.readProject(input.userId, input.projectId);
  if (!project) throw new ApiError(404, "Project not found.", "not_found");

  const provider = deps.provider ?? musicProvider(input.providerId);
  if (!provider.isConfigured()) {
    throw new ApiError(
      503,
      `${provider.label} is not configured: it would need ${provider.requiredEnv.join(" and ")}.`,
      "provider_not_configured",
    );
  }

  // The provider's own answer, fetched server-side. Nothing the client sent
  // about the track is used.
  const track = await provider.track(input.providerTrackId);
  const intendedUse = input.intendedUse ?? projectIntendedUse(project.musicDefaults);
  const verdict = provider.licenceVerdict(track, intendedUse);

  if (!verdict.permitted) {
    // Nothing has been written at this point, and nothing is.
    throw new ApiError(422, verdict.reason, "licence_refused");
  }

  const evaluatedAt = new Date().toISOString();
  const selection = await deps.store.writeSelection({
    userId: input.userId,
    projectId: input.projectId,
    track,
    verdict,
    intendedUse,
    evaluatedAt,
  });

  await deps.store.mergeProjectMusicDefaults(input.projectId, {
    intendedUse,
    selection: {
      provider: track.providerId,
      providerTrackId: track.providerTrackId,
      evaluatedAt,
    },
  });

  const view = await loadMusicView({ userId: input.userId, projectId: input.projectId }, deps);
  return { view, selection };
}

export async function clearMusic(
  input: { userId: string; projectId: string },
  deps: MusicDeps,
): Promise<{ view: MusicView; deleted: number }> {
  const project = await deps.store.readProject(input.userId, input.projectId);
  if (!project) throw new ApiError(404, "Project not found.", "not_found");
  const deleted = await deps.store.clearSelection(input.projectId);
  const view = await loadMusicView(input, deps);
  return { view, deleted };
}

// ---------------------------------------------------------------------------
// The Prisma-backed store
// ---------------------------------------------------------------------------

function metadataMusic(value: Prisma.JsonValue | null): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const music = (value as Record<string, unknown>).music;
  if (!music || typeof music !== "object" || Array.isArray(music)) return null;
  return music as Record<string, unknown>;
}

function asVerdict(value: unknown, fallbackText: string | null, intendedUse: IntendedUse): LicenceVerdict {
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    if (
      typeof v.permitted === "boolean" &&
      typeof v.reason === "string" &&
      typeof v.attributionRequired === "boolean" &&
      (v.basis === "explicit" || v.basis === "uploader-claimed" || v.basis === "none")
    ) {
      return {
        permitted: v.permitted,
        reason: v.reason,
        attributionRequired: v.attributionRequired,
        licenceText: typeof v.licenceText === "string" ? v.licenceText : fallbackText ?? "",
        basis: v.basis,
      };
    }
  }
  // A row written before this block: we hold no licence text for it, so the
  // verdict is the table's answer to "no licence stated", not a guess.
  return evaluateLicence({ licenceText: fallbackText, isStreamable: true, isGated: false }, intendedUse);
}

function selectionFromRow(row: {
  id: string;
  createdAt: Date;
  metadata: Prisma.JsonValue | null;
  music: { provider: string | null; genre: string | null; mood: string | null } | null;
}): MusicSelectionView {
  const music = metadataMusic(row.metadata);
  const intendedUse = projectIntendedUse(music ? { intendedUse: music.intendedUse } : null);
  const licenceText = typeof music?.licenceText === "string" ? music.licenceText : null;
  return {
    assetId: row.id,
    provider: typeof music?.provider === "string" ? music.provider : row.music?.provider ?? "unknown",
    providerTrackId: typeof music?.providerTrackId === "string" ? music.providerTrackId : "",
    title: typeof music?.title === "string" ? music.title : "(untitled)",
    artist: typeof music?.artist === "string" ? music.artist : null,
    artistHandle: typeof music?.artistHandle === "string" ? music.artistHandle : null,
    durationSeconds: typeof music?.durationSeconds === "number" ? music.durationSeconds : null,
    genre: typeof music?.genre === "string" ? music.genre : row.music?.genre ?? null,
    mood: typeof music?.mood === "string" ? music.mood : row.music?.mood ?? null,
    licenceText,
    verdict: asVerdict(music?.verdict, licenceText, intendedUse),
    intendedUse,
    evaluatedAt:
      typeof music?.evaluatedAt === "string" ? music.evaluatedAt : row.createdAt.toISOString(),
    permalink: typeof music?.permalink === "string" ? music.permalink : null,
  };
}

export const prismaMusicStore: MusicStore = {
  async readProject(userId, projectId) {
    const project = await prisma.project.findFirst({
      where: { id: projectId, userId, deletedAt: null },
      select: { id: true, settings: { select: { musicDefaults: true } } },
    });
    if (!project) return null;
    return { id: project.id, musicDefaults: project.settings?.musicDefaults ?? null };
  },

  async readSelection(projectId) {
    const row = await prisma.asset.findFirst({
      where: { projectId, kind: "MUSIC", deletedAt: null },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        createdAt: true,
        metadata: true,
        music: { select: { provider: true, genre: true, mood: true } },
      },
    });
    return row ? selectionFromRow(row) : null;
  },

  async countMusicAssets(projectId) {
    return prisma.asset.count({ where: { projectId, kind: "MUSIC", deletedAt: null } });
  },

  async writeSelection(input) {
    const { track, verdict, intendedUse, evaluatedAt } = input;
    const title = track.artist ? `${track.title} — ${track.artist}` : track.title;
    // A plain-JSON copy, the pattern the rest of this codebase uses for Prisma
    // Json columns: the verdict is a typed object, and the row stores exactly
    // the fields below.
    const metadata = JSON.parse(
      JSON.stringify({
        music: {
          provider: track.providerId,
          providerTrackId: track.providerTrackId,
          title: track.title,
          artist: track.artist,
          artistHandle: track.artistHandle,
          durationSeconds: track.durationSeconds,
          genre: track.genre,
          mood: track.mood,
          licenceText: track.licenceText,
          verdict,
          intendedUse,
          evaluatedAt,
          permalink: track.permalink,
        },
      }),
    ) as Prisma.InputJsonValue;

    const attribution =
      `${track.title} by ${track.artist ?? track.artistHandle ?? "unknown artist"}` +
      (track.artistHandle ? ` (@${track.artistHandle})` : "") +
      ` — licence stated by the uploader: ${track.licenceText ?? "none"}. Not independently verified.`;

    const row = await prisma.$transaction(async (tx) => {
      // Replace, never accumulate: one selection per project.
      await tx.asset.deleteMany({ where: { projectId: input.projectId, kind: "MUSIC" } });
      return tx.asset.create({
        data: {
          projectId: input.projectId,
          userId: input.userId,
          kind: "MUSIC",
          name: title,
          status: "READY",
          mimeType: "audio/mpeg",
          durationSeconds: track.durationSeconds === null ? null : Math.round(track.durationSeconds),
          metadata,
          music: {
            create: {
              provider: track.providerId,
              genre: track.genre,
              mood: track.mood,
              status: "SUCCEEDED",
            },
          },
          licensing: {
            create: {
              // The only permitted verdicts are CC BY / BY-SA, so the row says
              // Creative Commons and the attribution carries the rest.
              licenseType: "CREATIVE_COMMONS",
              source: track.providerId === "audius" ? "Audius" : track.providerId,
              attribution,
              licenseUrl: null,
            },
          },
        },
        select: {
          id: true,
          createdAt: true,
          metadata: true,
          music: { select: { provider: true, genre: true, mood: true } },
        },
      });
    });

    return selectionFromRow(row);
  },

  async clearSelection(projectId) {
    const result = await prisma.asset.deleteMany({ where: { projectId, kind: "MUSIC" } });
    return result.count;
  },

  async mergeProjectMusicDefaults(projectId, patch) {
    const settings = await prisma.projectSettings.findUnique({
      where: { projectId },
      select: { musicDefaults: true },
    });
    const existing =
      settings?.musicDefaults && typeof settings.musicDefaults === "object" && !Array.isArray(settings.musicDefaults)
        ? (settings.musicDefaults as Record<string, unknown>)
        : {};
    const merged = JSON.parse(JSON.stringify({ ...existing, ...patch })) as Prisma.InputJsonValue;
    await prisma.projectSettings.upsert({
      where: { projectId },
      create: { projectId, musicDefaults: merged },
      update: { musicDefaults: merged },
    });
  },
};
