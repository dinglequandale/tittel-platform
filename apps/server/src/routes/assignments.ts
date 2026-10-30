import { Router } from 'express'
import { newId, newToken } from '@tittel/shared'
import { orgQuery, pool } from '../db.ts'

export const assignmentsRouter = Router()

assignmentsRouter.get('/assignments', async (req, res) => {
  const rows = await orgQuery(
    req.auth!.orgId,
    `select a.id, coalesce(a.title, ps.title) as title, a.time_limit_sec, a.due_at, a.created_at,
            ps.title as set_title,
            (select count(*)::int from assignment_student x where x.assignment_id = a.id) as assigned,
            (select count(*)::int from attempts x where x.assignment_id = a.id
               and x.status in ('submitted', 'expired')) as submitted
       from assignments a
       join problem_sets ps on ps.id = a.set_id
      where a.org_id = $1 and a.archived_at is null
      order by a.created_at desc`,
  )
  res.json({ assignments: rows })
})

// Creates the assignment, rosters every listed student, and mints one attempt
// (its own magic-link token) per student — so "student link" is available
// immediately at creation time (PLAN.md §10 Phase 2). Shared by POST
// /assignments and homework given from a lesson (routes/sessions.ts).
export interface NewAssignment {
  setId: string
  title?: string
  timeLimitSec?: number
  dueAt?: string | null
  studentIds: string[]
  sessionId?: string
  /** Worksheet files (already checked to be this org's) the student works from. */
  materials?: { token: string; name: string; type: string }[]
  /** Digital-SAT-style help on the homework page: a graphing calculator and a reference sheet. */
  tools?: { calculator?: boolean; reference?: boolean }
}
export type CreateAssignmentResult =
  | { assignmentId: string; links: { studentId: string; studentName: string; attemptToken: string }[] }
  | { status: number; error: string }

export async function createAssignment(
  orgId: string,
  userId: string,
  { setId, title, timeLimitSec, dueAt, studentIds, sessionId, materials, tools }: NewAssignment,
): Promise<CreateAssignmentResult> {
  const [set] = await orgQuery<{ id: string; problem_count: number }>(
    orgId,
    `select s.id, (select count(*)::int from set_problems sp where sp.set_id = s.id) as problem_count
       from problem_sets s where s.org_id = $1 and s.id = $2`,
    [setId],
  )
  if (!set) return { status: 404, error: 'problem set not found' }
  if (set.problem_count === 0) return { status: 400, error: 'this problem set has no problems yet' }

  const client = await pool.connect()
  try {
    await client.query('begin')

    const assignmentId = newId()
    await client.query(
      `insert into assignments (id, org_id, set_id, title, time_limit_sec, due_at, created_by, session_id, materials, settings)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        assignmentId, orgId, setId, title || null,
        timeLimitSec ? Math.max(1, Math.floor(Number(timeLimitSec))) : null,
        dueAt || null,
        userId,
        sessionId ?? null,
        JSON.stringify(materials ?? []),
        JSON.stringify(tools?.calculator || tools?.reference ? { tools: { calculator: !!tools.calculator, reference: !!tools.reference } } : {}),
      ],
    )

    // Snapshot the set's problem list (schema.sql, assignment_problems).
    await client.query(
      `insert into assignment_problems (assignment_id, problem_id, ordinal)
       select $1, problem_id, ordinal from set_problems where set_id = $2`,
      [assignmentId, setId],
    )

    const links: { studentId: string; studentName: string; attemptToken: string }[] = []
    for (const studentId of studentIds) {
      if (typeof studentId !== 'string') continue
      const { rows: students } = await client.query(
        `select id, name from students where org_id = $1 and id = $2 and archived_at is null`,
        [orgId, studentId],
      )
      const student = students[0]
      if (!student) continue

      await client.query(
        `insert into assignment_student (assignment_id, student_id) values ($1, $2) on conflict do nothing`,
        [assignmentId, studentId],
      )
      const attemptToken = newToken()
      await client.query(
        `insert into attempts (id, org_id, assignment_id, student_id, attempt_token)
         values ($1, $2, $3, $4, $5)
         on conflict (assignment_id, student_id) do nothing`,
        [newId(), orgId, assignmentId, studentId, attemptToken],
      )
      const { rows: at } = await client.query(
        `select attempt_token from attempts where assignment_id = $1 and student_id = $2`,
        [assignmentId, studentId],
      )
      links.push({ studentId, studentName: student.name, attemptToken: at[0].attempt_token })
    }

    await client.query('commit')
    return { assignmentId, links }
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }
}

assignmentsRouter.post('/assignments', async (req, res) => {
  const { setId, title, timeLimitSec, dueAt, studentIds } = req.body ?? {}
  if (typeof setId !== 'string' || !Array.isArray(studentIds) || studentIds.length === 0) {
    return res.status(400).json({ error: 'setId and non-empty studentIds are required' })
  }
  const result = await createAssignment(req.auth!.orgId, req.auth!.userId, { setId, title, timeLimitSec, dueAt, studentIds })
  if ('error' in result) return res.status(result.status).json({ error: result.error })
  res.status(201).json(result)
})

// Recovers every attempt link for an assignment — the same shape POST
// /assignments returns at creation time, so a stale/lost "Links" dialog can
// always be reopened later instead of the link only existing once.
assignmentsRouter.get('/assignments/:id/links', async (req, res) => {
  const orgId = req.auth!.orgId
  const [asg] = await orgQuery(orgId, `select id from assignments where org_id = $1 and id = $2`, [req.params.id])
  if (!asg) return res.status(404).json({ error: 'not found' })

  const links = await orgQuery(
    orgId,
    `select s.id as "studentId", s.name as "studentName", att.attempt_token as "attemptToken",
            att.status
       from attempts att
       join students s on s.id = att.student_id
      where att.org_id = $1 and att.assignment_id = $2
      order by s.name`,
    [req.params.id],
  )
  res.json({ links })
})

assignmentsRouter.delete('/assignments/:id', async (req, res) => {
  const rows = await orgQuery(
    req.auth!.orgId,
    `update assignments set archived_at = now()
     where org_id = $1 and id = $2 and archived_at is null
     returning id`,
    [req.params.id],
  )
  if (!rows[0]) return res.status(404).json({ error: 'not found' })
  res.status(204).end()
})

assignmentsRouter.get('/assignments/:id/analytics', async (req, res) => {
  const orgId = req.auth!.orgId
  const [meta] = await orgQuery(
    orgId,
    `select a.title, a.time_limit_sec, ps.title as set_title
       from assignments a join problem_sets ps on ps.id = a.set_id
      where a.org_id = $1 and a.id = $2`,
    [req.params.id],
  )
  if (!meta) return res.status(404).json({ error: 'not found' })

  const problems = await orgQuery(
    orgId,
    `select p.id, ap.ordinal, p.type, p.stem_latex
       from assignment_problems ap join problems p on p.id = ap.problem_id
      where ap.assignment_id = $2 and p.org_id = $1
      order by ap.ordinal`,
    [req.params.id],
  )
  const attempts = await orgQuery<{ id: string; status: string; student_name: string }>(
    orgId,
    `select a.id, a.status, s.name as student_name
       from attempts a join students s on s.id = a.student_id
      where a.org_id = $1 and a.assignment_id = $2`,
    [req.params.id],
  )
  const done = attempts.filter((a) => a.status === 'submitted' || a.status === 'expired')
  const attemptIds = done.map((a) => a.id)

  const responses = attemptIds.length
    ? await pool
        .query<{ attempt_id: string; problem_id: string; answer: unknown; is_correct: boolean | null; time_spent_ms: number }>(
          `select attempt_id, problem_id, answer, is_correct, time_spent_ms
             from responses where attempt_id = any($1::text[])`,
          [attemptIds],
        )
        .then((r) => r.rows)
    : []

  const perProblem = problems.map((p) => {
    const rs = responses.filter((r) => r.problem_id === p.id)
    const answered = rs.filter((r) => r.answer != null).length
    const correct = rs.filter((r) => r.is_correct).length
    const times = rs.map((r) => r.time_spent_ms || 0)
    const avgTimeMs = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : 0
    return {
      problemId: p.id, ordinal: p.ordinal, type: p.type, stemLatex: p.stem_latex,
      attempts: rs.length, answered, correct,
      pctCorrect: rs.length ? correct / rs.length : null,
      avgTimeMs,
    }
  })

  // frq problems are never auto-graded — exclude them from the denominator
  // (HANDOFF.md C6) so a set with free-response questions doesn't make
  // 100% silently unreachable.
  const frqCount = problems.filter((p) => p.type === 'frq').length
  const gradedTotal = problems.length - frqCount

  const perStudent = done.map((a) => {
    const rs = responses.filter((r) => r.attempt_id === a.id)
    return {
      studentName: a.student_name,
      status: a.status,
      score: rs.filter((r) => r.is_correct).length,
      total: gradedTotal,
      totalTimeMs: rs.reduce((acc, r) => acc + (r.time_spent_ms || 0), 0),
    }
  })

  res.json({
    title: meta.title,
    setTitle: meta.set_title,
    assigned: attempts.length,
    submitted: done.length,
    frqCount,
    perProblem,
    perStudent,
  })
})

// The tutor's say on handed-in homework: a comment the student sees on their
// review, and a mark that overrides the auto-grade (or grades a free response).
assignmentsRouter.patch('/attempts/:token', async (req, res) => {
  const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim().slice(0, 4000) || null : null
  const rows = await orgQuery(
    req.auth!.orgId,
    `update attempts set tutor_comment = $3 where org_id = $1 and attempt_token = $2 returning id`,
    [req.params.token, comment],
  )
  if (!rows[0]) return res.status(404).json({ error: 'not found' })
  res.json({ ok: true })
})

assignmentsRouter.patch('/attempts/:token/responses/:problemId', async (req, res) => {
  const isCorrect = req.body?.isCorrect
  if (typeof isCorrect !== 'boolean' && isCorrect !== null) return res.status(400).json({ error: 'isCorrect must be true, false or null' })
  const [at] = await orgQuery<{ id: string }>(
    req.auth!.orgId,
    `select at.id from attempts at
       join assignment_problems ap on ap.assignment_id = at.assignment_id and ap.problem_id = $3
      where at.org_id = $1 and at.attempt_token = $2 and at.status in ('submitted', 'expired')`,
    [req.params.token, req.params.problemId],
  )
  if (!at) return res.status(404).json({ error: 'not found, or not handed in yet' })
  await orgQuery(
    req.auth!.orgId,
    `insert into responses (id, attempt_id, problem_id, answer, is_correct, tutor_marked)
     select $4, at.id, $3, null, $5, true from attempts at where at.org_id = $1 and at.attempt_token = $2
     on conflict (attempt_id, problem_id) do update set is_correct = $5, tutor_marked = true`,
    [req.params.token, req.params.problemId, newId(), isCorrect],
  )
  res.json({ ok: true })
})
