import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { parseLessonDoc, type QuestionKey } from '@tittel/shared'
import { apiFetch } from '../../lib/api.ts'
import type { ControlChannel } from '../controlChannel.ts'
import type { BoardEditor } from '../engine/editor.ts'
import { loadPlanOntoBoard, lessonPrefix, lessonRefOf, type LessonRef } from './load.ts'
import { questionKeysFromDoc } from './keys.ts'

// Host-side lesson plumbing for a signed-in tutor's board:
//  - `?lesson=<sessionId>` (FLOW-SPEC "Start") loads that lesson's plan, then
//    strips the param so a refresh doesn't re-trigger it.
//  - `loadLibraryLesson` puts a plan from the library on the board.
//  - Answer keys are host-only and never in the synced store, so they're held
//    here per plan and the full set is re-sent (the server replaces its keys
//    wholesale) whenever the control channel (re)opens. After a host reload
//    they're rebuilt by re-fetching each plan the board's pages came from.

interface FetchedPlan {
  ref: LessonRef
  title: string
  doc: unknown
  date?: Date
}

async function fetchSessionPlan(sessionId: string): Promise<FetchedPlan> {
  const res = await apiFetch(`/api/tutor/sessions/${encodeURIComponent(sessionId)}/plan`)
  return {
    ref: { kind: 'session', id: sessionId, version: res.version },
    title: res.title,
    doc: res.doc,
    date: res.scheduledAt ? new Date(res.scheduledAt) : undefined,
  }
}

async function fetchLibraryPlan(lessonId: string): Promise<FetchedPlan> {
  const { lesson } = await apiFetch(`/api/tutor/lessons/${encodeURIComponent(lessonId)}`)
  return { ref: { kind: 'plan', id: lesson.id, version: lesson.version }, title: lesson.title, doc: lesson.doc }
}

function fetchPlan(ref: LessonRef): Promise<FetchedPlan> {
  return ref.kind === 'session' ? fetchSessionPlan(ref.id) : fetchLibraryPlan(ref.id)
}

export function useLessons({
  editor,
  channel,
  boardId,
  authParams,
  enabled,
}: {
  editor: BoardEditor | null
  channel: ControlChannel
  boardId: string
  authParams: string
  /** A signed-in host on a persistent board (the /try board has no plans). */
  enabled: boolean
}) {
  const [status, setStatus] = useState<string | null>(null)
  // qid -> answer, for the tutor's own on-canvas annotation. Host only.
  const [answerKeys, setAnswerKeys] = useState<Record<string, string>>({})
  const keysByPrefix = useRef(new Map<string, QuestionKey[]>())
  const hydrated = useRef(false)
  const [searchParams, setSearchParams] = useSearchParams()
  const sessionParam = searchParams.get('lesson')
  // The lesson this board is being taught for: from Start's `?lesson=` (read
  // before it's stripped), else the newest lesson whose plan is on the board.
  const [sessionId, setSessionId] = useState<string | null>(sessionParam)

  const flash = useCallback((msg: string, ms = 3000) => {
    setStatus(msg)
    setTimeout(() => setStatus((s) => (s === msg ? null : s)), ms)
  }, [])

  const sendKeys = useCallback(() => {
    if (!hydrated.current) return
    const questions = [...keysByPrefix.current.values()].flat()
    channel.send({ type: 'quiz-key', questions })
    // Keep the identity on a mere reconnect: the overlay is rebuilt when it changes.
    const next = Object.fromEntries(questions.map((q) => [q.id, q.key]))
    setAnswerKeys((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next))
  }, [channel])

  useEffect(() => (enabled ? channel.on('open', sendKeys) : undefined), [channel, enabled, sendKeys])

  const load = useCallback(
    async (plan: FetchedPlan) => {
      if (!editor) return
      setStatus('Loading lesson…')
      const result = await loadPlanOntoBoard(editor, plan.doc, {
        boardId,
        authParams,
        ref: plan.ref,
        title: plan.title,
        date: plan.date,
        onProgress: (done, total) => setStatus(`Rendering ${done}/${total}…`),
      })
      if (!result.stale) keysByPrefix.current.set(lessonPrefix(plan.ref), result.keys)
      sendKeys()
      if (result.stale) flash('This plan changed after it went on the board. Answers are off for it.', 6000)
      else flash(result.added ? `Loaded ${result.pages} page${result.pages === 1 ? '' : 's'}` : 'Opened lesson')
    },
    [editor, boardId, authParams, sendKeys, flash],
  )

  const fail = useCallback(
    (err: unknown) => {
      const notFound = (err as { status?: number }).status === 404
      flash(notFound ? 'This lesson has no plan yet' : err instanceof Error ? err.message : String(err), 5000)
    },
    [flash],
  )

  // Rebuild keys for every plan already on the board, then handle `?lesson=`.
  useEffect(() => {
    if (!editor || !enabled) return
    let cancelled = false
    ;(async () => {
      const refs = new Map<string, LessonRef>()
      let lastSession: string | null = null
      for (const page of editor.getPages()) {
        const ref = lessonRefOf(page.meta)
        if (ref) refs.set(lessonPrefix(ref), ref)
        if (ref?.kind === 'session') lastSession = ref.id
      }
      setSessionId((id) => id ?? lastSession)
      let stale = 0
      await Promise.all(
        [...refs].map(async ([prefix, ref]) => {
          try {
            const plan = await fetchPlan(ref)
            if (plan.ref.version !== ref.version) stale++
            else keysByPrefix.current.set(prefix, questionKeysFromDoc(parseLessonDoc(plan.doc), prefix))
          } catch {
            stale++
          }
        }),
      )
      if (cancelled) return
      hydrated.current = true
      sendKeys()
      if (stale > 0) flash(`Answers are off for ${stale} earlier lesson${stale === 1 ? '' : 's'} on this board`, 6000)

      if (sessionParam) {
        setSearchParams(
          (p) => {
            p.delete('lesson')
            return p
          },
          { replace: true },
        )
        await fetchSessionPlan(sessionParam).then(load).catch(fail)
      }
    })()
    return () => {
      cancelled = true
    }
    // Runs once per editor: `sessionParam` is read on mount and then stripped.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, enabled])

  const loadLibraryLesson = useCallback(
    (lessonId: string) => fetchLibraryPlan(lessonId).then(load).catch(fail),
    [load, fail],
  )

  return { status, answerKeys, sessionId, loadLibraryLesson }
}
