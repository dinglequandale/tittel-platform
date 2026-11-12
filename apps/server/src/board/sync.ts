import * as Y from 'yjs'
import * as sync from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import type { WebSocket as WsSocket } from 'ws'
import { LessonLock } from './lessonLock.ts'

// The server end of y-websocket's wire protocol, over the room's existing
// sockets. Ours rather than @y/websocket-server because read-only has to be
// enforced here: a read-only session's edits are dropped, whatever its client does,
// and a guest's edits to lesson content are undone before anyone sees them.
const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

/**
 * The largest message a guest may send. A real edit is a few KB (a long stroke
 * tens of KB); images go over /uploads, not the document. A bigger one closes
 * the socket rather than reaching every client.
 */
export const MAX_GUEST_MESSAGE_BYTES = 1024 * 1024

interface Session {
  id: string
  socket: WsSocket
  readonly: boolean
  /** A student or guest rather than the board's host: may not touch lesson content. */
  guest: boolean
  /** Awareness client ids this socket speaks for, cleared when it leaves. */
  clients: Set<number>
}

export class SyncRoom {
  readonly doc: Y.Doc
  private awareness: awarenessProtocol.Awareness
  private sessions = new Set<Session>()
  private lock: LessonLock

  constructor(
    doc: Y.Doc,
    private hooks: { onChange(): void; onSessionRemoved(sessionId: string, remaining: number): void },
  ) {
    this.doc = doc
    this.awareness = new awarenessProtocol.Awareness(doc)
    this.awareness.setLocalState(null)
    this.lock = new LessonLock(doc)

    doc.on('update', (update: Uint8Array) => {
      this.hooks.onChange()
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_SYNC)
      sync.writeUpdate(encoder, update)
      this.broadcast(encoding.toUint8Array(encoder))
    })

    this.awareness.on('update', ({ added, updated, removed }: AwarenessChange, origin: unknown) => {
      const session = [...this.sessions].find((s) => s.socket === origin)
      if (session) {
        for (const id of added) session.clients.add(id)
        for (const id of removed) session.clients.delete(id)
      }
      const changed = [...added, ...updated, ...removed]
      const encoder = encoding.createEncoder()
      encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(this.awareness, changed))
      this.broadcast(encoding.toUint8Array(encoder))
    })
  }

  private broadcast(message: Uint8Array) {
    for (const session of this.sessions) this.send(session.socket, message)
  }

  private send(socket: WsSocket, message: Uint8Array) {
    if (socket.readyState === socket.OPEN) socket.send(message, { binary: true })
  }

  connect(socket: WsSocket, { sessionId, readonly, guest = false }: { sessionId: string; readonly: boolean; guest?: boolean }) {
    const session: Session = { id: sessionId, socket, readonly, guest, clients: new Set() }
    this.sessions.add(session)

    socket.on('message', (data: Buffer) => {
      if (guest && data.byteLength > MAX_GUEST_MESSAGE_BYTES) {
        console.warn(`[board] refused a ${data.byteLength}-byte sync message from a guest`)
        socket.close(1009, 'message too big')
        return
      }
      const problem = this.handleMessage(session, new Uint8Array(data))
      if (problem) {
        console.warn(`[board] refused a sync message: ${problem}`)
        socket.close(1007, problem)
      }
    })
    socket.on('close', () => this.remove(session))
    socket.on('error', () => socket.close())

    // Opens the sync handshake, then tells the newcomer who's here.
    const encoder = encoding.createEncoder()
    encoding.writeVarUint(encoder, MESSAGE_SYNC)
    sync.writeSyncStep1(encoder, this.doc)
    this.send(socket, encoding.toUint8Array(encoder))

    const present = [...this.awareness.getStates().keys()]
    if (present.length > 0) {
      const states = encoding.createEncoder()
      encoding.writeVarUint(states, MESSAGE_AWARENESS)
      encoding.writeVarUint8Array(states, awarenessProtocol.encodeAwarenessUpdate(this.awareness, present))
      this.send(socket, encoding.toUint8Array(states))
    }
  }

  /** Handles one message. Returns why it was refused, or null. Never throws. */
  private handleMessage(session: Session, message: Uint8Array): string | null {
    let kind: number
    let step = -1
    let payload: Uint8Array
    try {
      const decoder = decoding.createDecoder(message)
      kind = decoding.readVarUint(decoder)
      if (kind !== MESSAGE_SYNC && kind !== MESSAGE_AWARENESS) return null
      if (kind === MESSAGE_SYNC) step = decoding.readVarUint(decoder)
      payload = decoding.readVarUint8Array(decoder)
    } catch {
      return 'malformed message'
    }

    if (kind === MESSAGE_AWARENESS) {
      try {
        awarenessProtocol.applyAwarenessUpdate(this.awareness, payload, session.socket)
      } catch {
        return 'malformed presence'
      }
      return null
    }

    if (step === sync.messageYjsSyncStep1) {
      let missing: Uint8Array
      try {
        missing = Y.encodeStateAsUpdate(this.doc, payload)
      } catch {
        return 'malformed state vector'
      }
      const reply = encoding.createEncoder()
      encoding.writeVarUint(reply, MESSAGE_SYNC)
      encoding.writeVarUint(reply, sync.messageYjsSyncStep2)
      encoding.writeVarUint8Array(reply, missing)
      this.send(session.socket, encoding.toUint8Array(reply))
      return null
    }
    if (step !== sync.messageYjsSyncStep2 && step !== sync.messageYjsUpdate) return 'unknown sync step'
    if (session.readonly) return null

    // Step 2 and live updates carry the same payload: edits to apply. Decoding
    // first catches a corrupt update before any of it reaches the document.
    try {
      Y.decodeUpdate(payload)
    } catch {
      return 'malformed update'
    }
    try {
      if (session.guest) {
        // One transaction, so the update and its repair go out as one message.
        this.doc.transact((tr) => {
          Y.applyUpdate(this.doc, payload, session.socket)
          // applyUpdate marks the transaction remote; the repair is the server's
          // own edit, and Yjs would otherwise take it for a client-id clash.
          tr.local = true
          this.lock.restore(tr)
        }, session.socket)
      } else {
        Y.applyUpdate(this.doc, payload, session.socket)
      }
    } catch {
      return 'update could not be applied'
    }
    return null
  }

  private remove(session: Session) {
    if (!this.sessions.delete(session)) return
    awarenessProtocol.removeAwarenessStates(this.awareness, [...session.clients], null)
    this.hooks.onSessionRemoved(session.id, this.sessions.size)
  }

  /** Disconnects a session; its client reconnects and is assessed afresh. */
  closeSession(sessionId: string) {
    for (const session of this.sessions) {
      if (session.id === sessionId) session.socket.close()
    }
  }

  snapshot(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc)
  }

  close() {
    for (const session of this.sessions) session.socket.close()
    this.sessions.clear()
    this.awareness.destroy()
    this.doc.destroy()
  }
}

interface AwarenessChange {
  added: number[]
  updated: number[]
  removed: number[]
}
