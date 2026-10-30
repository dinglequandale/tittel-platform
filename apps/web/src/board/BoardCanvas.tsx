import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ConfirmDialog } from '@tittel/ui'
import {
  Tldraw,
  PeopleMenu,
  atom,
  defaultHandleExternalFileContent,
  useEditor,
  useToasts,
  useTranslation,
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
  ArrowUpRight,
  LogOut,
} from 'lucide-react'
import type { QuestionMeta, QuizStats } from '@tittel/shared'
import { useSync } from '@tldraw/sync'
import { makeAssetStore } from './assetStore.ts'
import { setupCameraSync, type FollowController } from './cameraSync.ts'
import { setupPageSync } from './pageSync.ts'
import { setupRightClickPan } from './rightClickPan.ts'
import type { ControlChannel } from './controlChannel.ts'
import { BoardToolbar } from './BoardToolbar.tsx'
import { boardCustomTools, boardShapeUtils, boardUiOverrides, keepDashInStep } from './boardTools.ts'
import { Calculator } from './Calculator.tsx'
import { Timer, type TimerWireState } from './Timer.tsx'
import { exportBoardToPdf, lessonNotesPdf } from './exportPdf.ts'
import { apiFetch } from '../lib/api.ts'
import { uploadFile, isPdf } from '../lib/files.ts'
import { useLessons } from './lesson/useLessons.ts'
import { LessonPicker } from './lesson/LessonPicker.tsx'
import { planFromFiles } from './lesson/fromFiles.ts'
import { makeAnswerOverlay } from './quiz/AnswerOverlay.tsx'
import { StatsPanel } from './quiz/StatsPanel.tsx'
import './board.css'

type ClassMode = 'small' | 'large'

// The bar's contents, handed from BoardCanvas into tldraw's TopPanel slot. A
// context (not a closure) keeps the slot component's identity stable, so
// tldraw doesn't remount it on every state change.
const BarContext = createContext<ReactNode>(null)

function BoardTopPanel() {
  const bar = useContext(BarContext)
  return bar ? <div className="board-bar">{bar}</div> : null
}

// tldraw's own chrome, switched off piece by piece rather than with `hideUi`,
// which would also take the keyboard shortcuts, paste and the TopPanel slot.
// The licence watermark is part of the canvas and stays (OVERHAUL.md §5).
const HIDDEN_UI: TLComponents = {
  MainMenu: null,
  StylePanel: null,
  ActionsMenu: null,
  QuickActions: null,
  NavigationPanel: null,
  HelpMenu: null,
  KeyboardShortcutsDialog: null,
  ContextMenu: null,
  DebugPanel: null,
  DebugMenu: null,
  CursorChatBubble: null,
}

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
    const stopDash = keepDashInStep(editor)
    return () => {
      camera.stop()
      page.stop()
      stopPan?.()
      stopDash()
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

  const components = useMemo<TLComponents>(() => {
    const c: TLComponents = { ...HIDDEN_UI, InFrontOfTheCanvas: AnswerOverlay, TopPanel: BoardTopPanel, Toolbar: BoardToolbar }
    if (isHost) {
      if (isLarge) c.SharePanel = HostSharePanel
      return c
    }
    if (!canWrite) c.Toolbar = null
    if (!freeReign) c.PageMenu = null
    return c
  }, [isHost, isLarge, canWrite, freeReign, AnswerOverlay, HostSharePanel])

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
      <BarContext.Provider value={bar}>
        <Tldraw
          store={store.store}
          onMount={(ed) => {
            editorRef.current = ed
            setEditor(ed)
          }}
          components={components}
          tools={boardCustomTools}
          shapeUtils={boardShapeUtils}
          overrides={boardUiOverrides}
        >
          {signedInHost && <PdfDrop onPdfs={addFiles} />}
        </Tldraw>
      </BarContext.Provider>

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

// A PDF dropped on the canvas goes on the board as new pages, like a plan's.
// Every other file (photos included) keeps tldraw's default drop. A child of
// <Tldraw>, so its effect runs after tldraw registers its default handlers.
function PdfDrop({ onPdfs }: { onPdfs: (files: File[]) => void }) {
  const editor = useEditor()
  const toasts = useToasts()
  const msg = useTranslation()
  const onPdfsRef = useRef(onPdfs)
  onPdfsRef.current = onPdfs

  useEffect(() => {
    editor.registerExternalContentHandler('files', async (content) => {
      const pdfs = content.files.filter(isPdf)
      const rest = content.files.filter((f) => !isPdf(f))
      if (pdfs.length) void onPdfsRef.current(pdfs)
      if (rest.length) await defaultHandleExternalFileContent(editor, { ...content, files: rest }, { toasts, msg })
    })
  }, [editor, toasts, msg])

  return null
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
