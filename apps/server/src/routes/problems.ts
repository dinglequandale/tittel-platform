import { Router } from 'express'
import { newId } from '@tittel/shared'
import type { Figure } from '@tittel/shared'
import { orgQuery } from '../db.ts'
import { renderFigureSvg } from '../lib/tikz.ts'

export const problemsRouter = Router()

const PROBLEM_TYPES = ['mc', 'multi', 'numeric', 'text', 'frq']

// problem_tags carries no org_id of its own, so every mutation is scoped
// through a join back to the org-owned problems/tags rows (same convention
// as group_members in routes/students.ts).
async function syncProblemTags(orgId: string, problemId: string, tagIds: unknown) {
  if (!Array.isArray(tagIds)) return
  await orgQuery(
    orgId,
    `delete from problem_tags pt using problems p
      where p.id = pt.problem_id and p.org_id = $1 and pt.problem_id = $2`,
    [problemId],
  )
  for (const tagId of tagIds) {
    if (typeof tagId !== 'string') continue
    await orgQuery(
      orgId,
      `insert into problem_tags (problem_id, tag_id)
       select p.id, t.id from problems p, tags t
        where p.org_id = $1 and p.id = $2 and t.org_id = $1 and t.id = $3
       on conflict do nothing`,
      [problemId, tagId],
    )
  }
}

problemsRouter.get('/problems', async (req, res) => {
  const tag = typeof req.query.tag === 'string' ? req.query.tag : undefined
  const rows = await orgQuery(
    req.auth!.orgId,
    `select p.id, p.type, p.stem_latex, p.choices, p.correct, p.accept,
            p.explanation_latex, p.figures, p.difficulty, p.source, p.created_at, p.updated_at,
            coalesce(
              json_agg(json_build_object('id', t.id, 'name', t.name)) filter (where t.id is not null),
              '[]'
            ) as tags
       from problems p
       left join problem_tags pt on pt.problem_id = p.id
       left join tags t on t.id = pt.tag_id
      where p.org_id = $1 and p.archived_at is null
        ${tag ? 'and exists (select 1 from problem_tags pt2 where pt2.problem_id = p.id and pt2.tag_id = $2)' : ''}
      group by p.id
      order by p.updated_at desc`,
    tag ? [tag] : [],
  )
  res.json({ problems: rows })
})

problemsRouter.get('/problems/:id', async (req, res) => {
  const rows = await orgQuery(
    req.auth!.orgId,
    `select p.id, p.type, p.stem_latex, p.choices, p.correct, p.accept,
            p.explanation_latex, p.figures, p.difficulty, p.source, p.created_at, p.updated_at,
            coalesce(
              json_agg(json_build_object('id', t.id, 'name', t.name)) filter (where t.id is not null),
              '[]'
            ) as tags
       from problems p
       left join problem_tags pt on pt.problem_id = p.id
       left join tags t on t.id = pt.tag_id
      where p.org_id = $1 and p.id = $2
      group by p.id`,
    [req.params.id],
  )
  if (!rows[0]) return res.status(404).json({ error: 'not found' })
  res.json({ problem: rows[0] })
})

problemsRouter.post('/problems', async (req, res) => {
  const { type, stemLatex, choices, correct, accept, explanationLatex, figures, difficulty, source, tagIds } =
    req.body ?? {}
  if (!PROBLEM_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of ${PROBLEM_TYPES.join(', ')}` })
  }
  if (typeof stemLatex !== 'string' || !stemLatex.trim()) {
    return res.status(400).json({ error: 'stemLatex is required' })
  }
  const id = newId()
  const rows = await orgQuery(
    req.auth!.orgId,
    `insert into problems
       (id, org_id, type, stem_latex, choices, correct, accept, explanation_latex, figures, difficulty, source)
     values ($2, $1, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning id, type, stem_latex, choices, correct, accept, explanation_latex, figures, difficulty, source, created_at, updated_at`,
    [
      id,
      type,
      stemLatex.trim(),
      JSON.stringify(choices ?? []),
      correct === undefined ? null : JSON.stringify(correct),
      JSON.stringify(accept ?? []),
      explanationLatex || null,
      JSON.stringify(figures ?? []),
      typeof difficulty === 'number' ? difficulty : null,
      source || null,
    ],
  )
  await syncProblemTags(req.auth!.orgId, id, tagIds)
  res.status(201).json({ problem: { ...rows[0], tags: [] } })
})

problemsRouter.patch('/problems/:id', async (req, res) => {
  const { type, stemLatex, choices, correct, accept, explanationLatex, figures, difficulty, source, tagIds } =
    req.body ?? {}
  if (type !== undefined && !PROBLEM_TYPES.includes(type)) {
    return res.status(400).json({ error: `type must be one of ${PROBLEM_TYPES.join(', ')}` })
  }
  const rows = await orgQuery(
    req.auth!.orgId,
    `update problems set
       type = coalesce($3, type),
       stem_latex = coalesce($4, stem_latex),
       choices = coalesce($5, choices),
       correct = coalesce($6, correct),
       accept = coalesce($7, accept),
       explanation_latex = coalesce($8, explanation_latex),
       figures = coalesce($9, figures),
       difficulty = coalesce($10, difficulty),
       source = coalesce($11, source),
       updated_at = now()
     where org_id = $1 and id = $2 and archived_at is null
     returning id, type, stem_latex, choices, correct, accept, explanation_latex, figures, difficulty, source, created_at, updated_at`,
    [
      req.params.id,
      type,
      stemLatex,
      choices === undefined ? undefined : JSON.stringify(choices),
      correct === undefined ? undefined : JSON.stringify(correct),
      accept === undefined ? undefined : JSON.stringify(accept),
      explanationLatex,
      figures === undefined ? undefined : JSON.stringify(figures),
      difficulty,
      source,
    ],
  )
  if (!rows[0]) return res.status(404).json({ error: 'not found' })
  await syncProblemTags(req.auth!.orgId, req.params.id, tagIds)
  res.json({ problem: rows[0] })
})

problemsRouter.delete('/problems/:id', async (req, res) => {
  const rows = await orgQuery(
    req.auth!.orgId,
    `update problems set archived_at = now()
     where org_id = $1 and id = $2 and archived_at is null
     returning id`,
    [req.params.id],
  )
  if (!rows[0]) return res.status(404).json({ error: 'not found' })
  res.status(204).end()
})

// Live TikZ preview for the problem editor — KaTeX math rendering happens
// client-side; only TikZ figures need a server round-trip (real LaTeX toolchain).
problemsRouter.post('/render-figure', async (req, res) => {
  const { latex, label, packages, libraries } = req.body ?? {}
  if (typeof latex !== 'string' || !latex.trim()) {
    return res.status(400).json({ error: 'latex is required' })
  }
  const fig: Figure = { id: 'preview', latex, label, packages, libraries }
  try {
    const svg = await renderFigureSvg(fig)
    res.json({ svg })
  } catch (err) {
    res.status(422).json({ error: (err as Error).message })
  }
})
