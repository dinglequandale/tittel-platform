// Signed-in API checks on the test stack (test/stack/stack.mjs): a real API on
// a throwaway Postgres, with tutors signed in through a mock JWKS. Nothing here
// reads apps/server/.env or reaches Supabase.
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import * as sync from 'y-protocols/sync'
import * as encoding from 'lib0/encoding'
import * as decoding from 'lib0/decoding'
import { BoardDoc } from '@tittel/board'
import { startStack } from './stack/stack.mjs'

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -> ${detail}`}`)
  if (!ok) failures++
}

const stack = await startStack({ env: { BOARD_AUTOSAVE_MS: '300' } })

/** Calls the API as tutor `slug` (or anonymously with null). */
function as(slug) {
  return async (method, path, body, headers = {}) => {
    const h = { ...headers }
    if (slug) h.authorization = `Bearer ${await stack.token(slug)}`
    let payload = body
    if (body !== undefined && !Buffer.isBuffer(body)) {
      h['content-type'] = 'application/json'
      payload = JSON.stringify(body)
    }
    const res = await fetch(stack.apiUrl + path, { method, headers: h, body: payload })
    const text = await res.text()
    let json = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = text
    }
    return { status: res.status, body: json }
  }
}

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
)
const tomorrow = () => new Date(Date.now() + 24 * 3600e3).toISOString()
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** Polls `fn` until it returns something truthy, or gives up after `ms`. */
async function until(fn, ms = 10_000) {
  const end = Date.now() + ms
  for (;;) {
    const value = await fn()
    if (value || Date.now() > end) return value
    await wait(50)
  }
}

/** A board client over the real sync socket: a BoardDoc kept in sync both ways. */
function openBoard(boardId, boardToken) {
  const doc = new BoardDoc()
  const ws = new WebSocket(`${stack.wsUrl}/connect/${boardId}?boardToken=${encodeURIComponent(boardToken)}`)
  let synced = false
  ws.on('message', (data) => {
    const decoder = decoding.createDecoder(new Uint8Array(data))
    if (decoding.readVarUint(decoder) !== 0) return
    const reply = encoding.createEncoder()
    encoding.writeVarUint(reply, 0)
    const step = sync.readSyncMessage(decoder, reply, doc.ydoc, 'server')
    if (encoding.length(reply) > 1) ws.send(encoding.toUint8Array(reply))
    if (step === sync.messageYjsSyncStep2) synced = true
  })
  ws.on('open', () => {
    const hello = encoding.createEncoder()
    encoding.writeVarUint(hello, 0)
    sync.writeSyncStep1(hello, doc.ydoc)
    ws.send(encoding.toUint8Array(hello))
  })
  doc.ydoc.on('update', (update, origin) => {
    if (origin === 'server' || ws.readyState !== WebSocket.OPEN) return
    const e = encoding.createEncoder()
    encoding.writeVarUint(e, 0)
    sync.writeUpdate(e, update)
    ws.send(encoding.toUint8Array(e))
  })
  return {
    doc,
    ready: () => until(() => synced),
    close: () => new Promise((r) => (ws.readyState === WebSocket.CLOSED ? r() : (ws.once('close', r), ws.close()))),
  }
}

/** A control-channel client that records every message it gets. */
function openControl(boardId, boardToken) {
  const ws = new WebSocket(`${stack.wsUrl}/control/${boardId}?boardToken=${encodeURIComponent(boardToken)}`)
  const got = []
  ws.on('message', (data) => got.push(JSON.parse(String(data))))
  return {
    got,
    ready: () => until(() => ws.readyState === WebSocket.OPEN),
    send: (msg) => ws.send(JSON.stringify(msg)),
    find: (pred, ms) => until(() => got.find(pred), ms),
    close: () => ws.close(),
  }
}

const shape = (id, extra) => ({ id, page: 'page-1', x: 10, y: 10, color: 'black', size: 'm', ...extra })

try {
  // ---- a new tutor, start to finish ----------------------------------------
  const ada = as('ada')
  {
    const session = await ada('GET', '/api/tutor/session')
    check('a new tutor signs in and gets a workspace', session.status === 200 && !!session.body.auth?.orgId)

    const early = await ada('PATCH', '/api/tutor/org', { onboarded: true })
    check('onboarding cannot finish before the consent step', early.status === 400)

    const setup = await ada('PATCH', '/api/tutor/org', { name: 'Ada Tutoring', displayName: 'Ada', consent: true, onboardingStep: 'ready' })
    const done = await ada('PATCH', '/api/tutor/org', { onboarded: true })
    const org = await ada('GET', '/api/tutor/org')
    check('onboarding finishes', setup.status < 300 && done.status < 300 && !!org.body.onboardedAt && org.body.name === 'Ada Tutoring', JSON.stringify(org.body))

    const demo = await ada('POST', '/api/tutor/demo')
    const org2 = await ada('GET', '/api/tutor/org')
    const sampleId = org2.body.demo?.studentId
    const students = await ada('GET', '/api/tutor/students')
    const listed = (students.body.students ?? []).find((s) => s.id === sampleId)
    check('the sample student is created', demo.status === 201 && !!listed, JSON.stringify(demo.body))

    const sets = await ada('GET', '/api/tutor/problem-sets')
    const set = (sets.body.problemSets ?? sets.body.sets ?? []).find((s) => /quadratics practice/.test(s.title))
    const hw = await ada('POST', '/api/tutor/assignments', { setId: set?.id, studentIds: [sampleId], dueAt: tomorrow() })
    const token = hw.body?.links?.[0]?.attemptToken
    check('homework is assigned to the sample student', hw.status === 201 && !!token, JSON.stringify(hw.body))

    const student = as(null)
    const attempt = await student('GET', `/api/attempt/${token}`)
    check('the student opens the homework by its link', attempt.status === 200 && attempt.body.problems?.length === 3)
    await student('POST', `/api/attempt/${token}/start`)
    const answers = { numeric: '4', mc: 'A', text: '(x+2)(x+3)' }
    let saved = 0
    for (const p of attempt.body.problems ?? []) {
      const r = await student('POST', `/api/attempt/${token}/response`, { problemId: p.id, answer: answers[p.type], timeSpentMsDelta: 1500, changed: true })
      if (r.status === 200) saved++
    }
    const submit = await student('POST', `/api/attempt/${token}/submit`)
    check('the student answers and hands it in', saved === 3 && submit.status === 200)
    const review = await student('GET', `/api/attempt/${token}/review`)
    check('the student can review it after handing in', review.status === 200)

    const analytics = await ada('GET', `/api/tutor/assignments/${hw.body.assignmentId}/analytics`)
    const row = analytics.body?.perStudent?.[0]
    check(
      'Insights shows the work, graded and timed',
      analytics.body?.submitted === 1 && row?.score === 3 && row?.total === 3 && row?.totalTimeMs === 4500,
      JSON.stringify(analytics.body?.perStudent),
    )

    const removed = await ada('DELETE', '/api/tutor/demo')
    const after = await ada('GET', '/api/tutor/students')
    const asgs = await ada('GET', '/api/tutor/assignments')
    check(
      'removing the sample takes the student and its homework',
      removed.status === 204 &&
        !(after.body.students ?? []).some((s) => s.id === sampleId) &&
        !(asgs.body.assignments ?? []).some((a) => a.id === hw.body.assignmentId),
    )
  }

  // ---- two workspaces can't see each other ---------------------------------
  {
    const bea = as('bea')
    const { body: { student: bStudent } } = await bea('POST', '/api/tutor/students', { name: 'Bea’s student' })
    const { body: { lesson: bPlan } } = await bea('POST', '/api/tutor/lessons', { title: 'Bea’s plan' })
    const bLesson = await bea('POST', '/api/tutor/sessions', { studentId: bStudent.id, scheduledAt: tomorrow(), tz: 'UTC' })
    const bLessonId = bLesson.body?.lesson?.id
    const { body: { problem: bProblem } } = await bea('POST', '/api/tutor/problems', { type: 'numeric', stemLatex: '1+1', correct: '2' })
    const { body: { problemSet: bSet } } = await bea('POST', '/api/tutor/problem-sets', { title: 'Bea’s set' })
    await bea('POST', `/api/tutor/problem-sets/${bSet.id}/problems`, { problemId: bProblem.id })
    const bAsg = await bea('POST', '/api/tutor/assignments', { setId: bSet.id, studentIds: [bStudent.id] })
    const { body: { boardId: bBoard } } = await bea('POST', `/api/tutor/students/${bStudent.id}/board`)
    const bFile = await bea('POST', '/api/tutor/files?name=sheet.png', PNG, { 'content-type': 'image/png' })
    check(
      'tutor B sets up a student, plan, lesson, homework, board and file',
      !!bStudent?.id && !!bPlan?.id && !!bLessonId && bAsg.status === 201 && !!bBoard && bFile.status === 201,
      JSON.stringify({ lesson: bLesson.body, asg: bAsg.body }),
    )

    const { body: { student: aStudent } } = await ada('POST', '/api/tutor/students', { name: 'Ada’s student' })
    const aLesson = await ada('POST', '/api/tutor/sessions', { studentId: aStudent.id, scheduledAt: tomorrow(), tz: 'UTC' })
    const aLessonId = aLesson.body?.lesson?.id

    const notFound = async (method, path, body) => (await ada(method, path, body)).status === 404
    check('A cannot open B’s student', await notFound('GET', `/api/tutor/students/${bStudent.id}`))
    check('A cannot change B’s student', await notFound('PATCH', `/api/tutor/students/${bStudent.id}`, { name: 'x' }))
    check('B’s student is not in A’s list', !(await ada('GET', '/api/tutor/students')).body.students.some((s) => s.id === bStudent.id))
    check('A cannot open B’s plan', await notFound('GET', `/api/tutor/lessons/${bPlan.id}`))
    check('A cannot open B’s lesson', await notFound('GET', `/api/tutor/sessions/${bLessonId}`))
    check('A cannot book a lesson for B’s student', await notFound('POST', '/api/tutor/sessions', { studentId: bStudent.id, scheduledAt: tomorrow(), tz: 'UTC' }))
    check('A cannot read B’s homework links', await notFound('GET', `/api/tutor/assignments/${bAsg.body.assignmentId}/links`))
    check('A cannot read B’s homework results', await notFound('GET', `/api/tutor/assignments/${bAsg.body.assignmentId}/analytics`))
    check('A cannot archive B’s homework', await notFound('DELETE', `/api/tutor/assignments/${bAsg.body.assignmentId}`))
    check('A cannot assign B’s problem set', await notFound('POST', '/api/tutor/assignments', { setId: bSet.id, studentIds: [aStudent.id] }))
    check('A cannot archive B’s board', await notFound('DELETE', `/api/tutor/boards/${bBoard}`))
    check('B’s board is not in A’s list', !(await ada('GET', '/api/tutor/boards')).body.boards.some((b) => b.id === bBoard))
    const join = await ada('POST', `/api/board/${bBoard}/token`, { name: 'Ada' })
    check('A joins B’s board only as a guest', join.status === 200 && join.body.role === 'guest')
    const paper = await ada('POST', `/api/tutor/sessions/${aLessonId}/homework`, { paper: { title: 'x' }, materials: [bFile.body.file.token] })
    check('A cannot attach B’s file to homework', !!aLessonId && paper.status === 400, JSON.stringify(paper.body))
  }

  // ---- a board survives a restart ------------------------------------------
  {
    const { body: { student } } = await ada('POST', '/api/tutor/students', { name: 'Restart student' })
    const { body: { boardId } } = await ada('POST', `/api/tutor/students/${student.id}/board`)
    const hostToken = async () => (await ada('POST', `/api/board/${boardId}/token`)).body.boardToken
    const token = await hostToken()

    const board = openBoard(boardId, token)
    await board.ready()
    const points = [0, 0, 0.5, 10, 12, 0.5, 20, 30, 0.6, 40, 35, 0.5]
    board.doc.createShape(shape('ink-1', { type: 'ink', dash: 'solid', points, sx: 1, sy: 1, pen: true, done: true }))
    const upload = await fetch(`${stack.apiUrl}/uploads/${boardId}/photo-1?boardToken=${encodeURIComponent(token)}`, {
      method: 'POST', headers: { 'content-type': 'image/png' }, body: PNG,
    })
    board.doc.createShape(shape('img-1', { type: 'image', src: `/uploads/${boardId}/photo-1`, w: 40, h: 40 }))
    check('the host draws and uploads an image', upload.status === 200)
    const saved = await until(async () => (await stack.query('select doc from boards where id = $1', [boardId])).rows[0]?.doc)
    check('the board is saved while the lesson goes on', !!saved)
    await board.close()

    await stack.restartApi()

    const again = openBoard(boardId, await hostToken())
    await again.ready()
    const ink = again.doc.getShape('ink-1')
    const img = again.doc.getShape('img-1')
    check('after a restart the ink is there', JSON.stringify(ink?.points) === JSON.stringify(points))
    check('and the image too', img?.src === `/uploads/${boardId}/photo-1`)
    const served = await fetch(`${stack.apiUrl}${img?.src}`)
    check('and its file is served', served.status === 200 && Buffer.from(await served.arrayBuffer()).equals(PNG))
    await again.close()
  }

  // ---- quiz answers are timed ------------------------------------------------
  {
    const { body: { student } } = await ada('POST', '/api/tutor/students', { name: 'Quiz student' })
    const { body: { lesson } } = await ada('POST', '/api/tutor/sessions', { studentId: student.id, scheduledAt: tomorrow(), tz: 'UTC' })
    const { body: { boardId } } = await ada('POST', `/api/tutor/sessions/${lesson.id}/start`)
    const host = openControl(boardId, (await ada('POST', `/api/board/${boardId}/token`)).body.boardToken)
    const guestJoin = (await as(null)('POST', `/api/board/${boardId}/token`, { name: 'Sam' })).body
    const guest = openControl(boardId, guestJoin.boardToken)
    await host.ready()
    await guest.ready()

    const qid = `lesson-${lesson.id}-0-2`
    host.send({ type: 'quiz-key', questions: [{ id: qid, format: 'grid', key: '3' }] })
    host.send({ type: 'quiz-open', qids: [qid] })
    await guest.find((m) => m.type === 'quiz-open' && m.qids.includes(qid))
    guest.send({ type: 'quiz-seen', userId: guestJoin.userId, qids: [qid] })
    await wait(120)
    guest.send({ type: 'quiz-answer', qid, userId: guestJoin.userId, name: 'Sam', value: '3' })

    const stats = await host.find((m) => m.type === 'quiz-stats' && m.stats.questions[0]?.students?.length)
    const sub = stats?.stats.questions[0].students[0]
    check('a board answer is graded and timed for the host', sub?.firstCorrect === true && sub.elapsedMs >= 100, JSON.stringify(sub))
    const kept = await until(async () => (await stack.query('select elapsed_ms, is_correct from quiz_events where qid = $1', [qid])).rows[0])
    check('and kept with its time after the lesson', kept?.is_correct === true && kept.elapsed_ms >= 100, JSON.stringify(kept))
    host.close()
    guest.close()
  }

  // ---- a board that is too big to save tells the host ------------------------
  {
    const sizeOf = async (fill) => {
      const { body: { student } } = await ada('POST', '/api/tutor/students', { name: `Big board ${fill}` })
      const { body: { boardId } } = await ada('POST', `/api/tutor/students/${student.id}/board`)
      const token = (await ada('POST', `/api/board/${boardId}/token`)).body.boardToken
      const host = openControl(boardId, token)
      const board = openBoard(boardId, token)
      await host.ready()
      await board.ready()
      board.doc.createShape(shape('big', { type: 'text', text: 'x'.repeat(Math.round(fill * 5 * 1024 * 1024)), fontSize: 24, w: 10, h: 10 }))
      const message = await host.find((m) => m.type === 'board-size', 15_000)
      // The host is told as the save starts; give the write (if any) time to land.
      const bytes = await until(async () => (await stack.query('select octet_length(doc) as bytes from boards where id = $1', [boardId])).rows[0]?.bytes, 2000)
      // A host who joins later hears it too.
      const late = openControl(boardId, token)
      const lateMessage = await late.find((m) => m.type === 'board-size')
      host.close()
      late.close()
      await board.close()
      return { message, saved: bytes ?? null, lateMessage }
    }
    const full = await sizeOf(1.05)
    check('a board over 5 MB tells the host it is full', full.message?.state === 'full', JSON.stringify(full.message))
    check('and is not saved', full.saved === null)
    check('a host who opens it later is told as well', full.lateMessage?.state === 'full')
    const near = await sizeOf(0.85)
    check('a board over 80% warns the host', near.message?.state === 'warn', JSON.stringify(near.message))
    check('and is still saved', near.saved > 4 * 1024 * 1024)
  }

  // ---- the board inventory reads old boards and changes nothing ---------------
  {
    const { rows: [org] } = await stack.query(`select org_id from users where supabase_uid = 'test-ada'`)
    const rec = (id, type, props, extra = {}) => ({ state: { typeName: 'shape', id: `shape:${id}`, type, parentId: 'page:p1', index: 'a1', x: 0, y: 0, rotation: 0, props, ...extra } })
    const snapshot = {
      documents: [
        { state: { typeName: 'page', id: 'page:p1', name: 'Page 1', index: 'a1' } },
        { state: { typeName: 'asset', id: 'asset:a1', type: 'image', props: { src: 'data:image/png;base64,AAAA' } } },
        rec('ink', 'draw', { segments: [{ points: [{ x: 0, y: 0 }] }] }),
        rec('star', 'geo', { geo: 'star', w: 10, h: 10 }),
        rec('box', 'geo', { geo: 'rectangle', w: 10, h: 10 }),
        rec('frame', 'frame', { w: 100, h: 100 }),
        rec('curve', 'arrow', { start: { x: 0, y: 0 }, end: { x: 1, y: 1 }, bend: 20 }),
        rec('pic', 'image', { assetId: 'asset:a1', w: 10, h: 10 }),
      ],
    }
    await stack.query(`insert into boards (id, org_id, title, snapshot) values ('old-board', $1, 'Old tldraw board', $2)`, [org.org_id, JSON.stringify(snapshot)])
    const before = (await stack.query(`select count(*)::int as n, count(doc)::int as docs from boards`)).rows[0]

    const here = path.dirname(fileURLToPath(import.meta.url))
    const script = path.resolve(here, '../scripts/board-inventory.ts')
    const out = await new Promise((resolve) => {
      // From the stack's folder and with a clean environment: never apps/server/.env.
      const child = spawn(process.execPath, ['--import', 'tsx', script], {
        cwd: path.join(here, 'stack'),
        env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT, DATABASE_URL: stack.databaseUrl },
      })
      let text = ''
      child.stdout.on('data', (d) => (text += d))
      child.stderr.on('data', (d) => (text += d))
      child.on('exit', (code) => resolve({ code, text }))
    })
    check('the board inventory runs', out.code === 0, out.text)
    check('it lists dropped shapes', /dropped on import: 1 frame/.test(out.text), out.text)
    check('and shapes drawn as rectangles', /drawn as rectangles: 1 geo:star/.test(out.text))
    check('and straightened arrows and inline images', /arrows straightened or unbound: 1/.test(out.text) && /images stored inside the save: 1/.test(out.text))
    check('and names the board to look at', /old-board "Old tldraw board"/.test(out.text))
    const after = (await stack.query(`select count(*)::int as n, count(doc)::int as docs from boards`)).rows[0]
    check('and changes nothing', after.n === before.n && after.docs === before.docs)
  }
} catch (err) {
  check('suite ran to the end', false, err.stack)
  console.log(stack.apiOutput())
} finally {
  await stack.stop()
}

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
