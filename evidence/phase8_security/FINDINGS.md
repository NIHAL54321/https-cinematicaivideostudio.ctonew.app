# Security findings — Phase 8 security block (2026-11-06)

Every line here was produced by `scripts/security/probe.ts` running against the live
server on `http://127.0.0.1:3100`, or by the commands named in the "how it was proved"
column. Nothing in this table is inferred from reading code alone; where a check could
not be run it says SKIP, and SKIP is not a pass.

Severity is my own judgement, on this deployment only: **High** = an authenticated (or
anonymous) caller can read or do something that is not theirs; **Medium** = weakens a
control that exists for a reason; **Low** = information or hardening with no direct
access path.

## Findings

| # | Finding | How it was proved | Severity | Status |
|---|---------|-------------------|----------|--------|
| 1 | **SSRF on the media ingest path.** `/api/media/select` stores whatever `asset.url` the caller sends (validated only as a non-empty string), and `/api/media/ingest` then fetched it server-side with `fetch(url, { redirect: "follow" })` — no scheme check, no address check, no redirect check, no timeout. | Probe section 6: as the fixture account, the app **fetched `http://127.0.0.1:3100/api/health`, `http://localhost:3100/…` and `http://[::1]:3100/…` and returned 200**, storing this server's own response as "footage" (bytes, size and SHA-256 reported back). `http://169.254.169.254/latest/meta-data/` and `http://10.0.0.1/` were attempted too (they hung until the client gave up — no timeout — and surfaced as an unhandled 500). `file:///etc/passwd` produced an unhandled 500 instead of a typed refusal. | **High** | **FIXED** in this block: `src/lib/media/fetch-guard.ts` (scheme allow-list, address-class allow-list, per-hop re-check on manual redirects, bounded hops, 20 s deadline), wired into `src/lib/media/footage.ts`. Re-proved by the probe: every private/metadata/`file:` target now answers **400** with a typed code (`unsafe_scheme` / `private_address`) and a sentence naming the reason, while a legitimate `cdn.pixabay.com` URL still ingests **200**. |
| 2 | **No response security headers at all** — no CSP, no `X-Content-Type-Options`, no `Referrer-Policy`, no frame policy, no `Permissions-Policy`. | Probe section 10 recorded every one of them as `(absent)` on both a page and an API response. | **Medium** | **FIXED**: static headers for `/:path*` in `next.config.mjs` (CSP with `frame-ancestors 'none'`, `nosniff`, `strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy`, COOP/CORP). HSTS is added by `src/middleware.ts` **only** when the request arrived with `x-forwarded-proto: https` — see "HSTS" below. |
| 3 | **User-enumeration timing oracle on sign-in.** The wording was already identical, but `verifyPassword` (scrypt) only ran when the account existed, so a real address took the KDF's time and an imaginary one returned in single-digit milliseconds. | Probe section 11 measured the median of 4 attempts per case: before the fix the imaginary-account attempts returned in ~4 ms against the KDF's ~50 ms. | **Medium** | **FIXED**: `src/app/api/auth/signin/route.ts` now runs the KDF against a decoy hash when no user row exists, so both cases do the same work. Re-proved by the probe: both medians are now within a factor of 2 and both are above 10 ms. |
| 4 | **The ingest path accepted any content type.** A URL answering `text/html` was stored as footage (key under `footage/…`, size and digest recorded) and described as an asset. | Probe section 7: a `https://example.com/` URL was selected and ingested. | **Low** | **FIXED**: `footage.ts` refuses a response that is not `video/*` or `image/*` (`415 wrong_content_type`), still from the headers and still before the body is buffered. `application/octet-stream` is accepted only when the provider's own row says the asset is video/image, because some CDNs serve real clips that way. |
| 5 | **`X-Forwarded-For` is trusted for the per-address rate-limit bucket.** Anyone who can reach the server directly can rotate the header and get a fresh 20/min bucket per request. | Probe section 11 uses exactly this trick to isolate its own buckets (each scenario sends a different `X-Forwarded-For`), and section 11's "per-email bucket is not bypassed by a new client address" check shows the *per-email* limit still holds at 429. | **Low** | **OPEN.** Fixing it needs a deployment fact this build does not have: which proxy (if any) sits in front, and therefore which header can be believed. Keying on the socket address instead would put every caller in one bucket, which turns the limiter into a way to lock everybody out of sign-in. Recorded rather than guessed. |
| 6 | **DNS rebinding is not closed.** The guard resolves the hostname and checks every returned address, then `fetch` resolves again. A hostile name with a short TTL could answer with a public address for the check and a private one for the connection. | Not demonstrated — it needs an attacker-controlled authoritative DNS server, which this block did not build. Stated because the guard's comment could otherwise be read as "SSRF is solved". | **Low** | **OPEN.** Closing it needs the connection pinned to the checked address (a custom dispatcher), which this build does not have. |
| 7 | **Rate limiting is in-process unless Redis answers.** `src/lib/rate-limit.ts` uses Redis when `REDIS_URL` is set and silently falls back to a per-process `Map`. | Read from the module; the probe proves the limits fire on this single instance but cannot prove anything about a second one. | **Medium** | **OPEN** by design of this deployment: one machine, one process. Stated in "what is not covered". |
| 8 | **No fetch timeout existed on the media path** (the old `fetch` had none), so a host that accepts a connection and never answers held the request open until the OS gave up. | Probe section 6: `http://10.0.0.1/` and the metadata address hung; the client-side probe timeout fired first. | **Low** | **FIXED** together with #1: `guardedFetch` carries a 20 s `AbortSignal.timeout` for the whole exchange, redirects included. |
| 9 | **`/api/auth/signout` answers 200 to an anonymous caller.** | Probe section 3 flagged it as "not 401/404". Inspected: the route deletes only the session token presented in the cookie, so for an anonymous caller it deletes nothing and returns `{ok:true}`. | **Low** | **NOT A DEFECT** — reclassified in the probe's public-route list with that reason, not silenced. |

## Checks that passed (and what proves them)

| Check | Result | Detail |
|-------|--------|--------|
| Anonymous access, every route | **PASS** — 61 requests over **55 route files** | Each `route.ts` under `src/app/api` is enumerated from disk and its methods read from the exported handlers, so a new route is covered automatically. Every non-public route answered **401**, or the documented **404-never-403** for an id route. No 200 with data, no 403, no 5xx. |
| Cross-account IDOR | **PASS** — 25 requests as account B against account A's ids | Project, scene, version, render job, artefact and asset ids. Every answer was 404 (or a 400 that carried no data); **no response body contained any of A's identifiers** (project id, job id, artefact id, asset id, email, artefact digest). |
| B's session is genuinely valid (the premise of every 404) | **PASS** | `GET /api/auth/session` as B → `user=p8b10-foreign@cavs.test`; `GET /api/projects` as B → 200 with B's own (empty) list. |
| Downloads | **PASS** | B on A's artefact → **404**, no digest header, no ISO-BMFF magic in the body. B on A's sidecar → 404. B on the proof surface → 404. A's own download → **200** with `x-cavs-recorded-sha256` equal to the row's digest (body cancelled after the headers, so the 172 MB file is not pulled down by the probe). |
| Session cookie flags on the wire | **PASS** | `Path=/; Expires=…; HttpOnly; SameSite=lax`. `Secure` is absent over plain HTTP because `COOKIE_SECURE=false` on this build; it is set from that variable, and the probe records which case it observed. |
| Tampered / forged cookie | **PASS** | A mutated session value and 43 chars of `A` both answer `user=null`. |
| Sign-out | **PASS** | A throwaway session is signed out: replay of its cookie → `user=null`; the account's other session still answers. |
| Session token never in a URL or page HTML | **PASS** | The token value was searched for in `/signin`, `/dashboard`, `/projects` and in the anonymous redirect's `Location` header: 0 hits. |
| Path traversal | **PASS** | `%2e%2e%2f`, `..%2f`, `%2Fetc%2Fpasswd`, double-encoded, and traversing `assetId`s on two routes → all **404**, no passwd content in any body. A `../../../escape.mp4` upload name is sanitised into a key that stays inside the caller's own prefix. |
| Command injection | **PASS** | A project title/description carrying `; touch …`, `$(…)`, backticks, a newline and `&&` is stored **byte-for-byte** as data, and the canary file it names does not exist. Across `src/**/*.ts`: **0** occurrences of `shell: true`, **0** calls to `exec()`/`execSync()`; every child process is `spawnSync` with an argv array built from the stage's own plan. |
| Secrets | **PASS** | Every secret value readable on this machine (`.env` + `/etc/profile.d/cto-env-vars.sh`: `AUTH_SECRET`, `DATABASE_URL`, `S3_SECRET_KEY`, `S3_ACCESS_KEY`, `REDIS_URL`, `PIXABAY_API_KEY`, …) was searched for in every response body the probe collected and in every client chunk referenced by 5 pages: **0 hits**. No secret *name* appears in the served chunks either. |
| Oversized ingest | **PASS** | A URL declaring **400,000,000** bytes → **413** from the headers, before a byte of the body is buffered (the check that used to run after `arrayBuffer()` and killed the process on a 414 MB clip). The probe process stayed under 600 MB. |
| Upload key scoping | **PASS** | `userObjectKey` keeps `../` out of the object key; the probe asserts the derived key starts with the caller's own id and has no `..` path segment. |
| Response headers after the fix | **PASS** | CSP (with `default-src` and `frame-ancestors`), `nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy` on **both** a page and an API response; no `X-Powered-By`. |
| Sign-in rate limit | **PASS** | 10/min per email, 20/min per client address, 60 s window (`src/app/api/auth/signin/route.ts`). The limit fires with **429**; the **correct** password inside the window is also refused (the limiter counts attempts, not failures); a new `X-Forwarded-For` does not clear the per-email bucket; the window really expires and the correct password then answers **200**. |

## HSTS: the choice, and why

The static header set in `next.config.mjs` does **not** include
`Strict-Transport-Security`. This build is served over plain HTTP on
`127.0.0.1:3100` with no TLS terminator in front, and browsers ignore HSTS
delivered over HTTP — sending it would be a claim about a deployment that does not
exist. `src/middleware.ts` adds `max-age=15552000; includeSubDomains` **only when
the request carries `x-forwarded-proto: https`**, so the day a terminator is put in
front the header appears without a rebuild. The probe asserts both directions: absent
over plain HTTP, present when the header says `https`.

## The CSP, and why it looks like that

Next streams its bootstrap as an inline `<script>` and Tailwind arrives partly as
inline style, so a policy without `'unsafe-inline'` breaks every page on this build. A
nonce-based policy would be tighter and needs middleware to mint a nonce per request —
a larger change than this block. What the shipped policy does buy: no external script
origin at all, no framing (`frame-ancestors 'none'` + `X-Frame-Options: DENY`), no
`<object>`, no base-tag rewriting, forms only post to this origin. Image, media and
connect sources allow `https:` (provider thumbnails/previews) and the local object
store's origin; they do not allow arbitrary `http:` origins.

**This is a real weakening relative to a nonce-based CSP, and it is stated rather than
hidden.** It is recorded here so the next block can decide whether a nonce is worth the
middleware change.
