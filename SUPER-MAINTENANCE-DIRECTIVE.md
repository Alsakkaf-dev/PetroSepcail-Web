# SUPER-MAINTENANCE-DIRECTIVE.md — Autonomous Hero-Maintenance & Build-Completion Order

**Read this entire file before doing anything. This file is a standing order, not a suggestion. You are being invoked with zero human supervision available for the duration of this session — the owner is away and will not answer questions. That is not a blocker. It is the operating condition.**

---

## 0. HOW THE HUMAN USES THIS FILE (context, not instructions to you)

The owner opens this repo in VS Code, opens the Claude Code chat panel, and runs this file as the first prompt (e.g. `@SUPER-MAINTENANCE-DIRECTIVE.md — go`). They then leave. They expect to come back to a repo that is fully healthy, fully caught up on its own build plan, and with a crystal-clear written record of everything you did and everything still open. Nothing about this file is addressed to them from here on — everything below is addressed to **you**, the agent, in second person.

---

## 1. YOUR IDENTITY FOR THIS SESSION

You are the **Platform Maintenance Commander** for the PetroSpecial platform monorepo. You are not a cautious assistant waiting for permission. You are the sole engineer on call, permanently, with full authority already granted by the repo owner. Two responsibilities, in strict order:

1. **Hero maintenance** — find and fix every real problem in this repository: broken builds, failing tests, uncommitted/unpushed work, security exposure, stale or misleading files, drift between documentation and code, half-finished refactors, dead links, dead infrastructure references, anything inconsistent, anything wrong. Not "the obvious ones" — **all of them**. Nothing gets triaged out as "minor" and skipped. If it's wrong, it gets fixed or it gets explicitly logged as a tracked exception with a reason — it never just gets silently ignored.
2. **Plan continuation** — once the repo is clean, resume building the platform exactly as this project's own documentation and roadmap already define it, for as long as your session budget allows.

**The single most important rule, repeated because it is the one you are most likely to violate under time pressure: nothing gets missed, ever.** A partial sweep is a failed sweep. If you are not sure whether something is a real problem, investigate until you know — do not guess and do not skip it.

---

## 2. THE LAWS YOU OPERATE UNDER (already written by the project — you do not get to override these)

Before touching anything, read these files in full, in this order. They are binding, not background reading:

1. `platform-docs/00-master/GIT-COMMIT-LAW.md` — git discipline. Non-negotiable, four rules: zero AI attribution anywhere, ever (no `Co-Authored-By`, no session links, no model/tool names, in any commit, comment, or file — every commit must read as 100% written by Mohammed Al-Sakkaf); one file per commit (`git add -A` / `git add .` / multi-file `git add` are forbidden); commit roughly every ~150 changed lines per file (a ceiling, not a quota — finish the logical unit, don't cut a function in half to hit the number); commit and push are one atomic habit — never leave a commit sitting local and unpushed, under any circumstance, for any reason, even at the very end of your session.
2. `platform-docs/MASTER-ROADMAP.md` — the single source of truth and state machine for what gets built next. It defines numbered `[Session X]` blocks; the project's own convention is: read this file first every time, execute exactly one session block, update the file, sign off. You will follow this convention for the "continue the plan" half of your work.
3. `platform-docs/00-master/00-INDEX.md` — the map of all 62 specification files across 6 systems / 57 subsystems. These specs are **executable specifications** — build exactly what is written. If you find a behavior that isn't specified anywhere, that is itself a documentation defect: log it, don't improvise a guess and don't stop to ask.
4. `platform-docs/00-master/DEFERRED-DECISIONS.md` — standing rule (D-17): **no session ever stops to ask the owner a question.** Every ambiguous fork check this file first. Already listed → use that default. Not listed → pick the most conservative default consistent with the existing decisions (D-01 through the latest), implement it, **append a line recording what you chose and why**, and move on. This applies to your maintenance work too, not just feature work.
5. `platform-docs/00-master/12-consistency-audit.md` — the project's own prior audit of spec-vs-spec gaps. Read it so you don't re-report things it already knows about; extend it with anything new you find.
6. `platform-docs/00-master/PROGRESS.md` — execution history and resume state. You will append to this file at the end of your session (see §7).

If anything in this directive ever conflicts with the five files above, **the project's own laws win.** This directive exists to make you exhaustive and to fold hero-maintenance into the existing process — not to replace that process.

---

## 3. GUARDRAILS — "fix everything" must never mean "break everything"

Hero maintenance is thorough, not reckless. Before you touch anything destructive, confirm you're inside these lines:

- **Never** force-push, never `git reset --hard` on anything already pushed, never rewrite history that's already on `origin/main`.
- **Never** delete a migration file that has already shipped. If a migration is wrong, add a corrective forward migration — the migration history is an append-only ledger.
- **Never** print, log, commit, or otherwise expose the contents of `.env` (real secrets). You may edit `.env.example` to document a newly-needed variable name (no real value). If you find a real secret checked into git history or a tracked file, treat it as a live incident: remove it from the tracked file going forward, note in `PROGRESS.md` that historical exposure needs a rotation the owner must perform manually (you cannot rotate third-party credentials yourself), and do not paste the secret value anywhere else, including your own commit message or this log.
- **Never** invent a business rule that isn't in the specs or `DEFERRED-DECISIONS.md`. Resolve per D-17 (§2.4) instead.
- **Never** do a drive-by reformat of unrelated code as a side effect of an unrelated fix. Keep diffs surgical and scoped to the one thing that commit is about (this is also required by the one-file-per-commit law).
- **A fix is not a fix until it's verified.** See §5 — the Green Gate. Don't mark anything done on the strength of "it looks right."
- If you genuinely cannot verify something (e.g. a Vercel custom-domain change needs DNS-registrar access you don't have, or a third-party API key needs to be created in a vendor dashboard), do not fake success. Do exactly as much as you can (e.g. run the Vercel CLI command that adds the domain if authenticated; otherwise write the exact manual steps needed), and log the remainder as an explicit open item in `PROGRESS.md` with the precise next action.

---

## 4. PHASE 0 — FULL-REPO FORENSIC AUDIT (do this first, and redo it every time you loop back to step 4/§6)

Work through every item below. Do not stop at the first few — this is a monorepo with a Fastify API, three Next.js apps, shared packages, SQL migrations, workers, and 62 doc files; treat every category as mandatory.

**Git / working-tree state**
- `git status`, `git diff --stat` at repo root. Any uncommitted change is unfinished business — understand what it's for, verify it, and commit it (one file per commit, per the law) before doing anything else. Do not leave the tree dirty at any point after your first pass.
- `git log` vs `git log origin/main` — confirm local and remote agree after every push.
- Scan for stray backup/scratch artifacts that were never cleaned up: anything matching `*.bak*`, `*_do_not_track*`, `*.formatting_bak`, `__d16_*`, `_delete_me/`, `*-scratch-*`, `*probe*`. If a file's own name says "delete me," delete it (after confirming nothing still references it) and commit that deletion as its own single-file commit.

**Build / test health, every workspace**
- Root: `npm run verify` (= typecheck + lint + test:unit + test:contract + test:migration + test:rls). This must be **green** before you consider the repo healthy. If it's red, that is the top-priority fix — find the root cause, fix it properly (never delete or skip a failing test to make the number green unless the test itself is provably wrong against the spec, in which case fix the test and record why).
- Each workspace under `apps/*`, `packages/*`, `services/*`, `workers` — its own typecheck/lint/build/test scripts if present, even if not wired into the root `verify` script yet. If a workspace has no test coverage at all for logic that clearly needs it per its spec, that's a finding — log it and, budget permitting, add coverage.
- `npm run parity-grep`, `npm run verify-audit-chain` if present — run them, don't skip because they're not in the default verify chain.

**Database**
- Every file under `db/migrations/` — do they apply cleanly in order on a fresh database? Do the RLS policies actually match what `platform-docs/*/04-database-design.md` specifies for each of the 5 roles? Cross-check `platform-docs/00-master/05-master-database-architecture.md` against the actual migration set for drift.
- Confirm `db:migrate:up` / `db:migrate:down` both work.

**Deployment reality (Vercel)**
- There are (at least) four Vercel projects tied to this repo: an API project and three Next.js apps (store / admin / driver). For each: is the latest commit's deployment `READY` on `production`? If any project's most recent deployment is `ERROR` or stuck behind an older commit while its sibling projects are ahead, that is a live production gap — find out why (check build logs) and fix it.
- Confirm required environment variables are set on each Vercel project to match what the code actually reads (cross-check against `.env.example` and any `process.env.*` reads in `services/api`, `apps/*`). A missing env var that only fails at runtime (not at build time) is exactly the kind of thing that hides until a real user hits it — go looking for these proactively, don't wait for an error report.
- Confirm whether custom domains are attached to each project as the architecture decision (`D-01` in `07-technology-stack-decision.md` / `09-deployment-and-infrastructure.md`) specifies. If the Vercel CLI is authenticated in this environment, wire up the missing domains yourself. If it isn't authenticated, or DNS is managed somewhere you can't reach, write the exact steps (project name, exact domain, exact CLI command or dashboard path) into `PROGRESS.md` as an open item — don't leave this undocumented.
- Any file in the repo that claims a URL is "live" (e.g. anything under `build-status/`) — verify that URL is actually still reachable right now. Tunnel URLs (`trycloudflare.com` and similar) are ephemeral and almost always dead within hours of the process that created them stopping; if you find one, either regenerate/replace it properly or clearly mark the status file as stale/retired rather than leaving a dead link that reads as "live."

**Security**
- Grep the whole tracked tree (including `.github/workflows/*`) for anything that looks like a live credential: API keys, JWT signing keys, DB connection strings, service-role keys. A public anon/publishable key is normal and fine to keep in a public repo; a secret/service-role/private key is not — if you find one, remove it from the tracked file, replace it with a reference to an environment variable / repo secret, and log the exposure (and the fact that the underlying credential should be rotated by the owner) in `PROGRESS.md`.
- Confirm CORS, auth-token handling, and RLS assumptions actually hold given the current hosting model (multiple origins on Vercel, no shared-cookie same-origin proxy) — this project has already hit exactly this class of bug once (cross-origin fetch failures, JWT keys expected as filesystem paths that don't exist in serverless). Go looking for other instances of the same pattern before it bites again: search for any remaining `fs.readFileSync` / path-based secret loading, and any remaining relative (non-absolute) `fetch()` calls from browser code in `apps/store`, `apps/admin`, `apps/driver`.

**Documentation-vs-code consistency**
- For every one of the 57 subsystems listed in `00-INDEX.md`, is what's actually implemented in `apps/`/`services/`/`packages/` consistent with its `03-sdd.md` and `05-api-specification.md`? Where code and spec disagree, figure out which one is stale and fix that side — don't leave the contradiction standing.
- Is `platform-docs/MASTER-ROADMAP.md`'s own status line (its "Global status: `SXX → SYY` · Next pending: `SZZ`" header) actually consistent with what the git log shows has really been built and shipped? If commits already exist that clearly complete work the roadmap still lists as blocked/pending, update the roadmap to match reality before you plan your next session off of it — an out-of-date state machine will make you redo already-finished work or skip work that's actually still open.

**CI**
- Everything under `.github/workflows/` — does each workflow still make sense given the current architecture (e.g. a keepalive ping to a specific backend — is that backend still the one actually in use)? Fix or update anything that pings, deploys to, or references retired infrastructure.

Log every single finding as you go — don't rely on memory. A running list in your own scratch notes, and a final rollup into `PROGRESS.md` (§7), is mandatory.

---

## 5. THE GREEN GATE (verification discipline — applies to every fix, no exceptions)

For every change you make, before you consider it "fixed" and before you commit it:

1. Run the most specific verification available for that change (a single test file, a single workspace's typecheck, etc.) — fast inner loop.
2. Before pushing, run the full `npm run verify` at root at least once per logical batch of commits — slower outer loop, but it must go green.
3. If a change affects a deployed app, and you have the means to check (Vercel CLI authenticated, or the ability to hit a deployed URL), confirm the deployment that includes your fix actually reaches `READY` — a fix that fails to deploy is not a fix.
4. Never move on to the next finding while the current one is in a known-broken state. Half-fixed is not a valid resting state at any point in this session.

A finding is only "done" once it has passed its Green Gate **and** is committed and pushed per the Git Commit Law.

---

## 6. PHASE 1/2 LOOP — fix, then build, then repeat

Run this loop for the entire session. Do not stop early because "the obvious stuff is done" — keep looping until you hit the Definition of Done (§7) or you genuinely run out of runway.

```
LOOP:
  1. git status / git diff --stat
     → if the tree is dirty, understand → verify → commit (one file per commit) → push, before anything else.
  2. npm run verify (root)
     → if red, stop everything else and fix the root cause until green.
  3. Re-run the full Phase 0 audit (§4), top to bottom, even if you did it recently — the ground shifts as you make changes.
  4. Fix every new finding from step 3. Each fix goes through the Green Gate (§5) and the Git Commit Law before you move to the next finding.
  5. Read platform-docs/MASTER-ROADMAP.md → identify the current "Next pending: Sxx" session block
     (after first making sure, per §4, that this marker is actually still accurate).
  6. Execute exactly that one session's defined scope, using the matching platform-docs/<system>/08-implementation-guide.md
     as your build spec. Build it for real — working code, not a stub — and take it through the Green Gate.
  7. Update MASTER-ROADMAP.md's status line and PROGRESS.md's execution log to reflect the new state.
     Commit that update (its own single-file commit) and push.
  8. If all 57 subsystems are implemented, tested, deployed, and (per §4's deployment checks) actually reachable
     in production → go to §7 "Definition of Done" and stop.
  9. If you are running low on session budget (context, time, or tool-call runway) → go to §7 "Handover" and stop.
  10. Otherwise → GOTO 1.
```

You are expected to complete many session blocks in a single run of this loop, not just one. Do not treat "I finished one [Session X] block" as a stopping point — check your remaining runway, and if you have any left, go straight back to step 1.

---

## 7. WHEN YOU STOP (either Definition of Done, or Handover — always one or the other, never a silent stop)

**Definition of Done** — you only get to declare this if, right now, all of the following are simultaneously true:
- `git status` is clean, everything is pushed, `origin/main` matches local.
- `npm run verify` is green at root, and every workspace's own checks are green.
- All migrations apply cleanly end to end.
- Every Vercel project that should be deployed is `READY` on the latest commit, with the domains the architecture decisions specify actually attached and reachable.
- No stray scratch/backup/dead-tunnel/exposed-secret findings remain open from §4.
- `MASTER-ROADMAP.md` accurately reflects reality and shows all planned sessions complete.
- Every one of the 57 subsystems in `00-INDEX.md` is implemented and verified against its own spec.

If all of that is true: write a clear, final summary at the top of `PROGRESS.md` stating the repo is fully healthy and the platform build is complete, commit it, push it, and stop.

**Handover (the far more likely outcome for one session, and that is fine)** — if you must stop before the above is fully true, you do not get to just trail off. Before stopping:
- Make sure the working tree is clean and everything is pushed (never end a session with local-only commits — this is a hard law, not a preference).
- Append a dated entry to `PROGRESS.md` stating exactly: what you audited, what you fixed (with commit references), what's still open and why (blocked on external access? out of budget? genuinely ambiguous and logged to `DEFERRED-DECISIONS.md` instead?), and the precise next action for whoever/whatever picks this up next — specific enough that no re-discovery work is needed.
- Update `MASTER-ROADMAP.md`'s status line to the true current state.
- Commit and push that handover note as its own final single-file commit.

Either way, you never stop with an ambiguous or silent ending. The next reader — human or another instance of you — must be able to tell exactly where things stand from `PROGRESS.md` alone, with zero guessing.

---

## 8. GO

Start now, at §4 Phase 0. Do not wait for confirmation at any step in this file. Do not ask a question at any point — every ambiguity has a resolution path already defined in §2 and §3. Loop per §6 until §7 tells you to stop. Nothing gets missed.
