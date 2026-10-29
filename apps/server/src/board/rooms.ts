import { TLSocketRoom } from '@tldraw/sync-core'
import type { WebSocket as WsSocket } from 'ws'
import type { QuestionKey, Submission, Player } from '@tittel/shared'
import { pool } from '../db.ts'

// Rooms are in-memory while live; a `persistent` room additionally snapshots to
// Postgres (boards.snapshot) so it survives idle-teardown and server restarts.
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
  socketRoom: TLSocketRoom<any, void>
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

async function loadSnapshot(id: string): Promise<unknown | null> {
  const { rows } = await pool.query<{ snapshot: unknown }>(
    'select snapshot from boards where id = $1',
    [id],
  )
  return rows[0]?.snapshot ?? null
}

async function saveSnapshot(room: Room): Promise<void> {
  if (!room.persistent) return
  const snapshot = room.socketRoom.getCurrentSnapshot()
  const json = JSON.stringify(snapshot)
  if (Buffer.byteLength(json) > MAX_SNAPSHOT_BYTES) {
    console.warn(`[board] ${room.id} snapshot exceeds ${MAX_SNAPSHOT_BYTES} bytes — skipping save`)
    return
  }
  await pool.query(
    'update boards set snapshot = $2, snapshot_updated_at = now() where id = $1',
    [room.id, json],
  )
  room.dirty = false
}

// A client opens its sync and control sockets at the same moment, so two
// upgrades routinely race here. Without sharing the in-flight creation, each
// would await loadSnapshot and build its own Room: the sockets split across
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
  const initialSnapshot = persistent ? await loadSnapshot(id) : null

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
    dirty: false,
    socketRoom: undefined as unknown as TLSocketRoom<any, void>,
  }

  room.socketRoom = new TLSocketRoom<any, void>({
    initialSnapshot: (initialSnapshot as never) ?? undefined,
    onSessionRemoved(_room, args) {
      room.syncUsers.delete(args.sessionId)
      if (args.numSessionsRemaining === 0) scheduleClose(room)
    },
    onDataChange() {
      room.dirty = true
    },
  })

  if (persistent) {
    room.autosaveTimer = setInterval(() => {
      if (room.dirty) void saveSnapshot(room).catch((err) => console.error('[board] autosave failed', err))
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
      await saveSnapshot(room)
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
  try {
    room.socketRoom.close()
  } catch {
    /* already closed */
  }
}
