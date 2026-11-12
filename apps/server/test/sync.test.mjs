// The board's sync room, driven with real y-protocols messages over a fake
// socket. What matters most here: a read-only session's edits never land.
import { EventEmitter } from 'node:events'
import * as Y from 'yjs'
import * as sync from 'y-protocols/sync'
import * as awarenessProtocol from 'y-protocols/awareness'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { BoardDoc } from '@tittel/board'
import { SyncRoom, MAX_GUEST_MESSAGE_BYTES } from '../src/board/sync.ts'

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

// ---- lesson content is the tutor's ---------------------------------------
{
  // A board with a plan on it: a lesson page, a locked block, an answerable
  // question (unlocked, as an imported one may be) and some work of the student's own.
  const { doc, room } = makeRoom()
  doc.createPage({ id: 'lp', name: 'Lesson', meta: { lesson: { kind: 'session', id: 's1', version: 1 } } })
  const rect = { page: 'lp', type: 'rect', x: 10, y: 20, w: 100, h: 50, color: 'black', size: 'm', dash: 'solid', fill: false }
  doc.createShape({ ...rect, id: 'block', locked: true, meta: { lesson: 'lesson-s1' } })
  doc.createShape({ ...rect, id: 'question', meta: { q: { id: 'lesson-s1-0-1', format: 'grid' } } })
  doc.createShape({ ...rect, id: 'mine', page: 'page-1' })
  const original = { block: doc.getShape('block'), question: doc.getShape('question'), page: doc.getPage('lp') }
  const roomClientId = doc.ydoc.clientID

  const host = new FakeSocket()
  const guest = new FakeSocket()
  room.connect(host, { sessionId: 'h', readonly: false })
  room.connect(guest, { sessionId: 'g', readonly: false, guest: true })

  // What the host and the guest have on screen: the board as they joined it,
  // plus every update the room sent them afterwards.
  const mirrorOf = (socket) => {
    const mirror = new BoardDoc()
    Y.applyUpdate(mirror.ydoc, room.snapshot())
    return { mirror, from: socket.sent.length, socket }
  }
  const catchUp = (view) => {
    for (const m of view.socket.sent.slice(view.from)) {
      const d = decoding.createDecoder(m)
      if (decoding.readVarUint(d) === MESSAGE_SYNC) sync.readSyncMessage(d, encoding.createEncoder(), view.mirror.ydoc, 'room')
    }
    view.from = view.socket.sent.length
    return view.mirror
  }
  const hostView = mirrorOf(host)
  const guestView = mirrorOf(guest)

  /** The guest edits their copy of the board; returns the bytes their client sends. */
  const guestEdit = (fn) => {
    const ydoc = guestView.mirror.ydoc
    const updates = []
    const grab = (u, origin) => origin !== 'room' && updates.push(u)
    ydoc.on('update', grab)
    fn(guestView.mirror)
    ydoc.off('update', grab)
    return updateMessage(Y.mergeUpdates(updates))
  }
  const sorted = (o) => o && JSON.stringify(Object.fromEntries(Object.entries(o).sort(([x], [y]) => (x < y ? -1 : 1))))
  const same = (a, b) => !!a && sorted(a) === sorted(b)

  guest.deliver(guestEdit((v) => v.deleteShapes(['block'])))
  catchUp(guestView)
  check('a guest writer cannot delete a locked block', same(doc.getShape('block'), original.block))
  check('and the deletion never reaches the host', same(catchUp(hostView).getShape('block'), original.block))
  check('the guest’s own screen gets the block back', same(guestView.mirror.getShape('block'), original.block))

  guest.deliver(guestEdit((v) => v.updateShape('block', { x: 999, locked: false })))
  catchUp(guestView)
  check(
    'a guest writer cannot move or unlock a locked block',
    same(doc.getShape('block'), original.block) && same(catchUp(hostView).getShape('block'), original.block),
  )

  guest.deliver(guestEdit((v) => v.updateShape('question', { meta: { q: { id: 'lesson-s1-0-1', format: 'choice' } } })))
  catchUp(guestView)
  check(
    'a guest writer cannot change a question record',
    same(doc.getShape('question'), original.question) && same(catchUp(hostView).getShape('question'), original.question),
  )

  guest.deliver(guestEdit((v) => v.deletePage('lp')))
  catchUp(guestView)
  const hostAfterPage = catchUp(hostView)
  check(
    'a guest writer cannot delete a lesson page or what is on it',
    same(doc.getPage('lp'), original.page) && !!doc.getShape('block') && !!doc.getShape('question') &&
      !!hostAfterPage.getPage('lp') && !!hostAfterPage.getShape('block'),
  )

  guest.deliver(guestEdit((v) => v.createShape({ ...rect, id: 'fake-q', page: 'page-1', meta: { q: { id: 'lesson-s1-0-9', format: 'grid' } } })))
  catchUp(guestView)
  check('a guest writer cannot add a question record', !doc.getShape('fake-q') && !catchUp(hostView).getShape('fake-q'))

  guest.deliver(guestEdit((v) => {
    v.updateShape('mine', { x: 77 })
    v.createShape({ ...rect, id: 'new-work', page: 'page-1' })
  }))
  catchUp(guestView)
  check(
    'a guest writer still edits their own work',
    doc.getShape('mine')?.x === 77 && !!doc.getShape('new-work') && catchUp(hostView).getShape('mine')?.x === 77,
  )
  check('and stays connected', guest.readyState === 1)
  check('the room keeps its own client id through the repairs', doc.ydoc.clientID === roomClientId)

  // The host loads and clears lesson content, so nothing stops them.
  const hostDoc = new BoardDoc()
  Y.applyUpdate(hostDoc.ydoc, room.snapshot())
  let hostUpdate = null
  hostDoc.ydoc.on('update', (u) => (hostUpdate = u))
  hostDoc.deleteShapes(['block'])
  host.deliver(updateMessage(hostUpdate))
  check('the host can still remove a locked block', !doc.getShape('block'))
}

// ---- oversized and malformed messages ------------------------------------
{
  const { doc, room } = makeRoom()
  const big = (id) => {
    const client = new BoardDoc()
    let update = null
    client.ydoc.on('update', (u) => (update = u))
    client.createShape({ id, page: 'page-1', type: 'text', text: 'x'.repeat(MAX_GUEST_MESSAGE_BYTES + 10), color: 'black', size: 'm', fontSize: 24, x: 0, y: 0, w: 10, h: 10 })
    return updateMessage(update)
  }

  const guest = new FakeSocket()
  room.connect(guest, { sessionId: 'g', readonly: false, guest: true })
  guest.deliver(big('huge'))
  check('an oversized guest update is refused', !doc.getShape('huge'))
  check('and closes that guest’s socket', guest.readyState === 3)

  const host = new FakeSocket()
  room.connect(host, { sessionId: 'h', readonly: false })
  host.deliver(big('host-big'))
  check('the host is not held to the guest cap', !!doc.getShape('host-big') && host.readyState === 1)

  const encoded = (step, bytes) => {
    const e = encoding.createEncoder()
    encoding.writeVarUint(e, MESSAGE_SYNC)
    encoding.writeVarUint(e, step)
    encoding.writeVarUint8Array(e, bytes)
    return encoding.toUint8Array(e)
  }
  const cases = {
    'a truncated message': new Uint8Array([0]),
    'an unknown sync step': encoded(7, new Uint8Array([0])),
    'a corrupt update': encoded(sync.messageYjsUpdate, new Uint8Array([5, 200, 1, 2, 3, 4])),
    'a corrupt state vector': encoded(sync.messageYjsSyncStep1, new Uint8Array([9, 200])),
    'corrupt presence': new Uint8Array([MESSAGE_AWARENESS, 3, 1, 1, 255]),
  }
  const warned = []
  const warn = console.warn
  console.warn = (...args) => warned.push(args)
  const before = Y.encodeStateVector(doc.ydoc).join()
  try {
    for (const [name, bytes] of Object.entries(cases)) {
      const s = new FakeSocket()
      room.connect(s, { sessionId: name, readonly: false, guest: true })
      s.deliver(bytes)
      check(`${name} is refused and closes the socket`, s.readyState === 3)
    }
  } finally {
    console.warn = warn
  }
  check('none of them changed the board', Y.encodeStateVector(doc.ydoc).join() === before)
  check(
    'each refusal is a one-line warning, not a stack trace',
    warned.length === Object.keys(cases).length && warned.every((a) => a.length === 1 && typeof a[0] === 'string'),
    JSON.stringify(warned),
  )
  check('the room still serves others', host.readyState === 1)
}

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
