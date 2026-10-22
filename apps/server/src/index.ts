import './env.ts'
import http from 'node:http'
import crypto from 'node:crypto'
import { WebSocketServer } from 'ws'
import { app } from './app.ts'
import { pool } from './db.ts'
import { getOrCreateRoom } from './board/rooms.ts'
import { handleControl } from './board/controlChannel.ts'
import { verifyBoardToken } from './board/boardToken.ts'

// Long-running server bootstrap (Render). The app itself lives in app.ts so
// tests can import it without this listen() call. A raw http.Server (rather
// than app.listen) is required so we can route WebSocket upgrades ourselves —
// PLAN.md §4.1's board sync (tldraw `/connect/:boardId`) and ControlChannel
// (`/control/:boardId`) live alongside the REST API on one deployable service.
const PORT = Number(process.env.PORT) || 6060

const server = http.createServer(app)
// ws defaults to 100 MiB frames, which any anonymous guest could send. Real
// frames are far smaller: snapshots cap at 5 MB and images go over /uploads.
const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 })

async function lookupBoard(boardId: string): Promise<{ archived: boolean } | null> {
  const { rows } = await pool.query<{ archived_at: string | null }>(
    'select archived_at from boards where id = $1',
    [boardId],
  )
  return rows[0] ? { archived: rows[0].archived_at != null } : null
}

/**
 * Resolves who's connecting and whether the room is DB-backed. A `boardToken`
 * query param (minted by POST /api/board/:id/token) means a real, persistent
 * board; its absence means the legacy ephemeral /try path — the free
 * quick-board stays exactly as it was, driven by a `role` query param and a
 * `#host` URL fragment on the client, no auth, no persistence (PLAN.md §6.3).
 */
async function resolveConnection(
  boardId: string,
  url: URL,
): Promise<{ role: 'host' | 'guest'; persistent: boolean } | null> {
  const board = await lookupBoard(boardId)
  // Archiving a board promises its link stops working. Tokens live for 12h,
  // so this is checked on every connect, not only when one is minted.
  if (board?.archived) return null
  const boardToken = url.searchParams.get('boardToken')
  if (boardToken) {
    const payload = await verifyBoardToken(boardToken)
    if (!payload || payload.boardId !== boardId) return null
    return { role: payload.role, persistent: true }
  }
  // The `?role=host` fallback is only for the unauthenticated, non-persistent
  // /try quick-board path. A persistent board with no valid boardToken is
  // always a guest — otherwise anyone with the board id could self-grant
  // host (camera control, write-access grants, quiz answer keys/stats).
  if (board) return { role: 'guest', persistent: true }
  const role = url.searchParams.get('role') === 'host' ? 'host' : 'guest'
  return { role, persistent: false }
}

server.on('upgrade', (req, socket, head) => {
  // A client that aborts mid-handshake (e.g. we reject its token and destroy
  // the socket, or it just vanishes) raises 'error' on this raw net.Socket.
  // Node treats an unhandled 'error' event as fatal — crashes the whole
  // process — so every upgrade socket needs a listener, even a no-op one.
  socket.on('error', () => {})

  const url = new URL(req.url || '', 'http://localhost')
  const parts = url.pathname.split('/').filter(Boolean)

  if (parts[0] === 'connect' && parts[1]) {
    const boardId = decodeURIComponent(parts[1])
    // TODO(security): the tldraw sync socket accepts writes from any guest
    // regardless of role — access control here is client-side-only (the
    // guest UI just doesn't show editing tools). Fixing properly means
    // passing `isReadonly` per-session and rewiring write-access grants
    // through the sync layer itself; out of scope for this pass (HANDOFF.md
    // B7). `resolved.role` is available here if that work happens later.
    resolveConnection(boardId, url)
      .then(async (resolved) => {
        if (!resolved) {
          socket.destroy()
          return
        }
        const room = await getOrCreateRoom(boardId, resolved.persistent)
        wss.handleUpgrade(req, socket, head, (ws) => {
          const sessionId = url.searchParams.get('sessionId') || crypto.randomUUID()
          room.socketRoom.handleSocketConnect({ sessionId, socket: ws as never })
        })
      })
      .catch((err) => {
        console.error('[board] connect upgrade failed', err)
        socket.destroy()
      })
  } else if (parts[0] === 'control' && parts[1]) {
    const boardId = decodeURIComponent(parts[1])
    resolveConnection(boardId, url)
      .then(async (resolved) => {
        if (!resolved) {
          socket.destroy()
          return
        }
        const room = await getOrCreateRoom(boardId, resolved.persistent)
        wss.handleUpgrade(req, socket, head, (ws) => handleControl(ws, room, resolved.role))
      })
      .catch((err) => {
        console.error('[board] control upgrade failed', err)
        socket.destroy()
      })
  } else {
    socket.destroy()
  }
})

server.listen(PORT, () => {
  console.log(`Slate server listening on http://localhost:${PORT}`)
})
