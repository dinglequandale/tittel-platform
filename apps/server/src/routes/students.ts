import { Router } from 'express'
import { newId, newToken } from '@tittel/shared'
import { orgQuery } from '../db.ts'

export const studentsRouter = Router()

// --- Students ----------------------------------------------------------------

studentsRouter.get('/students', async (req, res) => {
  const rows = await orgQuery(
    req.auth!.orgId,
    `select id, name, email, portal_token, report_token, notes, created_at
       from students
      where org_id = $1 and archived_at is null
      order by name`,
  )
  res.json({ students: rows })
})

studentsRouter.post('/students', async (req, res) => {
  const { name, email, notes } = req.body ?? {}
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' })
  }
  const id = newId()
  const rows = await orgQuery(
    req.auth!.orgId,
    `insert into students (id, org_id, name, email, portal_token, report_token, notes)
     values ($2, $1, $3, $4, $5, $6, $7)
     returning id, name, email, portal_token, report_token, notes, created_at`,
    [id, name.trim(), email || null, newToken(), newToken(), notes || null],
  )
  res.status(201).json({ student: rows[0] })
})

studentsRouter.patch('/students/:id', async (req, res) => {
  const { name, email, notes } = req.body ?? {}
  const rows = await orgQuery(
    req.auth!.orgId,
    `update students set
       name = coalesce($3, name),
       email = coalesce($4, email),
       notes = coalesce($5, notes)
     where org_id = $1 and id = $2 and archived_at is null
     returning id, name, email, portal_token, report_token, notes, created_at`,
    [req.params.id, name, email, notes],
  )
  if (!rows[0]) return res.status(404).json({ error: 'not found' })
  res.json({ student: rows[0] })
})

studentsRouter.delete('/students/:id', async (req, res) => {
  const rows = await orgQuery(
    req.auth!.orgId,
    `update students set archived_at = now()
     where org_id = $1 and id = $2 and archived_at is null
     returning id`,
    [req.params.id],
  )
  if (!rows[0]) return res.status(404).json({ error: 'not found' })
  res.status(204).end()
})

// --- Groups --------------------------------------------------------------------

studentsRouter.get('/groups', async (req, res) => {
  const rows = await orgQuery(
    req.auth!.orgId,
    `select g.id, g.name, g.created_at,
            coalesce(
              json_agg(json_build_object('id', s.id, 'name', s.name) order by s.name)
                filter (where s.id is not null),
              '[]'
            ) as members
       from groups g
       left join group_members gm on gm.group_id = g.id
       left join students s on s.id = gm.student_id and s.archived_at is null
      where g.org_id = $1 and g.archived_at is null
      group by g.id
      order by g.name`,
  )
  res.json({ groups: rows })
})

studentsRouter.post('/groups', async (req, res) => {
  const { name } = req.body ?? {}
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' })
  }
  const id = newId()
  const rows = await orgQuery(
    req.auth!.orgId,
    `insert into groups (id, org_id, name) values ($2, $1, $3)
     returning id, name, created_at`,
    [id, name.trim()],
  )
  res.status(201).json({ group: { ...rows[0], members: [] } })
})

studentsRouter.delete('/groups/:id', async (req, res) => {
  const rows = await orgQuery(
    req.auth!.orgId,
    `update groups set archived_at = now()
     where org_id = $1 and id = $2 and archived_at is null
     returning id`,
    [req.params.id],
  )
  if (!rows[0]) return res.status(404).json({ error: 'not found' })
  res.status(204).end()
})

studentsRouter.post('/groups/:id/members', async (req, res) => {
  const studentIds: unknown = req.body?.studentIds
  if (!Array.isArray(studentIds) || !studentIds.every((s) => typeof s === 'string')) {
    return res.status(400).json({ error: 'studentIds must be a string array' })
  }
  // Both the group and every student must belong to this org — group_members
  // itself carries no org_id, so tenancy is enforced here via the join.
  const [group] = await orgQuery(
    req.auth!.orgId,
    `select id from groups where org_id = $1 and id = $2 and archived_at is null`,
    [req.params.id],
  )
  if (!group) return res.status(404).json({ error: 'group not found' })

  for (const studentId of studentIds) {
    await orgQuery(
      req.auth!.orgId,
      `insert into group_members (group_id, student_id)
       select $2, s.id from students s where s.org_id = $1 and s.id = $3
       on conflict do nothing`,
      [req.params.id, studentId],
    )
  }
  res.status(204).end()
})

studentsRouter.delete('/groups/:id/members/:studentId', async (req, res) => {
  const [group] = await orgQuery(
    req.auth!.orgId,
    `select id from groups where org_id = $1 and id = $2`,
    [req.params.id],
  )
  if (!group) return res.status(404).json({ error: 'group not found' })
  await orgQuery(
    req.auth!.orgId,
    `delete from group_members
      where group_id = $2 and student_id = $3
        and exists (select 1 from groups g where g.id = $2 and g.org_id = $1)`,
    [req.params.id, req.params.studentId],
  )
  res.status(204).end()
})
