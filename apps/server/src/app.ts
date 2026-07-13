import 'express-async-errors'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { pool } from './db.ts'
import { requireTutor } from './auth.ts'

// The configured Express app — defined separately from the listen() bootstrap
// (src/index.ts) so it can also be imported elsewhere (e.g. tests) without
// binding a port. All state lives in Postgres; nothing here holds in-memory
// state (boards/control state is added in Phase 3).
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const webDist = path.resolve(__dirname, '../../web/dist')

export const app = express()
app.use(express.json({ limit: '2mb' }))

// ---------------------------------------------------------------------------
// API. Feature routers land phase by phase (PLAN.md §10); /api/health and
// /api/tutor/session prove the DB + auth wiring for Phase 0.
// ---------------------------------------------------------------------------
app.get('/api/health', async (_req, res) => {
  try {
    const { rows } = await pool.query('select now() as now')
    res.json({ ok: true, db: true, now: rows[0].now })
  } catch (err) {
    res.status(200).json({ ok: true, db: false, error: (err as Error).message })
  }
})

app.get('/api/tutor/session', requireTutor, (req, res) => {
  res.json({ auth: req.auth })
})

// Any unmatched /api route is a 404 (not the SPA fallback HTML).
app.use('/api', (_req, res) => res.status(404).json({ error: 'not found' }))

// Central error handler so a thrown/rejected route returns JSON, not an HTML 500.
app.use('/api', (err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[api error]', err)
  res.status(500).json({ error: (err as Error)?.message ?? 'internal error' })
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
