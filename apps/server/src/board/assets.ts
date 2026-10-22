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
const SAFE_ASSET_TYPE = /^(image|video)\/[\w.+-]+$/i

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

  // The upload is served back from the app's own origin, so an uploader-chosen
  // type like text/html would be stored XSS against every signed-in tutor.
  // tldraw only ever uploads images and videos.
  const contentType = req.header('content-type') ?? ''
  if (!SAFE_ASSET_TYPE.test(contentType)) {
    return res.status(415).json({ error: 'only image and video uploads are supported' })
  }

  const body = req.body as Buffer
  if (roomAssetBytes(room) + body.byteLength > MAX_ROOM_ASSET_BYTES) {
    return res.status(413).json({ error: 'board has reached its asset storage limit' })
  }

  room.assets.set(req.params.id, { data: body, contentType })
  res.json({ ok: true })
})

boardAssetsRouter.get('/uploads/:boardId/:id', (req, res) => {
  const blob = getRoom(req.params.boardId)?.assets.get(req.params.id)
  if (!blob) {
    res.status(404).end()
    return
  }
  res.setHeader('content-type', blob.contentType)
  // An SVG is an image that can carry script: opened directly (not via
  // <img>), it would run on our origin. sandbox + nosniff keep it inert.
  res.setHeader('x-content-type-options', 'nosniff')
  res.setHeader('content-security-policy', "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox")
  res.setHeader('cache-control', 'public, max-age=31536000, immutable')
  res.end(blob.data)
})
