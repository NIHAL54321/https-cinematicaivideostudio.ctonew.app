/**
 * Cinematic Style Presets — 27 deterministic look bundles.
 *
 * A preset is a typed bundle of visual descriptors, colors, lighting words,
 * aesthetic tokens and prompt-suffix rules that describe a recognizable look.
 * This is STRUCTURE, not AI: a preset never invents footage, it only describes
 * the visual language a generation request should follow. Everything here is
 * pure, deterministic and side-effect free.
 *
 * It composes with the existing Phase 2 engines rather than duplicating them:
 *   - `assembleVisualPrompt` (visual-prompts.ts) builds the base template prompt
 *   - `selectDescriptors` (cinematic.ts) picks a small deterministic subset of
 *     descriptors whose labels we surface on the composed prompt
 */
import { assembleVisualPrompt, type VisualPromptInput } from "./visual-prompts";
import { selectDescriptors } from "./cinematic";

export interface CinematicPreset {
  id: string;
  name: string;
  description: string;
  /** Short visual-look words surfaced on the prompt (e.g. "anamorphic"). */
  visualDescriptors: string[];
  /** Palette words (e.g. "teal and orange", "muted earth tones"). */
  colors: string[];
  /** Lighting words. */
  lighting: string[];
  /** Abstract style tokens (e.g. "35mm", "HDR", "gritty"). */
  aestheticTokens: string[];
  /** Extra instruction rules appended verbatim to the prompt. */
  promptSuffixRules: string[];
  /** Whether/type of film grain the look implies. */
  filmGrain?: boolean | string;
  /** Framing aspect hint (e.g. "16:9", "2.39:1"). */
  aspect?: string;
  /** Color grade description. */
  grading?: string;
}

export const DEFAULT_PRESET_ID = "cinematic";

export const CINEMATIC_PRESETS: Record<string, CinematicPreset> = {
  cinematic: {
    id: "cinematic",
    name: "Cinematic",
    description: "Moody, atmospheric, filmic — the classic premium movie look.",
    visualDescriptors: ["cinematic", "filmic", "cinematographic"],
    colors: ["teal and orange", "muted darks"],
    lighting: ["dramatic volumetric light", "low-key lighting"],
    aestheticTokens: ["anamorphic feel", "35mm", "shallow depth of field"],
    promptSuffixRules: ["cinematic color grading", "high production value"],
    filmGrain: true,
    grading: "teal and orange cinematic grade",
  },
  filmic: {
    id: "filmic",
    name: "Filmic",
    description: "A genuine film-capture look with organic texture.",
    visualDescriptors: ["filmic", "lifelike"],
    colors: ["natural filmic palette", "soft midtones"],
    lighting: ["natural motivated lighting", "soft diffusion"],
    aestheticTokens: ["35mm", "film stock", "organic grain"],
    promptSuffixRules: ["filmic color science", "smooth highlight rolloff"],
    filmGrain: true,
    grading: "natural filmic grade",
  },
  theatrical: {
    id: "theatrical",
    name: "Theatrical",
    description: "Stage-like, expressive lighting and purposeful composition.",
    visualDescriptors: ["theatrical", "dramatic"],
    colors: ["high-contrast blacks and whites", "spot-lit color"],
    lighting: ["single-source spotlight", "stage lighting"],
    aestheticTokens: ["dramatic shadows", "staged composition"],
    promptSuffixRules: ["theatrical framing", "expressive light"],
    grading: "high-contrast grade",
  },
  cinematographic: {
    id: "cinematographic",
    name: "Cinematographic",
    description: "Deliberate camera craft — composition-driven and refined.",
    visualDescriptors: ["cinematographic", "cinematic"],
    colors: ["rich graded palette"],
    lighting: ["chiaroscuro lighting", "accent light"],
    aestheticTokens: ["precise composition", "lens flare", "shallow depth of field"],
    promptSuffixRules: ["cinematographic framing", "balanced composition"],
    filmGrain: true,
    grading: "rich cinematographic grade",
  },
  anamorphic: {
    id: "anamorphic",
    name: "Anamorphic",
    description: "Widescreen anamorphic lens character with oval bokeh.",
    visualDescriptors: ["anamorphic", "cinematic"],
    colors: ["warm highlights", "cool shadows"],
    lighting: ["lens-flare rich lighting", "low-key"],
    aestheticTokens: ["2.39:1 anamorphic", "oval bokeh", "horizontal lens flare"],
    promptSuffixRules: ["anamorphic lens character", "widescreen composition"],
    filmGrain: true,
    aspect: "2.39:1",
    grading: "anamorphic cinematic grade",
  },
  hollywood: {
    id: "hollywood",
    name: "Hollywood",
    description: "Big-budget blockbuster polish — epic scale and clean grade.",
    visualDescriptors: ["hollywood-style", "cinematic", "breathtaking"],
    colors: ["rich saturated primaries", "teal shadows"],
    lighting: ["epic key lighting", "golden hour ambience"],
    aestheticTokens: ["blockbuster scale", "clean HDR", "epic scope"],
    promptSuffixRules: ["cinematic blockbuster polish", "large-scale production value"],
    filmGrain: false,
    grading: "clean high-end Hollywood grade",
  },
  documentary: {
    id: "documentary",
    name: "Documentary",
    description: "Grounded, observational, truthful — real-world authenticity.",
    visualDescriptors: ["true-to-life", "lifelike"],
    colors: ["natural colors", "honest skin tones"],
    lighting: ["available natural light", "no artificial glamour"],
    aestheticTokens: ["observational framing", "handheld wobble", "found-light realism"],
    promptSuffixRules: ["documentary realism", "authentic unposed scene"],
    filmGrain: true,
    grading: "neutral documentary grade",
  },
  photorealistic: {
    id: "photorealistic",
    name: "Photorealistic",
    description: "Indistinguishable-from-a-photo realism.",
    visualDescriptors: ["photorealistic", "true-to-life"],
    colors: ["accurate natural color"],
    lighting: ["physically accurate lighting"],
    aestheticTokens: ["DSLR sharpness", "real-world texture", "physical correctness"],
    promptSuffixRules: ["photorealistic detail", "no stylization"],
    filmGrain: false,
    grading: "natural photographic grade",
  },
  hyperrealistic: {
    id: "hyperrealistic",
    name: "Hyperrealistic",
    description: "Ultra-detailed realism that exceeds normal perception.",
    visualDescriptors: ["hyper-realistic", "photorealistic", "ultra-realistic"],
    colors: ["precise texture-accurate color"],
    lighting: ["raking detail light", "high dynamic range"],
    aestheticTokens: ["extreme micro-detail", "tactile texture", "crisp focus"],
    promptSuffixRules: ["hyperrealistic detail", "razor-sharp micro-texture"],
    filmGrain: false,
    grading: "hyperrealistic neutral grade",
  },
  ultrarealistic: {
    id: "ultrarealistic",
    name: "Ultra Realistic",
    description: "Bordering on indistinguishable from captured reality.",
    visualDescriptors: ["ultra-realistic", "true-to-life"],
    colors: ["life-accurate color"],
    lighting: ["natural diffuse light"],
    aestheticTokens: ["8K clarity", "real-world physics"],
    promptSuffixRules: ["ultra-realistic fidelity", "true-to-life lighting"],
    filmGrain: false,
    grading: "reality-accurate grade",
  },
  lifelike: {
    id: "lifelike",
    name: "Lifelike",
    description: "Plausible, believable, human-real — not stylized.",
    visualDescriptors: ["lifelike", "true-to-life"],
    colors: ["believable natural palette"],
    lighting: ["everyday natural light"],
    aestheticTokens: ["believable proportions", "human imperfection"],
    promptSuffixRules: ["lifelike believability", "natural human presence"],
    filmGrain: false,
    grading: "believable natural grade",
  },
  immersive: {
    id: "immersive",
    name: "Immersive",
    description: "Pulls the viewer in — enveloping, three-dimensional depth.",
    visualDescriptors: ["immersive", "breathtaking"],
    colors: ["deep enveloping color"],
    lighting: ["atmospheric depth light"],
    aestheticTokens: ["foreground depth", "layered composition", "wraparound scale"],
    promptSuffixRules: ["immersive depth", "enveloping atmosphere"],
    filmGrain: false,
    grading: "deep immersive grade",
  },
  vivid: {
    id: "vivid",
    name: "Vivid",
    description: "Bright, saturated, energetic — color-forward and punchy.",
    visualDescriptors: ["vivid", "vibrant-tones"],
    colors: ["high-saturation primaries", "electric accents"],
    lighting: ["bright pop lighting"],
    aestheticTokens: ["popping contrast", "energetic color"],
    promptSuffixRules: ["vivid saturated colors", "high-energy palette"],
    filmGrain: false,
    grading: "vivid saturated grade",
  },
  premium: {
    id: "premium",
    name: "Premium",
    description: "Polished, expensive, refined — modern high-end product feel.",
    visualDescriptors: ["studio-quality", "broadcast-ready", "premium"],
    colors: ["refined neutrals", "champagne and charcoal"],
    lighting: ["clean softbox lighting", "controlled highlights"],
    aestheticTokens: ["minimal luxury", "clean lines", "refined finish"],
    promptSuffixRules: ["premium polish", "high-end finish"],
    filmGrain: false,
    grading: "refined premium grade",
  },
  studio: {
    id: "studio",
    name: "Studio",
    description: "Controlled studio production — clean, deliberate, lit.",
    visualDescriptors: ["studio-quality", "color-accurate"],
    colors: ["controlled neutral palette"],
    lighting: ["three-point studio lighting"],
    aestheticTokens: ["clean background", "controlled exposure", "even illumination"],
    promptSuffixRules: ["studio-lit polish", "clean controlled exposure"],
    filmGrain: false,
    grading: "studio-accurate grade",
  },
  broadcast: {
    id: "broadcast",
    name: "Broadcast",
    description: "Television-ready — consistent, legible, professional.",
    visualDescriptors: ["broadcast-ready", "color-accurate"],
    colors: ["rec.709-calibrated color"],
    lighting: ["even broadcast lighting"],
    aestheticTokens: ["color-accurate", "legible contrast", "newsroom predictable"],
    promptSuffixRules: ["broadcast-ready consistency", "calibrated color"],
    filmGrain: false,
    grading: "broadcast-calibrated grade",
  },
  moody: {
    id: "moody",
    name: "Moody",
    description: "Dark, brooding, shadow-heavy — emotional and tense.",
    visualDescriptors: ["moody", "atmospheric", "cinematic"],
    colors: ["deep shadows", "dim highlights"],
    lighting: ["low-key moody lighting", "hard shadows"],
    aestheticTokens: ["shadow play", "brooding darkness", "tense atmosphere"],
    promptSuffixRules: ["moody low-key lighting", "brooding atmosphere"],
    filmGrain: true,
    grading: "dark moody grade",
  },
  atmospheric: {
    id: "atmospheric",
    name: "Atmospheric",
    description: "Hazy, layered, evocative — light and environment as subject.",
    visualDescriptors: ["atmospheric", "luminous"],
    colors: ["soft hazy palette", "misty tones"],
    lighting: ["volumetric haze", "diffused glow"],
    aestheticTokens: ["mist and depth", "light rays", "ethereal layers"],
    promptSuffixRules: ["atmospheric haze", "volumetric light"],
    filmGrain: true,
    grading: "hazy atmospheric grade",
  },
  luxury: {
    id: "luxury",
    name: "Luxury",
    description: "Opulence, elegance, exclusivity — aspirational and rich.",
    visualDescriptors: ["premium", "breathtaking"],
    colors: ["gold and deep black", "emerald accents"],
    lighting: ["glowing warm accent light", "jewel-like highlights"],
    aestheticTokens: ["opulent texture", "gilded detail", "exclusive elegance"],
    promptSuffixRules: ["luxury aesthetic", "rich opulent detail"],
    filmGrain: false,
    grading: "warm luxury grade",
  },
  futuristic: {
    id: "futuristic",
    name: "Futuristic",
    description: "Sleek sci-fi future — neon, clean geometry, advanced tech.",
    visualDescriptors: ["futuristic", "immersive"],
    colors: ["neon cyan and magenta", "dark chrome"],
    lighting: ["neon glow", "holographic light"],
    aestheticTokens: ["sleek futuristic tech", "clean geometry", "holograms", "neon"],
    promptSuffixRules: ["futuristic sci-fi aesthetic", "advanced technology detail"],
    filmGrain: false,
    grading: "cool neon grade",
  },
  vintage: {
    id: "vintage",
    name: "Vintage",
    description: "Retro film look — warm, nostalgic, period-authentic.",
    visualDescriptors: ["vintage", "filmic"],
    colors: ["warm sepia tones", "faded pastels"],
    lighting: ["soft nostalgic light", "warm glow"],
    aestheticTokens: ["retro film grain", "period objects", "warm-faded color"],
    promptSuffixRules: ["vintage period aesthetic", "nostalgic film look"],
    filmGrain: true,
    grading: "warm vintage grade",
  },
  news: {
    id: "news",
    name: "News",
    description: "Journalistic, immediate, factual — clear and neutral.",
    visualDescriptors: ["broadcast-ready", "true-to-life"],
    colors: ["neutral journalistic color"],
    lighting: ["flat documentary light"],
    aestheticTokens: ["reportage framing", "immediate realism", "factual clarity"],
    promptSuffixRules: ["news documentary realism", "clear factual presentation"],
    filmGrain: false,
    grading: "neutral journalistic grade",
  },
  corporate: {
    id: "corporate",
    name: "Corporate",
    description: "Professional, clean, trustworthy — business-presentation ready.",
    visualDescriptors: ["studio-quality", "color-accurate"],
    colors: ["corporate blues and grays"],
    lighting: ["clean even office light"],
    aestheticTokens: ["professional polish", "clean minimal UI-friendly"],
    promptSuffixRules: ["corporate professionalism", "clean trustworthy presentation"],
    filmGrain: false,
    grading: "neutral corporate grade",
  },
  infographic: {
    id: "infographic",
    name: "Infographic",
    description: "Graphic, legible, data-forward — bold shapes and clarity.",
    visualDescriptors: ["vivid", "color-accurate"],
    colors: ["bold flat color blocks"],
    lighting: ["flat even graphic light"],
    aestheticTokens: ["clean vector edges", "bold typography", "data visualization"],
    promptSuffixRules: ["infographic clarity", "bold legible graphics"],
    filmGrain: false,
    grading: "flat graphic grade",
  },
  animated: {
    id: "animated",
    name: "Animated",
    description: "Stylized motion-graphics / 2D animation feel.",
    visualDescriptors: ["vivid", "animated"],
    colors: ["bright stylized palette"],
    lighting: ["stylized flat shading"],
    aestheticTokens: ["smooth vector motion", "stylized shapes", "2D animation look"],
    promptSuffixRules: ["animated stylized look", "smooth motion-graphics"],
    filmGrain: false,
    grading: "bright stylized grade",
  },
  "3d": {
    id: "3d",
    name: "3D",
    description: "Polished 3D-render look — simulated depth and material.",
    visualDescriptors: ["immersive", "premium"],
    colors: ["global-illumination palette"],
    lighting: ["rendered studio lighting"],
    aestheticTokens: ["3D render depth", "PBR materials", "simulated bounce light"],
    promptSuffixRules: ["3D render quality", "physical material detail"],
    filmGrain: false,
    grading: "render-consistent grade",
  },
  illustration: {
    id: "illustration",
    name: "Illustration",
    description: "Artistic hand-drawn / illustration aesthetic.",
    visualDescriptors: ["illustration", "vivid"],
    colors: ["artistic expressive palette"],
    lighting: ["stylized artistic light"],
    aestheticTokens: ["hand-rendered texture", "artistic linework", "painterly finish"],
    promptSuffixRules: ["illustration aesthetic", "artistic expressive finish"],
    filmGrain: true,
    grading: "artistic painterly grade",
  },
};

export const PRESET_IDS = Object.keys(CINEMATIC_PRESETS);

/** Look up a preset by id with a safe fallback to the default. */
export function getPreset(id?: string | null): CinematicPreset {
  if (id && CINEMATIC_PRESETS[id]) return CINEMATIC_PRESETS[id];
  return CINEMATIC_PRESETS[DEFAULT_PRESET_ID];
}

/** List of presets in id order (stable for UI pickers). */
export function listPresets(): CinematicPreset[] {
  return PRESET_IDS.map((id) => CINEMATIC_PRESETS[id]);
}

/**
 * Append a preset's look onto a base visual prompt string.
 *
 * Reuses `selectDescriptors` to derive a small deterministic descriptor set
 * for the preset, then appends the preset's own descriptors, aesthetic tokens,
 * lighting, grading and suffix rules. Deterministic — same inputs, same output.
 */
export function applyPreset(
  preset: CinematicPreset,
  prompt: string,
  opts: { tone?: string; mediaType?: string; count?: number } = {},
): string {
  const base = prompt.trim();
  const descriptors = selectDescriptors({
    tone: opts.tone ?? preset.id,
    mediaType: opts.mediaType,
    count: opts.count ?? 3,
  });
  const descriptorLabels = descriptors.map((d) => d.label);
  const segments = [
    base,
    ...unique(descriptorLabels),
    ...preset.visualDescriptors,
    ...preset.aestheticTokens,
    ...(preset.lighting.length ? [`lighting: ${unique(preset.lighting).join(", ")}`] : []),
    ...(preset.colors.length ? [`color palette: ${unique(preset.colors).join(", ")}`] : []),
    ...(preset.grading ? [`grade: ${preset.grading}`] : []),
    ...(preset.filmGrain ? [`film grain: ${preset.filmGrain === true ? "subtle" : preset.filmGrain}`] : []),
    ...preset.promptSuffixRules,
  ].filter((s) => s && s.length > 0);
  return unique(segments).join(", ");
}

/**
 * Build a complete preset-composed visual prompt from a subject, mirroring the
 * Phase 2 `assembleVisualPrompt` template and then applying the preset on top.
 * This is the canonical composition used by the generation API prompt pipeline.
 */
export function composePresetPrompt(
  preset: CinematicPreset,
  input: {
    subject: string;
    tone?: string;
    mediaType?: string;
    format?: string;
    descriptors?: import("./cinematic").CinematicDescriptor[];
  },
): string {
  const base = assembleVisualPrompt({
    subject: input.subject,
    tone: input.tone ?? preset.id,
    mediaType: input.mediaType as VisualPromptInput["mediaType"],
    format: input.format,
    descriptors: input.descriptors,
  } as VisualPromptInput);
  return applyPreset(preset, base, { tone: input.tone ?? preset.id, mediaType: input.mediaType });
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items.filter(Boolean)));
}
