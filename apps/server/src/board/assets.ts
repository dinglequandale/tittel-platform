import express from 'express'
import { pool } from '../db.ts'
import { getOrCreateRoom, getRoom } from './rooms.ts'

// Pasted/dropped board images (e.g. a problem screenshot). Ported from the
// legacy whiteboard's in-memory-per-room asset store, kept as-is for both
// ephemeral AND persistent boards for now: Supabase Storage-backed assets for
// persistent boards (so images survive a restart, not just the tldraw
// document) is a follow-up — tracked, not silently dropped.
export const boardAssetsRouter = express.Router()

async function isPersistentBoard(id: string): Promise<boolean> {
  const { rows } = await pool.query('select 1 from boards where id = $1', [id])
  return rows.length > 0
}

boardAssetsRouter.post('/uploads/:boardId/:id', express.raw({ type: '*/*', limit: '50mb' }), async (req, res) => {
  const room = await getOrCreateRoom(req.params.boardId, await isPersistentBoard(req.params.boardId))
  room.assets.set(req.params.id, {
    data: req.body as Buffer,
    contentType: req.header('content-type') || 'application/octet-stream',
  })
  res.json({ ok: true })
})

boardAssetsRouter.get('/uploads/:boardId/:id', (req, res) => {
  const blob = getRoom(req.params.boardId)?.assets.get(req.params.id)
  if (!blob) {
    res.status(404).end()
    return
  }
  res.setHeader('content-type', blob.contentType)
  res.setHeader('cache-control', 'public, max-age=31536000, immutable')
  res.end(blob.data)
})
