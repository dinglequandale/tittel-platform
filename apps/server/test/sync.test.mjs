// The board's sync room, driven with real y-protocols messages over a fake
// socket. What matters most here: a read-only session's edits never land.
import { EventEmitter } from 'node:events'
import * as Y from 'yjs'
import * as sync from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { BoardDoc } from '@tittel/board'
import { SyncRoom } from '../src/board/sync.ts'

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -> ${detail}`}`)
  if (!ok) failures++
}

const MESSAGE_SYNC = 0
const MESSAGE_AWARENESS = 1

class FakeSocket extends EventEmitter {
  OPEN = 1
  readyState = 1
  sent = []
  send(message) {
    this.sent.push(message)
  }
  close() {
    if (this.readyState !== 1) return
    this.readyState = 3
    this.emit('close')
  }
  deliver(message) {
    this.emit('message', Buffer.from(message))
  }
}

function updateMessage(update) {
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_SYNC)
  sync.writeUpdate(encoder, update)
  return encoding.toUint8Array(encoder)
}

/** An edit made on a separate client, as the bytes it would send. */
function clientEdit(id) {
  const client = new BoardDoc()
  let update = null
  client.ydoc.on('update', (u) => (update = u))
  client.createShape({ id, page: 'page-1', type: 'rect', x: 0, y: 0, w: 10, h: 10, color: 'black', size: 'm', dash: 'solid', fill: false })
  return update
}

function makeRoom() {
  const doc = new BoardDoc()
  doc.seedFirstPage()
  const removed = []
  let changes = 0
  const room = new SyncRoom(doc.ydoc, {
    onChange: () => changes++,
    onSessionRemoved: (id, remaining) => removed.push([id, remaining]),
  })
  return { doc, room, removed, changes: () => changes }
}

const kinds = (socket) => socket.sent.map((m) => decoding.readVarUint(decoding.createDecoder(m)))

// ---- writing and read-only ----------------------------------------------
{
  const { doc, room, changes } = makeRoom()
  const writer = new FakeSocket()
  const reader = new FakeSocket()
  room.connect(writer, { sessionId: 'w', readonly: false })
  room.connect(reader, { sessionId: 'r', readonly: true })

  check('a newcomer gets the sync handshake', kinds(writer).includes(MESSAGE_SYNC))

  writer.deliver(updateMessage(clientEdit('from-writer')))
  check('a writer\'s edit lands', !!doc.getShape('from-writer'))
  check('the change is flagged for saving', changes() === 1)
  check('and reaches the read-only session', reader.sent.length >= 2)

  const before = changes()
  reader.deliver(updateMessage(clientEdit('from-reader')))
  check('a read-only update is dropped', !doc.getShape('from-reader'))
  check('nothing is marked for saving', changes() === before)

  // The same edit dressed as a handshake reply must fare no better.
  const step2 = encoding.createEncoder()
  encoding.writeVarUint(step2, MESSAGE_SYNC)
  sync.writeSyncStep2(step2, (() => {
    const other = new BoardDoc()
    other.createShape({ id: 'sneaky', page: 'page-1', type: 'rect', x: 0, y: 0, w: 1, h: 1, color: 'black', size: 'm', dash: 'solid', fill: false })
    return other.ydoc
  })())
  reader.deliver(encoding.toUint8Array(step2))
  check('a read-only sync step 2 is dropped', !doc.getShape('sneaky'))

  // A read-only client must still be able to read.
  const ask = encoding.createEncoder()
  encoding.writeVarUint(ask, MESSAGE_SYNC)
  sync.writeSyncStep1(ask, new Y.Doc())
  const sentBefore = reader.sent.length
  reader.deliver(encoding.toUint8Array(ask))
  check('a read-only session can still fetch the board', reader.sent.length === sentBefore + 1)
  check('and stays connected', reader.readyState === 1)
}

// ---- presence -----------------------------------------------------------
{
  const { room } = makeRoom()
  const a = new FakeSocket()
  const b = new FakeSocket()
  room.connect(a, { sessionId: 'a', readonly: true })

  const peer = new awarenessProtocol.Awareness(new Y.Doc())
  peer.setLocalStateField('user', { userId: 'u1', userName: 'Ada', color: '#000' })
  const encoder = encoding.createEncoder()
  encoding.writeVarUint(encoder, MESSAGE_AWARENESS)
  encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(peer, [peer.clientID]))
  a.deliver(encoding.toUint8Array(encoder))

  room.connect(b, { sessionId: 'b', readonly: false })
  check('a late joiner is told who is here', kinds(b).includes(MESSAGE_AWARENESS))

  const heard = b.sent.length
  a.close()
  check('when someone leaves, the others hear', b.sent.length === heard + 1 && kinds(b).at(-1) === MESSAGE_AWARENESS)
  peer.destroy()
}

// ---- sessions -----------------------------------------------------------
{
  const { room, removed } = makeRoom()
  const a = new FakeSocket()
  const b = new FakeSocket()
  room.connect(a, { sessionId: 'a', readonly: true })
  room.connect(b, { sessionId: 'b', readonly: false })

  room.closeSession('a')
  check('closeSession closes that socket', a.readyState === 3 && b.readyState === 1)
  check('the room counts who remains', removed.at(-1)?.join() === 'a,1')
  b.close()
  check('the last one out reports zero', removed.at(-1)?.join() === 'b,0')

  const c = new FakeSocket()
  room.connect(c, { sessionId: 'c', readonly: false })
  c.deliver(new Uint8Array([0, 200]))
  check('garbage closes the socket instead of crashing', c.readyState === 3)
}

// ---- saving -------------------------------------------------------------
{
  const { doc, room } = makeRoom()
  doc.createShape({ id: 'kept', page: 'page-1', type: 'rect', x: 1, y: 2, w: 3, h: 4, color: 'red', size: 's', dash: 'dotted', fill: false })
  const saved = room.snapshot()
  const restored = new Y.Doc()
  Y.applyUpdate(restored, saved)
  check('a saved board comes back whole', new BoardDoc(restored).getShape('kept')?.dash === 'dotted')
}

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
