import { Router } from 'express'
import { newId } from '@tittel/shared'
import { orgQuery } from '../db.ts'
import { createAssignment } from './assignments.ts'
import { getOrCreateStudentBoard, getOrCreateGroupBoard } from './students.ts'
import { syncCalendarBriefly } from './calendar.ts'
import { ownFiles } from './files.ts'
import { googleEventUrl, calendarOwnerOf, providerOf } from '../lib/calendar.ts'

// Lessons (FLOW-SPEC §1–§4). Vocabulary: a UI "Lesson" is a `sessions` row —
// one scheduled meeting with a student or a group. A UI "Plan" is a `lessons`
// row (the LessonDoc taught from). Homework is an `assignments` row with
// session_id set. The lesson is the hub the plan, homework, board and
// meeting link hang off.
export const sessionsRouter = Router()

const DAY_MS = 86_400_000

// Weekly series materialise their occurrences ~4 weeks ahead, idempotently:
// an occurrence's id is derived from (series, local date), so a rescheduled
// or cancelled occurrence keeps its row and is never recreated. Called on
// every schedule read (tutor Home, student portal) so nothing needs a cron.
export async function materializeSeries(orgId: string): Promise<void> {
  await orgQuery(
    orgId,
    `insert into sessions (id, org_id, series_id, student_id, group_id, scheduled_at, duration_min, started_at, status)
     select 'ls' || substr(md5(ls.id || d::date::text), 1, 14), ls.org_id, ls.id, ls.student_id, ls.group_id,
            (d::date + ls.start_time) at time zone ls.tz, ls.duration_min, null, 'scheduled'
       from lesson_series ls
       cross join lateral generate_series(
         greatest(ls.starts_on, current_date - 1)::timestamp,
         (greatest(ls.starts_on, current_date) + 28)::timestamp,
         interval '1 day'
       ) d
      where ls.org_id = $1 and ls.archived_at is null
        and extract(dow from d)::int = ls.weekday
     on conflict (id) do nothing`,
  )
}

// One lesson as Home and the lesson page see it. The meeting link is the
// tutor's override on this lesson if any. Then, by the tutor's choice in
// Settings (orgs.settings.meetingLinkSource): 'invite' (default) prefers the
// calendar event's own link, so a fresh Meet link per invite works; 'own'
// prefers the series, student or tutor link and falls back to the invite's.
const LESSON_SELECT = `
  select se.id, se.scheduled_at, se.duration_min, se.status, se.notes, se.series_id, se.board_id,
         se.student_id, st.name as student_name,
         se.group_id, g.name as group_name,
         se.plan_id, pl.title as plan_title,
         se.meeting_url as own_meeting_url,
         case when o.settings->>'meetingLinkSource' = 'own'
              then coalesce(se.meeting_url, ls.meeting_url, st.meeting_url, o.settings->>'defaultMeetingUrl',
                            se.calendar_meeting_url)
              else coalesce(se.meeting_url, se.calendar_meeting_url, ls.meeting_url, st.meeting_url,
                            o.settings->>'defaultMeetingUrl')
         end as meeting_url,
         se.calendar_uid is not null as from_calendar,
         se.skipped,
         prev.notes as prev_notes, prev.scheduled_at as prev_at,
         case when ls.id is not null and ls.archived_at is null
              then json_build_object('weekday', ls.weekday, 'startTime', to_char(ls.start_time, 'HH24:MI'), 'tz', ls.tz)
         end as series,
         coalesce((
           select json_agg(json_build_object(
                    'id', a.id, 'title', coalesce(a.title, ps.title), 'dueAt', a.due_at,
                    'assigned', (select count(*)::int from assignment_student x where x.assignment_id = a.id),
                    'submitted', (select count(*)::int from attempts x
                                   where x.assignment_id = a.id and x.status in ('submitted', 'expired'))
                  ) order by a.created_at)
             from assignments a join problem_sets ps on ps.id = a.set_id
            where a.session_id = se.id and a.archived_at is null
         ), '[]') as homework,
         lh.last_homework
    from sessions se
    join orgs o on o.id = se.org_id
    left join students st on st.id = se.student_id
    left join groups g on g.id = se.group_id
    left join lesson_series ls on ls.id = se.series_id
    left join lessons pl on pl.id = se.plan_id and pl.archived_at is null
    left join lateral (
      select json_build_object(
               'title', coalesce(a.title, ps.title),
               'doneAt', coalesce(at.submitted_at, at.started_at),
               'score', (select count(*)::int from responses r where r.attempt_id = at.id and r.is_correct),
               'total', (select count(*)::int from assignment_problems ap join problems p on p.id = ap.problem_id
                          where ap.assignment_id = a.id and (p.type != 'frq' or exists (select 1 from responses r where r.attempt_id = at.id and r.problem_id = p.id and r.is_correct is not null))),
               'attemptToken', at.attempt_token
             ) as last_homework
        from attempts at
        join assignments a on a.id = at.assignment_id
        join problem_sets ps on ps.id = a.set_id
       where se.student_id is not null and at.student_id = se.student_id
         and at.status in ('submitted', 'expired') and a.archived_at is null
         and coalesce(at.submitted_at, at.started_at) < coalesce(se.scheduled_at, now())
       order by coalesce(at.submitted_at, at.started_at) desc
       limit 1
    ) lh on true
    left join lateral (
      -- The last lesson with the same student or group that has notes: what
      -- was covered and how it went, shown when preparing this one.
      select p.notes, p.scheduled_at from sessions p
       where p.org_id = se.org_id and p.id != se.id and p.scheduled_at < se.scheduled_at
         and p.notes is not null and p.notes != ''
         and ((se.student_id is not null and p.student_id = se.student_id) or (se.group_id is not null and p.group_id = se.group_id))
       order by p.scheduled_at desc limit 1
    ) prev on true`

function validTz(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

function parseDate(v: unknown): Date | null {
  if (typeof v !== 'string') return null
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

sessionsRouter.get('/sessions', async (req, res) => {
  const orgId = req.auth!.orgId
  const from = parseDate(req.query.from) ?? new Date()
  const to = parseDate(req.query.to) ?? new Date(from.getTime() + 7 * DAY_MS)
  if (to.getTime() - from.getTime() > 62 * DAY_MS) return res.status(400).json({ error: 'range is too long' })
  await syncCalendarBriefly(orgId, req.auth!.email)
  await materializeSeries(orgId)
  const lessons = await orgQuery(
    orgId,
    `${LESSON_SELECT}
      where se.org_id = $1 and se.status != 'cancelled'
        and se.scheduled_at >= $2 and se.scheduled_at < $3
      order by se.scheduled_at`,
    [from.toISOString(), to.toISOString()],
  )
  res.json({ lessons })
})

sessionsRouter.post('/sessions', async (req, res) => {
  const orgId = req.auth!.orgId
  const { studentId, groupId, repeatWeekly, tz, meetingUrl } = req.body ?? {}
  const scheduledAt = parseDate(req.body?.scheduledAt)
  const durationMin = Math.round(Number(req.body?.durationMin ?? 60))
  if (!scheduledAt) return res.status(400).json({ error: 'scheduledAt is required' })
  if (!(durationMin >= 5 && durationMin <= 600)) return res.status(400).json({ error: 'durationMin must be 5–600' })
  if (!validTz(tz)) return res.status(400).json({ error: 'tz must be an IANA time zone' })
  if ((typeof studentId === 'string') === (typeof groupId === 'string')) {
    return res.status(400).json({ error: 'pass exactly one of studentId or groupId' })
  }
  const [who] = studentId
    ? await orgQuery(orgId, `select id from students where org_id = $1 and id = $2 and archived_at is null`, [studentId])
    : await orgQuery(orgId, `select id from groups where org_id = $1 and id = $2 and archived_at is null`, [groupId])
  if (!who) return res.status(404).json({ error: studentId ? 'student not found' : 'group not found' })
  const link = typeof meetingUrl === 'string' && meetingUrl.trim() ? meetingUrl.trim() : null

  if (repeatWeekly) {
    const seriesId = newId()
    await orgQuery(
      orgId,
      `insert into lesson_series (id, org_id, student_id, group_id, weekday, start_time, duration_min, tz, starts_on, meeting_url)
       values ($2, $1, $3, $4,
               extract(dow from ($5::timestamptz at time zone $6))::int,
               ($5::timestamptz at time zone $6)::time,
               $7, $6,
               ($5::timestamptz at time zone $6)::date,
               $8)`,
      [seriesId, studentId ?? null, groupId ?? null, scheduledAt.toISOString(), tz, durationMin, link],
    )
    await materializeSeries(orgId)
    const [first] = await orgQuery<{ id: string }>(
      orgId,
      `select id from sessions where org_id = $1 and series_id = $2 order by scheduled_at limit 1`,
      [seriesId],
    )
    return res.status(201).json({ lesson: { id: first.id } })
  }

  const id = newId()
  await orgQuery(
    orgId,
    `insert into sessions (id, org_id, student_id, group_id, scheduled_at, duration_min, meeting_url, started_at, status)
     values ($2, $1, $3, $4, $5, $6, $7, null, 'scheduled')`,
    [id, studentId ?? null, groupId ?? null, scheduledAt.toISOString(), durationMin, link],
  )
  res.status(201).json({ lesson: { id } })
})

sessionsRouter.get('/sessions/:id', async (req, res) => {
  const orgId = req.auth!.orgId
  const [lesson] = await orgQuery<{ scheduled_at: string; student_id: string | null; group_id: string | null }>(
    orgId,
    `${LESSON_SELECT} where se.org_id = $1 and se.id = $2`,
    [req.params.id],
  )
  if (!lesson) return res.status(404).json({ error: 'not found' })
  const nextLessonAt = await nextLessonAfter(orgId, req.params.id, lesson)
  // Calendar lessons link to their event, to move or cancel it in Google
  // (other calendars have no such link: the page says to do it there). The
  // feed address is secret, so only the owner part and the provider leave the server.
  const [cal] = await orgQuery<{ calendar_uid: string | null; ics_url: string | null }>(
    orgId,
    `select se.calendar_uid, o.settings->>'icsUrl' as ics_url
       from sessions se join orgs o on o.id = se.org_id where se.org_id = $1 and se.id = $2`,
    [req.params.id],
  )
  const fromFeed = cal?.calendar_uid && cal.ics_url ? { uid: cal.calendar_uid, url: cal.ics_url } : null
  const calendarProvider = fromFeed ? providerOf(new URL(fromFeed.url).hostname) : null
  const calendarEventUrl = fromFeed && calendarProvider === 'google' ? googleEventUrl(fromFeed.uid, calendarOwnerOf(fromFeed.url)) : null
  res.json({ lesson: { ...lesson, next_lesson_at: nextLessonAt, calendar_event_url: calendarEventUrl, calendar_provider: calendarProvider } })
})

// The next lesson with the same student or group: homework's default due date.
export async function nextLessonAfter(
  orgId: string,
  lessonId: string,
  lesson: { scheduled_at: string; student_id: string | null; group_id: string | null },
): Promise<string | null> {
  const [next] = await orgQuery<{ scheduled_at: string }>(
    orgId,
    `select scheduled_at from sessions
      where org_id = $1 and id != $2 and status != 'cancelled' and scheduled_at > $3
        and (student_id = $4 or group_id = $5)
      order by scheduled_at limit 1`,
    [lessonId, lesson.scheduled_at, lesson.student_id, lesson.group_id],
  )
  return next?.scheduled_at ?? null
}

sessionsRouter.patch('/sessions/:id', async (req, res) => {
  const orgId = req.auth!.orgId
  const { meetingUrl, planId, notes, status, skipped } = req.body ?? {}
  const scheduledAt = req.body?.scheduledAt === undefined ? undefined : parseDate(req.body.scheduledAt)
  if (scheduledAt === null) return res.status(400).json({ error: 'scheduledAt must be a date' })
  const durationMin = req.body?.durationMin === undefined ? undefined : Math.round(Number(req.body.durationMin))
  if (durationMin !== undefined && !(durationMin >= 5 && durationMin <= 600)) {
    return res.status(400).json({ error: 'durationMin must be 5–600' })
  }
  if (status !== undefined && status !== 'scheduled' && status !== 'cancelled') {
    return res.status(400).json({ error: "status must be 'scheduled' or 'cancelled'" })
  }
  if (scheduledAt !== undefined || durationMin !== undefined || status !== undefined) {
    // The calendar owns an imported lesson's time and status; an edit here
    // would be undone by the next sync.
    const [cal] = await orgQuery(orgId, `select 1 from sessions where org_id = $1 and id = $2 and calendar_uid is not null`, [req.params.id])
    if (cal) return res.status(409).json({ error: 'This lesson comes from your calendar. Move or cancel it there.' })
  }
  if (skipped !== undefined) {
    // Skip (or un-skip) one week of a calendar lesson without editing the
    // calendar; the sync leaves it cancelled while skipped.
    if (typeof skipped !== 'boolean') return res.status(400).json({ error: 'skipped must be true or false' })
    const rows = await orgQuery(
      orgId,
      `update sessions set skipped = $3, status = case when $3 then 'cancelled' else 'scheduled' end
        where org_id = $1 and id = $2 and calendar_uid is not null returning id`,
      [req.params.id, skipped],
    )
    if (!rows[0]) return res.status(404).json({ error: 'only calendar lessons are skipped; cancel this one instead' })
    return res.json({ ok: true })
  }
  if (typeof planId === 'string') {
    const [plan] = await orgQuery(orgId, `select id from lessons where org_id = $1 and id = $2 and archived_at is null`, [planId])
    if (!plan) return res.status(404).json({ error: 'plan not found' })
  }
  // Nullable fields use has-field flags: absent keeps the value, null clears it.
  const rows = await orgQuery(
    orgId,
    `update sessions set
       scheduled_at = coalesce($3, scheduled_at),
       duration_min = coalesce($4, duration_min),
       meeting_url = case when $5 then $6 else meeting_url end,
       plan_id = case when $7 then $8 else plan_id end,
       notes = case when $9 then $10 else notes end,
       status = coalesce($11, status)
     where org_id = $1 and id = $2
     returning id`,
    [
      req.params.id,
      scheduledAt?.toISOString() ?? null,
      durationMin ?? null,
      meetingUrl !== undefined, typeof meetingUrl === 'string' && meetingUrl.trim() ? meetingUrl.trim() : null,
      planId !== undefined, planId ?? null,
      notes !== undefined, typeof notes === 'string' ? notes : null,
      status ?? null,
    ],
  )
  if (!rows[0]) return res.status(404).json({ error: 'not found' })
  res.json({ ok: true })
})

// Stop a weekly series. Future occurrences nobody prepared are removed; ones
// with a plan or homework stay as one-off lessons rather than losing that work.
sessionsRouter.delete('/series/:id', async (req, res) => {
  const orgId = req.auth!.orgId
  const rows = await orgQuery(
    orgId,
    `update lesson_series set archived_at = now()
      where org_id = $1 and id = $2 and archived_at is null
      returning id`,
    [req.params.id],
  )
  if (!rows[0]) return res.status(404).json({ error: 'not found' })
  await orgQuery(
    orgId,
    `delete from sessions se
      where se.org_id = $1 and se.series_id = $2 and se.status = 'scheduled'
        and se.scheduled_at > now() and se.plan_id is null
        and not exists (select 1 from assignments a where a.session_id = se.id)`,
    [req.params.id],
  )
  res.status(204).end()
})

// Start: make sure the student's (or group's) persistent board exists, mark
// the lesson live, and hand back what the client opens (the meeting in a new
// tab, the board with ?lesson= so O2 injects the plan).
sessionsRouter.post('/sessions/:id/start', async (req, res) => {
  const orgId = req.auth!.orgId
  const [lesson] = await orgQuery<{ student_id: string | null; group_id: string | null; meeting_url: string | null }>(
    orgId,
    `${LESSON_SELECT} where se.org_id = $1 and se.id = $2`,
    [req.params.id],
  )
  if (!lesson) return res.status(404).json({ error: 'not found' })
  const boardId = lesson.student_id
    ? await getOrCreateStudentBoard(orgId, lesson.student_id)
    : await getOrCreateGroupBoard(orgId, lesson.group_id!)
  if (!boardId) return res.status(409).json({ error: 'this lesson’s student or group was archived' })
  await orgQuery(
    orgId,
    `update sessions set board_id = $3, status = 'live', started_at = coalesce(started_at, now())
      where org_id = $1 and id = $2`,
    [req.params.id, boardId],
  )
  res.json({ boardId, meetingUrl: lesson.meeting_url })
})

// The board's plan-load contract with O2 (OVERHAUL.md O2, agreed 2026-10-24).
sessionsRouter.get('/sessions/:id/plan', async (req, res) => {
  const [plan] = await orgQuery(
    req.auth!.orgId,
    `select pl.id as "planId", pl.version, pl.title, se.scheduled_at as "scheduledAt", pl.doc
       from sessions se join lessons pl on pl.id = se.plan_id
      where se.org_id = $1 and se.id = $2 and pl.archived_at is null`,
    [req.params.id],
  )
  if (!plan) return res.status(404).json({ error: 'this lesson has no plan' })
  res.json(plan)
})

// Give homework from a lesson. It goes to the lesson's student (or every
// group member), lands on their portal immediately, and is due at the start
// of the next lesson unless the tutor says otherwise (dueAt: null = no date).
sessionsRouter.post('/sessions/:id/homework', async (req, res) => {
  const orgId = req.auth!.orgId
  const { timeLimitSec, paper } = req.body ?? {}
  let setId: unknown = req.body?.setId
  const materials = await ownFiles(orgId, req.body?.materials)
  if (paper) {
    // Paper homework: the student works from the uploaded worksheet and
    // hands in photos. It's one free-response question the tutor marks,
    // kept out of the library (archived) since it only makes sense here.
    if (!materials.length) return res.status(400).json({ error: 'attach the worksheet' })
    const title = typeof paper.title === 'string' && paper.title.trim() ? paper.title.trim().slice(0, 200) : materials[0].name
    const problemId = newId()
    setId = newId()
    await orgQuery(
      orgId,
      `insert into problems (id, org_id, type, stem_latex, choices, correct, accept, source, archived_at)
       values ($2, $1, 'frq', $3, '[]', 'null', '[]', 'paper', now())`,
      [problemId, 'Do the worksheet on paper, then add photos of your work below.'],
    )
    await orgQuery(orgId, `insert into problem_sets (id, org_id, title, archived_at) values ($2, $1, $3, now())`, [setId, title])
    await orgQuery(
      orgId,
      `insert into set_problems (set_id, problem_id, ordinal)
       select $2, p.id, 0 from problems p where p.org_id = $1 and p.id = $3`,
      [setId, problemId],
    )
  }
  if (typeof setId !== 'string') return res.status(400).json({ error: 'setId is required' })
  const [lesson] = await orgQuery<{ scheduled_at: string; student_id: string | null; group_id: string | null }>(
    orgId,
    `select scheduled_at, student_id, group_id from sessions where org_id = $1 and id = $2`,
    [req.params.id],
  )
  if (!lesson) return res.status(404).json({ error: 'not found' })

  const students = lesson.student_id
    ? [{ id: lesson.student_id }]
    : await orgQuery<{ id: string }>(
        orgId,
        `select s.id from group_members gm join students s on s.id = gm.student_id
          where s.org_id = $1 and gm.group_id = $2 and s.archived_at is null`,
        [lesson.group_id],
      )
  if (students.length === 0) return res.status(400).json({ error: 'this group has no students yet' })

  let dueAt: string | null
  if (req.body?.dueAt === undefined) {
    dueAt = await nextLessonAfter(orgId, req.params.id, lesson)
  } else if (req.body.dueAt === null) {
    dueAt = null
  } else {
    const d = parseDate(req.body.dueAt)
    if (!d) return res.status(400).json({ error: 'dueAt must be a date' })
    dueAt = d.toISOString()
  }

  const result = await createAssignment(orgId, req.auth!.userId, {
    setId,
    timeLimitSec,
    dueAt,
    studentIds: students.map((s) => s.id),
    sessionId: req.params.id,
    materials,
  })
  if ('error' in result) return res.status(result.status).json({ error: result.error })
  res.status(201).json({ ...result, dueAt })
})

// "Needs attention" on Home: homework that came back this week, and
// homework past due and not done. Each row carries the student's next
// lesson, which is where the tutor acts on it.
sessionsRouter.get('/attention', async (req, res) => {
  const orgId = req.auth!.orgId
  const nextLesson = `(select n.id from sessions n
                        where n.org_id = st.org_id and n.student_id = st.id and n.status != 'cancelled'
                          and n.scheduled_at > now()
                        order by n.scheduled_at limit 1)`
  const returned = await orgQuery(
    orgId,
    `select at.attempt_token, st.id as student_id, st.name as student_name,
            coalesce(a.title, ps.title) as title, coalesce(at.submitted_at, at.started_at) as done_at,
            (select count(*)::int from responses r where r.attempt_id = at.id and r.is_correct) as score,
            (select count(*)::int from assignment_problems ap join problems p on p.id = ap.problem_id
              where ap.assignment_id = a.id and (p.type != 'frq' or exists (select 1 from responses r where r.attempt_id = at.id and r.problem_id = p.id and r.is_correct is not null))) as total,
            ${nextLesson} as next_lesson_id
       from attempts at
       join assignments a on a.id = at.assignment_id
       join problem_sets ps on ps.id = a.set_id
       join students st on st.id = at.student_id
      where at.org_id = $1 and at.status in ('submitted', 'expired') and a.archived_at is null
        and st.archived_at is null
        and coalesce(at.submitted_at, at.started_at) > now() - interval '7 days'
      order by coalesce(at.submitted_at, at.started_at) desc
      limit 20`,
  )
  const overdue = await orgQuery(
    orgId,
    `select st.id as student_id, st.name as student_name, coalesce(a.title, ps.title) as title, a.due_at,
            ${nextLesson} as next_lesson_id
       from attempts at
       join assignments a on a.id = at.assignment_id
       join problem_sets ps on ps.id = a.set_id
       join students st on st.id = at.student_id
      where at.org_id = $1 and at.status in ('pending', 'active') and a.archived_at is null
        and st.archived_at is null and a.due_at < now()
      order by a.due_at desc
      limit 20`,
  )
  res.json({ returned, overdue })
})
