import { Router } from 'express'
import { newId } from '@tittel/shared'
import type { Figure } from '@tittel/shared'
import { orgQuery } from '../db.ts'
import { renderFigureSvg } from '../lib/tikz.ts'

export const problemsRouter = Router()

const PROBLEM_TYPES = ['mc', 'multi', 'numeric', 'text', 'frq']

interface FigureDraft {
  id: string
  latex: string
  label?: string
  packages?: string[]
  libraries?: string[]
  svg?: string
}

// A problem's figures are stored SVG, but that SVG arrives from the client
// (the editor's "Preview" round-trip) and is later injected verbatim via
// dangerouslySetInnerHTML in the runner/review — so the server can never
// trust it. Re-render every figure from its latex here instead, which both
// sanitizes (only our own TikZ renderer's output is ever stored) and
// guarantees svg<->latex consistency. Figures whose latex hasn't changed
// since the stored row reuse their already-server-rendered svg rather than
// re-running the tikz toolchain for nothing.
async function sanitizeFigures(figures: unknown, priorFigures?: unknown): Promise<unknown> {
  if (!Array.isArray(figures)) return figures
  const priorById = new Map<string, FigureDraft>()
  if (Array.isArray(priorFigures)) {
    for (const f of priorFigures as FigureDraft[]) {
      if (f && typeof f.id === 'string') priorById.set(f.id, f)
    }
  }
  const out: FigureDraft[] = []
  for (const fig of figures as FigureDraft[]) {
    if (!fig || typeof fig !== 'object' || !fig.svg) {
      out.push(fig)
      continue
    }
    const prior = priorById.get(fig.id)
    if (prior && prior.svg && prior.latex === fig.latex) {
      out.push({ ...fig, svg: prior.svg })
      continue
    }
    const svg = await renderFigureSvg(fig as Figure)
    out.push({ ...fig, svg })
  }
  return out
}

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
  if (type === 'multi' && correct !== undefined && !Array.isArray(correct)) {
    return res.status(400).json({ error: 'correct must be an array of choice ids for multi problems' })
  }
  let safeFigures: unknown
  try {
    safeFigures = await sanitizeFigures(figures ?? [])
  } catch (err) {
    return res.status(422).json({ error: (err as Error).message })
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
      JSON.stringify(safeFigures),
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
  if (type === 'multi' && correct !== undefined && !Array.isArray(correct)) {
    return res.status(400).json({ error: 'correct must be an array of choice ids for multi problems' })
  }
  let safeFigures: unknown = undefined
  if (figures !== undefined) {
    const [prior] = await orgQuery<{ figures: unknown }>(
      req.auth!.orgId,
      `select figures from problems where org_id = $1 and id = $2`,
      [req.params.id],
    )
    try {
      safeFigures = await sanitizeFigures(figures, prior?.figures)
    } catch (err) {
      return res.status(422).json({ error: (err as Error).message })
    }
  }
  // correct/explanation_latex/difficulty/source are all nullable columns —
  // distinguish "field absent, keep as-is" (undefined) from "field present
  // and null, clear it" via an explicit has-field flag per column, since
  // coalesce(param, col) can't tell an absent field from an explicit null.
  const rows = await orgQuery(
    req.auth!.orgId,
    `update problems set
       type = coalesce($3, type),
       stem_latex = coalesce($4, stem_latex),
       choices = coalesce($5, choices),
       accept = coalesce($6, accept),
       figures = coalesce($7, figures),
       correct = case when $8 then $9 else correct end,
       explanation_latex = case when $10 then $11 else explanation_latex end,
       difficulty = case when $12 then $13 else difficulty end,
       source = case when $14 then $15 else source end,
       updated_at = now()
     where org_id = $1 and id = $2 and archived_at is null
     returning id, type, stem_latex, choices, correct, accept, explanation_latex, figures, difficulty, source, created_at, updated_at`,
    [
      req.params.id,
      type,
      stemLatex,
      choices === undefined ? undefined : JSON.stringify(choices),
      accept === undefined ? undefined : JSON.stringify(accept),
      safeFigures === undefined ? undefined : JSON.stringify(safeFigures),
      correct !== undefined,
      correct === undefined ? null : JSON.stringify(correct),
      explanationLatex !== undefined,
      explanationLatex === undefined ? null : explanationLatex,
      difficulty !== undefined,
      difficulty === undefined ? null : (typeof difficulty === 'number' ? difficulty : null),
      source !== undefined,
      source === undefined ? null : source,
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
