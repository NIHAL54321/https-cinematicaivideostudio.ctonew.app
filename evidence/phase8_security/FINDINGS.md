# Security findings — Phase 8 security block (2026-11-08)

Every line here was produced by `scripts/security/probe.ts` running against the served build on
`http://127.0.0.1:3100`, or by a command named in the "how it was proved" column. Nothing in this
table is inferred from reading code alone. Where a check could not be run it says SKIP, and SKIP is
not a pass.

**The run this table describes:** `probe.log` in this directory — **187 checks · 185 PASS · 2 FAIL ·
0 SKIP**, `probe_rc=1`, against BUILD_ID `HaJ3HYlDo1amWbZhq-wd3`. The two failures are **both**
recorded below as their own rows (#10 and #11) and **neither is an unpatched hole** — one is a
120-character title cap the probe asserted wrongly, the other is a credential value that this
deployment sets to the same string twice. `probe_prefix_baseline.log` is the **pre-fix** run from
`6be0cc4`, kept for comparison; it is not evidence of the shipped state.

Severity is the team's own judgement on this deployment only: **High** = a caller can read or do
something that is not theirs; **Medium** = weakens a control that exists for a reason; **Low** =
information or hardening with no direct access path.

## Findings

| # | Finding | How it was proved | Severity | Status |
|---|---------|-------------------|----------|--------|
| 1 | **SSRF on the media ingest path.** `/api/media/select` stored whatever `asset.url` the caller sent (validated only as a non-empty string) and `/api/media/ingest` fetched it server-side with `fetch(url, { redirect: "follow" })` — no scheme check, no address check, no redirect check, no timeout. | Pre-fix run (`probe_prefix_baseline.log`, section 6): as the fixture account the app **fetched `http://127.0.0.1:3100/api/health`, `http://localhost:3100/…` and `http://[::1]:3100/…` and returned 200**, storing this server's own response as "footage" with bytes and SHA-256. `file:///etc/passwd` produced an unhandled 500; `169.254.169.254` and `10.0.0.1` hung until the client gave up. | **High** | **FIXED** — `src/lib/media/fetch-guard.ts` (scheme allow-list, address-class allow-list, per-hop re-check on manual redirects, bounded hops, 20 s deadline) wired into `src/lib/media/footage.ts`. Post-fix `probe.log` section 6: all 10 targets refused with **400** and a typed code (`unsafe_scheme` / `private_address`), including **a public host that redirects to loopback** and **a public host that redirects to the metadata address**; a legitimate `cdn.pixabay.com` URL still ingests 200. |
| 2 | **No response security headers at all** — no CSP, `X-Content-Type-Options`, `Referrer-Policy`, frame policy or `Permissions-Policy`. | Pre-fix run section 10 recorded each as `(absent)` on a page **and** on an API response. | **Medium** | **FIXED** — static headers for `/:path*` in `next.config.mjs`; HSTS added by `src/middleware.ts` only when the request carries `x-forwarded-proto: https` (see "HSTS" below). Post-fix run section 10: present on both, `X-Powered-By` absent, HSTS absent over plain HTTP and **present** when the header says `https`. Independently re-checked by the lead with `curl -sI` against `/signin` and `/api/auth/session`. |
| 3 | **User-enumeration timing oracle on sign-in.** The wording was already identical, but the password KDF (scrypt) only ran when the account existed, so a real address took the KDF's time and an imaginary one returned in single-digit milliseconds. | Pre-fix run section 11: median real-account attempt **4 ms** vs imaginary-account **4 ms** — both far below the ~48 ms scrypt cost measured in-process, i.e. neither arm was doing the work the fix requires. | **Medium** | **FIXED** — `src/app/api/auth/signin/route.ts` runs the KDF against a decoy hash when no user row exists. Post-fix run: medians **42 ms vs 42 ms**, ratio 1.00, against a threshold of **≥ 24 ms** (half the measured scrypt cost) and `max/min ≤ 2`. The check also asserts both arms answered `401,401,401,401,401` so neither median can be a limiter answer. |
| 4 | **The ingest path accepted any content type.** A URL answering `text/html` was stored as footage and described as an asset. | Pre-fix run section 7: a `https://example.com/` URL was selected and ingested. | **Low** | **FIXED** — `footage.ts` refuses a response that is not `video/*` or `image/*` (**415 `wrong_content_type`**), from the headers and before the body is buffered. Post-fix run section 7 confirms the 415 and that nothing was downloaded. |
| 5 | **`X-Forwarded-For` is trusted for the per-address rate-limit bucket.** Anyone who can reach the server directly can rotate the header and get a fresh 20/min bucket per request. | The probe uses exactly this to isolate its own scenarios (each sends a different `X-Forwarded-For`), while section 11's "the per-email bucket is not bypassed by a new client address" still answers **429**. | **Low** | **OPEN.** Fixing it needs a deployment fact this build does not have: which proxy, if any, sits in front, and therefore which header can be believed. Keying on the socket address instead would put every caller in one bucket and turn the limiter into a way to lock everybody out of sign-in. Recorded rather than guessed. |
| 6 | **DNS rebinding is not closed.** The guard resolves the hostname and checks every returned address, then `fetch` resolves again. A hostile name with a short TTL could answer with a public address for the check and a private one for the connection. | **Not demonstrated** — it needs an attacker-controlled authoritative DNS server, which this block did not build. | **Low** | **OPEN.** Closing it needs the connection pinned to the checked address (a custom dispatcher), which this build does not have. Stated because the guard's comment could otherwise be read as "SSRF is solved". |
| 7 | **Rate limiting is in-process unless Redis answers.** `src/lib/rate-limit.ts` uses Redis when `REDIS_URL` is set and silently falls back to a per-process `Map`. | Read from the module; the probe proves the limits fire on this one instance and can prove nothing about a second. | **Medium** | **OPEN** by design of this deployment: one machine, one process. Also stated in "what is not covered". |
| 8 | **No fetch timeout on the media path**, so a host that accepts a connection and never answers held the request open until the OS gave up. | Pre-fix run section 6: `http://10.0.0.1/` and the metadata address hung until the probe's own timeout fired. | **Low** | **FIXED** with #1: `guardedFetch` carries a 20 s `AbortSignal.timeout` for the whole exchange, redirects included. |
| 9 | **`/api/auth/signout` answers 200 to an anonymous caller.** | Post-fix run section 3 flagged it as "not 401/404". Inspected: the route deletes only the session token presented in the cookie, so for an anonymous caller it deletes nothing and returns `{ok:true}`. | **Low** | **NOT A DEFECT** — reclassified in the probe's public-route list with that reason. Listed here rather than silenced. |
| 10 | **`POST /api/projects` truncates the title to 120 characters** (the probe's injection check asserted byte-for-byte equality with a 133-character hostile string and therefore reported FAIL). | Lead re-ran the case directly: sent 133 chars, stored 120, **prefix identical for all 120** (`first_diff None`), canary file absent. The title is stored as inert data, truncated, never executed. | **Low** | **NOT A DEFECT — the probe's assertion was wrong.** Recorded as an OPEN probe fix: the check should assert *prefix equality with the documented 120-char cap*, not byte equality. The command-injection verdict does not depend on it: the three checks below all PASS. |
| 11 | **This build sets `S3_ACCESS_KEY` and `S3_SECRET_KEY` to the same 10-character value**, so the access-key id that a presigned URL must carry (`X-Amz-Credential`) is the same string the deployment uses as its signing secret. | Post-fix run section 9 reported 2 hits of the searched secret values, both in `POST /api/media/upload`. Lead verified: the two `.env` values are equal (`equal=yes`, both length 10); the response **is** a presigned URL (`X-Amz-Credential` present, host `localhost:9000`) and the access-key id necessarily appears in it. The 6 other secret values (AUTH_SECRET, DATABASE_URL, PIXABAY_API_KEY, …) appear **0** times in 228 response bodies and 37 client chunks, and no secret *name* appears in the bundle. | **Medium** | **OPEN — deployment credential weakness, not a code defect.** A presigned URL is meant to be handed to a client; what is wrong here is that the same string is also this deployment's signing secret. Fix is to give the local object store a distinct secret; it is not something the probe can patch. Stated rather than hidden behind "the check failed". |

## Probe defects found and fixed in this block

A probe that reports a false pass is worse than no probe, so these are recorded as work:

1. **The route sweep only ever walked `route.ts`.** The "no shell / spawnSync" sweep therefore scanned 55 route files and reported `0 spawnSync call sites` against code that spawns ffmpeg in six places. The sweep now asks for `route.ts` for the route list and every `.ts/.tsx/.mjs/.cjs/.js` for the source scan — **441 files**, 6 `spawnSync` sites found.
2. **The exec scan matched `RegExp.prototype.exec`.** The pattern is now `(?<!\.)\b(execSync|exec)\s*\(`.
3. **Fixture hosts answered 403 from this network** (`httpbin.org`, `httpbingo.org`, `speed.cloudflare.com` — measured), so those checks were measuring a CDN. Replaced with `postman-echo.com/redirect-to` (302 + `Location`) and `proof.ovh.net/files/1Gb.dat` (declares 1,073,741,824 B); the assertions are unchanged.
4. **The two rate-limit checks were self-contaminating.** They compared a 429 against a 401 because the same bucket had just been tripped. Section 11 now creates its own accounts through `/api/auth/signup` (one per scenario, empty bucket) and gives every attempt its own `X-Forwarded-For`; the wording check compares 401 with 401 and the timing threshold is the measured KDF cost, not a loosened number.
5. **The assertion in #10** still needs re-pointing to the 120-char cap (OPEN).

## Checks that passed, and what proves them

| Check | Result | Detail |
|-------|--------|--------|
| Anonymous access, every route | **PASS** — 61 requests over **55 route files** | Each `route.ts` under `src/app/api` is enumerated from disk and its methods read from the exported handlers, so a new route is covered automatically. Every non-public route answered **401**, or the documented **404-never-403** for an id route. No 200 with data, no 403, no 5xx. |
| Cross-account IDOR | **PASS** — 25 requests as account B against account A's ids | Project, scene, version, render job, artefact and asset ids: every answer 404 (or a 400 carrying no data); **no response body contained any of A's identifiers**. |
| B's session is genuinely valid (the premise of every 404) | **PASS** | `GET /api/auth/session` as B → B's own user; `GET /api/projects` as B → 200 with B's own list. |
| Downloads | **PASS** | B on A's artefact → **404**, no digest header, no ISO-BMFF magic in the body; B on A's sidecar → 404; A's own download → **200** with `x-cavs-recorded-sha256` equal to the row's digest (body cancelled after the headers, so the 172 MB file is not pulled down). |
| Session cookie flags on the wire | **PASS** | `Path=/; HttpOnly; SameSite=lax`. `Secure` is absent over plain HTTP because `COOKIE_SECURE=false` on this build; the probe records which case it observed. |
| Tampered / forged cookie | **PASS** | A mutated session value and 43 chars of `A` both answer `user=null`. |
| Sign-out | **PASS** | A throwaway session is signed out: replay → `user=null`; the account's other session still answers. |
| Session token never in a URL or page HTML | **PASS** | Searched for in `/signin`, `/dashboard`, `/projects` and the anonymous redirect's `Location`: 0 hits. |
| Path traversal | **PASS** | `%2e%2e%2f`, `..%2f`, `%2Fetc%2Fpasswd`, double-encoded, and traversing `assetId`s on two routes → all **404**, no passwd content in any body. A `../../../escape.mp4` upload name is sanitised into a key inside the caller's own prefix. |
| Command injection | **PASS** | 441 source files: **0** `shell: true`, **0** `exec()`/`execSync()`, **6** `spawnSync` sites each taking an argv array (`publishing/media-probe.ts:47`, `render/probes.ts:73`, `render/synthetic-source.ts:155`, `render/executors.ts:108,164,212`). A hostile title is stored as inert data (row #10) and the canary it names never appears. |
| Secrets | **PASS for 6 of 7 values; row #11 for the seventh** | 228 response bodies and 37 client chunks searched; `AUTH_SECRET`, `DATABASE_URL`, `PIXABAY_API_KEY`, `REPLICATE_API_TOKEN`, `OPENAI_API_KEY` and the storage secret **0 hits**; the access-key id appears only inside the presigned upload URL, where SigV4 requires it. No secret **name** appears in the served chunks. |
| Oversized ingest | **PASS** | A URL declaring **1,073,741,824 B** → **413 `too_large`** in 533 ms, from the headers, before a byte is buffered; probe RSS after the attempt **29 MB**. |
| Upload key scoping | **PASS** | `userObjectKey` keeps `../` out of the object key; the probe asserts the derived key starts with the caller's own id and has no `..` segment. |
| Sign-in rate limit | **PASS** | 10/min per email, 20/min per client address, 60 s window. Fires on **attempt 11 of an empty bucket** with **429**; the **correct** password inside the window is also refused; a new `X-Forwarded-For` does not clear the per-email bucket; a different address while one is locked out still answers 401; after 62 s the correct password answers **200**. |

## HSTS: the choice, and why

The static header set in `next.config.mjs` does **not** include `Strict-Transport-Security`. This
build is served over plain HTTP on `127.0.0.1:3100` with no TLS terminator in front, and browsers
ignore HSTS delivered over HTTP — sending it would be a claim about a deployment that does not
exist. `src/middleware.ts` adds `max-age=15552000; includeSubDomains` **only** when the request
carries `x-forwarded-proto: https`, so the day a terminator is put in front the header appears
without a rebuild. The probe asserts both directions.

## The CSP, and why it looks like that

Next streams its bootstrap as an inline `<script>` and Tailwind arrives partly as inline style, so a
policy without `'unsafe-inline'` breaks every page on this build. A nonce-based policy would be
tighter and needs middleware to mint a nonce per request — a larger change than this block. What the
shipped policy buys: no external script origin, no framing (`frame-ancestors 'none'` +
`X-Frame-Options: DENY`), no `<object>`, no base-tag rewriting, forms only post to this origin.
Image, media and connect sources allow `https:` (provider thumbnails/previews) and the local object
store's origin; they do not allow arbitrary `http:` origins.

**This is a real weakening relative to a nonce-based CSP, and it is stated rather than hidden.**
