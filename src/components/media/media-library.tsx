"use client";
/**
 * Media Library — the Phase 3 library UI.
 *
 * A client view over the tenant-scoped /api/media/library routes. Favorites,
 * collections, renames and tags are REAL and persist to Asset.metadata / Asset.
 * User uploads go through the signed-URL flow (/api/media/upload) and land here.
 * Nothing is fabricated: stock search reports an honest "Provider Not Connected"
 * state until a provider key is configured server-side.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioLines,
  Film,
  Folder,
  FolderPlus,
  Image as ImageIcon,
  Layers,
  Loader2,
  Pencil,
  PlugZap,
  Search,
  Star,
  Tag,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import { Badge, Button, Card, Input } from "@/components/ui";
import { apiFetch } from "@/components/projects/client-api";

type KindFilter =
  | "all"
  | "image"
  | "video"
  | "audio"
  | "music"
  | "logo"
  | "brand"
  | "generated"
  | "stock"
  | "uploaded";

interface LibraryItem {
  id: string;
  kind: string;
  name: string;
  mimeType?: string | null;
  url?: string | null;
  metadata?: Record<string, unknown> | null;
  updatedAt?: string;
  stockAsset?: { provider?: string | null; externalId?: string | null } | null;
  licensing?: { attribution?: string | null; source?: string | null } | null;
}

interface LibraryView {
  connected: boolean;
  items: LibraryItem[];
  total: number;
  page: number;
  pageSize: number;
  filters: { kind: KindFilter; q: string; favorite: boolean; collection?: string };
  meta: { favoritesCount: number; collections: string[]; recent: string[] };
}

interface StockStatus {
  status: string;
  requiredEnv?: string[];
  providers?: { id: string; name: string; requiredEnv: string[] }[];
}

const TABS: { id: KindFilter; label: string; icon: LucideIcon }[] = [
  { id: "all", label: "All", icon: Layers },
  { id: "image", label: "Image", icon: ImageIcon },
  { id: "video", label: "Video", icon: Film },
  { id: "audio", label: "Audio", icon: AudioLines },
  { id: "music", label: "Music", icon: AudioLines },
  { id: "logo", label: "Logos", icon: ImageIcon },
  { id: "brand", label: "Brand", icon: ImageIcon },
  { id: "generated", label: "Generated", icon: ImageIcon },
  { id: "stock", label: "Stock", icon: Layers },
  { id: "uploaded", label: "Uploaded", icon: Upload },
];

const UPLOAD_CATEGORIES = [
  { id: "image", label: "Image", accept: "image/*" },
  { id: "video", label: "Video", accept: "video/*" },
  { id: "audio", label: "Audio", accept: "audio/*" },
  { id: "music", label: "Music", accept: "audio/*" },
  { id: "logo", label: "Logo", accept: "image/*" },
  { id: "brand", label: "Brand", accept: "image/*" },
] as const;

function iconForKind(kind: string): LucideIcon {
  if (kind === "VIDEO" || kind === "GENERATED_VIDEO") return Film;
  if (kind === "AUDIO" || kind === "MUSIC") return AudioLines;
  return ImageIcon;
}

function thumbFor(item: LibraryItem): string | undefined {
  const meta = (item.metadata as Record<string, unknown> | null) ?? {};
  const stock = meta.stock as Record<string, unknown> | undefined;
  return item.url ?? (stock?.previewUrl as string | undefined) ?? (stock?.thumbUrl as string | undefined);
}

export function MediaLibraryView({ projectId }: { projectId: string }) {
  const [kind, setKind] = useState<KindFilter>("all");
  const [q, setQ] = useState("");
  const [searchText, setSearchText] = useState("");
  const [favoriteOnly, setFavoriteOnly] = useState(false);
  const [collection, setCollection] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [view, setView] = useState<LibraryView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [stockStatus, setStockStatus] = useState<StockStatus | null>(null);

  // Inline rename/tag editing.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editTags, setEditTags] = useState("");
  // Collection picker.
  const [collectionFor, setCollectionFor] = useState<string | null>(null);
  const [newCollection, setNewCollection] = useState("");

  // Upload state.
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const pageSize = 24;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ kind });
      if (searchText.trim()) params.set("q", searchText.trim());
      if (favoriteOnly) params.set("favorite", "true");
      if (collection) params.set("collection", collection);
      params.set("page", String(page));
      params.set("pageSize", String(pageSize));
      const data = await apiFetch<LibraryView>(`/api/media/library?${params.toString()}`);
      setView(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load library.");
    } finally {
      setLoading(false);
    }
  }, [kind, searchText, favoriteOnly, collection, page]);

  useEffect(() => {
    load();
  }, [load]);

  // Honest stock-provider status (no keys → "Provider Not Connected").
  useEffect(() => {
    apiFetch<StockStatus>("/api/media?q=cinematic%20landscape")
      .then((s) => setStockStatus(s))
      .catch(() => setStockStatus(null));
  }, []);

  function selectKind(next: KindFilter) {
    setKind(next);
    setPage(1);
  }
  function doSearch() {
    setSearchText(q);
    setPage(1);
  }
  function toggleFavoriteOnly() {
    setFavoriteOnly((v) => !v);
    setPage(1);
  }
  function selectCollection(c?: string) {
    setCollection(c || undefined);
    setPage(1);
  }

  async function toggleFavorite(item: LibraryItem) {
    const next = !(readLibrary(item.metadata)?.favorite ?? false);
    await apiFetch("/api/media/library/favorite", {
      method: "POST",
      body: JSON.stringify({ assetId: item.id, favorite: next }),
    });
    load();
  }

  async function toggleCollection(item: LibraryItem, col: string, add: boolean) {
    await apiFetch("/api/media/library/collection", {
      method: "POST",
      body: JSON.stringify({ assetId: item.id, collection: col, add }),
    });
    setCollectionFor(null);
    setNewCollection("");
    load();
  }

  function startEdit(item: LibraryItem) {
    setEditingId(item.id);
    setEditName(item.name);
    const lib = readLibrary(item.metadata);
    setEditTags((lib?.tags ?? []).join(", "));
  }

  async function saveEdit(item: LibraryItem) {
    const tags = editTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    await apiFetch("/api/media/library/asset", {
      method: "PUT",
      body: JSON.stringify({ assetId: item.id, name: editName.trim() || item.name, tags }),
    });
    setEditingId(null);
    load();
  }

  // ---------------------------------------------------------------------------
  // Upload flow: initiate (signed URL) → PUT bytes → finalize.
  // ---------------------------------------------------------------------------
  async function handleUpload(file: File, category: string) {
    if (!projectId) {
      setError("Create a project before uploading assets.");
      return;
    }
    setUploading(true);
    setUploadProgress(0);
    setError(null);
    try {
      const init = await apiFetch<{ assetId: string; uploadUrl: string; readUrl?: string }>(
        "/api/media/upload",
        { method: "POST", body: JSON.stringify({ fileName: file.name, contentType: file.type || "application/octet-stream", kind: category, projectId }) },
      );
      // PUT the bytes directly to MinIO via the signed URL with progress.
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", init.uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}).`)));
        xhr.onerror = () => reject(new Error("Upload to storage failed."));
        xhr.send(file);
      });
      const fin = await apiFetch<{ asset?: LibraryItem }>("/api/media/upload", {
        method: "POST",
        body: JSON.stringify({ assetId: init.assetId, sizeBytes: file.size }),
      });
      // Refresh so the persisted asset appears in the grid.
      await load();
      setUploadProgress(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  const recentItems = view ? view.items.filter((i) => view.meta.recent.includes(i.id)) : [];
  const collections = view?.meta.collections ?? [];

  return (
    <div className="space-y-5">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => selectKind(t.id)}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                kind === t.id && !favoriteOnly
                  ? "border-accent-line bg-accent-soft text-accent"
                  : "border-line bg-panel-2 text-ink-dim hover:text-ink"
              }`}
            >
              <t.icon size={13} strokeWidth={1.75} />
              {t.label}
            </button>
          ))}
          <button
            onClick={toggleFavoriteOnly}
            className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[12px] font-medium transition-colors ${
              favoriteOnly ? "border-accent-line bg-accent-soft text-accent" : "border-line bg-panel-2 text-ink-dim hover:text-ink"
            }`}
          >
            <Star size={13} strokeWidth={1.75} />
            Favorites {view ? `(${view.meta.favoritesCount})` : ""}
          </button>
          {/* Collections dropdown */}
          <div className="relative">
            <button
              onClick={() => setCollectionFor(collectionFor === "__picker" ? null : "__picker")}
              className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                collection ? "border-accent-line bg-accent-soft text-accent" : "border-line bg-panel-2 text-ink-dim hover:text-ink"
              }`}
            >
              <Folder size={13} strokeWidth={1.75} />
              {collection ?? "Collections"}
            </button>
            {collectionFor === "__picker" && (
              <div className="absolute z-20 mt-2 w-56 rounded-xl border border-line bg-panel-2 p-2 shadow-xl">
                {collections.map((c) => (
                  <button
                    key={c}
                    onClick={() => {
                      selectCollection(c === collection ? undefined : c);
                      setCollectionFor(null);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] text-ink-dim hover:bg-panel-3 hover:text-ink"
                  >
                    <Folder size={14} /> {c}
                  </button>
                ))}
                {collections.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-ink-faint">No collections yet.</p>
                ) : null}
              </div>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1">
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && doSearch()}
              placeholder="Search library…"
              className="h-9 w-52"
            />
            <Button size="sm" variant="outline" onClick={doSearch} aria-label="Search">
              <Search size={14} />
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) {
                const guess = inferUrlCategory(f.type);
                handleUpload(f, guess);
              }
              e.target.value = "";
            }}
          />
          <Button size="sm" onClick={() => fileRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {uploading ? `Uploading ${uploadProgress}%` : "Upload"}
          </Button>
        </div>
      </div>

      {/* Upload category hint */}
      <p className="text-[11px] text-ink-faint">
        Category is inferred from the file type (image / video / audio). For Logos or Brand, choose a file with a matching type —
        the category is recorded with the upload.
      </p>

      {uploadProgress > 0 && uploading ? (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-panel-2">
          <div className="h-full bg-accent transition-all" style={{ width: `${uploadProgress}%` }} />
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-danger/25 bg-danger/10 px-4 py-3 text-sm text-danger">{error}</div>
      ) : null}

      {/* Honest stock-provider status */}
      {stockStatus && stockStatus.status !== "ok" ? (
        <div className="glass flex items-center gap-3 rounded-xl border-accent-line/30 px-4 py-3">
          <PlugZap size={16} className="text-accent" strokeWidth={1.75} />
          <div className="text-[13px] text-ink-dim">
            <span className="font-medium text-ink">Stock Provider Not Connected.</span>{" "}
            {stockStatus.providers?.length
              ? `Stock search is ready for ${stockStatus.providers.map((p) => p.name).join(", ")} but needs a server-side API key. No search results are fabricated.`
              : "No stock provider is configured."}
          </div>
          <div className="ml-auto flex flex-wrap gap-1.5">
            {(stockStatus.requiredEnv ?? []).map((k) => (
              <Badge key={k} tone="neutral" className="font-mono normal-case tracking-normal">
                {k}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      {view && view.meta.recent.length > 0 && kind === "all" && !favoriteOnly && !collection && !searchText ? (
        <div className="glass p-4">
          <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-faint">Recent</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-8">
            {recentItems.map((item) => (
              <AssetTile
                key={item.id}
                item={item}
                onFavorite={() => toggleFavorite(item)}
                onCollection={() => setCollectionFor(item.id)}
              />
            ))}
          </div>
        </div>
      ) : null}

      {/* Grid */}
      {view && view.items.length === 0 ? (
        <div className="glass flex flex-col items-center gap-3 px-6 py-16 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-panel-2 border border-line text-ink-dim">
            <Layers size={24} strokeWidth={1.75} />
          </span>
          <h2 className="font-display text-lg font-semibold text-ink">
            {favoriteOnly ? "No favorites yet" : collection ? "No assets in this collection" : searchText ? "No matches" : "Your library is empty"}
          </h2>
          <p className="max-w-md text-sm leading-relaxed text-ink-dim">
            {favoriteOnly
              ? "Star any asset to pin it here."
              : searchText
                ? "Try a different search or clear the current filter."
                : "Assets land here as you generate, license or upload media. Use Upload to add your own files."}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
          {(view?.items ?? []).map((item) => (
            <AssetTile
              key={item.id}
              item={item}
              onFavorite={() => toggleFavorite(item)}
              onCollection={() => setCollectionFor(item.id)}
              onEdit={() => startEdit(item)}
              editing={editingId === item.id}
              editName={editName}
              editTags={editTags}
              setEditName={setEditName}
              setEditTags={setEditTags}
              onSave={() => saveEdit(item)}
              onCancel={() => setEditingId(null)}
            />
          ))}
        </div>
      )}

      {/* Collection picker popover */}
      {collectionFor && collectionFor !== "__picker" && collectionFor !== "__pick" ? (
        <CollectionPicker
          assetId={collectionFor}
          collections={collections}
          current={(view?.items ?? []).find((i) => i.id === collectionFor)}
          newCollection={newCollection}
          setNewCollection={setNewCollection}
          onClose={() => setCollectionFor(null)}
          onToggle={(col, add) => {
            const item = (view?.items ?? []).find((i) => i.id === collectionFor);
            if (item) toggleCollection(item, col, add);
          }}
        />
      ) : null}

      {/* Paging */}
      {view && view.total > view.pageSize ? (
        <div className="flex items-center justify-between pt-2">
          <p className="text-xs text-ink-faint">
            {view.total} asset{view.total === 1 ? "" : "s"} · page {view.page}
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Prev
            </Button>
            <Button size="sm" variant="outline" disabled={page * pageSize >= view.total} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function readLibrary(metadata?: Record<string, unknown> | null): { favorite?: boolean; tags?: string[]; collections?: string[] } {
  const lib = (metadata?.library ?? {}) as Record<string, unknown>;
  return {
    favorite: lib.favorite === true,
    tags: Array.isArray(lib.tags) ? (lib.tags as string[]) : undefined,
    collections: Array.isArray(lib.collections) ? (lib.collections as string[]) : undefined,
  };
}

function sourceLabel(item: LibraryItem): string {
  if (item.stockAsset?.provider) return item.stockAsset.provider;
  const meta = (item.metadata as Record<string, unknown> | null) ?? {};
  const upload = meta.upload as Record<string, unknown> | undefined;
  if (upload?.category || !item.stockAsset) {
    if (upload?.category || item.kind === "IMAGE" || item.kind === "VIDEO" || item.kind === "AUDIO") return "User upload";
  }
  if (item.kind.startsWith("GENERATED")) return "AI generated";
  return "Media library";
}

function inferUrlCategory(mime: string): string {
  if (mime.startsWith("image/")) return "image";
  if (mime.startsWith("video/")) return "video";
  if (mime.startsWith("audio/")) return "audio";
  return "image";
}

function CollectionPicker({
  assetId,
  collections,
  current,
  newCollection,
  setNewCollection,
  onClose,
  onToggle,
}: {
  assetId: string;
  collections: string[];
  current?: LibraryItem;
  newCollection: string;
  setNewCollection: (v: string) => void;
  onClose: () => void;
  onToggle: (col: string, add: boolean) => void;
}) {
  const inCollections = current ? (readLibrary(current.metadata)?.collections ?? []) : [];
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-72 rounded-2xl border border-line bg-panel-2 p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium text-ink">Add to collection</p>
          <button onClick={onClose} className="text-ink-faint hover:text-ink">
            <X size={16} />
          </button>
        </div>
        <div className="max-h-48 space-y-1 overflow-y-auto">
          {collections.map((c) => {
            const inIt = inCollections.includes(c);
            return (
              <button
                key={c}
                onClick={() => onToggle(c, !inIt)}
                className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[13px] text-ink-dim hover:bg-panel-3 hover:text-ink"
              >
                <span className="flex items-center gap-2">
                  <Folder size={14} /> {c}
                </span>
                {inIt ? <Badge tone="accent">in</Badge> : null}
              </button>
            );
          })}
          {collections.length === 0 ? <p className="px-2 py-1 text-xs text-ink-faint">No collections yet — create one below.</p> : null}
        </div>
        <div className="mt-3 flex gap-2">
          <Input
            value={newCollection}
            onChange={(e) => setNewCollection(e.target.value)}
            placeholder="New collection name"
            className="h-9 flex-1"
          />
          <Button
            size="sm"
            disabled={!newCollection.trim()}
            onClick={() => {
              if (newCollection.trim()) onToggle(newCollection.trim(), true);
            }}
          >
            <FolderPlus size={14} /> Add
          </Button>
        </div>
      </div>
    </div>
  );
}

function AssetTile({
  item,
  onFavorite,
  onCollection,
  onEdit,
  editing,
  editName,
  editTags,
  setEditName,
  setEditTags,
  onSave,
  onCancel,
}: {
  item: LibraryItem;
  onFavorite: () => void;
  onCollection: () => void;
  onEdit?: () => void;
  editing?: boolean;
  editName?: string;
  editTags?: string;
  setEditName?: (v: string) => void;
  setEditTags?: (v: string) => void;
  onSave?: () => void;
  onCancel?: () => void;
}) {
  const lib = readLibrary(item.metadata);
  const Icon = iconForKind(item.kind);
  const thumb = thumbFor(item);
  const inCollections = lib.collections ?? [];

  return (
    <Card className="group overflow-hidden p-0">
      <div className="relative flex aspect-video items-center justify-center bg-panel-3/60">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt={item.name} className="h-full w-full object-cover" />
        ) : (
          <Icon size={26} strokeWidth={1.5} className="text-ink-faint" />
        )}
        <div className="absolute right-2 top-2 flex gap-1">
          <button
            title={lib.favorite ? "Unfavorite" : "Favorite"}
            onClick={onFavorite}
            className={`rounded-lg p-1.5 transition-colors ${
              lib.favorite ? "text-accent" : "bg-black/40 text-white/70 hover:text-white"
            }`}
          >
            <Star size={15} fill={lib.favorite ? "currentColor" : "none"} />
          </button>
        </div>
      </div>
      <div className="p-3">
        {editing && setEditName && setEditTags && onSave && onCancel ? (
          <div className="space-y-2">
            <Input value={editName} onChange={(e) => setEditName(e.target.value)} className="h-8 text-xs" autoFocus />
            <Input
              value={editTags}
              onChange={(e) => setEditTags(e.target.value)}
              placeholder="tags, comma, separated"
              className="h-8 text-xs"
            />
            <div className="flex gap-1.5">
              <Button size="sm" onClick={onSave}>
                Save
              </Button>
              <Button size="sm" variant="ghost" onClick={onCancel}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <>
            <p className="truncate text-[13px] font-medium text-ink" title={item.name}>
              {item.name}
            </p>
            <div className="mt-1.5 flex items-center justify-between">
              <Badge tone="neutral" className="normal-case tracking-normal">
                {sourceLabel(item)}
              </Badge>
              <span className="flex items-center gap-1">
                {inCollections.length ? (
                  <span className="inline-flex items-center gap-0.5 text-[10px] text-ink-faint">
                    <Folder size={11} /> {inCollections.length}
                  </span>
                ) : null}
                {onEdit ? (
                  <button title="Rename / tag" onClick={onEdit} className="text-ink-faint hover:text-ink">
                    <Pencil size={13} />
                  </button>
                ) : null}
                <button title="Add to collection" onClick={onCollection} className="text-ink-faint hover:text-ink">
                  <Tag size={13} />
                </button>
              </span>
            </div>
            {item.licensing?.attribution ? (
              <p className="mt-2 line-clamp-2 text-[10px] leading-snug text-ink-faint" title={item.licensing.attribution}>
                {item.licensing.attribution}
              </p>
            ) : null}
          </>
        )}
      </div>
    </Card>
  );
}
