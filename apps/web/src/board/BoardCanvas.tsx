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
import { useSync } from '@tldraw/sync'
import { makeAssetStore } from './assetStore.ts'
import { setupCameraSync, type FollowController } from './cameraSync.ts'
import { setupPageSync } from './pageSync.ts'
import { setupRightClickPan } from './rightClickPan.ts'
import type { ControlChannel } from './controlChannel.ts'
import { Calculator } from './Calculator.tsx'
import { Timer, type TimerWireState } from './Timer.tsx'
import { exportBoardToPdf } from './exportPdf.ts'
import './board.css'

type ClassMode = 'small' | 'large'

function connectUrl(boardId: string, authParams: string) {
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/connect/${encodeURIComponent(boardId)}?${authParams}`
}

// Ported from the legacy whiteboard's Board.tsx (its `BoardCanvas`) — PLAN.md
// §6.3: "port unchanged, restyled." Deferred to a follow-up pass: lesson
// loading, the quiz answer overlay + stats panel, and games — none of those
// change this file's shape, they slot into the same `components`/dock spots.
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
    if (isHost) return
    setPersonalCalcOpen(freeReign)
  }, [freeReign, isHost])

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

  const studentSoloCalc = freeReign

  const components = useMemo<TLComponents>(() => {
    if (isHost) {
      const c: TLComponents = { MainMenu: HostMainMenu }
      if (isLarge) c.SharePanel = HostSharePanel
      return c
    }
    const c: TLComponents = {}
    if (!canWrite) c.Toolbar = null
    if (!freeReign) c.PageMenu = null
    return c
  }, [isHost, isLarge, canWrite, freeReign, HostMainMenu, HostSharePanel])

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
          {pdfStatus && <span className="lesson-status">{pdfStatus}</span>}
          {!linkCopied && <ShareControl boardId={boardId} onCopied={() => setLinkCopied(true)} />}
          <button
            className={`dock-btn ${freeReign ? 'primary' : ''}`}
            title="Let students roam pages/zoom freely and use their own calculators"
            onClick={() => toggleFreeReign(!freeReign)}
          >
            {freeReign ? '🔓 Free reign: On' : '🔒 Free reign: Off'}
          </button>
          <button className="dock-btn" onClick={() => toggleTimer(!timerOpen)}>
            {timerOpen ? 'Hide timer' : '⏱ Timer'}
          </button>
          <button className="dock-btn" onClick={() => setCalcOpen((v) => !v)}>
            {calcOpen ? 'Hide calculator' : '🧮 Calculator'}
          </button>
          <button className="dock-btn" onClick={exportPdf}>
            📄 Export PDF
          </button>
        </div>
      )}

      {!isHost && studentSoloCalc && (
        <div className="tutor-dock">
          <button className="dock-btn" onClick={() => setPersonalCalcOpen((v) => !v)}>
            {personalCalcOpen ? 'Hide calculator' : '🧮 My calculator'}
          </button>
        </div>
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

function ShareControl({ boardId, onCopied }: { boardId: string; onCopied: () => void }) {
  const link = `${window.location.origin}/b/${boardId}`
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(onCopied, 900)
    } catch {
      /* clipboard blocked — leave it up so they can copy manually */
    }
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
