# Tittel Platform — Productization Plan

**Status:** Approved plan, not yet built. This document is the single source of truth for building
the product. It is written as a handoff: the executing model (Sonnet-class) should be able to build
the entire product from this document plus the two source repos, without re-deriving any decision.

**Written:** 2026-07-12 by Fable 5, from decisions locked with Konrad across June–July 2026.

**Source repos (read-only inputs — never modify them during this build):**
- `C:\Users\konra\tittel-tutoring-app` — public repo `dinglequandale/tittel-tutoring-whiteboard`.
  Ephemeral tldraw whiteboard: tutor-driven camera, Desmos mirror, lesson-JSON injection,
  class modes / write grants, interactive answer collection + stats, PDF export, timer, Nim game.
- `C:\Users\konra\tittel-sat-homework` — private repo `dinglequandale/tittel-sat-homework`.
  Bluebook-clone homework runner: problem-set ingest (KaTeX + TikZ figures), server-authoritative
  attempts/timing/grading, magic-link student portal, tutor analytics, lesson-plan export.

**This repo:** `C:\Users\konra\tittel-platform` — new **private** GitHub repo
(`dinglequandale/tittel-platform`). The product handles student names, performance data, and
billing; it must never be public.

---

## 0. How to use this document

- Sections 1–3 are context: strategy, what exists, what's missing. Read once.
- Sections 4–8 are the spec: architecture, data model, feature specs per module, design system.
  These are binding. Where a decision is marked **DECIDED**, do not re-litigate it — several were
  reached after failed alternatives (details in §9).
- Section 9 is the **gotcha ledger**: hard-won, non-obvious engineering facts from the source
  repos. Read it in full before porting any code. Every item in it cost real debugging time.
- Section 10 is the phased build order with acceptance criteria per phase. Build phases in order;
  each phase ends with the app deployable and demoable.
- Section 11+ covers billing, compliance, launch, deferred items, and the short list of questions
  only Konrad can answer.

Working conventions for the executing model:
- Verify each phase like the source repos were verified: `typecheck` + `vite build` + headless
  smoke tests (`node test/*.mjs`) + explicit "Konrad browser-check" callouts for anything that
  needs a real browser (this dev environment has no installable browser).
- Konrad's own tutoring is the QA loop. Never leave `main` in a state he can't teach on.
- Commit style, TS conventions (`.ts`-extension imports, `allowImportingTsExtensions`, tsx runner,
  React 18 + Vite + Express) follow the source repos.

---

## 1. Strategy

### 1.1 What we're selling

A single product that covers the **teaching surface** of an independent tutor's practice:

1. **Live teaching** — a collaborative whiteboard with tutor-driven camera, shared/personal Desmos,
   lesson pages, in-class answer collection with live stats, timers, and games.
2. **Homework** — a test-realistic assignment runner (Bluebook-grade for SAT; a clean neutral skin
   for everything else) with server-timed attempts, autosave, and grading.
3. **Content** — an in-app lesson builder and a reusable question bank that feed both of the above.
4. **Insight** — one student record across live sessions and homework: mastery by topic, timing,
   most-missed; one click from "what they got wrong" to "next lesson's review pages."

The loop that no competitor closes: **assign → analyze → auto-draft the review lesson → teach it
live → collect answers → back into the record.** Both halves already exist as separate apps; the
product is the closed loop plus the polish.

Explicitly **not** in the product (v1): video calling, scheduling/calendar, invoicing parents,
payroll. Tutors already live in Zoom/Meet and often already pay TutorBird/Teachworks for back
office. We are the teaching stack, not the back office. (Video via LiveKit is a v2 candidate; see
§13.)

### 1.2 Market positioning — DECIDED

**The engine is subject-agnostic; the go-to-market is math and test-prep tutors, with SAT/ACT prep
as the flagship vertical.** This was delegated to me (Fable) and here is the reasoning, recorded so
it isn't re-opened casually:

- Our genuinely differentiated assets are math-shaped: live synced Desmos (with hard-won
  loop-prevention), KaTeX everywhere, TikZ/pgfplots figure pipeline, numeric-equivalence grading,
  a faithful Bluebook runner. Generic-tutor incumbents (Lessonspace, Pencil Spaces) do video +
  generic canvas well and math badly. Fighting them on "all tutors" means fighting on our weakest
  ground (video, scheduling) and neutralizing our strongest.
- SAT-only is too narrow and seasonal, and most SAT tutors are also math tutors. Math tutoring is
  the superset market with the same buyer.
- The generalization cost is low by design: the lesson format and problem-set format were both
  deliberately kept "dumb containers" (invariant primitives, no pedagogy in the schema). Making the
  runner subject-neutral is a skin + settings, not a rewrite.

Concretely: no `sat` in the product's names, schemas, or table names. SAT exists as a **template**
(runner skin, reference sheet, grid-in rules, section presets) and as marketing copy. A precalc
tutor should never feel they're using an SAT tool; an SAT tutor should feel it was built for them.

### 1.3 Pricing (initial hypothesis, Stripe makes it cheap to change)

- **Free** — the ephemeral quick whiteboard (no account, today's public product) + a 30-day trial
  of the full product. The public whiteboard repo stays live as-is: it is the top-of-funnel.
- **Solo — $29/mo or $290/yr** — 1 tutor seat, unlimited students, all features.
- **Studio — $79/mo or $790/yr** — up to 5 tutor seats, shared content library, per-tutor rosters.
- Founding-tutor deal for the first cohort (50% off first year) — Konrad sells this in person at
  Yale from September 2026.

Schema supports multi-seat orgs from day one (§5); the Studio *UI* (seat management) ships in a
late phase (§10, Phase 7). Konrad's own org is the permanent dogfood tenant.

### 1.4 Credibility & distribution (context for landing-page copy)

- "Built by a tutor whose student went 650 → 760 in two months."
- Konrad at Yale (Sept 2026): dense market of tutors to sell to and students to teach — every
  group class he runs on the platform is a live demo.
- Group classes are also Konrad's personal economics lever (6 × $25 ≈ $150/hr vs $40 solo), so the
  large-group features are first-class, not enterprise add-ons.

### 1.5 Product name

Working codename: **Slate** (used in this doc for the product; repo stays `tittel-platform`).
Final name is Konrad's call before launch (§15) — needs a domain + trademark sanity check. Nothing
in the codebase should hardcode the display name: put it in one constant
(`packages/shared/src/brand.ts`) so a rename is a one-line change.

---

## 2. Inventory — what exists and what it's worth

### 2.1 Whiteboard repo (`tittel-tutoring-app`) — port almost all of it

| Asset | State | Product disposition |
|---|---|---|
| tldraw 3.15.5 + `@tldraw/sync` room server (`server/rooms.ts`, in-memory `TLSocketRoom`, `/uploads` asset store) | Solid, ephemeral-only | Port; add optional persistence (§6.3) |
| ControlChannel (`/control/<roomId>` WS: camera, page, calc, calc-access, free-reign, quiz-*, timer, game-*) | Solid, battle-tested | Port as-is; add auth handshake (§6.3) |
| Tutor-driven camera + page follow, snap-back | Solid | Port as-is |
| Desmos shared mirror + personal calc + edit toggle (interaction-gated loop prevention) | Solid — the loop fix took 3 attempts | Port as-is; **do not touch the broadcast gating** (§9.2) |
| Lesson pipeline: `client/src/lesson/{schema,layout,render,load,keys}.ts` — JSON → KaTeX→PNG blocks → locked tldraw shapes, deterministic IDs, idempotent reload | Solid | Port; becomes the render target of the new lesson builder (§6.4) |
| Class modes (individual / large-group), name gate, roster, per-student write grants (hand-tool pinning) | Built; browser-verified in parts | Port; the grant mechanism is subtle (§9.1) |
| Free reign toggle (camera/page unlock + personal calc swap) | Built | Port as-is |
| Interactive answers: `client/src/quiz/*` + server grading, open/close gating, stats panel, CSV export, reveal | Built 2026-07-09; still needs browser check | Port; keep every design invariant (§9.3) |
| All-pages PDF export (`exportPdf.ts`, per-page PNG → jsPDF, content-aspect pages) | Built | Port; add "save to student record" (§6.6) |
| Timer widget (tutor-controlled, draggable, synced) | Built | Port as-is |
| Games: `client/src/games/*` registry + Nim (tokens, drag, win celebration) | Built (phases 1–3 on main) | Port registry + Nim; more games deferred (§13) |
| Named rooms (fixed class URL) | Built | Superseded by class entities (§6.3) but the mechanism reuses |
| `test/smoke.mjs` headless WS test harness (incl. `openWithInbox`) | Solid | Port and extend — it's the only way to test sync here (§9.6) |

### 2.2 SAT homework repo (`tittel-sat-homework`) — port the engine, rebuild the shell

| Asset | State | Product disposition |
|---|---|---|
| Problem-set format + validator (`shared/format.ts`, `server/validate.ts`, `docs/PROBLEM-SET-SCHEMA.md`) | Solid, documented | Port; extend with tags/difficulty and new answer types (§6.5) |
| TikZ/pgfplots figure pipeline (`server/figures.ts`, node-tikzjax, serial render mutex, dedup) | Solid | Port as-is; **serial only** (§9.4) |
| Ingest (`server/ingest.ts`: validate → render → upsert txn, response-preserving re-push) | Solid | Port; becomes the import path *and* the save path of the problem editor |
| Attempt spine (`routes/attempt.ts`: server stamps `started_at`, autosave with `time_spent_ms` + `change_count`, auto-submit on expiry, review gated on submit) | Solid, the crown jewel | Port with tenancy columns; behavior unchanged |
| Grading (`grade.ts` / whiteboard `shared/grade.ts`: numeric equivalence, fractions, 0.1% relative tolerance, `accept[]`) | Solid — two graders exist, near-duplicates | **Unify into one shared package** (§5.3) |
| Runner UI (`client/src/runner/*`: Bluebook header/timer/eliminator/grid-in/nav popup, Desmos, reference sheet) | Solid, Konrad-tested | Port; split into engine + two skins (§6.5) |
| Student portal + review (`portal/*`) | Solid | Port into new design system |
| Tutor dashboard (`tutor/*`: students, groups, assignments, analytics tables, problem-set upload, lesson export) | Functional but "stock AI" looking, single-secret auth | **Rebuild** inside the new app shell; reuse the route logic/queries |
| Lesson export (`lessonExport.ts` → whiteboard LessonDoc) | Solid | Port; upgrade from file-download to in-library lesson creation (§6.6) |
| DB layer (`pg` Pool over `DATABASE_URL`, idempotent `schema.sql` applied on boot) | Solid | Keep exact pattern; new schema (§5) |

### 2.3 What is single-tenant / hardcoded today (the multi-tenancy debt)

- Tutor auth is one shared `TUTOR_SECRET` env var; there is no user table, no login, no sessions.
- No `org_id`/`tutor_id` on any row — every student/set/assignment is implicitly Konrad's.
- Whiteboard rooms have no owner: whoever holds `#host` is the tutor; anyone with the URL joins.
- Problems live inside problem sets (no reuse across sets); lessons live as files on Konrad's disk.
- Board state, class rosters, and quiz results evaporate 30s after the last leave (except CSV/PDF
  the tutor remembers to export).
- Branding, copy, and the reference sheet say SAT.
- Two repos, two deploys, two databases-worth of assumptions; the only bridge is a hand-carried
  JSON file.

### 2.4 The three product gaps Konrad named (all confirmed by the inventory)

1. **Lesson authoring is not self-contained** — lessons are hand-written JSON files. → In-app
   visual lesson builder (§6.4).
2. **Homework ↔ whiteboard pipeline is not seamless** — export file, re-upload file. → Shared
   content library + one-click "review lesson from missed problems" (§6.6).
3. **Looks stock-AI, not product-grade** — both UIs are functional default-CSS. → Real design
   system, specified concretely in §8 so the executing model can't drift back to default-shadcn.

---

## 3. Users, roles, and core loops

**Roles**
- **Owner** — the tutor who created the org; billing + seats + everything a tutor can do.
- **Tutor** — full teaching rights within the org (Studio plan; Solo orgs have owner only).
- **Student** — no account, no password, ever. A student is a row + a permanent magic-link token.
  This zero-friction identity is a locked decision and a real differentiator — students are
  teenagers who will not manage passwords.
- **Guest** — an anonymous whiteboard joiner (free quick-board, or a student joining a live class
  by link before being matched to a roster entry).

**Core loops the UI must make effortless**
1. *Weekly solo-tutoring loop:* open student → see last homework results → open board (their
   persistent board or a lesson) → teach → assign next homework → done. Target: zero file handling,
   under four clicks between any two steps.
2. *Group-class loop:* create class → attach lesson → students join by class link, name-gate,
   default-locked → teach with camera/page follow → open questions, watch live stats → free reign
   for independent work → debrief with a write grant → export/auto-save PDF + results.
3. *Content loop:* write problems once (bank) → compose into sets (homework) and lessons (live) →
   analytics tags close the loop by telling you which topics need new content.

---

## 4. Architecture — DECIDED

### 4.1 Stack (deliberately boring, maximally reusing the source repos)

- **Monorepo, npm workspaces.** TypeScript everywhere. No Nx/Turbo — plain workspaces + root
  scripts, matching the scale.
- **`apps/server`** — one Express app (the pattern from `sat-homework/server/app.ts`: app export +
  thin `index.ts` listen bootstrap) that serves: the built SPA, the JSON API, the tldraw sync WS,
  and the ControlChannel WS. **One deployable service.**
- **`apps/web`** — one React 18 + Vite SPA: marketing/landing at `/`, app shell at `/app/*`,
  student surfaces at `/s/:token`, `/hw/:token`, `/review/:token`, live boards at `/b/:boardId`.
- **`packages/shared`** — types, lesson schema, problem schema, grading, brand constant.
- **`packages/ui`** — the design system (§8): tokens, primitives, app-shell components.
- **DB: Postgres on Supabase** (existing free project for dev; a new dedicated project for prod).
  Access via `pg` Pool + `DATABASE_URL` exactly as in sat-homework — **not** supabase-js for data.
  Schema applied idempotently on boot (the `82d2d63` pattern). Plain SQL migrations in `db/`.
- **Auth: Supabase Auth** for tutors only (email+password and Google OAuth). The server verifies
  Supabase JWTs (JWKS) in an Express middleware and maps `auth.uid` → `users` row → `org_id`.
  Students/guests never touch Supabase Auth — magic-link tokens as today. Rationale: rolling our
  own tutor auth is undifferentiated risk; Supabase Auth is free at this scale and already in the
  stack. RLS is **not** used (server-side `pg` with explicit `org_id` scoping in every query —
  simpler with the pool pattern, and enforced by a query-helper convention, §5.4).
- **Realtime: our own `ws` channels** (ControlChannel + tldraw sync), unchanged. This rules out
  serverless hosting; that trade was already made knowingly for the homework app.
- **Hosting: Render**, one web service, `render.yaml` blueprint. Dev on free tier; flip to Starter
  (~$7/mo) before any paying customer (cold starts are unacceptable in a paid product). Supabase
  connection **must use the session-pooler URL** on Render (§9.5).
- **Assets/files: Supabase Storage**, one bucket, keys namespaced `org/<orgId>/...` — board images,
  saved PDFs. TikZ SVGs stay as text in Postgres (current pattern, works).
- **Email: Resend** (free tier) for tutor auth emails beyond Supabase's built-ins and for optional
  assignment notifications (Phase 6; students without email simply don't get notified).
- **Payments: Stripe** Checkout + Billing customer portal + webhooks (§11).
- **Explicitly rejected:** Next.js migration (no benefit, breaks WS + porting economics), NestJS,
  tRPC/GraphQL (plain JSON routes as today), Prisma (plain SQL as today), any ORM, RLS-based
  tenancy, Vercel (WS), microservices.

### 4.2 Repo layout

```
tittel-platform/
  package.json            # workspaces: apps/*, packages/*
  render.yaml
  PLAN.md                 # this file
  db/
    schema.sql            # full idempotent schema (applied on boot)
    seed.dev.sql          # Konrad dogfood org + demo student + example content
  apps/
    server/
      src/
        index.ts          # listen() only
        app.ts            # express app assembly
        auth.ts           # supabase JWT middleware, org scoping, student-token resolver
        db.ts             # pool + query helpers (orgQuery, §5.4)
        boards/           # tldraw sync rooms + persistence + asset store  (from whiteboard server/)
        control/          # ControlChannel                                  (from whiteboard server/rooms.ts)
        content/          # ingest, validate, figures (tikz), lesson CRUD   (from sat-homework server/)
        assign/           # assignments, attempts, grading routes           (from sat-homework routes/)
        analytics/        # rollups, review-lesson generator
        billing/          # stripe checkout + webhooks
      test/               # smoke.mjs (WS), units.ts — ported + extended
    web/
      src/
        main.tsx, router.tsx
        marketing/        # landing page (§12)
        shell/            # authed app frame: sidebar, top bar, command palette
        students/         # roster, student record, timeline
        content/          # lesson builder, problem editor, bank, sets
        live/             # board page (tldraw), classes            (from whiteboard client/)
        assign/           # assignment creation, runner, portal, review (from sat-homework client/)
        analytics/
        settings/         # org, seats, billing, branding
  packages/
    shared/src/           # lesson schema, problem schema, grade.ts (unified), tokens, brand
    ui/src/               # design system (§8)
```

### 4.3 URL map

| Route | Who | What |
|---|---|---|
| `/` | public | Marketing/landing |
| `/try` | public | Free ephemeral quick-board creator (the current landing behavior) |
| `/login`, `/signup` | public | Tutor auth |
| `/app` → `/app/students`, `/app/content`, `/app/live`, `/app/assignments`, `/app/analytics`, `/app/settings` | tutor | The shell |
| `/b/:boardId` | tutor (authed) or link-holder (guest/student) | Live board. Tutor role comes from auth, **not** from a `#host` fragment (§6.3) |
| `/s/:studentToken` | student | Portal (assignments, results, boards, report) |
| `/hw/:attemptToken` | student | Runner |
| `/review/:attemptToken` | student | Post-submit review |
| `/api/*` | — | JSON API; `/api/tutor/*` JWT-gated, `/api/student/*` token-gated |

---

## 5. Data model

Conventions: `id` = nanoid text PKs (matches source repos), `created_at timestamptz default now()`
everywhere, **every tenant-owned table carries `org_id` with an index**, soft-delete via
`archived_at` where noted. Full DDL goes in `db/schema.sql`; this section is the authoritative
shape.

### 5.1 Tenancy & identity

```
orgs           (id, name, plan['trial'|'solo'|'studio'|'free'], trial_ends_at,
                stripe_customer_id, stripe_subscription_id, settings jsonb, created_at)
users          (id, org_id, supabase_uid unique, email, display_name,
                role['owner'|'tutor'], created_at)
students       (id, org_id, name, email nullable, portal_token unique,
                notes text, archived_at, created_at)
groups         (id, org_id, name, archived_at)               -- from sat-homework
group_members  (group_id, student_id, pk both)
```

### 5.2 Content

```
tags           (id, org_id, name, parent_id nullable)         -- topic taxonomy, org-local
problems       (id, org_id, type['mc'|'multi'|'numeric'|'text'|'frq'],
                stem_latex, choices jsonb, correct jsonb, accept jsonb,
                explanation_latex, figures jsonb,             -- ordered [{id,label?,svg}] (round-1 shape)
                difficulty int nullable, source text, archived_at, created_at, updated_at)
problem_tags   (problem_id, tag_id)
problem_sets   (id, org_id, title, description, template['neutral'|'sat'], archived_at)
set_problems   (set_id, problem_id, ordinal)                  -- JOIN TABLE: problems are reusable
lessons        (id, org_id, title, doc jsonb, version int, archived_at, updated_at)
lesson_tags    (lesson_id, tag_id)
```

Key change from sat-homework: problems are **first-class and reusable** (`set_problems` join),
not embedded in a set. Ingest of a legacy set JSON creates bank problems + a set referencing them.
`lessons.doc` is the existing whiteboard `LessonDoc` schema (`client/src/lesson/schema.ts`),
version-stamped; the builder (§6.4) reads/writes it, the board renders it — the schema itself
stays the generic dumb container it was designed to be, including the optional `answer`/`reveal`
fields from interactive-answers.

### 5.3 Assignments & attempts (port of sat-homework model + tenancy)

```
assignments        (id, org_id, set_id, title, time_limit_sec nullable,  -- null = untimed
                    due_at nullable, settings jsonb, created_by, created_at, archived_at)
assignment_student (assignment_id, student_id)
attempts           (id, org_id, assignment_id, student_id, attempt_token unique,
                    started_at, submitted_at, status['pending'|'active'|'submitted'|'expired'])
responses          (id, attempt_id, problem_id, answer jsonb, is_correct nullable,
                    marked_for_review bool, time_spent_ms int, change_count int)
```

Behavior ports unchanged: server stamps `started_at` on first open; server-authoritative timer;
autosave accumulates `time_spent_ms`/`change_count`; auto-submit on expiry; review only after
submit. Grading logic moves to `packages/shared/src/grade.ts` — **unify** the two existing graders
(sat-homework `server/grade.ts` and whiteboard `shared/grade.ts`); the whiteboard one is newer
(0.1% relative tolerance, fraction/unicode-minus handling, `accept[]`, rejects empty-string —
see §9.3 bugs). One grader, one test suite, used by both live quiz and homework.

### 5.4 Live teaching

```
classes        (id, org_id, name, slug unique-per-org,        -- stable join link /c/:org/:slug → active board
                mode['individual'|'large'], group_id nullable, archived_at)
boards         (id, org_id, title, class_id nullable, student_id nullable,
                snapshot jsonb nullable, snapshot_updated_at,
                lesson_id nullable, is_ephemeral bool default false,
                archived_at, created_at)
board_assets   (id, board_id, org_id, storage_key, mime, created_at)
sessions       (id, org_id, board_id, started_at, ended_at,
                participants jsonb,                            -- [{name, studentId?, joinedAt}]
                quiz_results jsonb nullable, pdf_storage_key nullable)
quiz_events    (id, org_id, session_id, student_id nullable, guest_name,
                qid, answer, is_correct, elapsed_ms, created_at)
```

`sessions` + `quiz_events` are what turns today's evaporating CSV into the student record: when a
live class ends (or the tutor clicks End Session), the server persists roster, quiz results, and
optionally the auto-exported PDF.

**Query convention (tenancy enforcement):** `db.ts` exports `orgQuery(orgId, sql, params)` which
refuses to run unless the SQL string contains an `org_id` placeholder, plus `studentQuery` keyed
by token. All route code uses these helpers; raw `pool.query` is lint-banned outside `db.ts` and
`migrate` code. This is the whole tenancy security model — keep it boring and total.

---

## 6. Feature specs by module

### 6.1 App shell & navigation (new)

Left sidebar (collapsible): **Home · Students · Content · Live · Assignments · Analytics ·
Settings**. Top bar: org switcher (hidden for solo), search/command palette (`Ctrl+K` — jump to
student/lesson/set; build on `cmdk`), "New" button (student / lesson / problem / assignment /
board). Student-facing surfaces (`/s`, `/hw`, `/review`, `/b` as guest) do **not** use the shell —
they are chromeless, calm, full-focus pages.

**Home** = today-centric dashboard: upcoming/active assignments with completion ticks, recent
sessions, students needing attention (overdue, or <60% on last assignment), quick actions. No
vanity charts.

### 6.2 Students module (upgrade of sat-homework tutor dashboard)

- Roster: add/archive students, groups (port), copy portal link, per-student notes.
- **Student record page (new, the keystone):** header (name, group, portal link) + tabs:
  - *Timeline* — merged feed: assignments (score, time), live sessions (attendance, quiz results),
    exported PDFs. Sourced from `attempts` + `sessions` + `quiz_events`.
  - *Mastery* — per-tag correct% and avg time across all attempts + live answers; trend arrows.
    This is computed by SQL rollup, no stored aggregates in v1.
  - *Work* — their persistent board(s), saved PDFs.
- **Report link (Phase 6):** `students.report_token` → read-only shareable progress page for
  parents. Same magic-link pattern, view-only, no PII beyond first name.

### 6.3 Live module (port of the whiteboard + persistence + identity)

Everything in §2.1 ports. Changes:

- **Host identity from auth, not URL fragment.** `/b/:boardId` — if the visitor's JWT resolves to
  a tutor in the board's org, they get host powers; otherwise they're a guest. The WS handshake
  for both the sync socket and ControlChannel carries a short-lived signed board token minted by
  the page load. The `#host` fragment dies. Guests keep the name-gate/animal-name behavior by
  class mode.
- **Persistence (new, opt-in per board).** `boards.is_ephemeral=false` boards snapshot to Postgres:
  on room idle-teardown and every 60s dirty-debounce, `room.getCurrentSnapshot()` → `boards.snapshot`;
  on first join, hydrate the `TLSocketRoom` from the snapshot. Uploaded images go to Supabase
  Storage (`board_assets`) instead of the in-memory asset store when the board is persistent; the
  in-memory store remains for ephemeral boards. Guard: snapshots >5MB → refuse with a friendly
  "board too heavy, export + start a page" toast (revisit if hit in practice).
  The **free `/try` quick-board stays fully ephemeral** — it is the current public product,
  unchanged, and doubles as the demo.
- **Classes.** A class = stable slug link + mode + optional roster (group). "Start class" spins up
  (or resumes) the class board and opens a `sessions` row; students join via the stable link all
  semester. Joining students pick their name from the class roster (fuzzy match to `students`) or
  type one (guest) — this is how live quiz results attach to real student records. End-of-session:
  persist participants + quiz results; offer PDF export which also saves to storage.
- **Lesson loading from library** (replaces file upload): host picks from `lessons`; injection
  pipeline unchanged (deterministic IDs, idempotent). Keep file upload as a secondary "Import
  JSON" path.
- Interactive answers, stats panel, reveal/reset, timer, games, free reign, write grants: port
  unchanged, restyled. Quiz results now also stream to `quiz_events` on close/end-session.

### 6.4 Lesson builder (new — closes gap #1)

In-app visual editor at `/app/content/lessons/:id/edit`, producing `LessonDoc` JSON. **Not** a
freeform canvas — a structured block editor that mirrors the schema exactly:

- Left: page list (add/reorder/rename pages). Center: vertical block stack for the current page.
  Right: inspector for the selected block.
- Block palette = the schema's types, nothing more: heading, text/markdown, LaTeX problem, image,
  and (from the bank) **embedded problem** — inserting a bank problem stamps its stem/figures into
  a latex block + wires the `answer` key for live quiz collection.
- Live preview: KaTeX render as-you-type (reuse `lesson/render.ts` machinery client-side);
  per-block `spacingAfter` shown as a draggable gap ("workspace" affordance).
- Inspector fields: block kind (presentational), spacing, maxWidth, `answer` (format/key/accept/
  choices), page `reveal` policy.
- Save = versioned write to `lessons` (optimistic lock on `version`). "Duplicate lesson",
  "Import JSON" (existing files), "Export JSON" (portability, no lock-in).
- **AI assist is deferred to v2** (§13) — the builder must be excellent manually first.

Acceptance bar: Konrad can build next week's real lesson start-to-finish in the browser with no
text editor, and it renders on a board pixel-identical to today's file-based path.

### 6.5 Assignments module (generalized homework)

- **Question types:** `mc` and `numeric` (today's `grid`) port as-is; add `multi` (multi-select MC
  — grade = exact set match) and `text` (short answer, case/whitespace-insensitive literal match +
  `accept[]`). **`frq`** (free response, tutor-marked with rubric note) is Phase 6 — schema now,
  UI later. No CAS/algebraic-equivalence grading in v1 (deferred, §13 — it's a tarpit).
- **Runner = engine + skins.** Extract the runner's logic (attempt lifecycle, autosave, timing,
  nav, eliminator, mark-for-review) from its chrome. Two skins ship:
  - *Bluebook* (SAT template): current look preserved faithfully — header, centered timer,
    reference sheet, grid-in rules, Desmos.
  - *Neutral* (default): same engine, Slate design language (§8), optional timer, optional
    calculator, no SAT reference sheet (per-set attachment slot instead).
  `problem_sets.template` picks the skin.
- **Assignment creation:** pick set → pick students/groups (chips, port) → due date (new, optional)
  → time limit (now optional; untimed assignments show elapsed, not countdown) → creates attempts
  + links as today. Copy-link per student; optional email notify (Phase 6).
- **Problem editor (new):** form editor for a bank problem — stem LaTeX with live KaTeX preview,
  choices, answers + accept list, explanation, tags, difficulty, TikZ figure sub-editor that calls
  the server to render (serial mutex, §9.4) and previews the SVG. The existing JSON ingest becomes
  "Import problems (JSON)" using the documented schema (`docs/PROBLEM-SET-SCHEMA.md` ports into
  this repo's docs); the authoring-in-a-separate-project workflow keeps working.
- Attempt spine, portal, review: port with tenancy + restyle. The portal `/s/:token` gains the
  student's boards and (Phase 6) the report view.

### 6.6 The seam, made seamless (closes gap #2)

Replace file-download lesson export with server-side one-click flows:

1. From assignment analytics: select problems (or accept the auto-selection: most-missed +
   slowest) → **"Draft review lesson"** → server runs the existing `lessonExport.ts` transform →
   inserts a `lessons` row titled "Review — <assignment> — <date>" → toast links straight to the
   builder for tweaks → "Open on board."
2. From a live session's quiz stats: same button, sourced from `quiz_events`.
3. From a board: "Save PDF to records" stores the export against the session/student in addition
   to downloading.

The transform already exists and is tested; the product work is wiring + the auto-selection
heuristic (missed by ≥40% of assignees, or top-quartile time — tune later).

### 6.7 Analytics module

Port the per-assignment analytics (per-problem correct%/avg time, most-missed, slowest, hardest,
per-student breakdown) into the new shell. Add org-level views, all SQL rollups:

- Per-tag mastery matrix (students × tags, correct% heat), filterable by group/date range.
- Per-student trend (score and pace over attempts).
- Live-class engagement (from `quiz_events`: participation rate, first-attempt correct%).

Every analytics surface has the "Draft review lesson" affordance where a problem subset is
visible. Charts follow §8 rules (and the dataviz skill at build time).

### 6.8 Onboarding (new, decisive for conversion)

Signup → create org → **seeded demo content** (one demo student, one sample problem set with
figures, one sample lesson — from `seed` fixtures) → 3-step checklist on Home: "Add a real
student · Try the board (opens a demo lesson live) · Assign the sample set." A tutor must reach
the aha (live board + a graded attempt) in under 10 minutes without documentation.

---

## 7. What happens to the existing repos

- **Whiteboard (public):** stays live and free at its current URL — it's the funnel and Konrad's
  fallback tool. After Phase 4 ships, add a small "Slate — the full tutoring platform" link to its
  landing page. No other changes; do not retrofit tenancy into it.
- **sat-homework (private):** Konrad keeps using it for real students until Phase 5 is verified,
  then: one-time migration script (`apps/server/src/tools/import-legacy.ts`) copies students,
  problem sets (splitting problems into the bank), assignments, attempts, responses into his
  platform org, preserving portal/attempt tokens so existing student links keep working (tokens
  are unique text — collisions with nanoid-fresh rows are practically impossible). Then the old
  service is retired; repo archived.

---

## 8. Design system — "Slate" visual language (closes gap #3)

The current apps look default because nothing was specified. This section is the specification;
the executing model must treat it as binding, not inspirational.

### 8.1 Aesthetic thesis

**Quiet academic.** Paper, ink, one confident accent. The product should feel like a beautifully
typeset problem set, not a startup dashboard. Calm surfaces, generous whitespace, typography does
the talking, math always renders beautifully.

**Ban list (hard):** blue-purple gradients; glassmorphism/backdrop-blur cards; emoji as UI icons;
default-shadcn gray-card-grid look; `rounded-2xl`-everything; drop shadows heavier than the two
elevation tokens; more than one accent color; skeuomorphic textures; bouncy/springy animation.

### 8.2 Tokens (implement as CSS variables in `packages/ui/src/tokens.css`)

- **Color — light theme (primary):**
  - Surfaces: `--bg: #FAF9F6` (warm paper), `--surface: #FFFFFF`, `--surface-2: #F1EFEA`.
  - Ink: `--ink: #1A1A1A`, `--ink-2: #52525B`, `--ink-3: #A1A1AA`.
  - Lines: `--line: #E4E2DC` (borders carry depth; shadows are secondary).
  - **Accent: deep pine `--accent: #1E5C48`**, hover `#174A3A`, wash `#E8F0EC`. One accent. Links,
    primary buttons, active nav, focus rings.
  - Semantic: correct `#1E7F4F`, incorrect `#B4372F`, warning `#B87A1E`, info = accent. Muted
    washes of each for row highlights.
  - Dark theme: same hue relationships on `#141412` ground; ship it for the board and runner at
    minimum (students at night), shell can start light-only.
- **Type:**
  - Display/headings: **Fraunces** (self-hosted woff2) — gives the editorial, non-AI feel.
  - UI/body: **Inter** (self-hosted), `font-feature-settings: "tnum"` on every numeric/statistic.
  - Math: KaTeX default (Computer Modern) — it already looks right; never restyle it.
  - Scale: 13/14/16/18/22/28/36 px, line-height 1.5 body, 1.2 headings. UI chrome at 14.
- **Space & shape:** 4px base scale (4·8·12·16·24·32·48·64). Radius: 6px controls, 10px
  cards/modals, never larger. Elevation: `--shadow-1: 0 1px 2px rgb(0 0 0 / .06)`,
  `--shadow-2: 0 4px 16px rgb(0 0 0 / .10)` — nothing else.
- **Motion:** 150ms `cubic-bezier(.2,.8,.4,1)` for micro (hover, toggle), 220ms for
  panels/modals. Respect `prefers-reduced-motion`. The Nim win-celebration is the one licensed
  exception to restraint.
- **Icons:** Lucide, 16/20px, `stroke-width: 1.75`, `--ink-2`.

### 8.3 Implementation — DECIDED

**Tailwind CSS v4 + Radix UI primitives + the token sheet above** (tokens as Tailwind theme
values). Rationale: Sonnet-class models are most reliable in Tailwind; Radix gives accessible
dialogs/menus/popovers without visual opinions; tokens prevent default-Tailwind-blue drift.
`packages/ui` exports: `Button` (primary/secondary/ghost/danger), `Input/Field`, `Select`,
`Dialog`, `Popover/Menu`, `Tabs`, `Table` (dense, tabular-nums, sticky header), `Toast`, `Badge`,
`EmptyState` (every list has a designed empty state with one CTA), `StatTile`, `Shell`
(sidebar/topbar). tldraw and KaTeX keep their own styles; the board page themes tldraw chrome
minimally (accent + font) and no more.

### 8.4 Surface-specific notes

- **Runner (neutral skin):** chromeless, centered 720px column, question type set in the reading
  sizes (16–18px), answer choices as full-width quiet cards with a crisp selected state (accent
  border + wash, no fill-flood). The Bluebook skin ignores all of this by design — fidelity wins.
- **Board:** tutor dock and panels (stats, roster, calc) restyled to tokens: white cards,
  `--line` borders, `--shadow-2`, 10px radius. Student view stays minimal — nothing between them
  and the canvas except the name gate (which should be *beautiful*: centered card on paper bg,
  Fraunces heading, one input, one button).
- **Marketing page (§12) is the design system's showpiece** — build it after the tokens exist,
  never from scratch styles.
- **Density rule:** tutor surfaces are information-dense (tables, tabular numbers, 14px);
  student surfaces are calm and large (16–18px, one thing at a time).

---

## 9. Gotcha ledger — read before porting (each of these cost real time)

1. **tldraw read-only cannot be set client-side under `@tldraw/sync`.** The sync layer's
   `collaboration.mode` re-asserts instance state and clobbers `updateInstanceState({isReadonly})`.
   Write-locking works by **pinning non-granted students to the 'hand' tool** via a tldraw
   `react`+`atom` (pan/zoom still work; no shape create/select). Grants flip the atom and hand
   back 'select'. Port this mechanism verbatim (`Board.tsx`).
2. **Desmos sync loop prevention = interaction-gated broadcasting only.** Desmos
   getState/setState is non-idempotent (post-setState it keeps mutating: recomputed values,
   sliders, animations), so content-diffing **never settles**; `setTimeout(0)` guards fail because
   'change' fires async. The working fix: only broadcast within ~1.5s of a genuine local DOM
   interaction on the Desmos container. Two failed alternatives are documented history — do not
   "simplify" this.
3. **Interactive-answers invariants:** answer keys never reach student clients (keys travel
   host→server; shape `meta.q` carries only `{id, format, choices}` because `meta` is synced and
   devtools-readable). No custom tldraw shapes for inputs (would sync keystrokes to the class and
   require server schema registration) — the overlay uses `InFrontOfTheCanvas`, which renders in
   **screen space** (replicate the camera transform by hand: `scale(z) translate(x,y)` on a 1×1px
   absolute wrapper); `OnTheCanvas` is camera-transformed but paints under shapes. Overlay inputs
   must `stopPropagation` on pointer/key events or tldraw fires tool shortcuts. Shape `meta` is
   `JsonObject` — omit optional fields, never store `undefined`. Question gating is a runtime
   tutor action (server-held open-set; server rejects answers for closed qids) — never a schema
   property. `quiz-open` echoes to hosts too and replays on host reconnect (host-local state
   drifts). Elapsed timing is **fragile and layered** (student `seenAt` → server `quizOpenedAt` →
   `Date.now()`); `quiz-seen` must stay batched per page render (per-question sends tripped the
   10/s guest rate limiter and silently zeroed a third of the class's times). Any change here
   needs a smoke assertion `elapsedMs > 0`, not `>= 0`. Grader: reject empty answers first
   (`Number('') === 0` graded blank as correct once); coerce numeric keys authored as JSON numbers.
4. **node-tikzjax (1.0.5):** use `import pkg from 'node-tikzjax'; const tex2svg = pkg.default` —
   the named `tex` export crashes. Wrap input in `\begin{document}...\end{document}`. **Renders
   must be serial** (keep the ingest mutex); ~460ms/figure. Only bundled packages (pgfplots,
   tikz-cd, circuitikz, chemfig, amsmath, amssymb, array…).
5. **Supabase from Render must use the session-pooler `DATABASE_URL`** (the direct
   `db.<ref>.supabase.co` host is IPv6-only on free tier → ENOTFOUND). Locally the same applies on
   this machine. SSL on for non-local. Apply `schema.sql` on every boot (idempotent), not via a
   manual migrate step.
6. **Testing in this environment:** no installable browser — Playwright can't run. Verification =
   typecheck + `vite build` + headless Node smoke tests over real WS (`test/smoke.mjs` pattern).
   When asserting on join-time frames use the `openWithInbox(url)` helper — attaching `message`
   listeners after `await open()` loses frames that share the upgrade's TCP segment (~1-in-3
   flake). On Windows, `pkill -f tsx` does **not** match (`node.exe`): kill via
   `netstat -ano | grep :PORT` + `taskkill //PID <pid> //F`, and assert the fresh server printed
   "listening" before trusting a run (a stale server once silently tested old code). Anything
   canvas-visual gets an explicit "Konrad browser-check" list at phase end.
7. **KaTeX lesson blocks render via KaTeX→HTML→PNG @3x** (html-to-image), not SVG — raster is the
   reliable path for mixed prose+math. The capture node must not itself be offscreen-positioned
   (`left:-99999px` on the captured node produced blank blobs; offset a wrapper instead). PDF
   export = per-page PNG via `editor.toImage` at pixelRatio 2, PDF pages sized to content aspect.
8. **tldraw `currentPageId` is per-session and does not sync** — page-follow rides the
   ControlChannel (existing `pageSync`), and a following student's self-initiated page change is
   snapped back via a session-scope `store.listen`. Sync package versions must **exactly** match
   the tldraw version (all pinned 3.15.5; upgrade all-or-none, and only deliberately).
9. **Stale-deps effects around `useValue`-derived state are the local bug pattern** — a tldraw
   `useValue` keeps its reference, so effects keyed on it don't re-run when a *different* atom
   (e.g. `openQids`) changes; the failure is a plausible wrong number, not a crash. Review every
   ported effect's dep list against what it actually reads.

---

## 10. Build phases

Rules: phases ship in order; each ends deployed to Render, typechecked, built, smoke-tested, with
a short "Konrad browser-check" list. Konrad's real tutoring moves onto the platform at Phase 5.
Estimates are calendar-honest for a Sonnet-class executor working in long sessions.

### Phase 0 — Foundation (repo, deploy, design system)
Monorepo scaffold (workspaces, shared tsconfig, dev scripts with side-by-side ports — client 5373 /
server 6060, offset from both existing apps); `db/schema.sql` v1 + boot-apply + dev seed; Express
app + health route; Vite SPA with router; **`packages/ui` tokens + core components + Shell**;
Supabase Auth wired (signup/login/logout, JWT middleware, org bootstrap on first login);
render.yaml; smoke-test harness ported.
**Accept:** deployed URL serves the shell behind login; a new signup lands in an empty org styled
per §8; `npm run typecheck && npm run build && npm test` green.

### Phase 1 — Students & content data layer
Students CRUD + groups + portal tokens; tags; problem bank (schema + list + **problem editor**
with KaTeX preview + TikZ render endpoint); problem-set composer (`set_problems`); JSON import
(port ingest/validate/figures onto bank+sets); lessons table + JSON import/export.
**Accept:** Konrad imports his real problem-set JSONs and an existing lesson file; edits a problem
in-app; composes a new set from bank problems.

### Phase 2 — Assignments engine (port of sat-homework core)
Attempt spine, unified grader in `packages/shared` (with the full test suite from both repos),
runner engine + **both skins**, portal, review, assignment creation with due dates/untimed mode.
Legacy-import tool written (not yet run for real).
**Accept:** end-to-end on prod: create assignment → student link → timed attempt with autosave →
auto-submit → review → analytics rows exist. Bluebook skin visually indistinguishable from the
current app (Konrad check).

### Phase 3 — Live boards (port of the whiteboard)
Board server (sync + ControlChannel) mounted in `apps/server` with auth-derived host role and
board tokens; ephemeral `/try` path; **persistent boards** (snapshot hydrate/save, storage-backed
assets); board page with all ported features: camera/page follow, calc, free reign, write grants,
lesson load **from library**, quiz overlay + stats, timer, games, PDF export.
**Accept:** smoke suite covers join/replay/persistence round-trip; Konrad two-window check list
(the standing one from memory: answer-box positioning across zoom, shield behavior, stats panel,
CSV, calc swap — plus snapshot resume after server restart).

### Phase 4 — Lesson builder + the seam
Visual builder (§6.4); "Draft review lesson" from assignment analytics and from session quiz
results; "Open on board"; session persistence (`sessions`, `quiz_events`, end-of-class save,
PDF-to-record).
**Accept:** the full loop demo — assign set → results → one click → review lesson in builder →
open on board → collect live answers → student record shows both. This is the product's demo
script; record it.

### Phase 5 — Student record, analytics, classes — **dogfood cutover**
Student record page (timeline, mastery, work); analytics module (§6.7); classes with stable links
+ roster name-matching + attendance. Run the legacy import for Konrad's real data; retire the old
homework service; Konrad teaches a real week entirely on the platform.
**Accept:** legacy students' old portal links still work; a real group class runs start-to-finish;
Konrad signs off on data fidelity.

### Phase 6 — Billing, onboarding, hardening
Stripe (checkout, webhooks, trial → paywall, customer portal, plan gates: seats only — features
stay ungated); onboarding flow + demo seed content; email notifications (Resend, optional);
parent report link; `frq` marking UI; rate limits on token endpoints; backups verified
(Supabase PITR / pg_dump cron); error tracking (Sentry free tier); privacy policy + ToS pages
(§12.2).
**Accept:** a stranger can sign up, trial, hit the paywall, pay with a test card, and get
receipts; Konrad's org marked complimentary.

### Phase 7 — Marketing site + Studio + launch polish
Landing page (§12) on the design system with live demo board embed; Studio seat management
(invite tutor by email, per-tutor content visibility default = org-shared); dark theme for
board/runner if not done; final name/domain swap via the brand constant; performance pass
(route-level code splitting — tldraw, Desmos, KaTeX already lazy-load; keep it that way).
**Accept:** Lighthouse ≥90 on landing; a second real tutor (Yale recruit) onboards without help.

---

## 11. Billing details

- Stripe Products: `solo_monthly`, `solo_yearly`, `studio_monthly`, `studio_yearly`; single
  founding-tutor coupon. Checkout hosted by Stripe; webhook updates `orgs.plan` +
  `stripe_subscription_id`; grace state on failed payment (7 days read-only warning banner, then
  tutor surfaces lock — **student links never break**, even on lapsed plans; that's a trust
  guarantee).
- Trial: 30 days full-featured from org creation, no card required. Trial-end → soft lock (read +
  export allowed, create/assign blocked) — never hold student data hostage.
- Keep every plan gate in one module (`apps/server/src/billing/gates.ts`).

## 12. Marketing site & legal

### 12.1 Landing (`/`)
Hero: the closed loop in one sentence + a **live embedded demo board** (ephemeral room, seeded
lesson — we uniquely can do this because the free board is real). Sections: live teaching / homework
runner (Bluebook screenshot) / the loop (assign→analyze→review lesson) / group classes / pricing /
the 650→760 story. Footer: privacy, terms, contact. All §8 tokens; Fraunces display; zero stock
illustrations — screenshots of the real product only.

### 12.2 Legal & privacy (v1-appropriate, not enterprise theater)
Plain-language privacy policy + ToS (draft from a template, Konrad reviews): we store student
names, optional emails, and performance data on behalf of the tutor (data controller = tutor);
no ads, no resale; deletion on request; org data export (JSON) self-serve — this also serves
no-lock-in marketing. COPPA note: tutors attest students are 13+ or have parental consent
(SAT/math-tutoring skew makes this near-universal). FERPA does not generally bind private tutors —
don't claim compliance, do claim the practices. Secrets in env only; tokens are 24-char nanoid
(~142 bits) — rate-limit token-bearing endpoints anyway (Phase 6).

## 13. Explicitly deferred (v2+ candidates, in rough priority order)

1. AI assist (Claude API): problem generation into the bank, explanation drafting, lesson
   auto-draft beyond the heuristic review-lesson.
2. Built-in video (LiveKit) — revisit after 10 paying tutors ask.
3. Algebraic-equivalence grading (CAS: mathjs/compute-engine) — tarpit, needs real demand.
4. More games (registry is ready); assignable/async games.
5. Content marketplace / shared template gallery across orgs.
6. Live speed-round mode (phase-2 idea from the homework repo — the runner + ControlChannel
   patterns make this cheap later).
7. Per-student live work pages on boards (explicitly deferred earlier; off-board independent work
   is the locked default).
8. Scheduling/invoicing integrations; LMS export; mobile apps (responsive web must suffice —
   runner and portal get a responsive pass in Phase 2, board stays desktop-first with stylus-OK).
9. Handwriting/stylus-first student input, tablet board mode.

## 14. Costs & licensing (action items, some blocking launch but none blocking build)

- **tldraw license:** the sync/watermark license for a commercial product — check current terms
  and price at tldraw.dev **before charging money**; budget for the business tier. The watermark
  is fine during build/dogfood. (`VITE_TLDRAW_LICENSE_KEY` slot already exists.)
- **Desmos API key:** production key via Desmos' API program (free for many edu uses, but the
  demo key is not for production) — apply early, it can take time. Env slot exists.
- Fonts: Fraunces (OFL) + Inter (OFL) — free, self-host.
- Infra at launch: Render Starter ~$7–25/mo, Supabase Pro $25/mo when limits bite, Resend free,
  Sentry free, domain ~$15/yr, Stripe 2.9%+30¢. Total < $60/mo before revenue — fine.

## 15. Questions only Konrad can answer (none block Phase 0–2)

1. Final product name + domain (build proceeds on the brand constant).
2. Price points sign-off (§1.3) before Phase 6 Stripe setup.
3. tldraw + Desmos licensing sign-off before first paid customer (§14).
4. Whether Studio (multi-tutor UI) makes v1 launch or slips — schema supports either; Phase 7
   scopes it, cut it freely if launch timing matters.
5. Legal review appetite: template policies vs. a real lawyer pass.

---

*Change log: 2026-07-12 — initial version (Fable 5).*
