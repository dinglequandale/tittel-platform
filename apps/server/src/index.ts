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
const wss = new WebSocketServer({ noServer: true })

async function isPersistentBoard(boardId: string): Promise<boolean> {
  const { rows } = await pool.query('select 1 from boards where id = $1', [boardId])
  return rows.length > 0
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
  const boardToken = url.searchParams.get('boardToken')
  if (boardToken) {
    const payload = await verifyBoardToken(boardToken)
    if (!payload || payload.boardId !== boardId) return null
    return { role: payload.role, persistent: true }
  }
  const role = url.searchParams.get('role') === 'host' ? 'host' : 'guest'
  return { role, persistent: await isPersistentBoard(boardId) }
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
