/**
 * DEV-GATED mechanism tests for the AI Model Orchestrator.
 *
 * Run:  CAVS_TEST_MODE=1 bun test src/lib/ai/__tests__/orchestrator.test.ts
 *
 * These prove the A → B → C → D fallback ordering and the honest
 * "not_connected" path using deliberately-failing stub providers. The stubs
 * are hard-gated (registerTestStubs throws outside test mode) and live in the
 * registry's test-only map — never visible to the status API, the router
 * default, or any production route. This is a mechanism test, NOT fake AI.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { execute, enqueue, type AiPersistence } from "../orchestrator";
import { capabilityStatus, allCapabilityStatus } from "../status";
import { providersFor } from "../providers/registry";
import { makeTestStub, registerTestStubs, assertTestModeEnabled } from "../providers/test-stubs";
import type { AiTask } from "../types";

process.env.CAVS_TEST_MODE = "1"; // stubs are only ever allowed under this flag

// ---------------------------------------------------------------------------
// In-memory persistence — records what a real Prisma adapter would write.
// ---------------------------------------------------------------------------

interface MemoryGeneration {
  id: string;
  input: Record<string, unknown>;
  updates: Record<string, unknown>[];
}
class MemoryPersistence implements AiPersistence {
  generations: MemoryGeneration[] = [];
  logs: Record<string, unknown>[] = [];
  async createGeneration(input: Record<string, unknown> & { userId: string }) {
    const id = `gen-${this.generations.length + 1}`;
    this.generations.push({ id, input, updates: [] });
    return { id };
  }
  async updateGeneration(id: string, data: Record<string, unknown>) {
    const g = this.generations.find((x) => x.id === id);
    if (g) g.updates.push(data);
  }
  async createProviderLog(input: Record<string, unknown>) {
    this.logs.push(input);
  }
}

function task(partial: Partial<AiTask> & { capability: AiTask["capability"]; type: AiTask["type"] }): AiTask {
  return { payload: { prompt: "test" }, params: {}, ...partial };
}

// ---------------------------------------------------------------------------
// Stub chains — one set per capability under test.
// ---------------------------------------------------------------------------

const stubA = makeTestStub({ id: "stub-a", name: "Stub A", capabilities: ["script_generation"], rank: 1, behavior: { mode: "fail", error: "A exploded" } });
const stubB = makeTestStub({ id: "stub-b", name: "Stub B", capabilities: ["script_generation"], rank: 2, behavior: { mode: "fail", error: "B exploded" } });
const stubC = makeTestStub({ id: "stub-c", name: "Stub C", capabilities: ["script_generation"], rank: 3, behavior: { mode: "ok" } });
const stubD = makeTestStub({ id: "stub-d", name: "Stub D", capabilities: ["script_generation"], rank: 4, behavior: { mode: "ok" } });

const fail1 = makeTestStub({ id: "fail-1", name: "Fail 1", capabilities: ["translation"], rank: 1, behavior: { mode: "fail", error: "no" } });
const fail2 = makeTestStub({ id: "fail-2", name: "Fail 2", capabilities: ["translation"], rank: 2, behavior: { mode: "fail", error: "no" } });
const fail3 = makeTestStub({ id: "fail-3", name: "Fail 3", capabilities: ["translation"], rank: 3, behavior: { mode: "fail", error: "no" } });
const fail4 = makeTestStub({ id: "fail-4", name: "Fail 4", capabilities: ["translation"], rank: 4, behavior: { mode: "fail", error: "no" } });

const slowA = makeTestStub({ id: "slow-a", name: "Slow A", capabilities: ["seo_generation"], rank: 1, behavior: { mode: "rate_limited", error: "429" } });
const slowB = makeTestStub({ id: "slow-b", name: "Slow B", capabilities: ["seo_generation"], rank: 2, behavior: { mode: "ok" } });

const hangA = makeTestStub({ id: "hang-a", name: "Hang A", capabilities: ["voice_generation"], rank: 1, behavior: { mode: "timeout", error: "slow" } });
const hangB = makeTestStub({ id: "hang-b", name: "Hang B", capabilities: ["voice_generation"], rank: 2, behavior: { mode: "ok" } });

const busy1 = makeTestStub({ id: "busy-1", name: "Busy 1", capabilities: ["sound_effects"], rank: 1, behavior: { mode: "rate_limited" } });
const busy2 = makeTestStub({ id: "busy-2", name: "Busy 2", capabilities: ["sound_effects"], rank: 2, behavior: { mode: "rate_limited" } });

beforeAll(() => {
  registerTestStubs([stubA, stubB, stubC, stubD, fail1, fail2, fail3, fail4, slowA, slowB, hangA, hangB, busy1, busy2]);
});

// ---------------------------------------------------------------------------
// 1. Fallback ordering: A fails → B → C → D (stops at first success)
// ---------------------------------------------------------------------------

describe("A → B → C → D fallback ordering", () => {
  test("A and B fail, C succeeds, D is never attempted", async () => {
    const persistence = new MemoryPersistence();
    const result = await execute("user-1", task({ type: "SCRIPT", capability: "script_generation" }), { persistence });

    expect(result.status).toBe("ok");
    expect(result.provider).toBe("stub-c");
    expect(result.attempts.map((a) => a.provider)).toEqual(["stub-a", "stub-b", "stub-c"]);
    expect(result.generationId).toBe("gen-1");
    // Exactly one AIGeneration row, closed as SUCCEEDED with the winner.
    expect(persistence.generations).toHaveLength(1);
    expect(persistence.generations[0].updates.at(-1)?.status).toBe("SUCCEEDED");
    // One ProviderLog per real attempt (A, B, C) — nothing extra, nothing faked.
    expect(persistence.logs.map((l) => l.provider)).toEqual(["stub-a", "stub-b", "stub-c"]);
    expect(persistence.logs.map((l) => l.status)).toEqual(["FAILED", "FAILED", "SUCCEEDED"]);
  });

  test("every candidate failing exhausts the full A → B → C → D chain", async () => {
    const persistence = new MemoryPersistence();
    const result = await execute("user-1", task({ type: "TRANSLATE", capability: "translation" }), { persistence });

    expect(result.status).toBe("failed");
    expect(result.attempts.map((a) => a.provider)).toEqual(["fail-1", "fail-2", "fail-3", "fail-4"]);
    expect(persistence.generations[0].updates.at(-1)?.status).toBe("FAILED");
    expect(persistence.logs).toHaveLength(4);
    expect(persistence.logs.every((l) => l.status === "FAILED")).toBe(true);
  });

  test("rate_limited falls through to the next candidate", async () => {
    const persistence = new MemoryPersistence();
    const result = await execute("user-1", task({ type: "SEO", capability: "seo_generation" }), { persistence });
    expect(result.status).toBe("ok");
    expect(result.attempts.map((a) => a.provider)).toEqual(["slow-a", "slow-b"]);
    expect(result.attempts[0].status).toBe("rate_limited");
  });

  test("timeout falls through to the next candidate", async () => {
    const persistence = new MemoryPersistence();
    const result = await execute("user-1", task({ type: "VOICE", capability: "voice_generation" }), { persistence });
    expect(result.status).toBe("ok");
    expect(result.attempts.map((a) => a.provider)).toEqual(["hang-a", "hang-b"]);
    expect(result.attempts[0].status).toBe("timeout");
  });

  test("all attempts rate_limited aggregates to status rate_limited", async () => {
    const persistence = new MemoryPersistence();
    const result = await execute("user-1", task({ type: "SOUND_EFFECT", capability: "sound_effects" }), { persistence });
    expect(result.status).toBe("rate_limited");
    expect(result.attempts).toHaveLength(2);
    expect(persistence.generations[0].updates.at(-1)?.status).toBe("FAILED");
  });
});

// ---------------------------------------------------------------------------
// 2. Honest not_connected path — no fake generation, ever
// ---------------------------------------------------------------------------

describe("not_connected path", () => {
  test("unconfigured capability returns not_connected with requiredEnv, no AIGeneration row", async () => {
    const persistence = new MemoryPersistence();
    const result = await execute(
      "user-1",
      task({ type: "MUSIC", capability: "music_generation", payload: { genre: "cinematic" } }),
      { persistence },
    );

    expect(result.status).toBe("not_connected");
    expect(result.requiredEnv).toContain("STABILITY_API_KEY");
    expect(result.requiredEnv).toContain("REPLICATE_API_TOKEN");
    expect(result.error).toContain("Provider Not Connected");
    // The golden rule: NO AIGeneration row for a task that was never attempted.
    expect(persistence.generations).toHaveLength(0);
    // One honest audit entry explaining nothing was configured.
    expect(persistence.logs).toHaveLength(1);
    expect(persistence.logs[0].provider).toBe("none");
    expect(String(persistence.logs[0].errorMessage)).toContain("no provider is configured");
  });

  test("enqueue() with no configured provider also returns not_connected without touching the queue", async () => {
    const persistence = new MemoryPersistence();
    const result = await enqueue(
      "user-1",
      task({ type: "MUSIC", capability: "music_generation", payload: { genre: "cinematic" } }),
      { persistence },
    );
    expect(result.status).toBe("not_connected");
    expect(persistence.generations).toHaveLength(0);
    expect(persistence.logs).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// 3. Dev-gating — stubs can never escape test mode
// ---------------------------------------------------------------------------

describe("dev-gating", () => {
  test("registerTestStubs throws outside test mode", () => {
    const prevFlag = process.env.CAVS_TEST_MODE;
    const prevNodeEnv = process.env.NODE_ENV;
    try {
      delete process.env.CAVS_TEST_MODE;
      process.env.NODE_ENV = "production";
      expect(() => registerTestStubs([makeTestStub({ id: "x", name: "X", capabilities: ["reasoning"], rank: 1, behavior: { mode: "ok" } })])).toThrow(/FORBIDDEN|never/);
    } finally {
      process.env.CAVS_TEST_MODE = prevFlag;
      process.env.NODE_ENV = prevNodeEnv;
    }
  });

  test("assertTestModeEnabled is a hard guard", () => {
    expect(assertTestModeEnabled).not.toThrow(); // we ARE in test mode here
  });

  test("stubs are invisible to the default (production) registry view", () => {
    // Even with stubs registered under test mode, the default providersFor()
    // (what the status API and production routes use) never returns them.
    const ids = providersFor("script_generation").map((p) => p.id);
    expect(ids).not.toContain("stub-a");
    expect(ids).toContain("openai"); // real slots are there, just not wired
  });
});

// ---------------------------------------------------------------------------
// 4. Status surface
// ---------------------------------------------------------------------------

describe("status surface", () => {
  test("all 21 capabilities are reported, all not_connected in Phase 1", () => {
    const all = allCapabilityStatus();
    expect(all).toHaveLength(21);
    expect(all.every((c) => c.status === "not_connected")).toBe(true);
    expect(all.every((c) => c.requiredEnv.length > 0)).toBe(true);
  });

  test("reasoning requires language-model env vars", () => {
    const reasoning = capabilityStatus("reasoning");
    expect(reasoning.status).toBe("not_connected");
    expect(reasoning.requiredEnv).toEqual(
      expect.arrayContaining(["OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_AI_API_KEY"]),
    );
  });
});
