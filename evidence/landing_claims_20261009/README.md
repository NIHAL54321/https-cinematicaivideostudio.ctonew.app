# Landing-page honesty pass (Block 10) — evidence

Repo /home/team/app. Suite before this pass: 796 pass / 0 fail / 49 files (HEAD f78effb).
After this pass:  846 pass  0 fail 
tsc --noEmit: exit 0 (see 04-tsc.txt). Production build:  ✓ Compiled successfully in 6.4s (see 05-build.txt).
App health on :3100 after restart (06-restart-3100.txt), unkeyed: {"ok":true,"service":"cinematic-ai-video-studio","phase":1,"time":"2026-10-09T05:16:31.061Z","db":"ok","redis":"ok","storage":"configured","storageBucket":"cinema-studio"}
Rendered landing badge, read from the served DOM (07-landing-dom.html): 

## How to read this directory
- 01-pre-change-test-failures.txt — the new guard run against the UNCHANGED copy: 30 fail / 2 pass. This is the proof the tests fail on the pre-change copy.
- 02-phase-occurrences-not-in-comment-form.txt — app-wide REPORT (not an assertion) of every /Phase N/ left in src/app + src/components outside a comment form (5 lines incl. header).
- 03/04/05 — suite, tsc, build after the change. 06 — restart. 07/08/09 — served DOM of / , /api/health and /signin (the unkeyed read-out; the two earlier pages are server-rendered, so this is the real rendered text).
- 10-unkeyed-check.txt — no key anywhere: no REPLICATE_API_TOKEN in env, no .env file, no key literal in src/scripts.

## Before -> after, claim by claim
1. Badge "Phase 1 · Foundation is live" (hard-coded phase, stale; Phases 1-6 are done) -> DERIVED: "In active development · 1 of 21 AI capabilities wired", counts read from the AI registry per request. The badge can no longer rot as adapters land.
2. h1 "One idea. A complete cinematic video." (asserted the product's output) -> "One idea. Every stage of a cinematic video." — coverage, which is what exists.
3. Hero paragraph "...thumbnail, SEO and 4K export, all from a single prompt." (implied a one-prompt pipeline + a 4K file) -> REMOVED. New: the workspace list ends at "the export specification", plus "Where a generative step has no connected provider, the studio says so rather than inventing output."
4. Card "Up to 120 minutes / ...4K export when the pipeline lands." -> "Delivery & export specifications": "8 export specifications across 16:9, 9:16, 1:1 and 4:5 — up to 3840×2160 (4K) and a 120-minute length ceiling. The encode itself is a handoff to a provider you connect; this app has no encoder of its own." The counts, formats, frame and ceiling are all read from src/lib/export/presets.ts and sizing.ts.
5. Card "Voice & music studio — AI voiceovers, music and sound design tuned to your Brand Kit." -> "Voice, music & sound": names the real deterministic engines (voice catalogue, Voice Director, pronunciation, sync, music selection with ducking, sound design) and says each generative step is provider-backed and reports whether it is connected. The Brand Kit tuning claim is gone: no voice/music/sfx code reads the Brand Kit.
6. Card "AI without the lock-in — Provider-independent orchestration with A → B → C → D fallback." -> "No provider lock-in": "Every step is ranked across the provider accounts that can serve it, and a failed attempt falls through to the next ranked provider — up to 4 [DEFAULT_ATTEMPTS_LIMIT]. Nothing is attempted until its adapter is wired and its key is set."
7. Footnote "Built for the 7-phase roadmap · Phase 1: Foundation" -> derived footnote: "Wired today: 1 of 21 AI capabilities. A provider's own answer is recorded exactly as the provider gave it — successes and failures alike."
8. "Honest by design" body: "...shows a clear Provider Not Connected state until real APIs are wired in" -> states the behaviour and its rule (wired vs connected, per capability, env var named) and no longer implies every capability is unwired.
9. <head> description "...a complete cinematic faceless YouTube video ... and 4K export." -> "The production workspace for faceless YouTube videos — ... and the export specification. The AI steps run on provider accounts you connect, and the app reports which are connected."
10. /api/health answered "phase": 1 (nothing read it; wrong) -> replaced by {ai:{capabilities:21,wiredCapabilities:1}} derived from the registry.
11. Sign-in/sign-up panel repeated the same hero, "Phase 1 · Foundation", the 4K/long-form list, "Provider-independent AI with automatic fallback" and "Brand Kit that travels across every video" -> the panel now renders the same shared copy module; bullets are the derived wiring count, "Brand Kit seeded into every new project" (what projects.ts actually does) and "Auto-save with full version history". Sign-up subtitle "Start building your first cinematic video in minutes." -> "Start a project — every stage of it has a surface here."
12. Signed-in surfaces with the same defect class, fixed in this pass: dashboard "The 8-step Create Video wizard arrives in the next milestone" (false — it is built) -> describes what the wizard really does; dashboard services line "AI providers — deliberately Not Connected (Phase 3+)" -> DERIVED from live capabilityStatus() per request; projects empty state "The 8-step Create Video wizard arrives in a later milestone" (same falsehood) -> removed; Script Writer badge "Phase 2 · final builder" -> derived wiring count; Audio Mix "real audio rendering arrives in Phase 5" -> "this app has no audio renderer"; ProviderNotConnected body "AI generation is not wired up yet in Phase 1 ... in a later phase" -> behaviour statement; capability status "not wired yet in Phase 1 — ... until a later phase" and the connected branch's "A → B → C → D fallback" -> live wording; script-writer studio "in Phase 1 that is the honest ... state" -> phase reference dropped.

## Kept, with the reason
- "No fake AI. Ever." and "Honest by design": a policy statement the team controls and has kept so far, now paired with derived numbers.
- "Premium studio" is gone from the hero only because the sentence carrying it was false; positioning with no factual content elsewhere is untouched.
- The four CTAs (Start creating / Open the dashboard / Sign in / Create account), the product name and the footer.
- /api/health's service name, db/redis/storage checks: all real service probes.
- "Auto-save with full version history", "Brand Kit seeded into every new project": both are code facts (ProjectVersion snapshots on the update path; projects.ts seeds a new project's settings from the user's kit).

## Left alone, with the reason (reported, not changed)
- Provenance header comments of the form "Phase 5 Block 1 — the video editor page" (src/app/**, src/lib/**, ~40 sites): a fact about when a module was written, not a statement to a reader; they are inside comments and no user sees them.
- Forward-looking hedges that are still TRUE today, because the capability really is unwired: "provider transcription unlocks audio→subtitle in a later phase" (subtitles route + studio), "Region detection arrives with provider-based vision", "AI thumbnail generation arrives in a later milestone" (workspace tab), "frame preview of real media arrives in a later phase", "Profile editing and password changes arrive in a later phase". Their phase/milestone wording is loose, but they assert nothing about a capability that exists; renaming them is churn in signed-in surfaces, so they are reported instead.
- src/workers/ai-worker.ts (two "later phase" comments and a throw message): the worker is a stub, and the message refuses rather than claims.
- The stale test NAME in src/lib/ai/__tests__/orchestrator.test.ts ("...all not_connected in Phase 1") — a name, not copy; still true today because no key is set. Reported.

## What remains unproven (unchanged by this pass)
- A SUCCESSFUL provider response has still never been seen: no provider has returned a job/file, so handed_off and a produced file remain unobserved, and Replicate's model slug + input schema are unverified without a real key.
- Nothing is live and no money can move: no Stripe, no payments, no customers, no revenue. The page makes no such claim — and none about pricing.
- Machine-state claims are deliberately NOT rendered on the landing page: it is prerendered at build time, so a "connected/not connected" sentence would freeze into the build and contradict /api/ai/status. A test enforces that the four signed-out surfaces read no env and never call capabilityStatus().

## Gap in this pass
- The browser proof here is the served DOM read-out (07/09, text extracted from the running app on :3100 after a fresh build) plus curl of the public payloads; a hash-distinct agent-browser screenshot was not captured before the session budget ran out. The in-app signed-in surfaces were not re-read in a browser either.
