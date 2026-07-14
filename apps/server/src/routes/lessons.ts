import { Router } from 'express'
import { newId } from '@tittel/shared'
import { parseLessonDoc, LessonParseError } from '@tittel/shared'
import { orgQuery } from '../db.ts'

export const lessonsRouter = Router()

lessonsRouter.get('/lessons', async (req, res) => {
  const rows = await orgQuery(
    req.auth!.orgId,
    `select id, title, version, created_at, updated_at
       from lessons where org_id = $1 and archived_at is null
      order by updated_at desc`,
  )
  res.json({ lessons: rows })
})

lessonsRouter.get('/lessons/:id', async (req, res) => {
  const rows = await orgQuery(
    req.auth!.orgId,
    `select id, title, doc, version, created_at, updated_at
       from lessons where org_id = $1 and id = $2`,
    [req.params.id],
  )
  if (!rows[0]) return res.status(404).json({ error: 'not found' })
  res.json({ lesson: rows[0] })
})

lessonsRouter.post('/lessons', async (req, res) => {
  const { title, doc } = req.body ?? {}
  if (typeof title !== 'string' || !title.trim()) {
    return res.status(400).json({ error: 'title is required' })
  }
  const id = newId()
  const rows = await orgQuery(
    req.auth!.orgId,
    `insert into lessons (id, org_id, title, doc) values ($2, $1, $3, $4)
     returning id, title, doc, version, created_at, updated_at`,
    [id, title.trim(), JSON.stringify(doc ?? { title: title.trim(), pages: [] })],
  )
  res.status(201).json({ lesson: rows[0] })
})

lessonsRouter.patch('/lessons/:id', async (req, res) => {
  const { title, doc } = req.body ?? {}
  const rows = await orgQuery(
    req.auth!.orgId,
    `update lessons set
       title = coalesce($3, title),
       doc = coalesce($4, doc),
       version = version + case when $4::jsonb is not null then 1 else 0 end,
       updated_at = now()
     where org_id = $1 and id = $2 and archived_at is null
     returning id, title, doc, version, created_at, updated_at`,
    [req.params.id, title, doc === undefined ? undefined : JSON.stringify(doc)],
  )
  if (!rows[0]) return res.status(404).json({ error: 'not found' })
  res.json({ lesson: rows[0] })
})

lessonsRouter.delete('/lessons/:id', async (req, res) => {
  const rows = await orgQuery(
    req.auth!.orgId,
    `update lessons set archived_at = now()
     where org_id = $1 and id = $2 and archived_at is null
     returning id`,
    [req.params.id],
  )
  if (!rows[0]) return res.status(404).json({ error: 'not found' })
  res.status(204).end()
})

// JSON import: validates the LessonDoc shape (whiteboard's schema.ts) before
// storing it — a malformed `answer` block would otherwise corrupt grading.
lessonsRouter.post('/lessons/import', async (req, res) => {
  let doc
  try {
    doc = parseLessonDoc(req.body)
  } catch (err) {
    if (err instanceof LessonParseError) {
      return res.status(422).json({ error: err.message })
    }
    throw err
  }
  const id = newId()
  const rows = await orgQuery(
    req.auth!.orgId,
    `insert into lessons (id, org_id, title, doc) values ($2, $1, $3, $4)
     returning id, title, doc, version, created_at, updated_at`,
    [id, doc.title, JSON.stringify(doc)],
  )
  res.status(201).json({ lesson: rows[0] })
})

// JSON export: hand back the raw doc for download — round-trips through the
// same LessonDoc shape the whiteboard renders.
lessonsRouter.get('/lessons/:id/export', async (req, res) => {
  const rows = await orgQuery(
    req.auth!.orgId,
    `select title, doc from lessons where org_id = $1 and id = $2`,
    [req.params.id],
  )
  if (!rows[0]) return res.status(404).json({ error: 'not found' })
  res.setHeader('Content-Disposition', `attachment; filename="${rows[0].title}.json"`)
  res.json(rows[0].doc)
})
