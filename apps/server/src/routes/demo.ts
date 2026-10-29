import { Router } from 'express'
import { newId, parseLessonDoc } from '@tittel/shared'
import { orgQuery } from '../db.ts'
import { createStudents } from './students.ts'
import { createAssignment } from './assignments.ts'

// A sample student to explore with (OVERHAUL O5, onboarding seed): a lesson
// yesterday with a plan, answers on the board and last week's homework (one
// missed), and a lesson tomorrow. The tutor sees a whole week's loop in a
// minute, then removes it in one click. What was made is listed in
// orgs.settings.demo so removal takes exactly that and nothing else.

export const demoRouter = Router()

interface Demo { studentId: string; planId: string; setId: string; problemIds: string[]; assignmentIds: string[]; lessonId: string }

async function getDemo(orgId: string): Promise<Demo | null> {
  const [o] = await orgQuery<{ demo: Demo | null }>(orgId, `select settings->'demo' as demo from orgs where id = $1::text /* org_id */`)
  return o?.demo ?? null
}

const PROBLEMS = [
  { type: 'numeric', stem: 'Solve $x^2 - 7x + 12 = 0$. Give the larger root.', correct: '4', choices: [] },
  { type: 'mc', stem: 'Which is $x^2 - 9$ factored?', correct: 'A', choices: [{ id: 'A', content: '$(x-3)(x+3)$' }, { id: 'B', content: '$(x-9)(x+1)$' }, { id: 'C', content: '$(x-3)^2$' }] },
  { type: 'text', stem: 'Factor $x^2 + 5x + 6$.', correct: '(x+2)(x+3)', choices: [] },
]

demoRouter.post('/demo', async (req, res) => {
  const orgId = req.auth!.orgId
  const existing = await getDemo(orgId)
  if (existing) return res.json({ lessonId: existing.lessonId })

  const day = (offset: number, h: number) => { const d = new Date(); d.setDate(d.getDate() + offset); d.setHours(h, 0, 0, 0); return d.toISOString() }
  const [studentId] = await createStudents(orgId, [{ name: 'Sam R. (sample)', emails: [], notes: 'A sample student to try things with. Remove it from This week when you are done.' }])

  // Last week's homework: a small set, handed in with one mistake.
  const problemIds = PROBLEMS.map(() => newId())
  for (let i = 0; i < PROBLEMS.length; i++) {
    const p = PROBLEMS[i]
    await orgQuery(
      orgId,
      `insert into problems (id, org_id, type, stem_latex, choices, correct, accept, source) values ($2, $1, $3, $4, $5, $6, '[]', 'sample')`,
      [problemIds[i], p.type, p.stem, JSON.stringify(p.choices), JSON.stringify(p.correct)],
    )
  }
  const setId = newId()
  await orgQuery(orgId, `insert into problem_sets (id, org_id, title) values ($2, $1, 'Sample: quadratics practice')`, [setId])
  await orgQuery(
    orgId,
    `insert into set_problems (set_id, problem_id, ordinal)
     select $2, p.id, array_position($3::text[], p.id) - 1 from problems p where p.org_id = $1 and p.id = any($3::text[])`,
    [setId, problemIds],
  )

  const lesson = async (at: string, extra: { planId?: string; notes?: string; ended?: boolean } = {}) => {
    const id = newId()
    await orgQuery(
      orgId,
      `insert into sessions (id, org_id, student_id, scheduled_at, duration_min, status, plan_id, notes, ended_at)
       values ($2, $1, $3, $4, 60, 'scheduled', $5, $6, $7)`,
      [id, studentId, at, extra.planId ?? null, extra.notes ?? null, extra.ended ? new Date(new Date(at).getTime() + 3600e3).toISOString() : null],
    )
    return id
  }
  const lastWeek = await lesson(day(-8, 16), { notes: 'Factoring when a = 1. Quick with sums, slower with negative products.', ended: true })
  const hw = await createAssignment(orgId, req.auth!.userId, { setId, studentIds: [studentId], sessionId: lastWeek, dueAt: day(-1, 16) })
  if ('error' in hw) return res.status(500).json({ error: hw.error })
  const attemptToken = hw.links[0].attemptToken
  const answers = ['4', 'C', '(x+3)(x+2)']
  const correct = [true, false, true]
  await orgQuery(
    orgId,
    `update attempts set status = 'submitted', started_at = now() - interval '3 days', submitted_at = now() - interval '3 days'
      where org_id = $1 and attempt_token = $2`,
    [attemptToken],
  )
  for (let i = 0; i < problemIds.length; i++) {
    await orgQuery(
      orgId,
      `insert into responses (id, attempt_id, problem_id, answer, is_correct)
       select $3, a.id, $4, $5::jsonb, $6 from attempts a where a.org_id = $1 and a.attempt_token = $2`,
      [attemptToken, newId(), problemIds[i], JSON.stringify(answers[i]), correct[i]],
    )
  }

  // Yesterday's plan and lesson, with answers on the board.
  const doc = parseLessonDoc({ title: 'Sample: solving quadratics', pages: [
    { label: 'Warm-up', blocks: [
      { type: 'text', kind: 'heading', content: 'Solving quadratics by factoring', spacingAfter: 60 },
      { type: 'text', content: 'If $ab = 0$, then $a = 0$ or $b = 0$. Factor first, then set each factor to zero.', spacingAfter: 60 },
      { type: 'text', content: 'Solve $x^2 + x - 12 = 0$. Give the positive root.', answer: { format: 'grid', key: '3' } },
      { type: 'text', content: 'How many real solutions does $x^2 + 4 = 0$ have? A) 0 B) 1 C) 2', answer: { format: 'choice', key: 'A', choices: ['A', 'B', 'C'] } },
    ] },
  ] })
  const planId = newId()
  await orgQuery(orgId, `insert into lessons (id, org_id, title, doc) values ($2, $1, $3, $4)`, [planId, doc.title, JSON.stringify(doc)])
  const lessonId = await lesson(day(-1, 16), {
    planId, ended: true,
    notes: 'Solving by factoring. Got the zero-product idea; thought x² + 4 = 0 had two solutions. Next: completing the square.',
  })
  for (const [qid, answer, ok] of [[`lesson-${lessonId}-0-2`, '3', true], [`lesson-${lessonId}-0-3`, 'C', false]] as const) {
    await orgQuery(
      orgId,
      `insert into quiz_events (id, org_id, session_id, student_id, guest_name, qid, answer, is_correct, elapsed_ms)
       values ($2, $1, $3, $4, 'Sam', $5, $6::jsonb, $7, 40000)`,
      [newId(), lessonId, studentId, qid, JSON.stringify(answer), ok],
    )
  }
  await lesson(day(1, 16))

  const demo: Demo = { studentId, planId, setId, problemIds, assignmentIds: [hw.assignmentId], lessonId }
  await orgQuery(
    orgId,
    `update orgs set settings = jsonb_set(settings, '{demo}', $2::jsonb) where id = $1::text /* org_id */`,
    [JSON.stringify(demo)],
  )
  res.status(201).json({ lessonId })
})

// Removes the sample and anything made from it (follow-up homework, review
// plans): the student and their lessons go; what's left is archived.
demoRouter.delete('/demo', async (req, res) => {
  const orgId = req.auth!.orgId
  const demo = await getDemo(orgId)
  if (!demo) return res.status(204).end()
  await orgQuery(
    orgId,
    `update assignments set archived_at = now()
      where org_id = $1 and (id = any($2::text[]) or id in (select assignment_id from assignment_student where student_id = $3))`,
    [demo.assignmentIds, demo.studentId],
  )
  await orgQuery(
    orgId,
    `update lessons set archived_at = now()
      where org_id = $1 and (id = $2 or id in (select plan_id from sessions where org_id = $1 and student_id = $3))`,
    [demo.planId, demo.studentId],
  )
  await orgQuery(orgId, `update problem_sets set archived_at = now() where org_id = $1 and id = $2`, [demo.setId])
  await orgQuery(orgId, `update problems set archived_at = now() where org_id = $1 and id = any($2::text[])`, [demo.problemIds])
  await orgQuery(orgId, `delete from students where org_id = $1 and id = $2`, [demo.studentId])
  await orgQuery(orgId, `update orgs set settings = settings - 'demo' where id = $1::text /* org_id */`)
  res.status(204).end()
})
