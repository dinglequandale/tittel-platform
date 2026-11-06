import * as Y from 'yjs'
import type { WebSocket as WsSocket } from 'ws'
import { BoardDoc, importTldrawSnapshot } from '@tittel/board'
import type { QuestionKey, Submission, Player } from '@tittel/shared'
import { pool } from '../db.ts'
import { SyncRoom } from './sync.ts'

// Rooms are in-memory while live; a `persistent` room additionally saves to
// Postgres (boards.doc) so it survives idle-teardown and server restarts.
// An ephemeral room (the free /try quick-board, or any board with no matching
// `boards` row) behaves exactly like the legacy whiteboard: 100% volatile,
// dropped for good ~30s after the last socket leaves.
const GRACE_MS = 30_000
const AUTOSAVE_MS = 60_000
// PLAN.md §6.3: boards heavier than this refuse to persist — "board too heavy,
// export + start a page" is a friendlier failure than silently truncating data.
const MAX_SNAPSHOT_BYTES = 5 * 1024 * 1024

type AssetBlob = { data: Buffer; contentType: string }

export type ControlClient = {
  socket: WsSocket
  role: 'host' | 'guest'
  quizRate: { windowStart: number; count: number }
  gameRate: { windowStart: number; count: number }
}

export interface Room {
  id: string
  persistent: boolean
  sync: SyncRoom
  assets: Map<string, AssetBlob>
  controls: Set<ControlClient>
  lastCamera: unknown | null
  lastPage: string | null
  calcOpen: boolean
  lastCalcState: unknown | null
  lastCalcGeom: unknown | null
  studentsCanEdit: boolean
  mode: 'small' | 'large'
  writers: Set<string>
  /** Sync sessionId -> the board-token userId that opened it (persistent boards). */
  syncUsers: Map<string, string>
  freeReign: boolean
  timerVisible: boolean
  lastTimerState: { remainingMs: number; sentAt: number; running: boolean } | null
  lastTimerPos: { x: number; y: number } | null
  quizKey: Map<string, QuestionKey>
  quizSeen: Map<string, Map<string, number>>
  quizSubs: Map<string, Map<string, Submission>>
  quizRevealed: boolean
  quizOpen: Set<string>
  quizOpenedAt: Map<string, number>
  game: {
    gameId: string
    state: unknown
    options: unknown
    players: Player[]
    view?: unknown
  } | null
  closeTimer: ReturnType<typeof setTimeout> | null
  autosaveTimer: ReturnType<typeof setInterval> | null
  dirty: boolean
}

const rooms = new Map<string, Room>()

/**
 * The saved board as a live doc. `boards.snapshot` holds what the tldraw engine
 * saved: a board with no `doc` yet is imported from it. The snapshot is left in
 * place, so a board can always be recovered from the original.
 */
async function loadDoc(id: string): Promise<{ doc: BoardDoc; imported: boolean }> {
  const doc = new BoardDoc()
  const { rows } = await pool.query<{ doc: Buffer | null; snapshot: unknown }>(
    'select doc, snapshot from boards where id = $1',
    [id],
  )
  const saved = rows[0]
  let imported = false
  if (saved?.doc) {
    Y.applyUpdate(doc.ydoc, new Uint8Array(saved.doc))
  } else if (saved?.snapshot) {
    const { shapes, skipped } = importTldrawSnapshot(doc, saved.snapshot)
    console.log(`[board] ${id} imported from tldraw: ${shapes} shapes, ${skipped} skipped`)
    imported = true
  }
  return { doc, imported }
}

async function saveDoc(room: Room): Promise<void> {
  if (!room.persistent) return
  const saved = Buffer.from(room.sync.snapshot())
  if (saved.byteLength > MAX_SNAPSHOT_BYTES) {
    console.warn(`[board] ${room.id} doc exceeds ${MAX_SNAPSHOT_BYTES} bytes — skipping save`)
    return
  }
  await pool.query(
    'update boards set doc = $2, snapshot_updated_at = now() where id = $1',
    [room.id, saved],
  )
  room.dirty = false
}

// A client opens its sync and control sockets at the same moment, so two
// upgrades routinely race here. Without sharing the in-flight creation, each
// would await loadDoc and build its own Room: the sockets split across
// two documents and the orphan's autosave overwrites the real snapshot.
const pendingRooms = new Map<string, Promise<Room>>()
// A room torn down moments ago may still be writing its final snapshot.
// A new room must wait for that write, or it loads stale state.
const closingRooms = new Map<string, Promise<void>>()

/** Looked up once per getOrCreateRoom — callers pass whether `id` has a `boards` row. */
export function getOrCreateRoom(id: string, persistent: boolean): Promise<Room> {
  const existing = rooms.get(id)
  if (existing) {
    if (existing.closeTimer) {
      clearTimeout(existing.closeTimer)
      existing.closeTimer = null
    }
    return Promise.resolve(existing)
  }
  let pending = pendingRooms.get(id)
  if (!pending) {
    pending = createRoom(id, persistent).finally(() => pendingRooms.delete(id))
    pendingRooms.set(id, pending)
  }
  return pending
}

async function createRoom(id: string, persistent: boolean): Promise<Room> {
  await closingRooms.get(id)
  const { doc, imported } = persistent ? await loadDoc(id) : { doc: new BoardDoc(), imported: false }
  doc.seedFirstPage()

  const room: Room = {
    id,
    persistent,
    assets: new Map(),
    controls: new Set(),
    lastCamera: null,
    lastPage: null,
    calcOpen: false,
    lastCalcState: null,
    lastCalcGeom: null,
    studentsCanEdit: false,
    mode: 'small',
    writers: new Set(),
    syncUsers: new Map(),
    freeReign: false,
    timerVisible: false,
    lastTimerState: null,
    lastTimerPos: null,
    quizKey: new Map(),
    quizSeen: new Map(),
    quizSubs: new Map(),
    quizRevealed: false,
    quizOpen: new Set(),
    quizOpenedAt: new Map(),
    game: null,
    closeTimer: null,
    autosaveTimer: null,
    dirty: imported,
    sync: undefined as unknown as SyncRoom,
  }

  room.sync = new SyncRoom(doc.ydoc, {
    onChange() {
      room.dirty = true
    },
    onSessionRemoved(sessionId, remaining) {
      room.syncUsers.delete(sessionId)
      if (remaining === 0) scheduleClose(room)
    },
  })

  if (persistent) {
    room.autosaveTimer = setInterval(() => {
      if (room.dirty) void saveDoc(room).catch((err) => console.error('[board] autosave failed', err))
    }, AUTOSAVE_MS)
  }

  rooms.set(id, room)
  return room
}

export function getRoom(id: string): Room | undefined {
  return rooms.get(id)
}

function scheduleClose(room: Room) {
  if (room.closeTimer) return
  room.closeTimer = setTimeout(() => {
    const done: Promise<void> = closeRoom(room).finally(() => {
      if (closingRooms.get(room.id) === done) closingRooms.delete(room.id)
    })
    closingRooms.set(room.id, done)
  }, GRACE_MS)
}

async function closeRoom(room: Room) {
  rooms.delete(room.id)
  if (room.autosaveTimer) clearInterval(room.autosaveTimer)
  if (room.persistent) {
    try {
      await saveDoc(room)
    } catch (err) {
      console.error('[board] final save failed', err)
    }
  }
  room.assets.clear()
  for (const client of room.controls) {
    try {
      client.socket.close()
    } catch {
      /* already gone */
    }
  }
  room.controls.clear()
  room.sync.close()
}
