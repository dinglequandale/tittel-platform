import { Router } from 'express'
import { newId, newToken } from '@tittel/shared'
import { orgQuery } from '../db.ts'
import { rematchCalendar } from './calendar.ts'

export const studentsRouter = Router()

// --- Students ----------------------------------------------------------------

// A student's addresses as [{email, role}] (student_emails, schema.sql).
const EMAILS = `coalesce((select json_agg(json_build_object('email', e.email, 'role', e.role) order by e.role desc, e.created_at)
                    from student_emails e where e.student_id = s.id), '[]') as emails`

export interface StudentEmail { email: string; role: 'student' | 'parent' }

/** Cleans a client-supplied email list; null if any entry is malformed. */
export function parseEmails(raw: unknown): StudentEmail[] | null {
  if (!Array.isArray(raw) || raw.length > 20) return null
  const out = new Map<string, StudentEmail>()
  for (const e of raw) {
    const email = typeof e?.email === 'string' ? e.email.trim().toLowerCase() : ''
    const role = e?.role === 'parent' ? 'parent' : e?.role === 'student' ? 'student' : null
    if (!role || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null
    out.set(email, { email, role })
  }
  return [...out.values()]
}

export interface NewStudent { name: string; emails: StudentEmail[]; notes: string | null }

/** Cleans [{name, emails?, notes?}] from a client; a message for the tutor if any entry is off. */
export function parseNewStudents(raw: unknown, max = 100): NewStudent[] | string {
  if (!Array.isArray(raw) || raw.length === 0) return 'name is required'
  if (raw.length > max) return `add up to ${max} students at a time`
  const out: NewStudent[] = []
  for (const r of raw) {
    const name = typeof r?.name === 'string' ? r.name.trim() : ''
    if (!name || name.length > 120) return 'name is required'
    const emails = r?.emails === undefined ? [] : parseEmails(r.emails)
    if (!emails) return `${name}: one of those email addresses doesn't look right`
    out.push({ name, emails, notes: typeof r?.notes === 'string' && r.notes.trim() ? r.notes.trim() : null })
  }
  return out
}

/**
 * Creates students with their addresses in two round trips, however many:
 * one New student, a pasted list, a group's new members, or the people on
 * a calendar invite. Returns their ids in the same order.
 */
export async function createStudents(orgId: string, list: NewStudent[]): Promise<string[]> {
  const ids = list.map(() => newId())
  await orgQuery(
    orgId,
    `insert into students (id, org_id, name, portal_token, report_token, notes)
     select x.id, $1, x.name, x.pt, x.rt, x.notes
       from unnest($2::text[], $3::text[], $4::text[], $5::text[], $6::text[]) as x(id, name, pt, rt, notes)`,
    [ids, list.map((s) => s.name), list.map(() => newToken()), list.map(() => newToken()), list.map((s) => s.notes)],
  )
  const rows = list.flatMap((s, i) => s.emails.map((e) => ({ id: ids[i], ...e })))
  if (rows.length) {
    await orgQuery(
      orgId,
      `insert into student_emails (student_id, org_id, email, role)
       select e.sid, $1, e.email, e.role from unnest($2::text[], $3::text[], $4::text[]) as e(sid, email, role)
       on conflict (student_id, email) do update set role = excluded.role`,
      [rows.map((r) => r.id), rows.map((r) => r.email), rows.map((r) => r.role)],
    )
  }
  return ids
}

/** Adds addresses to a student, keeping any already there. */
export async function addStudentEmails(orgId: string, studentId: string, emails: StudentEmail[]): Promise<void> {
  if (!emails.length) return
  await orgQuery(
    orgId,
    `insert into student_emails (student_id, org_id, email, role)
     select $2, $1, e.email, e.role
       from unnest($3::text[], $4::text[]) as e(email, role)
      where exists (select 1 from students s where s.id = $2 and s.org_id = $1)
     on conflict (student_id, email) do update set role = excluded.role`,
    [studentId, emails.map((e) => e.email), emails.map((e) => e.role)],
  )
}

studentsRouter.get('/students', async (req, res) => {
  const rows = await orgQuery(
    req.auth!.orgId,
    `select s.id, s.name, ${EMAILS}, s.portal_token, s.report_token, s.notes, s.meeting_url, s.created_at,
            b.id as board_id, nl.id as next_lesson_id, nl.scheduled_at as next_lesson_at
       from students s
       left join lateral (
         select id from boards
          where student_id = s.id and archived_at is null
          order by created_at desc limit 1
       ) b on true
       left join lateral (
         select id, scheduled_at from sessions
          where (student_id = s.id or group_id in (select gm.group_id from group_members gm where gm.student_id = s.id))
            and status != 'cancelled'
            and scheduled_at + make_interval(mins => coalesce(duration_min, 60)) > now()
          order by scheduled_at limit 1
       ) nl on true
      where s.org_id = $1 and s.archived_at is null
      order by s.name`,
  )
  res.json({ students: rows })
})

// One student ({name, emails?, notes?}; `email` is a lone student address),
// or several at once ({students: [...]}, a pasted list).
studentsRouter.post('/students', async (req, res) => {
  const orgId = req.auth!.orgId
  const body = req.body ?? {}
  const bulk = Array.isArray(body.students)
  const list = parseNewStudents(bulk ? body.students : [{
    name: body.name, notes: body.notes,
    emails: body.emails ?? (body.email ? [{ email: body.email, role: 'student' }] : undefined),
  }])
  if (typeof list === 'string') return res.status(400).json({ error: list })
  const ids = await createStudents(orgId, list)
  const rows = await orgQuery(
    orgId,
    `select s.id, s.name, ${EMAILS}, s.portal_token, s.report_token, s.notes, s.created_at
       from students s where s.org_id = $1 and s.id = any($2::text[])`,
    [ids],
  )
  const created = ids.map((id) => rows.find((r) => r.id === id))
  rematchCalendar(orgId)
  res.status(201).json(bulk ? { students: created } : { student: created[0] })
})

studentsRouter.patch('/students/:id', async (req, res) => {
  const { name, notes, meetingUrl } = req.body ?? {}
  // `emails`, when present, replaces the student's whole address list.
  const emails = req.body?.emails === undefined ? undefined : parseEmails(req.body.emails)
  if (emails === null) return res.status(400).json({ error: "one of those email addresses doesn't look right" })
  // notes/meeting_url are nullable — an explicit null clears them, distinct
  // from the field being absent (undefined), which coalesce can't tell apart.
  const rows = await orgQuery(
    req.auth!.orgId,
    `update students set
       name = coalesce($3, name),
       notes = case when $4 then $5 else notes end,
       meeting_url = case when $6 then $7 else meeting_url end
     where org_id = $1 and id = $2 and archived_at is null
     returning id, name, portal_token, report_token, notes, meeting_url, created_at`,
    [req.params.id, name, notes !== undefined, notes ?? null, meetingUrl !== undefined, meetingUrl ?? null],
  )
  if (!rows[0]) return res.status(404).json({ error: 'not found' })
  if (emails) {
    await orgQuery(
      req.auth!.orgId,
      `delete from student_emails where org_id = $1 and student_id = $2 and not (email = any($3::text[]))`,
      [req.params.id, emails.map((e) => e.email)],
    )
    await addStudentEmails(req.auth!.orgId, req.params.id, emails)
    rematchCalendar(req.auth!.orgId)
  }
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
  rematchCalendar(req.auth!.orgId)
  res.status(204).end()
})

// Get-or-create the student's persistent board (PLAN.md §6.3 board-per-
// student flow, HANDOFF.md D1) — a tutor can copy this link right before a
// 1:1 lesson without having to remember whether one already exists. Also
// what starting or joining a lesson opens (routes/sessions.ts, portal.ts).
export async function getOrCreateStudentBoard(orgId: string, studentId: string): Promise<string | null> {
  const [student] = await orgQuery<{ id: string; name: string }>(
    orgId,
    `select id, name from students where org_id = $1 and id = $2 and archived_at is null`,
    [studentId],
  )
  if (!student) return null

  let [board] = await orgQuery<{ id: string }>(
    orgId,
    `select id from boards
      where org_id = $1 and student_id = $2 and archived_at is null
      order by created_at desc limit 1`,
    [studentId],
  )
  if (!board) {
    const boardId = newId()
    ;[board] = await orgQuery<{ id: string }>(
      orgId,
      `insert into boards (id, org_id, student_id, title, is_ephemeral)
       values ($2, $1, $3, $4, false)
       returning id`,
      [boardId, studentId, `${student.name} — board`],
    )
  }
  return board.id
}

studentsRouter.post('/students/:id/board', async (req, res) => {
  const boardId = await getOrCreateStudentBoard(req.auth!.orgId, req.params.id)
  if (!boardId) return res.status(404).json({ error: 'student not found' })
  res.json({ boardId })
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

// A group in one go: its name, the students already in the app who are in
// it, new students to create for it, and parent addresses shared by all of
// them (siblings booked through one parent).
studentsRouter.post('/groups', async (req, res) => {
  const orgId = req.auth!.orgId
  const { name } = req.body ?? {}
  if (typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' })
  }
  const studentIds: string[] = Array.isArray(req.body?.studentIds) ? req.body.studentIds.filter((x: unknown) => typeof x === 'string') : []
  const fresh = Array.isArray(req.body?.newStudents) && req.body.newStudents.length ? parseNewStudents(req.body.newStudents, 30) : []
  if (typeof fresh === 'string') return res.status(400).json({ error: fresh })
  const parentEmails = Array.isArray(req.body?.parentEmails)
    ? parseEmails(req.body.parentEmails.map((email: unknown) => ({ email, role: 'parent' }))) : []
  if (!parentEmails) return res.status(400).json({ error: "that parent email address doesn't look right" })
  const found = studentIds.length
    ? await orgQuery(orgId, `select id from students where org_id = $1 and id = any($2::text[]) and archived_at is null`, [studentIds])
    : []
  if (found.length !== new Set(studentIds).size) return res.status(400).json({ error: 'student not found' })

  const id = newId()
  const rows = await orgQuery(
    orgId,
    `insert into groups (id, org_id, name) values ($2, $1, $3)
     returning id, name, created_at`,
    [id, name.trim()],
  )
  const memberIds = [...new Set(studentIds), ...(fresh.length ? await createStudents(orgId, fresh) : [])]
  if (memberIds.length) {
    await orgQuery(
      orgId,
      `insert into group_members (group_id, student_id)
       select $2, s.id from students s where s.org_id = $1 and s.id = any($3::text[])
       on conflict do nothing`,
      [id, memberIds],
    )
  }
  for (const sid of memberIds) await addStudentEmails(orgId, sid, parentEmails)
  const members = memberIds.length
    ? await orgQuery(orgId, `select id, name from students where org_id = $1 and id = any($2::text[]) order by name`, [memberIds])
    : []
  rematchCalendar(orgId)
  res.status(201).json({ group: { ...rows[0], members } })
})

// Get-or-create the group's shared board (HANDOFF.md D1): group-class
// students all get one fixed board, keyed through a `classes` row (mode
// 'large' so the join page name-gates guests, same as any large class)
// rather than boards.class_id pointing straight at the group.
export async function getOrCreateGroupBoard(orgId: string, groupId: string): Promise<string | null> {
  const [group] = await orgQuery<{ id: string; name: string }>(
    orgId,
    `select id, name from groups where org_id = $1 and id = $2 and archived_at is null`,
    [groupId],
  )
  if (!group) return null

  let [cls] = await orgQuery<{ id: string }>(
    orgId,
    `select id from classes where org_id = $1 and group_id = $2 and archived_at is null limit 1`,
    [groupId],
  )
  if (!cls) {
    const classId = newId()
    ;[cls] = await orgQuery<{ id: string }>(
      orgId,
      `insert into classes (id, org_id, name, slug, mode, group_id)
       values ($2, $1, $3, $4, 'large', $5)
       returning id`,
      [classId, group.name, groupId, groupId],
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
  return board.id
}

studentsRouter.post('/groups/:id/board', async (req, res) => {
  const boardId = await getOrCreateGroupBoard(req.auth!.orgId, req.params.id)
  if (!boardId) return res.status(404).json({ error: 'group not found' })
  res.json({ boardId })
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
  rematchCalendar(req.auth!.orgId)
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
  rematchCalendar(req.auth!.orgId)
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
  rematchCalendar(req.auth!.orgId)
  res.status(204).end()
})
