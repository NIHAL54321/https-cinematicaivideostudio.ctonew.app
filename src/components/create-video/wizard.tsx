"use client";

/**
 * Create Video wizard — the 8-step entry flow (IDEA → SCRIPT → STORY → STORYBOARD).
 *
 * Steps: (1) idea, (2) input type, (3) format, (4) duration (validated against
 * format), (5) visual style (incl. Faceless Creator), (6) language, (7) voice,
 * (8) review + "CREATE MY VIDEO".
 *
 * On CREATE the wizard calls POST /api/studio/magic-create, which persists a
 * REAL project + structure plan and honestly stops at the first AI step that
 * needs a provider ("Provider Not Connected" — never faked).
 */
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Clapperboard,
  FileText,
  Film,
  Languages,
  Loader2,
  Mic,
  Palette,
  PenLine,
  Sparkles,
  Timer,
  Wand2,
} from "lucide-react";
import { apiFetch } from "@/components/projects/client-api";
import { Badge, Button } from "@/components/ui";
import {
  DURATION_OPTIONS_LABELED,
  FORMAT_OPTIONS,
  LANGUAGES,
  VISUAL_STYLES,
  VOICE_PRESETS,
} from "./options";
import { INPUT_TYPE_LABELS, INPUT_TYPES } from "@/lib/studio/types";
import { allowedDurationOptions, DEFAULT_DURATION_FOR_FORMAT } from "@/lib/studio/budgeting";
import { selectStructure } from "@/lib/studio/structures";
import type { InputType, VideoFormat } from "@/lib/studio/types";

const STEP_LABELS = [
  "Your idea",
  "Input type",
  "Format",
  "Duration",
  "Visual style",
  "Language",
  "Voice",
  "Review",
];

interface MagicCreateResponse {
  project: { id: string };
}

export function CreateVideoWizard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // Faceless Mode entry: /create-video?mode=faceless pre-selects the
  // "faceless-creator" visual style. Strictly additive — absent param = unchanged.
  const facelessMode = searchParams.get("mode") === "faceless";
  const [step, setStep] = useState(0);
  const [idea, setIdea] = useState("");
  const [inputType, setInputType] = useState<InputType | null>(null);
  const [format, setFormat] = useState<VideoFormat | null>(null);
  const [duration, setDuration] = useState<number | null>(null);
  const [style, setStyle] = useState<string | null>(facelessMode ? "faceless-creator" : null);
  const [language, setLanguage] = useState<string | null>(null);
  const [voice, setVoice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const allowedDurations = useMemo(() => (format ? allowedDurationOptions(format) : []), [format]);
  const structurePreview = useMemo(
    () => (format && idea.trim().length >= 3 ? selectStructure(format, idea).structure.name : null),
    [format, idea],
  );

  function stepValid(): boolean {
    switch (step) {
      case 0:
        return idea.trim().length >= 3;
      case 1:
        return inputType !== null;
      case 2:
        return format !== null;
      case 3:
        return duration !== null && (allowedDurations as number[]).includes(duration);
      case 4:
        return style !== null;
      case 5:
        return language !== null;
      case 6:
        return voice !== null;
      case 7:
        return (
          idea.trim().length >= 3 &&
          inputType !== null &&
          format !== null &&
          duration !== null &&
          (allowedDurations as number[]).includes(duration) &&
          style !== null &&
          language !== null &&
          voice !== null
        );
      default:
        return false;
    }
  }

  function handleFormatChange(f: VideoFormat) {
    setFormat(f);
    if (duration === null || !(allowedDurationOptions(f) as number[]).includes(duration)) {
      setDuration(DEFAULT_DURATION_FOR_FORMAT[f]);
    }
  }

  async function handleCreate() {
    if (!stepValid() || !format || !inputType || !duration || !style || !language || !voice) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await apiFetch<MagicCreateResponse>("/api/studio/magic-create", {
        method: "POST",
        body: JSON.stringify({
          inputType,
          sourceText: idea.trim(),
          format,
          durationSeconds: duration,
          style,
          language,
          voice,
        }),
      });
      sessionStorage.setItem(`magic-${res.project.id}`, JSON.stringify({ done: true }));
      router.push(`/create-video/magic?projectId=${res.project.id}`);
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : "Could not create the project.");
      setSubmitting(false);
    }
  }

  const canGoBack = step > 0;
  const canGoNext = step < 7 && stepValid();

  return (
    <div className="mx-auto max-w-3xl">
      {/* -------------------------------------------------- step indicator */}
      <div className="mb-8">
        <div className="flex items-center justify-between gap-1">
          {STEP_LABELS.map((label, i) => {
            const done = i < step;
            const active = i === step;
            return (
              <button
                key={label}
                onClick={() => i < step && setStep(i)}
                disabled={i > step}
                className="group flex flex-1 flex-col items-center gap-1.5 cursor-pointer disabled:cursor-default"
                aria-label={label}
              >
                <span
                  className={[
                    "flex h-8 w-8 items-center justify-center rounded-full border text-[12px] font-semibold transition-colors",
                    done
                      ? "border-accent bg-accent text-void"
                      : active
                        ? "border-accent bg-accent-soft text-accent ring-2 ring-accent/25"
                        : "border-line bg-panel-2 text-ink-faint group-hover:border-line-soft",
                  ].join(" ")}
                >
                  {done ? <Check size={13} /> : i + 1}
                </span>
                <span
                  className={[
                    "hidden text-[10px] font-medium uppercase tracking-wider sm:block",
                    active ? "text-accent" : done ? "text-ink-dim" : "text-ink-faint",
                  ].join(" ")}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 h-px w-full bg-line-soft">
          <div
            className="h-px bg-accent transition-all duration-300"
            style={{ width: `${((step + 1) / 8) * 100}%` }}
          />
        </div>
      </div>

      {/* ------------------------------------------------------ step panels */}
      <div className="glass p-6 sm:p-8">
        {step === 0 && (
          <StepShell
            icon={PenLine}
            title="What do you want to create?"
            description="One line is enough — the studio turns it into a structure, then a script when AI is connected."
          >
            <textarea
              autoFocus
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              rows={5}
              placeholder="e.g. The history of coffee — from a peasant drink to a global obsession"
              className="w-full rounded-xl border border-line bg-panel-3/60 px-4 py-3.5 text-base text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent-line focus:ring-2 focus:ring-accent/20 transition-colors resize-none"
            />
            <p className="text-right text-[11px] text-ink-faint">{idea.trim().length} characters</p>
          </StepShell>
        )}

        {step === 1 && (
          <StepShell
            icon={FileText}
            title="What are you starting from?"
            description="The source of your video — the studio adapts the flow to it."
          >
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {INPUT_TYPES.map((t) => (
                <SelectCard
                  key={t}
                  selected={inputType === t}
                  onClick={() => setInputType(t)}
                  title={INPUT_TYPE_LABELS[t]}
                  description={
                    t === "IDEA"
                      ? "A concept or one-liner to develop."
                      : t === "SCRIPT"
                        ? "An existing script to visualize."
                        : t === "ARTICLE"
                          ? "An article to turn into a video."
                          : t === "URL"
                            ? "A link to a page to adapt."
                            : "Uploaded notes or brief."
                  }
                />
              ))}
            </div>
          </StepShell>
        )}

        {step === 2 && (
          <StepShell
            icon={Film}
            title="Which format?"
            description="Format sets the aspect ratio and the duration range."
          >
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {FORMAT_OPTIONS.map((f) => (
                <SelectCard
                  key={f.id}
                  selected={format === f.id}
                  onClick={() => handleFormatChange(f.id)}
                  title={f.label}
                  description={f.description}
                  badge={f.badge}
                />
              ))}
            </div>
          </StepShell>
        )}

        {step === 3 && (
          <StepShell
            icon={Timer}
            title="How long should it be?"
            description={
              format
                ? `Allowed for ${FORMAT_OPTIONS.find((f) => f.id === format)?.label ?? format}: ${
                    DURATION_OPTIONS_LABELED.filter((d) => (allowedDurations as number[]).includes(d.seconds))
                      .map((d) => d.label)
                      .join(", ")
                  }.`
                : "Pick a format first."
            }
          >
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {DURATION_OPTIONS_LABELED.map((d) => {
                const allowed = format ? (allowedDurations as number[]).includes(d.seconds) : false;
                const selected = duration === d.seconds;
                return (
                  <button
                    key={d.seconds}
                    disabled={!allowed}
                    onClick={() => setDuration(d.seconds)}
                    className={[
                      "rounded-xl border px-3 py-3 text-sm font-medium transition-colors cursor-pointer disabled:cursor-not-allowed",
                      selected
                        ? "border-accent bg-accent-soft text-accent"
                        : allowed
                          ? "border-line bg-panel-2/60 text-ink hover:border-accent-line hover:text-ink"
                          : "border-line-soft bg-panel-3/40 text-ink-faint/50 line-through",
                    ].join(" ")}
                  >
                    {d.label}
                  </button>
                );
              })}
            </div>
            {!format ? <p className="mt-3 text-xs text-ink-faint">Go back and choose a format to unlock durations.</p> : null}
          </StepShell>
        )}

        {step === 4 && (
          <StepShell
            icon={Palette}
            title="Visual style"
            description="The look of every scene. Faceless Creator = no on-camera talent."
          >
            {facelessMode ? (
              <p className="mb-3">
                <Badge tone="accent">Faceless mode — no on-camera talent</Badge>
              </p>
            ) : null}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {VISUAL_STYLES.map((s) => (
                <SelectCard
                  key={s.id}
                  selected={style === s.id}
                  onClick={() => setStyle(s.id)}
                  title={s.name}
                  description={s.description}
                />
              ))}
            </div>
          </StepShell>
        )}

        {step === 5 && (
          <StepShell
            icon={Languages}
            title="Language"
            description="The script and voiceover language."
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {LANGUAGES.map((l) => (
                <button
                  key={l.id}
                  onClick={() => setLanguage(l.id)}
                  className={[
                    "flex items-center gap-2.5 rounded-xl border px-3.5 py-2.5 text-left transition-colors cursor-pointer",
                    language === l.id
                      ? "border-accent bg-accent-soft text-accent"
                      : "border-line bg-panel-2/60 text-ink hover:border-accent-line",
                  ].join(" ")}
                >
                  <span className="text-sm font-medium">{l.name}</span>
                  <span className="ml-auto text-[11px] text-ink-faint">{l.native}</span>
                </button>
              ))}
            </div>
          </StepShell>
        )}

        {step === 6 && (
          <StepShell
            icon={Mic}
            title="Voice"
            description="A voice preset for the narration. Actual voiceover generation needs a connected provider (Voice Studio) — nothing is simulated."
          >
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {VOICE_PRESETS.map((v) => (
                <SelectCard
                  key={v.id}
                  selected={voice === v.id}
                  onClick={() => setVoice(v.id)}
                  title={v.name}
                  description={v.description}
                  badge="preset"
                />
              ))}
            </div>
            <p className="mt-2 text-[11px] text-ink-faint">
              Voice presets are saved to the project now; generation runs when a provider key is configured.
            </p>
          </StepShell>
        )}

        {step === 7 && (
          <StepShell
            icon={Sparkles}
            title="Review your video"
            description="Everything below is saved with your project. The structure plan is built for real; AI steps stop honestly until a provider is connected."
          >
            <dl className="space-y-2.5 text-sm">
              <ReviewRow label="Idea" value={idea.trim()} />
              <ReviewRow label="Input type" value={inputType ? INPUT_TYPE_LABELS[inputType] : "—"} />
              <ReviewRow
                label="Format"
                value={
                  format
                    ? `${FORMAT_OPTIONS.find((f) => f.id === format)?.label} (${FORMAT_OPTIONS.find((f) => f.id === format)?.badge})`
                    : "—"
                }
              />
              <ReviewRow
                label="Duration"
                value={
                  duration !== null
                    ? DURATION_OPTIONS_LABELED.find((d) => d.seconds === duration)?.label ?? `${duration}s`
                    : "—"
                }
              />
              <ReviewRow label="Structure" value={structurePreview ?? "selected server-side"} />
              <ReviewRow label="Visual style" value={VISUAL_STYLES.find((s) => s.id === style)?.name ?? "—"} />
              <ReviewRow label="Language" value={LANGUAGES.find((l) => l.id === language)?.name ?? "—"} />
              <ReviewRow label="Voice" value={VOICE_PRESETS.find((v) => v.id === voice)?.name ?? "—"} />
            </dl>

            <div className="mt-5 rounded-xl border border-accent-line/30 bg-accent-soft/40 px-4 py-3 text-xs leading-relaxed text-ink-dim">
              <span className="font-semibold text-accent">What happens on CREATE:</span> a real project is created
              with your settings, and the deterministic engine builds and saves the chapter/scene structure with
              exact durations. The first AI step (script writing) runs through the AI Model Orchestrator — with no
              provider connected it stops at a clear <span className="text-ink">“Provider Not Connected”</span>{" "}
              panel. No fake progress, no simulated AI.
            </div>

            {submitError ? (
              <p className="mt-4 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">
                {submitError}
              </p>
            ) : null}

            <Button
              className="mt-5 w-full"
              size="lg"
              onClick={() => void handleCreate()}
              disabled={!stepValid() || submitting}
            >
              {submitting ? <Loader2 size={16} className="animate-spin" /> : <Wand2 size={16} />}
              {submitting ? "Creating your project…" : "CREATE MY VIDEO"}
            </Button>
          </StepShell>
        )}
      </div>

      {/* ----------------------------------------------------- back / next */}
      <div className="mt-5 flex items-center justify-between">
        <Button variant="outline" onClick={() => setStep((s) => s - 1)} disabled={!canGoBack || submitting}>
          <ArrowLeft size={15} /> Back
        </Button>
        {step < 7 ? (
          <Button onClick={() => setStep((s) => s + 1)} disabled={!canGoNext || submitting}>
            Next <ArrowRight size={15} />
          </Button>
        ) : (
          <Badge tone="accent" className="text-[11px] uppercase tracking-wider">
            Step 8 of 8
          </Badge>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function StepShell({
  icon: Icon,
  title,
  description,
  children,
}: {
  icon: typeof PenLine;
  title: string;
  description: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-5 flex items-start gap-3.5">
        <span className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-soft border border-accent-line text-accent">
          <Icon size={18} strokeWidth={1.75} />
        </span>
        <div>
          <h2 className="font-display text-xl font-semibold tracking-tight text-ink">{title}</h2>
          <p className="mt-1 text-sm leading-relaxed text-ink-dim">{description}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function SelectCard({
  selected,
  onClick,
  title,
  description,
  badge,
}: {
  selected: boolean;
  onClick: () => void;
  title: string;
  description: string;
  badge?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "flex items-start gap-3 rounded-xl border px-4 py-3.5 text-left transition-colors cursor-pointer",
        selected
          ? "border-accent bg-accent-soft/60 ring-1 ring-accent/30"
          : "border-line bg-panel-2/60 hover:border-accent-line",
      ].join(" ")}
    >
      <span
        className={[
          "mt-0.5 flex h-4.5 w-4.5 h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border",
          selected ? "border-accent bg-accent text-void" : "border-line bg-panel-3",
        ].join(" ")}
      >
        {selected ? <Check size={11} /> : null}
      </span>
      <span className="min-w-0">
        <span className="flex items-center gap-2">
          <span className={selected ? "text-sm font-semibold text-accent" : "text-sm font-semibold text-ink"}>
            {title}
          </span>
          {badge ? <Badge tone="neutral">{badge}</Badge> : null}
        </span>
        <span className="mt-0.5 block text-xs leading-relaxed text-ink-dim">{description}</span>
      </span>
    </button>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-4 border-b border-line-soft pb-2.5 last:border-0">
      <dt className="w-28 shrink-0 text-xs font-medium uppercase tracking-wider text-ink-faint">{label}</dt>
      <dd className="min-w-0 flex-1 break-words text-ink">{value}</dd>
    </div>
  );
}
