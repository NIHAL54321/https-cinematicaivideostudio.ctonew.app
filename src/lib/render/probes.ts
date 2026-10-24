/**
 * The render pipeline's REQUISITE PROBES — the only place that decides whether
 * a stage can run here.
 *
 * WHY THIS FILE EXISTS (Phase 8, block 1)
 * The owner's rule for the whole of Phase 8 is that a stage which cannot run
 * must be GATED and name exactly what is missing. A typed boolean
 * (`canEncode: true`) is a claim with nothing behind it: it can be edited to
 * say anything and it goes stale the moment the machine changes. So no stage
 * carries a boolean. Each stage names a probe, and every probe below answers by
 * DOING THE THING and reporting what actually happened:
 *
 *   - `ffmpeg-binary` / `ffprobe-binary`: spawn the binary and read the exit
 *     code. ENOENT is reported as ENOENT, not guessed at.
 *   - `storage-writable`: create the output directory, write a real file into
 *     it, read the bytes back, unlink it. A read-only mount or a full disk
 *     fails here rather than three stages later.
 *   - `encode-provider-keyed`: asks `capabilityConnectivity()` — the same
 *     derivation the status API and every engine gate use — whether a WIRED
 *     encode provider is configured. Env vars are read lazily, per call.
 *   - `project-has-scenes`: counts the project's own Scene rows in the database.
 *
 * Every probe returns its EVIDENCE (`detail`) verbatim — the command and exit
 * code, the errno, the capability reason — so the read-out can print how it
 * knows, and `missing` names the input in the words a person would use.
 *
 * Nothing here is cached across a job: the machine can change between runs
 * (a binary can be installed, a key added), and a cached "absent" would become
 * a lie in the other direction.
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { capabilityConnectivity } from "@/lib/ai/providers/capability-connectivity";
import { EXPORT_ENCODE_CAPABILITY } from "@/lib/export/service";

/** The probe ids a stage may name. A stage naming anything else fails a test. */
export type ProbeId =
  | "project-has-scenes"
  | "storage-writable"
  | "ffmpeg-binary"
  | "ffprobe-binary"
  | "encode-provider-keyed";

/** What a stage can see when its requisite is probed. */
export interface ProbeContext {
  projectId: string;
  /** Directory a file-producing stage would write into. */
  outputDir: string;
  /** Reads the project's own rows — the probe queries, the caller does not pre-judge. */
  projectFacts: () => Promise<{ sceneCount: number }>;
}

export interface ProbeResult {
  probeId: ProbeId;
  ok: boolean;
  /** How we know — the command and exit code, the errno, the capability reason. */
  detail: string;
  /** The named missing input when !ok; null when the probe passed. */
  missing: string | null;
  checkedAt: string;
}

export type Probe = (ctx: ProbeContext) => Promise<Omit<ProbeResult, "probeId" | "checkedAt">>;

/** Where a file-producing stage writes. /tmp, because /home is the small volume. */
export function renderOutputDir(): string {
  return process.env.RENDER_OUTPUT_DIR?.trim() || "/tmp/cavs-render-output";
}

/** Spawn a binary and report its own answer. Never assumes a binary exists. */
function probeBinary(bin: string, args: string[]): { ok: boolean; detail: string; missing: string | null } {
  const r = spawnSync(bin, args, { encoding: "utf8", timeout: 10_000 });
  if (r.error) {
    const code = (r.error as NodeJS.ErrnoException).code ?? "spawn-error";
    return {
      ok: false,
      detail: `spawn ${bin} ${args.join(" ")} → ${code} (${r.error.message})`,
      missing: `${bin} binary — not installed on this machine (${code})`,
    };
  }
  if (r.status !== 0) {
    return {
      ok: false,
      detail: `spawn ${bin} ${args.join(" ")} → exit ${r.status}; stderr: ${(r.stderr || "").trim().slice(0, 200)}`,
      missing: `${bin} binary — present but not runnable (exit ${r.status})`,
    };
  }
  const firstLine = (r.stdout || "").trim().split("\n")[0] ?? "";
  return { ok: true, detail: `${bin} ${args.join(" ")} → exit 0; ${firstLine.slice(0, 160)}`, missing: null };
}

export const PROBES: Record<ProbeId, Probe> = {
  "ffmpeg-binary": async () => probeBinary("ffmpeg", ["-version"]),
  "ffprobe-binary": async () => probeBinary("ffprobe", ["-version"]),

  "storage-writable": async (ctx) => {
    const dir = ctx.outputDir;
    const file = join(dir, `.probe-${process.pid}-${Date.now()}.txt`);
    const payload = `cavs-render-storage-probe ${new Date().toISOString()}\n`;
    try {
      mkdirSync(dir, { recursive: true });
      writeFileSync(file, payload, "utf8");
      const readBack = readFileSync(file, "utf8");
      const bytes = statSync(file).size;
      unlinkSync(file);
      if (readBack !== payload) {
        return {
          ok: false,
          detail: `wrote ${payload.length} bytes to ${file} and read back ${readBack.length} — content mismatch`,
          missing: `writable render storage at ${dir} — the file did not read back intact`,
        };
      }
      return { ok: true, detail: `wrote, read back and unlinked ${bytes} bytes in ${dir}`, missing: null };
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      try {
        if (existsSync(file)) unlinkSync(file);
      } catch {
        /* the probe file is best-effort cleanup */
      }
      return {
        ok: false,
        detail: `write ${file} → ${e.code ?? "error"}: ${e.message}`,
        missing: `writable render storage at ${dir} (${e.code ?? "error"})`,
      };
    }
  },

  "encode-provider-keyed": async () => {
    const c = capabilityConnectivity(EXPORT_ENCODE_CAPABILITY);
    return {
      ok: c.connected,
      detail: `${EXPORT_ENCODE_CAPABILITY} via capabilityConnectivity(): connected=${c.connected}; ${c.reason}`,
      missing: c.connected
        ? null
        : `a keyed encode provider for ${EXPORT_ENCODE_CAPABILITY} (${c.requiredEnv.join(" or ") || "no wired provider"} — not set)`,
    };
  },

  "project-has-scenes": async (ctx) => {
    try {
      const facts = await ctx.projectFacts();
      return {
        ok: facts.sceneCount > 0,
        detail: `counted ${facts.sceneCount} Scene row(s) for project ${ctx.projectId}`,
        missing: facts.sceneCount > 0 ? null : `scenes on the project — it has 0 Scene rows, so there is nothing to render`,
      };
    } catch (err) {
      const e = err as Error;
      return {
        ok: false,
        detail: `reading Scene rows failed: ${e.message}`,
        missing: `the project's rows — the database read failed (${e.message.slice(0, 120)})`,
      };
    }
  },
};

/**
 * Runs one probe and stamps it. Unknown ids are a programming error, not a pass.
 * `registry` exists so a test can inject probes WITHOUT the injection being
 * bypassed: an earlier version looked the probe up in the global `PROBES`
 * regardless of what the caller passed, which silently defeated the test seam.
 */
export async function runProbe(
  probeId: ProbeId,
  ctx: ProbeContext,
  registry: Record<ProbeId, Probe> = PROBES,
): Promise<ProbeResult> {
  const probe = registry[probeId];
  const checkedAt = new Date().toISOString();
  if (!probe) {
    return {
      probeId,
      ok: false,
      detail: `no probe is registered for "${probeId}"`,
      missing: `a registered probe for "${probeId}" — the pipeline names one that does not exist`,
      checkedAt,
    };
  }
  const r = await probe(ctx);
  return { probeId, checkedAt, ...r };
}
