import { Router } from 'express'
import { newId } from '@tittel/shared'
import { orgQuery } from '../db.ts'

export const tagsRouter = Router()

tagsRouter.get('/tags', async (req, res) => {
  const rows = await orgQuery(
    req.auth!.orgId,
    `select id, name, parent_id from tags where org_id = $1 order by name`,
  )
  res.json({ tags: rows })
})

tagsRouter.post('/tags', async (req, res) => {
  const { name, parentId } = req.body ?? {}
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' })
  }
  const id = newId()
  const rows = await orgQuery(
    req.auth!.orgId,
    `insert into tags (id, org_id, name, parent_id) values ($2, $1, $3, $4)
     returning id, name, parent_id`,
    [id, name.trim(), parentId || null],
  )
  res.status(201).json({ tag: rows[0] })
})

tagsRouter.delete('/tags/:id', async (req, res) => {
  const rows = await orgQuery(
    req.auth!.orgId,
    `delete from tags where org_id = $1 and id = $2 returning id`,
    [req.params.id],
  )
  if (!rows[0]) return res.status(404).json({ error: 'not found' })
  res.status(204).end()
})
