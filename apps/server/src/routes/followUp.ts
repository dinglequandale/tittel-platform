import { Router } from 'express'
import { newId, parseLessonDoc, type LessonBlock, type LessonDoc } from '@tittel/shared'
import { orgQuery } from '../db.ts'
import { createAssignment } from './assignments.ts'
import { nextLessonAfter } from './sessions.ts'
import { ownFiles } from './files.ts'
import { lessonOfQuestion } from '../lib/lessonRecord.ts'

// After the lesson (OVERHAUL O3): what came back, and following up on it.
// Everything here works without AI: misses are the problems themselves,
// reused as practice homework or put on the next lesson's board.

export const followUpRouter = Router()

interface LessonRow {
  id: string; scheduled_at: string; student_id: string | null; group_id: string | null; plan_id: string | null
}

async function loadLesson(orgId: string, id: string): Promise<LessonRow | undefined> {
  const [l] = await orgQuery<LessonRow>(
    orgId,
    `select id, scheduled_at, student_id, group_id, plan_id from sessions where org_id = $1 and id = $2`,
    [id],
  )
  return l
}

async function planDoc(orgId: string, planId: string | null): Promise<LessonDoc | null> {
  if (!planId) return null
  const [p] = await orgQuery<{ doc: unknown }>(orgId, `select doc from lessons where org_id = $1 and id = $2`, [planId])
  try { return p ? parseLessonDoc(p.doc) : null } catch { return null }
}

/** The plan block a lesson's answer box came from. */
function blockOf(doc: LessonDoc | null, qid: string): LessonBlock | null {
  const at = lessonOfQuestion(qid)
  return at && doc ? doc.pages[at.page]?.blocks[at.block] ?? null : null
}

// The lesson ends: when, and the board as a PDF (the student's notes).
followUpRouter.post('/sessions/:id/end', async (req, res) => {
  const orgId = req.auth!.orgId
  const [pdf] = await ownFiles(orgId, req.body?.boardPdf ? [req.body.boardPdf] : [])
  const rows = await orgQuery(
    orgId,
    `update sessions set ended_at = now(), pdf_storage_key = coalesce($3, pdf_storage_key)
      where org_id = $1 and id = $2 returning id`,
    [req.params.id, pdf?.token ?? null],
  )
  if (!rows[0]) return res.status(404).json({ error: 'not found' })
  res.json({ ok: true })
})

interface Miss {
  /** A bank problem (homework), or a plan block (the board). */
  problemId?: string
  qid?: string
  stem: string
  choices: { id: string; content: string }[]
  correct: string | null
  /** Who missed it, with what they put. */
  who: { name: string; answer: string }[]
}

// What came back from this lesson: answers on the board, and the homework from
// last time (given at the previous lesson with them; for a student with none,
// their latest handed-in homework). Misses are what a follow-up is built from.
followUpRouter.get('/sessions/:id/results', async (req, res) => {
  const orgId = req.auth!.orgId
  const lesson = await loadLesson(orgId, req.params.id)
  if (!lesson) return res.status(404).json({ error: 'not found' })

  const [events, doc] = await Promise.all([
    orgQuery<{ qid: string; name: string; answer: unknown; is_correct: boolean }>(
      orgId,
      `select distinct on (q.qid, coalesce(q.student_id, q.guest_name)) q.qid,
              coalesce(s.name, q.guest_name, 'Student') as name, q.answer, q.is_correct
         from quiz_events q left join students s on s.id = q.student_id
        where q.org_id = $1 and q.session_id = $2
        order by q.qid, coalesce(q.student_id, q.guest_name), q.created_at desc`,
      [lesson.id],
    ),
    planDoc(orgId, lesson.plan_id),
  ])
  const board = new Map<string, { qid: string; stem: string; correct: string | null; right: string[]; wrong: { name: string; answer: string }[] }>()
  for (const e of events) {
    const block = blockOf(doc, e.qid)
    // A pin on a PDF page has no words of its own; where it sits is what identifies it.
    const stem = block?.at ? `Page ${lessonOfQuestion(e.qid)!.page + 1}, ${block.content}` : block?.content || `Question ${board.size + 1}`
    const q = board.get(e.qid) ?? { qid: e.qid, stem, correct: block?.answer?.key ?? null, right: [], wrong: [] }
    if (e.is_correct) q.right.push(e.name)
    else q.wrong.push({ name: e.name, answer: String(e.answer ?? '') })
    board.set(e.qid, q)
  }

  // Homework from last time.
  const [prev] = await orgQuery<{ id: string }>(
    orgId,
    `select id from sessions
      where org_id = $1 and id != $2 and status != 'cancelled' and scheduled_at < $3
        and (student_id = $4 or group_id = $5)
      order by scheduled_at desc limit 1`,
    [lesson.id, lesson.scheduled_at, lesson.student_id, lesson.group_id],
  )
  let assignmentIds = prev
    ? (await orgQuery<{ id: string }>(orgId, `select id from assignments where org_id = $1 and session_id = $2 and archived_at is null`, [prev.id])).map((a) => a.id)
    : []
  if (!assignmentIds.length && lesson.student_id) {
    assignmentIds = (await orgQuery<{ assignment_id: string }>(
      orgId,
      `select at.assignment_id from attempts at join assignments a on a.id = at.assignment_id
        where at.org_id = $1 and at.student_id = $2 and at.status in ('submitted', 'expired') and a.archived_at is null
          and coalesce(at.submitted_at, at.started_at) < $3
        order by coalesce(at.submitted_at, at.started_at) desc limit 1`,
      [lesson.student_id, lesson.scheduled_at],
    )).map((a) => a.assignment_id)
  }
  const hwRows = assignmentIds.length ? await orgQuery<{
    assignment_id: string; title: string; problem_id: string; ordinal: number; type: string; stem_latex: string
    choices: { id: string; content: string }[]; correct: unknown; student: string; answer: unknown; is_correct: boolean | null; status: string
  }>(
    orgId,
    `select a.id as assignment_id, coalesce(a.title, ps.title) as title, p.id as problem_id, ap.ordinal, p.type, p.stem_latex,
            p.choices, p.correct, s.name as student, r.answer, r.is_correct, at.status
       from assignments a
       join problem_sets ps on ps.id = a.set_id
       join attempts at on at.assignment_id = a.id
       join students s on s.id = at.student_id
       join assignment_problems ap on ap.assignment_id = a.id
       join problems p on p.id = ap.problem_id
       left join responses r on r.attempt_id = at.id and r.problem_id = p.id
      where a.org_id = $1 and a.id = any($2::text[])
      order by a.created_at, ap.ordinal`,
    [assignmentIds],
  ) : []
  const homework = new Map<string, { title: string; handedIn: Set<string>; assigned: Set<string>; misses: Map<string, Miss> }>()
  for (const r of hwRows) {
    const h = homework.get(r.assignment_id) ?? { title: r.title, handedIn: new Set(), assigned: new Set(), misses: new Map() }
    h.assigned.add(r.student)
    if (r.status === 'submitted' || r.status === 'expired') {
      h.handedIn.add(r.student)
      if (r.is_correct === false) {
        const m = h.misses.get(r.problem_id) ?? {
          problemId: r.problem_id, stem: r.stem_latex, choices: r.choices ?? [],
          correct: typeof r.correct === 'string' ? r.correct : Array.isArray(r.correct) ? r.correct.join(', ') : null, who: [],
        }
        m.who.push({ name: r.student, answer: Array.isArray(r.answer) ? r.answer.join(', ') : String(r.answer ?? '') })
        h.misses.set(r.problem_id, m)
      }
    }
    homework.set(r.assignment_id, h)
  }

  const [pdf] = await orgQuery<{ pdf_storage_key: string | null; ended_at: string | null }>(
    orgId, `select pdf_storage_key, ended_at from sessions where org_id = $1 and id = $2`, [lesson.id],
  )
  res.json({
    endedAt: pdf?.ended_at ?? null,
    boardPdf: pdf?.pdf_storage_key ?? null,
    board: [...board.values()],
    homework: [...homework.values()].map((h) => ({
      title: h.title, handedIn: h.handedIn.size, handedInBy: [...h.handedIn], assigned: h.assigned.size, misses: [...h.misses.values()],
    })),
  })
})

/** A problem as a board block: its text and choices, with an answer box where it can be checked. */
function problemBlock(p: { stem: string; type: string; choices: { id: string; content: string }[]; correct: string | null }): LessonBlock {
  const choices = p.type === 'mc' || p.type === 'multi' ? p.choices : []
  const content = [p.stem, ...(choices.length ? ['', ...choices.map((c) => `${c.id}) ${c.content}`)] : [])].join('\n')
  const block: LessonBlock = { type: 'text', kind: 'body', content, spacingAfter: 320, maxWidth: 720 }
  if (p.type === 'mc' && p.correct) block.answer = { format: 'choice', key: p.correct, choices: choices.map((c) => c.id), reveal: 'never' }
  else if ((p.type === 'numeric' || p.type === 'text') && p.correct) block.answer = { format: 'grid', key: p.correct, reveal: 'never' }
  return block
}

// Follow up on misses: as practice homework (the same problems again, due at
// the next lesson), or on the next lesson's board to go over together.
followUpRouter.post('/sessions/:id/follow-up', async (req, res) => {
  const orgId = req.auth!.orgId
  const as = req.body?.as
  if (as !== 'homework' && as !== 'next') return res.status(400).json({ error: "as must be 'homework' or 'next'" })
  const problemIds: string[] = Array.isArray(req.body?.problemIds) ? req.body.problemIds.filter((x: unknown) => typeof x === 'string').slice(0, 50) : []
  const qids: string[] = Array.isArray(req.body?.qids) ? req.body.qids.filter((x: unknown) => typeof x === 'string').slice(0, 50) : []
  const lesson = await loadLesson(orgId, req.params.id)
  if (!lesson) return res.status(404).json({ error: 'not found' })

  const problems = problemIds.length ? await orgQuery<{ id: string; type: string; stem_latex: string; choices: { id: string; content: string }[]; correct: unknown }>(
    orgId,
    `select id, type, stem_latex, choices, correct from problems where org_id = $1 and id = any($2::text[])`,
    [problemIds],
  ) : []
  const doc = await planDoc(orgId, lesson.plan_id)
  const asked = qids.map((q) => blockOf(doc, q)).filter((b): b is LessonBlock => !!b && !!b.content)
  const blocks = asked.filter((b) => !b.at)
  // Pins on a PDF page mean nothing without the page, so each brings its page along.
  const pinnedPages = [...new Set(qids.filter((q) => blockOf(doc, q)?.at).map((q) => lessonOfQuestion(q)!.page))]
  if (!problems.length && !asked.length) return res.status(400).json({ error: 'pick at least one problem' })
  const day = new Date(lesson.scheduled_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

  if (as === 'homework') {
    if (!problems.length && !blocks.length) {
      return res.status(400).json({ error: 'Questions on a PDF page can only go on the next lesson’s board.' })
    }
    // Board questions become problems; the set and these problems stay out of
    // the library (archived), since they only make sense as this follow-up.
    const newIds: string[] = []
    for (const b of blocks) {
      const id = newId()
      const numeric = /^[-+]?(\d[\d,]*\.?\d*|\.\d+)(\/\d+)?$/.test(b.answer?.key ?? '')
      const type = b.answer?.format === 'choice' ? 'mc' : b.answer ? (numeric ? 'numeric' : 'text') : 'frq'
      await orgQuery(
        orgId,
        `insert into problems (id, org_id, type, stem_latex, choices, correct, accept, source, archived_at)
         values ($2, $1, $3, $4, $5, $6, $7, 'follow-up', now())`,
        [id, type, b.content, JSON.stringify(type === 'mc' ? (b.answer?.choices ?? ['A', 'B', 'C', 'D']).map((c) => ({ id: c, content: c })) : []),
          JSON.stringify(b.answer?.key ?? null), JSON.stringify(b.answer?.accept ?? [])],
      )
      newIds.push(id)
    }
    const setId = newId()
    await orgQuery(orgId, `insert into problem_sets (id, org_id, title, archived_at) values ($2, $1, $3, now())`, [setId, `Practice: misses from ${day}`])
    const all = [...problems.map((p) => p.id), ...newIds]
    await orgQuery(
      orgId,
      `insert into set_problems (set_id, problem_id, ordinal)
       select $2, p.id, array_position($3::text[], p.id) - 1 from problems p where p.org_id = $1 and p.id = any($3::text[])`,
      [setId, all],
    )
    const students = lesson.student_id ? [lesson.student_id] : (await orgQuery<{ id: string }>(
      orgId,
      `select s.id from group_members gm join students s on s.id = gm.student_id
        where s.org_id = $1 and gm.group_id = $2 and s.archived_at is null`,
      [lesson.group_id],
    )).map((s) => s.id)
    const result = await createAssignment(orgId, req.auth!.userId, {
      setId, studentIds: students, sessionId: lesson.id, dueAt: await nextLessonAfter(orgId, lesson.id, lesson),
    })
    if ('error' in result) return res.status(result.status).json({ error: result.error })
    return res.status(201).json({ as, problems: all.length })
  }

  // Onto the next lesson's board: its plan (if any) plus a review page. The
  // plan is copied, not edited, since a plan can be shared by other lessons.
  const [next] = await orgQuery<LessonRow>(
    orgId,
    `select id, scheduled_at, student_id, group_id, plan_id from sessions
      where org_id = $1 and id != $2 and status != 'cancelled' and scheduled_at > $3
        and (student_id = $4 or group_id = $5)
      order by scheduled_at limit 1`,
    [lesson.id, lesson.scheduled_at, lesson.student_id, lesson.group_id],
  )
  if (!next) return res.status(400).json({ error: 'There’s no next lesson yet. Schedule it first.' })
  const nextDoc = (await planDoc(orgId, next.plan_id)) ?? { title: `Review from ${day}`, pages: [] }
  const reviewBlocks: LessonBlock[] = [
    { type: 'text', kind: 'heading', content: `Review: from ${day}`, spacingAfter: 60, maxWidth: 720 },
    ...problems.map((p) => problemBlock({
      stem: p.stem_latex, type: p.type, choices: p.choices ?? [],
      correct: typeof p.correct === 'string' ? p.correct : null,
    })),
    ...blocks.map((b) => ({ ...b, spacingAfter: 320 })),
    ...pinnedPages.flatMap((p) => doc!.pages[p].blocks.filter((b) => b.type === 'image' || (b.at && asked.includes(b)))),
  ]
  const doc2 = parseLessonDoc({ ...nextDoc, pages: [{ label: 'Review', blocks: reviewBlocks }, ...nextDoc.pages] })
  const planId = newId()
  await orgQuery(
    orgId,
    `insert into lessons (id, org_id, title, doc) values ($2, $1, $3, $4)`,
    [planId, next.plan_id ? `${nextDoc.title} + review` : nextDoc.title, JSON.stringify(doc2)],
  )
  await orgQuery(orgId, `update sessions set plan_id = $3 where org_id = $1 and id = $2`, [next.id, planId])
  res.status(201).json({ as, problems: reviewBlocks.length - 1, lessonId: next.id })
})
