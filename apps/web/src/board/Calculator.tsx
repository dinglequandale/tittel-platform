import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { X } from 'lucide-react'
import { emptyState, togglePin, type GraphState } from '@tittel/graph'
import { GraphCalculator, isGraphState } from '../graph/GraphCalculator.tsx'
import type { ControlChannel } from './controlChannel.ts'

// The floating panel's position/size, in CSS pixels (top-left anchored).
type Geom = { x: number; y: number; w: number; h: number }

// Default parking spot: bottom-right above the dock, matching the original CSS.
function defaultGeom(): Geom {
  const w = Math.min(440, window.innerWidth * 0.92)
  const h = Math.min(520, window.innerHeight - 120)
  return {
    x: Math.max(12, window.innerWidth - w - 12),
    y: Math.max(12, window.innerHeight - h - 60),
    w,
    h,
  }
}

// Keep at least a sliver on-screen so a panel can always be grabbed back.
function clampPos(g: Geom): Geom {
  const margin = 40
  return {
    ...g,
    x: Math.min(Math.max(g.x, margin - g.w), window.innerWidth - margin),
    y: Math.min(Math.max(g.y, 0), window.innerHeight - margin),
  }
}

// Trailing throttle for broadcasting edits, so fast typing and drags stay calm.
const SEND_EVERY_MS = 60

// A floating graphing-calculator panel (our own, GRAPH-SPEC G1).
//  - Tutor (host): always an editor. Changes broadcast to everyone; a footer
//    switch toggles whether students may edit too.
//  - Student (guest): a live mirror, read-only by default. When the tutor
//    enables editing, the student can drive the shared calculator; their
//    changes flow back to everyone.
//
// No echo loop is possible: we broadcast only from GraphCalculator's onChange,
// which fires for user edits only, and applying a remote state never calls it.
// (The Desmos version needed an interaction-timing workaround, PLAN §9.2,
// because Desmos rewrote its own state after every setState.)
export function Calculator({
  channel,
  isHost,
  initialState,
  initialGeom,
  canEdit = false,
  studentsCanEdit = false,
  onToggleAccess,
  personal = false,
  onClose,
}: {
  channel: ControlChannel
  isHost: boolean
  initialState?: unknown
  /** The shared panel's last-known position/size, for a late-joining student. */
  initialGeom?: unknown
  canEdit?: boolean
  studentsCanEdit?: boolean
  onToggleAccess?: (allow: boolean) => void
  /** A private, non-synced scratch calculator (free reign): full edit, no relay. */
  personal?: boolean
  /** Shows a close button. A student following the shared panel gets none: the tutor opens and closes it. */
  onClose?: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [graph, setGraph] = useState<GraphState>(() =>
    !personal && isGraphState(initialState) ? initialState : emptyState(),
  )
  const graphRef = useRef(graph)
  graphRef.current = graph

  const amEditor = isHost || canEdit || personal

  // Who may move/resize this panel: the tutor (drives everyone) or the owner of a
  // private free-reign calculator (local only). A following student mirrors only.
  const geomEditable = isHost || personal
  const [geom, setGeom] = useState<Geom>(() => (initialGeom as Geom) ?? defaultGeom())
  const geomRef = useRef(geom)
  geomRef.current = geom

  // Tutor broadcasts position/size so students' shared panel tracks it. A private
  // free-reign calculator stays local; a following student only receives.
  useEffect(() => {
    if (isHost && !personal) channel.send({ type: 'calc', action: 'geom', geom })
  }, [geom, isHost, personal, channel])

  // Following student: mirror the tutor's moves/resizes of the shared panel.
  useEffect(() => {
    if (isHost || personal) return
    return channel.on('calc', (m) => {
      if (m.action === 'geom' && m.geom) setGeom(m.geom as Geom)
    })
  }, [channel, isHost, personal])

  // Capture native resize-handle drags (CSS `resize: both`) back into geom so the
  // new size is broadcast. border-box sizing makes offsetWidth equal the width we
  // set, so this can't drift or loop.
  useEffect(() => {
    if (!geomEditable) return
    const el = panelRef.current
    if (!el) return
    const ro = new ResizeObserver(() => {
      const w = el.offsetWidth
      const h = el.offsetHeight
      const g = geomRef.current
      if (w !== g.w || h !== g.h) setGeom({ ...g, w, h })
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [geomEditable])

  // Drag the panel by its header. Pointer capture keeps the drag smooth even when
  // the cursor passes over the calculator's own surface.
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    // Capturing the pointer would take the click away from the close button.
    if (!geomEditable || e.button !== 0 || (e.target as HTMLElement).closest('button')) return
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const startX = e.clientX
    const startY = e.clientY
    const base = geomRef.current
    const onMove = (ev: PointerEvent) =>
      setGeom(clampPos({ ...base, x: base.x + (ev.clientX - startX), y: base.y + (ev.clientY - startY) }))
    const onUp = () => {
      el.releasePointerCapture?.(e.pointerId)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  // Broadcasting: trailing-throttled, user edits only (see the note above).
  const sendTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSent = useRef(0)
  const amEditorRef = useRef(amEditor)
  amEditorRef.current = amEditor
  const flush = () => {
    sendTimer.current = null
    lastSent.current = performance.now()
    channel.send({ type: 'calc', action: 'state', state: graphRef.current })
  }
  const onUserChange = (next: GraphState) => {
    setGraph(next)
    graphRef.current = next
    if (personal || !amEditorRef.current) return
    const wait = SEND_EVERY_MS - (performance.now() - lastSent.current)
    if (wait <= 0) flush()
    else if (!sendTimer.current) sendTimer.current = setTimeout(flush, wait)
  }

  useEffect(() => {
    // A personal scratch calculator is fully local: no relay in or out.
    if (personal) return
    const off = channel.on('calc', (m) => {
      if (m.action === 'state' && isGraphState(m.state)) setGraph(m.state)
      // A read-only student clicked a point: the tutor applies it, so it reaches
      // everyone (and late joiners) in the shared state.
      else if (m.action === 'pin' && isHost) onUserChange(togglePin(graphRef.current, m.x, m.y))
    })
    let offOpen: (() => void) | undefined
    if (isHost) {
      const pushOpen = () => {
        channel.send({ type: 'calc', action: 'open' })
        channel.send({ type: 'calc', action: 'state', state: graphRef.current })
        // Re-assert position/size so students sync even if the first geom
        // broadcast raced the socket opening (or after a reconnect).
        channel.send({ type: 'calc', action: 'geom', geom: geomRef.current })
      }
      pushOpen()
      offOpen = channel.on('open', pushOpen)
    }
    return () => {
      off()
      offOpen?.()
      if (sendTimer.current) clearTimeout(sendTimer.current)
      if (isHost) channel.send({ type: 'calc', action: 'close' })
    }
    // channel/isHost/personal are stable per mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, isHost, personal])

  return (
    <div
      ref={panelRef}
      className="calc-panel"
      style={{
        left: geom.x,
        top: geom.y,
        width: geom.w,
        height: geom.h,
        right: 'auto',
        bottom: 'auto',
        resize: geomEditable ? 'both' : 'none',
      }}
    >
      <div
        className={`calc-header${geomEditable ? ' draggable' : ''}`}
        onPointerDown={geomEditable ? startDrag : undefined}
      >
        <span className="calc-title">
          {personal ? 'My calculator' : `Calculator${!isHost && !canEdit ? ' · live' : ''}`}
        </span>
        {!isHost && canEdit && !personal && <span className="calc-badge">you can edit</span>}
        {onClose && (
          <button type="button" className="calc-close-btn" onClick={onClose} aria-label="Close calculator" title="Close calculator">
            <X size={16} />
          </button>
        )}
      </div>
      <div className="calc-body">
        <GraphCalculator
          state={graph}
          onChange={onUserChange}
          editable={amEditor}
          onPinRequest={(x, y) => channel.send({ type: 'calc', action: 'pin', x, y })}
        />
      </div>
      {isHost && (
        <div className="calc-access">
          <span className="calc-access-label">Students can edit</span>
          <button
            type="button"
            role="switch"
            aria-checked={studentsCanEdit}
            className={`calc-switch ${studentsCanEdit ? 'on' : ''}`}
            onClick={() => onToggleAccess?.(!studentsCanEdit)}
          >
            <span className="calc-switch-knob" />
          </button>
          <span className="calc-access-state">{studentsCanEdit ? 'On' : 'Off'}</span>
        </div>
      )}
    </div>
  )
}
