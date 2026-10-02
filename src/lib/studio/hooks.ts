/**
 * Hook engine — the 8 hook types with structured, TEMPLATE-BASED options.
 *
 * Hooks here are templates with {topic} (and optional tone) inserted — clearly
 * labeled structure, NEVER AI-written copy and NEVER invented statistics.
 * A Statistics hook uses the literal "[verified statistic]" placeholder unless
 * REAL, user-provided data is supplied; numbers are never fabricated.
 */
export const HOOK_TYPES = [
  { id: "curiosity", name: "Curiosity", description: "Open a loop the viewer must close." },
  { id: "shock", name: "Shock", description: "Break expectations with a stark contrast." },
  { id: "question", name: "Question", description: "Ask what the viewer is already thinking." },
  { id: "story", name: "Story", description: "Start inside a moment, not an introduction." },
  { id: "statistics", name: "Statistics", description: "Anchor with a real, sourced figure." },
  { id: "controversy", name: "Controversy", description: "Name the disagreement head-on." },
  { id: "emotional", name: "Emotional", description: "Connect through a feeling." },
  { id: "problem", name: "Problem / Solution", description: "State the pain, promise the fix." },
] as const;

export type HookTypeId = (typeof HOOK_TYPES)[number]["id"];

interface HookTemplate {
  tpl: string;
  note: string;
}

const TEMPLATES: Record<HookTypeId, HookTemplate[]> = {
  curiosity: [
    { tpl: "This is what nobody tells you about {topic}.", note: "Curiosity gap via withheld payoff." },
    { tpl: "The hidden side of {topic} most people miss.", note: "Curiosity gap via unseen angle." },
    { tpl: "Wait until you see what {topic} actually involves.", note: "Curiosity gap via scale." },
  ],
  shock: [
    { tpl: "What {topic} looks like when everything goes wrong.", note: "Contrast against the expected." },
    { tpl: "The {topic} reality check that surprises everyone.", note: "Shock via unmet assumption." },
  ],
  question: [
    { tpl: "Why does {topic} matter more than you think?", note: "Open question." },
    { tpl: "What would change if {topic} suddenly disappeared?", note: "Counterfactual question." },
  ],
  story: [
    { tpl: "It started with a simple question about {topic}…", note: "Narrative inciting incident." },
    { tpl: "The day {topic} changed everything.", note: "Story in a moment." },
  ],
  statistics: [
    {
      tpl: "{STAT} — and here is what it means for {topic}.",
      note: "Statistic hook. {STAT} is either a real sourced figure or the literal placeholder '[verified statistic]' — never invented.",
    },
    {
      tpl: "One number explains {topic} better than a thousand words: {STAT}.",
      note: "Statistic hook. Requires real, sourced data.",
    },
  ],
  controversy: [
    { tpl: "Why {topic} is more complicated than it seems.", note: "Dispute the simple take." },
    { tpl: "The side of {topic} nobody wants to talk about.", note: "Controversy via avoided topic." },
  ],
  emotional: [
    { tpl: "The moment {topic} became personal.", note: "Emotional entry via personal stakes." },
    { tpl: "What {topic} feels like when you are all in.", note: "Emotional entry via felt experience." },
  ],
  problem: [
    { tpl: "Struggling with {topic}? You are not alone.", note: "Pain acknowledgment." },
    { tpl: "If {topic} is costing you time, this changes everything.", note: "Cost → promise." },
  ],
};

export interface RealStatistic {
  /** The real figure as a display string, e.g. "72% of viewers". */
  value: string;
  /** Source label, e.g. "Pew Research, 2024". Required — never invented. */
  source: string;
}

export interface HookOption {
  type: HookTypeId;
  text: string;
  templateId: string;
  note: string;
  /** Transparency label: this is a template, not AI-written copy. */
  labeled: "template";
  /** Set when a real statistic was inserted; otherwise undefined. */
  statistic?: { value: string; source: string };
}

export interface HookGenerationInput {
  topic: string;
  tone?: string;
  /** REAL, user-provided statistics only. When omitted, statistics hooks use the placeholder. */
  statistics?: RealStatistic[];
  /** Total options to generate (default: 2 per hook type = 16). */
  maxOptions?: number;
}

const STAT_PLACEHOLDER = "[verified statistic]";

/** Tiny deterministic hash of the tone string → rotation offset (0..7). */
function toneOffsetFor(tone: string | undefined): number {
  if (!tone) return 0;
  let h = 0;
  for (let i = 0; i < tone.length; i++) h = (h * 31 + tone.charCodeAt(i)) >>> 0;
  return h % 8;
}

function fillTpl(tpl: string, topic: string, stat?: RealStatistic): { text: string; statistic?: RealStatistic } {
  let text = tpl.replaceAll("{topic}", topic);
  let inserted: RealStatistic | undefined;
  if (text.includes("{STAT}")) {
    if (stat) {
      inserted = stat;
      text = text.replaceAll("{STAT}", `${stat.value} (${stat.source})`);
    } else {
      text = text.replaceAll("{STAT}", STAT_PLACEHOLDER);
    }
  }
  return { text, statistic: inserted };
}

/**
 * Deterministic template rotation: generates `maxOptions` options spread across
 * all 8 hook types, rotating template variants so repeated calls with a
 * `seed` (or a different start index) produce different but stable sets.
 */
export function generateHookOptions(input: HookGenerationInput): HookOption[] {
  const topic = input.topic.trim();
  const maxOptions = Math.max(1, input.maxOptions ?? 16);
  const options: HookOption[] = [];
  const perType = Math.max(1, Math.floor(maxOptions / HOOK_TYPES.length));
  // Deterministic tone offset — changing the tone rotates to different templates.
  const toneOffset = toneOffsetFor(input.tone);

  for (const type of HOOK_TYPES) {
    const templates = TEMPLATES[type.id];
    for (let i = 0; i < perType; i++) {
      if (options.length >= maxOptions) break;
      const tpl = templates[(i + toneOffset) % templates.length];
      const stat =
        type.id === "statistics" && input.statistics && input.statistics.length > 0
          ? input.statistics[i % input.statistics.length]
          : undefined;
      const { text, statistic } = fillTpl(tpl.tpl, topic, stat);
      options.push({
        type: type.id,
        text,
        templateId: `${type.id}:${(i + toneOffset) % templates.length}`,
        note: tpl.note,
        labeled: "template",
        statistic,
      });
    }
  }
  return options.slice(0, maxOptions);
}

/**
 * Rotate to a fresh hook option after the ones in `previous` — deterministic
 * next-template selection, so callers get variety without any AI.
 */
export function replaceHook(input: HookGenerationInput, previous: HookOption[]): HookOption {
  const topic = input.topic.trim();
  const usedKeys = new Set(previous.map((p) => p.templateId));
  const off = toneOffsetFor(input.tone);
  // First pass: a template not used yet (same rotation order as generateHookOptions).
  for (const type of HOOK_TYPES) {
    for (let i = 0; i < TEMPLATES[type.id].length; i++) {
      const tplIdx = (i + off) % TEMPLATES[type.id].length;
      const tpl = TEMPLATES[type.id][tplIdx];
      const key = `${type.id}:${tplIdx}`;
      if (usedKeys.has(key)) continue;
      const stat =
        type.id === "statistics" && input.statistics && input.statistics.length > 0
          ? input.statistics[0]
          : undefined;
      const { text, statistic } = fillTpl(tpl.tpl, topic, stat);
      return { type: type.id, text, templateId: key, note: tpl.note, labeled: "template", statistic };
    }
  }
  // All templates used — restart the rotation from the first hook type.
  const tpl = TEMPLATES.curiosity[toneOffsetFor(input.tone) % TEMPLATES.curiosity.length];
  const { text } = fillTpl(tpl.tpl, topic);
  return {
    type: "curiosity",
    text,
    templateId: `curiosity:${toneOffsetFor(input.tone) % TEMPLATES.curiosity.length}`,
    note: tpl.note,
    labeled: "template",
  };
}
