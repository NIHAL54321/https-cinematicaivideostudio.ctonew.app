/**
 * Chart math — mathematically accurate chart utilities.
 *
 * HARD RULE: input data must be REAL, user-provided numbers. This module
 * refuses fabricated data (no random numbers, no invented statistics): every
 * entry passes through `assertRealNumbers`, which throws on non-finite,
 * non-numeric, or empty input. If you don't have data, don't call this module.
 */
export interface ChartDatum {
  label: string;
  value: number;
}

/** Throws on empty / non-finite / non-numeric values. Never invents numbers. */
export function assertRealNumbers(values: number[]): void {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error("Chart data is empty — refusing to render fabricated data.");
  }
  for (const v of values) {
    if (typeof v !== "number" || !Number.isFinite(v)) {
      throw new Error(`Chart data contains a non-finite value (${String(v)}) — data must be real numbers.`);
    }
  }
}

/**
 * Validate raw input and return clean ChartDatum[] or throw.
 * Accepts only { label: string, value: finite number } entries.
 */
export function validateChartData(data: unknown): ChartDatum[] {
  if (!Array.isArray(data)) throw new Error("Chart data must be an array of { label, value }.");
  const out: ChartDatum[] = [];
  for (const entry of data) {
    if (typeof entry !== "object" || entry === null) {
      throw new Error("Chart data entries must be objects.");
    }
    const { label, value } = entry as { label?: unknown; value?: unknown };
    if (typeof label !== "string" || label.trim() === "") {
      throw new Error("Chart data entries need a non-empty label.");
    }
    if (typeof value !== "number" || !Number.isFinite(value)) {
      throw new Error(`Chart data entry "${label}" needs a finite numeric value.`);
    }
    out.push({ label, value });
  }
  assertRealNumbers(out.map((d) => d.value));
  return out;
}

export interface BarLayout {
  max: number;
  total: number;
  count: number;
  /** Height as a fraction of the tallest bar (0..1, exact division). */
  normalized: { label: string; value: number; height01: number }[];
  /** Each bar's share of the total as a percentage (sums to ~100, exact math). */
  percentOfTotal: { label: string; pct: number }[];
}

/** Bar-chart layout math: normalization + percentages from real values. */
export function barChartLayout(data: ChartDatum[]): BarLayout {
  assertRealNumbers(data.map((d) => d.value));
  const max = Math.max(...data.map((d) => d.value));
  const total = data.reduce((a, d) => a + d.value, 0);
  if (max <= 0) throw new Error("Chart values must include a positive value to scale bars.");
  const normalized = data.map((d) => ({
    label: d.label,
    value: d.value,
    height01: d.value / max,
  }));
  const percentOfTotal = data.map((d) => ({
    label: d.label,
    pct: total === 0 ? 0 : (d.value / total) * 100,
  }));
  return { max, total, count: data.length, normalized, percentOfTotal };
}

/**
 * Percent change between two real numbers. Returns null when `from === 0`
 * (the change is undefined — we refuse to fabricate a number for it).
 */
export function percentChange(from: number, to: number): number | null {
  assertRealNumbers([from, to]);
  if (from === 0) return null;
  return ((to - from) / Math.abs(from)) * 100;
}

export function comparison(a: number, b: number): {
  absoluteDelta: number;
  percentChange: number | null;
  direction: "up" | "down" | "flat";
} {
  assertRealNumbers([a, b]);
  const delta = b - a;
  return {
    absoluteDelta: delta,
    percentChange: percentChange(a, b),
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
  };
}

export interface LinePoint {
  index: number;
  value: number;
}

export interface LineSeries {
  min: number;
  max: number;
  first: number;
  last: number;
  change: number;
  changePct: number | null;
  points: LinePoint[];
}

/** Line-series math: range, overall change, and exact points. */
export function lineSeries(values: number[]): LineSeries {
  assertRealNumbers(values);
  const points = values.map((v, i) => ({ index: i, value: v }));
  return {
    min: Math.min(...values),
    max: Math.max(...values),
    first: values[0],
    last: values[values.length - 1],
    change: values[values.length - 1] - values[0],
    changePct: percentChange(values[0], values[values.length - 1]),
    points,
  };
}

export interface TimelineEntry {
  date: string;
  value: number;
}

export interface TimelineSeries {
  sorted: TimelineEntry[];
  deltas: { date: string; value: number; changePct: number | null }[];
}

/** Timeline math: sort chronologically, compute period-over-period change. */
export function timelineSeries(data: TimelineEntry[]): TimelineSeries {
  assertRealNumbers(data.map((d) => d.value));
  const sorted = [...data].sort((a, b) => a.date.localeCompare(b.date));
  const deltas = sorted.map((entry, i) => {
    const prev = i > 0 ? sorted[i - 1].value : null;
    return {
      date: entry.date,
      value: entry.value,
      changePct: prev === null ? null : percentChange(prev, entry.value),
    };
  });
  return { sorted, deltas };
}

export interface GrowthPoint {
  period: number;
  value: number;
}

/**
 * Compound growth — the real formula: value(t) = principal × (1 + rate)^t.
 * `annualRatePct` is the annual rate in percent (e.g. 7 for 7%).
 */
export function compoundGrowth(principal: number, annualRatePct: number, periods: number): GrowthPoint[] {
  assertRealNumbers([principal, annualRatePct]);
  if (!Number.isInteger(periods) || periods < 0) {
    throw new Error("Periods must be a non-negative integer.");
  }
  const r = annualRatePct / 100;
  const out: GrowthPoint[] = [];
  for (let t = 0; t <= periods; t++) {
    out.push({ period: t, value: principal * Math.pow(1 + r, t) });
  }
  return out;
}
