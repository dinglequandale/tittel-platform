# LAUNCH: from "built" to "in use"

**Written:** 2026-11-12, from an audit of the repo, the specs and every prior chat on this project.
**For:** an Opus session to execute. **Supersedes nothing**: OVERHAUL.md, docs/FLOW-SPEC.md,
docs/BOARD-SPEC.md and CLAUDE.md still bind. Read CLAUDE.md first, then this file.

**Two goals, in this order:**
1. Konrad teaches his own students on this app (he has never run his real pipeline through it).
2. Outside tutors can sign up and try it, so feedback starts. Deadlines already agreed: 20 outside
   conversations by 2026-11-30, 3 prepaid by 2027-01-31.

## 0. State, verified 2026-11-12

- Branch `overhaul` at `1167780`: `npm run typecheck`, `npm test` (all six workspaces) and
  `npm run build` pass.
- **Nothing since July is on GitHub.** `origin/master` is `10aebe1` (Phase 3 part 1). `overhaul` is 45
  commits ahead and has never been pushed, so CI (`.github/workflows/ci.yml`) has never run.
- **The GitHub repo is public** (`gh repo view` reports `isPrivate: false`). The notes all call it
  private. `.env` files are ignored and none is tracked.
- **No deployment of this app was found.** Konrad's students are on the old homework app
  on Render. `render.yaml` still says `plan: free`.
- The real database has probably not had the current `db/schema.sql` applied (`boards.doc`, two
  student columns, onboarding fields). It is applied on boot by `npm run migrate` in the Render
  start command.
- The signed-in test stack (PGlite + mock JWKS + API) lives in a temp scratchpad, not the repo, and
  its `run-api.mjs` is gone. The signed-in API suites earlier sessions wrote are therefore not in
  `npm test`. Two `.claude/launch.json` entries (`merge-web`, `test-api`) point at dead paths.
- Four merged worktrees remain under `.claude/worktrees/` with their `claude/*` branches.

## 1. Rules for this pass

- **Feature freeze holds** (agreed 2026-10-30, broken since). Nothing here adds a feature that isn't
  required to teach a real lesson or to let a stranger sign up. Do not build: games, multi-tutor
  workspaces (OVERHAUL §9), more calculator work, Stripe Checkout, the command palette, SAT score
  tracking, the showpiece landing, new animation.
- **Never touch the real database or the real Supabase project.** No `npm run migrate` from this
  machine (`apps/server/.env` points at production data). Never create Supabase accounts.
- **Do not push, change repo visibility, delete branches/worktrees or delete files without Konrad's
  yes in chat.** Items marked **[K]** are Konrad's; prepare them, list them, do not attempt them.
- Tenancy: every tenant query through `orgQuery`/`studentQuery`/`attemptQuery`. Schema changes go in
  the idempotent section at the bottom of `db/schema.sql`.
- Each phase ends with typecheck, test and build green, and one commit per phase on `overhaul`.
- Machine quirks that cost earlier sessions hours are in the memory note `dev-env-quirks`. Read it
  before using the browser pane or starting a second Vite.

## 2. Phase L1: a test stack in the repo (do first; everything else is verified with it)

Earlier sessions verified signed-in flows with a throwaway stack. Rebuild it where it survives.

- `apps/server/test/stack/`: start PGlite on a local port, apply `db/schema.sql`, serve a mock JWKS
  with a `/test-session?u=<slug>` endpoint that mints a tutor session, and boot the API against
  them. `stack.mjs` in
  the QA session's old scratchpad (`teststack/`)
  is the reference if it still exists; otherwise write it fresh.
- One signed-in API suite in `npm test`: sign up a tutor, finish onboarding, create the sample
  student (`routes/demo.ts`), assign homework, answer it through the attempt token, read it back in
  Insights, remove the sample. Add a **two-org check**: tutor A gets 404 or an empty list for tutor
  B's student, lesson, assignment, board and file ids.
- Fix `.claude/launch.json`: drop `merge-web`, point `test-api`/`test-web` at the in-repo stack with
  their own Vite `cacheDir`.
- *Done when:* `npm test` runs the suite from a clean clone with no `.env`, and CI would too.

## 3. Phase L2: safe to teach a real lesson on

All in `apps/server/src/board/` unless noted. BOARD-SPEC §16.2 and §16.3 are the source.

1. **A board that stops saving must say so.** `rooms.ts:94` skips the save above 5 MB and only logs.
   Tell the host over the control channel and show a persistent banner ("This board is full. Export
   it and start a new page."), and warn at 80%. Test: a doc over the cap produces the message.
2. **Writers can't edit lesson content.** `sync.ts` only drops edits from read-only sessions. A
   student with write access can still change or delete locked lesson blocks and question records.
   Reject those edits server-side for guests. Test in `test/sync.test.mjs`: a guest writer's edit to
   a locked record never reaches the host.
3. **Cap incoming update size** per message for guests and reject malformed updates without
   throwing (one already logs `bad sync message` in the test run; make sure it is handled, not just
   caught by luck).
4. **DB TLS** (`db.ts:20`): support `DATABASE_CA_CERT` (PEM in an env var) so
   `rejectUnauthorized: true` works with Supabase's CA, keeping `PGSSLMODE=no-verify` as the
   explicit escape hatch. Do not flip the default until Konrad confirms a real connection. **[K]**
   download the CA from Supabase → Database settings and set it on Render.
5. **Old boards.** Write `apps/server/scripts/board-inventory.ts`, read-only: count boards, sizes,
   and tldraw shape types that the importer drops or turns into rectangles. **[K]** runs it against
   production before the first deploy and reads the result.
6. **Restart survival in the suite** (OVERHAUL O2 *Accept*, still open): on the L1 stack, draw,
   upload an image, restart the API, reopen: ink and image are there. Also quiz timing
   (`elapsedMs > 0`).
- *Done when:* the four behaviours above have tests and pass.

**[K] before the first real lesson, no code:** write real maths on the board with the iPad + Pencil
and the pen tablet (BOARD-SPEC Gate A never ran: handwriting feel, palm rejection, pinch zoom); run
one full fake lesson with a second device as the student (plan from a PDF, answer boxes, End
lesson, parent update, follow-up homework); open the portal, homework and review on a real phone.

## 4. Phase L3: deploy (mostly Konrad; prepare everything)

Write `docs/DEPLOY.md` as a checklist Konrad can follow top to bottom, with exact values:

1. **[K] decide:** make the GitHub repo private before pushing 45 commits? (Recommended.)
2. Merge `overhaul` into `master` locally (fast-forward), then **[K] approves the push**. Watch the
   first CI run and fix what it finds (it has never run; Linux path case and line endings are the
   likely failures).
3. `render.yaml`: `plan: starter` (no cold starts; a sleeping server in front of a parent is the
   failure to avoid), a `healthCheckPath`, and the full env list: `DATABASE_URL`, `SUPABASE_URL`,
   `BOARD_TOKEN_SECRET`, `ANTHROPIC_API_KEY`, `SENTRY_DSN`, `DATABASE_CA_CERT`, and build-time
   `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_SENTRY_DSN`, `VITE_GOOGLE_AUTH`. Check that a
   `/healthz`-style route exists; add one if not.
4. **[K]** Render: create the Blueprint service, set the env vars, paid plan. Supabase: Site URL and
   redirect URLs (`/app`, `/reset`) for the live address; Google provider if wanted; confirm backups
   (point-in-time or daily) are on. Sentry: two DSNs.
5. First boot applies the schema. **[K]** watches the log for `imported from tldraw` lines as old
   boards open, and reports any that fail.
6. **Cutover from the old homework app.** Check what exists first: the legacy set import
   (`apps/server/src/lib/legacyImport.ts`) and the bulk student add. Write the short runbook: add
   students (calendar import or paste), import the sets still in use, give each family the new
   portal link, leave in-flight homework on the old app until it is handed in. No new import code
   unless a step is impossible by hand for ~10 students.
- *Done when:* DEPLOY.md exists, `render.yaml` is updated, and master is ready to push.

## 5. Phase L4: ready for a stranger

1. **"made with <name>∎" footer** on portal, runner, review and the board name gate (OVERHAUL R6). It
   is specified as the referral loop and is not in the code. One shared component in `packages/ui`,
   reading `BRAND_NAME`, linking to `/`.
2. **Parent update default wording** (`apps/web/src/lessons/template.ts`, `LessonPage.tsx:248`). The
   default leads with "On the board: 1 of 2 answers right", which a paying parent reads as 50%. Put
   the tutor's note first, say what was covered, and phrase counts as what to practise. Wording
   only; the `/summary/:token` page stays unbuilt until a tutor asks.
3. **Lean landing** (`apps/web/src/marketing/Landing.tsx`, 32 lines today): the existing hero, one
   honest paragraph for independent math/SAT tutors, three real screenshots (lesson page, board with
   answers, parent update), sign up, and a contact address. No pricing table, no scroll show.
4. **A way to send feedback from inside the app:** one "Send feedback" link in the shell footer
   (mailto to an address **[K]** provides). Nothing more.
5. **Legal drafts** (`LegalPage.tsx`): list every bracketed gap in DEPLOY.md for **[K]** to fill
   (business name, contact email, data region, retention, governing law, pricing/refund terms).
6. **Phone pass** on the L1 stack at 375px: `/s`, `/hw`, `/review`, `/welcome`, `/signup`. Fix
   overflow and tap-target problems only.
7. **Bundle:** the main chunk is 1.73 MB (534 kB gzip) and students on phones download it to open a
   portal link. Lazy-load the board, the calculator, pdf.js and the tutor app routes so `/s`, `/hw`
   and `/review` ship without them. Record before/after sizes.
8. **Stale docs:** OVERHAUL §0's table and §3 Home, and FLOW-SPEC's checklist, describe things since
   replaced (`/welcome` onboarding, own board). Correct the facts; do not rewrite.
- *Done when:* a new signup on the L1 stack reaches a sent parent update in under 10 minutes with
  no dead end, checked in the browser at desktop and phone width.

**[K] for outside tutors, no code:** the final name (OVERHAUL says it blocks signups; "Slate" collides
with Technolutions Slate; shortlist from the naming chat: Euclid & Co., Archimedes & Sons, Lorenzo;
trademarks unchecked; it is one line in `packages/shared/src/brand.ts`), a domain, the Stripe
Payment Link for the founding year, the list of 5-10 tutors, and the 11 open questions in OVERHAUL
§9.11 only if an agency is in the first batch.

## 6. Known and deliberately left

Untested against real services (need Konrad's accounts): password-reset email, Google sign-in,
real Outlook and iCloud feeds, whether the signup name reaches the database. Missing since the
tldraw removal: page reorder, grouping, arrows bound to shapes, video. Not built: typed maths in
the board's text tool, choice elimination and section timing in the SAT-style runner, SAT score and
target tracking, per-topic mastery, the summary page, full expression-equivalence grading (factor
order is handled in `packages/shared/src/grade.ts`). Each waits for a tutor to ask.

## 7. Housekeeping to offer Konrad (needs his yes)

Remove the four merged worktrees and `claude/*` branches; delete `output.png` (unrelated plot) and
`Tutoring app UI design-handoff/` (superseded), or add both to `.gitignore`.
