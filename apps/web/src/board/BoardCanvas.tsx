import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Tldraw,
  DefaultMainMenu,
  DefaultMainMenuContent,
  PeopleMenu,
  atom,
  useEditor,
  useValue,
  type Atom,
  type Editor,
  type TLComponents,
} from 'tldraw'
import 'tldraw/tldraw.css'
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
} from 'lucide-react'
import type { QuestionMeta, QuizStats } from '@tittel/shared'
import { useSync } from '@tldraw/sync'
import { makeAssetStore } from './assetStore.ts'
import { setupCameraSync, type FollowController } from './cameraSync.ts'
import { setupPageSync } from './pageSync.ts'
import { setupRightClickPan } from './rightClickPan.ts'
import type { ControlChannel } from './controlChannel.ts'
import { Calculator } from './Calculator.tsx'
import { Timer, type TimerWireState } from './Timer.tsx'
import { exportBoardToPdf } from './exportPdf.ts'
import { useLessons } from './lesson/useLessons.ts'
import { LessonPicker } from './lesson/LessonPicker.tsx'
import { makeAnswerOverlay } from './quiz/AnswerOverlay.tsx'
import { StatsPanel } from './quiz/StatsPanel.tsx'
import './board.css'

type ClassMode = 'small' | 'large'

function connectUrl(boardId: string, authParams: string) {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/connect/${encodeURIComponent(boardId)}?${authParams}`
}

// Ported from the legacy whiteboard's Board.tsx (its `BoardCanvas`) — PLAN.md
// §6.3: "port unchanged, restyled." Lesson loading lives in ./lesson/, the
// answer overlay + stats panel in ./quiz/. Still to come (OVERHAUL O2): games,
// which slot into the same `components`/dock spots.
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
  const assets = useMemo(() => makeAssetStore(boardId), [boardId])
  const store = useSync({
    uri: connectUrl(boardId, authParams),
    assets,
    userInfo: {
      id: userId,
      name: displayName,
      color: isHost ? '#2563eb' : '#16a34a',
    },
  })

  const [editor, setEditor] = useState<Editor | null>(null)
  const editorRef = useRef<Editor | null>(null)
  const [calcOpen, setCalcOpen] = useState(false)
  const [studentsCanEdit, setStudentsCanEdit] = useState(false)
  const lastCalcState = useRef<unknown>(null)
  const lastCalcGeom = useRef<unknown>(null)
  const [linkCopied, setLinkCopied] = useState(false)
  const [pdfStatus, setPdfStatus] = useState<string | null>(null)
  const grantedAtom = useMemo(() => atom('granted-writers', new Set<string>()), [])
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
  const canWriteRef = useRef(canWrite)
  canWriteRef.current = canWrite
  // Only a signed-in tutor's persistent board has plans (the /try board has no account).
  const signedInHost = isHost && authParams.startsWith('boardToken=')
  const lessons = useLessons({ editor, channel, boardId, enabled: signedInHost })
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
    const pinIfLocked = () => {
      if (!canWriteRef.current && editor.getCurrentToolId() !== 'hand') editor.setCurrentTool('hand')
    }
    const defer = () => setTimeout(pinIfLocked, 0)
    defer()
    const unlisten = editor.store.listen(
      () => {
        if (!canWriteRef.current) defer()
      },
      { scope: 'session', source: 'user' },
    )
    return () => unlisten()
  }, [editor, isHost, isLarge])

  useEffect(() => {
    if (!editor || isHost || !isLarge) return
    editor.setCurrentTool(canWrite ? 'select' : 'hand')
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

  const toggleGrant = useCallback(
    (studentId: string, allow: boolean) => {
      grantedAtom.update((prev) => {
        const next = new Set(prev)
        if (allow) next.add(studentId)
        else next.delete(studentId)
        return next
      })
      channel.send({ type: 'access', userId: studentId, allow })
    },
    [channel, grantedAtom],
  )

  const HostMainMenu = useMemo(
    () =>
      function HostMainMenu() {
        return (
          <DefaultMainMenu>
            <DefaultMainMenuContent />
          </DefaultMainMenu>
        )
      },
    [],
  )

  const HostSharePanel = useMemo(
    () =>
      function HostSharePanel() {
        return (
          <div className="tlui-share-zone" draggable={false}>
            <PeopleMenu>
              <WriteAccessControls grantedAtom={grantedAtom} onToggle={toggleGrant} selfId={userId} />
            </PeopleMenu>
          </div>
        )
      },
    [grantedAtom, toggleGrant, userId],
  )

  // Anchored under each answerable problem: an input for students, an open/close
  // gate for the tutor. Built once per identity (tldraw remounts the slot when it
  // changes, dropping a half-typed answer); `answerKeys` only changes on the host
  // when a plan loads, and the gate state is re-echoed by the server anyway.
  const AnswerOverlay = useMemo(
    () => makeAnswerOverlay({ channel, roomId: boardId, userId, displayName, isHost, answerKeys: lessons.answerKeys }),
    [channel, boardId, userId, displayName, isHost, lessons.answerKeys],
  )

  // Connected students, from tldraw presence (collaborators excludes self): the
  // stats panel's "3/5 answered" denominator.
  const rosterSize = useValue('roster size', () => editor?.getCollaborators().length ?? 0, [editor])

  // Every answerable question on the tutor's current page, so the dock can open
  // or close a whole page at once.
  const pageQids = useValue<string[]>(
    'page question ids',
    () =>
      editor
        ? editor
            .getCurrentPageShapes()
            .map((s) => (s.meta as { q?: QuestionMeta }).q?.id)
            .filter((id): id is string => !!id)
        : [],
    [editor],
  )
  const anyOpenOnPage = pageQids.some((id) => openQids.has(id))

  // qid -> "Linear functions · 2 · Q1": the page name without its date, then the
  // question's order down the page. Ids carry a per-plan prefix, so they read badly.
  const questionLabels = useValue<Record<string, string>>(
    'question labels',
    () => {
      const out: Record<string, string> = {}
      if (!isHost || !editor) return out
      for (const page of editor.getPages()) {
        const qs = [...editor.getPageShapeIds(page.id)]
          .map((id) => editor.getShape(id)!)
          .filter((sh) => (sh.meta as { q?: QuestionMeta }).q)
          .sort((a, b) => a.y - b.y)
        const pageName = page.name.includes(' · ') ? page.name.slice(page.name.indexOf(' · ') + 3) : page.name
        qs.forEach((sh, i) => {
          out[(sh.meta as { q?: QuestionMeta }).q!.id] = `${pageName} · Q${i + 1}`
        })
      }
      return out
    },
    [editor, isHost],
  )
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

  const components = useMemo<TLComponents>(() => {
    if (isHost) {
      const c: TLComponents = { MainMenu: HostMainMenu, InFrontOfTheCanvas: AnswerOverlay }
      if (isLarge) c.SharePanel = HostSharePanel
      return c
    }
    const c: TLComponents = { InFrontOfTheCanvas: AnswerOverlay }
    if (!canWrite) c.Toolbar = null
    if (!freeReign) c.PageMenu = null
    return c
  }, [isHost, isLarge, canWrite, freeReign, AnswerOverlay, HostMainMenu, HostSharePanel])

  if (store.status === 'loading') {
    return <div className="board-status board-scope">Connecting to the board…</div>
  }
  if (store.status === 'error') {
    return (
      <div className="board-status board-scope">
        <div>Couldn&rsquo;t connect to the board.</div>
        <div style={{ fontSize: '0.85rem' }}>{store.error.message}</div>
      </div>
    )
  }

  return (
    <div className="board-root board-scope">
      <Tldraw
        store={store.store}
        onMount={(ed) => {
          editorRef.current = ed
          setEditor(ed)
        }}
        components={components}
      />

      {isHost && (
        <div className="tutor-dock">
          {(lessons.status ?? pdfStatus) && <span className="lesson-status">{lessons.status ?? pdfStatus}</span>}
          {signedInHost && <LessonPicker onPick={lessons.loadLibraryLesson} />}
          <ShareControl boardId={boardId} collapsed={linkCopied} onCopied={() => setLinkCopied(true)} />
          <button
            className={`dock-btn ${freeReign ? 'primary' : ''}`}
            title="Let students roam pages/zoom freely and use their own calculators"
            onClick={() => toggleFreeReign(!freeReign)}
          >
            {freeReign ? <Unlock size={14} /> : <Lock size={14} />}
            {freeReign ? 'Free rein: On' : 'Free rein: Off'}
          </button>
          {pageQids.length > 0 && (
            <button
              className={`dock-btn ${anyOpenOnPage ? 'primary' : ''}`}
              title="Let students answer this page's questions. They stay on your page, with their own calculator."
              onClick={togglePageAnswering}
            >
              {anyOpenOnPage ? <Square size={12} /> : <Play size={12} />}
              {anyOpenOnPage ? 'Stop answering' : `Answer page (${pageQids.length})`}
            </button>
          )}
          <button className="dock-btn" onClick={() => setStatsOpen((v) => !v)}>
            <ListChecks size={14} />
            {statsOpen ? 'Hide answers' : 'Answers'}
          </button>
          {allAnswered && (
            <span className="qs-all-answered-pill">
              <Check size={14} />
              All answered
            </span>
          )}
          <button className="dock-btn" onClick={() => toggleTimer(!timerOpen)}>
            <TimerIcon size={14} />
            {timerOpen ? 'Hide timer' : 'Timer'}
          </button>
          <button className="dock-btn" onClick={() => setCalcOpen((v) => !v)}>
            <CalculatorIcon size={14} />
            {calcOpen ? 'Hide calculator' : 'Calculator'}
          </button>
          <button className="dock-btn" onClick={exportPdf}>
            <FileDown size={14} />
            Export PDF
          </button>
        </div>
      )}

      {!isHost && studentSoloCalc && (
        <div className="tutor-dock">
          <button className="dock-btn" onClick={() => setPersonalCalcOpen((v) => !v)}>
            <CalculatorIcon size={14} />
            {personalCalcOpen ? 'Hide calculator' : 'My calculator'}
          </button>
        </div>
      )}

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

function WriteAccessControls({
  grantedAtom,
  onToggle,
  selfId,
}: {
  grantedAtom: Atom<Set<string>>
  onToggle: (studentId: string, allow: boolean) => void
  selfId: string
}) {
  const editor = useEditor()
  const collaborators = useValue('collaborators', () => editor.getCollaborators(), [editor])
  const granted = useValue(grantedAtom)
  const students = collaborators.filter((c) => c.userId !== selfId)
  if (students.length === 0) return null

  return (
    <div className="tlui-people-menu__section write-access">
      <div className="write-access__title">Write access</div>
      {students.map((c) => {
        const can = granted.has(c.userId)
        return (
          <div className="write-access__row" key={c.userId}>
            <span className="write-access__dot" style={{ background: c.color }} />
            <span className="write-access__name">{c.userName || 'Student'}</span>
            <button
              type="button"
              role="switch"
              aria-checked={can}
              title={can ? 'Can write — click to lock' : 'Locked — click to let them write'}
              className={`calc-switch ${can ? 'on' : ''}`}
              onClick={() => onToggle(c.userId, !can)}
            >
              <span className="calc-switch-knob" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

// Stays visible for the whole session rather than disappearing after the
// first copy (a tutor often needs to re-send the link mid-lesson) —
// collapses to a compact dock button once the link's been copied once so it
// doesn't keep hogging space.
function ShareControl({ boardId, collapsed, onCopied }: { boardId: string; collapsed: boolean; onCopied: () => void }) {
  const link = `${window.location.origin}/b/${boardId}`
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      onCopied()
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard blocked — leave it up so they can copy manually */
    }
  }

  if (collapsed) {
    return (
      <button className="dock-btn" title={link} onClick={copy}>
        {copied ? 'Copied!' : <><LinkIcon size={14} /> Copy link</>}
      </button>
    )
  }

  return (
    <div className="share-control">
      <span className="share-link">{link}</span>
      <button className="dock-btn primary" onClick={copy}>
        {copied ? 'Copied!' : 'Copy link'}
      </button>
    </div>
  )
}
