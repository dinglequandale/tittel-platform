# HANDOFF — Slate (tittel-platform) fix + feature + UI pass

**Audience:** a Claude Code session (Sonnet-class) executing this work autonomously.
**Source:** full-codebase audit performed 2026-07-16/17 (every file in `apps/`, `packages/`, `db/` was read). Findings verified against code; file:line references were accurate at commit `10aebe1`.

Work through the phases **in order** (A → G). Commit at the end of each phase with a message like `Fix pass A: correctness (HANDOFF.md)`. Do not start a later phase with an earlier one broken.

---

## 0. Ground rules & environment

- **Read `PLAN.md` sections lazily** — it is the product spec (§5 schema, §6 modules, §8 design system). Don't read it whole; grep for the section a task cites.
- **Tenancy is sacred.** Every tenant-scoped SQL goes through `orgQuery` / `studentQuery` / `attemptQuery` (`apps/server/src/db.ts`). Raw `pool.query` is only for token-keyed lookups already guarded upstream, and for `db.ts`/`migrate.ts`/board internals. Preserve this pattern in ALL new code.
- **IDs/tokens:** use `newId()` / `newToken()` from `@tittel/shared`. Soft-delete = set `archived_at`; never hard-delete tenant rows (tags are the current exception).
- **Schema changes:** `db/schema.sql` is applied on every boot and uses `create table if not exists` — **adding a column to an existing table does nothing on an existing DB**. Every new column must ALSO get an idempotent `alter table X add column if not exists Y ...;` statement at the bottom of `schema.sql` (create a `-- migrations (idempotent)` section).
- **Environment:** Windows 11. The Bash tool is Git Bash; `npm` works from it. Dev server: `npm run dev` (server :6060, web :5373). The server runs TS directly via `tsx` — no build step for the server.
- **Verification loop after every phase:**
  ```
  npm run typecheck        # all 4 workspaces must pass
  npm test                 # grade tests + server smoke test
  ```
  For anything touching runtime behavior, also boot `npm run dev` and exercise the changed flow (a `DATABASE_URL` pointing at the dev Supabase instance is in `.env` / `apps/server/.env`).
- **Don't gold-plate.** Match existing code style (no semicolons in web/server TS, single quotes, comments only for non-obvious constraints). No new abstractions unless a task calls for one.
- **When a task is ambiguous, prefer the smallest change that satisfies the acceptance criterion**, and note the judgment call in the commit message.

---

## Phase A — Correctness bugs (do first; these corrupt real usage)

### A1. `lessons` table is missing `created_at` → every Lessons route 500s on a fresh DB
- `db/schema.sql:120-129` defines `lessons` without `created_at`; `apps/server/src/routes/lessons.ts` selects `created_at` at lines 11, 21, 38, 54, 89.
- Fix: add `created_at timestamptz not null default now()` to the `create table` AND an idempotent `alter table lessons add column if not exists created_at timestamptz not null default now();`.
- ✅ Accept: `GET /api/tutor/lessons` works on a DB created from scratch by `npm run migrate`.

### A2. `multi` problems can never be graded correct
- Editor sends `correct` as a plain string (`apps/web/src/content/ProblemsTab.tsx:126` — `correct: draft.correctText`), but the grader requires an array for `multi` (`packages/shared/src/grade.ts:81-89`).
- Fix in the editor: when `draft.type === 'multi'`, split `correctText` on commas into an array of choice ids (`correct: draft.correctText.split(',').map(s => s.trim()).filter(Boolean)`), and change the field label to "Correct choice ids (comma-separated)". Update `toDraft` to join an array back into comma-separated text.
- Also add server-side validation in `problems.ts` POST/PATCH: if `type === 'multi'` and `correct` is present but not an array, 400.
- ✅ Accept: create a multi problem with correct = `A, C`; run an attempt answering A+C → graded correct; answering A only → incorrect. (Test through `gradeResponse` directly if a full attempt is awkward — but at minimum run the runner flow once in dev.)

### A3. Opening an attempt link starts the timer via GET (email scanners burn the clock)
- `apps/server/src/routes/attempt.ts:74-81` flips `pending → active` inside `GET /:token`.
- Fix: remove the auto-start from GET. Add `POST /:token/start` that performs the pending→active transition (keep the `where started_at is null` guard). GET should return `status: 'pending'` untouched, with `remainingSec` = full limit.
- Runner UI (`apps/web/src/runner/RunnerPage.tsx`): when payload status is `pending`, render a start screen — assignment title, student name, question count, time limit ("25 minutes · 12 questions") and a **Begin** button that POSTs `/start` then reloads the payload. Keep the existing auto-expiry logic for active attempts.
- ✅ Accept: GET the attempt URL twice → status stays `pending` and `started_at` stays null; after Begin, timer runs and expiry still auto-grades.

### A4. Archived assignments remain visible/runnable for students
- `apps/server/src/routes/portal.ts:15-34` and `attempt.ts:18-29` (`loadAttempt`) never filter `assignments.archived_at`.
- Fix: add `and asg.archived_at is null` to both queries. In the portal this simply hides the row; in `loadAttempt` a 404 is the right behavior for an archived assignment's attempt link.
- ✅ Accept: archive an assignment → it disappears from the student portal and its `/hw/:token` link 404s.

### A5. Vite dev proxy misses the board websockets and uploads → boards broken in dev
- `apps/web/vite.config.ts:17-19` proxies only `/api`. The board client hits `/connect/*`, `/control/*` (WS — `BoardCanvas.tsx:28-31`, `controlChannel.ts:37-40`) and `/uploads/*` (`assetStore.ts:9`) on the Vite origin.
- Fix:
  ```ts
  proxy: {
    '/api': { target: SERVER },
    '/uploads': { target: SERVER },
    '/connect': { target: SERVER, ws: true },
    '/control': { target: SERVER, ws: true },
  }
  ```
- ✅ Accept: `npm run dev`, open `/try`, start a board → canvas connects (no WS errors in console); paste an image → renders.

### A6. Lesson export can 500 on ordinary titles (header injection)
- `apps/server/src/routes/lessons.ts:104` interpolates the raw title into `Content-Disposition`.
- Fix: sanitize — `const safe = rows[0].title.replace(/[^\w .-]+/g, '_')` and use `filename="${safe}.json"`.
- ✅ Accept: export a lesson titled `He said "hi" / ümlaut` → downloads instead of erroring.

### A7. Signup dead-ends when Supabase email-confirmation is on
- `apps/web/src/auth/Signup.tsx:16-24` navigates to `/app` after `signUp`; with confirmation enabled there is no session and RequireAuth silently bounces to `/login`.
- Fix: inspect the `signUp` result — if `data.session` is null, render a "Check your inbox — we sent a confirmation link to {email}" state instead of navigating. If a session exists (confirmation off), navigate as today.
- ✅ Accept: with a fake email and confirmations on, the user sees the check-inbox message.

### A8. Org bootstrap race creates duplicate orgs / 500s on first login
- `apps/server/src/auth.ts:52-65` does select-then-insert with no guard, and first page loads fire parallel requests (StudentsPage alone fires two).
- Fix: wrap the bootstrap in insert-with-conflict handling: `insert into users ... on conflict (supabase_uid) do nothing returning ...`; if the insert returned no row, re-select the user (someone else won the race) and **delete the just-created orphan org** (or better: create the org only after winning the user insert — restructure to: insert user with a fresh org id inside a transaction; on conflict, rollback and re-select).
- ✅ Accept: simulate two concurrent first requests (e.g. `Promise.all` of two fetches in a scratch script) → exactly one `orgs` row and one `users` row exist afterwards.

---

## Phase B — Security

### B1. WS host-role bypass on persistent boards (most important security fix)
- `apps/server/src/index.ts:33-45` (`resolveConnection`): when no `boardToken` is supplied, `?role=host` is honored **even for persistent boards**. Anyone with a board id can seize host: camera control, write-access grants, quiz answer keys/stats, game control.
- Fix: the `role`-query-param fallback must only apply when `persistent === false`. For a persistent board with no valid token, force `role: 'guest'` (or reject the control-channel connection entirely — guest-forcing is friendlier and matches the join-page flow).
- ✅ Accept: connect to `/control/<persistent-board-id>?role=host` with no token → treated as guest (verify: host-only messages like `camera` are ignored / quiz-stats not sent).

### B2. Asset upload DoS + permanent room leak
- `apps/server/src/board/assets.ts:17-24`: unauthenticated 50 MB POSTs, unbounded count, in-memory forever; uploading to a nonexistent board id creates a `Room` via `getOrCreateRoom` that is **never garbage-collected** (close is only scheduled on socket disconnect, `rooms.ts:132-134,154-157`).
- Fix (keep it proportionate):
  1. In the upload handler, don't call `getOrCreateRoom`. Only accept uploads for a room that is **already live** (`getRoom(...)`) — a real client always has the WS open before pasting an image. 404 otherwise.
  2. Cap per-room asset storage (e.g. 100 MB total, constant at top of file); reject with 413 beyond that.
  3. Drop the raw-body limit from 50 MB to 20 MB.
- ✅ Accept: POST to `/uploads/nonexistent-board/x` → 404 and `rooms` map unchanged; a live board still accepts pasted images.

### B3. Board-token secret dies on every deploy
- `apps/server/src/board/boardToken.ts:11-13`: random per-boot secret → every restart mid-lesson invalidates all tokens.
- Fix: `const secret = new TextEncoder().encode(process.env.BOARD_TOKEN_SECRET || <current random fallback>)`. Add `BOARD_TOKEN_SECRET` to `apps/server/.env.example` (comment: any long random string) and to `render.yaml` env vars (`sync: false`... actually use `generateValue: true` — Render supports it).
- ✅ Accept: with the env var set, tokens verify across a server restart.

### B4. Student responses accepted for arbitrary problem ids
- `apps/server/src/routes/attempt.ts:127-142`: `problemId` is never checked against the attempt's set → cross-org rows + analytics pollution.
- Fix: before the insert, verify `problemId` is in the set: `select 1 from set_problems where set_id = $1 and problem_id = $2`; 400 if not. (One extra query per autosave is fine at this scale.)
- ✅ Accept: POST a response with a foreign problem id → 400; normal runner autosave still works.

### B5. DB TLS `rejectUnauthorized: false`
- `apps/server/src/db.ts:22`. Supabase poolers present a valid cert chain in most regions now, but this can be environment-dependent. Change to: honor `PGSSLMODE=no-verify` env override, default to `{ rejectUnauthorized: true }`. **Test against the real DATABASE_URL before committing**; if the pooler cert fails verification, keep `rejectUnauthorized: false` but leave a `TODO(security)` comment explaining why and add the env override path anyway.

### B6. Sanitize stored figure SVG (stored XSS → students)
- `ProblemsTab` posts back client-supplied `figures[].svg` and it's stored verbatim, later injected via `dangerouslySetInnerHTML` in runner/review.
- Fix server-side in `problems.ts` POST/PATCH: for any figure with an `svg` field, re-render it from its `latex` via `renderFigureSvg` (ignore the client-supplied svg). This both sanitizes and guarantees svg↔latex consistency. Skip re-render when the latex is unchanged from the stored row (PATCH) to avoid needless tikz work.
- ✅ Accept: saving a problem with a tampered `svg` field stores the server-rendered SVG instead.

### B7 (note, no action). The tldraw sync socket accepts writes from any guest (client-side-only locking). Fixing properly means passing `isReadonly` per-session and rewiring grants through the sync layer — **out of scope for this pass**; leave a `TODO(security)` in `apps/server/src/index.ts` above `handleUpgrade` documenting it.

---

## Phase C — Logic & UX repairs (existing features)

### C1. Links must be copyable, absolute, and recoverable
This is the single biggest tutor-workflow gap. Three parts:

1. **Shared `CopyButton` component** in `packages/ui` (new file `components/CopyButton.tsx`, export from `index.ts`): small button, `navigator.clipboard.writeText`, flips to "Copied ✓" for ~1.5s. Style with existing `.btn btn-ghost`.
2. **Absolute URLs everywhere a link is shown**: `${window.location.origin}/s/${token}`, `/hw/`, `/b/`. Replace the bare `<code>` renderings in `StudentsPage.tsx:107` and `AssignmentsPage.tsx:155`.
3. **Recoverable attempt links**: add `GET /api/tutor/assignments/:id/links` (org-scoped join `attempts` × `students`, returns `{studentName, attemptToken, status}`), and a "Links" button per assignment row in `AssignmentsPage` that opens the same dialog used at creation time.
- ✅ Accept: every student/assignment/board link in the tutor app is a full URL with a copy button; links for an old assignment are retrievable.

### C2. Runner improvements (student-facing quality)
- **Question palette**: a row of numbered chips above the card — filled = answered, star = marked-for-review, outlined = current; click to jump. Data is already client-side.
- **Submit confirmation**: on Submit with unanswered questions, confirm (`Dialog`, not `window.confirm`): "3 questions unanswered — submit anyway?".
- **Flush on unload**: in `save()`'s debounce path, also listen for `pagehide`/`visibilitychange(hidden)` and flush the pending answer + time delta via `navigator.sendBeacon('/api/attempt/<token>/response', blob)` (the endpoint already accepts JSON; sendBeacon posts `Content-Type: text/plain` by default — construct a `Blob([json], {type: 'application/json'})`).
- **Low-time warning**: timer badge turns `--incorrect` colored under 60s.
- **Due date surfaced**: show `due_at` on the start screen (from A3) and in the portal rows (already there). Server-side enforcement stays out of scope — tutors may want late work; just show it.
- ✅ Accept: palette navigates, mark-for-review is visible on the palette, closing the tab within the debounce window doesn't lose the last answer (verify via responses row in DB or a reload).

### C3. PATCH endpoints can't clear fields
- Adopt the explicit-null convention: in `students.ts`, `problems.ts`, `problemSets.ts`, `lessons.ts` PATCH handlers, distinguish `undefined` (absent → keep) from `null` (clear). Pattern: build the SQL with `coalesce` replaced by CASE-free approach — simplest is dynamic: `email = case when $n::boolean then $m else email end` gets ugly; instead do what the codebase would find idiomatic: pass two params per nullable field (`hasField boolean`, `value`), e.g.
  ```sql
  email = case when $4 then $5 else email end
  ```
  with `[..., email !== undefined, email ?? null, ...]`. Keep it mechanical and consistent.
- Web: add an **Edit student** dialog in `StudentsPage` (name/email/notes) using PATCH — the endpoint is currently unreachable from the UI.
- ✅ Accept: clearing a student's email in the edit dialog persists `null`.

### C4. Feedback layer: mount toasts, catch errors, confirm destructive actions
1. Mount `ToastProvider` + `ToastViewport` once in `AppShell`. Create a tiny `useToast()` hook (context with `push(message)`) — keep it under ~40 lines; it can live in `apps/web/src/lib/toast.tsx`.
2. Every mutation currently un-`catch`-ed (`archiveStudent`, `remove` tag, `addMember`, `removeMember`, `archive` in ProblemsTab/LessonsTab/AssignmentsPage/LivePage, `reorder`/`addProblem`/`removeProblem` in SetsTab) gets `.catch` → toast the error message. Successes that give no visual change (copy, import) toast a confirmation.
3. **Confirm before archive/delete** everywhere: one shared `ConfirmDialog` (in `packages/ui` or web-local) — "Archive {name}? Students lose access to it." Used by: student archive, group delete (also **add the missing group-delete button** — endpoint exists at `DELETE /groups/:id`), tag delete, problem archive, set archive, lesson archive, assignment archive, board archive.
- ✅ Accept: failing mutation shows a toast; archiving anything asks first.

### C5. Loading & busy states
- Pages render `null` while fetching. Add a minimal shared `<PageLoading />` (centered muted "Loading…" — no spinner library) used by Students/Content tabs/Assignments/Live.
- Disable submit buttons while their async handler runs (`NewStudentDialog`, `NewGroupDialog`, `NewSetDialog`, `NewBoardDialog`, `NewAssignmentDialog` — pattern already exists in ProblemsTab's `saving`).
- ✅ Accept: double-clicking "Create" in any dialog creates exactly one row.

### C6. Misc small fixes
- `POST /lessons` must validate `doc` through `parseLessonDoc` when a doc is supplied (`lessons.ts:29-42`) — same as import.
- `PUT /problem-sets/:id/order` wraps its updates in a transaction (`begin`/`commit` on one client).
- `/api/health`: return `ok: false` + HTTP 503 when the DB ping fails (`app.ts:33-40`).
- FRQ scoring honesty: in review + portal + analytics, exclude `frq` problems from the auto-graded denominator and show them separately ("2 free-response answers not auto-graded") instead of silently making 100% impossible. Smallest viable change: compute `total` as non-frq count and add an `frqCount` field to the payloads.
- "Free reign" → "free rein" in `BoardCanvas.tsx` UI strings (internal variable names may stay).
- `ShareControl` in `BoardCanvas.tsx`: don't permanently hide after copy — keep the control visible, collapse to a small "🔗 Copy link" dock button after first copy (or simply never hide it).
- Rename `CLAUDE.md.md` → `CLAUDE.md` (git mv).
- Raise `express.json` limit to `'8mb'` in `app.ts` (figure-heavy imports; keep the AI-import route's own larger limit separate, see E).

---

## Phase D — Feature: student/group ↔ whiteboard flow

**Intent (from Konrad):** when creating (or viewing) a student, optionally get a persistent board tied to that student, whose link he can copy right before a lesson. Group-class students share one fixed board via their group/class. The schema already supports this: `boards.student_id`, `boards.class_id`, `classes.group_id` exist and are unused by the UI.

### D1. Server
- `POST /api/tutor/students/:id/board` — get-or-create: return the newest non-archived board with `student_id = :id`; if none, insert one (`title = '<student name> — board'`, `is_ephemeral = false`). Org-scoped via `orgQuery`. Return `{ boardId }`.
- `POST /api/tutor/groups/:id/board` — same pattern keyed on a class: get-or-create a `classes` row for the group (`group_id = :id`, `mode = 'large'`, `slug = group id`, name = group name), then get-or-create its board (reuse the logic in `POST /classes/:id/start` at `board.ts:76-110`, minus the sessions row). Return `{ boardId }`.
- Extend `GET /students` to include each student's board id via a lateral/left join (newest non-archived board per student), so the list can render the link without N+1 calls. Same for `GET /groups`.

### D2. Web
- **StudentsPage**: new "Board" column. If the student has a board → full URL + CopyButton + "Open". If not → "Create board" button hitting D1. In the **NewStudentDialog**, add a checkbox "Also create their whiteboard" (default on) — after student creation, call the board endpoint.
- **Groups cards**: same affordance per group ("Group board: <link> [copy] [open]" / "Create group board").
- **LivePage**: show whose board each row is — join info is available if `GET /boards` gains `student_name` / `class name` via left joins (extend the query in `board.ts:11-20`).
- ✅ Accept: create a student with the checkbox on → board exists, link copyable from the table, opening it as the logged-in tutor lands as host (existing `/api/board/:id/token` flow already handles this); a guest opening the same link lands as guest. Group flow: two members share one URL; name-gate appears (class mode `large`).

---

## Phase E — Feature: AI lesson-plan / worksheet import

**Intent:** tutors author lesson plans and worksheets as PDF / Word docs (confirmed standard practice). Manual problem entry is too slow to be the funnel. Upload a document → Claude converts it into bank problems + a problem set draft → tutor reviews/fixes in a preview UI → confirm writes to the bank. **Nothing is written to the DB until the tutor confirms.**

### E1. Dependencies & config
- `apps/server`: add `@anthropic-ai/sdk` and `mammoth` (DOCX → text; PDFs need no parser — Claude accepts PDF document blocks natively).
- Env: `ANTHROPIC_API_KEY` in `apps/server/.env.example` + `render.yaml` (`sync: false`). If unset, the endpoint returns 503 `{ error: 'AI import is not configured' }` and the UI hides the feature (feature-detect via a `GET /api/tutor/ai-import/status` → `{ enabled }`).

### E2. Server — `apps/server/src/routes/aiImport.ts` (mounted under `/api/tutor`)
- `POST /ai-import` with route-level `express.json({ limit: '40mb' })`. Body: `{ filename, mimeType, dataBase64 }` (client base64s the file) plus optional `hint` (free-text from the tutor, e.g. "SAT math, answers are on the last page").
- Extraction path by type:
  - `application/pdf` → pass straight through as a document content block (`{type:'document', source:{type:'base64', media_type:'application/pdf', data}}`). Reject > ~30 MB or > 100 pages worth (let the API error surface if page count is exceeded).
  - `.docx` → `mammoth.extractRawText` → text block.
  - `text/plain`, `text/markdown` → text block.
  - anything else → 415.
- **Model call** (TypeScript SDK, default client reads `ANTHROPIC_API_KEY`):
  - Model: `claude-haiku-4-5` (deliberate lightweight choice per Konrad). Put the model id in one exported const so bumping to `claude-sonnet-5` is a one-line change if extraction quality is insufficient.
  - Use **structured outputs**: `client.messages.parse(...)` (or `messages.create` with `output_config: { format: { type: 'json_schema', schema } }`) so the response is guaranteed-valid JSON. Haiku 4.5 supports structured outputs.
  - Schema (define once, keep in the route file):
    ```jsonc
    {
      "type": "object", "additionalProperties": false,
      "required": ["title", "problems"],
      "properties": {
        "title": { "type": "string" },
        "problems": { "type": "array", "items": {
          "type": "object", "additionalProperties": false,
          "required": ["type", "stemLatex"],
          "properties": {
            "type": { "enum": ["mc", "multi", "numeric", "text", "frq"] },
            "stemLatex": { "type": "string" },
            "choices": { "type": "array", "items": { "type": "object", "additionalProperties": false, "required": ["id", "content"], "properties": { "id": {"type":"string"}, "content": {"type":"string"} } } },
            "correct": { "type": ["string", "null"] },
            "correctMulti": { "type": "array", "items": { "type": "string" } },
            "accept": { "type": "array", "items": { "type": "string" } },
            "explanationLatex": { "type": ["string", "null"] },
            "answerConfidence": { "enum": ["found", "inferred", "missing"] }
          }
        }}
      }
    }
    ```
    (Structured outputs require `additionalProperties: false` everywhere. `correctMulti` is separate because `correct`'s union typing across problem types is awkward in one field — server maps it onto `correct` per type.)
  - System prompt essentials: convert math to `$...$` KaTeX inline / `$$...$$` display; preserve problem order; if the document contains an answer key, match answers to problems and set `answerConfidence: "found"`; if the answer is worked out in the text but not keyed, `"inferred"`; if absent, `"missing"` and leave `correct` null; questions requiring shown work / open response → type `frq`; never invent choices that aren't in the document; figures/diagrams cannot be imported — where one is referenced, add `[figure not imported]` to the stem.
  - `max_tokens: 16000`. No `thinking` config needed on Haiku (default off is fine).
- Response to client: `{ draft: { title, problems: [...] } }` — **no DB writes**.
- `POST /ai-import/commit`: body is the (possibly tutor-edited) draft in the same shape; server validates types/choices server-side (reuse the constraints in `problems.ts`), then inside one transaction creates problems + a set + `set_problems` rows (mirror `legacyImport.ts:31-87`, `source = 'ai-import:<filename>'`). Returns `{ setId, problems }`.
- Error handling: wrap the API call, surface Anthropic SDK errors as 502 with a readable message; use the SDK's typed error classes, not string matching.

### E3. Web — import flow in the Content → Sets tab
- Next to "Import JSON": **"Import from document (AI)"** button (hidden when status endpoint says disabled). File picker accepts `.pdf,.docx,.txt,.md`.
- On upload: optional hint text field + progress state ("Reading your document…" — call takes seconds to ~a minute).
- **Preview screen** (this is the critical UX): a full-width review list, one card per extracted problem — stem rendered via `RichText`, type badge, choices listed, `correct` shown as an **editable input** highlighted amber when `answerConfidence !== "found"`, delete-this-problem button, and a top summary line ("14 problems · 11 answers found · 2 inferred · 1 missing"). Set title editable. Buttons: **Add to bank** (POST commit → toast + open the new set in SetsTab) / **Discard**.
- Keep the preview component in a new file `apps/web/src/content/AiImportReview.tsx`.
- ✅ Accept (manual): import a real PDF worksheet (ask Konrad to drop one at `scratch/sample-worksheet.pdf` if none is around; otherwise generate a 2-page test PDF with 4 MC questions + answer key and run it through). Verify: preview renders KaTeX, editing a correct answer persists into the committed problem, committed set appears in Sets with working runner grading.
- Cost note (for commit message / docs): Haiku 4.5 is $1/$5 per MTok — a 10-page worksheet ≈ well under $0.01 per import.

---

## Phase F — UI overhaul

**Before touching any UI in this phase, invoke the `frontend-design:frontend-design` skill** (it is installed as a plugin) and apply its guidance *within these constraints*:

- `packages/ui/src/tokens.css` is the **binding** design contract (PLAN.md §8.2): warm paper surfaces, one deep-pine accent, Fraunces display / Inter body, two elevation tokens max. Its ban list (blue-purple gradients, glassmorphism, emoji icons, rounded-2xl-everything, >1 accent) stays law. The overhaul means *executing* this system properly, not inventing a new direction.
- Dark theme tokens exist (`:root[data-theme='dark']`) but there's no toggle — adding one is optional/last.

Work items, roughly in impact order:

### F1. Ship the fonts (single highest-impact fix)
- Self-host **Fraunces** (variable, incl. italic if cheap) and **Inter** (variable) as woff2 under `packages/ui/src/fonts/`, add `@font-face` rules in `tokens.css` (`font-display: swap`), resolving the TODO at `tokens.css:6-8`. Vite serves package CSS-relative assets fine (`fs.allow` already covers it) — verify the woff2 URLs resolve in dev AND in `vite build` output.
- Files come from Google Fonts / the projects' GitHub releases (both OFL). Subset to latin if convenient; don't over-engineer.

### F2. Unify the board surfaces onto the token system
- `apps/web/src/board/board.css` is legacy blue (#2563eb, blue glow shadows, slate grays). Restyle to tokens: `--board-brand` → `var(--accent)`, shadows → `--shadow-1/2`, grays → ink/line/surface tokens, radii → `--radius-control/card`. The board **canvas** (tldraw) stays as-is; this is about landing page, name gate, dock, calculator/timer panels, share control.
- Replace dock emoji (🔒 ⏱ 🧮 📄, `BoardCanvas.tsx:295-307`) with lucide icons (`Lock`/`Unlock`, `Timer`, `Calculator`, `FileDown`) — lucide-react is already a dependency.
- `/try` landing (`TryLanding.tsx` + board.css): restyle with tokens + Fraunces heading. It's the public demo — it should look like the product.

### F3. Component polish (`packages/ui/src/components.css`)
- `.dialog-content`: `display:flex; flex-direction:column; gap: var(--space-4); max-height: 85vh; overflow-y: auto; width: min(480px, 92vw)`.
- Define the missing `.page` class (used by runner/portal/review): centered column, `max-width: 720px`, padding, plus a `.page-card` if useful. Give the runner/portal/review loading/error states real styling.
- `Field`: generate an id, associate `<label htmlFor>` with the child input (clone or context — smallest change wins). Add `DialogDescription` support and use it where dialogs need explanatory text (silences Radix a11y warning — pass `aria-describedby={undefined}` where genuinely none).
- Replace the native `<select className="input">` in ProblemsTab with the Radix `Select` for consistency.
- Badge remove-buttons (×) get a real style (`.badge-x`: hover bg, focus ring, cursor).
- Table wrapper gets `max-height` + sticky header actually working where lists are long (students, assignments).

### F4. Page-level layout & responsiveness
- Move repeated inline styles into `styles.css` classes (`.stack-*`, `.row-*`, or extend existing helpers — pick one convention and sweep the pages).
- Shell: below `900px`, collapse the sidebar to a top bar or icon rail (`@media` in components.css; keep it simple — the tutor app is desktop-first, it just must not be broken on a laptop half-screen).
- `split-panel` stacks to one column below `~800px`.
- Portal / runner / review (student-facing, phone-first): audit at 375px width; portal gets a small Slate wordmark header (`BRAND_NAME` in Fraunces) so students see a branded page; review cards readable on mobile.
- Home dashboard: replace the bare empty state with a minimal "quick actions" card row (New student / New assignment / Start a board → link to the right pages) + the same welcome copy. No data queries yet (that's PLAN Phase 5) — just make the first screen not feel dead.

### F5. Micro-interactions
- Consistent hover/active/focus-visible on all interactive elements (several custom buttons lack focus styles).
- Dialog/popover enter animations using the existing `--duration-panel`/`--ease` tokens (respect `prefers-reduced-motion` — already globally handled).
- Timer low-time state (ties into C2).

- ✅ Accept for the phase: `npm run build` succeeds; a click-through of every page in dev shows no Georgia-serif headings, no blue board chrome, no unstyled loading text, dialogs breathe, and the app is usable at 900px width. Screenshot-worthy pages: Home, Students, Content/Problems, a live board, the runner.

---

## Phase G — Wrap-up

1. `npm run typecheck && npm test` green.
2. Extend `apps/server/test/smoke.mjs` with cheap additions only: assert `/api/health` 503-when-no-DB behavior change didn't break the no-DB dev case (it runs without DATABASE_URL — health should now report `ok:false`; update the existing assertion accordingly), and assert unauthenticated `/api/tutor/students` → 401.
3. Update `CLAUDE.md` (renamed in C6) with a short "project facts" section: run commands, tenancy rule, schema-migration rule (the `alter table if not exists` convention from Phase 0), and the AI-import env var.
4. Final commit; summarize per-phase outcomes and any deliberately skipped items in the last commit body.

## Explicitly OUT of scope (do not do)
- Server-side enforcement of tldraw read-only (B7 — TODO comment only).
- Supabase-Storage-backed board assets (in-memory stays; PLAN tracks it).
- FRQ manual-marking UI, analytics module, settings module, billing (later PLAN phases).
- Google OAuth button.
- Dark-mode toggle (tokens exist; toggle optional only if F finishes early).
- Any rewrite of the ControlChannel/game/quiz protocol.
