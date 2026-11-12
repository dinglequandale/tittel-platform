# OVERHAUL — from working prototype to a publishable product

**Written:** 2026-10-20. **Supersedes:** PLAN.md §8 (design system) and the Claude Design handoff in
`Tutoring app UI design-handoff/` (the pine/Fraunces "quiet academic" look). Everything else in
PLAN.md (architecture, data model, gotcha ledger §9) still applies.

**Design reference:** `C:\Users\konra\tittel-tutoring\website\tutoring\` (`styles.css`, `site.js`,
`graphics.js`). This is the visual language to carry into the app: playful and kinetic, but
professional and sleek. Read those three files before any UI work.

---

## 0. Where things actually stand

*Written 2026-10-20. The last column records what changed by 2026-11-12; LAUNCH.md has the current plan.*

The git log reads "Phase 3 (part 1)" followed by fix passes A–G. **Phases 4–7 of PLAN.md have not
been built.** On top of that, there is an uncommitted UI pass that implements the pine prototype
(real-data Home, Analytics, and Settings pages; restyled Students, Content, and Live). It
typechecks.

| Area | State (2026-10-20) | Gap to "publishable" | Now (2026-11-12) |
|---|---|---|---|
| Landing `/` | 20-line stub | The whole marketing site | Lean landing: hero, one paragraph for math/SAT tutors, three screenshots, sign up (L4) |
| App shell | Works. Search box is a fake `<span>`. "New" only links to Content. Display name comes from the email's local part | Command palette, a real New menu, a real display/org name | Real search and New menu; names come from onboarding and Settings. No command palette |
| Home | Uncommitted. Real counts and an onboarding checklist | "Needs attention" signals (scores, overdue), recent sessions | "This week" (FLOW-SPEC F1): lessons, needs attention, calendar inbox. Onboarding moved to `/welcome` |
| Students | Roster, groups, portal/board links | **Student record page** (timeline, mastery, work) does not exist | Student page at `/app/students/:id`. No mastery view |
| Content | Problem bank, sets, tags, AI import. Lessons = JSON import plus a raw JSON `<pre>` | **Lesson builder** does not exist | Library; lesson plans from a PDF, typed text or AI import, with answer boxes |
| Live / board | Sync, camera/page follow, calculator, timer, free reign, write grants, PDF export | **Quiz answer overlay, stats panel, lesson loading, and games are not ported** (`BoardCanvas.tsx:35`). These are the product's differentiators | Own engine on Yjs (tldraw removed, BOARD-SPEC §16). Answer overlay, stats panel, lesson and PDF loading ported. Games not ported |
| Runner | Answer, autosave, timer, submit | **SAT-style skin deferred**: no Desmos, reference sheet, or eliminator. SAT is the flagship GTM vertical | Graphing calculator and reference sheet. No eliminator or section timing |
| Portal / Review | Functional | Design, mobile layout, a results moment | Restyled; "made with" footer; checked at 375px (L4) |
| Analytics | Four stat tiles and completion bars | Per-tag mastery, trends, "Draft review lesson" | Insights: overview, homework gradebook, hours. No per-tag mastery |
| Settings | Email and sign-out | Org name, profile, billing, data export, account deletion | Workspace and display name, parent templates, calendar, data export, workspace deletion. No billing |
| Seam (assign → analyze → review lesson → board) | Not built | The product's core demo | End lesson → results → follow-up homework → parent update (O3) |
| `sessions` / `quiz_events` | `sessions` row inserted on class start. `quiz_events` never written | End-of-class persistence | Board answers kept in `quiz_events` (`lib/lessonRecord.ts`) |
| Billing / onboarding seed / email / legal | None | All required to charge money | Sample student and `/welcome` built; legal drafts with gaps (DEPLOY.md §6); billing is a Payment Link, not built |
| Password reset / Google sign-in | None | Required | Built; untested against the real Supabase project |
| Board assets | In-memory (lost on restart) | Supabase Storage for persistent boards | In the database (`board_assets` → `files`); survive restarts (tested) |
| Security | DB TLS `rejectUnauthorized` TODO | Must fix before paying customers | `DATABASE_CA_CERT` supported; default stays unverified until a real connection is confirmed |
| Responsiveness | 3 media queries in the whole app, 0 in `board.css` | Portal, runner, and review must work on phones | Student pages and signup checked at 375px (L4) |
| Tests / CI | `smoke.mjs` + grader unit test. No CI | CI on push. Browser tests are now possible (see §6) | CI on push (passing). Signed-in API suite on a PGlite stack in `npm test` |
| Meta | `<title>Slate</title>`, no favicon, no OG tags | Brand meta | Favicon ∎ added. Title still hard-coded, no OG tags |

Stray files: `output.png` in the repo root is an unrelated diffusion-components plot, so delete it
or move it out. `Tutoring app UI design-handoff/` is superseded and should not be committed.

---

## 1. Design direction: what transfers, and what doesn't

The website works because of **contrast**: a stark, nearly monochrome editorial base (white paper,
near-black ink, heavy tight geometric sans) with **brief, bright bursts of mathematical play**
(the scramble, math objects standing in for letters, the ∎, springy pops). The play is short,
plays once, and then gets out of the way. That is the rule to carry over:

> **Moments, not wallpaper.** Tutor work surfaces (tables, editors, the board) stay quiet, dense,
> and fast. Delight goes where emotion already is: first impressions, empty states, onboarding,
> completions, scores, wins. Every animation plays once per trigger, finishes in under ~1s, and is
> fully disabled under `prefers-reduced-motion`.

| Website element | In the app |
|---|---|
| White paper, ink, hairline rules, no shadows | **Yes, everywhere.** Replaces the warm `#FAF9F6` and pine |
| Outfit, heavy weights, `-0.035em` tracking on display | **Yes.** The UI and display face |
| EB Garamond *italic 700* for emphasis words | **Yes, sparingly.** Emphasis inside headings and copy only ("3 students *need you* today"). Never UI labels |
| Five-colour math palette (blue, mint, gold, coral, pink) | **Yes, as categorical colour**: tags, groups, avatars, step numbers, chart series. Not as button colours |
| Black pill button, coral on hover | **Yes** for primary buttons (see the contrast note in §2.1) |
| ∎ coral square (logo `.q`, heading terminator, favicon) | **Yes, the brand device**: wordmark, favicon, loader, "submitted ∎", end of page titles |
| Scramble-in headings with one letter swapped for a math object | **Landing: full.** In the app, **only on student/parent surfaces** (portal greeting, board name gate, session summary). **Never in tutor chrome** (§8, R1) |
| Hero headline scramble (2.6s) | **Landing only** |
| Number flip (π ∑ √ → 1) | **Yes**: onboarding steps, stat tiles on first load, score reveal on Review |
| Rise-in with bounce (`.reveal`) | **Yes** for first render of cards and lists, staggered, capped at ~8 items |
| Blur-in words (bio) | Landing only |
| Collage cards (Pythagoras, Euler, sine sheet, Penrose) | Landing, auth pages, 404, empty states |
| Custom cursor dot | **Landing only.** Never in the app: it fights tldraw's cursors and is an accessibility cost |
| Fixed corner nav | Landing only. The app keeps a sidebar |
| `h2.sh:hover` object spin, `.steps li:hover` tilt | **Yes**: cheap hover delight on headings, nav icons, and empty-state art |

---

## 2. Design system spec (replaces PLAN.md §8)

Implement in `packages/ui/src/tokens.css` + `components.css`. The uncommitted pages mostly use
`var(--…)` tokens, so **a token swap restyles most of the app in one move**. Do that first, then fix
what's left.

### 2.1 Colour

```
--paper:  #FFFFFF   (bg)          --ink:   #0F0F0F
--paper-2:#F6F6F4   (sidebar, wells) --ink-2: #5F625F (= site --muted)
--rule:   #E6E6E3                  --ink-3: #6F726F   --ink-4: #9A9C99 (decorative only)
--coral:  #FF4F12   brand / hover / ∎
--blue:   #2140E8   links, focus ring, info. Text-safe (7.1:1 on white)
--mint:   #2FC48D   --gold: #F2B705   --pink: #E0559A   (categorical only)
```

**Contrast is the one place the website can't be copied literally.** White on coral is ~3.3:1, so
it fails WCAG AA for normal text. That covers the site's own button hover. Mint (~2.2:1) and gold
are worse. Rules:
- Palette colours are **fills and graphics**. When text sits on them, use ink, not white.
  **DECIDED:** primary button = ink pill with white text; hover = `--coral-strong: #D93A00`
  (4.6:1) with white text. Text colour never flips on hover. `#FF4F12` stays for the ∎,
  graphics, and fills that carry no text.
- Each palette colour gets a `-text` variant (darkened, ≥4.5:1) and a `-wash` (~12% tint) for
  badges and row highlights.
- **Semantic colours must not collide with brand colours.** Coral can never mean "wrong."
  `--correct: #12805A` (deep mint, 4.9:1), `--incorrect: #D4183D` (5.3:1) (the site's `C.red`, distinct from
  coral), `--warning: #8A6200` (deep gold, 5.5:1). All checked against white.
- **As built in O1:** `--ink-3` became `#6F726F` (4.9:1 on white, 4.5:1 on paper-2), so its many
  meta-text uses pass AA without edits. The old grey (`#9A9C99`, 2.8:1) survives only as `--ink-4`
  for decorative or disabled marks, never text.
- Semantic colours drop to ~4.1:1 on their own 14% washes (badges, avatars). Text on a wash uses
  `--correct-ink #0E6B4B`, `--incorrect-ink #B3122F`, or `--coral-ink #B83200` (all ≥5.1:1).
  Before O1 the badges failed AA.
- Dark theme: defer for the shell. Runner and board dark can come later (PLAN §8.2 still applies to
  those).

### 2.2 Type

- **Outfit** (variable 300–900) for UI and display. **EB Garamond Italic 700** for emphasis. Both
  are OFL. **Self-host** the woff2 in `packages/ui/src/fonts/` (the site uses the Google CDN; the app
  must not). Fraunces and Inter were deleted in O1.
- Display (page titles, landing): 600, `letter-spacing: -0.035em`, `line-height: 0.86` for
  multi-line hero type, lowercase for scrambled section headings (site convention).
- UI: 14px chrome, 15–16px body, 18px+ on student surfaces (PLAN's density rule stands).
- **Numbers (verified in O1 with fontTools):** Outfit ships `tnum`, but its digits are
  proportional by default. Anything that sits in a column or ticks (tables, timers, stats, rings)
  needs `font-variant-numeric: tabular-nums` (the `.num` class). Timers that jitter look broken.
- KaTeX stays Computer Modern. Never restyle math.

### 2.3 Shape, space, elevation

- Buttons: pill (`999px`). Inputs: 10px. Cards and frames: 12px. Small chips and step numbers:
  6px squares (the site's `.num`).
- Borders carry depth: hairline `--rule`. Shadows only on floating layers (menus, dialogs, board
  panels): `0 8px 30px rgb(0 0 0 / .08)`.
- Spacing keeps the 4px scale, with more air than now: section gaps 48–64px on overview pages.

### 2.4 Motion tokens

```
--ease-spring: cubic-bezier(.2, 1.45, .4, 1)   reveals, pops (site .reveal)
--ease-pop:    cubic-bezier(.2, 1.6, .4, 1)    numbers, hovers (site .num)
--ease-out:    cubic-bezier(.2, .8, .4, 1)     functional transitions
--dur-micro: 150ms   --dur-pop: 300ms   --dur-reveal: 650ms   stagger: 70ms
```
Functional transitions (menus, dialogs, tabs) use `--ease-out`. **Never spring a dialog.** Spring
is for celebratory and entry moments only. One global reduced-motion kill-switch already exists in
`tokens.css`; keep it.

### 2.5 Primitives to build in `packages/ui` (React ports of `site.js` / `graphics.js`)

1. `MathArt`: `graphics.js` objects, thumbs, and cards as typed SVG components. Fix the duplicate
   gradient `id`s (`pt-g`, `di-g`, …) with `useId()`, or multiple instances on one page break.
2. `<Scramble text obj at>`: the heading scramble from `site.js` `headingScript`/`buildHeading`.
   It must lock slot widths (as the site does) so layout never shifts. Accessible name goes on the
   element; animated spans are `aria-hidden`. Used on landing and student/parent surfaces only.
3. `<FlipNumber value>`: glyph flip π ∑ √ → final value (from `flipNumbers`).
4. `<Reveal stagger>`: rise-in on first intersection.
5. `<QedLoader>`: the ∎ square cycling palette colours with a pop. Replaces every "Loading…" and
   spinner. `PageLoading` uses it.
6. `<Wordmark>`: product name + coral ∎, with the site's typed logo intro on landing and auth only.
7. Restyle the existing primitives (`Button`, `Badge`, `Field`, `Dialog`, `Tabs` → site-style pill
   tabs, `Table`, `StatTile` → uses `FlipNumber`, `EmptyState` → takes a `MathArt` piece).

### 2.6 Hygiene that makes restyling cheap

- The uncommitted pages carry ~80 inline `style={{…}}` blocks (Home 24, Assignments 17, Runner 16).
  Move repeated ones into component classes. Otherwise every design tweak is a grep-and-pray.
- Tailwind v4 is installed but used in only ~13 places (mostly the Landing stub). **DECIDED:** drop
  Tailwind (`@tailwindcss/vite`, `tailwindcss`) and finish on plain CSS with tokens. Three styling
  systems is how the "stock AI" look creeps back.

---

## 3. Surface-by-surface

**Landing `/`.** Ships in two steps. **Lean (O5, for design partners):** the hero scramble and
collage ported from the site, one honest paragraph, three screenshots, signup. **Showpiece (O7, for
public launch):** everything below. Same grammar as the tutoring site,
retargeted from parents to tutors. A hero headline scramble (copy TBD; e.g. "teach the *why*∎"),
the collage with cards that are **real product screenshots in math-poster frames** (board,
runner, analytics), the corner nav, and the blur-in pitch paragraph. Sections, each with a
scrambled lowercase heading plus math object: *live* (embedded live demo board on an ephemeral
`/try` room, per PLAN §12.1), *homework* (SAT-style runner), *the loop* (assign → analyze → review
lesson → teach, with the site's flipping step numbers), *groups*, *pricing*, *story* (650 → 760),
then a signup CTA. Lighthouse ≥90. OG image, favicon (the ∎), meta description.

**Auth (`/login`, `/signup`).** Split layout: the form on white, and on the other half a slowly
cycling collage card (the `( )` thumbnail rotator from the hero). Add password reset and Google
sign-in.

**Shell.** Sidebar on `--paper-2`. Wordmark + ∎ at top. Active nav = ink pill with white text, and
the icon wiggles on hover. Topbar page title in Outfit 600 with a static terminal ∎ (no
animation in tutor chrome). **Real ⌘K palette** (O6) (`cmdk`): jump to student, set, lesson, board, and run "new X".
"New" becomes a menu. The footer shows org name and plan/trial status.

**Home.** *(Since replaced: Home is FLOW-SPEC's "This week", and onboarding is the `/welcome`
sequence, not a checklist on Home.)* Greeting with one Garamond-italic emphasis word. The onboarding checklist uses the
site's coloured, flipping step numbers. "Needs attention" (overdue, or <60% on the last attempt)
needs a server endpoint. Upcoming assignments get completion rings in palette colours. An empty
state gets one MathArt card plus one CTA.

**Students → Student record (new page `/app/students/:id`).** Header with a palette-coloured
avatar square (colour hashed from id), groups as coloured chips, and copy portal/board links.
Tabs: *Timeline* (attempts + sessions + PDFs), *Mastery* (per-tag correct% heat strip using
correct/warning/incorrect, never the categorical palette), *Work* (boards, PDFs).

**Content → Lesson composer (`/app/content/lessons/:id`). Replaces PLAN §6.4's full builder (§8,
R4).** Lessons are made three ways, in order of how tutors actually work: (1) **drop a PDF or
worksheet** (pages become board background pages), (2) **AI import** (exists: worksheet → problems),
and (3) **pick bank problems**. The composer only does page list, reorder, delete, edit a block's
text/LaTeX with live KaTeX preview, and set answer keys. No inspector, no spacing drag, no block
palette. Optimistic `version` lock. Quiet work surface.

**Live / Board.** *(Since built on our own engine, not tldraw: BOARD-SPEC §16. The quiz and lesson
ports landed; games did not.)* Restyle the dock and panels to the new tokens (white, hairline, floating
shadow, pill buttons). **Port from `C:\Users\konra\tittel-tutoring-app\client\src`:** `quiz/`
(AnswerOverlay, StatsPanel, exportStats), `lesson/` (render + inject), and `games/` (GameHost,
GameLibrary, nim/pizza/lockers; the shared logic already lives in `packages/shared/src/board/games`).
Obey the gotcha ledger §9.1–9.3 and §9.9 verbatim. **New: PDF onto the board.** Render each page
with pdf.js to an image asset on its own board page, locked as a background. This is the workflow
tutors already have on Bitpaper; without it nobody switches. Delight moments: the name gate (beautiful card,
class name scrambles in), stats bars springing in, the Nim win celebration (now on-brand: math
objects burst).

**Runner (`/hw`).** Two skins per PLAN §6.5. **Neutral**: calm, 720px column, 18px reading size,
pill choices with an ink selected state, timer in tabular figures, mobile-first. **SAT-style
(`template: 'sat'`)**: fidelity to the digital SAT over brand (Desmos, reference sheet, eliminator,
grid-in rules). **Never call it "Bluebook" in UI, copy, or marketing.** That's a College Board
trademark (§8, R8). Describe it as "digital-SAT-style." Submit → ∎ fills in.

**Review (`/review`).** The biggest student delight moment. Score flips in (`FlipNumber`), with a
one-line Garamond-italic verdict and per-question cards that rise in. On a high score, math
objects pop in around the score. Teens share screenshots of this. It is marketing.

**Portal (`/s`).** The student's home: name scrambles in once, assignment cards with status
∎/ring, their boards, and works on a phone.

**White-label rule for every student/parent surface** (portal, runner, review, board name gate,
session summary). Lead with **the tutor's** org name and optional logo ("Konrad Tittel Tutoring").
The product appears only as a small "made with <product>∎" footer, which is also the viral loop.
Parents see their tutor's brand, not ours (§8, R6).

**Session summary (`/summary/:token`), new and the wedge feature (§8, R3).** Built after each live
session. It drafts a parent-facing one-pager from quiz results, the board PDF, the topics covered,
and a short tutor note box. The tutor edits it, then copies a link or sends it. Sending means a
plain email the tutor triggers; no automatic sends. The AI draft uses the existing Anthropic
wiring and is gated on `ANTHROPIC_API_KEY`, falling back to a template when unset. The page is
styled like the website: big lowercase heading, math-art accent, the student's first name only.
It answers "what did my money buy this week?" Konrad already promises families exactly this on his
own site ("a one-page summary after every class").

**Analytics.** Per-tag mastery matrix (students × tags), per-student trend lines, live
engagement. Every problem list has **"Draft review lesson."** Charts: categorical palette for
series, semantic colours for correctness, follow the dataviz rules.

**Settings.** Profile (display name, which feeds the greeting), org name, plan/billing (Stripe
portal), JSON data export, delete account/org.

**404 and errors.** Penrose triangle (an impossible object) plus "this page doesn't exist∎."
Every error boundary uses the same treatment.

---

## 4. Product gaps that block "winning"

The pitch, sharpened by §8: **"Teach on your board. Slate writes the parent summary, assigns
the follow-up, grades it, and tells you what to review next."** Tutors keep Zoom/Meet; we replace
Bitpaper + Google Docs + the Sunday-night grading and parent emails.

In dependency order:
1. **Board worth switching to**: PDF onto board, then the quiz overlay + stats, lesson load from the
   library, and games ported. Smoke assertions per gotcha §9.3 (`elapsedMs > 0`).
2. **Board safety**: fix B7 (server-side read-only for non-granted guests) and move persistent-board
   assets to Supabase Storage. Konrad can't teach real classes while a student can wipe the board
   and images vanish on redeploy.
3. **Session persistence**: `quiz_events`, participants, and PDF-to-record at end of class.
4. **Session summary for parents** (§3), the wedge.
5. **Close the loop**: from a session or an assignment, "assign follow-up" (missed problems →
   set → assignment) and "draft review lesson" (missed problems → composer → board).
   **This is the demo; record it.**
6. **Student surfaces**: portal, neutral runner, review score moment, name gate, white-label, mobile.
7. **SAT-style runner skin** (Desmos pending licence, §5).
8. **Onboarding seed**: demo student, sample set with figures, sample lesson, a sample session
   summary. Aha in under 10 minutes.

Deferred until a design partner asks for it: the full visual lesson builder, org-level mastery
matrix, Studio seats (designed in §9), dark mode, more games, and email notifications beyond summaries. (⌘K is
scheduled for O6.)

## 5. Launch infrastructure

- **Licensing (§8, R5; researched 2026-10-20, primary sources):**
  - **Canvas: our own engine; tldraw is gone (2026-11).** The board is built on MIT libraries: Yjs +
    y-websocket for sync, undo and presence, perfect-freehand for ink, @use-gesture for pinch and
    wheel. `packages/board` holds the document and geometry, `apps/web/src/board/engine` the editor.
    No licence, key or watermark applies, so no email to tldraw is needed. Boards saved by the old
    engine are imported on first open (`boards.snapshot` is kept untouched as the original;
    `boards.doc` is the live document). Superseded tldraw terms, for the record: 3.15.5 allowed
    commercial use with the watermark; 4.x needs a production key.
  - **Desmos: $100/mo** (Starter, self-serve, up to 1,000 annual users; $200 to 2,500; $300 to
    5,000; graphing + scientific only). The free tier is non-commercial or a 90-day evaluation, and
    "commercial use includes any use … accessed by End Users in production." Konrad teaching paid
    students on it counts. **Superseded 2026-10-21 (R14):** we build our own clean-room
    calculator (`docs/GRAPH-SPEC.md`). Until it replaces the board's Desmos mirror, use the trial
    key only for evaluation, and **stop the demo-key fallback in production**
    (`apps/web/src/board/desmos.ts`).
  - **Open-source fallbacks (licences checked on GitHub; none is a drop-in):**
    - *Canvas:* Excalidraw (MIT, 134k★, very active), but it has no pages, camera-follow, or
      tldraw-sync equivalent, so switching means rewriting the board and its sync. fabric.js (MIT)
      and perfect-freehand (MIT) are building blocks, not products. Not worth it while 3.15.5 is
      free. **Superseded:** we built our own engine (see Canvas above; design and open items in
      `docs/BOARD-SPEC.md` §16).
    - *Graphing:* nothing open-source matches Desmos. A "Desmos-lite" could be built from MathLive
      (MIT, input) + Compute Engine (MIT, parse/evaluate LaTeX) + function-plot (MIT, plotting).
      JSXGraph is LGPL-3.0 (usable unmodified); Mafs is MIT but quiet since Mar 2025. GeoGebra is
      **not** an option: its apps need a commercial agreement, and the EUPL source can't be used
      with its UI or assets. **Decided otherwise in R14:** build it, on Desmos's own MPL-2.0
      MathQuill fork rather than MathLive.
- **Auth**: password reset, Google OAuth, a real `users.display_name`, org name + logo at signup.
- **Child data (§8, R7)**: Konrad's own students start at grade 5 (under 13). Minimise data by
  default: student = display name (first name + initial suggested), no student email field unless
  the tutor marks the student 13+, parent contact owned by the tutor, a consent attestation at
  signup, and summaries/portals that show first name only. Privacy policy + ToS (template, then
  Konrad review).
- **Security**: B7 (in O2), DB TLS verification, rate limits on token endpoints.
- **Ops**: Render paid plan (no cold starts) before the first design partner, Sentry (server + web),
  verified backups. A single instance with in-memory rooms is fine to hundreds of tutors; note
  that horizontal scale later needs sticky routing by board id.
- **Billing, staged (§8, R11)**: design partners prepay a founding year through a **Stripe Payment
  Link** (zero code; the plan flag is set by hand). Build Checkout + portal + webhooks + trial gates
  only once ≥3 partners have paid. Student links never break on a lapsed plan (PLAN §11).
- **Quality**: GitHub Actions running typecheck, build, and test on every push. PLAN §9.6 says no
  browser exists here. **That's outdated:** use the desktop browser pane (or Playwright) for
  runner, review, and board name-gate checks.
- **Performance**: route-level code splitting (the board, Desmos, KaTeX, pdf.js lazy), fonts preloaded.

---

## 6. Build order

Each phase ends green on typecheck, build, and test, with a "Konrad browser-check" list. Konrad's
time goes to teaching on it (from O2), recruiting partners, and the two licence calls.

- **T0 (Konrad, this week, no code):** get a Desmos trial key, list 5–10 design-
  partner tutors (SpiderSmart colleagues, Yale tutors), and 3 name candidates checked for domain +
  USPTO.
- **O0 Housekeeping (hours).** Commit the uncommitted pass (it typechecks), excluding `output.png`
  and the design-handoff folder. Mark PLAN.md §8 superseded.
- **O1 Design foundation (≤3 days, hard cap).** Tokens, fonts, motion tokens, primitives
  (`MathArt`, `FlipNumber`, `Reveal`, `QedLoader`, `Wordmark`, restyled core components;
  `Scramble` lands in O4), drop Tailwind, clear inline styles, meta + ∎ favicon.
  *Accept:* every route renders in the new language; AA verified; reduced motion = zero animation.
  **Done 2026-10-20 (branch `overhaul`).** Carried forward: inline styles were cleared on Home
  only (24 → 1). Students, Assignments, Runner, and others still carry ~60 inline blocks; they use
  tokens, so they restyle correctly, and each gets swept when its phase reworks the page. Tailwind's
  preflight is vendored as `packages/ui/src/reset.css` (in `@layer base`, same cascade as before).
- **O2 Teach on it (dogfood).** PDF onto board, quiz overlay + stats, library lesson load, games
  port, B7 fix, Storage-backed assets, board chrome restyle, **GRAPH-SPEC G1** (our calculator
  replaces the board's Desmos mirror, so its sync hack is never ported).
  **Plan-load contract** (agreed 2026-10-24 with the FLOW-SPEC F1 work):
  - **Entry:** `/b/:boardId?lesson=<sessionId>`. The host's board fetches
    `GET /api/tutor/sessions/:id/plan` (routes/sessions.ts; 404 when the lesson has no plan) → `{ planId, version, title, scheduledAt, doc }`,
    injects it, then strips the param.
  - **Page IDs are per lesson:** `page:lesson-<sessionId>-<n>`. A reload is idempotent, a plan
    reused or edited for a later lesson gets fresh pages, and history stays per lesson.
  - **Appends** after the board's existing pages and opens on the first new one. Page names are
    `<Mon 27 Oct> · <plan title>`, with ` · n` added when there are several pages.
  - **API:** `loadPlanOntoBoard(editor, planDoc, { idPrefix })` in `apps/web/src/board/`. A library
    quick-load passes `plan-<planId>-v<version>`.
  - **PDF plans (as built):** the lesson page renders a dropped PDF in the browser, one PNG per
    page, into the durable `files` table, and saves it as an ordinary plan of image blocks
    (`src: /api/files/<token>`, maxWidth 900, spacingAfter 40). The board loads it like any plan,
    so no PDF-specific board code or board-assets table is needed.
  **Status (2026-10-29):** done: lesson load (52251b2, 7dba274), quiz overlay + answers panel
  (7be563f), the top tutor bar with Lesson page / End lesson (c9a753f, b83a458), B7
  server-enforced write access (00589a7), G1. Left: games port (frozen until a paying tutor
  asks) and the smoke coverage in *Accept*.
  **Update (2026-10-30):** board images on a persistent board now live in `board_assets` ->
  `files`, so they survive a restart; uploads need a board token with write access. Checked by
  hand against a real restart, not yet in the smoke suite. PDF and photo pages take pinned
  answer boxes (`LessonBlock.at`, `lessons/AnswerBoxes.tsx`).
  *Accept:* Konrad teaches every class that week on the platform; the smoke suite covers quiz
  timing and snapshot+asset survival across a restart.
- **O3 The weekly loop.** Session persistence, the session summary (AI draft + edit + link/email),
  assign-follow-up, the lesson composer, draft-review-lesson.
  *Accept:* the recorded demo loop on prod; Konrad sends real summaries to his families.
  **Status (2026-10-29):** built, with every step working without AI (Konrad: some tutors find AI
  follow-ups off-putting, others want them). *Session record:* answers to a lesson plan's
  answer boxes go to `quiz_events` (`lib/lessonRecord.ts`, called from the board's control
  channel; student = the 1:1 board's student, or the group member by first name). End lesson
  saves the lesson's board pages as a PDF (`lessonNotesPdf`) and calls `POST
  /sessions/:id/end`; the PDF shows as "Board notes" on the lesson and the student's portal.
  *After the lesson* (lesson page, once started or over): board results and last time's
  homework misses, then "Practise them as homework" (the missed problems again, due at the next
  lesson) or "Go over them next lesson" (a Review page first on the next lesson's plan).
  *Parent update:* a template from the lesson's facts. *Claude, optional:* "More like these"
  (new practice from the misses, checked before giving) and "Write it up with Claude" for the
  update; both only when the server has a key and the tutor's Settings → Claude switch is on.
  Not built: participants list, the lesson composer beyond paste-a-plan, the recorded demo.
  The board-file changes (`controlChannel.ts` record call, `BoardCanvas.tsx` finishLesson,
  `exportPdf.ts` split) were made while the board session was offline; review on return.
- **O4 Student surfaces.** White-label, portal, neutral runner (mobile), review score moment, name
  gate, `Scramble`, SAT-style skin with **GRAPH-SPEC G2–G3** (our calculator in SAT mode, plus
  the Scientific calculator).
- **O5 Design partners (5 tutors, free, ~week 6).** Lean landing, password reset + Google,
  onboarding seed, child-data minimisation + legal pages, Sentry, CI, Render paid, Payment Link
  for the founding year. Each partner gets a 30-minute onboarding call; watch, don't help.
  **Status (2026-10-29), code side built:** password reset (/forgot, /reset); Google sign-in
  (button appears when `VITE_GOOGLE_AUTH=on`); signup asks name and business name (kept on the
  user and workspace; the business name heads the student portal); a one-time consent step in
  the app before students (parent permission for under-13s, minimal data), student emails
  labelled "own (13+)" with parent as the default; draft Privacy Policy and Terms at /privacy
  and /terms with bracketed gaps; "Explore with a sample student" (routes/demo.ts: a past
  lesson with results to follow up on, removable in one click); per-IP rate limits on the public
  link routes; Sentry on server and web, off unless a DSN is set; GitHub Actions CI (typecheck,
  test, build), with the paste/invitee parser checks now in `npm test`.
  **Konrad's side:** enable Google in Supabase and set the auth redirect URLs (/app, /reset);
  fill and review the legal drafts; Sentry DSNs; Render paid plan, backups, BOARD_TOKEN_SECRET,
  ANTHROPIC_API_KEY; the Stripe Payment Link; the final name (blocks signups); the lean
  landing copy.
- **O6 Earn it.** Fix what partners hit. Student record + mastery when asked, ⌘K, Settings. Stripe
  Checkout/portal/gates once ≥3 have paid.
- **O7 Public launch.** Showpiece landing, final name/domain swap via `brand.ts`, OG, Lighthouse
  ≥90, performance.

**Metrics.** North star: **weekly closed loops per tutor** (a session held with a summary sent, or
an assignment graded with a follow-up created). Partner bar to continue past O6: 4-week retention
≥3 of 5, and ≥3 prepaid.

## 7. Decisions (resolved; see §8 for reasoning)

1. **PLAN §8 is reversed** in favour of this spec. Konrad confirmed it 2026-10-20.
2. **Brand:** the coral ∎ is the **product's** mark (Konrad's site may keep it as the founder's
   page). Student/parent surfaces lead with the tutor's brand. "Slate" stays a placeholder in
   `brand.ts`. It's crowded and weak to trademark, so pick the final name before O5 signups.
   Candidate direction worth checking: names tied to ∎, e.g. *Halmos* (the ∎ is the "Halmos
   symbol"). Unverified for domain or trademark.
3. **Button:** ink pill, white text, hover `#D93A00` (§2.1).
4. **Tailwind:** dropped.
5. **Tabular figures:** resolved. Outfit has `tnum`, so no second face is needed (§2.2).
6. **Order:** design foundation first, but capped at 3 days; then product depth on the board.
   Delight is concentrated on student/parent surfaces.
7. Still Konrad's (blocking only where noted): the final name (blocks O5) and whether to pay for a
   lawyer pass on the policies.

## 8. Red-team record (adversarial review, 2026-10-20)

An imagined, hostile investor/VP challenged the plan. Each resolution below is binding. Don't
relitigate it without new evidence.

| # | Challenge | Resolution |
|---|---|---|
| R1 | "Zero users and you want a month of animations." | Conceded in part. Design foundation is a token swap with a **3-day cap**. Scramble is cut from tutor chrome. Whimsy lives where students and parents look. |
| R2 | "Why would a tutor leave Zoom + Bitpaper + Docs?" | They keep Zoom. The board has to beat Bitpaper on its home turf (**PDF on the board**) and then win with what nobody else has: live answer collection with stats. Neither is in the board today, so board parity jumps to O2. |
| R3 | "Who pays your customer? Parents. Tutors churn when parents don't see progress." | **The session summary** is the wedge. It's weekly, visible to the payer, and saves the tutor an hour. Konrad already promises families this by hand. |
| R4 | "The visual lesson builder is weeks of work tutors won't use; they teach from PDFs." | Cut to a composer. PDF import, AI import (exists), and bank problems cover authoring. |
| R5 | "Your core canvas has an unpublished price. What if it eats your margin?" | Resolved (§5): the canvas is now our own, on MIT libraries, so it has no price. Desmos is $100/mo; superseded by R14. |
| R14 | "You're building a Desmos clone? That's a legal and engineering sinkhole." (2026-10-21) | Konrad's call: own the calculator. **Clean-room only** (GRAPH-SPEC §0): public docs and observation, never their code. Two facts make it viable. (1) Desmos's own math-input field is open source (MPL-2.0), so the typing feel is licensed, not copied. (2) The SAT calculator is standard Desmos minus images, folders and notes, so the target is fully documented. Phased by SAT usage (G1 board → G2 SAT core → G3 breadth). It also removes the Desmos sync hack and the $100/mo. |
| R6 | "Tutors want *their* brand in front of parents, not yours." | White-label student/parent surfaces. The product is a small footer mark, which is also the referral loop. |
| R7 | "Your own students are 10. COPPA." | Data minimisation by default (first name, no child email, tutor-owned parent contact), a consent attestation, and policies before partners. |
| R8 | "You're cloning Bluebook. That's College Board's mark." | Rename to "digital-SAT-style" everywhere. Fidelity of behaviour, not branding. |
| R9 | "Eight phases and no outside user until phase six." | Konrad dogfoods from O2. Design partners arrive at O5 (~week 6). Public launch only after partners retain. |
| R10 | "What number proves it works?" | Weekly closed loops per tutor; 4-week partner retention; prepaid founding years. |
| R11 | "Don't build billing before anyone pays. But don't skip learning what they'll pay." | A Stripe Payment Link for founding-year prepay (no code). Real billing only after ≥3 pay. |
| R12 | "Will coral and dice look childish to a $150/hr SAT tutor?" | The base is stark editorial; the play is math-literate (Euler, Pythagoras, Penrose), not cartoons, and stays off tutor work surfaces. Validate with partners in O5; the tokens make toning it down a one-file change. |
| R13 | "One Node process with in-memory rooms. Scale?" | Fine to hundreds of tutors on one paid instance. Sticky routing by board id is a later problem, noted and not built. |

## 9. Multi-tutor workspaces and agencies (design, 2026-10-30)

**Why:** a simulated trial found that a tutoring business with several tutors can't adopt Slate:
one login is one workspace, and everyone in it sees and edits everything. Konrad may also pitch
agencies or marketplaces (e.g. Wyzant) later; he called that "just a thought."
**DECIDED (Konrad, 2026-10-30):** design multi-tutor workspaces now and build them later. The
build stays behind §4's rule (Studio seats wait until a design partner asks). Everything below
that is not marked DECIDED is a proposal.

**What exists today.** `users.role` is `'owner'|'tutor'`, but nothing reads it: `auth.ts` passes
it along and no route checks it. `orgs.plan` allows `'studio'`. PLAN §1.3 prices Studio at
$79/mo for up to 5 seats, with "shared content library, per-tutor rosters." PLAN Phase 7 wanted
"invite tutor by email, per-tutor content visibility default = org-shared." Every query is scoped
by `org_id` only. `auth.ts` creates a fresh org for any sign-in it doesn't recognise, so an
invited tutor would land in a workspace of their own today. Several settings that belong to a
person live on the org (`orgs.settings`: `icsUrl`, `calendarFilters`, `meetingLinkSource`,
`defaultMeetingUrl`, `demo`).

Vocabulary: **workspace** = an `orgs` row (UI word). **Agency** = a workspace with more than one
tutor. **Marketplace** = a third party (Wyzant-style) that owns the client relationship and
would embed or integrate Slate.

### 9.1 Roles

Teaching is not a role. Anyone in a workspace can own students; most agency owners still teach.
Roles only grant permissions.

| | Owner | Admin | Tutor |
|---|---|---|---|
| Own students, groups, lessons, boards; teach; assign; follow up | yes | yes | yes |
| See **other tutors'** students, lessons, homework, Insights | all | all | no (but see §9.2 for cover lessons and group classes) |
| Reassign students between tutors; hand over a leaver | yes | yes | no |
| Invite, change role, deactivate | everyone | tutors only | no |
| Shared library: edit, archive, accept "share with team" | yes | yes | read and copy only |
| Branding (name, logo, tutor display rule), contact policy (§9.5), Claude policy | yes | yes | no |
| Billing, seats, plan, delete workspace, transfer ownership, full export | yes | no | no |
| Own settings: display name, calendar feed, meeting link, Claude opt-out | yes | yes | yes |

- Exactly one owner per workspace. Ownership is transferred, never shared, so Stripe and deletion
  have one answer.
- A solo workspace is an owner with no one else. Its UI stays exactly as it is today: no team
  words, no "all tutors" filters.
- **Proposal:** admins see everything read-write. A read-only "coordinator" role is the most
  likely request after launch (scheduling staff who don't teach). Add it only when asked.
- Schema: `users.role` check becomes `('owner','admin','tutor')`, plus `users.deactivated_at`
  (soft; `assignments.created_by` and past lessons keep pointing at it) and `users.settings jsonb`
  (§9.4).

### 9.2 Students belong to a tutor

- **Proposal:** `students.tutor_id` is the student's tutor (references `users.id`). New students
  get the creator. Admins can create students for someone else.
- **What a tutor sees** (one predicate, used everywhere):
  own students ∪ members of groups they own ∪ students in lessons assigned to them.
  The last two cover agency group classes (one tutor teaches a group drawn from several rosters)
  and cover lessons (`sessions.tutor_id` differs from the student's tutor for one week). A cover
  tutor sees that lesson, its plan, the student's last notes and homework, and nothing older.
- **Students with two tutors** (math with Sam, English with Priya) are common in agencies.
  **Proposal:** v1 keeps one owning tutor and models the second subject as the other tutor's
  lessons/series, which the predicate already covers. A `student_tutors` join table is the
  upgrade if partners need full co-ownership (open question 2).
- **Admins see all of them:** This week, Students and Insights gain a tutor filter ("All tutors"
  / a tutor / "Mine") for admins and owners. Insights → Hours groups by tutor too, which is the
  agency's payroll input. We still don't do payroll (PLAN §1.1).
- **Handover when a tutor leaves.** An admin deactivates the tutor, and the app requires a
  decision for each of their students before it finishes (bulk "all to Priya" plus per-student
  overrides). Reassigning a student moves `students.tutor_id`, their boards, their future lessons
  and series, open homework (`assignments.tutor_id`), and the groups the leaver owned (to one
  chosen tutor). **Past lessons keep their tutor**, so the record says who taught what.
  - Student links do not change (§9.8). The portal's tutor name changes to the new tutor.
  - `students.meeting_url` is usually the old tutor's Zoom room. Clear it on reassign and say
    so in the dialog.
  - The leaver's calendar feed is disconnected with today's Disconnect rules (FLOW-SPEC §9):
    unprepared future imports go, prepared ones stay as ordinary lessons, now the new tutor's.
  - Their personal library goes to the shared library by default, or to the receiving tutor
    (open question 4).
  - Deactivation frees the seat immediately. The user row stays, so `created_by` and history
    resolve. Sign-in is refused with "Your access to <agency> has ended."
- The same reassign dialog handles a student switching tutors without anyone leaving.

### 9.3 The library: shared and personal

Library tables: `problems`, `problem_sets`, `lessons` (plans). **Proposal:** each gains a
nullable `tutor_id`. `null` = shared with the workspace; set = personal to that tutor.

- **Tags stay workspace-wide.** One taxonomy is what makes agency-level mastery and "who needs
  quadratics" possible. Tutors can add tags; admins merge and rename them.
- **Default for new items: personal.** This reverses PLAN Phase 7's "default = org-shared" and is
  open question 1. Reasoning: most library rows are made in passing (a PDF dropped on one lesson,
  paste-a-plan, Claude imports), and sharing all of them by default buries the curated material
  in drafts. The agency gets a curated shared library. Tutors get a scratch space.
- **Copy:** "Copy to mine" on any shared item. A copied set references the same shared problems
  (cheap, and an admin's typo fix still reaches everyone, as with `assignment_problems`).
  Editing a shared problem from a personal set forks it (copy-on-write: a new personal problem
  replaces it in that set only). A copied plan copies `lessons.doc` whole. `files` referenced by
  `/api/files/<token>` are shared by token and never duplicated.
- **Share:** "Share with team" on a personal item moves it to shared (`tutor_id = null`). An
  agency setting can make that a request an admin approves instead.
- Assignments already snapshot their problem list, so moving or archiving library items never
  changes homework a student already has.
- Paper homework is an archived one-question set (FLOW-SPEC §10), so it stays out of both
  libraries. Give it the assigning tutor's `tutor_id` anyway so the scope rule (§9.7) holds.

### 9.4 Calendars and meeting links per tutor

Today these are org settings because the org was the tutor. **Proposal:** move the personal ones
to `users.settings`: `icsUrl`, `calendarFilters`, `meetingLinkSource`, `defaultMeetingUrl`,
`timezone`, `demo`, and a personal `aiHelp` opt-out. On the org stay: `name`, branding,
`consentAt` (the agency attests), the Claude policy (an admin can switch it off for everyone),
and the contact policy (§9.5).

- **One feed per tutor.** Sync runs per user and matches against **the students that tutor can
  see** (§9.2), not the whole workspace. An unmatched invite goes to that tutor's inbox. Only
  admins get "It's another tutor's student" as an answer, which also offers a cover lesson.
- **Agencies cc coordinators on invites.** Every staff address in the workspace (all users'
  sign-in and calendar addresses) is excluded from matching, the same way "the tutor's own email
  never matches" today. Otherwise an admin on every invite becomes a student.
- **Keys change:** `calendar_links` primary key (org_id, uid) → (org_id, tutor_id, uid);
  `sessions_org_calendar_uid` (org_id, calendar_uid) → (org_id, tutor_id, calendar_uid). An
  admin invited to a tutor's lesson can then connect their own calendar without the two imports
  colliding. **Proposal:** an admin's feed skips events that another tutor's feed already
  imported, so one lesson never appears twice.
- **Meeting link resolution** gains one step:
  lesson → series → student → **the lesson's tutor's default** (was: the org's default).
- **Agency week view:** admins see This week across all tutors, read from `sessions`. No new
  sync.
- Stage C (OAuth, auto Meet) is per user when it comes; nothing here blocks it.

### 9.5 Parent-facing branding: the agency's name, the tutor's name

R6 stands: student and parent surfaces lead with the tutor's business, not ours. For an agency,
the business is the agency.

| Surface | Solo (today, unchanged) | Agency (proposal) |
|---|---|---|
| Portal, runner, review, board name gate header | Workspace name | Agency name + logo |
| Who teaches | (implied) | "Your tutor: Sam Lee" line on portal and lesson cards |
| Parent update / session summary | Tutor's name | "Sam Lee · <Agency>" |
| Footer | "made with Slate∎" | Same. Removable only in the white-label tier (§9.9) |

- **Tutor display rule** (agency setting): full name, or first name + initial ("Sam L."). Some
  agencies don't want parents able to find their tutors elsewhere.
- **Contact policy** (agency setting): `tutor` (default; tutors see parent addresses and
  "Update parents" opens their mail app, as today), `admin` (tutors don't see addresses; parent
  updates go to an admin to send, or as a copy-link only), or `none` (marketplace mode, §9.9).
  This is also a minimisation win under R7: fewer people see a minor's family contacts.
- Brand assets live on the org (`orgs.settings.branding`: logo file token, optional accent from
  the categorical palette). No custom fonts or colours beyond that before the white-label tier.

### 9.6 Seat billing

- PLAN §1.3's Studio ($79/mo, up to 5 seats) stays the hypothesis. **A seat = an active
  (not deactivated) user of any role, owner included.** Pending invites don't count until
  accepted. Deactivating frees the seat at once.
- **Proposal for >5 tutors:** an "Agency" price per seat above 5 (number TBD, open question 5),
  billed as a Stripe subscription quantity with proration. The seat gate lives in
  `billing/gates.ts` as PLAN §11 intends: inviting past the limit is blocked with an upgrade
  prompt. **Existing tutors and student links never lock over seats** (PLAN §11's guarantee
  extends to seats).
- Staging per R11: until Checkout exists (O6), a Studio founding year is a Payment Link and the
  seat cap is set by hand on the org (`orgs.settings.seatLimit`). Quantity-based Checkout
  comes after ≥3 Solo partners have paid.
- Solo → Studio is a plan change, not a migration (§9.8). Studio → Solo is allowed only when one
  active user remains.

### 9.7 Tenancy: `tutor_id` alongside `org_id`

Two boundaries, with different stakes:
- **`org_id` separates customers.** A leak is a breach. `orgQuery` stays exactly as it is and
  stays total.
- **`tutor_id` separates colleagues in one customer.** A leak is an authorisation bug
  (poaching, and minors' data seen by staff who don't need it). It still deserves a guard,
  because ~170 `orgQuery` call sites across 14 route files will be converted and one forgotten
  route shows every tutor everyone's students.

**Tables that gain `tutor_id`** (the rows people list, filter and own):

| Table | Meaning of `tutor_id` | Null allowed |
|---|---|---|
| `students` | owning tutor | no (after backfill) |
| `groups` | owning tutor | no |
| `lesson_series`, `sessions` | who teaches this slot / this lesson (cover = differs from the student's) | no |
| `classes`, `boards` | owner; a student's board follows the student on handover | no |
| `assignments` | whose homework it is (`created_by` stays the author) | no |
| `calendar_links` | whose feed the answer belongs to | no |
| `problems`, `problem_sets`, `lessons` | personal to | **yes: null = shared** |

**Reached through a parent and not denormalised:** `student_emails`, `group_members`,
`assignment_student`, `assignment_problems`, `attempts`, `responses`, `quiz_events`,
`board_assets`, `set_problems`, `problem_tags`, `lesson_tags`. Their queries join to a scoped
parent (attempts → assignments/students, quiz_events → sessions). `tags` and `files` stay
workspace-wide (`files` is reached by token). **Token surfaces don't change:** `studentQuery`,
`attemptQuery`, `fileQuery` and `boardQuery` are keyed by the link, and the link is the access.

**Proposal for the guard** in `apps/server/src/db.ts`:
1. A new `tutorQuery(scope, sql, params)`. `scope` = `{ orgId, tutorId }` from `req.auth`.
   `tutorId` is the user's id for a tutor, or `null` when an owner/admin views "All tutors".
   It passes `$1 = org_id`, `$2 = tutor_id` and refuses SQL that doesn't mention both `org_id`
   and `tutor_id`. Idiom: `where s.org_id = $1 and ($2::text is null or s.tutor_id = $2)`,
   or the §9.2 visibility predicate as one shared SQL fragment for student-shaped queries.
2. **`orgQuery` becomes a tripwire** for the tables above: it throws if the SQL touches one of
   them (`from|join|update|into` + a name from a `TUTOR_SCOPED` list) without mentioning
   `tutor_id`, unless the caller passes `{ allTutors: true }`. Only routes that have checked
   owner/admin pass it. The safe path is then the default, and a forgotten conversion fails
   loudly in development instead of leaking quietly in production.
3. **Writes** to those tables must set `tutor_id`. The same regex check covers `insert into`.
4. **Known limit, true today too:** the regex proves the SQL *mentions* the column, not that it
   *filters* on it. `routes/org.ts` satisfies `orgQuery` with a `/* org_id */` comment.
   The backstop is a **two-tutor fixture in the smoke suite**: tutor A gets 404 or an empty
   list on every tutor-scoped route when asked for B's ids. That test is the real enforcement.
   Postgres RLS was considered: it needs a per-request `set_config` through the session pooler.
   It's a later hardening option, not v1.
5. Three raw `pool.query` calls outside `db.ts` exist today (`board/rooms.ts`, `index.ts`,
   `routes/attempt.ts`), all keyed by board id or attempt. Re-check them in the same pass.

### 9.8 Migration: solo → multi-tutor without breaking a student link

**Every link a student or parent holds is keyed by its own token or id, never by org or
tutor:** `/s/:portal_token`, `/hw/:attempt_token`, `/review/:attempt_token`, `/b/:boardId`,
`/api/files/:file_token`, `report_token`. Adding tutors, reassigning students and changing roles
therefore change no URL. Keep it that way: **never put an org or tutor id in a student-facing
path** (embeds and custom domains in §9.9 included).

Steps, all in `db/schema.sql`'s idempotent migration section and applied on boot as usual:
1. `alter table … add column if not exists tutor_id text references users(id)` on each table in
   §9.7; `users` gains `deactivated_at`, `settings`; the role check gains `'admin'`.
2. Backfill: `update <t> set tutor_id = (the org's owner) where tutor_id is null`, for every
   non-library table. Every org today has exactly one user, the owner, so this is exact.
   Library rows backfill to **shared** (`null`): in a solo org nobody else sees them, and when
   the owner invites the first tutor the invite dialog asks "Share your library (N items) with
   the team, or keep it personal?" before sending.
3. Copy the personal keys from `orgs.settings` into the owner's `users.settings`. Read the user
   first and fall back to the org for one release, then stop reading the org keys.
4. Swap the two calendar unique keys (§9.4). Today every row has the owner's `tutor_id`, so no
   duplicates can exist.
5. `set not null` on the non-library `tutor_id` columns only after the code that sets them on
   insert has shipped. (Same deploy is fine: schema runs on boot before routes serve.)
6. `auth.ts`: before bootstrapping a new org for an unknown sign-in, look for a pending invite
   for that email and join that org instead. **This is the first line of code of the build.**

**Merging two existing solo workspaces** (two Slate tutors forming an agency) is the hard case.
Rows move by updating `org_id`. Tokens are globally unique, so nothing collides and no link
changes. Class slugs are unique per org and get a suffix on collision. Tags merge by name.
The absorbed org's Stripe subscription is cancelled and prorated. **Proposal:** an admin script
run by us on request, not a UI, until it has happened twice.

**One login, one workspace** (`users.supabase_uid unique`, `users.org_id not null`) is the model
today. An email that already owns a solo workspace can't accept an invite to an agency without a
merge. **Proposal:** v1 keeps the model and offers the merge. A `memberships` table (one login,
several workspaces, a switcher) is needed once tutors work for an agency and keep their own
practice, which is the normal case on marketplaces (§9.9, open question 6).

### 9.9 Agencies and marketplaces: what an integration adds

None of this is built before a named partner asks for it and has agreed to pay. Recorded so
§9.1–9.8 don't paint us into a corner.

**Embeddable or white-label student surfaces.**
- Embed the portal, runner, review and board in the partner's app via iframe. Needs a
  per-org `frame-ancestors` allowlist (CSP), cookie-free auth (already true: the token is the
  access), and `postMessage` events (homework submitted, lesson ended) so their page can react.
- Custom domain (`learn.agency.com`) via CNAME + TLS on Render. Real ops cost, so price it in.
- White-label tier: the agency's logo and accent, "made with Slate∎" removed. This gives up the
  referral loop (R6), so it is priced, never default.

**API and webhooks for their own scheduling, payments and messaging.**
- *Scheduling:* REST for students, lessons/series and homework, with `external_id` columns
  (students, users, sessions) mapping to the partner's ids, and idempotency keys. Reuse the
  calendar import's ownership split (FLOW-SPEC §9): **the partner owns time, who, and
  cancellation; the tutor owns the plan, homework and notes.** Their lessons arrive the way
  calendar lessons do, and 409 on move/cancel in our UI points to their app.
- *Payments:* we still don't invoice parents (PLAN §1.1). Webhook `lesson.ended` carries the
  actual start/end and attendance, which is what their billing needs. Hours (FLOW-SPEC §10)
  becomes an API read.
- *Messaging:* parent updates and summaries go out through their messaging, not the tutor's mail
  app: a `summary.ready` webhook with the text and the summary link, and contact policy `none`
  (§9.5).
- Webhooks: HMAC-signed, retried with backoff, per-org endpoint and secret. Events:
  `lesson.started|ended`, `homework.assigned|submitted|graded`, `summary.ready`,
  `student.created`. API keys per org, scoped, revocable, shown once.

**SSO.**
- Agencies on Google Workspace: Google sign-in exists (O5). Add "only @agency.com may join."
- Marketplaces: a signed launch token (JWT from the partner, short-lived) that signs a tutor
  into their Slate workspace, LTI-style. OIDC/SAML only if an enterprise partner insists.
- **Students still never get accounts** (PLAN §3, locked). A marketplace's student launch is a
  signed redirect to that student's portal token.

**Data ownership and export.**
- Solo: the tutor is the data controller and we process for them (PLAN §12.2). Agency: the
  agency is the controller, its tutors are staff, and the data stays when a tutor leaves.
  Marketplace: the marketplace is the controller, and we sign its DPA as a processor.
- Export: the owner's full JSON export (Settings, O6) covers the workspace. **Proposal:** a
  tutor may export their personal library, never students, unless the agency allows it.
  Deletion at contract end with a written confirmation.

**The constraint that matters most: marketplaces keep the client relationship.** A Wyzant-style
marketplace earns a commission on every hour. Such platforms typically forbid moving clients
off-platform (verify the specific partner's terms before any pitch). In marketplace mode:
- No parent or student contact details reach the tutor (contact policy `none`). Students arrive
  as the partner's opaque id + first name, which also fits R7's minimisation.
- No direct channel: "Update parents" and the session summary go only through the partner's
  messaging. Calendar import from a tutor's personal Google is off; lessons come from the
  partner's API.
- Branding is the marketplace's; the tutor's own business name never appears. Tutor display
  rule = first name + initial.
- A tutor's own solo workspace and their marketplace work must stay separate (memberships,
  §9.8): a student never moves from one to the other through our product.

### 9.10 Build order (after a design partner asks; sizes rough)

| Phase | Contents | Size |
|---|---|---|
| **M1 Seats** | Roles (`admin`), invites table + invite link/email, `auth.ts` joins invites instead of bootstrapping, Settings → Team (invite, role, deactivate), `tutor_id` columns + backfill, personal settings to `users.settings`. Visibility unchanged (everyone sees everything, which suits a two-person studio). | ~3–4 days |
| **M2 Scoped visibility** | `tutorQuery`, the `orgQuery` tripwire, the §9.2 predicate, converting the ~170 call sites, admin "All tutors / tutor / Mine" filters, the two-tutor smoke fixture | ~4–5 days |
| **M3 Handover + library** | Reassign dialog (bulk + per student), deactivate flow, cover lessons, personal/shared library, copy, share, copy-on-write problems | ~3–4 days |
| **M4 Calendars per tutor** | Per-user feeds, new unique keys, staff-address exclusion, admin week view, meeting-link step | ~2 days |
| **M5 Branding + billing** | Agency name/logo + tutor line on student surfaces, tutor display rule, contact policy, seat gate; quantity Checkout once O6 Checkout exists | ~2–3 days |
| **M6 Integration** | Only with a signed partner: API keys + REST, webhooks, `external_id`s, embeds + CSP, custom domain, launch-token SSO, `memberships`, DPA | ~2–4 weeks, scoped to that partner |

M1–M5 is about three weeks for a Studio that works for agencies of up to ~20 tutors. M1 alone
unblocks a two-tutor studio that is happy to share everything.

### 9.11 Open questions for Konrad

1. **Library default:** personal (this section's proposal) or shared (PLAN Phase 7)?
2. **Students with two tutors:** one owner + the other tutor's lessons (v1 proposal), or real
   co-ownership from the start?
3. **Parent contacts in agencies:** should tutors see them by default (`tutor`), or only admins?
4. **A leaver's personal library:** does the agency keep it, can the tutor take a copy, or both?
5. **Seat pricing:** the per-seat price above 5; does a non-teaching admin take a seat; does the
   founding-year deal cover Studio?
6. **One login, several workspaces:** needed in v1, or merge-only until a marketplace?
7. **Tiers:** is "Agency" (white-label, API) a separate plan above Studio, and roughly what does
   it cost?
8. **Admins observing live boards:** agencies do quality checks. Allow an admin to join any
   lesson silently, visibly, or not at all? (Minors are on those boards.)
9. **Tutors seeing colleagues:** names and schedules (a shared week view), or admins only?
10. **Claude policy:** may an admin switch Claude off for every tutor, or is it always each
    tutor's own switch?
11. **Marketplaces:** is there a specific one and a contact, or does M6 stay a note until one
    appears?
