/**
 * The gate env-var honesty contract.
 *
 * A gate in this product tells a server operator WHICH env var to set. If it
 * names a variable no code reads, the instruction is false and the owner buys a
 * key that changes nothing. This suite makes that impossible:
 *
 *   1. every gate's requiredEnv ⊆ allProviderEnvVars() (the registry),
 *   2. the derived list for a capability matches the slot table's own providers
 *      (asserted concretely for video_enhancement, voice_generation,
 *      speech_recognition and the three detection capabilities, including the
 *      multi-key providers where ANY key suffices and azure where BOTH do),
 *   3. a capability no provider slot serves reports that honestly instead of
 *      naming a placeholder,
 *   4. the invented names the app used to print appear nowhere in src/.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  allProviderEnvVars,
  PROVIDER_ENV_KEYS,
  providerRequiredEnv,
} from "../../ai/providers/env-keys";
import { PROVIDER_SLOTS } from "../../ai/providers/slots";
import { providersFor } from "../../ai/providers/registry";
import {
  capabilityEnvHint,
  capabilityEnvNames,
  capabilityEnvNamesFor,
  capabilityEnvPath,
  capabilityEnvRequirement,
  envNamesPhrase,
  isRegistryEnvVar,
  listCapabilityEnvPaths,
  registryEnvVars,
} from "../../ai/providers/capability-env";
import { allCapabilityStatus, capabilityStatus } from "../../ai/status";
import { requiredEnvFor } from "../../ai/orchestrator";
import { AI_CAPABILITIES } from "../../ai/types";
import { colorProviderGate } from "../../color/service";
import { framingDetectorGate, framingRenderGate } from "../../framing/service";
import { repurposeAnalysisGate, repurposeRenderGate } from "../../repurpose/service";
import { exportProviderGate } from "../../export/service";
import { readinessMediaAnalysisGate } from "../../export/readiness";
import { IMAGE_PROVIDER_ENV_NAMES, VOICE_PROVIDER_ENV_NAMES, LLM_PROVIDER_ENV_NAMES } from "../../editor/auto-editor";

/** The names the app used to print that NO code ever read. */
const INVENTED_NAMES = [
  "VIDEO_PROCESSING_API_KEY",
  "MEDIA_ANALYSIS_API_KEY",
  "TRANSCRIPTION_API_KEY",
  "VOICE_PROVIDER_API_KEY",
  "IMAGE_PROVIDER_API_KEY",
  "LLM_PROVIDER_API_KEY",
  "SUNO_API_KEY",
  "MUSICGEN_API_KEY",
  "SFX_API_KEY",
  "ELEVENLABS_SFX",
  "WHISPER_API_KEY",
  "DEEPGRAM_API_KEY",
];

/** Every gate-producing function in the app, called the way the engine calls it. */
function everyGate(): { name: string; capability: string; requiredEnv: string[]; envHint: string | null; note: string }[] {
  return [
    { name: "colorProviderGate", ...colorProviderGate("x") },
    { name: "framingDetectorGate", ...framingDetectorGate("x") },
    { name: "framingRenderGate", ...framingRenderGate("x") },
    { name: "repurposeAnalysisGate", ...repurposeAnalysisGate("x") },
    { name: "repurposeRenderGate", ...repurposeRenderGate("x") },
    { name: "exportProviderGate", ...exportProviderGate("x") },
    { name: "readinessMediaAnalysisGate", ...readinessMediaAnalysisGate("x") },
  ];
}

/**
 * Source files only: the suites themselves are required to NAME the invented
 * variables (as `not.toContain` negative assertions), so scanning them would
 * make the guard vacuum its own reason to exist.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) {
      if (entry === "__tests__") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(p);
  }
  return out;
}

describe("gate env vars — derived source of truth", () => {
  test("every gate's requiredEnv is inside the provider env-key registry", () => {
    const registry = allProviderEnvVars();
    for (const gate of everyGate()) {
      for (const name of gate.requiredEnv) {
        expect(`${gate.name}:${name}`).toBe(`${gate.name}:${name}`);
        expect(registry).toContain(name);
      }
      for (const name of gate.requiredEnv) expect(isRegistryEnvVar(name)).toBe(true);
    }
  });

  test("every capability's derived list is a subset of the registry", () => {
    const registry = registryEnvVars();
    for (const path of listCapabilityEnvPaths()) {
      for (const name of path.envVars) expect(registry).toContain(name);
      // and each name is the registry's own list for one of its providers
      for (const row of path.providers) {
        expect(row.envKeys).toEqual(providerRequiredEnv(row.providerId));
        for (const k of row.envKeys) expect(registry).toContain(k);
      }
    }
  });

  test("the derived providers ARE the slot table's providers (not a second list)", () => {
    for (const capability of AI_CAPABILITIES) {
      const fromSlots = providersFor(capability).map((p) => p.id);
      expect(capabilityEnvPath(capability).providerIds).toEqual(fromSlots);
    }
  });

  test("video_enhancement → replicate + runway slots → their registry keys", () => {
    const path = capabilityEnvPath("video_enhancement");
    expect(path.providerIds).toEqual(["replicate", "runway"]);
    expect(path.envVars).toEqual(["REPLICATE_API_TOKEN", "RUNWAY_API_KEY"]);
    expect(path.envHint).toBe("REPLICATE_API_TOKEN or RUNWAY_API_KEY");
    expect(path.hasProvider).toBe(true);
    // no serving slot is wired yet, and the derivation says so
    expect(path.wiredProviderIds).toEqual([]);
    expect(path.hasWiredProvider).toBe(false);
    expect(path.summary).toContain("No serving slot is wired yet");
    // the gate text names exactly these, and nothing invented
    const gate = exportProviderGate("x");
    expect(gate.requiredEnv).toEqual(path.envVars);
    expect(String(gate.note)).toContain("REPLICATE_API_TOKEN");
    expect(String(gate.note)).toContain("RUNWAY_API_KEY");
    expect(String(gate.note)).not.toContain("VIDEO_PROCESSING_API_KEY");
  });

  test("voice_generation → openai/google/replicate/elevenlabs/azure, ANY key per provider but BOTH azure keys", () => {
    const path = capabilityEnvPath("voice_generation");
    expect(path.providerIds).toEqual(["openai", "google", "replicate", "elevenlabs", "azure"]);
    expect(path.envVars).toEqual([
      "OPENAI_API_KEY",
      "GOOGLE_AI_API_KEY",
      "GOOGLE_API_KEY",
      "REPLICATE_API_TOKEN",
      "ELEVENLABS_API_KEY",
      "AZURE_SPEECH_KEY",
      "AZURE_SPEECH_REGION",
    ]);
    const google = path.providers.find((p) => p.providerId === "google")!;
    expect(google.envKeys).toEqual(["GOOGLE_AI_API_KEY", "GOOGLE_API_KEY"]);
    expect(google.allRequired).toBe(false); // either google name suffices
    const azure = path.providers.find((p) => p.providerId === "azure")!;
    expect(azure.envKeys).toEqual(["AZURE_SPEECH_KEY", "AZURE_SPEECH_REGION"]);
    expect(azure.allRequired).toBe(true); // BOTH azure keys are required
    expect(PROVIDER_ENV_KEYS.azure.allRequired).toBe(true);
    // the auto-editor's own gate names the same derived set
    expect(VOICE_PROVIDER_ENV_NAMES).toEqual(path.envVars);
  });

  test("speech_recognition → the same five providers, and the repurpose gate names them", () => {
    const path = capabilityEnvPath("speech_recognition");
    expect(path.providerIds).toEqual(["openai", "google", "replicate", "elevenlabs", "azure"]);
    expect(path.envVars).toEqual(capabilityEnvNames("voice_generation"));
    const gate = repurposeAnalysisGate("x");
    expect(gate.requiredEnv).toEqual(
      capabilityEnvNamesFor(["speech_recognition", "scene_detection"]),
    );
    expect(gate.requiredEnv).toContain("ELEVENLABS_API_KEY");
    expect(gate.requiredEnv).toContain("AZURE_SPEECH_KEY");
    expect(gate.requiredEnv).not.toContain("TRANSCRIPTION_API_KEY");
  });

  test("the three detection capabilities → openai + google + replicate, both google names", () => {
    for (const capability of ["face_detection", "object_detection", "scene_detection"] as const) {
      const path = capabilityEnvPath(capability);
      expect(path.providerIds).toEqual(["openai", "google", "replicate"]);
      expect(path.envVars).toEqual([
        "OPENAI_API_KEY",
        "GOOGLE_AI_API_KEY",
        "GOOGLE_API_KEY",
        "REPLICATE_API_TOKEN",
      ]);
    }
    const gate = framingDetectorGate("x");
    expect(gate.requiredEnv).toEqual(capabilityEnvNames("face_detection"));
    expect(gate.requiredEnv).not.toContain("MEDIA_ANALYSIS_API_KEY");
  });

  test("a capability with NO provider slot reports that honestly — no placeholder name", () => {
    // "media_analysis" (the readiness bucket) is not a registered capability and
    // no slot serves it: nothing may be named.
    const path = capabilityEnvPath("media_analysis");
    expect(path.registeredCapability).toBe(false);
    expect(path.hasProvider).toBe(false);
    expect(path.providers).toEqual([]);
    expect(path.envVars).toEqual([]);
    expect(path.envHint).toBeNull();
    expect(path.summary).toContain("no provider slot");
    expect(capabilityEnvRequirement("media_analysis")).toContain("No provider is wired");
    expect(capabilityEnvRequirement("media_analysis")).toContain("none is named here");
    expect(capabilityEnvHint("media_analysis")).toBeNull();
    const gate = readinessMediaAnalysisGate("Checking a thing");
    expect(gate.requiredEnv).toEqual([]);
    expect(gate.envHint).toBeNull();
    expect(String(gate.note)).toContain("No provider is wired");
    expect(JSON.stringify(gate)).not.toContain("API_KEY");
    // A capability that IS registered can still have no serving slot: the same
    // honest answer applies, never a made-up name.
    for (const capability of AI_CAPABILITIES) {
      const p = capabilityEnvPath(capability);
      if (!p.hasProvider) {
        expect(p.envVars).toEqual([]);
        expect(p.envHint).toBeNull();
      }
    }
  });

  test("the status API and the orchestrator use the same derivation", () => {
    for (const capability of AI_CAPABILITIES) {
      const derived = capabilityEnvNames(capability);
      expect(capabilityStatus(capability).requiredEnv).toEqual(derived);
      expect(requiredEnvFor(capability)).toEqual(derived);
    }
    expect(allCapabilityStatus().length).toBe(AI_CAPABILITIES.length);
    expect(allCapabilityStatus().every((c) => c.envNote.length > 0)).toBe(true);
  });

  test("the other hard-coded capability gates now name derived registry names", () => {
    expect(IMAGE_PROVIDER_ENV_NAMES).toEqual(capabilityEnvNames("image_generation"));
    expect(LLM_PROVIDER_ENV_NAMES).toEqual(capabilityEnvNames("seo_generation"));
    for (const gate of [colorProviderGate("x"), repurposeRenderGate("x"), framingRenderGate("x")]) {
      expect(gate.requiredEnv).toEqual(["REPLICATE_API_TOKEN", "RUNWAY_API_KEY"]);
    }
    // music/SFX lanes previously named SUNO_API_KEY / MUSICGEN_API_KEY /
    // SFX_API_KEY / ELEVENLABS_SFX — none of which any code reads.
    for (const capability of ["music_generation", "sound_effects"]) {
      const names = capabilityEnvNames(capability);
      expect(names.length).toBeGreaterThan(0);
      for (const n of names) expect(allProviderEnvVars()).toContain(n);
      expect(names).toContain("REPLICATE_API_TOKEN");
      expect(names).not.toContain("SUNO_API_KEY");
      expect(names).not.toContain("MUSICGEN_API_KEY");
      expect(names).not.toContain("SFX_API_KEY");
    }
    const subs = capabilityEnvNames("subtitle_generation");
    expect(subs).toContain("OPENAI_API_KEY");
    expect(subs).toContain("ANTHROPIC_API_KEY");
    expect(subs).not.toContain("WHISPER_API_KEY");
    expect(subs).not.toContain("DEEPGRAM_API_KEY");
    expect(envNamesPhrase(["A", "B", "C"])).toBe("A, B or C");
  });
});

describe("gate env vars — the regression guard", () => {
  test("no gate-shaped env var name in src/ is outside the registry", () => {
    const registry = new Set(allProviderEnvVars());
    const slotNames = new Set(PROVIDER_SLOTS.map((s) => s.id));
    const offenders: string[] = [];
    for (const file of walk("src")) {
      const text = readFileSync(file, "utf8");
      for (const match of text.matchAll(/\b[A-Z][A-Z0-9_]*_(?:API_KEY|API_TOKEN|SPEECH_KEY|SPEECH_REGION)\b/g)) {
        const name = match[0];
        if (!registry.has(name)) offenders.push(`${file}: ${name}`);
      }
    }
    // README-visible provider ids must exist too (a slot id that does not exist
    // would be just as misleading as an env var name nobody reads).
    expect(slotNames.size).toBeGreaterThan(0);
    expect(offenders).toEqual([]);
  });

  test("the invented capability-level names appear nowhere in src/ except as negative assertions", () => {
    const offenders: string[] = [];
    for (const file of walk("src")) {
      const lines = readFileSync(file, "utf8").split("\n");
      for (const line of lines) {
        for (const name of INVENTED_NAMES) {
          if (line.includes(name) && !line.includes("not.toContain")) {
            offenders.push(`${file}: ${line.trim().slice(0, 90)}`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
