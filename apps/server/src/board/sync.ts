import * as Y from 'yjs'
import * as sync from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import type { WebSocket as WsSocket } from 'ws'

// The server end of y-websocket's wire protocol, over the room's existing
// sockets. Ours rather than @y/websocket-server because read-only has to be
// enforced here: a read-only session's edits are dropped, whatever its client does.
const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

interface Session {
  id: string
  socket: WsSocket
  readonly: boolean
  /** Awareness client ids this socket speaks for, cleared when it leaves. */
  clients: Set<number>
}

export class SyncRoom {
  readonly doc: Y.Doc
  private awareness: awarenessProtocol.Awareness
  private sessions = new Set<Session>()

  constructor(
    doc: Y.Doc,
    private hooks: { onChange(): void; onSessionRemoved(sessionId: string, remaining: number): void },
  ) {
    this.doc = doc
    this.awareness = new awarenessProtocol.Awareness(doc)
    this.awareness.setLocalState(null)

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

  connect(socket: WsSocket, { sessionId, readonly }: { sessionId: string; readonly: boolean }) {
    const session: Session = { id: sessionId, socket, readonly, clients: new Set() }
    this.sessions.add(session)

    socket.on('message', (data: Buffer) => {
      try {
        this.handleMessage(session, new Uint8Array(data))
      } catch (err) {
        console.warn('[board] bad sync message', err)
        socket.close()
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

  private handleMessage(session: Session, message: Uint8Array) {
    const decoder = decoding.createDecoder(message)
    const kind = decoding.readVarUint(decoder)
    if (kind === MESSAGE_AWARENESS) {
      awarenessProtocol.applyAwarenessUpdate(this.awareness, decoding.readVarUint8Array(decoder), session.socket)
      return
    }
    if (kind !== MESSAGE_SYNC) return

    const step = decoding.readVarUint(decoder)
    if (step === sync.messageYjsSyncStep1) {
      const reply = encoding.createEncoder()
      encoding.writeVarUint(reply, MESSAGE_SYNC)
      sync.readSyncStep1(decoder, reply, this.doc)
      this.send(session.socket, encoding.toUint8Array(reply))
    } else if (!session.readonly) {
      // Step 2 and live updates carry the same payload: edits to apply.
      sync.readSyncStep2(decoder, this.doc, session.socket)
    }
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
