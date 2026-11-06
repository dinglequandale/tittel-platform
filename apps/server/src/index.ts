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
// PLAN.md §4.1's board sync (Yjs, `/connect/:boardId`) and ControlChannel
// (`/control/:boardId`) live alongside the REST API on one deployable service.
const PORT = Number(process.env.PORT) || 6060

const server = http.createServer(app)
// ws defaults to 100 MiB frames, which any anonymous guest could send. Real
// frames are far smaller: saved boards cap at 5 MB and images go over /uploads.
const wss = new WebSocketServer({ noServer: true, maxPayload: 16 * 1024 * 1024 })

async function lookupBoard(boardId: string): Promise<{ archived: boolean; mode: 'small' | 'large' } | null> {
  const { rows } = await pool.query<{ archived_at: string | null; mode: string | null }>(
    `select b.archived_at, c.mode
       from boards b
       left join classes c on c.id = b.class_id
      where b.id = $1`,
    [boardId],
  )
  if (!rows[0]) return null
  return { archived: rows[0].archived_at != null, mode: rows[0].mode === 'large' ? 'large' : 'small' }
}

type Resolved = {
  role: 'host' | 'guest'
  persistent: boolean
  /** Persistent boards only: the class mode from the DB. */
  mode?: 'small' | 'large'
  /** Persistent boards only: the server-issued id from the board token. */
  userId?: string
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
): Promise<Resolved | null> {
  const board = await lookupBoard(boardId)
  // Archiving a board promises its link stops working. Tokens live for 12h,
  // so this is checked on every connect, not only when one is minted.
  if (board?.archived) return null
  const boardToken = url.searchParams.get('boardToken')
  if (boardToken) {
    const payload = await verifyBoardToken(boardToken)
    if (!payload || payload.boardId !== boardId) return null
    return { role: payload.role, persistent: true, mode: board?.mode, userId: payload.userId }
  }
  // The `?role=host` fallback is only for the unauthenticated, non-persistent
  // /try quick-board path. A persistent board with no valid boardToken is
  // always a guest — otherwise anyone with the board id could self-grant
  // host (camera control, write-access grants, quiz answer keys/stats).
  if (board) return { role: 'guest', persistent: true, mode: board.mode }
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
    // Write access is enforced here, not just hidden in the guest's UI (HANDOFF
    // B7): on a persistent large-class board a guest's sync session is
    // read-only unless the host granted their token's userId. A grant or
    // revoke closes that guest's sessions (controlChannel 'access'), and the
    // client's automatic reconnect lands back here with the new answer. The
    // ephemeral /try board can't be enforced: its host role is self-asserted.
    resolveConnection(boardId, url)
      .then(async (resolved) => {
        if (!resolved) {
          socket.destroy()
          return
        }
        const room = await getOrCreateRoom(boardId, resolved.persistent)
        if (resolved.mode) room.mode = resolved.mode
        const isReadonly =
          resolved.persistent &&
          resolved.role === 'guest' &&
          room.mode === 'large' &&
          !(resolved.userId && room.writers.has(resolved.userId))
        wss.handleUpgrade(req, socket, head, (ws) => {
          const sessionId = url.searchParams.get('sessionId') || crypto.randomUUID()
          if (resolved.userId) room.syncUsers.set(sessionId, resolved.userId)
          room.sync.connect(ws, { sessionId, readonly: isReadonly })
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
        if (resolved.mode) room.mode = resolved.mode
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
