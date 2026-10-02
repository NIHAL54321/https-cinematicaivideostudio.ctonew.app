"use client";
/**
 * Brand Kit editor — Phase 3 foundation.
 *
 * A client view over the tenant-scoped /api/brandkit routes plus the signed
 * media-upload flow for logo / intro / outro / watermark assets. Everything
 * here is REAL: preferences persist to the BrandKit row, uploads go through
 * MinIO signed URLs (honest progress, no fabricated "generated" assets), and
 * "Apply to project" copies the kit into a project's settings through /apply.
 */
import { useRef, useState } from "react";
import {
  AudioLines,
  CheckCircle2,
  FilePlus2,
  Film,
  Image as ImageIcon,
  Loader2,
  Music,
  Palette,
  Save,
  Trash2,
  Type,
  Upload,
  X,
} from "lucide-react";
import { Badge, Button, Card, Input, Label } from "@/components/ui";
import { apiFetch } from "@/components/projects/client-api";
import type { BrandKitApi, BrandKitInput } from "@/lib/brandkit";
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

interface ProjectOption {
  id: string;
  title: string | null;
}

interface FormState {
  name: string;
  colors: { primary: string; secondary: string; accent: string; background: string; text: string };
  fonts: { heading: string; body: string };
  voice: { language: string; gender: string; tone: string; sampleRate: number; pitch: number; speed: number };
  subtitle: { style: string; position: string; size: number; color: string; font: string };
  music: { mood: string; genre: string; energy: number; volume: number };
  thumbnail: { template: string; layout: string; textOverlay: string; useBrandColors: boolean };
  logoAssetId: string | null;
  logoUrl: string | null;
  watermarkEnabled: boolean;
  watermarkAssetId: string | null;
  watermarkUrl: string | null;
  introAssetId: string | null;
  introUrl: string | null;
  introDuration: number;
  outroAssetId: string | null;
  outroUrl: string | null;
  outroDuration: number;
}

const EMPTY: FormState = {
  name: "My Brand",
  colors: { primary: "#5b5df6", secondary: "#17171c", accent: "#e8b45a", background: "#0a0a0d", text: "#f5f4f0" },
  fonts: { heading: "Space Grotesk", body: "Inter" },
  voice: { language: "en", gender: "neutral", tone: "warm", sampleRate: 44100, pitch: 1, speed: 1 },
  subtitle: { style: "clean", position: "bottom", size: 44, color: "#ffffff", font: "Inter" },
  music: { mood: "cinematic", genre: "orchestral", energy: 50, volume: 70 },
  thumbnail: { template: "bold", layout: "center", textOverlay: "", useBrandColors: true },
  logoAssetId: null,
  logoUrl: null,
  watermarkEnabled: false,
  watermarkAssetId: null,
  watermarkUrl: null,
  introAssetId: null,
  introUrl: null,
  introDuration: 3,
  outroAssetId: null,
  outroUrl: null,
  outroDuration: 3,
};

function initForm(kit: BrandKitApi | null): FormState {
  if (!kit) return EMPTY;
  const c = kit.colors ?? {};
  const v = kit.voicePreferences ?? {};
  const s = kit.subtitlePreferences ?? {};
  const m = kit.musicPreferences ?? {};
  const t = kit.thumbnailPreferences ?? {};
  const tc = t.colors ?? {};
  return {
    name: kit.name || "My Brand",
    colors: {
      primary: c.primary ?? EMPTY.colors.primary,
      secondary: c.secondary ?? EMPTY.colors.secondary,
      accent: c.accent ?? EMPTY.colors.accent,
      background: c.background ?? "",
      text: c.text ?? "",
    },
    fonts: { heading: kit.fonts?.heading ?? EMPTY.fonts.heading, body: kit.fonts?.body ?? EMPTY.fonts.body },
    voice: {
      language: v.language ?? EMPTY.voice.language,
      gender: v.gender ?? EMPTY.voice.gender,
      tone: v.tone ?? EMPTY.voice.tone,
      sampleRate: v.sampleRate ?? EMPTY.voice.sampleRate,
      pitch: v.pitch ?? EMPTY.voice.pitch,
      speed: v.speed ?? EMPTY.voice.speed,
    },
    subtitle: {
      style: s.style ?? EMPTY.subtitle.style,
      position: s.position ?? EMPTY.subtitle.position,
      size: s.size ?? EMPTY.subtitle.size,
      color: s.color ?? EMPTY.subtitle.color,
      font: s.font ?? EMPTY.subtitle.font,
    },
    music: {
      mood: m.mood ?? EMPTY.music.mood,
      genre: m.genre ?? EMPTY.music.genre,
      energy: m.energy ?? EMPTY.music.energy,
      volume: m.volume ?? EMPTY.music.volume,
    },
    thumbnail: {
      template: t.template ?? EMPTY.thumbnail.template,
      layout: t.layout ?? EMPTY.thumbnail.layout,
      textOverlay: t.textOverlay ?? "",
      useBrandColors: !tc.primary && !tc.accent,
    },
    logoAssetId: kit.logoAssetId,
    logoUrl: kit.logoUrl,
    watermarkEnabled: kit.watermark.enabled,
    watermarkAssetId: kit.watermark.assetId,
    watermarkUrl: kit.watermark.url,
    introAssetId: kit.intro.assetId,
    introUrl: kit.intro.url,
    introDuration: kit.intro.durationSeconds ?? 3,
    outroAssetId: kit.outro.assetId,
    outroUrl: kit.outro.url,
    outroDuration: kit.outro.durationSeconds ?? 3,
  };
}

function compactHex(o: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(o)) if (v && v.trim()) out[k] = v.trim();
  return out;
}

// ----------------------------------------------------------------- tiny UI
function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="min-w-0">
      <Label>{label}</Label>
      {children}
      {hint ? <p className="mt-1 text-[11px] text-ink-faint">{hint}</p> : null}
    </div>
  );
}
function Select({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  options: readonly string[];
  placeholder?: string;
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-10 w-full rounded-xl border border-line bg-panel-3/60 px-3 text-sm text-ink focus:outline-none focus:border-accent-line focus:ring-2 focus:ring-accent/20"
    >
      {placeholder ? <option value="">{placeholder}</option> : null}
      {options.map((o) => (
        <option key={o} value={o} className="bg-panel-2 text-ink">
          {o}
        </option>
      ))}
    </select>
  );
}
function Slider({
  label,
  value,
  min,
  max,
  step,
  unit,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-ink-dim">{label}</span>
        <span className="text-xs text-ink">
          {value}
          {unit}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[#e8b45a]"
      />
    </div>
  );
}
function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label>{label}</Label>
      <div className="flex items-center gap-2 rounded-xl border border-line bg-panel-3/60 px-3 py-2">
        <input
          type="color"
          value={value || "#000000"}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-10 shrink-0 cursor-pointer rounded border border-line bg-transparent"
          aria-label={label}
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#rrggbb"
          className="h-8 flex-1 bg-transparent text-sm text-ink focus:outline-none"
        />
      </div>
    </div>
  );
}
function SectionCard({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string }>;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-6">
      <div className="mb-5 flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-panel-2 border border-line text-accent">
          <Icon size={17} strokeWidth={1.75} />
        </span>
        <div>
          <h2 className="font-display text-base font-semibold text-ink">{title}</h2>
          <p className="mt-0.5 text-[13px] leading-relaxed text-ink-dim">{description}</p>
        </div>
      </div>
      {children}
    </Card>
  );
}

// ------------------------------------------------------------------ uploader
function AssetUploader({
  label,
  accept,
  kind,
  projectId,
  url,
  durationHint,
  onUploaded,
  onRemove,
}: {
  label: string;
  accept: string;
  kind: string;
  projectId: string;
  url: string | null;
  durationHint?: string;
  onUploaded: (assetId: string, readUrl: string) => void;
  onRemove: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(file: File) {
    setBusy(true);
    setProgress(0);
    setError(null);
    try {
      const init = await apiFetch<{ assetId: string; uploadUrl: string }>("/api/media/upload", {
        method: "POST",
        body: JSON.stringify({ fileName: file.name, contentType: file.type || "application/octet-stream", kind, projectId }),
      });
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("PUT", init.uploadUrl);
        xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status}).`)));
        xhr.onerror = () => reject(new Error("Upload to storage failed."));
        xhr.send(file);
      });
      const fin = await apiFetch<{ assetId: string; readUrl?: string }>("/api/media/upload", {
        method: "POST",
        body: JSON.stringify({ assetId: init.assetId, sizeBytes: file.size }),
      });
      onUploaded(init.assetId, fin.readUrl ?? "");
      setProgress(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-line bg-panel-2/50 p-3">
      <div className="flex items-center gap-3">
        <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-panel-3 text-ink-faint">
          {url ? (
            accept.startsWith("video/") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <video src={url} className="h-full w-full object-cover" muted />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={label} className="h-full w-full object-cover" />
            )
          ) : (
            <Upload size={18} strokeWidth={1.75} />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[13px] font-medium text-ink">{label}</span>
            {durationHint ? <span className="text-[11px] text-ink-faint">{durationHint}</span> : null}
          </div>
          {url ? (
            <p className="mt-0.5 truncate text-[11px] text-ok">Uploaded · ready</p>
          ) : (
            <p className="mt-0.5 text-[11px] text-ink-faint">No file yet</p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {url ? (
            <Button size="sm" variant="ghost" onClick={onRemove} aria-label={`Remove ${label}`} disabled={busy}>
              <X size={14} />
            </Button>
          ) : null}
          <Button size="sm" variant="outline" onClick={() => ref.current?.click()} disabled={busy}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
            {busy ? `${progress}%` : "Upload"}
          </Button>
          <input
            ref={ref}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) handleFile(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>
      {busy ? (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-panel-3">
          <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress}%` }} />
        </div>
      ) : null}
      {error ? <p className="mt-2 text-[11px] text-danger">{error}</p> : null}
    </div>
  );
}

// ------------------------------------------------------------------ editor
export function BrandKitEditor({
  initialKit,
  projects,
  uploadProjectId,
}: {
  initialKit: BrandKitApi | null;
  projects: ProjectOption[];
  uploadProjectId: string;
}) {
  const [form, setForm] = useState<FormState>(() => initForm(initialKit));
  const [hasKit, setHasKit] = useState(initialKit !== null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [applyMsg, setApplyMsg] = useState<{ type: "ok" | "err"; text: string } | null>(null);
  const [applyProject, setApplyProject] = useState(projects[0]?.id ?? "");
  const [applying, setApplying] = useState(false);

  const patch = (p: Partial<FormState>) => {
    setForm((f) => ({ ...f, ...p }));
    setDirty(true);
    setMsg(null);
  };

  function buildInput(): BrandKitInput {
    const thumbnailColors = form.thumbnail.useBrandColors ? undefined : { primary: form.colors.primary, accent: form.colors.accent };
    return {
      name: form.name,
      colors: compactHex(form.colors),
      fonts: { heading: form.fonts.heading, body: form.fonts.body },
      voicePreferences: {
        language: form.voice.language,
        gender: form.voice.gender,
        tone: form.voice.tone,
        sampleRate: form.voice.sampleRate,
        pitch: form.voice.pitch,
        speed: form.voice.speed,
      },
      subtitlePreferences: {
        style: form.subtitle.style,
        position: form.subtitle.position,
        size: form.subtitle.size,
        color: form.subtitle.color || undefined,
        font: form.subtitle.font,
      },
      musicPreferences: {
        mood: form.music.mood,
        genre: form.music.genre,
        energy: form.music.energy,
        volume: form.music.volume,
      },
      thumbnailPreferences: {
        template: form.thumbnail.template,
        layout: form.thumbnail.layout,
        textOverlay: form.thumbnail.textOverlay || undefined,
        colors: thumbnailColors,
      },
      logoAssetId: form.logoAssetId,
      watermark: { enabled: form.watermarkEnabled, assetId: form.watermarkAssetId },
      intro: { assetId: form.introAssetId, durationSeconds: form.introDuration },
      outro: { assetId: form.outroAssetId, durationSeconds: form.outroDuration },
    };
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      const res = await apiFetch<{ kit: BrandKitApi }>("/api/brandkit", {
        method: "POST",
        body: JSON.stringify(buildInput()),
      });
      setForm(initForm(res.kit));
      setHasKit(true);
      setDirty(false);
      setMsg({ type: "ok", text: "Brand kit saved. New projects will inherit these defaults." });
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "Failed to save brand kit." });
    } finally {
      setSaving(false);
    }
  }

  async function removeKit() {
    if (!hasKit) return;
    if (!window.confirm("Delete this brand kit? Projects won't be deleted, but they'll stop inheriting these defaults.")) return;
    try {
      await apiFetch("/api/brandkit", { method: "DELETE" });
      setForm(EMPTY);
      setHasKit(false);
      setDirty(false);
      setMsg({ type: "ok", text: "Brand kit deleted." });
    } catch (e) {
      setMsg({ type: "err", text: e instanceof Error ? e.message : "Failed to delete brand kit." });
    }
  }

  async function apply() {
    if (!applyProject) {
      setApplyMsg({ type: "err", text: "Create a project first, then apply the kit to it." });
      return;
    }
    setApplying(true);
    setApplyMsg(null);
    try {
      const res = await apiFetch<{ projectId: string; changed: boolean }>("/api/brandkit/apply", {
        method: "POST",
        body: JSON.stringify({ projectId: applyProject }),
      });
      const names = projects.find((p) => p.id === res.projectId);
      setApplyMsg({
        type: "ok",
        text: `Applied brand kit to "${names?.title ?? "project"}"${res.changed ? "" : " (nothing to change — already matches)."}`,
      });
    } catch (e) {
      setApplyMsg({ type: "err", text: e instanceof Error ? e.message : "Failed to apply brand kit." });
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* Status + actions */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Badge tone={hasKit ? "accent" : "neutral"}>{hasKit ? "Kit active" : "No kit yet"}</Badge>
        <div className="flex items-center gap-2">
          {hasKit ? (
            <Button variant="ghost" onClick={removeKit}>
              <Trash2 size={15} /> Delete
            </Button>
          ) : null}
          <Button onClick={save} disabled={saving || (!dirty && hasKit)}>
            {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
            {hasKit ? "Save kit" : "Create kit"}
          </Button>
        </div>
      </div>

      {!hasKit ? (
        <Card className="border-accent-line/40 bg-accent-soft/10 p-6">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-panel-2 border border-line text-accent">
              <Palette size={18} strokeWidth={1.75} />
            </span>
            <div>
              <h2 className="font-display text-[15px] font-semibold text-ink">Set up your brand kit</h2>
              <p className="mt-1 max-w-2xl text-[13px] leading-relaxed text-ink-dim">
                Fill in your identity and preferences below, then <span className="text-ink">Create kit</span> to save them.
                Once saved, every new project is automatically seeded with these defaults, and you can apply the kit to
                existing projects from the panel at the bottom.
              </p>
            </div>
          </div>
        </Card>
      ) : null}

      {msg ? (
        <div
          className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-[13px] ${
            msg.type === "ok" ? "border-ok/25 bg-ok/10 text-ok" : "border-danger/25 bg-danger/10 text-danger"
          }`}
        >
          {msg.type === "ok" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <X size={16} className="mt-0.5 shrink-0" />}
          <span>{msg.text}</span>
        </div>
      ) : null}

      {/* Brand identity */}
      <SectionCard icon={Palette} title="Brand identity" description="Your name, logo, color palette and fonts — the visual anchor of every video.">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Brand name">
            <Input value={form.name} onChange={(e) => patch({ name: e.target.value })} placeholder="e.g. Strait & Bright Media" />
          </Field>
          <div />
          <div className="sm:col-span-2">
            <AssetUploader
              label="Logo"
              accept="image/*"
              kind="image"
              projectId={uploadProjectId}
              url={form.logoUrl}
              onUploaded={(assetId, readUrl) => patch({ logoAssetId: assetId, logoUrl: readUrl })}
              onRemove={() => patch({ logoAssetId: null, logoUrl: null })}
            />
          </div>
          <ColorField label="Primary color" value={form.colors.primary} onChange={(v) => patch({ colors: { ...form.colors, primary: v } })} />
          <ColorField label="Secondary color" value={form.colors.secondary} onChange={(v) => patch({ colors: { ...form.colors, secondary: v } })} />
          <ColorField label="Accent color" value={form.colors.accent} onChange={(v) => patch({ colors: { ...form.colors, accent: v } })} />
          <Field label="Headline font">
            <Select value={form.fonts.heading} onChange={(v) => patch({ fonts: { ...form.fonts, heading: v } })} options={BRAND_FONTS} />
          </Field>
          <Field label="Body font">
            <Select value={form.fonts.body} onChange={(v) => patch({ fonts: { ...form.fonts, body: v } })} options={BRAND_FONTS} />
          </Field>
        </div>
      </SectionCard>

      {/* Media */}
      <SectionCard icon={Film} title="Media" description="Watermark, intro and outro clips that bookend and brand your videos.">
        <div className="space-y-4">
          <div className="flex items-center justify-between rounded-xl border border-line px-4 py-3">
            <div>
              <div className="text-[13px] font-medium text-ink">Watermark</div>
              <p className="text-[11px] text-ink-faint">Overlay your logo on every video.</p>
            </div>
            <input
              type="checkbox"
              checked={form.watermarkEnabled}
              onChange={(e) => patch({ watermarkEnabled: e.target.checked })}
              className="h-5 w-5 accent-[#e8b45a]"
              aria-label="Enable watermark"
            />
          </div>
          {form.watermarkEnabled ? (
            <AssetUploader
              label="Watermark image"
              accept="image/*"
              kind="image"
              projectId={uploadProjectId}
              url={form.watermarkUrl}
              onUploaded={(assetId, readUrl) => patch({ watermarkAssetId: assetId, watermarkUrl: readUrl })}
              onRemove={() => patch({ watermarkAssetId: null, watermarkUrl: null })}
            />
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <AssetUploader
                label="Intro clip"
                accept="video/*"
                kind="video"
                projectId={uploadProjectId}
                url={form.introUrl}
                onUploaded={(assetId, readUrl) => patch({ introAssetId: assetId, introUrl: readUrl })}
                onRemove={() => patch({ introAssetId: null, introUrl: null })}
              />
              <Field label="Intro duration (seconds)">
                <Input
                  type="number"
                  min={0}
                  max={120}
                  value={form.introDuration}
                  onChange={(e) => patch({ introDuration: Number(e.target.value) })}
                />
              </Field>
            </div>
            <div className="space-y-2">
              <AssetUploader
                label="Outro clip"
                accept="video/*"
                kind="video"
                projectId={uploadProjectId}
                url={form.outroUrl}
                onUploaded={(assetId, readUrl) => patch({ outroAssetId: assetId, outroUrl: readUrl })}
                onRemove={() => patch({ outroAssetId: null, outroUrl: null })}
              />
              <Field label="Outro duration (seconds)">
                <Input
                  type="number"
                  min={0}
                  max={120}
                  value={form.outroDuration}
                  onChange={(e) => patch({ outroDuration: Number(e.target.value) })}
                />
              </Field>
            </div>
          </div>
        </div>
      </SectionCard>

      {/* Defaults */}
      <SectionCard icon={Type} title="Defaults" description="Default voice, subtitles, music and thumbnail choices — new projects inherit these.">
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Voice language">
              <Select value={form.voice.language} onChange={(v) => patch({ voice: { ...form.voice, language: v } })} options={VOICE_LANGUAGES} />
            </Field>
            <Field label="Voice gender">
              <Select value={form.voice.gender} onChange={(v) => patch({ voice: { ...form.voice, gender: v } })} options={VOICE_GENDERS} />
            </Field>
            <Field label="Voice tone">
              <Select value={form.voice.tone} onChange={(v) => patch({ voice: { ...form.voice, tone: v } })} options={VOICE_TONES} />
            </Field>
            <Field label="Sample rate (Hz)">
              <Select
                value={String(form.voice.sampleRate)}
                onChange={(v) => patch({ voice: { ...form.voice, sampleRate: Number(v) } })}
                options={["24000", "44100", "48000"]}
              />
            </Field>
          </div>
          <div className="grid gap-5 sm:grid-cols-2">
            <Slider label="Pitch" value={form.voice.pitch} min={0.5} max={2} step={0.05} unit="×" onChange={(v) => patch({ voice: { ...form.voice, pitch: v } })} />
            <Slider label="Speed" value={form.voice.speed} min={0.5} max={2} step={0.05} unit="×" onChange={(v) => patch({ voice: { ...form.voice, speed: v } })} />
          </div>

          <div className="border-t border-line pt-5">
            <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-ink">
              <AudioLines size={15} /> Subtitles
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Style">
                <Select value={form.subtitle.style} onChange={(v) => patch({ subtitle: { ...form.subtitle, style: v } })} options={SUBTITLE_STYLES} />
              </Field>
              <Field label="Position">
                <Select value={form.subtitle.position} onChange={(v) => patch({ subtitle: { ...form.subtitle, position: v } })} options={SUBTITLE_POSITIONS} />
              </Field>
              <Field label="Font">
                <Select value={form.subtitle.font} onChange={(v) => patch({ subtitle: { ...form.subtitle, font: v } })} options={BRAND_FONTS} />
              </Field>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Slider label="Size" value={form.subtitle.size} min={16} max={120} step={2} unit="px" onChange={(v) => patch({ subtitle: { ...form.subtitle, size: v } })} />
              <ColorField label="Text color" value={form.subtitle.color} onChange={(v) => patch({ subtitle: { ...form.subtitle, color: v } })} />
            </div>
          </div>

          <div className="border-t border-line pt-5">
            <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-ink">
              <Music size={15} /> Music
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Mood">
                <Select value={form.music.mood} onChange={(v) => patch({ music: { ...form.music, mood: v } })} options={MUSIC_MOODS} />
              </Field>
              <Field label="Genre">
                <Select value={form.music.genre} onChange={(v) => patch({ music: { ...form.music, genre: v } })} options={MUSIC_GENRES} />
              </Field>
            </div>
            <div className="mt-4 grid gap-5 sm:grid-cols-2">
              <Slider label="Volume" value={form.music.volume} min={0} max={100} step={1} unit="%" onChange={(v) => patch({ music: { ...form.music, volume: v } })} />
              <Slider label="Energy" value={form.music.energy} min={0} max={100} step={1} unit="" onChange={(v) => patch({ music: { ...form.music, energy: v } })} />
            </div>
          </div>

          <div className="border-t border-line pt-5">
            <div className="mb-3 flex items-center gap-2 text-[13px] font-semibold text-ink">
              <ImageIcon size={15} /> Thumbnails
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-2">
              <Field label="Template">
                <Select value={form.thumbnail.template} onChange={(v) => patch({ thumbnail: { ...form.thumbnail, template: v } })} options={THUMBNAIL_TEMPLATES} />
              </Field>
              <Field label="Layout">
                <Select value={form.thumbnail.layout} onChange={(v) => patch({ thumbnail: { ...form.thumbnail, layout: v } })} options={THUMBNAIL_LAYOUTS} />
              </Field>
              <Field label="Text overlay" hint="Optional text shown on thumbnails.">
                <Input value={form.thumbnail.textOverlay} onChange={(e) => patch({ thumbnail: { ...form.thumbnail, textOverlay: e.target.value } })} placeholder="e.g. Weekly roundup" />
              </Field>
              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-[13px] text-ink">
                  <input
                    type="checkbox"
                    checked={form.thumbnail.useBrandColors}
                    onChange={(e) => patch({ thumbnail: { ...form.thumbnail, useBrandColors: e.target.checked } })}
                    className="h-4 w-4 accent-[#e8b45a]"
                  />
                  Use brand colors
                </label>
              </div>
            </div>
            {!form.thumbnail.useBrandColors ? (
              <div className="mt-3 grid gap-4 sm:grid-cols-2">
                <ColorField label="Thumbnail primary" value={form.colors.primary} onChange={(v) => patch({ colors: { ...form.colors, primary: v } })} />
                <ColorField label="Thumbnail accent" value={form.colors.accent} onChange={(v) => patch({ colors: { ...form.colors, accent: v } })} />
              </div>
            ) : null}
          </div>
        </div>
      </SectionCard>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving || (!dirty && hasKit)}>
          {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
          {hasKit ? "Save kit" : "Create kit"}
        </Button>
      </div>

      {/* Apply to project */}
      <SectionCard icon={FilePlus2} title="Apply to a project" description="Copy these defaults into an existing project's settings. Values you've already set on the project are kept.">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-56 flex-1">
            <Label>Project</Label>
            <select
              value={applyProject}
              onChange={(e) => setApplyProject(e.target.value)}
              className="h-10 w-full rounded-xl border border-line bg-panel-3/60 px-3 text-sm text-ink focus:outline-none focus:border-accent-line focus:ring-2 focus:ring-accent/20"
            >
              {projects.length === 0 ? <option value="">No projects yet</option> : null}
              {projects.map((p) => (
                <option key={p.id} value={p.id} className="bg-panel-2 text-ink">
                  {p.title ?? "Untitled"}
                </option>
              ))}
            </select>
          </div>
          <Button onClick={apply} disabled={applying || projects.length === 0 || !hasKit}>
            {applying ? <Loader2 size={15} className="animate-spin" /> : <FilePlus2 size={15} />} Apply kit
          </Button>
        </div>
        {applyMsg ? (
          <div
            className={`mt-3 flex items-start gap-2 rounded-xl border px-4 py-3 text-[13px] ${
              applyMsg.type === "ok" ? "border-ok/25 bg-ok/10 text-ok" : "border-danger/25 bg-danger/10 text-danger"
            }`}
          >
            {applyMsg.type === "ok" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <X size={16} className="mt-0.5 shrink-0" />}
            <span>{applyMsg.text}</span>
          </div>
        ) : null}
      </SectionCard>
    </div>
  );
}
