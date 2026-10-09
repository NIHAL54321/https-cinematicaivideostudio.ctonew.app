/**
 * Phase 3 — Asset & Licensing data layer.
 *
 * Typed accessors over the existing Asset / StockAsset / LicensingMetadata /
 * SceneAsset models. Every persisted stock asset records source, provider,
 * externalId, license, attribution requirement and usage rights (all via the
 * existing Prisma models — no new tables). Also the foundation for the Media
 * Library UI: favorites / collections / recent are stored in Asset.metadata
 * JSON (`library`) so no migration was needed.
 *
 * ALL queries are tenant-scoped by userId + projectId. Never query an asset by
 * id alone in a handler without first proving ownership.
 */
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/api";
import type { Asset, AssetKind, AssetStatus, Prisma, SceneAssetRole } from "@prisma/client";
import type { ProviderAsset } from "./types";
import { licenceDatesFromProvider } from "./licence-fields";
import { buildLibraryView, type LibraryKindFilter, type LibraryAssetLike } from "./library";

// ---------------------------------------------------------------------------
// Library metadata (favorites / collections / recent) — stored in Asset.metadata
// ---------------------------------------------------------------------------
export interface LibraryMeta {
  favorite?: boolean;
  collections?: string[];
  lastUsedAt?: string; // ISO — “recents” ordering
  tags?: string[];
}

function readLibrary(asset: Pick<Asset, "metadata">): LibraryMeta {
  const m = (asset.metadata as Record<string, unknown> | null) ?? {};
  const lib = (m.library as LibraryMeta) ?? {};
  return { favorite: false, collections: [], ...lib };
}
function libMetaData(lib: LibraryMeta): Prisma.InputJsonValue {
  // Keep `library` namespaced so it never collides with kind-specific metadata.
  return { library: lib } as unknown as Prisma.InputJsonValue;
}

/** Load an asset only if it belongs to the user. 404 otherwise. */
export async function getOwnedAsset(userId: string, assetId: string) {
  const asset = await prisma.asset.findFirst({ where: { id: assetId, userId } });
  if (!asset) throw new ApiError(404, "Asset not found.", "not_found");
  return asset;
}

/** Persist a provider asset as an Asset + StockAsset + LicensingMetadata row. */
export async function createStockAsset(opts: {
  userId: string;
  projectId: string;
  source: ProviderAsset;
  sceneId?: string; // optional — also attach a SceneAsset when assigning
  role?: SceneAssetRole;
}) {
  const { userId, projectId, source, sceneId, role } = opts;
  // A stock asset is real third-party media (not AI-generated), so it is
  // stored with an honest IMAGE/VIDEO kind (never GENERATED_*).
  const realKind: AssetKind = source.mediaType === "video" ? "VIDEO" : "IMAGE";

  const created = await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.create({
      data: {
        projectId,
        userId,
        kind: realKind,
        name: source.title || source.externalId,
        status: "READY",
        mimeType: source.mediaType === "video" ? "video/mp4" : "image/jpeg",
        width: source.width,
        height: source.height,
        durationSeconds: source.durationSeconds,
        url: source.url,
        metadata: {
          stock: {
            provider: source.provider,
            externalId: source.externalId,
            previewUrl: source.previewUrl,
            thumbUrl: source.thumbUrl,
            pageUrl: source.pageUrl,
            authorUrl: source.authorUrl,
          },
        },
      },
    });
    await tx.stockAsset.create({
      data: {
        assetId: asset.id,
        provider: source.provider,
        externalId: source.externalId,
        stockType: source.mediaType,
        pageUrl: source.pageUrl,
      },
    });
    await tx.licensingMetadata.create({
      data: {
        assetId: asset.id,
        licenseType: source.license.type,
        source: source.license.source,
        attribution: source.license.attribution,
        licenseUrl: source.license.licenseUrl,
        // Stored only when the provider really stated them. Absent stays null:
        // the publishing package reports `expiresAt` empty-with-reason rather
        // than assuming a licence without a recorded expiry never expires.
        ...licenceDatesFromProvider(source.license),
      },
    });
    if (sceneId) {
      await tx.sceneAsset.create({
        data: { sceneId, assetId: asset.id, role: role ?? "VISUAL" },
      });
    }
    return tx.asset.findUnique({
      where: { id: asset.id },
      include: { stockAsset: true, licensing: true, sceneAssets: true },
    });
  });
  return created;
}

/**
 * Created by the studio itself (AI generation). Stored with an honest
 * GENERATED_IMAGE / GENERATED_VIDEO kind and LicenseType=GENERATED, and
 * recorded as a GeneratedImage / GeneratedVideo row with the prompt, provider
 * and model that produced it. Only called when a provider returned a REAL
 * result — never to stash a fabricated asset.
 */
export async function createGeneratedAsset(opts: {
  userId: string;
  projectId: string;
  kind: "GENERATED_IMAGE" | "GENERATED_VIDEO";
  name: string;
  url?: string | null;
  mimeType?: string | null;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  provider?: string | null;
  model?: string | null;
  prompt?: string | null;
  negativePrompt?: string | null;
  seed?: number | null;
  steps?: number | null;
  fps?: number | null;
  aspectRatio?: string | null;
  sceneId?: string; // optional — also attach a SceneAsset when assigning
  role?: SceneAssetRole;
}) {
  const { userId, projectId, kind, sceneId, role } = opts;
  const assetKind: AssetKind = kind; // GENERATED_IMAGE | GENERATED_VIDEO
  const isVideo = kind === "GENERATED_VIDEO";
  const created = await prisma.$transaction(async (tx) => {
    const asset = await tx.asset.create({
      data: {
        projectId,
        userId,
        kind: assetKind,
        name: opts.name,
        status: "READY",
        mimeType: opts.mimeType ?? (isVideo ? "video/mp4" : "image/png"),
        width: opts.width ?? undefined,
        height: opts.height ?? undefined,
        durationSeconds: opts.durationSeconds ?? undefined,
        url: opts.url ?? undefined,
        metadata: {
          generated: {
            provider: opts.provider ?? null,
            model: opts.model ?? null,
            prompt: opts.prompt ?? null,
            negativePrompt: opts.negativePrompt ?? null,
            seed: opts.seed ?? null,
            steps: opts.steps ?? null,
            fps: opts.fps ?? null,
            aspectRatio: opts.aspectRatio ?? null,
            generatedAt: new Date().toISOString(),
          },
        },
      },
    });
    if (isVideo) {
      await tx.generatedVideo.create({
        data: {
          assetId: asset.id,
          provider: opts.provider ?? null,
          model: opts.model ?? null,
          prompt: opts.prompt ?? null,
          negativePrompt: opts.negativePrompt ?? null,
          seed: opts.seed ?? undefined,
          fps: opts.fps ?? undefined,
          status: "SUCCEEDED",
        },
      });
    } else {
      await tx.generatedImage.create({
        data: {
          assetId: asset.id,
          provider: opts.provider ?? null,
          model: opts.model ?? null,
          prompt: opts.prompt ?? null,
          negativePrompt: opts.negativePrompt ?? null,
          seed: opts.seed ?? undefined,
          steps: opts.steps ?? undefined,
          status: "SUCCEEDED",
        },
      });
    }
    await tx.licensingMetadata.create({
      data: {
        assetId: asset.id,
        licenseType: "GENERATED",
        source: "Cinematic AI Video Studio (AI generation)",
      },
    });
    if (sceneId) {
      await tx.sceneAsset.create({
        data: { sceneId, assetId: asset.id, role: role ?? "VISUAL" },
      });
    }
    return tx.asset.findUnique({
      where: { id: asset.id },
      include: { generatedImage: true, generatedVideo: true, licensing: true, sceneAssets: true },
    });
  });
  return created;
}

/** Assign an existing asset to a scene (idempotent upsert, tenant-checked). */
export async function assignAssetToScene(opts: {
  userId: string;
  projectId: string;
  sceneId: string;
  assetId: string;
  role?: SceneAssetRole;
}) {
  const { userId, projectId, sceneId, assetId, role } = opts;
  // Prove both the asset and the scene belong to the user.
  const [asset, scene] = await Promise.all([
    prisma.asset.findFirst({ where: { id: assetId, userId } }),
    prisma.scene.findFirst({ where: { id: sceneId, projectId } }),
  ]);
  if (!asset) throw new ApiError(404, "Asset not found.", "not_found");
  if (!scene) throw new ApiError(404, "Scene not found.", "not_found");
  const sceneAsset = await prisma.sceneAsset.upsert({
    where: { sceneId_assetId_role: { sceneId, assetId, role: role ?? "VISUAL" } },
    create: { sceneId, assetId, role: role ?? "VISUAL" },
    update: {},
  });
  // Touch recents.
  await prisma.asset.update({
    where: { id: assetId },
    data: { metadata: libMetaData({ ...readLibrary(asset), lastUsedAt: new Date().toISOString() }) },
  });
  return sceneAsset;
}

/** The scene-assignable rows for a scene, tenant-scoped. */
export async function getSceneAssets(userId: string, projectId: string, sceneId: string) {
  const scene = await prisma.scene.findFirst({ where: { id: sceneId, projectId } });
  if (!scene) throw new ApiError(404, "Scene not found.", "not_found");
  return prisma.sceneAsset.findMany({
    where: { sceneId },
    include: { asset: { include: { stockAsset: true, licensing: true } } },
  });
}

/** Tenancy guard: return the scene only if it belongs to one of the user's projects. */
export async function getOwnedScene(userId: string, sceneId: string) {
  const scene = await prisma.scene.findFirst({
    where: { id: sceneId, project: { userId } },
    include: { project: { select: { id: true, userId: true } } },
  });
  if (!scene) throw new ApiError(404, "Scene not found.", "not_found");
  return scene;
}

// ---------------------------------------------------------------------------
// Media Library foundation (favorites / collections / recent)
// ---------------------------------------------------------------------------
/**
 * Fetch ALL of a user's non-deleted assets (tenant-scoped) and delegate to the
 * pure `buildLibraryView` for filtering / search / favorite / collection /
 * paging + summary (meta.recent / meta.collections / meta.favoritesCount).
 * This is the real-data source for GET /api/media/library.
 */
export async function queryLibrary(
  userId: string,
  opts: {
    kind?: LibraryKindFilter;
    q?: string;
    favorite?: boolean;
    collection?: string;
    page?: number;
    pageSize?: number;
  } = {},
) {
  const assets = await prisma.asset.findMany({
    where: { userId, deletedAt: null },
    include: { stockAsset: true, generatedImage: true, generatedVideo: true, licensing: true },
    orderBy: { updatedAt: "desc" },
  });
  return buildLibraryView(assets as LibraryAssetLike[], opts);
}

export async function listLibrary(userId: string, opts: { kind?: string; favorite?: boolean; collection?: string } = {}) {
  const where: Prisma.AssetWhereInput = { userId, deletedAt: null };
  if (opts.kind) where.kind = opts.kind as AssetKind;
  const assets = await prisma.asset.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: { stockAsset: true, licensing: true },
    take: 200,
  });
  const filtered = assets.filter((a) => {
    const lib = readLibrary(a);
    if (opts.favorite && !lib.favorite) return false;
    if (opts.collection && !(lib.collections ?? []).includes(opts.collection)) return false;
    return true;
  });
  // Recent-first ordering by lastUsedAt.
  filtered.sort((a, b) => {
    const la = readLibrary(a).lastUsedAt ?? a.updatedAt.toISOString();
    const lb = readLibrary(b).lastUsedAt ?? b.updatedAt.toISOString();
    return lb.localeCompare(la);
  });
  return filtered;
}

export async function setAssetFavorite(userId: string, assetId: string, favorite: boolean) {
  const asset = await getOwnedAsset(userId, assetId);
  const lib = { ...readLibrary(asset), favorite };
  await prisma.asset.update({ where: { id: assetId }, data: { metadata: libMetaData(lib) } });
  return lib;
}

export async function addAssetToCollection(userId: string, assetId: string, collection: string) {
  const asset = await getOwnedAsset(userId, assetId);
  const lib = readLibrary(asset);
  const collections = Array.from(new Set([...(lib.collections ?? []), collection]));
  await prisma.asset.update({
    where: { id: assetId },
    data: { metadata: libMetaData({ ...lib, collections }) },
  });
  return collections;
}

export async function removeAssetFromCollection(userId: string, assetId: string, collection: string) {
  const asset = await getOwnedAsset(userId, assetId);
  const lib = readLibrary(asset);
  const collections = (lib.collections ?? []).filter((c) => c !== collection);
  await prisma.asset.update({
    where: { id: assetId },
    data: { metadata: libMetaData({ ...lib, collections }) },
  });
  return collections;
}

export interface AssetInfoPatch {
  name?: string;
  tags?: string[];
}

/** Rename and/or tag an owned asset (persisted in Asset.name + metadata.library.tags). */
export async function updateAssetInfo(userId: string, assetId: string, patch: AssetInfoPatch) {
  const asset = await getOwnedAsset(userId, assetId);
  if (patch.name != null && !patch.name.trim()) {
    throw new ApiError(400, "Name cannot be empty.", "bad_input");
  }
  const lib = readLibrary(asset);
  if (patch.tags) lib.tags = patch.tags;
  await prisma.asset.update({
    where: { id: assetId },
    data: {
      ...(patch.name != null ? { name: patch.name.trim() } : {}),
      // Always persist the merged library envelope so favorites/collections are
      // retained even when only the name changes.
      metadata: libMetaData(lib),
    },
  });
  return getOwnedAsset(userId, assetId);
}
export type { Asset, AssetStatus, AssetKind };