import express from 'express'
import { getRoom } from './rooms.ts'
import type { Room } from './rooms.ts'

// Pasted/dropped board images (e.g. a problem screenshot). Ported from the
// legacy whiteboard's in-memory-per-room asset store, kept as-is for both
// ephemeral AND persistent boards for now: Supabase Storage-backed assets for
// persistent boards (so images survive a restart, not just the tldraw
// document) is a follow-up — tracked, not silently dropped.
export const boardAssetsRouter = express.Router()

// Unauthenticated endpoint, so bound both the size of a single upload and
// the total an attacker can pile into one room's memory.
const MAX_ROOM_ASSET_BYTES = 100 * 1024 * 1024

function roomAssetBytes(room: Room): number {
  let total = 0
  for (const blob of room.assets.values()) total += blob.data.byteLength
  return total
}

boardAssetsRouter.post('/uploads/:boardId/:id', express.raw({ type: '*/*', limit: '20mb' }), async (req, res) => {
  // A real client always has the board's WS open before pasting an image —
  // never create a room just to receive an upload (that's how an upload to
  // a bogus board id used to leak a permanently un-garbage-collected Room).
  const room = getRoom(req.params.boardId)
  if (!room) return res.status(404).json({ error: 'board is not live' })

  const body = req.body as Buffer
  if (roomAssetBytes(room) + body.byteLength > MAX_ROOM_ASSET_BYTES) {
    return res.status(413).json({ error: 'board has reached its asset storage limit' })
  }

  room.assets.set(req.params.id, {
    data: body,
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
