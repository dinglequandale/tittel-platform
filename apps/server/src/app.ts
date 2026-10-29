import './lib/sentry.ts'
import 'express-async-errors'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import * as Sentry from '@sentry/node'
import { pool } from './db.ts'
import { requireTutor } from './auth.ts'
import { studentsRouter } from './routes/students.ts'
import { tagsRouter } from './routes/tags.ts'
import { problemsRouter } from './routes/problems.ts'
import { problemSetsRouter } from './routes/problemSets.ts'
import { lessonsRouter } from './routes/lessons.ts'
import { assignmentsRouter } from './routes/assignments.ts'
import { attemptRouter } from './routes/attempt.ts'
import { portalRouter } from './routes/portal.ts'
import { boardsRouter, boardJoinRouter } from './routes/board.ts'
import { boardAssetsRouter } from './board/assets.ts'
import { aiImportRouter } from './routes/aiImport.ts'
import { sessionsRouter } from './routes/sessions.ts'
import { orgRouter } from './routes/org.ts'
import { calendarRouter } from './routes/calendar.ts'
import { filesRouter, publicFilesRouter } from './routes/files.ts'
import { followUpRouter } from './routes/followUp.ts'
import { demoRouter } from './routes/demo.ts'
import { rateLimit } from './lib/rateLimit.ts'

// The configured Express app — defined separately from the listen() bootstrap
// (src/index.ts) so it can also be imported elsewhere (e.g. tests) without
// binding a port. All state lives in Postgres; nothing here holds in-memory
// state (boards/control state is added in Phase 3).
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webDist = path.resolve(__dirname, '../../web/dist')

export const app = express()
// POST /api/tutor/ai-import carries a base64'd document (up to ~40mb) and
// parses its own body at a larger limit (aiImport.ts) — exclude it here so
// this 8mb limit doesn't reject it before that route-level parser runs.
app.use((req, res, next) => {
  if (req.path === '/api/tutor/ai-import') return next()
  express.json({ limit: '8mb' })(req, res, next)
})

// ---------------------------------------------------------------------------
// API. Feature routers land phase by phase (PLAN.md §10); /api/health and
// /api/tutor/session prove the DB + auth wiring for Phase 0.
// ---------------------------------------------------------------------------
app.get('/api/health', async (_req, res) => {
  try {
    const { rows } = await pool.query('select now() as now')
    res.json({ ok: true, db: true, now: rows[0].now })
  } catch (err) {
    res.status(503).json({ ok: false, db: false, error: (err as Error).message })
  }
})

app.get('/api/tutor/session', requireTutor, (req, res) => {
  res.json({ auth: req.auth })
})

// Phase 1 — students & content data layer (PLAN.md §10). Every route below
// is org-scoped via req.auth (set by requireTutor) and orgQuery (db.ts).
app.use('/api/tutor', requireTutor, studentsRouter)
app.use('/api/tutor', requireTutor, tagsRouter)
app.use('/api/tutor', requireTutor, problemsRouter)
app.use('/api/tutor', requireTutor, problemSetsRouter)
app.use('/api/tutor', requireTutor, lessonsRouter)
app.use('/api/tutor', requireTutor, assignmentsRouter)
app.use('/api/tutor', requireTutor, boardsRouter)
app.use('/api/tutor', requireTutor, aiImportRouter)
// FLOW-SPEC F1 — lessons (the weekly hub) and the tutor's workspace settings.
app.use('/api/tutor', requireTutor, sessionsRouter)
app.use('/api/tutor', requireTutor, orgRouter)
app.use('/api/tutor', requireTutor, calendarRouter)
app.use('/api/tutor', requireTutor, filesRouter)
app.use('/api/tutor', requireTutor, followUpRouter)
app.use('/api/tutor', requireTutor, demoRouter)
// Uploaded files by their token: plan pages on boards, worksheets on portals.
app.use('/api/files', rateLimit(1200), publicFilesRouter)

// Phase 2 — student-facing magic-link surfaces (no Supabase auth; the token
// itself is the access control — see attemptQuery/studentQuery in db.ts).
// Render sits one proxy in front, so the client's IP is the forwarded one.
if (process.env.NODE_ENV === 'production') app.set('trust proxy', 1)
app.use('/api/portal', rateLimit(600), portalRouter)
app.use('/api/attempt', rateLimit(1200), attemptRouter)

// Phase 3 — live boards (PLAN.md §6.3). /api/board is public: the board id
// (plus an optional display name) is the whole guest access model, same as
// the rest of the live-teaching surface. Asset uploads live at the bare
// /uploads path (no /api prefix), matching the ported whiteboard's convention.
app.use('/api/board', rateLimit(600), boardJoinRouter)
app.use(boardAssetsRouter)

// Any unmatched /api route is a 404 (not the SPA fallback HTML).
app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }))

// Central error handler so a thrown/rejected route returns JSON, not an HTML 500.
// Body-parser errors (malformed JSON, oversized body) carry their own 4xx
// status and a client-safe message. Anything else is ours: log it, and don't
// hand raw DB/driver text to anonymous student and guest callers.
app.use('/api', (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const status = (err as { status?: number })?.status
  if (status && status >= 400 && status < 500) {
    return res.status(status).json({ error: (err as Error).message })
  }
  console.error('[api error]', err)
  Sentry.captureException(err)
  res.status(500).json({ error: 'internal error' })
})

// ---------------------------------------------------------------------------
// Static client + SPA fallback (production build only; in dev Vite serves it).
// ---------------------------------------------------------------------------
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist))
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api')) return next()
    res.sendFile(path.join(webDist, 'index.html'))
  })
}
