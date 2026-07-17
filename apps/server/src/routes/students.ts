import { Router } from 'express'
import { newId, newToken } from '@tittel/shared'
import { orgQuery } from '../db.ts'

export const studentsRouter = Router()

// --- Students ----------------------------------------------------------------

studentsRouter.get('/students', async (req, res) => {
  const rows = await orgQuery(
    req.auth!.orgId,
    `select s.id, s.name, s.email, s.portal_token, s.report_token, s.notes, s.created_at,
            b.id as board_id
       from students s
       left join lateral (
         select id from boards
          where student_id = s.id and archived_at is null
          order by created_at desc limit 1
       ) b on true
      where s.org_id = $1 and s.archived_at is null
      order by s.name`,
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
  // email/notes are nullable — an explicit null clears them, distinct from
  // the field being absent (undefined), which coalesce alone can't tell apart.
  const rows = await orgQuery(
    req.auth!.orgId,
    `update students set
       name = coalesce($3, name),
       email = case when $4 then $5 else email end,
       notes = case when $6 then $7 else notes end
     where org_id = $1 and id = $2 and archived_at is null
     returning id, name, email, portal_token, report_token, notes, created_at`,
    [req.params.id, name, email !== undefined, email ?? null, notes !== undefined, notes ?? null],
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

// Get-or-create the student's persistent board (PLAN.md §6.3 board-per-
// student flow, HANDOFF.md D1) — a tutor can copy this link right before a
// 1:1 lesson without having to remember whether one already exists.
studentsRouter.post('/students/:id/board', async (req, res) => {
  const orgId = req.auth!.orgId
  const [student] = await orgQuery<{ id: string; name: string }>(
    orgId,
    `select id, name from students where org_id = $1 and id = $2 and archived_at is null`,
    [req.params.id],
  )
  if (!student) return res.status(404).json({ error: 'student not found' })

  let [board] = await orgQuery<{ id: string }>(
    orgId,
    `select id from boards
      where org_id = $1 and student_id = $2 and archived_at is null
      order by created_at desc limit 1`,
    [req.params.id],
  )
  if (!board) {
    const boardId = newId()
    ;[board] = await orgQuery<{ id: string }>(
      orgId,
      `insert into boards (id, org_id, student_id, title, is_ephemeral)
       values ($2, $1, $3, $4, false)
       returning id`,
      [boardId, req.params.id, `${student.name} — board`],
    )
  }
  res.json({ boardId: board.id })
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
            ) as members,
            bd.id as board_id
       from groups g
       left join group_members gm on gm.group_id = g.id
       left join students s on s.id = gm.student_id and s.archived_at is null
       left join lateral (
         select b.id from classes c
          join boards b on b.class_id = c.id and b.archived_at is null
          where c.group_id = g.id and c.archived_at is null
          order by b.created_at desc limit 1
       ) bd on true
      where g.org_id = $1 and g.archived_at is null
      group by g.id, bd.id
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

// Get-or-create the group's shared board (HANDOFF.md D1): group-class
// students all get one fixed board, keyed through a `classes` row (mode
// 'large' so the join page name-gates guests, same as any large class)
// rather than boards.class_id pointing straight at the group.
studentsRouter.post('/groups/:id/board', async (req, res) => {
  const orgId = req.auth!.orgId
  const [group] = await orgQuery<{ id: string; name: string }>(
    orgId,
    `select id, name from groups where org_id = $1 and id = $2 and archived_at is null`,
    [req.params.id],
  )
  if (!group) return res.status(404).json({ error: 'group not found' })

  let [cls] = await orgQuery<{ id: string }>(
    orgId,
    `select id from classes where org_id = $1 and group_id = $2 and archived_at is null limit 1`,
    [req.params.id],
  )
  if (!cls) {
    const classId = newId()
    ;[cls] = await orgQuery<{ id: string }>(
      orgId,
      `insert into classes (id, org_id, name, slug, mode, group_id)
       values ($2, $1, $3, $4, 'large', $5)
       returning id`,
      [classId, group.name, req.params.id, req.params.id],
    )
  }

  let [board] = await orgQuery<{ id: string }>(
    orgId,
    `select id from boards
      where org_id = $1 and class_id = $2 and archived_at is null
      order by created_at desc limit 1`,
    [cls.id],
  )
  if (!board) {
    const boardId = newId()
    ;[board] = await orgQuery<{ id: string }>(
      orgId,
      `insert into boards (id, org_id, class_id, title, is_ephemeral)
       values ($2, $1, $3, $4, false)
       returning id`,
      [boardId, cls.id, `${group.name} — board`],
    )
  }
  res.json({ boardId: board.id })
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
