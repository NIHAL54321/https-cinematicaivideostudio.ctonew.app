# Phase 8 security block — evidence

Branch `phase8/security`, from `master` = `dd41eec`.

## What was tested, in plain words

**Who can reach this app.** One machine, one Node/Next process on
`http://127.0.0.1:3100`, behind no WAF and no external TLS terminator. Everything
the probe did, it did over plain HTTP from the same machine. Two kinds of caller
exist: anonymous, and a signed-in account (sessions are opaque tokens in an
httpOnly cookie, hashed in the database).

**What a caller could try, and what the probe asked.** Whether an anonymous
caller can read anything (every route, one request each); whether account B can
read or change account A's project, version, render job, artefact, asset or
download (25 requests with A's real ids); whether the sign-in limit really fires,
really resets, and reveals whether an account exists; whether a forged or
replayed cookie is honoured; whether a path or an id can escape the directory or
the tenant it belongs to; whether the server can be made to fetch addresses on
this machine or the private network (SSRF); whether a hostile title or filename
can reach a shell; whether a secret value appears in anything the server sends;
whether an oversized or wrong-typed download is refused before it is buffered;
and which security headers the server sends.

**What this block did.** It wrote the probe (`scripts/security/probe.ts`), ran it
against the live server, and fixed what it proved: the SSRF on the media ingest
path, the missing response headers, the sign-in timing oracle, the missing
content-type refusal and the missing fetch deadline.

**What it did not test.** See "what is not covered" below. This is one machine,
one build, one block of time.

## Artefacts

| File | What it is |
|------|------------|
| `probe.log` | The **full run of the probe against the live server before the fixes were applied**. Every PASS/FAIL line. This is the run that proved the SSRF and the missing headers. |
| `FINDINGS.md` | Finding · how it was proved · severity · fixed or OPEN, plus the checks that passed. |
| `README.md` | This file. |

Sizes and digests: see `SHA256SUMS` in this directory (regenerate with
`sha256sum evidence/phase8_security/*`).

## Regenerating everything

```bash
cd /home/team/app
bash scripts/restart-3100.sh                 # server must be up on :3100 first
bun scripts/security/probe.ts                # the whole probe; exit 0 = every check passed
bun scripts/security/probe.ts > evidence/phase8_security/probe.log 2>&1
npx tsc --noEmit                             # rc 0
CAVS_TEST_MODE=1 bun test                    # suite
bun run build                                # with the :3100 server STOPPED (it OOMs otherwise)
bash scripts/restart-3100.sh                 # prove the served build is the built one
```

The probe needs the two fixture accounts (`scripts/fixtures/p7a-world.sh`) and the
delivered artefact rows already in the database. It creates a few rows of its own
as the fixture account (a victim project, a version, a handful of assets) and
deletes them at the end.

## THE RE-RUN AFTER THE FIXES DID NOT COMPLETE — stated plainly

The pre-fix run in `probe.log` is real and complete up to the point it was
stopped: it was killed during the rate-limit section's 60-second wait because the
section had to be reordered (the enumeration timing check had to run before the
bucket was exhausted). Its FAIL lines for the SSRF and header sections are the
findings in `FINDINGS.md`.

After the fixes were written, `tsc` was clean and the suite was green
(1674 pass / 0 fail / 111 files), and one build+restart cycle completed
(`build_rc=0`, `restart_rc=0`, served `BUILD_ID i7Y-deSq_kvQfsqBaKoB5`). **The
probe was not re-run to completion against a build that carries the fixes**: a
later restart served `BUILD_ID mQ9QE1wk5TGLlAYoZr1mO` (the pre-fix build), the
re-run therefore measured the old code, and the rebuild that would have fixed
that was still running when this block's time ran out. The next session must:
build, restart, confirm the served `BUILD_ID` changed, confirm
`x-frame-options` appears on `/signin`, then run the probe and replace
`probe.log` with the green run. **Until that happens, the fixes in this branch are
proved by `tsc`, the unit tests and the source, not by the probe.**

## What is not covered

- **One machine, no WAF, no external TLS terminator.** The app is reached over
  plain HTTP on the loopback interface. Nothing here says anything about how it
  behaves behind a real proxy, a CDN or a TLS terminator — including whether
  `X-Forwarded-For` (which the rate limiter trusts, finding #5) would then be
  believable.
- **Rate limiting is in-process** unless Redis answers, and this deployment runs
  one process. It does not survive a restart, and it does not scale past one
  instance.
- **DNS rebinding is not closed** (finding #6). The guard resolves, checks, and
  then `fetch` resolves again.
- **No external audit.** Nobody outside this team has looked at this code. Passing
  this probe is not a claim that the app is "secure" or "hardened"; it is a claim
  that the listed checks behaved as stated on this build, on this machine, at
  this time.
- **No load, DoS or resource-exhaustion testing.** The oversize check is proved;
  a flood of well-formed requests is not.
- **No dependency/vulnerability scanning** (`bun audit`, CVE databases) was run.
- **No CSRF probe beyond the cookie policy.** `SameSite=Lax` plus JSON-only
  handlers is the argument, not a demonstrated test.
- **No browser-level probe of the CSP** (whether a real browser reports zero
  violations on the editor) completed in this block.
- **No hostile-title render was executed end to end.** Command injection is
  proved statically (no `shell: true`, no `exec`, argv arrays only) and by
  showing the hostile string is stored as data and its canary never appears — not
  by encoding a project whose title carries shell metacharacters.
