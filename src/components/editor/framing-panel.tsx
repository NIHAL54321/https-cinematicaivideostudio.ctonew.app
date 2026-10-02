"use client";
/**
 * Phase 5 Block 5b — the REFRAME & OUTPUT FORMATS panel (client).
 *
 * Everything rendered here is the framing engine's own output, read from
 * `POST /api/studio/editor` actions `listFrameFormats` / `planReframe` /
 * `applyReframe` / `resetReframe`: the four delivery formats with their real
 * resolutions and safe areas, the per-clip cover-crop geometry (window, scale,
 * travel, retention), the keyframe path, the selected policy with its rule and
 * the reason it was chosen (all verbatim), and the honest detector gate.
 *
 * Honest by construction: the subject anchor is UNKNOWN in this data model, so
 * the plan uses a stated rule anchor and says so; no face, box or centre is
 * invented, and no frame is decoded, cut, reframed or encoded. The detector gate
 * renders as "Provider Not Connected" with env var NAMES only.
 *
 * It lives in its own file (rather than inline in editor-client.tsx) purely so
 * the panel stays readable; it uses the same component kit and visual language
 * as AutoEditorPanel / PacingPanel / ColorGradingPanel / RepurposePanel.
 */
import { Activity, Check, Film, Info, ListChecks, Loader2, RefreshCw, Scissors, Trash2 } from "lucide-react";
import { Badge, Button, Card, Input, Label } from "@/components/ui";
import { ProviderNotConnected } from "@/components/provider-not-connected";
import { formatMs } from "@/lib/editor";

/* ------------------------------------------------------------------ */
/* Response shapes — verbatim mirrors of src/lib/framing              */
/* ------------------------------------------------------------------ */

export interface FrameRectView {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One delivery format exactly as `listFrameFormats` returns it. */
export interface FrameFormatView {
  id: string;
  label: string;
  aspect: string;
  aspectValue: number;
  widthPx: number;
  heightPx: number;
  resolution: string;
  orientation: string;
  platforms: string[];
  deliveryNotes: string[];
  safeAreas: {
    titleSafe: FrameRectView & { fraction: number };
    actionSafe: FrameRectView & { fraction: number };
    captionSafe: FrameRectView & { basis: string };
  };
}

/** One stated framing policy, with its rule rendered verbatim. */
export interface FramingPolicyView {
  id: string;
  label: string;
  rule: string;
  anchor: { x: number; y: number };
  motion: "hold" | "pan";
  explicitOnly: boolean;
}

export interface FrameKeyframeView {
  index: number;
  tMs: number;
  relative: number;
  crop: FrameRectView;
  cropNormalized: FrameRectView;
  scale: number;
  note: string;
}

export interface FramingOverrideView {
  source: string;
  format: string | null;
  policy: string | null;
  anchor: { x: number; y: number } | null;
  note: string | null;
}

/** One planned clip: geometry, policy reasoning and the honest anchor. */
export interface FramingClipPlanView {
  clipId: string;
  kind: string;
  label: string;
  sceneId: string | null;
  platformTarget: string | null;
  startMs: number;
  endMs: number;
  durationMs: number;
  durationSeconds: number;
  sourceClips: number;
  override: FramingOverrideView | null;
  source: {
    widthPx: number;
    heightPx: number;
    aspect: string;
    aspectValue: number;
    origin: string;
    originDetail: string;
    assetId: string | null;
    sceneAspectDeclared: string | null;
  };
  target: {
    id: string;
    label: string;
    aspect: string;
    resolution: string;
    widthPx: number;
    heightPx: number;
    origin: string;
    originDetail: string;
    platforms: string[];
    deliveryNotes: string[];
  };
  policy: {
    id: string;
    label: string;
    rule: string;
    requested: boolean;
    anchor: { x: number; y: number };
    anchorSource: string;
    engineDefault: string;
    selectedBecause: string;
    signals: { signal: string; value: string }[];
    alternatives: { policy: string; note: string }[];
  };
  geometry: {
    scale: number;
    crop: FrameRectView;
    cropNormalized: FrameRectView;
    travelPx: { x: number; y: number };
    offsetPx: { x: number; y: number };
    anchor: { x: number; y: number };
    anchorOffsetPx: { x: number; y: number };
    retained: { widthFraction: number; heightFraction: number; areaFraction: number };
    sourceActionSafeRetained: { xFraction: number; yFraction: number; areaFraction: number };
    upscale: number;
    cropCentrePx: { x: number; y: number };
  };
  safeAreas: {
    target: {
      titleSafe: FrameRectView;
      actionSafe: FrameRectView;
      captionSafe: FrameRectView;
      captionBasis: string;
    };
    sourceActionSafe: FrameRectView;
    safeAreaClamp: { applied: boolean; shiftPx: { x: number; y: number }; bounds: FrameRectView; note: string };
  };
  caption: {
    present: boolean;
    band: FrameRectView | null;
    bandBasis: string | null;
    verticalFraction: number;
    horizontalFraction: number;
    areaFraction: number;
    inTarget: FrameRectView | null;
    insideTargetCaptionSafe: boolean | null;
    sourceRows: string | null;
    note: string;
  };
  motion: {
    kind: string;
    rule: string;
    basis: string;
    keyframeCount: number;
    travelPx: number;
    keyframes: FrameKeyframeView[];
  };
  anchoring: {
    known: false;
    anchorKind: string;
    checked: { field: string; holds: string; locatesSubject: boolean }[];
    reason: string;
    policyAnchorUsed: { x: number; y: number };
    detector: ProviderGateView;
  };
  delivery: {
    resolution: string;
    upscale: number;
    keptColumns: number;
    keptRows: number;
    sourceColumns: number;
    sourceRows: number;
    note: string;
  };
}

/** The honest provider gate the API attaches (env var NAMES, never values). */
export interface ProviderGateView {
  capability: string;
  connected: boolean;
  requiredEnv: string[];
  envHint: string | null;
  note: string;
}

export interface FramingAssignedScopeView {
  format: string | null;
  policy: string | null;
  anchor: { x: number; y: number } | null;
  note: string | null;
}

export interface FramingAssignmentView {
  applied: boolean;
  appliedAt: string | null;
  project: FramingAssignedScopeView | null;
  scenes: Record<string, FramingAssignedScopeView>;
  clips: Record<string, FramingAssignedScopeView>;
  sceneCount: number;
  clipCount: number;
}

export interface FramingAnchorCheckView {
  known: false;
  anchorKind: string;
  checked: { field: string; holds: string; locatesSubject: boolean }[];
  reason: string;
}

export interface FramingRepurposeLinkView {
  applied: boolean;
  clipCount: number;
  byTarget: Record<string, number>;
  aspects: Record<string, string | null>;
  note: string;
}

/** The Block 5b envelope — the shape the HTTP client really sees. */
export interface FramingResponse {
  action?: string;
  projectId?: string;
  projectTitle?: string;
  timelineSource?: "saved" | "scenes";
  timelineMs?: number;
  clipCount?: number;
  sceneCount?: number;
  truncated?: number;
  scope?: "project" | "scene" | "clip";
  sceneId?: string | null;
  clipId?: string | null;
  requestedFormat?: string | null;
  requestedPolicy?: string | null;
  formats?: FrameFormatView[];
  policies?: FramingPolicyView[];
  defaultFormat?: string;
  anchors?: FramingAnchorCheckView;
  count?: number;
  clip?: FramingClipPlanView | null;
  clips?: FramingClipPlanView[];
  scopedCount?: number;
  assignment?: FramingAssignmentView;
  previous?: FramingAssignmentView;
  appliedOverride?: FramingAssignedScopeView | null;
  hadOverride?: boolean;
  appliedAt?: string | null;
  changed?: boolean;
  persisted?: boolean;
  changelist?: string[];
  droppedOverrides?: string[];
  unreadable?: boolean;
  note?: string;
  error?: string;
  code?: string;
  provider?: ProviderGateView;
  plan?: Record<string, unknown>;
  effectiveByClip?: Record<
    string,
    {
      format: string;
      formatOrigin: string;
      policy: string;
      policyRequested: boolean;
      engineDefault: string;
      overrideSource: string;
      crop: FrameRectView;
      scale: number;
    }
  >;
  repurposingLink?: FramingRepurposeLinkView;
}

export const FRAMING_PANEL_ACTIONS = ["listFrameFormats", "planReframe", "applyReframe", "resetReframe"] as const;
export type FramingPanelAction = (typeof FRAMING_PANEL_ACTIONS)[number];

/* ------------------------------------------------------------------ */
/* Small renderers                                                     */
/* ------------------------------------------------------------------ */

/** `w×h @ x,y` — the shape every rect is reported in. */
export function rectLabel(r: FrameRectView): string {
  return `${r.width}×${r.height} @ ${r.x},${r.y}`;
}

export function pctLabel(n: number): string {
  return `${Math.round(n * 1000) / 10}%`;
}

function FramingMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-line/70 bg-panel-2/50 px-2 py-1.5">
      <p className="text-[10px] uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-0.5 font-mono text-[11px] text-ink-dim">{value}</p>
    </div>
  );
}

/**
 * The crop window drawn inside the source frame, with the source action-safe
 * rect and the caption band overlaid. It is a diagram of the arithmetic the API
 * returned — not a render of any frame (no pixels exist here and none are
 * claimed).
 */
function FramingDiagram({ clip }: { clip: FramingClipPlanView }) {
  const { source, geometry } = clip;
  const band = clip.caption.present ? clip.caption.band : null;
  const box = (r: FrameRectView, className: string, key: string) => (
    <div
      key={key}
      className={className}
      style={{
        left: `${(r.x / source.widthPx) * 100}%`,
        top: `${(r.y / source.heightPx) * 100}%`,
        width: `${(r.width / source.widthPx) * 100}%`,
        height: `${(r.height / source.heightPx) * 100}%`,
      }}
    />
  );
  return (
    <div className="mt-2 flex flex-wrap items-start gap-3">
      <div
        className="relative w-[180px] shrink-0 overflow-hidden rounded border border-line bg-panel-3/50"
        style={{ aspectRatio: `${source.widthPx} / ${source.heightPx}` }}
        role="img"
        aria-label={`source ${source.widthPx} by ${source.heightPx} with the crop window at ${rectLabel(geometry.crop)}`}
      >
        {band ? box(band, "absolute border border-dashed border-ok/70 bg-ok/10", "band") : null}
        {box(clip.safeAreas.sourceActionSafe, "absolute border border-dotted border-ink-faint/60", "safe")}
        {box(geometry.crop, "absolute border border-accent-line bg-accent/10", "crop")}
      </div>
      <div className="min-w-[200px] flex-1 space-y-1">
        <p className="font-mono text-[10px] text-ink-faint">
          source {source.widthPx}×{source.heightPx} ({source.aspect}) → target {clip.target.resolution} ({clip.target.aspect})
        </p>
        <p className="text-[11px] text-ink-dim">
          Crop window <span className="font-mono">{rectLabel(geometry.crop)}</span> · scale{" "}
          <span className="font-mono">{geometry.scale}×</span> · keeps{" "}
          <span className="font-mono">{pctLabel(geometry.retained.widthFraction)}</span> of the columns and{" "}
          <span className="font-mono">{pctLabel(geometry.retained.heightFraction)}</span> of the rows.
        </p>
        <p className="text-[10px] text-ink-faint">
          accent box = kept window · dotted = source action-safe {rectLabel(clip.safeAreas.sourceActionSafe)}
          {band ? ` · green = caption band ${rectLabel(band)}` : ""}
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* The panel                                                           */
/* ------------------------------------------------------------------ */

export function FramingPanel({
  formats,
  policies,
  catalogue,
  result,
  busy,
  error,
  gate,
  format,
  onFormat,
  policy,
  onPolicy,
  scope,
  onScope,
  clipId,
  onClip,
  sceneId,
  sceneLabel,
  onRun,
  onPlanAt,
  onReload,
  onDismiss,
}: {
  formats: FrameFormatView[];
  policies: FramingPolicyView[];
  /** The standing catalogue read (formats, policies, assignment, anchors). */
  catalogue: FramingResponse | null;
  /** The last plan/apply/reset result, or null. */
  result: FramingResponse | null;
  /** The action currently in flight, or null. */
  busy: string | null;
  error: string | null;
  /** The standing detector gate from the catalogue read. */
  gate: ProviderGateView | null;
  format: string | null;
  onFormat: (id: string) => void;
  policy: string | null;
  onPolicy: (id: string | null) => void;
  scope: "project" | "scene" | "clip";
  onScope: (scope: "project" | "scene" | "clip") => void;
  clipId: string | null;
  onClip: (id: string) => void;
  sceneId: string | null;
  sceneLabel: string | null;
  onRun: (action: FramingPanelAction) => void;
  /** Plan one format straight away (the 5a shortcut — state is not in the way). */
  onPlanAt: (formatId: string) => void;
  onReload: () => void;
  onDismiss: () => void;
}) {
  const operationallyBusy = busy !== null;
  const current = result ?? catalogue;
  const clips = result?.clips ?? [];
  const shown = clips.find((c) => c.clipId === clipId) ?? result?.clip ?? clips[0] ?? null;
  const detectorGate = result?.provider ?? gate ?? null;
  const renderGate = (result?.plan?.["render"] as ProviderGateView | undefined) ?? null;
  const assignment = current?.assignment ?? null;
  const anchors: FramingAnchorCheckView | null = result?.anchors ?? catalogue?.anchors ?? null;
  const repurposing = current?.repurposingLink ?? null;
  const scopes: { id: "project" | "scene" | "clip"; label: string }[] = [
    { id: "project", label: "Whole project" },
    { id: "scene", label: "This scene" },
    { id: "clip", label: "This clip" },
  ];
  const selectedSpec = formats.find((f) => f.id === format) ?? null;

  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
          <Film size={12} /> Reframe &amp; output formats
        </p>
        <span className="flex items-center gap-2 text-[11px] text-ink-faint">
          {assignment?.applied ? (
            <>
              applied override:{" "}
              <span className="font-mono text-ink-dim">
                {assignment.sceneCount} scene(s) · {assignment.clipCount} clip(s)
              </span>
            </>
          ) : (
            "no override applied"
          )}
          {assignment?.appliedAt ? <span className="font-mono text-[10px]">{assignment.appliedAt}</span> : null}
          <button
            type="button"
            className="text-ink-faint hover:text-ink"
            title="Re-read the format catalogue, the policies and the applied overrides"
            onClick={onReload}
            disabled={operationallyBusy}
          >
            <RefreshCw size={12} />
          </button>
        </span>
      </div>
      <p className="mt-2 text-[11px] text-ink-faint">
        Cuts the project&apos;s real frames into 16:9 / 9:16 / 1:1 / 4:5. Every number below is arithmetic on the frames the
        project has: the cover-crop window in source pixels, the scale (and therefore the upscale the kept region needs), how far
        the window can travel, the safe areas and one keyframe path per clip. The subject anchor is UNKNOWN — nothing in this app
        locates a face, chart or line of text — so the plan uses a stated rule anchor and says which rule. No frame is decoded,
        cut, reframed or encoded here.
      </p>

      {/* ------------------------------------------------ format picker ---- */}
      <div className="mt-3 rounded-lg border border-line bg-panel-3/30 p-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Delivery format</p>
          {catalogue?.defaultFormat ? (
            <span className="text-[10px] text-ink-faint">
              engine default <span className="font-mono">{catalogue.defaultFormat}</span>
            </span>
          ) : null}
        </div>
        <div className="mt-2 grid grid-cols-2 gap-2 lg:grid-cols-4">
          {formats.length === 0 ? (
            <p className="text-[11px] text-ink-faint">Loading the format catalogue…</p>
          ) : (
            formats.map((f) => {
              const active = f.id === format;
              return (
                <button
                  key={f.id}
                  type="button"
                  disabled={operationallyBusy}
                  onClick={() => onFormat(f.id)}
                  className={`rounded-lg border px-2.5 py-2 text-left transition-colors ${
                    active ? "border-accent-line bg-accent-soft text-ink" : "border-line bg-panel-2/50 text-ink-dim hover:text-ink"
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span className="font-mono text-[12px]">{f.aspect}</span>
                    {active ? <Check size={11} /> : null}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-ink-faint">
                    {f.resolution} · {f.orientation}
                  </span>
                  <span className="mt-0.5 block text-[10px] text-ink-faint">{f.platforms.join(", ")}</span>
                </button>
              );
            })
          )}
        </div>
        {selectedSpec ? (
          <div className="mt-2 rounded border border-line/70 bg-panel-2/40 p-2">
            <p className="text-[11px] text-ink">
              <span className="font-mono">{selectedSpec.aspect}</span> · {selectedSpec.resolution} — target safe areas: action-safe{" "}
              <span className="font-mono">{rectLabel(selectedSpec.safeAreas.actionSafe)}</span> (
              {selectedSpec.safeAreas.actionSafe.fraction}), title-safe{" "}
              <span className="font-mono">{rectLabel(selectedSpec.safeAreas.titleSafe)}</span> (
              {selectedSpec.safeAreas.titleSafe.fraction}), caption-safe{" "}
              <span className="font-mono">{rectLabel(selectedSpec.safeAreas.captionSafe)}</span>
            </p>
            <p className="mt-1 text-[10px] text-ink-faint">caption band: {selectedSpec.safeAreas.captionSafe.basis}</p>
            {selectedSpec.deliveryNotes.map((n) => (
              <p key={n} className="mt-1 text-[10px] text-ink-faint">
                · {n}
              </p>
            ))}
          </div>
        ) : null}
      </div>

      {/* ------------------------------------- scope + policy controls ---- */}
      <div className="mt-3 grid grid-cols-1 gap-2 xl:grid-cols-2">
        <div className="rounded-lg border border-line bg-panel-3/30 p-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Scope</p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {scopes.map((s) => (
              <Button
                key={s.id}
                size="sm"
                variant={scope === s.id ? "primary" : "outline"}
                disabled={operationallyBusy}
                onClick={() => onScope(s.id)}
              >
                {s.label}
              </Button>
            ))}
          </div>
          <p className="mt-1.5 text-[10px] text-ink-faint">
            {scope === "project"
              ? "One override for the whole project."
              : scope === "scene"
                ? `Applies to ${sceneLabel ?? sceneId ?? "the active scene"} (scene override).`
                : `Applies to clip ${clipId ?? "—"} (clip override — it wins over the scene and project scopes).`}
          </p>
          {scope === "clip" ? (
            <div className="mt-2">
              <Label htmlFor="framing-clip">Clip</Label>
              {clips.length > 0 ? (
                <select
                  id="framing-clip"
                  className="h-9 w-full rounded-xl border border-line bg-panel-3/60 px-2 text-xs text-ink focus:border-accent-line focus:outline-none"
                  value={shown?.clipId ?? ""}
                  disabled={operationallyBusy}
                  onChange={(e) => onClip(e.target.value)}
                >
                  {clips.map((c) => (
                    <option key={c.clipId} value={c.clipId}>
                      {c.clipId} — {c.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id="framing-clip"
                  value={clipId ?? ""}
                  disabled={operationallyBusy}
                  placeholder="sc-<sceneId>-video"
                  onChange={(e) => onClip(e.target.value)}
                  className="h-9 px-2 text-xs"
                />
              )}
              <p className="mt-1 text-[10px] text-ink-faint">
                Clip ids are the ones the plan reports: <span className="font-mono">sc-&lt;sceneId&gt;-video</span> for a timeline
                clip, <span className="font-mono">shorts-3</span> for a clip the Block 5a set produced.
              </p>
            </div>
          ) : null}
        </div>

        <div className="rounded-lg border border-line bg-panel-3/30 p-2.5">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Framing policy</p>
          <div className="mt-2">
            <select
              className="h-9 w-full rounded-xl border border-line bg-panel-3/60 px-2 text-xs text-ink focus:border-accent-line focus:outline-none"
              value={policy ?? ""}
              disabled={operationallyBusy}
              onChange={(e) => onPolicy(e.target.value === "" ? null : e.target.value)}
            >
              <option value="">Engine&apos;s own choice (a stated rule per clip)</option>
              {policies.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                  {p.explicitOnly ? " — explicit only" : ""}
                </option>
              ))}
            </select>
          </div>
          {policies.map((p) => (
            <div key={p.id} className="mt-1.5 rounded border border-line/70 bg-panel-2/40 p-2">
              <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink">
                <span className="font-mono text-[10px] text-ink-faint">{p.id}</span>
                {p.label}
                <Badge tone={p.motion === "pan" ? "accent" : "neutral"}>{p.motion}</Badge>
                {p.explicitOnly ? <Badge tone="danger">explicit only</Badge> : null}
                <span className="ml-auto font-mono text-[10px] text-ink-faint">
                  anchor {p.anchor.x},{p.anchor.y}
                </span>
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-ink-faint">{p.rule}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" disabled={operationallyBusy} onClick={() => onRun("planReframe")}>
          {busy === "planReframe" ? <Loader2 size={13} className="animate-spin" /> : <Activity size={13} />} Plan{" "}
          {format ?? "format"}
        </Button>
        <Button size="sm" variant="primary" disabled={operationallyBusy} onClick={() => onRun("applyReframe")}>
          {busy === "applyReframe" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Apply reframe
        </Button>
        <Button size="sm" variant="outline" disabled={operationallyBusy} onClick={() => onRun("resetReframe")}>
          {busy === "resetReframe" ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />} Reset override
        </Button>
        <span className="text-[11px] text-ink-faint">
          {result
            ? `${result.scopedCount ?? clips.length} clip(s) planned at ${result.scope ?? scope} scope`
            : "not planned yet"}
        </span>
      </div>

      {error ? <p className="mt-3 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">{error}</p> : null}

      {result ? (
        <div className="mt-3 space-y-3">
          {/* ------------------------------------------- result summary ---- */}
          <div className="rounded-lg border border-line bg-panel-3/40 p-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                <ListChecks size={12} /> {result.action ?? "Framing result"}
                <Badge tone={result.changed ? "ok" : "neutral"}>
                  {result.changed
                    ? "override changed"
                    : result.action === "applyReframe" || result.action === "resetReframe"
                      ? "nothing changed"
                      : "read-only"}
                </Badge>
                {result.unreadable ? <Badge tone="danger">stored override unreadable</Badge> : null}
              </p>
              <button type="button" className="text-[11px] text-ink-faint hover:text-ink" onClick={onDismiss}>
                Dismiss
              </button>
            </div>
            <p className="mt-2 text-[11px] text-ink-faint">
              {result.clipCount ?? 0} planned clip(s) · {result.sceneCount ?? 0} scene(s) · {result.timelineMs ?? 0} ms of timeline ·
              timeline {result.timelineSource === "saved" ? "from the saved project" : "rebuilt from the scenes"}
              {result.truncated ? ` · ${result.truncated} clip(s) beyond the planning cap` : ""}
            </p>
            {(result.droppedOverrides ?? []).length > 0 ? (
              <p className="mt-1 text-[10px] text-danger">
                dropped stored override(s) naming an unknown format or policy: {(result.droppedOverrides ?? []).join(", ")}
              </p>
            ) : null}
            {(result.changelist ?? []).length > 0 ? (
              <ul className="mt-2 space-y-1">
                {(result.changelist ?? []).map((line) => (
                  <li key={line} className="text-[11px] text-ink-dim">
                    · {line}
                  </li>
                ))}
              </ul>
            ) : null}
            <p className="mt-2 text-[11px] text-ink-faint">{result.note}</p>
            {assignment?.applied ? (
              <p className="mt-2 text-[11px] text-ink-dim">
                applied override — project{" "}
                <span className="font-mono">
                  {assignment.project
                    ? `${assignment.project.format ?? "format inherited"} / ${assignment.project.policy ?? "policy inherited"}`
                    : "none"}
                </span>{" "}
                · {assignment.sceneCount} scene override(s) · {assignment.clipCount} clip override(s) · recorded{" "}
                {assignment.appliedAt ?? "unknown"}
              </p>
            ) : null}
          </div>

          {/* --------------------------------------------- planned clips ---- */}
          {clips.length > 0 ? (
            <div className="rounded-lg border border-line bg-panel-3/40 p-2.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">Planned clips</p>
              <ul className="mt-2 space-y-1.5">
                {clips.map((c) => (
                  <li key={c.clipId}>
                    <button
                      type="button"
                      disabled={operationallyBusy}
                      onClick={() => {
                        onClip(c.clipId);
                        onScope("clip");
                      }}
                      className={`w-full rounded border px-2 py-1.5 text-left transition-colors ${
                        c.clipId === shown?.clipId ? "border-accent-line bg-accent-soft" : "border-line/70 bg-panel-2/50 hover:border-line"
                      }`}
                    >
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[10px] text-ink-faint">{c.clipId}</span>
                        <span className="truncate text-[11px] text-ink">{c.label}</span>
                        <Badge tone={c.kind === "shorts" ? "accent" : "neutral"}>
                          {c.kind === "shorts" ? `${c.platformTarget ?? "shorts"} clip` : "scene clip"}
                        </Badge>
                        <Badge tone="neutral">{c.target.aspect}</Badge>
                        <span className="ml-auto font-mono text-[10px] text-ink-faint">
                          {formatMs(c.startMs)}–{formatMs(c.endMs)} · {c.durationSeconds}s · {c.sourceClips} source clip(s)
                        </span>
                      </span>
                      <span className="mt-1 block font-mono text-[10px] text-ink-dim">
                        crop {rectLabel(c.geometry.crop)} · scale {c.geometry.scale}× · policy {c.policy.id} ({c.policy.anchorSource}
                        ) · keyframes {c.motion.keyframeCount}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* ------------------------------------ the selected clip plan ---- */}
          {shown ? (
            <div className="rounded-lg border border-line bg-panel-3/40 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  {shown.clipId} — computed geometry
                </p>
                <Badge tone="neutral">{shown.target.label}</Badge>
                <Badge tone={shown.kind === "shorts" ? "accent" : "neutral"}>
                  {shown.kind === "shorts" ? `${shown.platformTarget ?? "shorts"} · 9:16 target` : "timeline clip"}
                </Badge>
                <span className="ml-auto font-mono text-[10px] text-ink-faint">
                  {formatMs(shown.startMs)}–{formatMs(shown.endMs)} · {shown.durationMs} ms
                </span>
              </div>

              <FramingDiagram clip={shown} />

              <div className="mt-2 grid grid-cols-2 gap-2 xl:grid-cols-4">
                <FramingMetric label="crop window (source px)" value={rectLabel(shown.geometry.crop)} />
                <FramingMetric label="scale / upscale" value={`${shown.geometry.scale}×`} />
                <FramingMetric label="crop centre (source px)" value={`${shown.geometry.cropCentrePx.x},${shown.geometry.cropCentrePx.y}`} />
                <FramingMetric
                  label="crop normalized"
                  value={`${shown.geometry.cropNormalized.width}×${shown.geometry.cropNormalized.height} @ ${shown.geometry.cropNormalized.x},${shown.geometry.cropNormalized.y}`}
                />
                <FramingMetric label="travel (x, y)" value={`${shown.geometry.travelPx.x}px, ${shown.geometry.travelPx.y}px`} />
                <FramingMetric
                  label="anchor → offset from centre"
                  value={`${shown.geometry.anchor.x},${shown.geometry.anchor.y} → ${shown.geometry.anchorOffsetPx.x}px, ${shown.geometry.anchorOffsetPx.y}px`}
                />
                <FramingMetric
                  label="source retained"
                  value={`${pctLabel(shown.geometry.retained.widthFraction)} cols · ${pctLabel(shown.geometry.retained.heightFraction)} rows · ${pctLabel(shown.geometry.retained.areaFraction)} area`}
                />
                <FramingMetric
                  label="source action-safe retained"
                  value={`${pctLabel(shown.geometry.sourceActionSafeRetained.xFraction)} x · ${pctLabel(shown.geometry.sourceActionSafeRetained.yFraction)} y · ${pctLabel(shown.geometry.sourceActionSafeRetained.areaFraction)} area`}
                />
              </div>

              <p className="mt-2 text-[11px] text-ink-dim">{shown.delivery.note}</p>
              <p className="mt-1 text-[10px] text-ink-faint">
                source frame: {shown.source.widthPx}×{shown.source.heightPx} ({shown.source.aspect}) from{" "}
                <span className="font-mono">{shown.source.origin}</span> — {shown.source.originDetail}
              </p>
              <p className="mt-1 text-[10px] text-ink-faint">
                target format: <span className="font-mono">{shown.target.id}</span> from{" "}
                <span className="font-mono">{shown.target.origin}</span> — {shown.target.originDetail}
              </p>
              {shown.override ? (
                <p className="mt-1 text-[10px] text-ink-dim">
                  override in force: <span className="font-mono">{shown.override.source}</span> scope — format{" "}
                  <span className="font-mono">{shown.override.format ?? "inherited"}</span> · policy{" "}
                  <span className="font-mono">{shown.override.policy ?? "inherited"}</span> · anchor{" "}
                  <span className="font-mono">
                    {shown.override.anchor ? `${shown.override.anchor.x},${shown.override.anchor.y}` : "inherited"}
                  </span>
                </p>
              ) : null}

              {/* ------------------------------------------- the policy ---- */}
              <div className="mt-2 rounded border border-line/70 bg-panel-2/50 p-2">
                <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink">
                  <span className="font-mono text-[10px] text-ink-faint">{shown.policy.id}</span>
                  {shown.policy.label}
                  <Badge tone={shown.policy.requested ? "accent" : "neutral"}>
                    {shown.policy.requested ? "requested" : "engine choice"}
                  </Badge>
                  <Badge tone="neutral">anchor from {shown.policy.anchorSource}</Badge>
                  <span className="ml-auto font-mono text-[10px] text-ink-faint">
                    engine default would be {shown.policy.engineDefault}
                  </span>
                </p>
                <p className="mt-1 text-[10px] leading-relaxed text-ink-faint">{shown.policy.rule}</p>
                <p className="mt-1 text-[10px] leading-relaxed text-ink-dim">why this one: {shown.policy.selectedBecause}</p>
                {shown.policy.signals.length > 0 ? (
                  <ul className="mt-1 space-y-0.5">
                    {shown.policy.signals.map((s) => (
                      <li key={s.signal} className="text-[10px] text-ink-faint">
                        · {s.signal} <span className="font-mono">{s.value}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {shown.policy.alternatives.length > 0 ? (
                  <ul className="mt-1 space-y-0.5">
                    {shown.policy.alternatives.map((a) => (
                      <li key={a.policy} className="text-[10px] text-ink-faint">
                        · alternative <span className="font-mono">{a.policy}</span>: {a.note}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>

              {/* ----------------------------------------- safe areas ---- */}
              <div className="mt-2 rounded border border-line/70 bg-panel-2/50 p-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                  Safe areas ({shown.target.resolution})
                </p>
                <p className="mt-1 text-[10px] text-ink-dim">
                  action-safe <span className="font-mono">{rectLabel(shown.safeAreas.target.actionSafe)}</span> · title-safe{" "}
                  <span className="font-mono">{rectLabel(shown.safeAreas.target.titleSafe)}</span> · caption-safe{" "}
                  <span className="font-mono">{rectLabel(shown.safeAreas.target.captionSafe)}</span>
                </p>
                <p className="mt-1 text-[10px] text-ink-faint">caption band: {shown.safeAreas.target.captionBasis}</p>
                <p className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-ink-faint">
                  source action-safe <span className="font-mono">{rectLabel(shown.safeAreas.sourceActionSafe)}</span> · clamp{" "}
                  <Badge tone={shown.safeAreas.safeAreaClamp.applied ? "accent" : "neutral"}>
                    {shown.safeAreas.safeAreaClamp.applied ? "window shifted" : "no shift needed"}
                  </Badge>{" "}
                  <span className="font-mono">
                    {shown.safeAreas.safeAreaClamp.shiftPx.x}px, {shown.safeAreas.safeAreaClamp.shiftPx.y}px
                  </span>
                </p>
                <p className="mt-1 text-[10px] text-ink-faint">{shown.safeAreas.safeAreaClamp.note}</p>
              </div>

              {/* --------------------------------------- keyframe path ---- */}
              <div className="mt-2 rounded border border-line/70 bg-panel-2/50 p-2">
                <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink">
                  Keyframe path <Badge tone={shown.motion.kind === "pan" ? "accent" : "neutral"}>{shown.motion.kind}</Badge>
                  <span className="font-mono text-[10px] text-ink-faint">
                    {shown.motion.keyframeCount} keyframe(s) · {shown.motion.basis} · travel {shown.motion.travelPx}px
                  </span>
                </p>
                <p className="mt-1 text-[10px] text-ink-faint">{shown.motion.rule}</p>
                <ul className="mt-1 space-y-0.5">
                  {shown.motion.keyframes.map((k) => (
                    <li key={k.index} className="font-mono text-[10px] text-ink-dim">
                      #{k.index} t={k.tMs}ms ({k.relative}) · crop {rectLabel(k.crop)} · norm {k.cropNormalized.width}×
                      {k.cropNormalized.height} @ {k.cropNormalized.x},{k.cropNormalized.y} · scale {k.scale}× · {k.note}
                    </li>
                  ))}
                </ul>
              </div>

              {/* ---------------------------------------- caption check ---- */}
              <div className="mt-2 rounded border border-line/70 bg-panel-2/50 p-2">
                <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink">
                  Caption check
                  <Badge tone={shown.caption.present ? "ok" : "neutral"}>
                    {shown.caption.present ? "captions clip on the timeline" : "no captions clip"}
                  </Badge>
                  {shown.caption.insideTargetCaptionSafe !== null ? (
                    <Badge tone={shown.caption.insideTargetCaptionSafe ? "ok" : "danger"}>
                      {shown.caption.insideTargetCaptionSafe ? "band lands inside the target band" : "band lands outside the target band"}
                    </Badge>
                  ) : null}
                </p>
                {shown.caption.band ? (
                  <p className="mt-1 font-mono text-[10px] text-ink-dim">
                    band {rectLabel(shown.caption.band)} · rows kept {pctLabel(shown.caption.verticalFraction)} · cols kept{" "}
                    {pctLabel(shown.caption.horizontalFraction)} · area {pctLabel(shown.caption.areaFraction)} · in target{" "}
                    {shown.caption.inTarget ? rectLabel(shown.caption.inTarget) : "—"} · {shown.caption.sourceRows}
                  </p>
                ) : null}
                <p className="mt-1 text-[10px] text-ink-faint">{shown.caption.note}</p>
              </div>
            </div>
          ) : null}

          {/* ------------------------------------- the anchor + detector ---- */}
          {anchors ? (
            <div className="rounded-lg border border-line bg-panel-3/40 p-2.5">
              <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                <Info size={12} /> Subject anchor: unknown
                <Badge tone="danger">anchor is a rule position</Badge>
              </p>
              <p className="mt-1.5 text-[11px] text-ink-dim">{anchors.reason}</p>
              <ul className="mt-1.5 space-y-0.5">
                {anchors.checked.map((c) => (
                  <li key={c.field} className="text-[10px] text-ink-faint">
                    · <span className="font-mono">{c.field}</span> — {c.holds}{" "}
                    <span className="font-mono">{c.locatesSubject ? "locates a subject" : "no subject position"}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {detectorGate && detectorGate.connected === false ? (
            <ProviderNotConnected providerKeys={detectorGate.requiredEnv} note={detectorGate.note} />
          ) : null}
          {renderGate && renderGate.connected === false ? (
            <ProviderNotConnected providerKeys={renderGate.requiredEnv} note={renderGate.note} />
          ) : null}
        </div>
      ) : null}

      {/* ------------------------------------------- Block 5a linkage ---- */}
      {repurposing ? (
        <div className="mt-3 rounded-lg border border-line bg-panel-3/30 p-2.5">
          <p className="flex flex-wrap items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
            <Scissors size={12} /> Repurposed clips (Block 5a)
            <Badge tone={repurposing.applied ? "ok" : "neutral"}>
              {repurposing.applied ? `${repurposing.clipCount} clip(s) reframed here too` : "no set applied"}
            </Badge>
          </p>
          <p className="mt-1.5 text-[11px] text-ink-faint">{repurposing.note}</p>
          {Object.keys(repurposing.byTarget).length > 0 ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              {Object.entries(repurposing.byTarget).map(([target, count]) => (
                <Badge key={target} tone="accent">
                  {target} {count} · {repurposing.aspects[target] ?? "—"}
                </Badge>
              ))}
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" disabled={operationallyBusy} onClick={() => onPlanAt("9:16")}>
              {busy === "planReframe" ? <Loader2 size={13} className="animate-spin" /> : <Film size={13} />} Plan this project at
              9:16
            </Button>
            <span className="text-[10px] text-ink-faint">
              A 9:16 Shorts/Reel clip is planned against its own platform target above; with no set applied, plan the whole project
              vertically instead — or run Apply set in the repurposing panel, then plan the{" "}
              <span className="font-mono">shorts-*</span> clips here.
            </span>
          </div>
        </div>
      ) : null}

      {gate && !result ? (
        <div className="mt-3">
          <ProviderNotConnected providerKeys={gate.requiredEnv} note={gate.note} />
        </div>
      ) : null}
      {sceneId ? (
        <p className="mt-2 text-[10px] text-ink-faint">
          Active scene <span className="font-mono">{sceneId}</span> is used when the scope is “This scene”.
        </p>
      ) : null}
    </Card>
  );
}
