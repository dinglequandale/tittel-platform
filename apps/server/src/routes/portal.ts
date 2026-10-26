import { Router } from 'express'
import { studentQuery } from '../db.ts'
import { materializeSeries } from './sessions.ts'
import { getOrCreateStudentBoard, getOrCreateGroupBoard } from './students.ts'

export const portalRouter = Router()

// The student's own lessons and their groups' lessons, from three hours ago
// (a lesson still running) to a week out. Meeting link resolves as on the
// tutor side (routes/sessions.ts).
const STUDENT_LESSONS = `
  select se.id, se.scheduled_at, se.duration_min, se.group_id, g.name as group_name,
         coalesce(se.meeting_url, se.calendar_meeting_url, ls.meeting_url, st.meeting_url,
                  o.settings->>'defaultMeetingUrl') as meeting_url
    from students st
    join sessions se on se.org_id = st.org_id
                    and (se.student_id = st.id
                         or se.group_id in (select gm.group_id from group_members gm where gm.student_id = st.id))
    join orgs o on o.id = se.org_id
    left join lesson_series ls on ls.id = se.series_id
    left join groups g on g.id = se.group_id
   where st.portal_token = $1 and st.archived_at is null and se.status != 'cancelled'
     and se.scheduled_at + make_interval(mins => coalesce(se.duration_min, 60)) > now()
     and se.scheduled_at < now() + interval '7 days'`

// The student's home: their name, their upcoming lessons (with Join), and
// every assignment with attempt status and, once submitted, their score. The
// attempt_token deep-links into the runner.
portalRouter.get('/:token', async (req, res) => {
  const [student] = await studentQuery<{ id: string; name: string; org_id: string }>(
    req.params.token,
    `select id, name, org_id from students where portal_token = $1 and archived_at is null`,
  )
  if (!student) return res.status(404).json({ error: 'not found' })

  // A tutor who hasn't opened the app lately still has next week's series
  // occurrences appear here.
  await materializeSeries(student.org_id)
  const lessons = await studentQuery(req.params.token, `${STUDENT_LESSONS} order by se.scheduled_at limit 10`)

  const assignments = await studentQuery(
    req.params.token,
    `select asg.id as assignment_id,
            asg.title,
            asg.time_limit_sec,
            asg.due_at,
            asg.created_at,
            ps.title as set_title,
            att.attempt_token,
            coalesce(att.status, 'pending') as status,
            (select count(*)::int from assignment_problems ap
               join problems p on p.id = ap.problem_id
              where ap.assignment_id = asg.id and p.type != 'frq') as total,
            (select count(*)::int from assignment_problems ap
               join problems p on p.id = ap.problem_id
              where ap.assignment_id = asg.id and p.type = 'frq') as "frqCount",
            (select count(*)::int from responses r
               where r.attempt_id = att.id and r.is_correct) as score
       from students st
       join assignment_student ascd on ascd.student_id = st.id
       join assignments asg on asg.id = ascd.assignment_id
       join problem_sets ps on ps.id = asg.set_id
       left join attempts att on att.assignment_id = asg.id and att.student_id = st.id
      where st.portal_token = $1 and asg.archived_at is null
      order by asg.created_at desc`,
  )

  res.json({ studentName: student.name, lessons, assignments })
})

// Join a lesson from the portal: the board the tutor teaches on (created on
// first join if the tutor hasn't started yet) plus the meeting link. The
// student's one permanent link is all they ever need (FLOW-SPEC §2.3).
portalRouter.post('/:token/lessons/:lessonId/join', async (req, res) => {
  const [lesson] = await studentQuery<{ id: string; group_id: string | null; meeting_url: string | null }>(
    req.params.token,
    `${STUDENT_LESSONS} and se.id = $2`,
    [req.params.lessonId],
  )
  if (!lesson) return res.status(404).json({ error: 'not found' })
  const [student] = await studentQuery<{ id: string; org_id: string }>(
    req.params.token,
    `select id, org_id from students where portal_token = $1`,
  )
  const boardId = lesson.group_id
    ? await getOrCreateGroupBoard(student.org_id, lesson.group_id)
    : await getOrCreateStudentBoard(student.org_id, student.id)
  res.json({ boardId, meetingUrl: lesson.meeting_url })
})
