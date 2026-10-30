/**
 * METERING: THE ROW IS WRITTEN BY THE ACTION, AND A FAILURE IS VISIBLE
 * (Phase 8, block 5).
 *
 * The builders are tested for what they say (kind, outcome, synthetic marking),
 * and `meter()` is tested for the two things that matter operationally:
 *
 *   - it refuses an input that would be a lie (a negative quantity, a blank
 *     source) BEFORE the database sees it;
 *   - when the store fails it returns `recorded: false` with the error — it does
 *     not throw (the work already happened) and it does not pretend the row was
 *     written (which would be the accounting equivalent of a fake success).
 */
import { describe, expect, test } from "bun:test";
import {
  encoderProbe,
  METERED_PROBE_IDS,
  meter,
  providerCallAttempt,
  renderJobCreated,
  stageRun,
  validateUsageInput,
} from "../metering";
import type { UsageStore } from "../store";
import type { UsageEventInput, UsageEventRecord } from "../types";

function fakeStore(behaviour: "ok" | "fail" = "ok") {
  const rows: UsageEventInput[] = [];
  let calls = 0;
  const store: UsageStore = {
    async appendUsageEvent(input) {
      calls += 1;
      if (behaviour === "fail") throw new Error("connection refused by the accounting database");
      rows.push(input);
      return { ...input, id: `evt_${calls}`, outcome: input.outcome ?? "NOT_APPLICABLE", occurredAt: new Date() } as UsageEventRecord;
    },
    async readUsageEvents() {
      return [];
    },
  };
  return { store, rows, calls: () => calls };
}

describe("meter() writes what the action says, or refuses it", () => {
  test("a valid input is written and its fields are preserved", async () => {
    const { store, rows } = fakeStore();
    const result = await meter(stageRun({
      userId: "u1",
      projectId: "p1",
      renderJobId: "j1",
      stageId: "encode-master",
      state: "FAILED",
      synthetic: true,
      detail: { error: "ffmpeg exited 137" },
    }), store);
    expect(result.recorded).toBe(true);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: "u1",
      renderJobId: "j1",
      stageId: "encode-master",
      kind: "RENDER_STAGE_RUN",
      outcome: "FAILED",
      synthetic: true,
      source: "src/lib/render/runner.ts",
    });
  });

  test("a negative quantity or a blank source is refused before the store is called", async () => {
    const { store, calls } = fakeStore();
    const bad: UsageEventInput = {
      userId: "u1",
      kind: "ENCODER_PROBE",
      quantity: -1,
      unit: "probe",
      synthetic: false,
      source: "src/lib/render/runner.ts",
    };
    const r1 = await meter(bad, store);
    expect(r1.recorded).toBe(false);
    expect(r1.error).toContain("non-negative whole number");
    const r2 = await meter({ ...bad, quantity: 1, source: "   " }, store);
    expect(r2.recorded).toBe(false);
    expect(r2.error).toContain("must name the code path");
    expect(calls()).toBe(0);
    expect(validateUsageInput({ ...bad, quantity: 1, source: "x" })).toBeNull();
  });

  test("NEGATIVE CONTROL: a failing store is reported as NOT recorded, and does not throw", async () => {
    const { store } = fakeStore("fail");
    const result = await meter(
      renderJobCreated({ userId: "u1", projectId: "p1", renderJobId: "j1", presetId: "youtube-1080p", synthetic: false }),
      store,
    );
    expect(result.recorded).toBe(false);
    expect(result.error).toContain("connection refused");
    expect(result.id).toBeUndefined();
  });
});

describe("the builders say what happened, not what would be flattering", () => {
  test("a provider attempt that failed is recorded as FAILED and never as synthetic", () => {
    const failed = providerCallAttempt({
      userId: "u1",
      provider: "openai",
      model: "gpt-x",
      capability: "script_generation",
      taskType: "SCRIPT",
      ok: false,
      error: "401 invalid api key",
    });
    expect(failed).toMatchObject({ kind: "PROVIDER_CALL_ATTEMPT", outcome: "FAILED", synthetic: false, quantity: 1 });
    expect((failed.detail as Record<string, unknown>).error).toBe("401 invalid api key");
    const ok = providerCallAttempt({
      userId: "u1",
      provider: "replicate",
      model: null,
      capability: "video_enhancement",
      taskType: "ENHANCE_VIDEO",
      ok: true,
    });
    expect(ok.outcome).toBe("SUCCEEDED");
    expect(ok.synthetic).toBe(false);
  });

  test("an encoder probe keeps its probe id and its evidence", () => {
    const probe = encoderProbe({
      userId: "u1",
      projectId: "p1",
      renderJobId: "j1",
      stageId: "encode-master",
      probeId: "ffmpeg-binary",
      ok: true,
      synthetic: true,
      detail: "ffmpeg version 7.0.2-static",
    });
    expect(probe.kind).toBe("ENCODER_PROBE");
    expect(probe.detail).toMatchObject({ probeId: "ffmpeg-binary", evidence: "ffmpeg version 7.0.2-static" });
    expect(METERED_PROBE_IDS).toContain("ffmpeg-binary");
    expect(METERED_PROBE_IDS).not.toContain("project-has-scenes");
  });

  test("a synthetic job's usage row says synthetic in its own column", () => {
    const synthetic = renderJobCreated({
      userId: "u1",
      projectId: "p1",
      renderJobId: "j1",
      presetId: "youtube-1080p",
      synthetic: true,
    });
    expect(synthetic.synthetic).toBe(true);
    const real = renderJobCreated({ userId: "u1", projectId: "p1", renderJobId: "j2", presetId: "youtube-1080p", synthetic: false });
    expect(real.synthetic).toBe(false);
  });
});
