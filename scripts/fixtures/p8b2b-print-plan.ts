/**
 * Phase 8 block 2b — print the EXACT argv the encode-master stage spawns for a
 * preset, so a failure can be reproduced and measured without hand-typing a
 * command. Nothing here chooses a flag: every argument comes from
 * `encodeCommandPlan()` reading the preset's resolved specification, and each
 * one is printed with the reason it is there.
 *
 * Usage: bun run scripts/fixtures/p8b2b-print-plan.ts youtube-2160p [input] [output]
 */
import { findExportPreset } from "@/lib/export/presets";
import { encodeCommandPlan } from "@/lib/export/youtube-master";

const presetId = process.argv[2] ?? "youtube-2160p";
const input = process.argv[3] ?? "(input path)";
const output = process.argv[4] ?? "(output path)";

const spec = findExportPreset(presetId);
if (!spec) throw new Error(`no preset ${presetId}`);

const plan = encodeCommandPlan(spec);
const argv = ["-y", "-hide_banner", "-i", input, ...plan.stageAttribution.encode, ...plan.stageAttribution.mux, output];

console.log(`preset     : ${spec.id} — ${spec.label}`);
console.log(`binary     : ${plan.binary}`);
console.log(`video codec: ${spec.video.codec} (${spec.video.codecFamily}) ${spec.video.profile} @ level ${spec.video.level ?? "none"}`);
console.log(`frame      : ${spec.widthPx}x${spec.heightPx} @ ${spec.video.frameRate} fps`);
console.log(`rate ctrl  : target ${spec.video.rateControl.targetVideoBitrateKbps} kbps, cap ${spec.video.rateControl.maxVideoBitrateKbps ?? "none"} kbps, ${spec.video.rateControl.mode}`);
console.log("\n=== ARGV THE STAGE SPAWNS ===");
console.log(JSON.stringify(argv, null, 0));
console.log("\n=== SHELL FORM ===");
console.log(`${plan.binary} ${argv.map((a) => (/^[A-Za-z0-9_.,:=\/+-]+$/.test(a) ? a : `'${a}'`)).join(" ")}`);
console.log("\n=== ARGUMENT REASONS (from the plan, not typed here) ===");
for (const r of plan.argReasons) console.log(`- ${typeof r === "string" ? r : JSON.stringify(r)}`);
