/**
 * BLOCK 9 — the derived WORDING contract for provider claims in the UI.
 *
 * The defect: `src/components/editor/export-panel.tsx` rendered the handoff badge
 * `no provider connected — nothing is encoded` as an unconditional literal, and
 * `editor-client.tsx` rendered the uppercase label `Provider Not Connected` above
 * a body that already branched on `gate.connected`. On a server whose wired slot
 * has its key set, `/api/ai/status` says `connected` — so both of those sentences
 * would have contradicted the status page, and the badge would have contradicted
 * the reachable/unreachable split printed a few lines under it, in the same view.
 *
 * The tests below therefore assert AGREEMENT AND DIRECTION, never a fixed string:
 *   - the three states produce three different sentences, so no single static
 *     string can stand in for a live answer;
 *   - in the CONNECTED state the wording must not deny a connected provider and
 *     must not imply a produced file;
 *   - in the NOT-CONNECTED state the wording must still say plainly that nothing
 *     was encoded (the honest core is kept, not softened);
 *   - an UNREAD gate claims nothing in either direction;
 *   - and the two panels must actually consume these derivations.
 *
 * No env var VALUE appears here; the key env var name only appears by proxy (the
 * wording module never reads process.env at all, which is asserted below).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  exportHandoffBadgeWording,
  providerGateWording,
} from "../gate-wording";

/** Sentence shapes that assert a FIXED fact about this server's connectivity. */
const FORBIDDEN_STATIC_CLAIMS = [
  "no provider is connected",
  "no provider connected",
  "no provider key is set",
  "no key is set",
  "nothing was generated",
  "provider not connected",
];

function claimsIn(text: string): string[] {
  const lower = text.toLowerCase();
  // "provider not connected" is allowed only as the NOT-CONNECTED conclusion of a
  // branch that was chosen from the live flag; this helper is used on the
  // CONNECTED wording, where any of these shapes would be a contradiction.
  return FORBIDDEN_STATIC_CLAIMS.filter((p) => lower.includes(p));
}

describe("block 9 — the handoff badge is derived, in all three states", () => {
  test("CONNECTED: never denies a connected provider, never implies a produced file", () => {
    const w = exportHandoffBadgeWording({ connected: true });
    expect(w.state).toBe("connected");
    expect(w.tone).toBe("ok");
    // It says a provider IS connected...
    expect(w.text).toContain("provider connected");
    // ...exactly what /api/ai/status reports for the same server.
    expect(claimsIn(w.text)).toEqual([]);
    // ...and it claims no output: a hand-off is not a produced file.
    expect(w.text).toContain("hand-off only");
    expect(w.text).toContain("not a produced file");
    for (const word of ["progress", "percent", "eta", "completed", "%"]) {
      expect(w.text.toLowerCase()).not.toContain(word);
    }
  });

  test("NOT CONNECTED: still says plainly that nothing is encoded", () => {
    const w = exportHandoffBadgeWording({ connected: false });
    expect(w.state).toBe("not_connected");
    expect(w.tone).toBe("danger");
    expect(w.text).toContain("no provider connected");
    expect(w.text).toContain("nothing is encoded");
    // The honest core is kept: it does not soften into "maybe".
    expect(w.text).not.toContain("not read yet");
  });

  test("UNREAD: claims nothing in either direction", () => {
    for (const gate of [null, undefined, {}, { connected: null }, { connected: "yes" as unknown as boolean }]) {
      const w = exportHandoffBadgeWording(gate);
      expect(w.state).toBe("unread");
      expect(w.tone).toBe("neutral");
      expect(w.text).toContain("not read yet");
      expect(w.text).not.toContain("provider connected");
      expect(w.text).not.toContain("nothing is encoded");
      expect(w.text).not.toContain("no provider connected");
    }
  });

  test("three states, three DIFFERENT sentences — no static string can serve them all", () => {
    const texts = [
      exportHandoffBadgeWording({ connected: true }).text,
      exportHandoffBadgeWording({ connected: false }).text,
      exportHandoffBadgeWording(null).text,
    ];
    expect(new Set(texts).size).toBe(3);
  });
});

describe("block 9 — the editor's provider gate label is derived, in all three states", () => {
  test("CONNECTED: the label never contradicts the body that already branched", () => {
    const w = providerGateWording({ connected: true });
    expect(w.state).toBe("connected");
    expect(w.tone).toBe("ok");
    expect(w.label).toBe("Provider Connected");
    expect(claimsIn(`${w.label} ${w.body}`)).toEqual([]);
    // and it still refuses to imply an asset was produced
    expect(w.body).toContain("hand-off is not an output");
  });

  test("NOT CONNECTED: the old sentence survives unchanged, because it is true here", () => {
    const w = providerGateWording({ connected: false });
    expect(w.state).toBe("not_connected");
    expect(w.tone).toBe("danger");
    expect(w.label).toBe("Provider Not Connected");
    expect(w.body).toBe("No provider is connected, so nothing was generated, synthesized or faked.");
  });

  test("UNREAD: a label that cannot be false, because it asserts nothing", () => {
    const w = providerGateWording(null);
    expect(w.state).toBe("unread");
    expect(w.tone).toBe("neutral");
    expect(w.label).toBe("Provider State Unread");
    expect(w.body).toContain("nothing is claimed about what is connected");
  });

  test("the tone follows the state, so a connected gate is never painted as an error", () => {
    expect(providerGateWording({ connected: true }).tone).not.toBe("danger");
    expect(providerGateWording({ connected: false }).tone).toBe("danger");
  });
});

describe("block 9 — the wording module cannot become a second source of truth", () => {
  test("it reads no env, imports no registry and has no IO", () => {
    const src = readFileSync("src/lib/ai/gate-wording.ts", "utf8");
    // No env read at all: the only input is the gate object it is handed.
    // (Comments are excluded — this module's own doc comment explains that it
    // never reads env, and quoting the name must not itself fail the check.)
    const code = src
      .split("\n")
      .filter((l) => {
        const t = l.trim();
        return !(t.startsWith("*") || t.startsWith("//") || t.startsWith("/*"));
      })
      .join("\n");
    expect(code.toLowerCase()).not.toContain("process.env");
    // No imports whatsoever — a wording module that imported the registry could
    // answer differently from the gate the server actually sent.
    const imports = src.split("\n").filter((l) => l.trim().startsWith("import "));
    expect(imports).toEqual([]);
    for (const forbidden of ["node:fs", "require(", "capabilityStatus", "capabilityConnectivity"]) {
      expect(`${forbidden}:${src.includes(forbidden)}`).toBe(`${forbidden}:false`);
    }
    // It is a function of its argument and nothing else.
    expect(src).toContain("export function exportHandoffBadgeWording");
    expect(src).toContain("export function providerGateWording");
  });

  test("both panels consume the derivation instead of printing their own claim", () => {
    const panel = readFileSync("src/components/editor/export-panel.tsx", "utf8");
    expect(panel).toContain("exportHandoffBadgeWording(gate)");
    expect(panel).toContain("{handoffBadge.text}");
    expect(panel).toContain('data-testid="export-handoff-badge"');

    const editor = readFileSync("src/app/(app)/projects/[id]/editor/editor-client.tsx", "utf8");
    expect(editor).toContain("providerGateWording(gate)");
    expect(editor).toContain("{wording.label}");
    expect(editor).toContain("{wording.body}");
    expect(editor).toContain('data-testid="provider-gate-label"');
    // The label is no longer a literal in JSX text position.
    expect(editor).not.toContain("> Provider Not Connected");
  });
});
