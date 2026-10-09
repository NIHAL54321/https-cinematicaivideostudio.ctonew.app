"use client";

/**
 * Phase 4 Block 2 — Sound Effects Studio UI.
 *
 * Deterministic client over the SFX lib (planning runs server-side via
 * /api/studio/sfx). No audio is fabricated: whenever the orchestrator has no
 * provider to hand the work to, its own honest gate is shown verbatim. The SFX library browser is
 * purely informational — effects have honest names, never playback.
 */
import { useState } from "react";
import { AudioWaveform, Loader2, Volume2 } from "lucide-react";
import { Badge, Button, Card, Label, PageHeader } from "@/components/ui";
import { apiFetch } from "@/components/projects/client-api";
import { ProviderNotConnected } from "@/components/provider-not-connected";
import { SFX_LIBRARY, type SfxCategory, type SoundEffectDef, type SfxScheduledEvent } from "@/lib/sfx";

interface PlanResponse {
  connected: boolean;
  capability?: string;
  requiredEnv?: string[];
  schedule: SfxScheduledEvent[];
  policy: { maxPerScene: number; preferTransitions: boolean; minGapMs: number };
  note?: string;
  error?: string;
}

const CATEGORY_TONE: Record<SfxCategory, "neutral" | "accent" | "ok" | "danger"> = {
  transition: "accent",
  emphasis: "danger",
  ambience: "ok",
  ui: "neutral",
};

const USAGE_LABEL: Record<string, string> = {
  transition: "Transitions",
  emphasis: "Emphasis",
  ambience: "Ambience",
  ui: "UI accents",
};

const DEFAULT_SCENES = [
  "A dramatic whoosh as we enter the city at night.",
  "She explains the numbers calmly across the quarterly report.",
  "Boom! The impact shakes the whole screen as the reveal lands.",
];

function fmtTime(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

export function SoundEffectsClient() {
  const [scenesText, setScenesText] = useState(DEFAULT_SCENES.join("\n"));
  const [jsonOverride, setJsonOverride] = useState("");
  const [tone, setTone] = useState("");
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function planSfx() {
    const lines = scenesText
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    let scenes: unknown[];
    const parsed = jsonOverride.trim() ? (() => {
      try {
        return JSON.parse(jsonOverride);
      } catch {
        return null;
      }
    })() : null;
    if (parsed !== null) {
      if (!Array.isArray(parsed)) {
        setError("JSON override must be an array of scene objects.");
        return;
      }
      scenes = parsed;
    } else if (jsonOverride.trim()) {
      setError("The JSON override is not valid JSON — fix it or clear the field.");
      return;
    } else if (lines.length === 0) {
      setError("Enter at least one scene line.");
      return;
    } else {
      scenes = lines.map((text) => ({ text }));
    }

    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch<PlanResponse>("/api/studio/sfx", {
        method: "POST",
        body: JSON.stringify({ action: "plan", scenes, ...(tone.trim() ? { tone: tone.trim() } : {}) }),
      });
      setPlan(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed.");
      setPlan(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0">
      <PageHeader
        title="Sound Effects"
        description="Plan sparse, cinematic effects — whooshes on cuts, impacts on reveals, ambience only where the scene asks for it."
        actions={
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-panel-2 border border-line text-ink-dim">
            <AudioWaveform size={18} strokeWidth={1.75} />
          </span>
        }
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        {/* ------------------------------- inputs ------------------------------- */}
        <div className="min-w-0 space-y-6">
          <Card className="p-5">
            <Label htmlFor="sfx-scenes">Scenes (one per line)</Label>
            <textarea
              id="sfx-scenes"
              value={scenesText}
              onChange={(e) => setScenesText(e.target.value)}
              rows={7}
              placeholder={"A dramatic whoosh as we enter the city at night.\nShe explains the numbers calmly."}
              className="mt-3 w-full min-w-0 rounded-xl border border-line bg-panel-3/60 px-3.5 py-3 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent-line"
            />
            <div className="mt-4">
              <Label htmlFor="sfx-json">
                JSON override with transitionType / durationMs{" "}
                <span className="ml-1 text-[11px] uppercase tracking-wider text-ink-faint">Optional</span>
              </Label>
              <textarea
                id="sfx-json"
                value={jsonOverride}
                onChange={(e) => setJsonOverride(e.target.value)}
                rows={6}
                spellCheck={false}
                placeholder='[{"text":"Whoosh into the city.","transitionType":"whoosh"},{"text":"She explains calmly.","durationMs":5000}]'
                className="mt-2 w-full min-w-0 rounded-xl border border-line bg-panel-3/60 px-3.5 py-3 font-mono text-xs text-ink placeholder:text-ink-faint focus:outline-none focus:border-accent-line"
              />
              <p className="mt-1.5 text-xs text-ink-faint">
                transitionType: <span className="font-mono">whoosh</span> or <span className="font-mono">impact</span> —
                when set, that effect fires on the scene.
              </p>
            </div>
            <div className="mt-4">
              <Label htmlFor="sfx-tone">Tone (optional)</Label>
              <select
                id="sfx-tone"
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                className="h-10 w-full rounded-xl border border-line bg-panel-3/60 px-3.5 text-sm text-ink focus:outline-none focus:border-accent-line"
              >
                <option value="">Auto</option>
                <option value="dramatic">Dramatic</option>
                <option value="calm">Calm</option>
                <option value="serious">Serious</option>
                <option value="documentary">Documentary</option>
                <option value="energetic">Energetic</option>
              </select>
            </div>
            <Button className="mt-5 w-full" onClick={planSfx} disabled={busy}>
              {busy ? (
                <>
                  <Loader2 size={16} className="animate-spin" /> Planning sound effects…
                </>
              ) : (
                "Plan sound effects"
              )}
            </Button>
            {error ? <p className="mt-2 text-sm text-danger">{error}</p> : null}
          </Card>

          <Card className="p-5">
            <h3 className="text-sm font-semibold text-ink">Effect library</h3>
            <p className="mt-1 text-xs text-ink-faint">
              14 licensed effect types. Honest titles — nothing is previewable or fabricated until a provider is
              connected.
            </p>
            <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
              {SFX_LIBRARY.map((sfx) => (
                <div key={sfx.id} className="min-w-0 rounded-xl border border-line bg-panel-3/40 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate text-sm font-semibold text-ink">{sfx.name}</p>
                    <span className="shrink-0 text-[10px] uppercase tracking-wider text-ink-faint">
                      {USAGE_LABEL[sfx.usage] ?? sfx.usage}
                    </span>
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-ink-dim">{sfx.description}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    <Badge tone={CATEGORY_TONE[sfx.category]}>{sfx.category}</Badge>
                    <Badge tone="neutral">weight {sfx.weight.toFixed(2)}</Badge>
                    <Badge tone="neutral">~{(sfx.typicallyShortMs / 1000).toFixed(1)}s</Badge>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>

        {/* ------------------------------- results ------------------------------ */}
        <div className="min-w-0 space-y-6">
          {!plan ? (
            <Card className="p-8 text-center">
              <p className="text-sm text-ink-dim">
                No plan yet — enter your scenes (one per line or JSON with transition types) and hit “Plan sound
                effects”.
              </p>
            </Card>
          ) : (
            <>
              <Card className="p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone="accent">{plan.schedule.length} effect{plan.schedule.length === 1 ? "" : "s"} placed</Badge>
                  <Badge tone="neutral">max {plan.policy.maxPerScene} per scene</Badge>
                  <Badge tone="neutral">min gap {(plan.policy.minGapMs / 1000).toFixed(1)}s</Badge>
                  <Badge tone="neutral">transitions preferred</Badge>
                </div>
                <div className="mt-4 flex items-center gap-2">
                  <Volume2 size={14} className="text-ink-faint" />
                  <p className="text-xs text-ink-faint">
                    Placement policy is enforced, not aspirational: scenes get at most {plan.policy.maxPerScene}{" "}
                    effects, and hits are at least {(plan.policy.minGapMs / 1000).toFixed(1)}s apart in the timeline.
                    Scenes without a duration are estimated at 4s.
                  </p>
                </div>
                {!plan.connected ? (
                  <div className="mt-4">
                    <ProviderNotConnected
                      providerKeys={plan.requiredEnv ?? []}
                      note="The moment a sound-effects provider key is added, the scheduled effects below are synthesized and persisted with licensing metadata."
                    />
                  </div>
                ) : null}
              </Card>

              <Card className="p-5">
                <h3 className="text-sm font-semibold text-ink">Schedule</h3>
                {plan.schedule.length === 0 ? (
                  <p className="mt-3 text-sm text-ink-dim">
                    No effects suggested — every scene reads as plain talking or nothing matched the strict selection
                    rules. That is the conservative default.
                  </p>
                ) : (
                  <div className="mt-4 space-y-2">
                    {plan.schedule.map((ev, i) => (
                      <div key={i} className="flex min-w-0 flex-wrap items-center gap-3 rounded-xl border border-line bg-panel-3/40 px-3.5 py-2.5">
                        <span className="w-24 shrink-0 font-mono text-xs tabular-nums text-ink-dim">
                          {fmtTime(ev.startMs)}–{fmtTime(ev.endMs)}
                        </span>
                        <span className="min-w-0 shrink-0 text-sm font-medium text-ink">{sfxName(ev.sfxId)}</span>
                        <Badge tone={CATEGORY_TONE[ev.category]}>{ev.category}</Badge>
                        <span className="min-w-0 flex-1 truncate text-[11px] text-ink-faint">{ev.reason}</span>
                        <span className="shrink-0 font-mono text-xs tabular-nums text-ink-faint">gain {ev.gain.toFixed(2)}</span>
                      </div>
                    ))}
                  </div>
                )}
                {plan.note && !plan.connected ? <p className="mt-3 text-xs text-ink-faint">{plan.note}</p> : null}
              </Card>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** Human name for a scheduled sfxId. */
function sfxName(id: string): string {
  return SFX_LIBRARY.find((s) => s.id === id)?.name ?? id;
}