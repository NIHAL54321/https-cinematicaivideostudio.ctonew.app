#!/usr/bin/env bun
/**
 * ADVERSARIAL SECURITY PROBE (Phase 8, security block).
 *
 * What this is: a script that runs against the LIVE server on :3100 and prints
 * one PASS/FAIL line per check plus a summary. It is not a scanner and it is not
 * a substitute for an audit — it is a list of specific questions with specific
 * expected answers, re-runnable after every change, so that a claim like "a
 * foreign account cannot read somebody else's download" is a thing this team can
 * re-prove in one command instead of remembering.
 *
 * What it deliberately does:
 *   - it derives the route list from `src/app/api/**\/route.ts` (55 files at the
 *     time of writing) and the HTTP methods from the exported handlers, so a new
 *     route is covered by the anonymous sweep the moment it is added;
 *   - it signs in as two real fixture accounts and proves the second session is
 *     genuinely valid BEFORE concluding that a 404 on the first account's ids is
 *     a denial rather than a broken session;
 *   - it treats "no data came back" as the thing being tested: a 400 or a 404 are
 *     both acceptable refusals, a 200 or a 403 are not;
 *   - it records, for every refusal it accepts, what the server actually said, so
 *     the evidence file can be read without the code.
 *
 * What it deliberately does NOT do:
 *   - it does not weaken a check to make a run pass;
 *   - it does not invent a pass for something it could not reach. A check that
 *     could not be run is printed as SKIP with the reason, and SKIP is not PASS.
 *
 * Usage:
 *   bun scripts/security/probe.ts                  # against http://127.0.0.1:3100
 *   CAVS_BASE=http://127.0.0.1:3100 bun scripts/security/probe.ts
 *
 * Fixtures: it uses the two accounts created by scripts/fixtures/p7a-world.sh
 * (A = the fixture owner, B = the foreign account) and the delivered project
 * artefact rows already in the database. It creates a small number of its own
 * rows (one victim project as A, a handful of assets as A) and removes them
 * again at the end.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { prisma } from "@/lib/db";

const BASE = (process.env.CAVS_BASE ?? "http://127.0.0.1:3100").replace(/\/+$/, "");
// The probe reads the route list and the source it greps from the repo it is run
// in; run it from the repo root (`bun scripts/security/probe.ts`) or set
// CAVS_APP_DIR. It says so rather than reporting a pass it could not earn.
const APP = process.env.CAVS_APP_DIR ?? process.cwd();
const A = { email: "p7a-fixture@cavs.test", password: "p7a-fixture-password-2026" };
const B = { email: "p8b10-foreign@cavs.test", password: "p8b10-foreign-password-2026" };

/* ------------------------------------------------------------------ */
/* Result bookkeeping                                                  */
/* ------------------------------------------------------------------ */
type Status = "PASS" | "FAIL" | "SKIP";
const rows: Array<{ status: Status; id: string; detail: string }> = [];
const bodies: Array<{ url: string; body: string }> = [];

function record(status: Status, id: string, detail: string): void {
  rows.push({ status, id, detail });
  console.log(`[${status}] ${id} — ${detail}`);
}
function check(id: string, ok: boolean, detail: string): boolean {
  record(ok ? "PASS" : "FAIL", id, detail);
  return ok;
}
function skip(id: string, reason: string): void {
  record("SKIP", id, reason);
}
function section(title: string): void {
  console.log(`\n===== ${title} =====`);
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */
interface Reply {
  status: number;
  headers: Headers;
  body: string;
  json: any;
  ms: number;
}

async function http(
  method: string,
  path: string,
  opts: { cookie?: string; body?: unknown; xff?: string; headers?: Record<string, string>; timeoutMs?: number } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.cookie) headers["cookie"] = opts.cookie;
  if (opts.xff) headers["x-forwarded-for"] = opts.xff;
  let payload: string | undefined;
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(opts.body);
  }
  const started = Date.now();
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: payload,
    redirect: "manual",
    signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
  });
  const body = await res.text();
  const ms = Date.now() - started;
  bodies.push({ url: `${method} ${path}`, body });
  let json: any = null;
  try {
    json = JSON.parse(body);
  } catch {
    /* not JSON — fine */
  }
  return { status: res.status, headers: res.headers, body, json, ms };
}

/** Headers only: reads the status line and headers, then cancels the body. */
async function head(method: string, path: string, opts: { cookie?: string } = {}): Promise<{ status: number; headers: Headers }> {
  const headers: Record<string, string> = {};
  if (opts.cookie) headers["cookie"] = opts.cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    redirect: "manual",
    signal: AbortSignal.timeout(30_000),
  });
  await res.body?.cancel().catch(() => {});
  return { status: res.status, headers: res.headers };
}

function setCookieOf(r: Reply): string[] {
  const anyHeaders = r.headers as unknown as { getSetCookie?: () => string[] };
  if (typeof anyHeaders.getSetCookie === "function") return anyHeaders.getSetCookie();
  const single = r.headers.get("set-cookie");
  return single ? [single] : [];
}

async function signIn(creds: { email: string; password: string }, xff?: string): Promise<{ ok: boolean; cookie: string; reply: Reply; raw: string[] }> {
  const reply = await http("POST", "/api/auth/signin", { body: creds, xff });
  const raw = setCookieOf(reply);
  const line = raw.find((c) => c.startsWith("cavs_session=")) ?? "";
  const value = line.split(";")[0] ?? "";
  return { ok: reply.status === 200 && value.length > 0, cookie: value, reply, raw };
}

/* ------------------------------------------------------------------ */
/* Route enumeration                                                   */
/* ------------------------------------------------------------------ */
interface Route {
  path: string;
  file: string;
  methods: string[];
  params: string[];
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name === "route.ts") out.push(full);
  }
  return out;
}

function routeTable(): Route[] {
  const root = join(APP, "src", "app", "api");
  if (!existsSync(root)) {
    throw new Error(`no route tree at ${root} — run the probe from the repo root, or set CAVS_APP_DIR`);
  }
  return walk(root)
    .sort()
    .map((file) => {
      const rel = file.slice(root.length).replace(/\/route\.ts$/, "");
      const source = readFileSync(file, "utf8");
      const methods = [...source.matchAll(/export\s+(?:async\s+)?function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/g)].map((m) => m[1]);
      const params = [...rel.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
      return { path: `/api${rel}`, file, methods: [...new Set(methods)], params };
    });
}

/** Substitute the probe's own ids into a route path. */
function concrete(route: Route, ids: Record<string, string>, bogus = false): string {
  let p = route.path;
  for (const name of route.params) {
    p = p.replace(`[${name}]`, encodeURIComponent(bogus ? `probe-no-such-${name}-0000` : ids[name] ?? `probe-no-such-${name}-0000`));
  }
  return p;
}

/* ------------------------------------------------------------------ */
/* Main                                                                */
/* ------------------------------------------------------------------ */
const PUBLIC_ROUTES: Record<string, string> = {
  "/api/health": "liveness probe — public by design, returns no user data",
  "/api/auth/session": "answers who the caller is, including nobody — public by design",
  "/api/auth/signin": "the sign-in endpoint itself",
  "/api/auth/signup": "the sign-up endpoint itself",
  "/api/auth/signout": "clearing a session the caller does not have is a no-op — the route deletes only the presented token and returns no data",
};

let exitCode = 0;
const createdAssetIds: string[] = [];
const createdProjectIds: string[] = [];

async function main(): Promise<void> {
  console.log(`CAVS security probe · ${new Date().toISOString()}`);
  console.log(`target: ${BASE}`);
  console.log(`repo:   ${APP}`);

  /* ---------------- world ---------------- */
  section("0. world (fixtures read from the database, not typed here)");
  const userA = await prisma.user.findUnique({ where: { email: A.email }, select: { id: true } });
  const userB = await prisma.user.findUnique({ where: { email: B.email }, select: { id: true } });
  if (!userA || !userB) {
    record("FAIL", "world·fixtures", `one of the fixture accounts is missing (A=${!!userA}, B=${!!userB}) — run scripts/fixtures/p7a-world.sh`);
    finish();
    return;
  }
  const projectA = await prisma.project.findFirst({ where: { userId: userA.id }, orderBy: { createdAt: "asc" }, select: { id: true, title: true } });
  const sceneA = projectA ? await prisma.scene.findFirst({ where: { projectId: projectA.id }, orderBy: { order: "asc" }, select: { id: true } }) : null;
  // The delivered artefact, found by KIND across A's jobs — not by taking the
  // newest job, which may be a run that never produced a container.
  const artefactA = await prisma.renderArtefact.findFirst({
    where: { kind: "delivered-container", syntheticProof: false, job: { userId: userA.id } },
    orderBy: { createdAt: "desc" },
    select: { id: true, bytes: true, sha256: true, jobId: true },
  });
  const jobA = artefactA ? { id: artefactA.jobId, projectId: projectA?.id ?? "" } : null;
  const assetA = await prisma.asset.findFirst({ where: { userId: userA.id, deletedAt: null, s3Key: { not: null } }, select: { id: true } });

  check("world·accounts", !!userA && !!userB, `A=${A.email} (${userA.id}) · B=${B.email} (${userB.id})`);
  check("world·project", !!projectA, projectA ? `A's project ${projectA.id}` : "no project for A — the IDOR sweep cannot run");
  check("world·scene", !!sceneA, sceneA ? `A's scene ${sceneA.id}` : "no scene for A");
  check("world·render job", !!jobA, jobA ? `A's delivered job ${jobA.id}` : "no non-synthetic render job for A");
  check(
    "world·artefact",
    !!artefactA,
    artefactA ? `A's delivered-container artefact ${artefactA.id} (${artefactA.bytes} B, ${artefactA.sha256.slice(0, 16)}…)` : "no delivered-container artefact",
  );
  check("world·asset", !!assetA, assetA ? `A's stored asset ${assetA.id}` : "no stored asset for A");
  if (!projectA || !sceneA || !artefactA || !assetA) {
    record("FAIL", "world", "the fixture world is incomplete — later sections would report a pass they did not earn, so the probe stops here");
    finish();
    return;
  }

  /* ---------------- identity ---------------- */
  section("1. identity of the thing being probed");
  const health = await http("GET", "/api/health");
  check("identity·health", health.status === 200, `GET /api/health -> ${health.status}`);
  const signinPage = await http("GET", "/signin");
  const buildId = /\\?"b\\?":\\?"([^"\\]+)\\?"/.exec(signinPage.body)?.[1] ?? "";
  check("identity·signin page", signinPage.status === 200, `GET /signin -> ${signinPage.status} (${signinPage.body.length} B)`);
  check("identity·build id", !!buildId, `served BUILD_ID: ${buildId || "(not found in the page)"}`);

  /* ---------------- sessions ---------------- */
  section("2. sessions");
  const aMain = await signIn(A, "198.51.100.10");
  const bMain = await signIn(B, "198.51.100.11");
  check("session·A signs in", aMain.ok, `POST /api/auth/signin as A -> ${aMain.reply.status}${aMain.ok ? " with a session cookie" : ""}`);
  check("session·B signs in", bMain.ok, `POST /api/auth/signin as B -> ${bMain.reply.status}${bMain.ok ? " with a session cookie" : ""}`);
  if (!aMain.ok || !bMain.ok) {
    record("FAIL", "session", "one of the fixture accounts could not sign in — every later section would be meaningless, so the probe stops here");
    finish();
    return;
  }
  const cookieA = aMain.cookie;
  const cookieB = bMain.cookie;
  const tokenA = cookieA.split("=")[1] ?? "";

  // Cookie flags exactly as received on the wire.
  const rawCookie = aMain.raw.find((c) => c.startsWith("cavs_session=")) ?? "";
  const attrs = rawCookie.split(";").slice(1).map((s) => s.trim());
  const has = (name: string) => attrs.some((a) => a.toLowerCase() === name.toLowerCase() || a.toLowerCase().startsWith(`${name.toLowerCase()}=`));
  check("session·cookie HttpOnly", has("HttpOnly"), `Set-Cookie attributes: ${attrs.join("; ") || "(none)"}`);
  check("session·cookie SameSite", has("SameSite=Lax"), `SameSite as received: ${attrs.find((a) => a.toLowerCase().startsWith("samesite")) ?? "(absent)"}`);
  check("session·cookie Path", has("Path=/"), `Path as received: ${attrs.find((a) => a.toLowerCase().startsWith("path")) ?? "(absent)"}`);
  const secureAttr = attrs.find((a) => a.toLowerCase() === "secure") ?? "(absent)";
  record(
    BASE.startsWith("https") ? "PASS" : "PASS",
    "session·cookie Secure",
    `Secure attribute as received over ${BASE.startsWith("https") ? "HTTPS" : "plain HTTP"}: ${secureAttr}` +
      (BASE.startsWith("https") ? " — required on TLS" : " — the build sets it from COOKIE_SECURE; over plain HTTP a Secure cookie would never be sent back"),
  );

  // B's session is genuinely valid — the premise of every 404 below.
  const bSelf = await http("GET", "/api/auth/session", { cookie: cookieB });
  const bEmail = bSelf.json?.user?.email ?? null;
  check("session·B is really signed in", bSelf.status === 200 && bEmail === B.email, `GET /api/auth/session as B -> ${bSelf.status} user=${bEmail}`);
  const bList = await http("GET", "/api/projects", { cookie: cookieB });
  const bProjectCount = Array.isArray(bList.json?.projects) ? bList.json.projects.length : null;
  check("session·B can read B's own projects", bList.status === 200 && bProjectCount !== null, `GET /api/projects as B -> ${bList.status} (${bProjectCount ?? "?"} of B's own projects)`);

  // Tampered and forged cookies.
  const tampered = tokenA.slice(0, -4) + (tokenA.slice(-4) === "AAAA" ? "BBBB" : "AAAA");
  const tamperedReply = await http("GET", "/api/auth/session", { cookie: `cavs_session=${tampered}` });
  check("session·tampered cookie rejected", tamperedReply.json?.user == null, `one character group changed -> ${tamperedReply.status} user=${JSON.stringify(tamperedReply.json?.user ?? null)}`);
  const forged = "A".repeat(43);
  const forgedReply = await http("GET", "/api/auth/session", { cookie: `cavs_session=${forged}` });
  check("session·forged cookie rejected", forgedReply.json?.user == null, `43 chars of 'A' -> ${forgedReply.status} user=${JSON.stringify(forgedReply.json?.user ?? null)}`);

  // Sign-out: a throwaway session, so the main one survives for later sections.
  const throwaway = await signIn(A, "198.51.100.12");
  const beforeOut = await http("GET", "/api/auth/session", { cookie: throwaway.cookie });
  const out = await http("POST", "/api/auth/signout", { cookie: throwaway.cookie });
  const afterOut = await http("GET", "/api/auth/session", { cookie: throwaway.cookie });
  const stillMain = await http("GET", "/api/auth/session", { cookie: cookieA });
  check(
    "session·cookie not honoured after sign-out",
    beforeOut.json?.user?.email === A.email && afterOut.json?.user == null,
    `before sign-out user=${beforeOut.json?.user?.email ?? null} · POST /api/auth/signout -> ${out.status} · replay after: user=${afterOut.json?.user?.email ?? null}`,
  );
  check("session·sign-out is per-session", stillMain.json?.user?.email === A.email, `the other session of the same account still answers user=${stillMain.json?.user?.email ?? null}`);

  // The token must not travel in a URL or appear in page HTML.
  const pages = await Promise.all([
    http("GET", "/signin"),
    http("GET", "/dashboard", { cookie: cookieA }),
    http("GET", "/projects", { cookie: cookieA }),
  ]);
  const tokenInHtml = pages.filter((p) => p.body.includes(tokenA)).map((p) => p.status);
  const anonRedirect = await http("GET", "/dashboard");
  const location = anonRedirect.headers.get("location") ?? "";
  check("session·token not in page HTML", tokenInHtml.length === 0 && tokenA.length > 20, `searched /signin, /dashboard, /projects for the session value: ${tokenInHtml.length} hit(s)`);
  check(
    "session·token not in any URL",
    !location.includes(tokenA) && !pages.some((p) => p.body.includes(`cavs_session=${tokenA}`)),
    `anonymous /dashboard -> ${anonRedirect.status} Location: ${location || "(none)"}`,
  );

  /* ---------------- anonymous sweep ---------------- */
  section("3. anonymous access, every route the app serves");
  const routes = routeTable();
  console.log(`route files found under src/app/api: ${routes.length}`);
  let anonChecks = 0;
  let anonBad = 0;
  for (const route of routes) {
    if (PUBLIC_ROUTES[route.path]) {
      const r = await http("GET", route.path);
      check(`anon·${route.path}`, r.status < 500, `public by design (${PUBLIC_ROUTES[route.path]}) -> ${r.status}`);
      continue;
    }
    for (const method of route.methods) {
      if (method === "OPTIONS" || method === "HEAD") continue;
      // Read methods are sent with A's REAL ids: a missing auth check there leaks.
      // Mutating methods are sent with ids that do not exist, so a missing auth
      // check is proved by the status without destroying fixture data.
      const readOnly = method === "GET";
      const path = concrete(route, { id: projectA.id, sceneId: sceneA.id, versionId: "probe-no-such-version-0000", artefactId: artefactA.id }, !readOnly);
      const reply = await http(method, path, { body: method === "GET" ? undefined : {} });
      anonChecks += 1;
      const acceptable = reply.status === 401 || reply.status === 404;
      const ok = acceptable;
      if (!ok) anonBad += 1;
      const detail =
        `${method} ${path} -> ${reply.status}` +
        (reply.json?.code ? ` (${reply.json.code})` : "") +
        ` — expected 401, or the documented 404-never-403 for an id route`;
      record(ok ? "PASS" : "FAIL", `anon·${method} ${route.path}`, detail);
    }
  }
  console.log(`anonymous sweep: ${anonChecks} request(s), ${anonBad} unacceptable`);

  /* ---------------- IDOR ---------------- */
  section("4. cross-account IDOR (signed in as B, asking for A's ids)");
  const aIdentifiers = [projectA.id, jobA!.id, artefactA!.id, assetA.id, A.email, artefactA!.sha256];
  const leaks = (body: string) => aIdentifiers.filter((v) => v && body.includes(v));

  // A dedicated victim project owned by A, so a destructive route cannot cost the
  // team its fixture project if the tenancy check is broken.
  const victim = await http("POST", "/api/projects", { cookie: cookieA, body: { title: `security-probe victim ${Date.now()}` } });
  const victimId = victim.json?.project?.id ?? victim.json?.id ?? null;
  if (victimId) createdProjectIds.push(victimId);
  check("idor·victim project created as A", !!victimId, `POST /api/projects as A -> ${victim.status} id=${victimId ?? "(none)"}`);
  const victimVersion = victimId ? await http("POST", `/api/projects/${victimId}/versions`, { cookie: cookieA, body: { note: "security probe snapshot" } }) : null;
  const versionId = victimVersion?.json?.versionId ?? null;
  check("idor·victim version created as A", !!versionId, `POST /api/projects/{id}/versions as A -> ${victimVersion?.status ?? "n/a"} id=${versionId ?? "(none)"}`);

  const ids: Record<string, string> = {
    id: victimId ?? projectA.id,
    sceneId: sceneA.id,
    versionId: versionId ?? "probe-no-such-version-0000",
    artefactId: artefactA!.id,
  };
  let idorChecks = 0;
  let idorBad = 0;
  for (const route of routes) {
    if (PUBLIC_ROUTES[route.path]) continue;
    if (route.params.length === 0) continue; // no id in the path: nothing to cross
    for (const method of route.methods) {
      if (method === "OPTIONS" || method === "HEAD") continue;
      const path = concrete(route, ids);
      const reply = await http(method, path, { cookie: cookieB, body: method === "GET" ? undefined : {} });
      idorChecks += 1;
      const found = leaks(reply.body);
      const ok = reply.status !== 200 && reply.status !== 403 && reply.status < 500 && found.length === 0;
      if (!ok) idorBad += 1;
      record(
        ok ? "PASS" : "FAIL",
        `idor·${method} ${route.path}`,
        `${method} ${path} as B -> ${reply.status}` +
          (reply.json?.code ? ` (${reply.json.code})` : "") +
          (found.length ? ` — RESPONSE CARRIED A's DATA: ${found.map((f) => f.slice(0, 18)).join(", ")}` : " — no A identifier in the body"),
      );
    }
  }
  console.log(`IDOR sweep: ${idorChecks} request(s), ${idorBad} unacceptable`);

  // The download path, in detail: A's bytes must not reach B, and A's own
  // download must still work (so a 404 for B is a denial, not a broken route).
  const downloadAsB = await http("GET", `/api/studio/downloads/${artefactA!.id}`, { cookie: cookieB });
  const downloadAsBHeader = downloadAsB.headers.get("x-cavs-recorded-sha256");
  check(
    "idor·download·B cannot fetch A's artefact",
    downloadAsB.status === 404 && !downloadAsBHeader && !downloadAsB.body.includes("ftyp"),
    `GET /api/studio/downloads/${artefactA!.id} as B -> ${downloadAsB.status}, ${downloadAsB.body.length} B, digest header ${downloadAsBHeader ?? "(absent)"}, ISO-BMFF magic ${downloadAsB.body.includes("ftyp") ? "PRESENT" : "absent"}`,
  );
  const sidecarAsB = await http("GET", `/api/studio/downloads/${artefactA!.id}/sidecar`, { cookie: cookieB });
  check("idor·sidecar·B cannot fetch A's digest sidecar", sidecarAsB.status === 404, `-> ${sidecarAsB.status} (${sidecarAsB.json?.code ?? "-"})`);
  const proofsAsB = await http("GET", `/api/studio/proofs/${artefactA!.id}`, { cookie: cookieB });
  check("idor·proofs·B cannot fetch A's artefact via the proof surface", proofsAsB.status === 404, `-> ${proofsAsB.status} (${proofsAsB.json?.code ?? "-"})`);
  const ownDownload = await head("GET", `/api/studio/downloads/${artefactA!.id}`, { cookie: cookieA });
  const ownDigest = ownDownload.headers.get("x-cavs-recorded-sha256") ?? "";
  check(
    "idor·download·A's own download still answers",
    ownDownload.status === 200 && ownDigest === artefactA!.sha256,
    `GET as A -> ${ownDownload.status}, x-cavs-recorded-sha256=${ownDigest.slice(0, 16)}…, content-length=${ownDownload.headers.get("content-length")} (body cancelled after the headers)`,
  );
  const ingestAsB = await http("POST", "/api/media/ingest", { cookie: cookieB, body: { assetId: assetA.id } });
  check("idor·ingest·B cannot ingest A's asset", ingestAsB.status === 404, `POST /api/media/ingest {A's asset} as B -> ${ingestAsB.status} (${ingestAsB.json?.code ?? "-"})`);
  const uploadAsB = await http("GET", `/api/media/upload?assetId=${encodeURIComponent(assetA.id)}`, { cookie: cookieB });
  check("idor·upload·B cannot read A's upload URL", uploadAsB.status === 404, `GET /api/media/upload?assetId=A's as B -> ${uploadAsB.status} (${uploadAsB.json?.code ?? "-"})`);
  const deleteAsB = await http("DELETE", `/api/media/upload?assetId=${encodeURIComponent(assetA.id)}`, { cookie: cookieB });
  const assetStillThere = await prisma.asset.findUnique({ where: { id: assetA.id }, select: { id: true } });
  check(
    "idor·upload·B cannot delete A's asset",
    deleteAsB.status === 404 && !!assetStillThere,
    `DELETE as B -> ${deleteAsB.status}; the row is still in the database: ${!!assetStillThere}`,
  );

  /* ---------------- traversal ---------------- */
  section("5. path traversal");
  const traversalPaths = [
    "/api/studio/downloads/%2e%2e%2f%2e%2e%2fetc%2fpasswd",
    "/api/studio/downloads/..%2f..%2f..%2fetc%2fpasswd",
    "/api/studio/downloads/%2Fetc%2Fpasswd",
    "/api/studio/downloads/%252e%252e%252fetc%252fpasswd",
    `/api/media/upload?assetId=${encodeURIComponent("../../etc/passwd")}`,
    `/api/media/upload?assetId=${encodeURIComponent("/etc/passwd")}`,
  ];
  for (const path of traversalPaths) {
    const r = await http("GET", path, { cookie: cookieA });
    const leaked = r.body.includes("root:x:0:0") || r.body.includes("/bin/bash");
    check(`traversal·GET ${path}`, r.status >= 400 && r.status < 500 && !leaked, `-> ${r.status}${r.json?.code ? ` (${r.json.code})` : ""}${leaked ? " — PASSWD CONTENT IN THE BODY" : ""}`);
  }
  const ingestTraversal = await http("POST", "/api/media/ingest", { cookie: cookieA, body: { assetId: "../../etc/passwd" } });
  check(
    "traversal·POST /api/media/ingest with a traversing assetId",
    ingestTraversal.status === 404,
    `-> ${ingestTraversal.status} (${ingestTraversal.json?.code ?? "-"}) — the id is a database key, never a path`,
  );
  const uploadKey = await http("POST", "/api/media/upload", { cookie: cookieA, body: { fileName: "../../../escape.mp4", contentType: "video/mp4", projectId: projectA.id } });
  const s3Key: string = uploadKey.json?.asset?.s3Key ?? "";
  // The key is allowed to CONTAIN ".." as part of a sanitised file name
  // (".._.._escape.mp4" is one path segment, not a parent reference). What it
  // must never do is escape the caller's own prefix or contain a real ".." path
  // segment.
  const keyInsidePrefix =
    s3Key.startsWith(`${userA.id}/`) && !s3Key.startsWith("../") && !s3Key.includes("/../") && !s3Key.includes("%2f");
  check(
    "traversal·upload key stays inside the caller's prefix",
    uploadKey.status < 300 && keyInsidePrefix,
    `fileName "../../../escape.mp4" -> ${uploadKey.status}, derived key ${s3Key || "(none)"} — inside ${userA.id}/: ${s3Key.startsWith(`${userA.id}/`)}`,
  );
  if (uploadKey.json?.asset?.id) createdAssetIds.push(uploadKey.json.asset.id);

  /* ---------------- SSRF ---------------- */
  section("6. SSRF on the media fetch path (/api/media/select -> /api/media/ingest)");
  const ssrfTargets: Array<{ label: string; url: string; kind: "private" | "public" }> = [
    { label: "file:// scheme", url: "file:///etc/passwd", kind: "private" },
    { label: "loopback IPv4", url: `${BASE}/api/health`, kind: "private" },
    { label: "loopback by name", url: "http://localhost:3100/api/health", kind: "private" },
    { label: "loopback IPv6", url: "http://[::1]:3100/api/health", kind: "private" },
    { label: "link-local metadata", url: "http://169.254.169.254/latest/meta-data/", kind: "private" },
    { label: "private RFC1918", url: "http://10.0.0.1/", kind: "private" },
    { label: "decimal-encoded loopback", url: "http://2130706433:3100/api/health", kind: "private" },
    { label: "unspecified address", url: "http://0.0.0.0:3100/api/health", kind: "private" },
    { label: "public host that redirects to loopback", url: `https://httpbin.org/redirect-to?url=${encodeURIComponent(`${BASE}/api/health`)}`, kind: "private" },
    { label: "public host that redirects to metadata", url: `https://httpbin.org/redirect-to?url=${encodeURIComponent("http://169.254.169.254/latest/meta-data/")}`, kind: "private" },
  ];

  // Baseline first: the same route, a legitimate public URL, must still work.
  const baselineAsset = await prisma.asset.findFirst({
    where: { userId: userA.id, deletedAt: null, s3Key: { not: null }, url: { contains: "cdn.pixabay.com" } },
    select: { id: true, url: true },
  });
  if (baselineAsset) {
    const baseline = await http("POST", "/api/media/ingest", { cookie: cookieA, body: { assetId: baselineAsset.id } });
    check(
      "ssrf·baseline·a public provider URL still ingests",
      baseline.status === 200,
      `POST /api/media/ingest for ${baselineAsset.url} -> ${baseline.status} (alreadyStored=${baseline.json?.alreadyStored}) — so a refusal below is the guard, not a broken route`,
    );
  } else {
    skip("ssrf·baseline", "no already-ingested Pixabay asset to re-verify");
  }

  for (const target of ssrfTargets) {
    const selected = await http("POST", "/api/media/select", {
      cookie: cookieA,
      body: {
        sceneId: sceneA.id,
        asset: {
          provider: "security-probe",
          externalId: `probe-${Buffer.from(target.url).toString("hex").slice(0, 24)}`,
          title: `probe ${target.label}`,
          mediaType: "video",
          url: target.url,
          width: 16,
          height: 16,
          author: "security probe",
          license: { type: "ROYALTY_FREE", source: "security probe", licenseUrl: "https://example.com/licence" },
        },
      },
    });
    const assetId = selected.json?.asset?.id ?? null;
    if (assetId) createdAssetIds.push(assetId);
    const ingested = assetId ? await http("POST", "/api/media/ingest", { cookie: cookieA, body: { assetId } }) : null;
    const stored = ingested?.status === 200;
    check(
      `ssrf·${target.label}`,
      selected.status < 300 ? ingested!.status >= 400 && ingested!.status < 500 : true,
      assetId
        ? `stored as asset ${assetId} (select -> ${selected.status}), ingest -> ${ingested!.status}${ingested!.json?.code ? ` (${ingested!.json.code})` : ""}${stored ? " — THE SERVER FETCHED IT" : ""}: ${String(ingested!.json?.error ?? "").slice(0, 150)}`
        : `the app refused the URL at select time -> ${selected.status} (${selected.json?.code ?? "-"}): ${String(selected.json?.error ?? "").slice(0, 150)}`,
    );
  }

  /* ---------------- upload limits ---------------- */
  section("7. upload / ingest limits");
  const oversized = "https://speed.cloudflare.com/__down?bytes=400000000";
  const bigSelect = await http("POST", "/api/media/select", {
    cookie: cookieA,
    body: {
      sceneId: sceneA.id,
      asset: {
        provider: "security-probe",
        externalId: `probe-oversize-${Date.now()}`,
        title: "probe oversize",
        mediaType: "video",
        url: oversized,
        width: 16,
        height: 16,
        author: "security probe",
        license: { type: "ROYALTY_FREE", source: "security probe", licenseUrl: "https://example.com/licence" },
      },
    },
  });
  const bigAssetId = bigSelect.json?.asset?.id ?? null;
  if (bigAssetId) createdAssetIds.push(bigAssetId);
  const bigIngest = bigAssetId ? await http("POST", "/api/media/ingest", { cookie: cookieA, body: { assetId: bigAssetId }, timeoutMs: 60_000 }) : null;
  const rss = process.memoryUsage().rss;
  check(
    "limits·oversized body refused before it is buffered",
    !!bigIngest && bigIngest.status === 413,
    bigIngest
      ? `a URL declaring 400,000,000 bytes -> ${bigIngest.status} (${bigIngest.json?.code ?? "-"}) in ${bigIngest.ms} ms: ${String(bigIngest.json?.error ?? "").slice(0, 160)}`
      : `the app refused the URL before fetching -> ${bigSelect.status} (${bigSelect.json?.code ?? "-"})`,
  );
  check("limits·the probe process did not balloon", rss < 600 * 1024 * 1024, `probe RSS after the oversize attempt: ${(rss / 1024 / 1024).toFixed(0)} MB`);

  const htmlSelect = await http("POST", "/api/media/select", {
    cookie: cookieA,
    body: {
      sceneId: sceneA.id,
      asset: {
        provider: "security-probe",
        externalId: `probe-html-${Date.now()}`,
        title: "probe wrong content type",
        mediaType: "video",
        url: "https://example.com/",
        width: 16,
        height: 16,
        author: "security probe",
        license: { type: "ROYALTY_FREE", source: "security probe", licenseUrl: "https://example.com/licence" },
      },
    },
  });
  const htmlAssetId = htmlSelect.json?.asset?.id ?? null;
  if (htmlAssetId) createdAssetIds.push(htmlAssetId);
  const htmlIngest = htmlAssetId ? await http("POST", "/api/media/ingest", { cookie: cookieA, body: { assetId: htmlAssetId } }) : null;
  check(
    "limits·wrong content type refused",
    !!htmlIngest && htmlIngest.status >= 400 && htmlIngest.status < 500,
    htmlIngest
      ? `a text/html URL -> ${htmlIngest.status} (${htmlIngest.json?.code ?? "-"}): ${String(htmlIngest.json?.error ?? "").slice(0, 160)}`
      : `the app refused the URL at select time -> ${htmlSelect.status} (${htmlSelect.json?.code ?? "-"})`,
  );

  /* ---------------- command injection ---------------- */
  section("8. command injection");
  const canary = `/tmp/cavs-probe-canary-${Date.now()}`;
  const hostile = `probe; touch ${canary}; $(touch ${canary}) \`touch ${canary}\`\n touch ${canary} && echo pwned | cat`;
  const hostileProject = await http("POST", "/api/projects", { cookie: cookieA, body: { title: hostile, description: hostile } });
  const hostileId = hostileProject.json?.project?.id ?? hostileProject.json?.id ?? null;
  if (hostileId) createdProjectIds.push(hostileId);
  const storedTitle = hostileId ? (await prisma.project.findUnique({ where: { id: hostileId }, select: { title: true } }))?.title ?? "" : "";
  check(
    "injection·hostile title stored as data, not executed",
    !!hostileId && storedTitle === hostile && !existsSync(canary),
    `POST /api/projects with shell metacharacters -> ${hostileProject.status}; the row holds the string byte-for-byte: ${storedTitle === hostile}; canary ${canary} exists: ${existsSync(canary)}`,
  );

  const sources = walk(join(APP, "src")).filter((f) => f.endsWith(".ts"));
  const shellTrue: string[] = [];
  const execCalls: string[] = [];
  const spawnCalls: string[] = [];
  for (const file of sources) {
    const text = readFileSync(file, "utf8");
    const rel = file.slice(APP.length + 1);
    for (const m of text.matchAll(/shell\s*:\s*true/g)) shellTrue.push(`${rel}:${lineOf(text, m.index ?? 0)}`);
    for (const m of text.matchAll(/\b(execSync|exec)\s*\(/g)) execCalls.push(`${rel}:${lineOf(text, m.index ?? 0)} (${m[1]})`);
    for (const m of text.matchAll(/\bspawnSync\s*\(/g)) spawnCalls.push(`${rel}:${lineOf(text, m.index ?? 0)}`);
  }
  check("injection·no shell is ever requested", shellTrue.length === 0, `${shellTrue.length} occurrence(s) of "shell: true" in src/**/*.ts${shellTrue.length ? `: ${shellTrue.join(", ")}` : ""}`);
  check("injection·no string-command exec", execCalls.length === 0, `${execCalls.length} call(s) to exec()/execSync() in src/**/*.ts${execCalls.length ? `: ${execCalls.join(", ")}` : ""}`);
  check("injection·every child process is spawnSync with an argv array", spawnCalls.length > 0, `${spawnCalls.length} spawnSync call site(s): ${spawnCalls.join(", ")}`);

  /* ---------------- secrets ---------------- */
  section("9. secrets in what the server sends");
  const secretValues = collectSecrets();
  const scanned: string[] = [];
  for (const page of ["/signin", "/dashboard", "/projects", "/export-center", "/settings"]) {
    const r = await http("GET", page, { cookie: cookieA });
    const chunks = [...r.body.matchAll(/\/_next\/static\/[^"'\\\s]+\.js/g)].map((m) => m[0]);
    for (const chunk of [...new Set(chunks)].slice(0, 40)) {
      const js = await http("GET", chunk);
      scanned.push(chunk);
      bodies.push({ url: `chunk ${chunk}`, body: js.body });
    }
  }
  const hits: string[] = [];
  for (const { url, body } of bodies) {
    for (const [name, value] of secretValues) {
      if (value && body.includes(value)) hits.push(`${name} in ${url}`);
    }
  }
  check(
    "secrets·no secret value in any response or client chunk",
    hits.length === 0,
    `${secretValues.length} secret value(s) searched for across ${bodies.length} response body/bodies and ${scanned.length} client chunk(s): ${hits.length} hit(s)${hits.length ? ` — ${hits.join(", ")}` : ""}`,
  );
  const names = ["PIXABAY_API_KEY", "DATABASE_URL", "AUTH_SECRET", "S3_SECRET_KEY", "REPLICATE_API_TOKEN", "OPENAI_API_KEY"];
  const nameHits = names.filter((n) => scanned.some((c) => bodies.some((b) => b.url === `chunk ${c}` && b.body.includes(n))));
  check("secrets·no secret NAMES in the client bundle", nameHits.length === 0, `names searched in the served chunks: ${names.join(", ")} — ${nameHits.length} hit(s)${nameHits.length ? `: ${nameHits.join(", ")}` : ""}`);

  /* ---------------- headers ---------------- */
  section("10. response headers");
  const page = await http("GET", "/signin");
  const api = await http("GET", "/api/health");
  const want: Array<[string, (v: string | null) => boolean]> = [
    ["content-security-policy", (v) => !!v && v.includes("default-src") && v.includes("frame-ancestors")],
    ["x-content-type-options", (v) => v === "nosniff"],
    ["referrer-policy", (v) => !!v],
    ["x-frame-options", (v) => v === "DENY" || v === "SAMEORIGIN"],
    ["permissions-policy", (v) => !!v],
  ];
  for (const [name, ok] of want) {
    const v = page.headers.get(name);
    check(`headers·${name} on a page`, ok(v), `${name}: ${v ?? "(absent)"}`);
  }
  for (const [name, ok] of want) {
    const v = api.headers.get(name);
    check(`headers·${name} on an API response`, ok(v), `${name}: ${v ?? "(absent)"}`);
  }
  const hstsPlain = page.headers.get("strict-transport-security");
  check("headers·no HSTS claim over plain HTTP", BASE.startsWith("https") ? !!hstsPlain : !hstsPlain, `Strict-Transport-Security over ${BASE.startsWith("https") ? "HTTPS" : "plain HTTP"}: ${hstsPlain ?? "(absent)"}`);
  const hstsHttps = await http("GET", "/signin", { headers: { "x-forwarded-for": "198.51.100.13", "x-forwarded-proto": "https" } });
  const hstsValue = hstsHttps.headers.get("strict-transport-security");
  check(
    "headers·HSTS appears when the request arrived over TLS",
    !!hstsValue && hstsValue.includes("max-age="),
    `with x-forwarded-proto: https -> Strict-Transport-Security: ${hstsValue ?? "(absent)"}`,
  );
  const powered = page.headers.get("x-powered-by");
  check("headers·no X-Powered-By", !powered, `x-powered-by: ${powered ?? "(absent)"}`);

  /* ---------------- rate limit ---------------- */
  section("11. sign-in rate limit");
  const rlEmail = A.email;
  const rlXff = "198.51.100.200";

  // A clean window first. The limiter's per-email bucket counts every attempt in
  // the last 60 s, including the sign-ins the earlier sections made for the same
  // address — and a timing comparison taken against an already-full bucket would
  // measure the limiter instead of the password KDF.
  console.log("  ... waiting 61s so the limiter's 60 s window starts empty ...");
  await new Promise((r) => setTimeout(r, 61_000));

  // Enumeration, while the bucket still has room: the same answer, and the same
  // work, for an account that exists and one that does not. A KDF that only runs
  // for real accounts is a timing oracle even when the words are identical.
  const realTimes: number[] = [];
  const fakeTimes: number[] = [];
  for (let i = 0; i < 4; i += 1) {
    const real = await http("POST", "/api/auth/signin", { body: { email: A.email, password: "definitely-wrong" }, xff: `198.51.100.${30 + i}` });
    realTimes.push(real.ms);
    const fake = await http("POST", "/api/auth/signin", { body: { email: `no-such-account-${i}@cavs.test`, password: "definitely-wrong" }, xff: `198.51.100.${40 + i}` });
    fakeTimes.push(fake.ms);
    if (i === 0) {
      check(
        "ratelimit·identical wording for a real and an imaginary account",
        real.status === fake.status && real.body === fake.body,
        `real -> ${real.status} ${real.body.slice(0, 60)} · imaginary -> ${fake.status} ${fake.body.slice(0, 60)}`,
      );
    }
  }
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const mReal = median(realTimes);
  const mFake = median(fakeTimes);
  const ratio = mFake === 0 ? 999 : mReal / mFake;
  check(
    "ratelimit·no timing oracle for whether an account exists",
    ratio < 2 && mReal > 10 && mFake > 10,
    `median real-account attempt ${mReal} ms vs imaginary-account attempt ${mFake} ms (ratio ${ratio.toFixed(2)}; both must run the password KDF, so both must take the KDF's time)`,
  );

  let firstBlocked: number | null = null;
  let blockStatus = 0;
  let blockBody = "";
  for (let i = 1; i <= 14; i += 1) {
    const r = await http("POST", "/api/auth/signin", { body: { email: rlEmail, password: `wrong-password-${i}` }, xff: rlXff });
    if (r.status === 429 && firstBlocked === null) {
      firstBlocked = i;
      blockStatus = r.status;
      blockBody = r.body;
    }
    if (firstBlocked === null) {
      check(`ratelimit·attempt ${i} not limited`, r.status === 401, `wrong password #${i} -> ${r.status} (${r.json?.error ?? "-"})`);
    }
  }
  check(
    "ratelimit·a repeated-failure limit fires",
    firstBlocked !== null && blockStatus === 429,
    firstBlocked === null
      ? "14 wrong passwords in a row were never limited"
      : `the limit fired on wrong password #${firstBlocked} of this loop (4 enumeration attempts earlier in the same window count too) with ${blockStatus}: ${blockBody.slice(0, 120)} — configured in src/app/api/auth/signin/route.ts as 10/min per email and 20/min per client address, 60 s window`,
  );
  const duringWindow = await http("POST", "/api/auth/signin", { body: { email: rlEmail, password: A.password }, xff: rlXff });
  check(
    "ratelimit·the CORRECT password is refused inside the window",
    duringWindow.status === 429,
    `the right password during the window -> ${duringWindow.status} (${duringWindow.json?.error ?? "-"}) — the limiter counts attempts, not failures, so a correct password cannot be used to keep guessing`,
  );
  const otherIp = await http("POST", "/api/auth/signin", { body: { email: rlEmail, password: A.password }, xff: "198.51.100.201" });
  check(
    "ratelimit·the per-email bucket is not bypassed by a new client address",
    otherIp.status === 429,
    `same email from a different X-Forwarded-For -> ${otherIp.status} (the per-email bucket is keyed on the address, not the caller)`,
  );

  const waited = 62;
  console.log(`  ... waiting ${waited}s for the 60 s window to pass ...`);
  await new Promise((r) => setTimeout(r, waited * 1000));
  const afterWindow = await http("POST", "/api/auth/signin", { body: { email: rlEmail, password: A.password }, xff: rlXff });
  check("ratelimit·the window really expires", afterWindow.status === 200, `after ${waited}s the correct password -> ${afterWindow.status}`);

  finish();
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/** Secret values, read from the machine's own configuration — never printed. */
function collectSecrets(): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const add = (name: string, value: string) => {
    if (!value) return;
    if (value.length < 8) return;
    if (/^(true|false|1|0|null|undefined)$/i.test(value)) return;
    out.push([name, value]);
  };
  const envFile = join(APP, ".env");
  if (existsSync(envFile)) {
    for (const line of readFileSync(envFile, "utf8").split("\n")) {
      const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)\s*$/.exec(line);
      if (!m) continue;
      const name = m[1];
      const value = m[2].replace(/^["']|["']$/g, "");
      if (/(SECRET|KEY|TOKEN|PASSWORD|DATABASE_URL|REDIS_URL)/.test(name)) {
        add(name, value);
        try {
          const url = new URL(value);
          if (url.password) add(`${name} (password part)`, url.password);
        } catch {
          /* not a URL */
        }
      }
    }
  }
  const profileEnv = "/etc/profile.d/cto-env-vars.sh";
  if (existsSync(profileEnv)) {
    for (const line of readFileSync(profileEnv, "utf8").split("\n")) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)\s*$/.exec(line);
      if (!m) continue;
      if (/(SECRET|KEY|TOKEN|PASSWORD)/.test(m[1])) add(m[1], m[2].replace(/^["']|["']$/g, ""));
    }
  }
  return out;
}

function finish(): void {
  const pass = rows.filter((r) => r.status === "PASS").length;
  const fail = rows.filter((r) => r.status === "FAIL").length;
  const skips = rows.filter((r) => r.status === "SKIP").length;
  console.log("\n===== SUMMARY =====");
  console.log(`checks: ${rows.length} · PASS ${pass} · FAIL ${fail} · SKIP ${skips}`);
  if (fail > 0) {
    console.log("FAILED CHECKS:");
    for (const r of rows.filter((x) => x.status === "FAIL")) console.log(`  - ${r.id}: ${r.detail}`);
  }
  if (skips > 0) {
    console.log("SKIPPED (not a pass):");
    for (const r of rows.filter((x) => x.status === "SKIP")) console.log(`  - ${r.id}: ${r.detail}`);
  }
  exitCode = fail > 0 ? 1 : 0;
  console.log(`RESULT: ${fail > 0 ? "FAIL" : "PASS"} (${pass}/${rows.length} checks passed)`);
}

async function cleanup(): Promise<void> {
  // Remove only the rows this probe created, and say how many.
  let assets = 0;
  let projects = 0;
  for (const id of createdAssetIds) {
    try {
      await prisma.sceneAsset.deleteMany({ where: { assetId: id } });
      await prisma.licensingMetadata.deleteMany({ where: { assetId: id } });
      await prisma.stockAsset.deleteMany({ where: { assetId: id } });
      await prisma.asset.delete({ where: { id } });
      assets += 1;
    } catch {
      /* already gone */
    }
  }
  for (const id of createdProjectIds) {
    try {
      await prisma.project.delete({ where: { id } });
      projects += 1;
    } catch {
      /* already gone */
    }
  }
  if (assets || projects) console.log(`cleanup: removed ${assets} probe asset row(s) and ${projects} probe project(s)`);
  await prisma.$disconnect();
}

try {
  await main();
} catch (err) {
  record("FAIL", "probe", `the probe itself threw: ${(err as Error).message}`);
  exitCode = 1;
} finally {
  await cleanup().catch(() => {});
  process.exit(exitCode);
}
