import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ConfirmDialog } from '@tittel/ui'
import {
  Lock,
  Unlock,
  Timer as TimerIcon,
  Calculator as CalculatorIcon,
  FileDown,
  Link as LinkIcon,
  Play,
  Square,
  ListChecks,
  Check,
  ArrowUpRight,
  LogOut,
} from 'lucide-react'
import type { QuestionMeta, QuizStats } from '@tittel/shared'
import { Canvas } from './engine/Canvas.tsx'
import { useBoardConnection, useBoardValue } from './engine/react.ts'
import { uploadBoardImage } from './assetStore.ts'
import { setupCameraSync, type FollowController } from './cameraSync.ts'
import { setupPageSync } from './pageSync.ts'
import { setupRightClickPan } from './rightClickPan.ts'
import type { ControlChannel } from './controlChannel.ts'
import { BoardToolbar } from './BoardToolbar.tsx'
import { PageMenu } from './PageMenu.tsx'
import { PeopleMenu } from './PeopleMenu.tsx'
import { Calculator } from './Calculator.tsx'
import { Timer, type TimerWireState } from './Timer.tsx'
import { exportBoardToPdf, lessonNotesPdf } from './exportPdf.tsx'
import { apiFetch } from '../lib/api.ts'
import { uploadFile, isPdf } from '../lib/files.ts'
import { useLessons } from './lesson/useLessons.ts'
import { LessonPicker } from './lesson/LessonPicker.tsx'
import { planFromFiles } from './lesson/fromFiles.ts'
import { makeAnswerOverlay } from './quiz/AnswerOverlay.tsx'
import { StatsPanel } from './quiz/StatsPanel.tsx'
import './board.css'

type ClassMode = 'small' | 'large'

// Ported from the legacy whiteboard's Board.tsx (its `BoardCanvas`) — PLAN.md
// §6.3: "port unchanged, restyled." Lesson loading lives in ./lesson/, the
// answer overlay + stats panel in ./quiz/. Still to come (OVERHAUL O2): games,
// which slot into the same chrome/dock spots.
export function BoardCanvas({
  boardId,
  isHost,
  mode,
  channel,
  displayName,
  userId,
  authParams,
}: {
  boardId: string
  isHost: boolean
  mode: ClassMode
  channel: ControlChannel
  displayName: string
  userId: string
  authParams: string
}) {
  const connection = useBoardConnection(boardId, authParams, {
    userId,
    userName: displayName,
    color: isHost ? '#2563eb' : '#16a34a',
  })
  const { editor } = connection
  const editorRef = useRef(editor)
  editorRef.current = editor
  const [calcOpen, setCalcOpen] = useState(false)
  const [studentsCanEdit, setStudentsCanEdit] = useState(false)
  const lastCalcState = useRef<unknown>(null)
  const lastCalcGeom = useRef<unknown>(null)
  const [pdfStatus, setPdfStatus] = useState<string | null>(null)
  const [granted, setGranted] = useState(() => new Set<string>())
  const [freeReign, setFreeReign] = useState(false)
  const freeReignRef = useRef(freeReign)
  freeReignRef.current = freeReign
  const [personalCalcOpen, setPersonalCalcOpen] = useState(false)
  const [timerOpen, setTimerOpen] = useState(false)
  const lastTimerState = useRef<TimerWireState | null>(null)
  const lastTimerPos = useRef<{ x: number; y: number } | null>(null)
  const cameraCtl = useRef<FollowController | null>(null)
  const pageCtl = useRef<FollowController | null>(null)
  const isLarge = mode === 'large'
  const [canWrite, setCanWrite] = useState(!isLarge)
  // Only a signed-in tutor's persistent board has plans (the /try board has no account).
  const signedInHost = isHost && authParams.startsWith('boardToken=')
  const lessons = useLessons({ editor, channel, boardId, authParams, enabled: signedInHost })
  const navigate = useNavigate()
  const lessonHref = lessons.sessionId ? `/app/lessons/${encodeURIComponent(lessons.sessionId)}` : null
  // Answers (host only): the panel toggle and the latest stats on the wire, so a
  // freshly opened panel starts populated.
  const [statsOpen, setStatsOpen] = useState(false)
  const [lastStats, setLastStats] = useState<QuizStats | null>(null)
  // Questions accepting answers (server-authoritative, echoed to everyone). Any
  // open question is "practice mode": students stay on the tutor's page and
  // camera but get their own calculator.
  const [openQids, setOpenQids] = useState<Set<string>>(() => new Set())
  const practiceOpen = openQids.size > 0

  useEffect(() => {
    if (!editor) return
    const follow = !freeReignRef.current
    const camera = setupCameraSync(editor, channel, isHost, follow)
    const page = setupPageSync(editor, channel, isHost, follow)
    cameraCtl.current = camera
    pageCtl.current = page
    const stopPan = isHost ? setupRightClickPan(editor) : undefined
    return () => {
      camera.stop()
      page.stop()
      stopPan?.()
      cameraCtl.current = null
      pageCtl.current = null
    }
  }, [editor, channel, isHost])

  useEffect(() => {
    cameraCtl.current?.setFollow(!freeReign)
    pageCtl.current?.setFollow(!freeReign)
  }, [freeReign])

  useEffect(() => {
    if (isHost) return
    return channel.on('free-reign', (m) => setFreeReign(!!m.on))
  }, [channel, isHost])

  useEffect(() => {
    if (!isHost) return
    return channel.on('quiz-stats', (m) => setLastStats(m.stats as QuizStats))
  }, [channel, isHost])

  useEffect(() => channel.on('quiz-open', (m) => setOpenQids(new Set(m.qids as string[]))), [channel])

  const studentSoloCalc = freeReign || practiceOpen

  useEffect(() => {
    if (isHost) return
    setPersonalCalcOpen(studentSoloCalc)
  }, [studentSoloCalc, isHost])

  function toggleFreeReign(on: boolean) {
    setFreeReign(on)
    channel.send({ type: 'free-reign', on })
  }

  useEffect(() => {
    if (!isHost) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [isHost])

  useEffect(() => {
    if (isHost || !isLarge) return
    return channel.on('access', (m) => {
      if (m.userId === userId) setCanWrite(!!m.allow)
    })
  }, [channel, isHost, isLarge, userId])

  useEffect(() => {
    if (!editor || isHost || !isLarge) return
    editor.setReadonly(!canWrite)
  }, [canWrite, editor, isHost, isLarge])

  useEffect(() => {
    if (isHost) return
    return channel.on('calc', (m) => {
      if (m.action === 'open') setCalcOpen(true)
      else if (m.action === 'close') setCalcOpen(false)
      else if (m.action === 'state') lastCalcState.current = m.state
      else if (m.action === 'geom') lastCalcGeom.current = m.geom
    })
  }, [channel, isHost])

  useEffect(() => {
    if (isHost) return
    return channel.on('calc-access', (m) => setStudentsCanEdit(!!m.allow))
  }, [channel, isHost])

  useEffect(() => {
    if (isHost) return
    return channel.on('timer', (m) => {
      if (m.action === 'show') setTimerOpen(true)
      else if (m.action === 'hide') setTimerOpen(false)
      else if (m.action === 'state') lastTimerState.current = m as TimerWireState
      else if (m.action === 'geom' && m.geom) lastTimerPos.current = m.geom
    })
  }, [channel, isHost])

  function toggleAccess(allow: boolean) {
    setStudentsCanEdit(allow)
    channel.send({ type: 'calc-access', allow })
  }

  function toggleTimer(open: boolean) {
    setTimerOpen(open)
    channel.send({ type: 'timer', action: open ? 'show' : 'hide' })
  }

  const exportPdf = useCallback(async () => {
    const ed = editorRef.current
    if (!ed) return
    try {
      setPdfStatus('Exporting PDF…')
      const n = await exportBoardToPdf(ed)
      setPdfStatus(`Exported ${n} page${n === 1 ? '' : 's'}`)
      setTimeout(() => setPdfStatus(null), 2500)
    } catch (err) {
      setPdfStatus(err instanceof Error ? err.message : String(err))
      setTimeout(() => setPdfStatus(null), 5000)
    }
  }, [])

  // A PDF or photos brought in mid-lesson: saved as a library plan, then loaded
  // like any other, so the pages land after the board's own and open on the first.
  const { loadLibraryLesson } = lessons
  const addFiles = useCallback(
    async (files: File[]) => {
      try {
        const planId = await planFromFiles(files, setPdfStatus)
        if (!planId) throw new Error('Choose a PDF or photos (PNG, JPEG).')
        setPdfStatus(null)
        await loadLibraryLesson(planId)
      } catch (err) {
        setPdfStatus(err instanceof Error ? err.message : String(err))
        setTimeout(() => setPdfStatus(null), 5000)
      }
    },
    [loadLibraryLesson],
  )

  // Images go up to the room's asset store. A PDF dropped on the canvas goes on
  // the board as new pages, like a plan's.
  useEffect(() => {
    if (!editor) return
    editor.uploadImage = (file) => uploadBoardImage(boardId, authParams, file, file.name || 'image')
    editor.onError = (message) => {
      setPdfStatus(message)
      setTimeout(() => setPdfStatus(null), 5000)
    }
    editor.onOtherFiles = signedInHost
      ? (files) => {
          const pdfs = files.filter(isPdf)
          if (pdfs.length) void addFiles(pdfs)
        }
      : null
  }, [editor, boardId, authParams, signedInHost, addFiles])

  function toggleGrant(studentId: string, allow: boolean) {
    setGranted((prev) => {
      const next = new Set(prev)
      if (allow) next.add(studentId)
      else next.delete(studentId)
      return next
    })
    channel.send({ type: 'access', userId: studentId, allow })
  }

  // Anchored under each answerable problem: an input for students, an open/close
  // gate for the tutor. Built once per identity (a new component remounts,
  // dropping a half-typed answer); `answerKeys` only changes on the host
  // when a plan loads, and the gate state is re-echoed by the server anyway.
  const AnswerOverlay = useMemo(
    () => makeAnswerOverlay({ channel, roomId: boardId, userId, displayName, isHost, answerKeys: lessons.answerKeys }),
    [channel, boardId, userId, displayName, isHost, lessons.answerKeys],
  )

  // Connected students, from presence (collaborators excludes self): the stats
  // panel's "3/5 answered" denominator.
  const rosterSize = useBoardValue(editor, () => editor?.getCollaborators().length ?? 0)
  const connected = useBoardValue(editor, () => editor?.isConnected() ?? true)

  // Every answerable question on the tutor's current page, so the dock can open
  // or close a whole page at once.
  const pageQids = useBoardValue<string[]>(editor, () =>
    editor
      ? editor
          .getCurrentPageShapes()
          .map((s) => (s.meta as { q?: QuestionMeta }).q?.id)
          .filter((id): id is string => !!id)
      : [],
  )
  const anyOpenOnPage = pageQids.some((id) => openQids.has(id))

  // qid -> "Linear functions · 2 · Q1": the page name without its date, then the
  // question's order down the page. Ids carry a per-plan prefix, so they read badly.
  const questionLabels = useBoardValue<Record<string, string>>(editor, () => {
    const out: Record<string, string> = {}
    if (!isHost || !editor) return out
    for (const page of editor.getPages()) {
      const qs = editor
        .getPageShapeIds(page.id)
        .map((id) => editor.getShape(id)!)
        .filter((sh) => (sh.meta as { q?: QuestionMeta }).q)
        .sort((a, b) => a.y - b.y)
      const pageName = page.name.includes(' · ') ? page.name.slice(page.name.indexOf(' · ') + 3) : page.name
      qs.forEach((sh, i) => {
        out[(sh.meta as { q?: QuestionMeta }).q!.id] = `${pageName} · Q${i + 1}`
      })
    }
    return out
  })
  const labelFor = useCallback((qid: string) => questionLabels[qid] ?? qid, [questionLabels])

  // "Everyone's answered everything open": the tutor's cue to move on. `>=`, not
  // `===`: a student who reconnects with a fresh id can push a count past the roster.
  const allAnswered =
    rosterSize > 0 &&
    openQids.size > 0 &&
    [...openQids].every((qid) => (lastStats?.questions.find((q) => q.qid === qid)?.answered ?? 0) >= rosterSize)

  /** Open every question on this page, or, if any is open, close answering entirely. */
  function togglePageAnswering() {
    const qids = anyOpenOnPage ? [] : pageQids
    setOpenQids(new Set(qids)) // optimistic; the server echoes the filtered set back
    channel.send({ type: 'quiz-open', qids })
  }

  // In-app, not window.confirm (blocked in an unfocused tab, and unstyled).
  const [confirmEnd, setConfirmEnd] = useState(false)

  // Ending a lesson keeps its board as the student's notes and records the end
  // (OVERHAUL O3, routes/followUp.ts). Leaving matters more than the notes: a
  // failed or slow export (15 s) just ends without them.
  async function finishLesson() {
    const sessionId = lessons.sessionId
    if (!sessionId || !lessonHref) return navigate('/app')
    setPdfStatus('Saving the board as notes…')
    let boardPdf: string | undefined
    try {
      const ed = editorRef.current
      const blob = ed
        ? await Promise.race([lessonNotesPdf(ed, sessionId), new Promise<null>((r) => setTimeout(() => r(null), 15_000))])
        : null
      if (blob) boardPdf = (await uploadFile(blob, 'Lesson notes.pdf')).token
    } catch {
      /* end without notes */
    }
    await apiFetch(`/api/tutor/sessions/${encodeURIComponent(sessionId)}/end`, {
      method: 'POST',
      body: JSON.stringify(boardPdf ? { boardPdf } : {}),
    }).catch(() => undefined)
    navigate(lessonHref)
  }

  if (connection.status === 'loading') {
    return <div className="board-status board-scope">Connecting to the board…</div>
  }
  if (connection.status === 'error') {
    return (
      <div className="board-status board-scope">
        <div>Couldn&rsquo;t connect to the board.</div>
        <div style={{ fontSize: '0.85rem' }}>{connection.error}</div>
      </div>
    )
  }

  const status = lessons.status ?? pdfStatus
  const bar: ReactNode = isHost ? (
    <>
      {lessonHref && (
        <a
          className="dock-btn"
          href={lessonHref}
          target="_blank"
          rel="noopener"
          title="Open the lesson page in a new tab"
          aria-label="Lesson page"
        >
          <ArrowUpRight size={15} />
          <span className="dock-label">Lesson page</span>
        </a>
      )}
      {signedInHost && (
        <>
          <LessonPicker onPick={lessons.loadLibraryLesson} onAddFiles={addFiles} />
          <span className="board-bar__sep" />
        </>
      )}
      <button
        className={`dock-btn ${freeReign ? 'primary' : ''}`}
        role="switch"
        aria-checked={freeReign}
        aria-label={freeReign ? 'Students: roaming' : 'Students: following you'}
        title={
          freeReign
            ? 'Students move around the board on their own, with their own calculator. Click to bring them back to your view.'
            : 'Students see your page and view. Click to let them move around the board on their own.'
        }
        onClick={() => toggleFreeReign(!freeReign)}
      >
        {freeReign ? <Unlock size={15} /> : <Lock size={15} />}
        <span className="dock-label">{freeReign ? 'Students: roaming' : 'Students: following you'}</span>
      </button>
      {pageQids.length > 0 && (
        <button
          className={`dock-btn ${anyOpenOnPage ? 'primary' : ''}`}
          aria-label={anyOpenOnPage ? 'Stop answering' : `Answer page (${pageQids.length})`}
          title="Let students answer this page's questions. They stay on your page, with their own calculator."
          onClick={togglePageAnswering}
        >
          {anyOpenOnPage ? <Square size={13} /> : <Play size={13} />}
          <span className="dock-label">{anyOpenOnPage ? 'Stop answering' : `Answer page (${pageQids.length})`}</span>
        </button>
      )}
      <button
        className="dock-btn"
        aria-label={statsOpen ? 'Hide answers' : 'Answers'}
        title={statsOpen ? 'Hide answers' : 'Answers'}
        onClick={() => setStatsOpen((v) => !v)}
      >
        <ListChecks size={15} />
        <span className="dock-label">Answers</span>
      </button>
      {allAnswered && (
        <span className="qs-all-answered-pill">
          <Check size={14} />
          All answered
        </span>
      )}
      <span className="board-bar__sep" />
      <button
        className="dock-btn"
        aria-label={calcOpen ? 'Hide calculator' : 'Calculator'}
        title={calcOpen ? 'Hide calculator' : 'Calculator'}
        onClick={() => setCalcOpen((v) => !v)}
      >
        <CalculatorIcon size={15} />
      </button>
      <button
        className="dock-btn"
        aria-label={timerOpen ? 'Hide timer' : 'Timer'}
        title={timerOpen ? 'Hide timer' : 'Timer'}
        onClick={() => toggleTimer(!timerOpen)}
      >
        <TimerIcon size={15} />
      </button>
      <span className="board-bar__sep" />
      <CopyLinkButton boardId={boardId} />
      <button className="dock-btn" aria-label="Export PDF" title="Export the board as a PDF" onClick={exportPdf}>
        <FileDown size={15} />
      </button>
      {signedInHost && (
        <button className="dock-btn end" onClick={() => setConfirmEnd(true)}>
          <LogOut size={15} />
          {lessonHref ? 'End lesson' : 'Leave'}
        </button>
      )}
      {status && <span className="lesson-status" role="status">{status}</span>}
    </>
  ) : studentSoloCalc ? (
    <button className="dock-btn" onClick={() => setPersonalCalcOpen((v) => !v)}>
      <CalculatorIcon size={15} />
      {personalCalcOpen ? 'Hide calculator' : 'My calculator'}
    </button>
  ) : null

  return (
    <div className="board-root board-scope">
      <Canvas editor={connection.editor}>
        <AnswerOverlay />
        <div className="board-chrome">
          <div className="board-chrome__top">
            <div className="board-chrome__side">{(isHost || freeReign) && <PageMenu canEdit={isHost} />}</div>
            <div className="board-chrome__center">
              {bar && <div className="board-bar">{bar}</div>}
              {!connected && <span className="board-offline" role="status">Reconnecting…</span>}
            </div>
            <div className="board-chrome__side end">
              <PeopleMenu selfId={userId} granted={isHost && isLarge ? granted : undefined} onToggle={toggleGrant} />
            </div>
          </div>
          <div className="board-chrome__bottom">{(isHost || canWrite) && <BoardToolbar />}</div>
        </div>
      </Canvas>

      <ConfirmDialog
        open={confirmEnd}
        onOpenChange={setConfirmEnd}
        title={lessonHref ? 'End the lesson?' : 'Leave the board?'}
        description={
          lessonHref
            ? 'You’ll go back to the lesson page. Students can stay on the board until they close it.'
            : 'Students can stay on the board until they close it.'
        }
        confirmLabel={lessonHref ? 'End lesson' : 'Leave'}
        onConfirm={() => void finishLesson()}
      />

      {isHost && statsOpen && (
        <StatsPanel
          channel={channel}
          initialStats={lastStats}
          rosterSize={rosterSize}
          openQids={openQids}
          allAnswered={allAnswered}
          labelFor={labelFor}
          onHide={() => setStatsOpen(false)}
        />
      )}

      {timerOpen && (
        <Timer
          channel={channel}
          isHost={isHost}
          initialState={isHost ? null : lastTimerState.current}
          initialPos={isHost ? null : lastTimerPos.current}
          onHide={() => toggleTimer(false)}
        />
      )}

      {(isHost ? calcOpen : calcOpen && !studentSoloCalc) && (
        <Calculator
          channel={channel}
          isHost={isHost}
          initialState={lastCalcState.current}
          initialGeom={lastCalcGeom.current}
          canEdit={!isHost && studentsCanEdit}
          studentsCanEdit={studentsCanEdit}
          onToggleAccess={toggleAccess}
        />
      )}

      {!isHost && studentSoloCalc && personalCalcOpen && <Calculator channel={channel} isHost={false} personal />}
    </div>
  )
}

// Stays in the bar for the whole session: a tutor often re-sends the link mid-lesson.
function CopyLinkButton({ boardId }: { boardId: string }) {
  const link = `${window.location.origin}/b/${boardId}`
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      window.prompt('Copy this link for your students:', link)
    }
  }

  return (
    <button className="dock-btn" aria-label="Copy student link" title={link} onClick={copy}>
      {copied ? <Check size={15} /> : <LinkIcon size={15} />}
    </button>
  )
}
