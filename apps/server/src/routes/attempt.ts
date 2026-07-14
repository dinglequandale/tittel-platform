import { Router } from 'express'
import { newId } from '@tittel/shared'
import { gradeResponse } from '@tittel/shared'
import { attemptQuery, pool } from '../db.ts'

export const attemptRouter = Router()

interface AttemptRow {
  id: string
  status: 'pending' | 'active' | 'submitted' | 'expired'
  started_at: string | null
  time_limit_sec: number | null
  set_id: string
  assignment_title: string | null
  student_name: string
}

async function loadAttempt(token: string): Promise<AttemptRow | undefined> {
  const rows = await attemptQuery<AttemptRow>(
    token,
    `select a.id, a.status, a.started_at, asg.time_limit_sec, asg.set_id,
            asg.title as assignment_title, s.name as student_name
       from attempts a
       join assignments asg on asg.id = a.assignment_id
       join students s on s.id = a.student_id
      where a.attempt_token = $1`,
  )
  return rows[0]
}

/** Null time_limit_sec means untimed — never expires. */
function remainingSeconds(at: AttemptRow): number | null {
  if (at.time_limit_sec == null) return null
  if (!at.started_at) return at.time_limit_sec
  const elapsed = (Date.now() - new Date(at.started_at).getTime()) / 1000
  return at.time_limit_sec - elapsed
}

// Grade every problem in the set against the attempt's saved responses,
// writing is_correct (and rows for unanswered problems too, so analytics
// counts them as attempted-but-blank rather than invisible).
async function gradeAttempt(attemptId: string, setId: string): Promise<void> {
  const { rows: problems } = await pool.query(
    `select p.id, p.type, p.correct, p.accept
       from set_problems sp join problems p on p.id = sp.problem_id
      where sp.set_id = $1`,
    [setId],
  )
  const { rows: responses } = await pool.query(
    `select problem_id, answer from responses where attempt_id = $1`,
    [attemptId],
  )
  const answerOf = new Map<string, unknown>(responses.map((r) => [r.problem_id, r.answer]))
  for (const p of problems) {
    const answer = answerOf.get(p.id) ?? null
    const isCorrect = gradeResponse({ type: p.type, correct: p.correct, accept: p.accept }, answer)
    await pool.query(
      `insert into responses (id, attempt_id, problem_id, answer, is_correct)
       values ($1, $2, $3, $4, $5)
       on conflict (attempt_id, problem_id) do update set is_correct = excluded.is_correct`,
      [newId(), attemptId, p.id, answer === null ? null : JSON.stringify(answer), isCorrect],
    )
  }
}

// GET the runner payload. Starts the server-authoritative timer on first
// open; auto-submits (grades + locks) if the window has already elapsed —
// the student never has to click through a "time's up" prompt to have their
// work actually count. Never returns correct answers.
attemptRouter.get('/:token', async (req, res) => {
  const at = await loadAttempt(req.params.token)
  if (!at) return res.status(404).json({ error: 'not found' })

  if (at.status === 'pending') {
    await pool.query(
      `update attempts set status = 'active', started_at = now() where id = $1 and started_at is null`,
      [at.id],
    )
    at.status = 'active'
    at.started_at = new Date().toISOString()
  }

  let remaining = remainingSeconds(at)
  if (at.status === 'active' && remaining !== null && remaining <= 0) {
    await gradeAttempt(at.id, at.set_id)
    await pool.query(`update attempts set status = 'expired' where id = $1`, [at.id])
    at.status = 'expired'
    remaining = 0
  }

  const { rows: problems } = await pool.query(
    `select p.id, sp.ordinal, p.type, p.stem_latex, p.choices, p.figures
       from set_problems sp join problems p on p.id = sp.problem_id
      where sp.set_id = $1 order by sp.ordinal`,
    [at.set_id],
  )
  const { rows: responses } = await pool.query(
    `select problem_id, answer, marked_for_review from responses where attempt_id = $1`,
    [at.id],
  )

  res.json({
    status: at.status,
    submitted: at.status === 'submitted' || at.status === 'expired',
    studentName: at.student_name,
    assignmentTitle: at.assignment_title,
    timeLimitSec: at.time_limit_sec,
    remainingSec: remaining === null ? null : Math.max(0, Math.floor(remaining)),
    problems,
    responses,
  })
})

// Autosave one answer. Accumulates per-question time + change count (analytics).
attemptRouter.post('/:token/response', async (req, res) => {
  const at = await loadAttempt(req.params.token)
  if (!at) return res.status(404).json({ error: 'not found' })
  if (at.status !== 'active') return res.status(409).json({ error: 'not in progress' })

  const remaining = remainingSeconds(at)
  if (remaining !== null && remaining <= 0) {
    await gradeAttempt(at.id, at.set_id)
    await pool.query(`update attempts set status = 'expired' where id = $1`, [at.id])
    return res.status(409).json({ error: 'time expired' })
  }

  const { problemId, answer, markedForReview, timeSpentMsDelta, changed } = req.body ?? {}
  if (typeof problemId !== 'string') return res.status(400).json({ error: 'problemId is required' })
  const delta = Math.max(0, Math.floor(Number(timeSpentMsDelta) || 0))

  await pool.query(
    `insert into responses (id, attempt_id, problem_id, answer, marked_for_review, time_spent_ms, change_count)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (attempt_id, problem_id) do update set
       answer = excluded.answer,
       marked_for_review = excluded.marked_for_review,
       time_spent_ms = responses.time_spent_ms + $6,
       change_count = responses.change_count + $7,
       updated_at = now()`,
    [newId(), at.id, problemId, answer === undefined ? null : JSON.stringify(answer), !!markedForReview, delta, changed ? 1 : 0],
  )
  res.json({ ok: true })
})

// Submit (final). Grades and locks.
attemptRouter.post('/:token/submit', async (req, res) => {
  const at = await loadAttempt(req.params.token)
  if (!at) return res.status(404).json({ error: 'not found' })
  if (at.status === 'submitted' || at.status === 'expired') return res.json({ ok: true, already: true })
  await gradeAttempt(at.id, at.set_id)
  await pool.query(`update attempts set status = 'submitted', submitted_at = now() where id = $1`, [at.id])
  res.json({ ok: true })
})

// Review (only after submit/expiry). Returns correct answers + explanations.
attemptRouter.get('/:token/review', async (req, res) => {
  const at = await loadAttempt(req.params.token)
  if (!at) return res.status(404).json({ error: 'not found' })
  if (at.status !== 'submitted' && at.status !== 'expired') {
    return res.status(409).json({ error: 'not submitted' })
  }
  const { rows: problems } = await pool.query(
    `select p.id, sp.ordinal, p.type, p.stem_latex, p.choices, p.correct, p.accept, p.explanation_latex, p.figures
       from set_problems sp join problems p on p.id = sp.problem_id
      where sp.set_id = $1 order by sp.ordinal`,
    [at.set_id],
  )
  const { rows: responses } = await pool.query(
    `select problem_id, answer, is_correct, marked_for_review, time_spent_ms
       from responses where attempt_id = $1`,
    [at.id],
  )
  res.json({
    studentName: at.student_name,
    assignmentTitle: at.assignment_title,
    status: at.status,
    score: responses.filter((r) => r.is_correct).length,
    total: problems.length,
    problems,
    responses,
  })
})
