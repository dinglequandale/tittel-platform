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

## 7. Konrad's answers (2026-10-25)

1. **Calendar invitees:** usually the student, sometimes the parent when the student is younger.
   F2 matches attendee email against the student's email first, then `parent_email`, and only
   then the name in the title.
2. **Meet:** personal Gmail. Stage B (iCal) works as-is; stage C's OAuth path is open to him too.
3. **Schedule:** mostly fixed weekly slots, with exceptions. Stage A's weekly series plus
   per-week Move/Cancel covers it; F2's calendar import handles the rest.
4. **Homework visibility:** Konrad left it to judgement. **Decided:** visible on the portal
   immediately, with no "hold until class ends" toggle in F1. `release_at` is not built; add it
   only if a partner asks.

## 8. As built: F1 (2026-10-25)

- **Schema:** `lesson_series`; `sessions` gained `student_id`, `group_id`, `series_id`,
  `scheduled_at`, `duration_min`, `status`, `meeting_url`, `plan_id` and `notes`
  (`board_id`/`started_at` are now nullable); `assignments.session_id`; `students.meeting_url`.
  `calendar_uid` and `students.parent_email` wait for F2, where they're first used.
- **Series** materialise ~4 weeks ahead, lazily, on every schedule read (Home, portal). An
  occurrence's id is derived from (series, local date), so moving or cancelling a week sticks.
  Stopping a series removes future weeks nobody prepared and keeps the ones with a plan or homework.
- **Meeting link** resolves lesson → series → student → tutor default (Settings).
- **API:** `GET/POST /api/tutor/sessions`, `GET/PATCH /sessions/:id`, `POST /sessions/:id/start`,
  `GET /sessions/:id/plan` (the O2 contract), `POST /sessions/:id/homework` (due = next lesson),
  `DELETE /series/:id`, `GET /attention`, `GET/PATCH /org`; portal `lessons` + `POST
  /api/portal/:token/lessons/:id/join`.
- **Web:** This week Home, the lesson page (`/app/lessons/:id`), the Schedule dialog (also from
  New → Lesson and from a new student), portal Join, Settings meeting link, nav 7 → 5 with
  redirects from the old paths. Live is gone; Assignments and Analytics live under Insights.
- **Not in F1:** plans from a PDF (O2's next step), a drawer over Home (the lesson is a page for
  now), the student record page (O6).

## 9. As built: F2, Google Calendar import (2026-10-26)

- **Connect:** Settings → Google Calendar → paste the "Secret address in iCal format". The
  server only fetches allowlisted hosts (`calendar.google.com`; `ICS_ALLOW_HOSTS` widens it for
  tests), with no redirects, a 10 s timeout and a 5 MB cap. The address is stored in
  `orgs.settings.icsUrl` and never sent back (the UI shows host + tail only).
- **Sync:** reading the schedule (This week) syncs when the last sync is over 5 minutes old,
  waiting at most 3 s; "Sync now" forces it. `ical.js` expands recurrences with their moved and
  cancelled weeks and EXDATEs, across DST. All-day events are skipped. The window is −1 day to
  +28 days.
- **Matching** (`lib/calendar.ts`, tested in `test/calendar.test.mjs`): remembered series link →
  attendee = student email → attendee = parent email → several matched students who form one
  group become a group lesson. A student's name in the title is only a *suggestion* in the inbox.
  The tutor's own email never matches.
- **Into lessons:** one `sessions` row per occurrence (`calendar_uid` = UID + original start, so a
  moved week stays the same lesson). The calendar owns time, length, who and cancelled; the tutor
  owns plan, homework, notes and the meeting override (the event's own link is kept separately
  in `calendar_meeting_url`). A lesson already scheduled in the app within 10 minutes for the
  same person is adopted, not duplicated. Calendar lessons can't be moved or cancelled in the
  app (409; the page says to do it in Google Calendar).
- **Deleted events:** an unprepared future lesson is removed; one with a plan or homework is
  cancelled instead. A failed fetch never removes anything.
- **Inbox** (This week, "From your calendar"): unmatched upcoming series with their next time and
  attendees, and three answers: the suggestion ("It's Maya"), "Who is this?" (any student or
  group), "Not a lesson". Linking can also save the attendee's address as the student's or
  parent's email, so new events with them match by themselves. `calendar_links` stores the
  answers per series UID.
- **Disconnect** removes the address and unprepared future imports. Prepared lessons stay as
  ordinary lessons.
- **Not done:** writing to Google (stage C, OAuth after O5); calendars other than Google's
  (widen the allowlist when a partner needs Outlook or iCloud).

### 9.1 After Konrad's first real sync (2026-10-28)

- **Problem:** every event reached the inbox (101 series in four weeks); "Not a lesson" seemed
  to do nothing; one meeting-link behaviour for everyone.
- **Filters** (Settings → Google Calendar → "Which events are lessons?", stored in
  `orgs.settings.calendarFilters`): someone besides you is invited · has a Meet/Zoom/Teams
  link · you sent the invite · optional title keywords. All rules are optional; an event must
  pass every one that's on. Defaults are the first three. A series linked by hand always counts.
  Invites the tutor declined are always skipped. On Konrad's real calendar the defaults kept 7 of
  101 series: 6 lessons and one sponsor call.
- **The tutor is two addresses:** the sign-in email and the calendar's own (the id in the secret
  address path). Before this, a calendar owned by a different address than the sign-in one made
  every event "someone else's" and counted the tutor as a guest.
- **Meeting link choice** (`orgs.settings.meetingLinkSource`, Settings → Lessons): `invite`
  (default) uses each invite's own link, e.g. a fresh Meet per invite; `own` uses the
  series/student/tutor link and falls back to the invite's. A per-lesson override still wins.
- **Inbox answers are instant:** the row leaves at once in the UI. "Not a lesson" replies without
  waiting on a sync (one runs in the background). The bug: a forced sync joined a sync already
  in flight, which had started before the answer, so the stale inbox came back. A forced sync
  now waits for that run and starts a fresh one.

### 9.2 Student and parent addresses; filling in what the invite didn't say (2026-10-28)

- **`student_emails`** (student_id, email, role `student|parent`) replaces
  `students.email`/`parent_email`. Those columns are backfilled, then cleared, by schema.sql. A
  student can have any number of their own addresses (school, personal) and parents'. The same
  parent address on siblings is allowed. Students → Edit lists them, each marked Student or
  Parent.
- **Matching:** any of a student's own addresses, then any parent address. Several students on
  one invite are their group; with no such group, the inbox suggests "It's Rayan + Deen (new
  group)". Title mentions can suggest several students too. Suggestions read in invite or title
  order.
- **The inbox dialog** (`LinkEventDialog`, replacing the "recognise as…" checkbox) opens when an
  invite has people the app doesn't know, or when the answer is a new student or new group. It
  covers who the lesson is with (any student, any group, + New student, or the suggested new
  group), a name when one is being created, and each invitee as "X's email", "X's parent" or
  "Someone else". It guesses from names in the addresses, otherwise the first invitee is the
  student and the rest parents. An existing student or group with no unknown invitees links in
  one click with no dialog.
- **New lessons appear at once:** an inbox answer re-matches the feed kept in memory from the
  last download (no new download). The re-match reads what it compares against in parallel,
  writes only what changed, and inserts new lessons in one statement. Before this, linking
  re-downloaded the calendar and wrote every lesson one round trip at a time (~90 ms each to
  Supabase): several seconds. Saving an address also places any other series with that address
  (both of Mateo's) in the same answer.
