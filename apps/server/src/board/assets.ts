import express from 'express'
import { getRoom } from './rooms.ts'
import type { Room } from './rooms.ts'
import { verifyBoardToken } from './boardToken.ts'
import { boardQuery, orgQuery } from '../db.ts'
import { storeFile } from '../routes/files.ts'

// Board images: anything pasted or dropped, and the lesson pages a plan renders.
// A persistent board keeps them in the database (`board_assets` -> `files`), so
// they outlive the room, a restart and a deploy. An ephemeral /try board keeps
// them in the room's memory, gone with the room, as the legacy whiteboard did.
export const boardAssetsRouter = express.Router()

// The memory route is unauthenticated, so bound both the size of a single
// upload and the total an attacker can pile into one room's memory.
const MAX_ROOM_ASSET_BYTES = 100 * 1024 * 1024
// A persistent board collects a lesson's worth of pages every week for as long
// as the student stays, so its bound is a year or two of lessons, not a session.
const MAX_BOARD_ASSET_BYTES = 250 * 1024 * 1024
const SAFE_ASSET_TYPE = /^(image|video)\/[\w.+-]+$/i

function roomAssetBytes(room: Room): number {
  let total = 0
  for (const blob of room.assets.values()) total += blob.data.byteLength
  return total
}

// Asset ids come from the uploader, and `board_assets.id` is unique across boards.
const assetKey = (boardId: string, id: string) => `${boardId}/${id}`

/** The org to file a persistent board's upload under, if this token may write to it (the same rule as the sync socket). */
async function uploaderOrg(room: Room, token: unknown): Promise<string | null> {
  const payload = typeof token === 'string' ? await verifyBoardToken(token) : null
  if (!payload || payload.boardId !== room.id) return null
  const canWrite = payload.role === 'host' || room.mode !== 'large' || room.writers.has(payload.userId)
  return canWrite ? payload.orgId : null
}

boardAssetsRouter.post('/uploads/:boardId/:id', express.raw({ type: '*/*', limit: '20mb' }), async (req, res) => {
  // A real client always has the board's WS open before pasting an image —
  // never create a room just to receive an upload (that's how an upload to
  // a bogus board id used to leak a permanently un-garbage-collected Room).
  const room = getRoom(req.params.boardId)
  if (!room) return res.status(404).json({ error: 'board is not live' })

  // The upload is served back from the app's own origin, so an uploader-chosen
  // type like text/html would be stored XSS against every signed-in tutor.
  // The board only ever uploads images, and videos on older boards.
  const contentType = req.header('content-type') ?? ''
  if (!SAFE_ASSET_TYPE.test(contentType)) {
    return res.status(415).json({ error: 'only image and video uploads are supported' })
  }

  const body = req.body as Buffer
  if (room.persistent) {
    const orgId = await uploaderOrg(room, req.query.boardToken)
    if (!orgId) return res.status(403).json({ error: 'you can’t add to this board' })
    const [used] = await boardQuery<{ bytes: string }>(
      room.id,
      `select coalesce(sum(f.size), 0)::bigint as bytes
         from board_assets a join files f on f.file_token = a.storage_key and f.org_id = a.org_id
        where a.board_id = $1`,
    )
    if (Number(used.bytes) + body.byteLength > MAX_BOARD_ASSET_BYTES) {
      return res.status(413).json({ error: 'board has reached its asset storage limit' })
    }
    const file = await storeFile(orgId, req.params.id, contentType, body)
    await orgQuery(
      orgId,
      `insert into board_assets (id, board_id, org_id, storage_key, mime) values ($2, $3, $1, $4, $5)
       on conflict (id) do nothing`,
      [assetKey(room.id, req.params.id), room.id, file.token, contentType.toLowerCase()],
    )
    return res.json({ ok: true })
  }

  if (roomAssetBytes(room) + body.byteLength > MAX_ROOM_ASSET_BYTES) {
    return res.status(413).json({ error: 'board has reached its asset storage limit' })
  }

  room.assets.set(req.params.id, { data: body, contentType })
  res.json({ ok: true })
})

boardAssetsRouter.get('/uploads/:boardId/:id', async (req, res) => {
  const { boardId, id } = req.params
  let blob = getRoom(boardId)?.assets.get(id)
  if (!blob) {
    const [stored] = await boardQuery<{ mime: string; bytes: Buffer }>(
      boardId,
      `select a.mime, f.bytes
         from board_assets a join files f on f.file_token = a.storage_key and f.org_id = a.org_id
        where a.board_id = $1 and a.id = $2`,
      [assetKey(boardId, id)],
    )
    if (stored) blob = { data: stored.bytes, contentType: stored.mime }
  }
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
