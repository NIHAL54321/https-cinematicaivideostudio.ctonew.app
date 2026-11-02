/**
 * Phase 8 block 9 — SOURCE ALL NINE SCENES through the product's own routes.
 *
 * Three modes, all of them driving the app the way a user does:
 *
 *   search            for every scene of the fixture project:
 *                     GET /api/media?sceneId=…&mediaType=video&count=20
 *                     → the query the builder actually sent, and every real
 *                       candidate the provider answered with, written to JSON
 *   source <order> <externalId>
 *                     POST /api/media/select  (the Asset + StockAsset +
 *                                              LicensingMetadata + SceneAsset rows)
 *                     POST /api/media/ingest  (the provider's bytes stored in
 *                                              our own object storage, read back
 *                                              out and hashed)
 *   table             read the database back and print the provenance table
 *
 * The candidate chosen is ALWAYS one the provider actually returned in the
 * `search` run that was read and judged — it is never invented, and `source`
 * refuses an id that was not in that run.
 *
 * Usage:
 *   bun scripts/fixtures/p8b9-source-nine.ts search [out.json]
 *   bun scripts/fixtures/p8b9-source-nine.ts source <order> <externalId> [in.json]
 *   bun scripts/fixtures/p8b9-source-nine.ts table [out.md]
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { prisma } from "@/lib/db";

const BASE = process.env.P8B9_BASE ?? "http://127.0.0.1:3100";
const EMAIL = process.env.P8B9_EMAIL ?? "p7a-fixture@cavs.test";
const PASSWORD = process.env.P8B9_PASSWORD ?? "p7a-fixture-password-2026";
const PROJECT = process.env.P8B9_PROJECT ?? "p7a_fix_project";
const COUNT = Number(process.env.P8B9_COUNT ?? 20);

type Json = Record<string, unknown>;

interface Candidate extends Json {
  provider: string;
  externalId: string;
  title: string;
  author: string;
  width: number;
  height: number;
  durationSeconds?: number;
  pageUrl?: string;
  url: string;
}

interface SceneSearch {
  order: number;
  sceneId: string;
  title: string | null;
  visualPrompt: string | null;
  query: string;
  queryHint: string;
  subject: string[];
  status: number;
  providerStatus: string;
  candidates: Candidate[];
  providerResponses: unknown;
}

async function signIn(): Promise<string> {
  const res = await fetch(`${BASE}/api/auth/signin`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`signin answered ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const cookie = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error("signin answered OK but set no session cookie");
  return cookie;
}

async function call(cookie: string, path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", cookie, ...(init.headers ?? {}) },
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* keep raw text */
  }
  return { status: res.status, json: json as Json | null, text };
}

async function scenes() {
  const rows = await prisma.scene.findMany({
    where: { projectId: PROJECT },
    orderBy: { order: "asc" },
    select: { id: true, order: true, title: true, visualPrompt: true, narration: true, durationSeconds: true },
  });
  if (rows.length === 0) throw new Error(`project ${PROJECT} has no scenes`);
  return rows;
}

async function search(outPath: string) {
  const cookie = await signIn();
  const rows = await scenes();
  const all: SceneSearch[] = [];
  for (const s of rows) {
    const r = await call(cookie, `/api/media?sceneId=${s.id}&mediaType=video&count=${COUNT}`);
    if (r.status !== 200) throw new Error(`scene ${s.order}: media search answered ${r.status}: ${r.text.slice(0, 300)}`);
    const body = r.json as Json;
    const q = (body.query ?? {}) as Json;
    const list = (Array.isArray(body.candidates) ? body.candidates : []) as Candidate[];
    all.push({
      order: s.order,
      sceneId: s.id,
      title: s.title,
      visualPrompt: s.visualPrompt,
      query: String(q.keywords ?? ""),
      queryHint: String(q.queryHint ?? ""),
      subject: (q.subject as string[]) ?? [],
      status: r.status,
      providerStatus: String(body.status ?? "?"),
      candidates: list,
      providerResponses: body.providerResponses ?? null,
    });
    console.log(`scene ${s.order}: ${r.status} ${String(body.status)} ${list.length} candidate(s) — query: ${String(q.keywords ?? "")}`);
    for (const c of list.slice(0, 12)) {
      console.log(
        `    ${c.provider}/${c.externalId}  ${c.width}x${c.height}  ${String(c.durationSeconds ?? "?")}s  ` +
          `${c.author}  — ${c.title}`,
      );
    }
  }
  writeFileSync(outPath, JSON.stringify({ base: BASE, project: PROJECT, count: COUNT, scenes: all }, null, 2));
  console.log(`\nwritten to ${outPath}`);
}

async function source(order: number, externalId: string, inPath: string) {
  if (!existsSync(inPath)) throw new Error(`${inPath} not found — run the search step first`);
  const run = JSON.parse(readFileSync(inPath, "utf8")) as { scenes: SceneSearch[] };
  const scene = run.scenes.find((s) => s.order === order);
  if (!scene) throw new Error(`order ${order} is not in ${inPath}`);
  const chosen = scene.candidates.find((c) => String(c.externalId) === String(externalId));
  if (!chosen) {
    throw new Error(
      `provider/${externalId} was NOT in the candidate list the provider answered for scene ${order} ` +
        `(${scene.candidates.map((c) => c.externalId).join(", ") || "none"}) — refusing to select an asset that was never offered`,
    );
  }

  const cookie = await signIn();
  console.log(`scene ${order} (${scene.sceneId}) — query sent: ${scene.query}`);
  console.log(`chosen: ${chosen.provider}/${chosen.externalId} "${chosen.title}" by ${chosen.author} (${chosen.width}x${chosen.height}, ${chosen.durationSeconds ?? "?"}s)`);

  const selected = await call(cookie, `/api/media/select`, {
    method: "POST",
    body: JSON.stringify({ sceneId: scene.sceneId, asset: chosen }),
  });
  if (selected.status !== 200 && selected.status !== 201) {
    throw new Error(`select answered ${selected.status}: ${selected.text.slice(0, 500)}`);
  }
  const selJson = selected.json as Json;
  const assetId = String((selJson.assetId as string) ?? ((selJson.asset as Json)?.id as string) ?? "");
  if (!assetId) throw new Error(`select answered ${selected.status} but no asset id: ${selected.text.slice(0, 400)}`);
  console.log(`select  → ${selected.status}  assetId ${assetId}`);

  const ingest = await call(cookie, `/api/media/ingest`, { method: "POST", body: JSON.stringify({ assetId }) });
  if (ingest.status !== 200) throw new Error(`ingest answered ${ingest.status}: ${ingest.text.slice(0, 800)}`);
  const ing = ingest.json as { footage: Json; alreadyStored: boolean };
  console.log(`ingest  → ${ingest.status}  alreadyStored=${ing.alreadyStored}`);
  console.log(`  storedKey : ${String(ing.footage.storedKey)}`);
  console.log(`  bytes     : ${String(ing.footage.bytes)}`);
  console.log(`  sha256    : ${String(ing.footage.sha256)}`);
  console.log(`  licence   : ${String(ing.footage.licenseType)} — ${String(ing.footage.licenseUrl)}`);
  console.log(`  pageUrl   : ${String(ing.footage.pageUrl)}`);
  console.log(`  author    : ${String(ing.footage.author)}`);

  const after = await prisma.sceneAsset.count({ where: { sceneId: scene.sceneId } });
  console.log(`scene ${order} now has ${after} asset link(s)`);
}

async function ingestExisting(assetId: string) {
  const cookie = await signIn();
  const ingest = await call(cookie, `/api/media/ingest`, { method: "POST", body: JSON.stringify({ assetId }) });
  if (ingest.status !== 200) throw new Error(`ingest answered ${ingest.status}: ${ingest.text.slice(0, 800)}`);
  const ing = ingest.json as { footage: Json; alreadyStored: boolean };
  console.log(`ingest ${assetId} → ${ingest.status}  alreadyStored=${ing.alreadyStored}`);
  console.log(`  storedKey : ${String(ing.footage.storedKey)}`);
  console.log(`  bytes     : ${String(ing.footage.bytes)}`);
  console.log(`  sha256    : ${String(ing.footage.sha256)}`);
  console.log(`  author    : ${String(ing.footage.author)}  pageUrl: ${String(ing.footage.pageUrl)}`);
}

async function table(inPath: string, outPath: string) {
  if (!existsSync(inPath)) throw new Error(`${inPath} not found — run the search step first`);
  const run = JSON.parse(readFileSync(inPath, "utf8")) as { scenes: SceneSearch[] };
  const rows = await scenes();
  const lines: string[] = [];
  lines.push("| # | scene | query sent to the provider | provider id | author | page URL | stored key | bytes | sha256 | licence |");
  lines.push("|---|-------|---------------------------|-------------|--------|----------|-----------|-------|--------|---------|");
  for (const s of rows) {
    const searched = run.scenes.find((x) => x.sceneId === s.id);
    const links = await prisma.sceneAsset.findMany({
      where: { sceneId: s.id },
      orderBy: { order: "asc" },
      select: {
        asset: {
          select: {
            id: true,
            s3Key: true,
            sizeBytes: true,
            metadata: true,
            stockAsset: { select: { provider: true, externalId: true, pageUrl: true } },
            licensing: { select: { licenseType: true, licenseUrl: true, source: true, attribution: true } },
          },
        },
      },
    });
    const a = links[0]?.asset;
    const f = ((a?.metadata as Json | null)?.footage ?? null) as Json | null;
    lines.push(
      `| ${s.order} | ${s.title ?? ""} | ${searched?.query ?? "(no search recorded)"} | ${
        a?.stockAsset ? `${a.stockAsset.provider}/${a.stockAsset.externalId}` : "—"
      } | ${f ? String(f.author ?? "—") : "—"} | ${a?.stockAsset?.pageUrl ?? "—"} | ${a?.s3Key ?? "—"} | ${
        a?.sizeBytes ? String(a.sizeBytes) : "—"
      } | ${f ? String(f.sha256 ?? "—") : "—"} | ${a?.licensing ? String(a.licensing.licenseType) : "—"} |`,
    );
    if (links.length > 1) lines.push(`| | _(+${links.length - 1} more link(s) on this scene — see the notes)_ | | | | | | | | |`);
  }
  const text = lines.join("\n");
  writeFileSync(outPath, text + "\n");
  console.log(text);
  console.log(`\nwritten to ${outPath}`);
}

const [mode, a1, a2, a3] = process.argv.slice(2);
if (mode === "search") {
  await search(a1 ?? "/tmp/p8b9_candidates.json");
} else if (mode === "source") {
  await source(Number(a1), String(a2), a3 ?? "/tmp/p8b9_candidates.json");
} else if (mode === "ingest") {
  await ingestExisting(String(a1));
} else if (mode === "table") {
  await table(a1 ?? "/tmp/p8b9_candidates.json", a2 ?? "/tmp/p8b9_table.md");
} else {
  console.error("usage: search [out.json] | source <order> <externalId> [in.json] | table <candidates.json> [out.md]");
  process.exit(2);
}
process.exit(0);
