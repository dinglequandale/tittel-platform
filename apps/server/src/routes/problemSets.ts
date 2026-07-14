import { Router } from 'express'
import { newId } from '@tittel/shared'
import type { LegacyProblemSet } from '@tittel/shared'
import { orgQuery } from '../db.ts'
import { importLegacyProblemSet, ImportError } from '../lib/legacyImport.ts'

export const problemSetsRouter = Router()

const TEMPLATES = ['neutral', 'sat']

problemSetsRouter.get('/problem-sets', async (req, res) => {
  const rows = await orgQuery(
    req.auth!.orgId,
    `select s.id, s.title, s.description, s.template, s.created_at, s.updated_at,
            count(sp.problem_id)::int as problem_count
       from problem_sets s
       left join set_problems sp on sp.set_id = s.id
      where s.org_id = $1 and s.archived_at is null
      group by s.id
      order by s.updated_at desc`,
  )
  res.json({ problemSets: rows })
})

problemSetsRouter.post('/problem-sets', async (req, res) => {
  const { title, description, template } = req.body ?? {}
  if (typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title is required' })
  }
  if (template !== undefined && !TEMPLATES.includes(template)) {
    return res.status(400).json({ error: `template must be one of ${TEMPLATES.join(', ')}` })
  }
  const id = newId()
  const rows = await orgQuery(
    req.auth!.orgId,
    `insert into problem_sets (id, org_id, title, description, template)
     values ($2, $1, $3, $4, $5)
     returning id, title, description, template, created_at, updated_at`,
    [id, title.trim(), description || null, template || 'neutral'],
  )
  res.status(201).json({ problemSet: { ...rows[0], problem_count: 0 } })
})

problemSetsRouter.get('/problem-sets/:id', async (req, res) => {
  const rows = await orgQuery(
    req.auth!.orgId,
    `select id, title, description, template, created_at, updated_at
       from problem_sets where org_id = $1 and id = $2`,
    [req.params.id],
  )
  if (!rows[0]) return res.status(404).json({ error: 'not found' })

  const problems = await orgQuery(
    req.auth!.orgId,
    `select p.id, p.type, p.stem_latex, p.choices, p.correct, p.accept,
            p.explanation_latex, p.figures, sp.ordinal
       from set_problems sp
       join problems p on p.id = sp.problem_id
      where sp.set_id = $2 and p.org_id = $1
      order by sp.ordinal`,
    [req.params.id],
  )
  res.json({ problemSet: { ...rows[0], problems } })
})

problemSetsRouter.patch('/problem-sets/:id', async (req, res) => {
  const { title, description, template } = req.body ?? {}
  if (template !== undefined && !TEMPLATES.includes(template)) {
    return res.status(400).json({ error: `template must be one of ${TEMPLATES.join(', ')}` })
  }
  const rows = await orgQuery(
    req.auth!.orgId,
    `update problem_sets set
       title = coalesce($3, title),
       description = coalesce($4, description),
       template = coalesce($5, template),
       updated_at = now()
     where org_id = $1 and id = $2 and archived_at is null
     returning id, title, description, template, created_at, updated_at`,
    [req.params.id, title, description, template],
  )
  if (!rows[0]) return res.status(404).json({ error: 'not found' })
  res.json({ problemSet: rows[0] })
})

problemSetsRouter.delete('/problem-sets/:id', async (req, res) => {
  const rows = await orgQuery(
    req.auth!.orgId,
    `update problem_sets set archived_at = now()
     where org_id = $1 and id = $2 and archived_at is null
     returning id`,
    [req.params.id],
  )
  if (!rows[0]) return res.status(404).json({ error: 'not found' })
  res.status(204).end()
})

problemSetsRouter.post('/problem-sets/:id/problems', async (req, res) => {
  const { problemId } = req.body ?? {}
  if (typeof problemId !== 'string') return res.status(400).json({ error: 'problemId is required' })

  const [set] = await orgQuery(
    req.auth!.orgId,
    `select id from problem_sets where org_id = $1 and id = $2 and archived_at is null`,
    [req.params.id],
  )
  if (!set) return res.status(404).json({ error: 'set not found' })
  const [problem] = await orgQuery(
    req.auth!.orgId,
    `select id from problems where org_id = $1 and id = $2 and archived_at is null`,
    [problemId],
  )
  if (!problem) return res.status(404).json({ error: 'problem not found' })

  const [{ next_ordinal }] = await orgQuery<{ next_ordinal: number }>(
    req.auth!.orgId,
    `select coalesce(max(sp.ordinal) + 1, 0) as next_ordinal
       from set_problems sp
       join problem_sets s on s.id = sp.set_id
      where s.org_id = $1 and sp.set_id = $2`,
    [req.params.id],
  )
  await orgQuery(
    req.auth!.orgId,
    `insert into set_problems (set_id, problem_id, ordinal)
     select $2, $3, $4
      where exists (select 1 from problem_sets s where s.id = $2 and s.org_id = $1)
     on conflict (set_id, problem_id) do nothing`,
    [req.params.id, problemId, next_ordinal],
  )
  res.status(204).end()
})

problemSetsRouter.delete('/problem-sets/:id/problems/:problemId', async (req, res) => {
  await orgQuery(
    req.auth!.orgId,
    `delete from set_problems sp using problem_sets s
      where s.id = sp.set_id and s.org_id = $1
        and sp.set_id = $2 and sp.problem_id = $3`,
    [req.params.id, req.params.problemId],
  )
  res.status(204).end()
})

problemSetsRouter.put('/problem-sets/:id/order', async (req, res) => {
  const problemIds: unknown = req.body?.problemIds
  if (!Array.isArray(problemIds) || !problemIds.every((s) => typeof s === 'string')) {
    return res.status(400).json({ error: 'problemIds must be a string array' })
  }
  const [set] = await orgQuery(
    req.auth!.orgId,
    `select id from problem_sets where org_id = $1 and id = $2`,
    [req.params.id],
  )
  if (!set) return res.status(404).json({ error: 'set not found' })

  for (let i = 0; i < problemIds.length; i++) {
    await orgQuery(
      req.auth!.orgId,
      `update set_problems sp set ordinal = $4
         from problem_sets s
        where s.id = sp.set_id and s.org_id = $1
          and sp.set_id = $2 and sp.problem_id = $3`,
      [req.params.id, problemIds[i], i],
    )
  }
  res.status(204).end()
})

// Legacy JSON import — validates, renders TikZ figures, and creates bank
// problems + a new set referencing them (PLAN.md §10 Phase 1).
problemSetsRouter.post('/problem-sets/import', async (req, res) => {
  const set = req.body as LegacyProblemSet
  try {
    const result = await importLegacyProblemSet(req.auth!.orgId, set)
    res.status(201).json(result)
  } catch (err) {
    if (err instanceof ImportError) {
      return res.status(422).json({ error: 'invalid problem set', details: err.errors })
    }
    throw err
  }
})
