/**
 * The operator's stock-media line is DERIVED, never typed.
 *
 * Phase 8 block 7a put a real Pixabay key on this machine, and a stock search
 * genuinely answers. The capability matrix above it counts the AI orchestrator's
 * slots and knows nothing about that registry, so this section reports the
 * registry the media routes actually call. The test below is the derivation
 * proof: hand the builder a different live state and the sentence must follow —
 * a hand-typed "0 of them" could not.
 */
import { describe, expect, test } from "bun:test";
import { buildStockMediaSection, type StockProviderFact } from "../sections";

const fact = (over: Partial<StockProviderFact> & { id: string }): StockProviderFact => ({
  name: over.id[0].toUpperCase() + over.id.slice(1),
  supports: ["video"],
  requiredEnv: [`${over.id.toUpperCase()}_API_KEY`],
  configured: false,
  ...over,
});

describe("buildStockMediaSection derives every figure from the facts it is handed", () => {
  test("no key anywhere → the sentence says none, and names the total", () => {
    const s = buildStockMediaSection([fact({ id: "pexels", supports: ["image", "video"] }), fact({ id: "pixabay" })]);
    expect(s.configuredCount).toBe(0);
    expect(s.totalCount).toBe(2);
    expect(s.headline).toContain("None of the 2");
    expect(s.headline).toContain("not_connected");
    // Nothing is claimed to be answering.
    expect(s.statements.join(" ")).not.toContain("Answering now");
  });

  test("one key present → the count and the name both change", () => {
    const s = buildStockMediaSection([
      fact({ id: "pexels", supports: ["image", "video"] }),
      fact({ id: "pixabay", configured: true }),
    ]);
    expect(s.configuredCount).toBe(1);
    expect(s.headline).toContain("1 of 2");
    expect(s.headline).toContain("Pixabay (video)");
    expect(s.headline).not.toContain("Pexels (image/video)");
    expect(s.statements[0]).toContain("Answering now: Pixabay (video)");
    expect(s.statements[0]).toContain("Skipped (no key in this process): Pexels");
  });

  test("two keys present → the second name appears without any code change", () => {
    const s = buildStockMediaSection([
      fact({ id: "pexels", supports: ["image", "video"], configured: true }),
      fact({ id: "pixabay", configured: true }),
      fact({ id: "unsplash", supports: ["image"] }),
    ]);
    expect(s.configuredCount).toBe(2);
    expect(s.headline).toContain("2 of 3");
    expect(s.headline).toContain("Pexels");
    expect(s.headline).toContain("Pixabay");
    expect(s.statements[0]).toContain("Skipped (no key in this process): Unsplash");
  });

  test("an empty registry says so instead of printing a zero that reads like a result", () => {
    const s = buildStockMediaSection([]);
    expect(s.totalCount).toBe(0);
    expect(s.headline).toContain("No stock-media provider is registered");
  });

  test("NEGATIVE CONTROL: the sentence is not fixed — two states give two different headlines", () => {
    const off = buildStockMediaSection([fact({ id: "pixabay" })]);
    const on = buildStockMediaSection([fact({ id: "pixabay", configured: true })]);
    expect(off.headline).not.toBe(on.headline);
  });

  test("the section always says which registry it is describing", () => {
    const s = buildStockMediaSection([fact({ id: "pixabay", configured: true })]);
    const prose = [s.headline, ...s.statements].join(" ");
    expect(prose).toContain("StockProvider.search");
    expect(prose).toContain("separate code paths");
  });

  test("a search answering is never presented as a produced video", () => {
    const s = buildStockMediaSection([fact({ id: "pixabay", configured: true })]);
    expect(s.statements.join(" ")).toContain("not a produced video");
  });
});
