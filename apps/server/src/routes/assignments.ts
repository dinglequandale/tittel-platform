import { Router } from 'express'
import { newId, newToken } from '@tittel/shared'
import { orgQuery, pool } from '../db.ts'

export const assignmentsRouter = Router()

assignmentsRouter.get('/assignments', async (req, res) => {
  const rows = await orgQuery(
    req.auth!.orgId,
    `select a.id, a.title, a.time_limit_sec, a.due_at, a.created_at,
            ps.title as set_title,
            (select count(*) from assignment_student x where x.assignment_id = a.id) as assigned,
            (select count(*) from attempts x where x.assignment_id = a.id
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
// immediately at creation time (PLAN.md §10 Phase 2).
assignmentsRouter.post('/assignments', async (req, res) => {
  const { setId, title, timeLimitSec, dueAt, studentIds } = req.body ?? {}
  if (typeof setId !== 'string' || !Array.isArray(studentIds) || studentIds.length === 0) {
    return res.status(400).json({ error: 'setId and non-empty studentIds are required' })
  }
  const orgId = req.auth!.orgId

  const [set] = await orgQuery(orgId, `select id from problem_sets where org_id = $1 and id = $2`, [setId])
  if (!set) return res.status(404).json({ error: 'problem set not found' })

  const client = await pool.connect()
  try {
    await client.query('begin')

    const assignmentId = newId()
    await client.query(
      `insert into assignments (id, org_id, set_id, title, time_limit_sec, due_at, created_by)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [
        assignmentId, orgId, setId, title || null,
        timeLimitSec ? Math.max(1, Math.floor(Number(timeLimitSec))) : null,
        dueAt || null,
        req.auth!.userId,
      ],
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
    res.status(201).json({ assignmentId, links })
  } catch (e) {
    await client.query('rollback')
    throw e
  } finally {
    client.release()
  }
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
    `select a.title, a.set_id, a.time_limit_sec, ps.title as set_title
       from assignments a join problem_sets ps on ps.id = a.set_id
      where a.org_id = $1 and a.id = $2`,
    [req.params.id],
  )
  if (!meta) return res.status(404).json({ error: 'not found' })

  const problems = await orgQuery(
    orgId,
    `select p.id, sp.ordinal, p.type, p.stem_latex
       from set_problems sp join problems p on p.id = sp.problem_id
      where sp.set_id = $2 and p.org_id = $1
      order by sp.ordinal`,
    [meta.set_id],
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

  const perStudent = done.map((a) => {
    const rs = responses.filter((r) => r.attempt_id === a.id)
    return {
      studentName: a.student_name,
      status: a.status,
      score: rs.filter((r) => r.is_correct).length,
      total: problems.length,
      totalTimeMs: rs.reduce((acc, r) => acc + (r.time_spent_ms || 0), 0),
    }
  })

  res.json({
    title: meta.title,
    setTitle: meta.set_title,
    assigned: attempts.length,
    submitted: done.length,
    perProblem,
    perStudent,
  })
})
