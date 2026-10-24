/**
 * THE EXPORT SPECIFICATION SURFACE (Phase 8, block 2a) — server-rendered.
 *
 * WHAT IT SHOWS
 *   1. The matrix: every axis the owner listed, every option in it, and — for
 *      each one — where its truth comes from. Three values and no fourth:
 *      `computed` (a number this build evaluates today), `gated` (a real choice
 *      whose production needs an input this build does not have, and the missing
 *      input is NAMED), `provider` (handed to a keyed AI provider, whose live key
 *      state is attached at response time).
 *   2. The seven presets, each RESOLVED from that matrix, printing every value it
 *      sets and the reason for it.
 *   3. The YouTube delivery master: the twelve concrete choices, each with its
 *      reason, and the boundary the surface never crosses.
 *   4. The recommendation, computed from the selected project's own measured
 *      facts, printing the reasons — and, when a fact could not be measured, a
 *      partial-basis statement that names it rather than inventing it.
 *
 * NO CLIENT JAVASCRIPT. Everything is server-rendered text so a reader (and a
 * browser probe) sees the same thing, and the two selectors are plain GET forms.
 * Nothing on this surface produces a file: the encode, mux and checksum stages
 * are blocked and name the ffmpeg binary.
 */
import { Badge, Card } from "@/components/ui";
import {
  SPEC_AXIS_LABELS,
  SPEC_DELIVERY_STATEMENT,
  SPEC_MATRIX,
  SPEC_MATRIX_VERSION,
  type SpecAxis,
  type SpecTruth,
} from "@/lib/export/spec-matrix";
import type { ExportPresetSpec } from "@/lib/export/presets";
import { specProvenanceTally } from "@/lib/export/presets";
import { YOUTUBE_MASTER_BOUNDARY, encodeCommandPlan, masterChoices } from "@/lib/export/youtube-master";

type Tone = "neutral" | "accent" | "ok" | "danger";

const TRUTH_TONE: Record<SpecTruth, Tone> = { computed: "ok", gated: "neutral", provider: "accent" };
const TRUTH_WORD: Record<SpecTruth, string> = {
  computed: "computed",
  gated: "gated",
  provider: "provider",
};

interface OptionLike {
  id: string;
  label: string;
  provenance: {
    truth: SpecTruth;
    source: string;
    basis: string;
    missingInput: string | null;
    capability: string | null;
  };
}

interface ProviderState {
  capability: string;
  connected: boolean;
  requiredEnv: string[];
  reason: string;
  checkedAt: string;
}

export interface ExportSpecPanelProps {
  presets: readonly ExportPresetSpec[];
  /** The preset whose YouTube master is shown. */
  selectedPresetId: string;
  /** The project the recommendation was computed for (null when none exists). */
  selectedProjectId: string | null;
  projects: Array<{ id: string; title: string }>;
  recommendation: Record<string, unknown> | null;
  providerState: ProviderState;
}

function TruthBadge({ truth }: { truth: SpecTruth }) {
  return <Badge tone={TRUTH_TONE[truth]}>{TRUTH_WORD[truth]}</Badge>;
}

function AxisBlock({ axis }: { axis: SpecAxis }) {
  const options = SPEC_MATRIX[axis] as unknown as readonly OptionLike[];
  const counts: Record<SpecTruth, number> = { computed: 0, gated: 0, provider: 0 };
  for (const o of options) counts[o.provenance.truth] += 1;
  return (
    <div className="rounded-xl border border-line bg-panel-2/40 p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h4 className="text-[13px] font-semibold text-ink">{SPEC_AXIS_LABELS[axis]}</h4>
        <span className="text-[11px] text-ink-faint">{options.length} options</span>
        <span className="text-[11px] text-ink-faint">
          {counts.computed} computed · {counts.gated} gated · {counts.provider} provider
        </span>
      </div>
      <ul className="mt-2 space-y-1.5">
        {options.map((o) => (
          <li key={o.id} className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-1.5">
              <span className="font-mono text-[11px] text-ink-faint">{o.id}</span>
              <span className="min-w-0 break-words text-[12px] text-ink">{o.label}</span>
              <TruthBadge truth={o.provenance.truth} />
            </div>
            <p className="mt-0.5 break-words text-[11px] leading-relaxed text-ink-faint">
              {o.provenance.missingInput
                ? `missing input: ${o.provenance.missingInput} — `
                : o.provenance.capability
                  ? `capability: ${o.provenance.capability} — `
                  : `source: ${o.provenance.source} — `}
              {o.provenance.basis}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PresetCard({ spec }: { spec: ExportPresetSpec }) {
  const tally = specProvenanceTally(spec);
  const rc = spec.video.rateControl;
  const rate = rc.mode === "crf" ? `CRF ${rc.crf} (planning equivalent ${rc.targetVideoBitrateKbps} kbps)` : `${rc.mode.toUpperCase()} ${rc.targetVideoBitrateKbps} kbps${rc.maxVideoBitrateKbps ? ` / cap ${rc.maxVideoBitrateKbps} kbps` : ""}`;
  return (
    <div className="rounded-xl border border-line bg-panel-2/40 p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <h4 className="text-[13px] font-semibold text-ink">{spec.label}</h4>
        <span className="font-mono text-[11px] text-ink-faint">{spec.id}</span>
        <span className="text-[11px] text-ink-faint">
          {tally.computed} computed · {tally.gated} gated · {tally.provider} provider
        </span>
      </div>
      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-[12px] sm:grid-cols-2">
        <div className="flex min-w-0 gap-1.5">
          <dt className="shrink-0 text-ink-faint">frame</dt>
          <dd className="min-w-0 break-words text-ink">{spec.resolution} · {spec.aspect}</dd>
        </div>
        <div className="flex min-w-0 gap-1.5">
          <dt className="shrink-0 text-ink-faint">container</dt>
          <dd className="min-w-0 break-words text-ink">{spec.container}</dd>
        </div>
        <div className="flex min-w-0 gap-1.5">
          <dt className="shrink-0 text-ink-faint">codec</dt>
          <dd className="min-w-0 break-words text-ink">
            {spec.video.codec} {spec.video.profile}
            {spec.video.level ? ` @ L${spec.video.level}` : ""} · {spec.video.pixelFormat}
          </dd>
        </div>
        <div className="flex min-w-0 gap-1.5">
          <dt className="shrink-0 text-ink-faint">frame rate</dt>
          <dd className="min-w-0 break-words text-ink">{spec.video.frameRate} fps</dd>
        </div>
        <div className="flex min-w-0 gap-1.5">
          <dt className="shrink-0 text-ink-faint">rate control</dt>
          <dd className="min-w-0 break-words text-ink">{rate}</dd>
        </div>
        <div className="flex min-w-0 gap-1.5">
          <dt className="shrink-0 text-ink-faint">colour</dt>
          <dd className="min-w-0 break-words text-ink">
            {spec.colour.display} · {spec.colour.standard} · {spec.colour.transfer} · {spec.colour.peakNits} nits
          </dd>
        </div>
        <div className="flex min-w-0 gap-1.5">
          <dt className="shrink-0 text-ink-faint">audio</dt>
          <dd className="min-w-0 break-words text-ink">
            {spec.audio.codec} {spec.audio.audioBitrateKbps} kbps · {spec.audio.sampleRateHz} Hz · {spec.audio.channelLayout}
          </dd>
        </div>
        <div className="flex min-w-0 gap-1.5">
          <dt className="shrink-0 text-ink-faint">loudness</dt>
          <dd className="min-w-0 break-words text-ink">
            {spec.audio.loudnessTargetLufs} LUFS · true peak {spec.audio.truePeakDbfs} dBFS
          </dd>
        </div>
        <div className="flex min-w-0 gap-1.5">
          <dt className="shrink-0 text-ink-faint">upscale</dt>
          <dd className="min-w-0 break-words text-ink">{spec.upscale.label}</dd>
        </div>
      </dl>
      <p className="mt-1.5 break-words font-mono text-[11px] leading-relaxed text-ink-faint">{spec.levelArithmetic}</p>
      <details className="mt-2">
        <summary className="cursor-pointer text-[12px] font-semibold text-accent">
          Why each of the {spec.axes.length} values — and where its truth comes from
        </summary>
        <ul className="mt-1.5 space-y-1.5">
          {spec.axes.map((a) => (
            <li key={a.axis} className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-1.5">
                <span className="font-mono text-[11px] text-ink-faint">{a.axis}</span>
                <span className="min-w-0 break-words text-[12px] font-semibold text-ink">{String(a.value)}</span>
                <TruthBadge truth={a.truth} />
              </div>
              <p className="mt-0.5 break-words text-[11px] leading-relaxed text-ink-dim">{a.reason}</p>
              <p className="break-words text-[11px] leading-relaxed text-ink-faint">
                {a.missingInput ? `missing input: ${a.missingInput}` : a.capability ? `capability: ${a.capability}` : `source: ${a.source}`}
              </p>
            </li>
          ))}
        </ul>
      </details>
      <p className="mt-1.5 break-words text-[11px] text-ink-faint">{spec.deliveredStatement}</p>
    </div>
  );
}

export function ExportSpecPanel({
  presets,
  selectedPresetId,
  selectedProjectId,
  projects,
  recommendation,
  providerState,
}: ExportSpecPanelProps) {
  const axes = Object.keys(SPEC_AXIS_LABELS) as SpecAxis[];
  const total = axes.reduce((n, a) => n + (SPEC_MATRIX[a] as readonly unknown[]).length, 0);
  const selected = presets.find((p) => p.id === selectedPresetId) ?? presets[0];

  const rec = recommendation as
    | {
        project: { id: string; title: string };
        measurement: Record<string, unknown>;
        recommendation: {
          presetId: string;
          presetLabel: string;
          headline: string;
          reasons: Array<{ fact: string; reading: string; why: string }>;
          basis: { complete: boolean; statement: string; measured: Array<{ fact: string; value: string }>; missing: Array<{ fact: string; why: string; instead: string }> };
          notClaimed: string[];
        };
      }
    | null;

  return (
    <Card className="mt-8 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-base font-semibold text-ink">Export specification</h2>
          <p className="mt-1 max-w-3xl text-sm text-ink-dim">{SPEC_DELIVERY_STATEMENT}</p>
          <p className="mt-1 text-[12px] text-ink-faint">
            matrix {SPEC_MATRIX_VERSION} · {axes.length} axes · {total} options · {presets.length} presets resolved from them
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="ok">{SPEC_MATRIX.resolutions.length} resolutions</Badge>
          <Badge tone="neutral">{SPEC_MATRIX.videoCodecs.length} codecs</Badge>
          <Badge tone="neutral">{SPEC_MATRIX.rateModes.length} rate modes</Badge>
        </div>
      </div>

      <div className="mt-4 rounded-xl border border-line bg-panel-2/40 p-3">
        <p className="text-[12px] font-semibold text-ink">AI upscale — the one provider-backed option</p>
        <p className="mt-0.5 break-words text-[11px] leading-relaxed text-ink-dim">
          capability <span className="font-mono">{providerState.capability}</span> · connected:{" "}
          <strong className="text-ink">{String(providerState.connected)}</strong> · env var names:{" "}
          {providerState.requiredEnv.length > 0 ? providerState.requiredEnv.join(", ") : "none wired"}
        </p>
        <p className="break-words text-[11px] leading-relaxed text-ink-faint">
          derived at {providerState.checkedAt} — {providerState.reason}
        </p>
      </div>

      <h3 className="mt-5 font-display text-sm font-semibold text-ink">The matrix — every option, and where its truth comes from</h3>
      <div className="mt-2 grid grid-cols-1 gap-2 lg:grid-cols-2">
        {axes.map((a) => (
          <AxisBlock key={a} axis={a} />
        ))}
      </div>

      <h3 className="mt-6 font-display text-sm font-semibold text-ink">
        The {presets.length} presets — each resolved from the matrix, never typed
      </h3>
      <p className="mt-1 max-w-3xl text-[12px] text-ink-dim">
        A preset holds only option ids; the resolver looks each one up, computes the level from the pixel rate and the CRF
        from the quality tier, and calls the legality check. A preset holding a value outside the matrix cannot be
        constructed, and an illegal combination throws instead of being emitted.
      </p>
      <div className="mt-2 space-y-2">
        {presets.map((p) => (
          <PresetCard key={p.id} spec={p} />
        ))}
      </div>

      <h3 className="mt-6 font-display text-sm font-semibold text-ink">
        The YouTube delivery master — {selected.label}
      </h3>
      <form method="get" className="mt-2 flex flex-wrap items-end gap-2">
        {selectedProjectId && <input type="hidden" name="specProject" value={selectedProjectId} />}
        <label className="text-[11px] text-ink-faint" htmlFor="masterPreset">
          preset
        </label>
        <select
          id="masterPreset"
          name="masterPreset"
          defaultValue={selected.id}
          className="min-w-0 max-w-full rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-[12px] text-ink"
        >
          {presets.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-semibold text-ink">
          Show its master
        </button>
      </form>
      <ul className="mt-2 space-y-1.5">
        {masterChoicesFor(selected).map((c) => (
          <li key={c.id} className="min-w-0 rounded-xl border border-line bg-panel-2/40 px-3 py-2">
            <div className="flex flex-wrap items-baseline gap-1.5">
              <span className="text-[12px] font-semibold text-ink">{c.label}</span>
              <TruthBadge truth={c.truth} />
            </div>
            <p className="break-words text-[12px] text-ink">{c.value}</p>
            <p className="break-words text-[11px] leading-relaxed text-ink-dim">{c.reason}</p>
          </li>
        ))}
      </ul>
      <div className="mt-2 rounded-xl border border-danger/40 bg-danger/10 px-3 py-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-danger">What this master does not claim</p>
        <ul className="mt-1 space-y-1">
          {MASTER_BOUNDARY.map((b) => (
            <li key={b} className="break-words text-[11px] leading-relaxed text-ink-dim">
              {b}
            </li>
          ))}
        </ul>
      </div>
      <details className="mt-2">
        <summary className="cursor-pointer text-[12px] font-semibold text-accent">
          The exact command the encode stage would spawn — and the input it is blocked on
        </summary>
        <p className="mt-1 break-words font-mono text-[11px] leading-relaxed text-ink-dim">{masterCommandFor(selected)}</p>
        <p className="break-words text-[11px] leading-relaxed text-ink-faint">
          Nothing ran. The encode stage of a render job is BLOCKED and names the ffmpeg binary as the missing input;
          printing the argv makes the gate more informative, not weaker.
        </p>
      </details>

      <h3 className="mt-6 font-display text-sm font-semibold text-ink">Smart recommendation — from this project&apos;s own measured facts</h3>
      <form method="get" className="mt-2 flex flex-wrap items-end gap-2">
        {selected.id && <input type="hidden" name="masterPreset" value={selected.id} />}
        <label className="text-[11px] text-ink-faint" htmlFor="specProject">
          project
        </label>
        <select
          id="specProject"
          name="specProject"
          defaultValue={selectedProjectId ?? ""}
          className="min-w-0 max-w-full rounded-lg border border-line bg-panel-2 px-3 py-1.5 text-[12px] text-ink"
        >
          {projects.length === 0 && <option value="">No projects</option>}
          {projects.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
        <button type="submit" className="rounded-lg border border-line px-3 py-1.5 text-[12px] font-semibold text-ink">
          Recommend
        </button>
      </form>

      {!rec ? (
        <p className="mt-2 text-[12px] text-ink-dim">
          No project to measure yet, so there is no recommendation. It is computed from a project&apos;s own rows — scene
          durations, its aspect, its asset dimensions — and never from a guess.
        </p>
      ) : (
        <div className="mt-2 rounded-xl border border-line bg-panel-2/40 p-3">
          <p className="break-words text-[13px] font-semibold text-ink">{rec.recommendation.headline}</p>
          <p className="mt-0.5 break-words text-[11px] text-ink-faint">
            project {rec.project.title} · preset <span className="font-mono">{rec.recommendation.presetId}</span>
          </p>
          <p className="mt-1 break-words text-[12px] leading-relaxed text-ink-dim">{rec.recommendation.basis.statement}</p>
          <ol className="mt-2 space-y-1.5">
            {rec.recommendation.reasons.map((r, i) => (
              <li key={`${r.fact}-${i}`} className="min-w-0">
                <p className="break-words text-[12px] text-ink">
                  <span className="font-mono text-[11px] text-ink-faint">{i + 1}. {r.fact}</span> — {r.reading}
                </p>
                <p className="break-words text-[11px] leading-relaxed text-ink-dim">{r.why}</p>
              </li>
            ))}
          </ol>
          {rec.recommendation.basis.missing.length > 0 && (
            <div className="mt-2 rounded-lg border border-danger/40 bg-danger/10 px-2 py-1.5">
              <p className="text-[11px] font-semibold text-danger">Not measurable — and not invented</p>
              <ul className="mt-1 space-y-1">
                {rec.recommendation.basis.missing.map((x) => (
                  <li key={x.fact} className="break-words text-[11px] leading-relaxed text-ink-dim">
                    <strong className="text-ink">{x.fact}</strong> — {x.why}. Instead: {x.instead}.
                  </li>
                ))}
              </ul>
            </div>
          )}
          <details className="mt-2">
            <summary className="cursor-pointer text-[12px] font-semibold text-accent">What this recommendation does not claim</summary>
            <ul className="mt-1 space-y-1">
              {rec.recommendation.notClaimed.map((x) => (
                <li key={x} className="break-words text-[11px] leading-relaxed text-ink-faint">
                  {x}
                </li>
              ))}
            </ul>
          </details>
        </div>
      )}
    </Card>
  );
}

/* The master helpers live in the pure module; these thin wrappers keep the
   component free of duplicated numbers. */
const MASTER_BOUNDARY = YOUTUBE_MASTER_BOUNDARY;

function masterChoicesFor(spec: ExportPresetSpec) {
  return masterChoices(spec);
}

function masterCommandFor(spec: ExportPresetSpec): string {
  const plan = encodeCommandPlan(spec);
  return `${plan.binary} ${plan.args.join(" ")}`;
}
