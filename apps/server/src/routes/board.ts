import { Router } from 'express'
import { newId } from '@tittel/shared'
import { orgQuery, pool } from '../db.ts'
import { tryAuth } from '../auth.ts'
import { signBoardToken } from '../board/boardToken.ts'

// Tutor-facing board/class management — requireTutor-gated, mounted under
// /api/tutor (see app.ts).
export const boardsRouter = Router()

boardsRouter.get('/boards', async (req, res) => {
  const rows = await orgQuery(
    req.auth!.orgId,
    `select id, title, class_id, student_id, lesson_id, is_ephemeral, created_at
       from boards
      where org_id = $1 and archived_at is null
      order by created_at desc`,
  )
  res.json({ boards: rows })
})

boardsRouter.post('/boards', async (req, res) => {
  const { title, classId, studentId } = req.body ?? {}
  const id = newId()
  const rows = await orgQuery(
    req.auth!.orgId,
    `insert into boards (id, org_id, title, class_id, student_id, is_ephemeral)
     values ($2, $1, $3, $4, $5, false)
     returning id, title, class_id, student_id, is_ephemeral, created_at`,
    [id, title || null, classId || null, studentId || null],
  )
  res.status(201).json({ board: rows[0] })
})

boardsRouter.delete('/boards/:id', async (req, res) => {
  const rows = await orgQuery(
    req.auth!.orgId,
    `update boards set archived_at = now()
     where org_id = $1 and id = $2 and archived_at is null
     returning id`,
    [req.params.id],
  )
  if (!rows[0]) return res.status(404).json({ error: 'not found' })
  res.status(204).end()
})

boardsRouter.get('/classes', async (req, res) => {
  const rows = await orgQuery(
    req.auth!.orgId,
    `select id, name, slug, mode, group_id
       from classes
      where org_id = $1 and archived_at is null
      order by name`,
  )
  res.json({ classes: rows })
})

boardsRouter.post('/classes', async (req, res) => {
  const { name, slug, mode, groupId } = req.body ?? {}
  if (typeof name !== 'string' || !name.trim() || typeof slug !== 'string' || !slug.trim()) {
    return res.status(400).json({ error: 'name and slug are required' })
  }
  const id = newId()
  const rows = await orgQuery(
    req.auth!.orgId,
    `insert into classes (id, org_id, name, slug, mode, group_id)
     values ($2, $1, $3, $4, $5, $6)
     returning id, name, slug, mode, group_id`,
    [id, name.trim(), slug.trim(), mode === 'large' ? 'large' : 'individual', groupId || null],
  )
  res.status(201).json({ class: rows[0] })
})

// "Start class": resume the class's most recent open board, or spin up a
// fresh one, and open a `sessions` row (PLAN.md §6.3).
boardsRouter.post('/classes/:id/start', async (req, res) => {
  const [cls] = await orgQuery(
    req.auth!.orgId,
    `select id, mode from classes where org_id = $1 and id = $2 and archived_at is null`,
    [req.params.id],
  )
  if (!cls) return res.status(404).json({ error: 'class not found' })

  let [board] = await orgQuery(
    req.auth!.orgId,
    `select id from boards
      where org_id = $1 and class_id = $2 and archived_at is null
      order by created_at desc
      limit 1`,
    [req.params.id],
  )
  if (!board) {
    const boardId = newId()
    ;[board] = await orgQuery(
      req.auth!.orgId,
      `insert into boards (id, org_id, class_id, is_ephemeral)
       values ($2, $1, $3, false)
       returning id`,
      [boardId, req.params.id],
    )
  }

  const sessionId = newId()
  await orgQuery(
    req.auth!.orgId,
    `insert into sessions (id, org_id, board_id) values ($2, $1, $3)`,
    [sessionId, board.id],
  )
  res.status(201).json({ boardId: board.id, sessionId })
})

// ---------------------------------------------------------------------------
// Public board-join endpoints (mounted unauthenticated at /api/board — the
// board id + optional name is the whole access model, matching the rest of
// the live-teaching surface). tryAuth resolves an Authorization header when
// present, without ever 401ing a guest.
// ---------------------------------------------------------------------------
export const boardJoinRouter = Router()
boardJoinRouter.use(tryAuth)

boardJoinRouter.get('/:boardId/meta', async (req, res) => {
  const { rows } = await pool.query<{ title: string | null; mode: string | null }>(
    `select b.title, c.mode
       from boards b
       left join classes c on c.id = b.class_id
      where b.id = $1 and b.archived_at is null`,
    [req.params.boardId],
  )
  if (!rows[0]) return res.status(404).json({ error: 'not found' })
  res.json({ title: rows[0].title, mode: rows[0].mode === 'large' ? 'large' : 'small' })
})

boardJoinRouter.post('/:boardId/token', async (req, res) => {
  const { rows } = await pool.query<{ org_id: string; mode: string | null }>(
    `select b.org_id, c.mode
       from boards b
       left join classes c on c.id = b.class_id
      where b.id = $1 and b.archived_at is null`,
    [req.params.boardId],
  )
  const board = rows[0]
  if (!board) return res.status(404).json({ error: 'not found' })
  const mode = board.mode === 'large' ? 'large' : 'small'

  const isHost = !!req.auth && req.auth.orgId === board.org_id
  if (isHost) {
    const boardToken = await signBoardToken({
      boardId: req.params.boardId,
      orgId: req.auth!.orgId,
      role: 'host',
      userId: req.auth!.userId,
      name: req.auth!.email.split('@')[0] || 'Tutor',
    })
    return res.json({ role: 'host', mode, boardToken, displayName: 'Tutor' })
  }

  const name: string | undefined = typeof req.body?.name === 'string' ? req.body.name.trim().slice(0, 64) : undefined
  if (mode === 'large' && !name) {
    return res.status(400).json({ error: 'name is required to join this class' })
  }
  const displayName = name || 'Guest'
  const boardToken = await signBoardToken({
    boardId: req.params.boardId,
    orgId: board.org_id,
    role: 'guest',
    userId: newId(),
    name: displayName,
  })
  res.json({ role: 'guest', mode, boardToken, displayName })
})
