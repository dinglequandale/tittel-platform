// Signed-in API checks on the test stack (test/stack/stack.mjs): a real API on
// a throwaway Postgres, with tutors signed in through a mock JWKS. Nothing here
// reads apps/server/.env or reaches Supabase.
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
} catch (err) {
  check('suite ran to the end', false, err.stack)
  console.log(stack.apiOutput())
} finally {
  await stack.stop()
}

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
