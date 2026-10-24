# FLOW-SPEC — one connected weekly loop

**Written:** 2026-10-24, from Konrad's direction ("centralized, cohesive, minimal friction; the
week's lessons are the most important thing") and a code-level audit of how the app works today.
**Status:** proposal for Konrad's sign-off. It reshapes OVERHAUL.md O3 and the Home/nav parts of
O6, and reverses PLAN.md §13.8 ("scheduling integrations deferred"). Nothing here changes the
design language (OVERHAUL §1–2) or the board work (O2, GRAPH-SPEC).

---

## 0. Diagnosis: the app is organised by database table, not by the tutor's week

The sidebar is Students · Content · Live · Assignments · Analytics: one page per table. A tutor's
week is a list of *lessons*: Maya Thursday at 4, the Algebra group Saturday at 10. Nothing in the
app knows when a lesson is, and nothing ties a plan, a board, homework and a meeting link to the
same lesson.

**Today, preparing and teaching one lesson (Maya, Thursday 4pm, with a plan and homework):**

| Step | Where | What the tutor does |
|---|---|---|
| 1 | Content → Lessons | Imports a plan as JSON. It can't reach the board (lesson load isn't ported), so it's a JSON viewer. |
| 2 | Content → Problem sets | Generates a set from the worksheet, reviews it, adds it to the bank. |
| 3 | Assignments → New | Picks the set, picks Maya, un-ticks the default 15-minute timer, picks a due date. |
| 4 | Links dialog | Copies Maya's homework link, pastes it into a text or email. |
| 5 | Students | Copies Maya's board link, sends that too. |
| 6 | Google Calendar | Finds or creates the Meet link. Maya gets it from the invite. |
| 7 | Thursday, 4pm | Opens Calendar for Meet, opens the app → Students → Open board. |

That's five surfaces for the tutor and **three separate links for the student** (Meet, board,
homework), each arriving by a different channel. The `sessions` table exists but is only written
by a "Start class" endpoint the UI never calls. The four things that belong together (plan,
board, homework, meeting) are never joined.

**Other friction found in the code:**
- New homework defaults to a 15-minute timed test. Homework is almost always untimed and due at
  the next lesson.
- After AI import creates a set, the next step (assign it to someone) isn't offered.
- The "New" button only opens Content. The onboarding checklist teaches sets, not lessons.
- "Needs board" is a status tutors have to manage. Boards should simply exist.
- Live lists boards with no context. Analytics is separate from the students it describes.
- The student portal shows homework but not lessons, boards or meeting links.

## 1. The idea: the Lesson is the hub

Every artifact hangs off a lesson. You prepare *for* a lesson, teach *in* it, and send homework
*from* it. The next lesson automatically shows what came back.

```
             ┌──────────── Lesson: Maya · Thu 4:00–5:00 ────────────┐
  before ──▶ │ Plan (what we teach)      → pre-loaded onto her board │
             │ Homework going out        → appears on her portal     │
             │ Last homework coming back → 6/10, missed Q3, Q7       │
  during ──▶ │ Join: meeting link + board, one click each side       │
  after  ──▶ │ Notes, summary for parents (O3), follow-up            │
             └───────────────────────────────────────────────────────┘
```

### 1.1 Vocabulary (fixes a real naming collision)

Today "Lesson" means a lesson-plan document. Tutors, and Konrad, use "lesson" to mean the class
meeting. The UI follows the tutor:

| UI word | Meaning | Table |
|---|---|---|
| **Lesson** | One scheduled meeting with a student or group, at a time | `sessions` (extended, §4) |
| **Plan** | What you teach: pages for the board (LessonDoc, later PDF pages) | `lessons` (unchanged) |
| **Homework** | Problems the student does between lessons | `assignments` |
| **Student link** | The portal. The only link a student or parent ever needs | `students.portal_token` |

Table names stay as they are, because renaming them buys nothing. Only UI copy changes, and the
mapping above goes in a code comment at the top of the sessions routes.

## 2. Surfaces

### 2.1 Home = "This week"

The first screen, every time.

- **Today:** a card per lesson. It shows time, student or group (palette avatar), a **Plan chip**
  ("Quadratics II ✓" or "+ Plan"), a **Homework chip** ("Due Tue ✓" or "+ Homework"), last
  homework's score with its trend, and a **Start** button that becomes primary 10 minutes before.
- **This week:** the remaining days as compact rows with the same chips. Empty chips are the
  to-do list: a glance shows what still needs prep.
- **Needs attention:** homework submitted (with score), overdue, under 60%. Clicking goes to the
  student's *next* lesson, where the results already sit.
- **Unmatched calendar events** (once §3 B lands): "Tue 5pm 'Ethan SAT' — who is this?" One
  click links it and remembers the link for the whole recurring series.
- Empty state: "Connect your calendar" or "Schedule a lesson", with one MathArt card.

### 2.2 Lesson (a drawer over Home, and a page at `/app/lessons/:id`)

The single place where prep happens. Nothing here sends the tutor to Content.

- **Header:** who, when, meeting link (editable; defaults from the student, then the tutor).
- **Plan slot**, four ways in, in order of how tutors work: drop a PDF (pages go onto the board,
  O2), generate from a document (existing AI import), pick from the library, or start blank. A
  plan created here is saved to the library automatically, and tagged with the lesson.
- **Homework slot:** drop a worksheet (AI import → review → done), pick a set from the library,
  or pick bank problems. Defaults: **untimed, due at the start of the next lesson with this
  student**, assigned to the lesson's student (or every group member). Saving assigns it: it
  appears on the student's portal right away. A "hold until class ends" toggle exists for tutors
  who don't want it seen early. No links dialog; the portal is the delivery channel.
- **Last homework:** results inline. "Draft review plan" fills *this* lesson's plan slot (O3
  seam).
- **After the lesson:** notes and the parent summary (O3).

### 2.3 Start / Join: one click on each side

- **Tutor presses Start:** the meeting link opens in a new tab and the current tab goes to the
  student's board, with the plan already loaded as new pages (O2 lesson-load). The lesson becomes
  `live`. One `window.open` plus one navigation, because browsers block a second popup from one
  click.
- **Student:** the portal shows "Today 4:00 · **Join lesson**" from 15 minutes before. Same
  pattern: meeting in a new tab, board in this one. Students and parents keep one permanent link,
  sent once, ever.
- **End:** closing the board (or "End lesson") marks it `done`, persists the session (O3), and
  releases held homework.

### 2.4 Student page (`/app/students/:id`, OVERHAUL §3 record page)

The second hub, for a person: upcoming lessons, past lessons as a timeline (plan, homework score,
summary), mastery, and defaults (meeting link, weekly slot, parent contact). Analytics per student
lives here rather than on its own page.

### 2.5 Library (was Content)

Plans · Problem sets · Problem bank · Tags. Still the place to browse and reuse, but no longer
where work starts. Every item shows where it's used ("Maya · Thu 23 Oct").

### 2.6 Navigation

| Before (7) | After (5) |
|---|---|
| Home · Students · Content · Live · Assignments · Analytics · Settings | **This week** · Students · Library · Insights · Settings |

- **Live** goes away. Boards are reached from lessons and students, and the free quick board is a
  "New" menu item.
- **Assignments** folds into lessons, students, and a Homework tab (a gradebook) in Insights.
- **Analytics** becomes **Insights**: cross-student views (mastery matrix, engagement).
- **"New" becomes a menu:** Lesson · Student · Homework · Quick board.

## 3. Calendar and meeting links, staged

Konrad's schedule already lives in Google Calendar. The goal is that opening the app shows the
week without retyping it. Three stages, cheapest first:

**A. Native schedule (ships with the hub, no integration).** "Schedule lesson" with weekly repeat,
because most tutoring is a fixed weekly slot. Meeting link: a tutor default in Settings (a Zoom
personal room or a reusable Meet link) plus a per-student override. Zero OAuth, works for Zoom
and Meet users alike.

**B. Read Google Calendar via its secret iCal address (quick: ~1–2 days).** Google gives every
calendar a private "Secret address in iCal format" (Settings → the calendar → Integrate
calendar). The tutor pastes it once. The server fetches it when Home loads (cached ~5 min),
expands recurring events for the next 7–14 days, and matches each event to a student:
1. attendee email = student or parent email;
2. else the student's name appears in the title;
3. else it goes to the unmatched inbox (§2.1), and the answer is remembered per series UID.

Meeting links come from the event itself (location, description or conference field). **To
verify on a real feed** whether Google's export carries the Meet URL in a dedicated property or
only in the description text. Caveats: the address is a credential (store and treat it like a
token, offer "reset" guidance); Google Workspace admins can disable it; it's read-only.

**C. Two-way Google Calendar + auto Meet links (after O5's Google sign-in).** OAuth with
`calendar.events`. Scheduling in the app creates the Google event with a Meet link
(`conferenceDataVersion=1` + `createRequest`), and can invite the parent. Costs: a sensitive
scope needs Google app verification for production (Testing mode caps at 100 users, and refresh
tokens expire after 7 days). Zoom meeting creation via Zoom's API is the same kind of work. Build
it only if partners ask.

**Recommendation:** A with the hub, B straight after. B covers "open the app and the week is
there" for Konrad today, without Google verification.

## 4. Data model (additive, idempotent per CLAUDE.md)

```sql
-- sessions become lessons: scheduled first, live later, done after.
alter table sessions alter column board_id drop not null;          -- a future lesson has no board yet
alter table sessions alter column started_at drop not null;        -- and hasn't started (scheduled rows insert null;
                                                                   -- keep the default so "start now" still stamps it)
alter table sessions add column if not exists student_id   text references students(id) on delete cascade;
alter table sessions add column if not exists group_id     text references groups(id) on delete cascade;
alter table sessions add column if not exists scheduled_at timestamptz;
alter table sessions add column if not exists duration_min int;
alter table sessions add column if not exists status       text not null default 'scheduled';  -- scheduled|live|done|cancelled
alter table sessions add column if not exists meeting_url  text;
alter table sessions add column if not exists plan_id      text references lessons(id) on delete set null;
alter table sessions add column if not exists calendar_uid text;   -- iCal UID + RECURRENCE-ID: idempotent import
alter table sessions add column if not exists notes        text;
create index if not exists sessions_org_sched_idx on sessions(org_id, scheduled_at);
create unique index if not exists sessions_org_cal_uid on sessions(org_id, calendar_uid) where calendar_uid is not null;

alter table assignments add column if not exists session_id text references sessions(id) on delete set null;
alter table assignments add column if not exists release_at timestamptz;  -- null = visible now; portal filters on it

alter table students add column if not exists meeting_url  text;
alter table students add column if not exists parent_email text;          -- tutor-owned contact (R7)

-- weekly repeat for stage A; rows are materialised ~3 weeks ahead, lazily on Home load
create table if not exists lesson_series (
  id text primary key, org_id text not null references orgs(id) on delete cascade,
  student_id text references students(id) on delete cascade, group_id text references groups(id) on delete cascade,
  weekday int not null, start_time time not null, duration_min int not null, tz text not null,
  meeting_url text, archived_at timestamptz, created_at timestamptz not null default now()
);
alter table sessions add column if not exists series_id text references lesson_series(id) on delete set null;
-- orgs.settings jsonb gains: timezone, default_meeting_url, ics_url (stage B)
```

The board stays **one persistent board per student** (or per group). A lesson doesn't get its own
board. Its plan is injected into that board as new pages named for the date. This keeps the
student's single link and gives a natural history: every past lesson's pages are still there.

## 5. The loop, end to end, after

| Moment | Tutor | Student |
|---|---|---|
| Sunday prep | This week → Maya's Thu card → drop the PDF in Plan, drop the worksheet in Homework → done. **One page.** | Homework appears on the portal immediately, due Thursday. |
| Thursday 4pm | This week → **Start** (meeting + board with the plan). | Portal → **Join lesson**. |
| After class | Board closes → lesson done → summary draft waiting (O3). | Sees homework (if held, now released). |
| Homework back | This week → Needs attention "Maya 6/10" → opens her *next* lesson, results inline → "Draft review plan". | Review page (O4 score moment). |

Under four clicks between any two steps, PLAN §3's original bar, now actually met.

## 6. Build order and how it fits OVERHAUL

| Phase | Scope | Depends on |
|---|---|---|
| **F1 Hub** (~4 days) | §4 schema; lessons API; This week Home; Lesson drawer with plan and homework slots (existing plan/set/AI-import paths); homework defaults and auto-assign; Start/Join (meeting + board; plan injection lands with O2); portal "Join lesson" and upcoming; Settings meeting link; nav 7 → 5 with the New menu | nothing; parallel with O2 (different files) |
| **F2 Calendar read** (~1–2 days) | Stage B: ICS fetch, recurrence expansion, matching, unmatched inbox | F1 |
| **O2 (in flight)** | Lesson-load and PDF onto board make "Start" open a *prepared* board | — |
| **O3 (reshaped)** | Session end persistence, summary, follow-up and "Draft review plan", all attached to the lesson | F1 |
| **After O5** | Stage C OAuth calendar write and auto Meet; Zoom API if asked | Google sign-in |

**OVERHAUL.md bookkeeping on sign-off:** add R15 ("The app mirrors tables, not the week" →
the Lesson hub), mark PLAN §13.8 reversed, retitle O3 to start from F1, and fold the nav change
into O6's shell items.

## 7. Questions only Konrad can answer (shape F2, don't block F1)

1. Is every lesson in one Google Calendar, and are students or parents invited to the events
   (that's the best match key), or is the student's name in the event title?
2. Meet from a personal Gmail or from Workspace? Do some families use Zoom?
3. Are most students on a fixed weekly slot? (That decides whether stage A's repeat is enough on
   its own.)
4. Homework visible immediately (the default here, per your note) — any students for whom you'd
   rather hold it until class ends?
