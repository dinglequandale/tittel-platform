# OVERHAUL — from working prototype to a publishable product

**Written:** 2026-10-20. **Supersedes:** PLAN.md §8 (design system) and the Claude Design handoff in
`Tutoring app UI design-handoff/` (the pine/Fraunces "quiet academic" look). Everything else in
PLAN.md (architecture, data model, gotcha ledger §9) still applies.

**Design reference:** `C:\Users\konra\tittel-tutoring\website\tutoring\` (`styles.css`, `site.js`,
`graphics.js`). This is the visual language to carry into the app: playful and kinetic, but
professional and sleek. Read those three files before any UI work.

---

## 0. Where things actually stand

The git log reads "Phase 3 (part 1)" followed by fix passes A–G. **Phases 4–7 of PLAN.md have not
been built.** On top of that, there is an uncommitted UI pass that implements the pine prototype
(real-data Home, Analytics, and Settings pages; restyled Students, Content, and Live). It
typechecks.

| Area | State | Gap to "publishable" |
|---|---|---|
| Landing `/` | 20-line stub | The whole marketing site |
| App shell | Works. Search box is a fake `<span>`. "New" only links to Content. Display name comes from the email's local part | Command palette, a real New menu, a real display/org name |
| Home | Uncommitted. Real counts and an onboarding checklist | "Needs attention" signals (scores, overdue), recent sessions |
| Students | Roster, groups, portal/board links | **Student record page** (timeline, mastery, work) does not exist |
| Content | Problem bank, sets, tags, AI import. Lessons = JSON import plus a raw JSON `<pre>` | **Lesson builder** does not exist |
| Live / board | Sync, camera/page follow, calculator, timer, free reign, write grants, PDF export | **Quiz answer overlay, stats panel, lesson loading, and games are not ported** (`BoardCanvas.tsx:35`). These are the product's differentiators |
| Runner | Answer, autosave, timer, submit | **SAT-style skin deferred**: no Desmos, reference sheet, or eliminator. SAT is the flagship GTM vertical |
| Portal / Review | Functional | Design, mobile layout, a results moment |
| Analytics | Four stat tiles and completion bars | Per-tag mastery, trends, "Draft review lesson" |
| Settings | Email and sign-out | Org name, profile, billing, data export, account deletion |
| Seam (assign → analyze → review lesson → board) | Not built | The product's core demo |
| `sessions` / `quiz_events` | `sessions` row inserted on class start. `quiz_events` never written | End-of-class persistence |
| Billing / onboarding seed / email / legal | None | All required to charge money |
| Password reset / Google sign-in | None | Required |
| Board assets | In-memory (lost on restart) | Supabase Storage for persistent boards |
| Security | tldraw sync accepts writes from any guest (B7 TODO). DB TLS `rejectUnauthorized` TODO | Must fix before paying customers |
| Responsiveness | 3 media queries in the whole app, 0 in `board.css` | Portal, runner, and review must work on phones |
| Tests / CI | `smoke.mjs` + grader unit test. No CI | CI on push. Browser tests are now possible (see §6) |
| Meta | `<title>Slate</title>`, no favicon, no OG tags | Brand meta |

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

**Home.** Greeting with one Garamond-italic emphasis word. The onboarding checklist uses the
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

**Live / Board.** Restyle the dock and panels to the new tokens (white, hairline, floating
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
matrix, Studio seats, dark mode, more games, and email notifications beyond summaries. (⌘K is
scheduled for O6.)

## 5. Launch infrastructure

- **Licensing (§8, R5; researched 2026-10-20, primary sources):**
  - **tldraw: stay on 3.15.5, never upgrade to 4.x without a key.** `LICENSE.md` at tag
    `v3.15.5` grants use "in your commercial or non-commercial projects" provided the "made with
    tldraw" watermark stays. A paid Business License only removes the watermark. 4.x (Sept 2025)
    changed this: production needs a key, and the free hobby key is non-commercial. **Caveat:**
    the installed packages' `LICENSE.md` just links to the licence on `main`, which is now the
    4.x text. Before charging money, email tldraw to confirm in writing that 3.x production use with
    the watermark is permitted, and ask for a startup quote to remove it. Cost if confirmed: $0.
    Risk: 3.x gets no upstream fixes, so we own any bugs.
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
      free.
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
- **Performance**: route-level code splitting (tldraw, Desmos, KaTeX, pdf.js lazy), fonts preloaded.

---

## 6. Build order

Each phase ends green on typecheck, build, and test, with a "Konrad browser-check" list. Konrad's
time goes to teaching on it (from O2), recruiting partners, and the two licence calls.

- **T0 (Konrad, this week, no code):** email tldraw (written confirmation that 3.x commercial use
  with the watermark is OK, plus a startup quote), get a Desmos trial key, list 5–10 design-
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
  server-enforced write access (00589a7), G1. Left: games port, snapshot+asset survival
  (room assets are still in memory), and the smoke coverage in *Accept*.
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
7. Still Konrad's (blocking only where noted): the final name (blocks O5), tldraw's written
   confirmation (blocks charging money), and whether to pay for a lawyer pass on the policies.

## 8. Red-team record (adversarial review, 2026-10-20)

An imagined, hostile investor/VP challenged the plan. Each resolution below is binding. Don't
relitigate it without new evidence.

| # | Challenge | Resolution |
|---|---|---|
| R1 | "Zero users and you want a month of animations." | Conceded in part. Design foundation is a token swap with a **3-day cap**. Scramble is cut from tutor chrome. Whimsy lives where students and parents look. |
| R2 | "Why would a tutor leave Zoom + Bitpaper + Docs?" | They keep Zoom. The board has to beat Bitpaper on its home turf (**PDF on the board**) and then win with what nobody else has: live answer collection with stats. Neither is in the board today, so board parity jumps to O2. |
| R3 | "Who pays your customer? Parents. Tutors churn when parents don't see progress." | **The session summary** is the wedge. It's weekly, visible to the payer, and saves the tutor an hour. Konrad already promises families this by hand. |
| R4 | "The visual lesson builder is weeks of work tutors won't use; they teach from PDFs." | Cut to a composer. PDF import, AI import (exists), and bank problems cover authoring. |
| R5 | "Your core canvas has an unpublished price. What if it eats your margin?" | Researched (§5). The pinned tldraw 3.15.5 licence allows commercial use with the watermark: $0, but get it confirmed in writing and never upgrade to 4.x unpaid. Desmos is $100/mo; superseded by R14. |
| R14 | "You're building a Desmos clone? That's a legal and engineering sinkhole." (2026-10-21) | Konrad's call: own the calculator. **Clean-room only** (GRAPH-SPEC §0): public docs and observation, never their code. Two facts make it viable. (1) Desmos's own math-input field is open source (MPL-2.0), so the typing feel is licensed, not copied. (2) The SAT calculator is standard Desmos minus images, folders and notes, so the target is fully documented. Phased by SAT usage (G1 board → G2 SAT core → G3 breadth). It also removes the Desmos sync hack and the $100/mo. |
| R6 | "Tutors want *their* brand in front of parents, not yours." | White-label student/parent surfaces. The product is a small footer mark, which is also the referral loop. |
| R7 | "Your own students are 10. COPPA." | Data minimisation by default (first name, no child email, tutor-owned parent contact), a consent attestation, and policies before partners. |
| R8 | "You're cloning Bluebook. That's College Board's mark." | Rename to "digital-SAT-style" everywhere. Fidelity of behaviour, not branding. |
| R9 | "Eight phases and no outside user until phase six." | Konrad dogfoods from O2. Design partners arrive at O5 (~week 6). Public launch only after partners retain. |
| R10 | "What number proves it works?" | Weekly closed loops per tutor; 4-week partner retention; prepaid founding years. |
| R11 | "Don't build billing before anyone pays. But don't skip learning what they'll pay." | A Stripe Payment Link for founding-year prepay (no code). Real billing only after ≥3 pay. |
| R12 | "Will coral and dice look childish to a $150/hr SAT tutor?" | The base is stark editorial; the play is math-literate (Euler, Pythagoras, Penrose), not cartoons, and stays off tutor work surfaces. Validate with partners in O5; the tokens make toning it down a one-file change. |
| R13 | "One Node process with in-memory rooms. Scale?" | Fine to hundreds of tutors on one paid instance. Sticky routing by board id is a later problem, noted and not built. |
