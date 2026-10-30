import { Router } from 'express'
import { orgQuery, pool } from '../db.ts'

// The tutor's data, theirs to take away or delete (Settings → Your data).
export const accountRouter = Router()

// Every tenant table, read through its org: tables without their own org_id
// join to a parent that has one. Order follows schema.sql.
const EXPORT_TABLES: [string, string][] = [
  ['users', `select id, email, display_name, role, created_at from users where org_id = $1`],
  ['students', `select * from students where org_id = $1`],
  ['student_emails', `select * from student_emails where org_id = $1`],
  ['groups', `select * from groups where org_id = $1`],
  ['group_members', `select gm.* from group_members gm join groups g on g.id = gm.group_id where g.org_id = $1`],
  ['tags', `select * from tags where org_id = $1`],
  ['problems', `select * from problems where org_id = $1`],
  ['problem_tags', `select pt.* from problem_tags pt join problems p on p.id = pt.problem_id where p.org_id = $1`],
  ['problem_sets', `select * from problem_sets where org_id = $1`],
  ['set_problems', `select sp.* from set_problems sp join problem_sets s on s.id = sp.set_id where s.org_id = $1`],
  ['plans', `select * from lessons where org_id = $1`],
  ['plan_tags', `select lt.* from lesson_tags lt join lessons l on l.id = lt.lesson_id where l.org_id = $1`],
  ['assignments', `select * from assignments where org_id = $1`],
  ['assignment_students', `select x.* from assignment_student x join assignments a on a.id = x.assignment_id where a.org_id = $1`],
  ['assignment_problems', `select x.* from assignment_problems x join assignments a on a.id = x.assignment_id where a.org_id = $1`],
  ['attempts', `select * from attempts where org_id = $1`],
  ['responses', `select r.* from responses r join attempts at on at.id = r.attempt_id where at.org_id = $1`],
  ['classes', `select * from classes where org_id = $1`],
  ['lesson_series', `select * from lesson_series where org_id = $1`],
  ['calendar_links', `select * from calendar_links where org_id = $1`],
  ['boards', `select * from boards where org_id = $1`],
  ['lessons', `select * from sessions where org_id = $1`],
  ['board_answers', `select * from quiz_events where org_id = $1`],
]

// One JSON file, written table by table and file by file, so a large
// workspace never sits in memory whole. Uploaded files (worksheets, photos of
// work, board notes) come with their contents as base64. The calendar's
// secret address is left out: it's a password, and the file may be shared.
accountRouter.get('/export', async (req, res) => {
  const orgId = req.auth!.orgId
  const [org] = await orgQuery<{ id: string; name: string; settings: Record<string, unknown>; created_at: string }>(
    orgId,
    `select id, name, plan, settings, created_at from orgs where id = $1::text /* org_id */`,
  )
  if (!org) return res.status(404).json({ error: 'not found' })
  const { icsUrl: _secret, ...settings } = org.settings ?? {}
  const day = new Date().toISOString().slice(0, 10)
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-disposition', `attachment; filename="slate-export-${day}.json"`)
  res.write(`{"exportedAt":${JSON.stringify(new Date().toISOString())},"workspace":${JSON.stringify({ ...org, settings })}`)
  for (const [name, sql] of EXPORT_TABLES) {
    res.write(`,${JSON.stringify(name)}:${JSON.stringify(await orgQuery(orgId, sql))}`)
  }
  const files = await orgQuery<{ id: string }>(orgId, `select id from files where org_id = $1 order by created_at`)
  res.write(',"files":[')
  for (let i = 0; i < files.length; i++) {
    const [f] = await orgQuery<{ bytes: Buffer }>(
      orgId,
      `select id, name, content_type, size, created_at, bytes from files where org_id = $1 and id = $2`,
      [files[i].id],
    )
    const { bytes, ...meta } = f
    res.write(`${i ? ',' : ''}${JSON.stringify({ ...meta, base64: bytes.toString('base64') })}`)
  }
  res.end(']}')
})

// Deletes the whole workspace: everything else cascades from orgs. The tutor
// types the business name to confirm. Their sign-in itself stays (removing
// it needs Supabase's service key, which the server doesn't hold); signing in
// again starts an empty workspace (auth.ts).
accountRouter.delete('/org', async (req, res) => {
  const orgId = req.auth!.orgId
  const [org] = await orgQuery<{ name: string }>(orgId, `select name from orgs where id = $1::text /* org_id */`)
  if (!org) return res.status(404).json({ error: 'not found' })
  const typed = typeof req.body?.confirm === 'string' ? req.body.confirm.trim() : ''
  if (typed.toLowerCase() !== org.name.trim().toLowerCase()) {
    return res.status(400).json({ error: 'Type your business name exactly to confirm.' })
  }
  // Homework first: assignments, their problem snapshots and the answers
  // point at problems and sets without cascading, so a single cascade from
  // orgs trips over them. One transaction, so a failure deletes nothing.
  const client = await pool.connect()
  try {
    await client.query('begin')
    await client.query(`delete from assignments where org_id = $1`, [orgId])
    await client.query(`delete from orgs where id = $1`, [orgId])
    await client.query('commit')
  } catch (err) {
    await client.query('rollback')
    throw err
  } finally {
    client.release()
  }
  res.status(204).end()
})
