import { memo, useEffect, useRef, type ReactNode, type PointerEvent as ReactPointerEvent } from 'react'
import { useGesture } from '@use-gesture/react'
import { INK_COLORS, polyPoints, toPage, type Point, type PolyShape, type Shape } from '@tittel/board'
import { beginGesture, beginPan, selectionFrame, shapeAt, type Gesture, type PointerInfo } from './gestures.ts'
import { EditorContext, useBoardValue, useEditor } from './react.ts'
import { ShapeGraphic } from './ShapeGraphic.tsx'
import type { BoardEditor, BoardTool } from './editor.ts'

const ShapeNode = memo(function ShapeNode({ id }: { id: string }) {
  const editor = useEditor()
  const shape = useBoardValue(editor, () => editor.getShape(id), Object.is)
  return shape ? <ShapeGraphic shape={shape} /> : null
})

function Shapes() {
  const editor = useEditor()
  const camera = useBoardValue(editor, () => editor.getCamera(), Object.is)
  const ids = useBoardValue(editor, () => editor.getPageShapeIds(editor.getCurrentPageId()), Object.is)
  return (
    <svg className="board-svg" aria-hidden="true">
      <g transform={`scale(${camera.z}) translate(${camera.x} ${camera.y})`}>
        {ids.map((id) => (
          <ShapeNode key={id} id={id} />
        ))}
      </g>
    </svg>
  )
}

const RESIZE_HANDLES: { id: string; at: (c: Point[]) => Point }[] = [
  { id: 'nw', at: (c) => c[0] },
  { id: 'ne', at: (c) => c[1] },
  { id: 'se', at: (c) => c[2] },
  { id: 'sw', at: (c) => c[3] },
  { id: 'n', at: (c) => mid(c[0], c[1]) },
  { id: 'e', at: (c) => mid(c[1], c[2]) },
  { id: 's', at: (c) => mid(c[2], c[3]) },
  { id: 'w', at: (c) => mid(c[3], c[0]) },
]
const ROTATE_GAP = 26
const MAX_ZOOM_STEP = 30

const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })

function SelectionLayer() {
  const editor = useEditor()
  const view = useBoardValue(editor, () => {
    const frame = selectionFrame(editor)
    const marquee = editor.getMarquee()
    const lone = frame?.lone
    const isLine = lone?.type === 'line' || lone?.type === 'arrow'
    return {
      corners: !isLine ? frame?.corners.map((c) => editor.pageToScreen(c)) : undefined,
      vertices: isLine ? polyPoints(lone as PolyShape).map((p) => editor.pageToScreen(toPage(lone as Shape, p))) : undefined,
      marquee: marquee && {
        ...editor.pageToScreen(marquee),
        w: marquee.w * editor.getCamera().z,
        h: marquee.h * editor.getCamera().z,
      },
    }
  })
  const { corners, vertices, marquee } = view
  const top = corners && mid(corners[0], corners[1])
  const center = corners && mid(corners[0], corners[2])
  const reach = top && center && Math.hypot(top.x - center.x, top.y - center.y)
  const rotate =
    top && center && reach
      ? { x: top.x + ((top.x - center.x) / reach) * ROTATE_GAP, y: top.y + ((top.y - center.y) / reach) * ROTATE_GAP }
      : top && { x: top.x, y: top.y - ROTATE_GAP }

  return (
    <svg className="board-svg board-selection">
      {marquee && <rect className="board-marquee" x={marquee.x} y={marquee.y} width={marquee.w} height={marquee.h} />}
      {corners && <polygon className="board-frame" points={corners.map((c) => `${c.x},${c.y}`).join(' ')} />}
      {corners &&
        RESIZE_HANDLES.map(({ id, at }) => {
          const p = at(corners)
          return <rect key={id} className={`board-handle ${id}`} data-handle={id} x={p.x - 5} y={p.y - 5} width={10} height={10} rx={2} />
        })}
      {rotate && <circle className="board-handle rotate" data-handle="rotate" cx={rotate.x} cy={rotate.y} r={6} />}
      {vertices?.map((p, i) => (
        <circle key={i} className="board-handle" data-handle={`vertex:${i}`} cx={p.x} cy={p.y} r={6} />
      ))}
    </svg>
  )
}

function Cursors() {
  const editor = useEditor()
  const cursors = useBoardValue(editor, () =>
    editor
      .getCollaborators()
      .filter((c) => c.cursor?.page === editor.getCurrentPageId())
      .map((c) => ({ id: c.clientId, name: c.userName, color: c.color, at: editor.pageToScreen(c.cursor!) })),
  )
  return (
    <>
      {cursors.map((c) => (
        <div key={c.id} className="board-cursor" style={{ transform: `translate(${c.at.x}px, ${c.at.y}px)` }}>
          <svg width="14" height="18" viewBox="0 0 14 18" aria-hidden="true">
            <path d="M1 1l11 9H6.5L3 16z" fill={c.color} stroke="#fff" strokeWidth="1" />
          </svg>
          <span style={{ background: c.color }}>{c.name}</span>
        </div>
      ))}
    </>
  )
}

function TextEditor() {
  const editor = useEditor()
  const editing = useBoardValue(editor, () => editor.getEditing(), Object.is)
  const at = useBoardValue(editor, () => (editing ? editor.pageToScreen(editing.at) : null))
  const z = useBoardValue(editor, () => editor.getCamera().z)
  if (!editing || !at) return null
  const lines = editing.text.split('\n')
  return (
    <textarea
      className="board-text-input"
      autoFocus
      value={editing.text}
      rows={lines.length}
      cols={Math.max(4, ...lines.map((l) => l.length + 1))}
      spellCheck={false}
      style={{ left: at.x, top: at.y, fontSize: editing.fontSize * z, color: INK_COLORS[editing.color].solid }}
      onChange={(e) => editor.setEditingText(e.target.value)}
      onBlur={() => editor.commitText()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
          editor.commitText()
          editor.setCurrentTool('select')
        }
      }}
    />
  )
}

const TOOL_KEYS: Record<string, BoardTool> = {
  v: 'select', h: 'hand', d: 'draw', b: 'draw', x: 'draw', e: 'eraser', s: 'shape-ink', l: 'line', a: 'arrow', t: 'text',
}

function isTyping(target: EventTarget | null) {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
}

function useKeyboard(editor: BoardEditor, spaceHeld: { current: boolean }) {
  useEffect(() => {
    const zoomBy = (factor: number) => {
      const rect = editor.getContainer().getBoundingClientRect()
      editor.zoomAt({ x: rect.width / 2, y: rect.height / 2 }, editor.getCamera().z * factor)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return
      if (e.key === ' ') {
        spaceHeld.current = true
        e.preventDefault()
        return
      }
      const accel = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()
      if (accel && (key === '=' || key === '+')) zoomBy(1.25)
      else if (accel && key === '-') zoomBy(0.8)
      else if (accel && key === '0') editor.setCamera({ ...editor.getCamera(), z: 1 })
      else if (editor.isReadonly()) return
      else if (accel && key === 'z') e.shiftKey ? editor.doc.redo() : editor.doc.undo()
      else if (accel && key === 'y') editor.doc.redo()
      else if (accel && key === 'a') editor.selectAll()
      else if (accel && key === 'd') editor.duplicateSelection()
      else if (accel || e.altKey) return
      else if (key === 'delete' || key === 'backspace') editor.deleteSelection()
      else if (key === 'escape') {
        editor.select([])
        editor.setCurrentTool('select')
      } else if (e.shiftKey && key === 'd') editor.setCurrentTool('highlight')
      else if (!e.shiftKey && TOOL_KEYS[key]) editor.setCurrentTool(TOOL_KEYS[key])
      else return
      e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') spaceHeld.current = false
    }
    const onCopy = (e: ClipboardEvent) => {
      if (!isTyping(e.target) && e.clipboardData && editor.copySelection(e.clipboardData)) e.preventDefault()
    }
    const onCut = (e: ClipboardEvent) => {
      if (editor.isReadonly() || isTyping(e.target) || !e.clipboardData) return
      if (editor.copySelection(e.clipboardData)) {
        e.preventDefault()
        editor.deleteSelection()
      }
    }
    const onPaste = (e: ClipboardEvent) => {
      if (editor.isReadonly() || isTyping(e.target) || !e.clipboardData) return
      if (editor.paste(e.clipboardData)) e.preventDefault()
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    document.addEventListener('copy', onCopy)
    document.addEventListener('cut', onCut)
    document.addEventListener('paste', onPaste)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      document.removeEventListener('copy', onCopy)
      document.removeEventListener('cut', onCut)
      document.removeEventListener('paste', onPaste)
    }
  }, [editor, spaceHeld])
}

function Surface({ editor }: { editor: BoardEditor }) {
  const surface = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const spaceHeld = useRef(false)
  const touches = useRef(new Set<number>())
  useKeyboard(editor, spaceHeld)

  useEffect(() => {
    editor.setContainer(surface.current)
    return () => editor.setContainer(null)
  }, [editor])

  const infoFrom = (e: { clientX: number; clientY: number; pressure: number; pointerType: string; shiftKey: boolean }, handle: string | null = null): PointerInfo => {
    const rect = surface.current!.getBoundingClientRect()
    const screen = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    return {
      screen,
      page: editor.screenToPage(screen),
      pressure: e.pressure || 0.5,
      isPen: e.pointerType === 'pen',
      shift: e.shiftKey,
      handle,
    }
  }

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType === 'pen') editor.penMode = true
    if (e.pointerType === 'touch') {
      touches.current.add(e.pointerId)
      // A second finger is a pinch: whatever the first one began was not a stroke.
      if (touches.current.size > 1) {
        gesture.current?.cancel()
        gesture.current = null
        return
      }
    }
    const pan = e.button === 1 || spaceHeld.current || (e.pointerType === 'touch' && editor.penMode)
    if (e.button !== 0 && !pan) return
    surface.current!.setPointerCapture(e.pointerId)
    const handle = (e.target as Element).getAttribute('data-handle')
    const info = infoFrom(e.nativeEvent, handle)
    gesture.current = pan ? beginPan(editor, info) : beginGesture(editor, info)
    e.preventDefault()
  }

  const onPointerMove = (e: ReactPointerEvent) => {
    const native = e.nativeEvent
    const info = infoFrom(native)
    editor.setCursor(info.page)
    const coalesced = native.getCoalescedEvents?.() ?? []
    gesture.current?.move(info, coalesced.length > 0 ? coalesced.map((c) => infoFrom(c)) : [info])
  }

  const onPointerUp = (e: ReactPointerEvent) => {
    touches.current.delete(e.pointerId)
    gesture.current?.up(infoFrom(e.nativeEvent))
    gesture.current = null
  }

  const onPointerCancel = (e: ReactPointerEvent) => {
    touches.current.delete(e.pointerId)
    gesture.current?.cancel()
    gesture.current = null
  }

  const onDoubleClick = (e: React.MouseEvent) => {
    const rect = surface.current!.getBoundingClientRect()
    const hit = shapeAt(editor, editor.screenToPage({ x: e.clientX - rect.left, y: e.clientY - rect.top }))
    if (hit?.type === 'text' && !editor.isReadonly()) editor.editText(hit)
  }

  useGesture(
    {
      onWheel: ({ event, delta: [dx, dy] }) => {
        event.preventDefault()
        if (editor.isCameraLocked()) return
        const camera = editor.getCamera()
        if (event.ctrlKey || event.metaKey) {
          // Both a mouse wheel and a trackpad pinch arrive here. Capping the step
          // keeps a wheel notch (about 100) gentle without slowing a pinch (1-5).
          const rect = surface.current!.getBoundingClientRect()
          const step = Math.max(-MAX_ZOOM_STEP, Math.min(MAX_ZOOM_STEP, dy))
          editor.zoomAt({ x: event.clientX - rect.left, y: event.clientY - rect.top }, camera.z * Math.exp(-step / 100))
        } else {
          editor.setCamera({ ...camera, x: camera.x - dx / camera.z, y: camera.y - dy / camera.z })
        }
      },
      // Keeps the page point under the fingers there, so a pinch also pans.
      onPinch: ({ event, first, origin: [ox, oy], offset: [scale], memo }) => {
        event.preventDefault()
        if (editor.isCameraLocked()) return memo
        const rect = surface.current!.getBoundingClientRect()
        const screen = { x: ox - rect.left, y: oy - rect.top }
        const keep: Point = first ? editor.screenToPage(screen) : memo
        editor.zoomAt(screen, scale, keep)
        return keep
      },
    },
    {
      target: surface,
      eventOptions: { passive: false },
      pinch: { from: () => [editor.getCamera().z, 0], scaleBounds: { min: 0.1, max: 8 }, rubberband: false, pinchOnWheel: false },
    },
  )

  const tool = useBoardValue(editor, () => editor.getCurrentToolId())

  return (
    <div
      ref={surface}
      className={`board-surface tool-${tool}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onDoubleClick={onDoubleClick}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        if (editor.isReadonly()) return
        const rect = surface.current!.getBoundingClientRect()
        void editor.insertFiles([...e.dataTransfer.files], editor.screenToPage({ x: e.clientX - rect.left, y: e.clientY - rect.top }))
      }}
    >
      <Shapes />
      <SelectionLayer />
    </div>
  )
}

/** The board: the drawing surface plus whatever floats over it. */
export function Canvas({ editor, children }: { editor: BoardEditor; children?: ReactNode }) {
  return (
    <EditorContext.Provider value={editor}>
      <div className="board-canvas">
        <Surface editor={editor} />
        <Cursors />
        <TextEditor />
        {children}
      </div>
    </EditorContext.Provider>
  )
}
