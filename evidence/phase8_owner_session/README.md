# Owner auto sign-in — evidence pack

**Branch:** `phase8/owner-session`, branched from `master` = `f1b4c22`.
**Served build proved:** BUILD_ID `9EFUQygxQf5tseHaXs9ke` (identity check below).

## What this changes, plainly

The owner is the only person using this build and asked that signing in stop
being a step. This block adds an **env-gated auto-session for ONE named account**.
It is **not authentication removed**:

- Every one of the API routes still resolves a real `userId` from a real `Session`
  row. Nothing falls back to "first user", "any user" or a default account.
- The session is minted through `createSession` — the same function the sign-in
  route calls — with the same token hashing, the same TTL and the same cookie
  attributes (one definition, `sessionCookieOptions` in `src/lib/auth.ts`, used by
  both routes; a test compares the two route sources).
- Tenancy is untouched: a foreign account still gets **404** for the owner's
  artefacts, and does not see the owner's project in a list (proved below).

**It IS a deliberate reversal of "anonymous is 401" for this deployment only.**
While `CAVS_OWNER_EMAIL` is set, anyone who can reach the server is that account.
It **MUST be off** — unset `CAVS_OWNER_EMAIL`, or set `CAVS_OWNER_AUTOLOGIN=0` —
before this app is reachable by anyone else. The server prints a warning naming
the account at startup while it is on (see `restart-flag-on.log`).

## The gate

| env | effect |
|---|---|
| `CAVS_OWNER_EMAIL` unset / empty | today's behaviour, unchanged: `/signin` page, anonymous API = 401 |
| `CAVS_OWNER_EMAIL=<address>` | auto sign-in for that account |
| `CAVS_OWNER_AUTOLOGIN=0` | force off without unsetting the email |

`NODE_ENV` is never consulted. The value is read per request (`src/lib/owner-session/gate.ts`
imports nothing at all, so it is safe in every runtime).

## How the flow works

Middleware is **untouched** — it still redirects a cookieless protected page to
`/signin?next=…`. The `/signin` page (Node server component, `force-dynamic`)
reads the gate at request time and, when it is on, hands the request to
`GET /api/auth/owner-session?next=…`, which mints the session (Node runtime —
Prisma does not run on the edge) and redirects to the page that was asked for.
`/` does the same, so both `/signin` and `/` land on `/dashboard`. A browser that
already holds a valid session for that account is **reused**, not re-minted.

If no user row exists for the address, one is created with a cryptographically
random password that is never logged and is not derivable from anything stored
(only its scrypt hash is written); one line is logged saying the account was
created for owner auto sign-in.

The state is visible, not silent: the sidebar footer carries the marker
"Owner session — sign-in bypassed for <email>" on every app page, and `/settings`
says that sign-out really does end the session but that the next page signs you
straight back in while the flag is set.

## Proof

### Flag OFF — `proof-flag-off.txt`, `probe-flag-off.log`, `restart-flag-off.log`

- `GET /dashboard` with no cookie → **307** `Location: /signin?next=%2Fdashboard`
- `GET /api/projects` with no cookie → **401** `{"error":"Authentication required.","code":"unauthenticated"}`
- `GET /api/auth/owner-session` with no cookie → **401** `code: owner_autologin_off`
- `GET /signin` with no cookie → **200**, 18,896 B — the ordinary sign-in page
- Full security probe, **run with `CAVS_OWNER_EMAIL` unset on purpose**: **187/189 PASS**, the
  same two failures the security block documented (the probe's title-injection
  assertion compares byte-for-byte against a value the API truncates at 120 chars;
  the S3 access-key id inside a SigV4 presigned URL). The probe now **checks the
  flag state first** and refuses to run its anonymous-401 and IDOR sweeps on a
  deployment where the flag is on, rather than reporting a pass it did not earn.
- Startup log: `[owner-session] owner auto sign-in is OFF (CAVS_OWNER_EMAIL is not set) — anonymous requests are 401 as usual`

### Flag ON — `probe-flag-on.log`, `restart-flag-on.log`, `owner-session-marker.png`

Server restarted with `CAVS_OWNER_EMAIL=demo@cavs.test`. Startup log:

```
[owner-session] WARNING — OWNER AUTO SIGN-IN IS ON for demo@cavs.test. Anyone who can reach this
server is signed in as that account and sees everything it owns. This is a deliberate reversal of
"anonymous is 401" for THIS deployment only; unset CAVS_OWNER_EMAIL (or set CAVS_OWNER_AUTOLOGIN=0)
before the app is reachable by anyone else.
```

`bun scripts/security/probe.ts --owner-session` → **18/18 PASS**:

- a caller with **no cookie at all** is handed a real session (307 + `Set-Cookie: cavs_session=…; HttpOnly; SameSite=Lax; Path=/`)
- the cookie is a **real `Session` row**: `/api/auth/session` names `demo@cavs.test`
- the whole browser path from a cookieless request: `/dashboard` → 307 `/signin?next=/dashboard` → 307 `/api/auth/owner-session?next=/dashboard` → **200 `/dashboard`**
- the owner sees **their own project** `cmw9gm8tm00bbffw6pj1up5fa` in `/api/projects`
- the sidebar marker is in the **served HTML** (screenshot: `owner-session-marker.png`)
- `/settings` carries the re-entry sentence
- a **second visit creates no new `Session` row** and sets no new cookie
- a **foreign account** (`p8b10-foreign@cavs.test`, its own session proved valid first)
  gets **404** for the owner's delivered artefact `cmw9hf7e500hsffw6fx18b4it`, does not
  see the owner's project in a list — while the owner's own download of the same
  artefact still answers **200** with the recorded digest, so the 404 is a denial
  and not a broken route
- **password sign-in still works** for an ordinary account — authentication was not removed

## Gates

| gate | result |
|---|---|
| `npx tsc --noEmit` | clean (exit 0) — run with `NODE_OPTIONS=--max-old-space-size=768`; the default heap was OOM-killed on this machine |
| `CAVS_TEST_MODE=1 bun test` | **1710 pass / 0 fail / 113 files** (was 1674 / 111; +36 new tests, none deleted or weakened) |
| `bun run build` (server stopped) | success, `/` and `/signin` now `ƒ` (dynamic), `/api/auth/owner-session` present |
| `scripts/restart-3100.sh` | every assertion PASS, :3000 untouched (`restart-flag-off.log`, `restart-flag-on.log`) |
| served build identity | chunk digest on the wire == chunk on disk (see `served-identity.txt`) |

## Regenerating this evidence

```bash
cd /home/team/app
# flag OFF
bash scripts/restart-3100.sh
curl -s -o /dev/null -w '%{http_code} %{redirect_url}\n' http://127.0.0.1:3100/dashboard
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/api/projects
CAVS_BASE=http://127.0.0.1:3100 bun scripts/security/probe.ts

# flag ON
CAVS_OWNER_EMAIL=demo@cavs.test bash scripts/restart-3100.sh
CAVS_OWNER_EMAIL=demo@cavs.test CAVS_OWNER_PROJECT=cmw9gm8tm00bbffw6pj1up5fa \
  CAVS_BASE=http://127.0.0.1:3100 bun scripts/security/probe.ts --owner-session

# back to the safe default
bash scripts/restart-3100.sh
```

## What this block does NOT do

- It does not weaken or re-point any security assertion. The only re-point is the
  deliberate flag-OFF run of the 401 and IDOR sweeps, stated above and printed by
  the probe itself.
- It does not make the app safe to expose while the flag is on. Four security
  findings from the security block remain open, and this flag makes the exposure
  strictly worse: anyone who can reach the port is the owner.
- It touches nothing in the render pipeline, the export specification or the
  delivery path.
