/**
 * Phase 5 Block 4 — Colour-grade catalog (pure, client-safe, deterministic).
 *
 * Nine first-class named grades. Every grade is described in REAL, inspectable
 * terms — contrast, saturation, temperature/tint, lift/gamma/gain,
 * shadows/midtones/highlights, the LUT-equivalent transform it stands for, and
 * the delivery target (SDR Rec.709 / HDR PQ) with its peak/reference nits.
 * Nothing here is a render statistic: these are the parameters a renderer WOULD
 * use. No pixels are produced in this module — see ./service for the honest
 * provider gate around the actual frame rendering.
 *
 * Determinism: every value is a literal. Same input → byte-identical output.
 * IO, clocks and randomness are absent by construction.
 *
 * This module is client-safe on purpose: the editor UI imports the catalog to
 * render the grade picker and show each grade's parameters verbatim, so it must
 * never pull in Prisma or the AI orchestrator status module.
 */

export const COLOR_GRADE_IDS = [
  "cinematic",
  "filmic",
  "moody",
  "vibrant",
  "atmospheric",
  "rich",
  "color-accurate",
  "sdr-rec709",
  "hdr",
] as const;

export type ColorGradeId = (typeof COLOR_GRADE_IDS)[number];

/** The reason a grade exists — used by the UI to group the catalog. */
export type ColorGradeFamily = "cinematic" | "stylised" | "technical";

/** Per-channel 0-1 values. Neutral lift is 0.5, neutral gamma/gain is 1.0. */
export interface GradeRgb {
  r: number;
  g: number;
  b: number;
}

/** Shadows / midtones / highlights offsets, each -1..+1 (0 = untouched). */
export interface GradeCurve {
  shadows: number;
  midtones: number;
  highlights: number;
}

/** The lift / gamma / gain primary correction the renderer applies. */
export interface GradeLgg {
  lift: GradeRgb;
  gamma: GradeRgb;
  gain: GradeRgb;
}

/** Delivery target — the display transform the graded image is mastered for. */
export interface GradeTarget {
  /** "SDR" (100 nits, Rec.709) or "HDR" (PQ/HLG, Rec.2020 wide gamut). */
  display: "SDR" | "HDR";
  /** Primaries: Rec.709 (BT.709) or Rec.2020 (BT.2020). */
  standard: "Rec.709" | "Rec.2020";
  /** Electro-optical transfer function of the master. */
  transfer: "BT.1886" | "PQ (SMPTE ST 2084)" | "HLG (ARIB STD-B67)";
  /** Peak luminance of the target display, in nits. */
  peakNits: number;
  /** Diffuse-white reference (100 nits SDR, 203 nits PQ graphics white). */
  referenceWhiteNits: number;
  /** HDR only: content light level metadata (null for SDR masters). */
  maxCLL: number | null;
  maxFALL: number | null;
  bitDepth: number;
  chromaSubsampling: "4:2:2" | "4:4:4";
}

export interface ColorGrade {
  id: ColorGradeId;
  name: string;
  family: ColorGradeFamily;
  /** Plain-language description of the look — shown verbatim in the UI. */
  description: string;
  /** Plain-language guidance on when to reach for this grade. */
  useWhen: string;
  /** Linear contrast multiplier (1.0 = untouched). */
  contrast: number;
  /** Saturation multiplier (1.0 = untouched). */
  saturation: number;
  /** White-balance shift in Kelvin (negative = cooler, positive = warmer). */
  temperatureK: number;
  /** Green (−) / magenta (+) tint offset in arbitrary display units. */
  tint: number;
  curves: GradeCurve;
  lgg: GradeLgg;
  /**
   * The named transform this grade stands for (a real, documented look-up
   * table — a film print emulation or a display transform). The LUT FILE itself
   * is never baked here: that needs a connected video-processing provider.
   */
  lutEquivalent: string;
  target: GradeTarget;
  /** True when the grade only makes sense on an HDR (PQ) master. */
  hdrOnly: boolean;
}

/**
 * The SDR delivery target: Rec.709 primaries, BT.1886 display gamma, 100 nits.
 * Exported so the Phase 6 export presets tag their containers with the SAME
 * numbers this grade system masters for — one source of truth, no second copy.
 */
export const SDR_709: GradeTarget = {
  display: "SDR",
  standard: "Rec.709",
  transfer: "BT.1886",
  peakNits: 100,
  referenceWhiteNits: 100,
  maxCLL: null,
  maxFALL: null,
  bitDepth: 10,
  chromaSubsampling: "4:2:2",
};

/**
 * The HDR10 delivery target: Rec.2020 primaries, SMPTE ST 2084 (PQ) transfer,
 * 1000-nit peak with 203-nit graphics white and CLL metadata. Exported for the
 * same reason as SDR_709 — the export presets reuse these numbers verbatim.
 */
export const HDR_PQ_1000: GradeTarget = {
  display: "HDR",
  standard: "Rec.2020",
  transfer: "PQ (SMPTE ST 2084)",
  peakNits: 1000,
  referenceWhiteNits: 203,
  maxCLL: 1000,
  maxFALL: 400,
  bitDepth: 10,
  chromaSubsampling: "4:2:2",
};

/** Lift/gamma/gain shorthand: lift is per-channel, gamma/gain are scalars. */
function lgg(lift: number, gamma = 1, gain = 1, tintRgb: Partial<GradeRgb> = {}): GradeLgg {
  return {
    lift: { r: tintRgb.r ?? lift, g: tintRgb.g ?? lift, b: tintRgb.b ?? lift },
    gamma: { r: gamma, g: gamma, b: gamma },
    gain: { r: gain, g: gain, b: gain },
  };
}

export const COLOR_GRADES: readonly ColorGrade[] = [
  {
    id: "cinematic",
    name: "Cinematic",
    family: "cinematic",
    description:
      "A modern feature-film look: slightly raised contrast, gently cooled shadows and a warm-ish highlight roll-off. Colour stays believable — nothing is pushed to a stylised extreme.",
    useWhen:
      "Default for narrative and documentary storytelling where the footage should feel like it came off a cinema camera rather than a phone.",
    contrast: 1.15,
    saturation: 0.95,
    temperatureK: -200,
    tint: -2,
    curves: { shadows: -0.05, midtones: 0, highlights: 0.06 },
    lgg: lgg(0.505, 0.99, 1.03, { r: 0.508, g: 0.504, b: 0.507 }),
    lutEquivalent: "Kodak 2383 print-film emulation (show LUT)",
    target: SDR_709,
    hdrOnly: false,
  },
  {
    id: "filmic",
    name: "Filmic",
    family: "cinematic",
    description:
      "A photochemical-negative look: lifted, milky blacks, a soft shoulder and a faint warm haze. Contrast is lower than Cinematic, so the image reads as shot on film stock rather than digitally graded.",
    useWhen:
      "Period pieces, human-interest stories and anything that should feel organic or archival. Avoid for product shots that need crisp blacks.",
    contrast: 1.08,
    saturation: 0.9,
    temperatureK: 150,
    tint: 3,
    curves: { shadows: 0.04, midtones: 0.01, highlights: -0.04 },
    lgg: lgg(0.52, 1.02, 0.98),
    lutEquivalent: "Kodak Vision3 250D negative → 2383 print (two-stage film emulation)",
    target: SDR_709,
    hdrOnly: false,
  },
  {
    id: "moody",
    name: "Moody",
    family: "stylised",
    description:
      "Dark and desaturated: deep shadows, a cool blue-green cast and pulled-back saturation. Highlights are held down so the frame stays low-key and tense.",
    useWhen:
      "Mystery, thriller, true-crime and anything building tension. Not for upbeat explainers — it deliberately drains energy.",
    contrast: 1.12,
    saturation: 0.78,
    temperatureK: -350,
    tint: -4,
    curves: { shadows: -0.12, midtones: -0.03, highlights: 0.02 },
    lgg: lgg(0.49, 1.05, 0.97, { r: 0.487, g: 0.492, b: 0.5 }),
    lutEquivalent: "Cool desaturated print emulation (Fuji Eterna 500T character)",
    target: SDR_709,
    hdrOnly: false,
  },
  {
    id: "vibrant",
    name: "Vibrant",
    family: "stylised",
    description:
      "High-chroma, punchy grade: saturation and contrast both pushed up, with a mild warm bias and dense highlights. Colours are the subject.",
    useWhen:
      "Travel, food, product reveals and social-first edits that must pop on a phone screen in a feed.",
    contrast: 1.18,
    saturation: 1.25,
    temperatureK: 100,
    tint: 1,
    curves: { shadows: -0.03, midtones: 0.05, highlights: 0.05 },
    lgg: lgg(0.5, 0.97, 1.05),
    lutEquivalent: "Kodak 2393 print emulation (high-chroma release print)",
    target: SDR_709,
    hdrOnly: false,
  },
  {
    id: "atmospheric",
    name: "Atmospheric",
    family: "stylised",
    description:
      "Hazy and soft: noticeably lifted blacks, gentle contrast, a cool green-blue cast and slightly reduced saturation. Distance and air are pushed forward.",
    useWhen:
      "Landscapes, weather, dawn/dusk and any scene where mood and depth matter more than clarity.",
    contrast: 1.05,
    saturation: 0.88,
    temperatureK: -250,
    tint: -6,
    curves: { shadows: 0.07, midtones: -0.02, highlights: -0.02 },
    lgg: lgg(0.54, 1.0, 0.99, { r: 0.537, g: 0.541, b: 0.546 }),
    lutEquivalent: "Atmospheric haze print emulation (lifted-black film character)",
    target: SDR_709,
    hdrOnly: false,
  },
  {
    id: "rich",
    name: "Rich",
    family: "cinematic",
    description:
      "Dense and saturated: deep, clean blacks, strong contrast and a slight warm bias, with highlights rolled off rather than clipped. The 'expensive' look.",
    useWhen:
      "Brand films, luxury and premium product work, talking-head studio setups where skin tones must stay solid.",
    contrast: 1.2,
    saturation: 1.05,
    temperatureK: 120,
    tint: 2,
    curves: { shadows: -0.08, midtones: 0.02, highlights: 0.07 },
    lgg: lgg(0.495, 0.98, 1.06),
    lutEquivalent: "Full-range print emulation (dense blacks, rich midtones)",
    target: SDR_709,
    hdrOnly: false,
  },
  {
    id: "color-accurate",
    name: "Color-accurate",
    family: "technical",
    description:
      "No creative grade at all: every control is at its neutral value, so the source values pass through unchanged. Whatever you see is what was shot or generated.",
    useWhen:
      "Review, client approval, A/B comparison and any deliverable where fidelity matters more than a look (educational, corporate, technical).",
    contrast: 1.0,
    saturation: 1.0,
    temperatureK: 0,
    tint: 0,
    curves: { shadows: 0, midtones: 0, highlights: 0 },
    lgg: lgg(0.5, 1.0, 1.0),
    lutEquivalent: "None — reference display transform only (no look LUT applied)",
    target: SDR_709,
    hdrOnly: false,
  },
  {
    id: "sdr-rec709",
    name: "SDR Rec.709",
    family: "technical",
    description:
      "The broadcast SDR master: neutral grade, Rec.709 primaries, BT.1886 gamma, legal-range levels (64-940 in 10-bit) and a 100-nit peak. Values are limited to the standard rather than marked as 'no grade'.",
    useWhen:
      "Delivering to YouTube, broadcast or any Rec.709 SDR pipeline that validates levels. Also the safe fallback when an HDR master must be shown on an SDR screen.",
    contrast: 1.0,
    saturation: 1.0,
    temperatureK: 0,
    tint: 0,
    curves: { shadows: 0, midtones: 0, highlights: 0 },
    lgg: lgg(0.5, 1.0, 1.0),
    lutEquivalent: "Rec.709 / BT.1886 display transform (legal-range SDR master)",
    target: SDR_709,
    hdrOnly: false,
  },
  {
    id: "hdr",
    name: "HDR",
    family: "technical",
    description:
      "An HDR10 master: SMPTE ST 2084 (PQ) transfer, Rec.2020 primaries, a 100-nit diffuse white raised to a 203-nit PQ graphics white and headroom up to 1000 nits, with CLL metadata. Highlights are extended, not manufactured.",
    useWhen:
      "HDR-capable delivery where highlights and specular detail should survive. Needs a provider to tone-map real footage and to author the metadata.",
    contrast: 1.05,
    saturation: 1.1,
    temperatureK: 0,
    tint: 0,
    curves: { shadows: 0, midtones: 0, highlights: 0.1 },
    lgg: lgg(0.5, 1.0, 1.0),
    lutEquivalent: "SMPTE ST 2084 (PQ) HDR10 display transform, Rec.2020 primaries",
    target: HDR_PQ_1000,
    hdrOnly: true,
  },
];

/** One grade by id, or null when the id is not in the catalog. */
export function findColorGrade(id: unknown): ColorGrade | null {
  if (typeof id !== "string") return null;
  return COLOR_GRADES.find((g) => g.id === id) ?? null;
}

export function isColorGradeId(v: unknown): v is ColorGradeId {
  return typeof v === "string" && (COLOR_GRADE_IDS as readonly string[]).includes(v);
}

/** Short human label for the reset control / "no grade" state. */
export const NO_GRADE_LABEL = "None";

/* ------------------------------------------------------------------ */
/* Render plan — the parameters a renderer would consume               */
/* ------------------------------------------------------------------ */

export interface ColorRenderOperation {
  order: number;
  /** Machine-style operation id. */
  op: string;
  /** The exact parameters, as the renderer would receive them. */
  params: Record<string, string | number | boolean>;
}

export interface ColorRenderPlan {
  gradeId: ColorGradeId;
  operations: ColorRenderOperation[];
  lut: {
    /** The named transform; the file itself is never baked in this app. */
    name: string;
    format: "cube-33";
    baked: false;
    requiresProvider: true;
  };
  output: GradeTarget;
  /** The honest list of steps that genuinely need a connected provider. */
  providerWork: { step: string; capability: string }[];
  note: string;
}

/**
 * The deterministic mapping grade → renderer parameter set. Pure arithmetic on
 * the catalog values: every number here is either copied from the grade or a
 * documented derivation of it. Nothing is measured, sampled or estimated.
 */
export function buildRenderPlan(grade: ColorGrade | ColorGradeId): ColorRenderPlan {
  const g = typeof grade === "string" ? findColorGrade(grade) : grade;
  if (!g) throw new Error(`Unknown colour grade: ${String(grade)}`);

  const operations: ColorRenderOperation[] = [
    {
      order: 1,
      op: "decode-linear",
      params: {
        source: "working timeline clip",
        primaries: "Rec.709",
        transfer: "BT.1886",
        workingSpace: "linear float32",
      },
    },
    {
      order: 2,
      op: "white-balance",
      params: { temperatureK: g.temperatureK, tint: g.tint, direction: g.temperatureK < 0 ? "cooler" : g.temperatureK > 0 ? "warmer" : "neutral" },
    },
    {
      order: 3,
      op: "lift-gamma-gain",
      params: {
        lift: `${g.lgg.lift.r}/${g.lgg.lift.g}/${g.lgg.lift.b}`,
        gamma: g.lgg.gamma.r,
        gain: g.lgg.gain.r,
        neutral: "lift 0.5 · gamma 1.0 · gain 1.0",
      },
    },
    {
      order: 4,
      op: "tone-curve",
      params: { shadows: g.curves.shadows, midtones: g.curves.midtones, highlights: g.curves.highlights, range: "-1..+1" },
    },
    { order: 5, op: "contrast", params: { multiplier: g.contrast, pivot: 0.435 } },
    { order: 6, op: "saturation", params: { multiplier: g.saturation } },
    { order: 7, op: "lut-apply", params: { lut: g.lutEquivalent, intensity: 1 } },
    {
      order: 8,
      op: "output-transform",
      params: {
        primaries: g.target.standard,
        transfer: g.target.transfer,
        peakNits: g.target.peakNits,
        referenceWhiteNits: g.target.referenceWhiteNits,
        bitDepth: g.target.bitDepth,
        chromaSubsampling: g.target.chromaSubsampling,
      },
    },
  ];

  const providerWork: { step: string; capability: string }[] = [
    { step: "decode real source frames", capability: "video_enhancement" },
    { step: "apply the graded parameter set to pixels", capability: "video_enhancement" },
    { step: "bake the LUT file", capability: "video_enhancement" },
  ];
  if (g.target.display === "HDR") {
    providerWork.push({ step: "tone-map the footage into PQ headroom and author CLL metadata", capability: "video_enhancement" });
  }

  return {
    gradeId: g.id,
    operations,
    lut: { name: g.lutEquivalent, format: "cube-33", baked: false, requiresProvider: true },
    output: g.target,
    providerWork,
    note:
      "Deterministic parameter plan only. No frames were decoded, no pixels were graded and no LUT file was baked — " +
      "that work needs a connected video-processing provider.",
  };
}

/** The catalog as the UI wants it: parameters + the render plan for each grade. */
export interface ColorGradeView {
  id: ColorGradeId;
  name: string;
  family: ColorGradeFamily;
  description: string;
  useWhen: string;
  hdrOnly: boolean;
  parameters: {
    contrast: number;
    saturation: number;
    temperatureK: number;
    tint: number;
    curves: GradeCurve;
    lgg: GradeLgg;
    lutEquivalent: string;
    target: GradeTarget;
  };
}

export function colorGradeView(grade: ColorGrade): ColorGradeView {
  return {
    id: grade.id,
    name: grade.name,
    family: grade.family,
    description: grade.description,
    useWhen: grade.useWhen,
    hdrOnly: grade.hdrOnly,
    parameters: {
      contrast: grade.contrast,
      saturation: grade.saturation,
      temperatureK: grade.temperatureK,
      tint: grade.tint,
      curves: { ...grade.curves },
      lgg: {
        lift: { ...grade.lgg.lift },
        gamma: { ...grade.lgg.gamma },
        gain: { ...grade.lgg.gain },
      },
      lutEquivalent: grade.lutEquivalent,
      target: { ...grade.target },
    },
  };
}

export function listColorGradeViews(): ColorGradeView[] {
  return COLOR_GRADES.map(colorGradeView);
}
