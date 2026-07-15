import { WebSocket } from 'ws'
import { gradeResponse, type QuestionKey, type QuizStats, type Submission } from '@tittel/shared'
import {
  GAME_RULES,
  GAME_MSG_RATE,
  MAX_DRAG_PAYLOAD,
  PLAYER_COUNT,
  MAX_ANSWER_LEN,
  GUEST_MSG_RATE,
  MAX_SEEN_BATCH,
  MAX_OPEN_QIDS,
  type Player,
} from '@tittel/shared'
import type { ControlClient, Room } from './rooms.ts'

// Ported near-verbatim from the legacy whiteboard's server/index.ts
// (handleControl + its helpers) — PLAN.md §2.1 calls this "solid,
// battle-tested; port as-is; add auth handshake". The auth handshake is the
// one real change: `role`/`userId`/`name` now come from a verified board
// token (see boardToken.ts) instead of a bare `?role=` query param.
function gradeAnswer(value: string, key: QuestionKey): boolean {
  return !!gradeResponse(
    { type: key.format === 'choice' ? 'mc' : 'numeric', correct: key.key, accept: key.accept ?? null },
    value,
  )
}

function quizStats(room: Room): QuizStats {
  const questions = Array.from(room.quizKey.keys()).map((qid) => {
    const subsByUser = room.quizSubs.get(qid)
    const students: Submission[] = subsByUser ? Array.from(subsByUser.values()) : []
    const answered = students.length
    const firstCorrect = students.filter((s) => s.firstCorrect).length
    const latestCorrect = students.filter((s) => s.latestCorrect).length
    let medianMs: number | null = null
    if (students.length > 0) {
      const sorted = students.map((s) => s.elapsedMs).sort((a, b) => a - b)
      const mid = Math.floor(sorted.length / 2)
      medianMs = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
    }
    return { qid, answered, firstCorrect, latestCorrect, medianMs, students }
  })
  return { questions, revealed: room.quizRevealed }
}

function validQuizId(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0 && s.length <= 64
}
function clampQuizName(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) return 'Student'
  return raw.slice(0, 64)
}
function allowQuizMessage(client: ControlClient): boolean {
  const now = Date.now()
  const rate = client.quizRate
  if (now - rate.windowStart >= 1000) {
    rate.windowStart = now
    rate.count = 0
  }
  rate.count++
  return rate.count <= GUEST_MSG_RATE
}
function allowGameMessage(client: ControlClient): boolean {
  const now = Date.now()
  const rate = client.gameRate
  if (now - rate.windowStart >= 1000) {
    rate.windowStart = now
    rate.count = 0
  }
  rate.count++
  return rate.count <= GAME_MSG_RATE
}
function validUserId(s: unknown): s is string {
  return typeof s === 'string' && s.length > 0 && s.length <= 64
}
function clampPlayerName(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length === 0) return 'Player'
  return raw.slice(0, 64)
}
function validPlayers(raw: unknown): Player[] | null {
  if (!Array.isArray(raw) || raw.length !== PLAYER_COUNT) return null
  const players: Player[] = []
  const seen = new Set<string>()
  for (const p of raw) {
    const userId = p && typeof p === 'object' ? (p as { userId?: unknown }).userId : undefined
    if (!validUserId(userId)) return null
    if (seen.has(userId)) return null
    seen.add(userId)
    players.push({ userId, name: clampPlayerName((p as { name?: unknown }).name) })
  }
  return players
}
function gameStateMsg(room: Room) {
  return {
    type: 'game-state',
    game: room.game ? { gameId: room.game.gameId, state: room.game.state, players: room.game.players } : null,
  }
}
function currentPlayerUserId(room: Room): string | null {
  const gm = room.game
  if (!gm) return null
  const turn = (gm.state as { turn?: unknown })?.turn
  if (turn !== 0 && turn !== 1) return null
  return gm.players[turn]?.userId ?? null
}

function safeSend(ws: WebSocket, payload: unknown) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload))
}

export function handleControl(ws: WebSocket, room: Room, role: 'host' | 'guest') {
  const client: ControlClient = {
    socket: ws,
    role,
    quizRate: { windowStart: Date.now(), count: 0 },
    gameRate: { windowStart: Date.now(), count: 0 },
  }
  room.controls.add(client)

  const broadcastToGuests = (payload: unknown) => {
    for (const c of room.controls) if (c.role === 'guest') safeSend(c.socket, payload)
  }
  const broadcastToOthers = (payload: unknown) => {
    for (const c of room.controls) if (c.socket !== ws) safeSend(c.socket, payload)
  }
  const sendToHosts = (payload: unknown) => {
    for (const c of room.controls) if (c.role === 'host') safeSend(c.socket, payload)
  }
  const pushQuizStats = () => sendToHosts({ type: 'quiz-stats', stats: quizStats(room) })
  const broadcastToEveryone = (payload: unknown) => {
    for (const c of room.controls) safeSend(c.socket, payload)
  }

  if (role === 'guest') {
    safeSend(ws, { type: 'mode', mode: room.mode })
    for (const userId of room.writers) safeSend(ws, { type: 'access', userId, allow: true })
    if (room.lastCamera) safeSend(ws, { type: 'camera', camera: room.lastCamera })
    if (room.lastPage) safeSend(ws, { type: 'page', pageId: room.lastPage })
    safeSend(ws, { type: 'calc-access', allow: room.studentsCanEdit })
    safeSend(ws, { type: 'free-reign', on: room.freeReign })
    if (room.calcOpen) {
      safeSend(ws, { type: 'calc', action: 'open' })
      if (room.lastCalcState) safeSend(ws, { type: 'calc', action: 'state', state: room.lastCalcState })
      if (room.lastCalcGeom) safeSend(ws, { type: 'calc', action: 'geom', geom: room.lastCalcGeom })
    }
    if (room.timerVisible) {
      safeSend(ws, { type: 'timer', action: 'show' })
      if (room.lastTimerState) safeSend(ws, { type: 'timer', action: 'state', ...room.lastTimerState })
      if (room.lastTimerPos) safeSend(ws, { type: 'timer', action: 'geom', geom: room.lastTimerPos })
    }
    if (room.quizRevealed) {
      const keys: Record<string, string> = {}
      for (const [qid, key] of room.quizKey) keys[qid] = key.key
      safeSend(ws, { type: 'quiz-revealed', keys })
    }
    safeSend(ws, { type: 'quiz-open', qids: [...room.quizOpen] })
  } else {
    safeSend(ws, { type: 'quiz-stats', stats: quizStats(room) })
    safeSend(ws, { type: 'quiz-open', qids: [...room.quizOpen] })
  }
  if (room.game) {
    safeSend(ws, gameStateMsg(room))
    if (room.game.view !== undefined) safeSend(ws, { type: 'game-view', view: room.game.view })
  }

  ws.on('message', (data) => {
    let msg: {
      type?: string
      action?: string
      camera?: unknown
      state?: unknown
      geom?: unknown
      allow?: boolean
      on?: boolean
      pageId?: string
      mode?: string
      userId?: string
      remainingMs?: number
      sentAt?: number
      running?: boolean
      questions?: unknown
      qid?: string
      qids?: unknown
      value?: string
      name?: string
      gameId?: string
      players?: unknown
      options?: unknown
      move?: unknown
      payload?: unknown
      view?: unknown
    }
    try {
      msg = JSON.parse(data.toString())
    } catch {
      return
    }

    if (msg?.type === 'game-move') {
      if (role === 'guest' && !allowGameMessage(client)) return
      const gm = room.game
      if (!gm) return
      if (!validUserId(msg.userId)) return
      if (msg.userId !== currentPlayerUserId(room)) return
      const rules = GAME_RULES[gm.gameId]
      if (!rules) return
      const playerIdx = gm.players.findIndex((p) => p.userId === msg.userId) as 0 | 1
      const result = rules.applyMove(gm.state, playerIdx, msg.move)
      if (!result.ok) return
      gm.state = result.state
      broadcastToEveryone(gameStateMsg(room))
      return
    }
    if (msg?.type === 'game-drag') {
      if (role === 'guest' && !allowGameMessage(client)) return
      const gm = room.game
      if (!gm) return
      if (!validUserId(msg.userId)) return
      if (msg.userId !== currentPlayerUserId(room)) return
      if (typeof msg.payload !== 'object' || msg.payload === null) return
      if (JSON.stringify(msg.payload).length > MAX_DRAG_PAYLOAD) return
      broadcastToOthers({ type: 'game-drag', payload: msg.payload })
      return
    }

    if (role === 'host') {
      if (msg?.type === 'camera' && msg.camera) {
        room.lastCamera = msg.camera
        broadcastToGuests({ type: 'camera', camera: msg.camera })
      } else if (msg?.type === 'page' && typeof msg.pageId === 'string') {
        room.lastPage = msg.pageId
        broadcastToGuests({ type: 'page', pageId: msg.pageId })
      } else if (msg?.type === 'mode' && (msg.mode === 'small' || msg.mode === 'large')) {
        room.mode = msg.mode
        if (msg.mode === 'small') room.writers.clear()
        broadcastToGuests({ type: 'mode', mode: room.mode })
      } else if (msg?.type === 'access' && typeof msg.userId === 'string') {
        if (msg.allow) room.writers.add(msg.userId)
        else room.writers.delete(msg.userId)
        broadcastToGuests({ type: 'access', userId: msg.userId, allow: !!msg.allow })
      } else if (msg?.type === 'free-reign') {
        room.freeReign = !!msg.on
        broadcastToGuests({ type: 'free-reign', on: room.freeReign })
      } else if (msg?.type === 'calc') {
        if (msg.action === 'open') {
          room.calcOpen = true
          broadcastToGuests(msg)
        } else if (msg.action === 'close') {
          room.calcOpen = false
          broadcastToGuests(msg)
        } else if (msg.action === 'state') {
          room.lastCalcState = msg.state
          broadcastToOthers(msg)
        } else if (msg.action === 'geom' && msg.geom) {
          room.lastCalcGeom = msg.geom
          broadcastToGuests({ type: 'calc', action: 'geom', geom: msg.geom })
        }
      } else if (msg?.type === 'calc-access') {
        room.studentsCanEdit = !!msg.allow
        broadcastToGuests({ type: 'calc-access', allow: room.studentsCanEdit })
      } else if (msg?.type === 'timer') {
        if (msg.action === 'show') {
          room.timerVisible = true
          broadcastToGuests({ type: 'timer', action: 'show' })
        } else if (msg.action === 'hide') {
          room.timerVisible = false
          broadcastToGuests({ type: 'timer', action: 'hide' })
        } else if (msg.action === 'state' && typeof msg.remainingMs === 'number') {
          room.lastTimerState = { remainingMs: msg.remainingMs, sentAt: msg.sentAt as number, running: !!msg.running }
          broadcastToGuests({ type: 'timer', action: 'state', ...room.lastTimerState })
        } else if (msg.action === 'geom' && msg.geom) {
          room.lastTimerPos = msg.geom as { x: number; y: number }
          broadcastToGuests({ type: 'timer', action: 'geom', geom: room.lastTimerPos })
        }
      } else if (msg?.type === 'quiz-key' && Array.isArray(msg.questions)) {
        const nextKey = new Map<string, QuestionKey>()
        for (const q of msg.questions as QuestionKey[]) {
          if (q && typeof q.id === 'string') nextKey.set(q.id, q)
        }
        room.quizKey = nextKey
        for (const qid of Array.from(room.quizSeen.keys())) if (!nextKey.has(qid)) room.quizSeen.delete(qid)
        for (const qid of Array.from(room.quizSubs.keys())) if (!nextKey.has(qid)) room.quizSubs.delete(qid)
        for (const qid of Array.from(room.quizOpen)) if (!nextKey.has(qid)) room.quizOpen.delete(qid)
        for (const qid of Array.from(room.quizOpenedAt.keys())) if (!nextKey.has(qid)) room.quizOpenedAt.delete(qid)
        pushQuizStats()
      } else if (msg?.type === 'quiz-reveal') {
        room.quizRevealed = true
        const keys: Record<string, string> = {}
        for (const [qid, key] of room.quizKey) keys[qid] = key.key
        broadcastToGuests({ type: 'quiz-revealed', keys })
        pushQuizStats()
      } else if (msg?.type === 'quiz-reset') {
        room.quizSeen.clear()
        room.quizSubs.clear()
        room.quizRevealed = false
        const now = Date.now()
        for (const qid of room.quizOpen) room.quizOpenedAt.set(qid, now)
        pushQuizStats()
        broadcastToGuests({ type: 'quiz-reset' })
      } else if (msg?.type === 'quiz-open' && Array.isArray(msg.qids)) {
        const nextOpen = new Set<string>()
        for (const qid of (msg.qids as unknown[]).slice(0, MAX_OPEN_QIDS)) {
          if (typeof qid === 'string' && room.quizKey.has(qid)) nextOpen.add(qid)
        }
        const now = Date.now()
        for (const qid of nextOpen) {
          if (!room.quizOpen.has(qid)) {
            room.quizOpenedAt.set(qid, now)
            room.quizSeen.delete(qid)
          }
        }
        for (const qid of room.quizOpen) if (!nextOpen.has(qid)) room.quizOpenedAt.delete(qid)
        room.quizOpen = nextOpen
        const openMsg = { type: 'quiz-open', qids: [...room.quizOpen] }
        broadcastToGuests(openMsg)
        sendToHosts(openMsg)
      } else if (msg?.type === 'game-start') {
        const rules = typeof msg.gameId === 'string' ? GAME_RULES[msg.gameId] : undefined
        const players = validPlayers(msg.players)
        if (!rules || !players || typeof msg.gameId !== 'string') return
        room.game = { gameId: msg.gameId, state: rules.create(msg.options), options: msg.options, players }
        broadcastToEveryone(gameStateMsg(room))
      } else if (msg?.type === 'game-reset') {
        const gm = room.game
        if (!gm) return
        const rules = GAME_RULES[gm.gameId]
        if (!rules) return
        room.game = { ...gm, state: rules.create(gm.options) }
        broadcastToEveryone(gameStateMsg(room))
      } else if (msg?.type === 'game-end') {
        room.game = null
        broadcastToEveryone(gameStateMsg(room))
      } else if (msg?.type === 'game-view') {
        const gm = room.game
        if (!gm) return
        if (typeof msg.view !== 'object' || msg.view === null) return
        if (JSON.stringify(msg.view).length > MAX_DRAG_PAYLOAD) return
        gm.view = msg.view
        broadcastToGuests({ type: 'game-view', view: gm.view })
      }
    } else if (msg?.type === 'calc' && msg.action === 'state' && room.studentsCanEdit) {
      room.lastCalcState = msg.state
      broadcastToOthers(msg)
    } else if (msg?.type === 'quiz-seen') {
      if (!allowQuizMessage(client)) return
      const { userId, qids } = msg
      if (!validQuizId(userId) || !Array.isArray(qids)) return
      const now = Date.now()
      for (const qid of qids.slice(0, MAX_SEEN_BATCH)) {
        if (!validQuizId(qid) || !room.quizKey.has(qid) || !room.quizOpen.has(qid)) continue
        let seenMap = room.quizSeen.get(qid)
        if (!seenMap) {
          seenMap = new Map()
          room.quizSeen.set(qid, seenMap)
        }
        if (!seenMap.has(userId)) seenMap.set(userId, now)
      }
    } else if (msg?.type === 'quiz-answer') {
      if (!allowQuizMessage(client)) return
      const { qid, userId } = msg
      if (!validQuizId(qid) || !validQuizId(userId)) return
      const key = room.quizKey.get(qid)
      if (!key) return
      if (!room.quizOpen.has(qid)) return
      if (typeof msg.value !== 'string' || msg.value.length > MAX_ANSWER_LEN) return
      const name = clampQuizName(msg.name)
      const correct = gradeAnswer(msg.value, key)
      const seenAt = room.quizSeen.get(qid)?.get(userId) ?? room.quizOpenedAt.get(qid) ?? Date.now()

      let subsMap = room.quizSubs.get(qid)
      if (!subsMap) {
        subsMap = new Map()
        room.quizSubs.set(qid, subsMap)
      }
      const existing = subsMap.get(userId)
      if (!existing) {
        subsMap.set(userId, {
          userId,
          name,
          first: msg.value,
          firstCorrect: correct,
          latest: msg.value,
          latestCorrect: correct,
          elapsedMs: Math.max(0, Date.now() - seenAt),
        })
      } else {
        existing.name = name
        existing.latest = msg.value
        existing.latestCorrect = correct
      }

      const ack: { type: 'quiz-ack'; qid: string; correct?: boolean } = { type: 'quiz-ack', qid }
      if (key.reveal === 'immediate' || room.quizRevealed) ack.correct = correct
      safeSend(ws, ack)
      pushQuizStats()
    }
  })

  ws.on('close', () => {
    room.controls.delete(client)
  })
  ws.on('error', () => {
    try {
      ws.close()
    } catch {
      /* ignore */
    }
  })
}
