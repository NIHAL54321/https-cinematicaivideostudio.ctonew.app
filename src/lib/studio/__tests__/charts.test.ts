import { describe, expect, test } from "bun:test";
import {
  assertRealNumbers,
  barChartLayout,
  percentChange,
  comparison,
  lineSeries,
  timelineSeries,
  compoundGrowth,
  validateChartData,
} from "../charts";

describe("charts: math accuracy", () => {
  test("percentChange is exact", () => {
    expect(percentChange(100, 150)).toBe(50);
    expect(percentChange(200, 100)).toBe(-50);
    expect(percentChange(50, 75)).toBe(50);
    expect(percentChange(0, 10)).toBeNull(); // undefined — refused, not invented
  });

  test("comparison direction and deltas", () => {
    const up = comparison(10, 15);
    expect(up.direction).toBe("up");
    expect(up.absoluteDelta).toBe(5);
    expect(up.percentChange).toBe(50);
    const flat = comparison(7, 7);
    expect(flat.direction).toBe("flat");
    expect(flat.percentChange).toBe(0);
  });

  test("barChartLayout normalization is exact", () => {
    const layout = barChartLayout([
      { label: "a", value: 25 },
      { label: "b", value: 100 },
      { label: "c", value: 50 },
    ]);
    expect(layout.max).toBe(100);
    expect(layout.total).toBe(175);
    expect(layout.normalized[1].height01).toBe(1);
    expect(layout.normalized[0].height01).toBe(0.25);
    expect(layout.percentOfTotal[0].pct).toBeCloseTo(25 / 1.75, 10);
  });

  test("lineSeries range and change", () => {
    const s = lineSeries([1, 3, 2, 8]);
    expect(s.min).toBe(1);
    expect(s.max).toBe(8);
    expect(s.first).toBe(1);
    expect(s.last).toBe(8);
    expect(s.change).toBe(7);
    expect(s.changePct).toBe(700);
    expect(s.points).toHaveLength(4);
  });

  test("timelineSeries sorts and computes period changes", () => {
    const t = timelineSeries([
      { date: "2023", value: 50 },
      { date: "2021", value: 40 },
      { date: "2022", value: 45 },
    ]);
    expect(t.sorted.map((e) => e.date)).toEqual(["2021", "2022", "2023"]);
    expect(t.deltas[1].changePct).toBe(12.5);
    expect(t.deltas[0].changePct).toBeNull();
  });

  test("compoundGrowth follows the real formula", () => {
    const g = compoundGrowth(100, 10, 2);
    expect(g[0].value).toBe(100);
    expect(g[1].value).toBeCloseTo(110, 10);
    expect(g[2].value).toBeCloseTo(121, 10);
  });
});

describe("charts: refuses fabricated data", () => {
  test("assertRealNumbers throws on empty, NaN, Infinity, strings", () => {
    expect(() => assertRealNumbers([])).toThrow();
    expect(() => assertRealNumbers([NaN])).toThrow();
    expect(() => assertRealNumbers([Infinity])).toThrow();
    expect(() => assertRealNumbers([1, "2" as unknown as number])).toThrow();
  });

  test("validateChartData accepts only real { label, value } arrays", () => {
    expect(validateChartData([{ label: "a", value: 3 }])).toEqual([{ label: "a", value: 3 }]);
    expect(() => validateChartData("nope")).toThrow();
    expect(() => validateChartData([{ label: "a", value: "3" }])).toThrow();
    expect(() => validateChartData([{ label: "", value: 3 }])).toThrow();
    expect(() => validateChartData([{ label: "a" }])).toThrow();
    expect(() => validateChartData([])).toThrow();
  });

  test("no random values ever appear", () => {
    // A bar layout must reproduce its input values exactly — nothing added.
    const data = [
      { label: "x", value: 12 },
      { label: "y", value: 34 },
    ];
    const layout = barChartLayout(data);
    expect(layout.normalized.map((n) => n.value)).toEqual([12, 34]);
  });
});
