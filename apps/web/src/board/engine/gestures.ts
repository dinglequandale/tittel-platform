import { recognise, type Recognition } from '@tittel/ink'
import {
  boxCorners,
  hitTest,
  inkPoints,
  localBox,
  moveVertex,
  pageBounds,
  resizeShape,
  rotateAbout,
  scaleAbout,
  toLocal,
  toPage,
  touchesMarquee,
  type Box,
  type InkShape,
  type NewShape,
  type Point,
  type PolyShape,
  type Shape,
} from '@tittel/board'
import { newId, selectionBounds, type BoardEditor } from './editor.ts'

// What a pointer does between press and release, one function per tool. Each
// gesture marks an undo step when it starts, so it undoes as a whole.

export interface PointerInfo {
  page: Point
  screen: Point
  pressure: number
  isPen: boolean
  shift: boolean
  /** The selection handle under the pointer, from its `data-handle`. */
  handle: string | null
}

export interface Gesture {
  /** `points` holds every position since the last move, for strokes. */
  move(info: PointerInfo, points: PointerInfo[]): void
  up(info: PointerInfo): void
  cancel(): void
}

/** Screen pixels of slop when picking a shape, and of drag before a click becomes a move. */
const HIT_TOLERANCE_PX = 6
const DRAG_PX = 4
/** Below this on screen a stroke is a tick or a dot, whatever its shape. */
const MIN_STROKE_PX = 20
const MIN_LINE_PX = 4
const MIN_BOX = 4
const SNAP_ANGLE = Math.PI / 12

const round = (n: number) => Math.round(n * 100) / 100

export function shapeAt(editor: BoardEditor, point: Point): Shape | null {
  const tolerance = HIT_TOLERANCE_PX / editor.getCamera().z
  const shapes = editor.getCurrentPageShapes()
  for (let i = shapes.length - 1; i >= 0; i--) {
    if (!shapes[i].locked && hitTest(shapes[i], point, tolerance)) return shapes[i]
  }
  return null
}

export function beginGesture(editor: BoardEditor, info: PointerInfo): Gesture | null {
  switch (editor.getCurrentToolId()) {
    case 'draw':
      return beginInk(editor, info, 'ink', false)
    case 'highlight':
      return beginInk(editor, info, 'highlight', false)
    case 'shape-ink':
      return beginInk(editor, info, 'ink', true)
    case 'eraser':
      return beginEraser(editor, info)
    case 'line':
    case 'arrow':
      return beginLine(editor, info, editor.getCurrentToolId() as 'line' | 'arrow')
    case 'text':
      beginText(editor, info)
      return null
    case 'hand':
      return beginPan(editor, info)
    default:
      return beginSelect(editor, info)
  }
}

export function beginPan(editor: BoardEditor, info: PointerInfo): Gesture | null {
  if (editor.isCameraLocked()) return null
  const start = editor.getCamera()
  return {
    move(now) {
      editor.setCamera({
        ...start,
        x: start.x + (now.screen.x - info.screen.x) / start.z,
        y: start.y + (now.screen.y - info.screen.y) / start.z,
      })
    },
    up() {},
    cancel() {
      editor.setCamera(start)
    },
  }
}

// ---- ink ----------------------------------------------------------------

function beginInk(editor: BoardEditor, info: PointerInfo, type: 'ink' | 'highlight', recogniseOnFinish: boolean): Gesture {
  const { doc } = editor
  const id = newId()
  const { x, y } = info.page
  const minStep = 0.5 / editor.getCamera().z
  let last = info.page
  doc.mark()
  doc.createShape({
    ...editor.getStyle(),
    id,
    page: editor.getCurrentPageId(),
    type,
    x,
    y,
    points: [0, 0, round(info.pressure)],
    sx: 1,
    sy: 1,
    pen: info.isPen,
    done: false,
  })
  return {
    move(_now, points) {
      const added: number[] = []
      for (const p of points) {
        if (Math.hypot(p.page.x - last.x, p.page.y - last.y) < minStep) continue
        last = p.page
        added.push(round(p.page.x - x), round(p.page.y - y), round(p.pressure))
      }
      if (added.length > 0) doc.appendPoints(id, added)
    },
    up() {
      doc.updateShape(id, { done: true })
      if (recogniseOnFinish) replaceWithShape(editor, id)
    },
    cancel() {
      doc.deleteShapes([id])
    },
  }
}

/**
 * Swaps a finished stroke for the shape it reads as, if any. Only the Shape tool
 * comes here, so the normal pen can't touch mathematical writing. The mark
 * separates this from the stroke: one undo brings the ink back.
 */
function replaceWithShape(editor: BoardEditor, id: string) {
  const { doc } = editor
  const ink = doc.getShape(id) as InkShape
  const recognised = recognise(inkPoints(ink).map((p) => toPage(ink, p)), {
    minSize: MIN_STROKE_PX / editor.getCamera().z,
  })
  if (recognised.kind === 'none') return
  doc.mark()
  doc.transact(() => {
    doc.deleteShapes([id])
    doc.createShape(shapeFor(recognised, ink))
  })
}

function shapeFor(recognised: Exclude<Recognition, { kind: 'none' }>, ink: InkShape): NewShape {
  const { color, size, dash, opacity, page } = ink
  const common = { id: newId(), color, size, dash, opacity, page }
  /** Shapes turn about their top-left corner, so work that corner back from the centre. */
  const box = (type: 'rect' | 'ellipse', center: Point, w: number, h: number, rotation: number) => ({
    ...common,
    type,
    w,
    h,
    rotation,
    fill: false,
    x: center.x - (w / 2) * Math.cos(rotation) + (h / 2) * Math.sin(rotation),
    y: center.y - (w / 2) * Math.sin(rotation) - (h / 2) * Math.cos(rotation),
  })

  switch (recognised.kind) {
    case 'line': {
      const { a, b } = recognised
      return { ...common, type: 'line', x: a.x, y: a.y, vertices: [0, 0, b.x - a.x, b.y - a.y], closed: false }
    }
    case 'triangle': {
      const [a, b, c] = recognised.vertices
      return { ...common, type: 'line', x: a.x, y: a.y, vertices: [0, 0, b.x - a.x, b.y - a.y, c.x - a.x, c.y - a.y], closed: true }
    }
    case 'circle':
      return box('ellipse', recognised.center, recognised.radius * 2, recognised.radius * 2, 0)
    case 'ellipse':
      return box('ellipse', recognised.center, recognised.rx * 2, recognised.ry * 2, recognised.angle)
    case 'rectangle':
      return box('rect', recognised.center, recognised.width, recognised.height, recognised.angle)
  }
}

function beginEraser(editor: BoardEditor, info: PointerInfo): Gesture {
  const { doc } = editor
  const tolerance = HIT_TOLERANCE_PX / editor.getCamera().z
  let last = info.page
  doc.mark()

  const eraseAlong = (to: Point) => {
    // A fast pointer jumps, so test along the path rather than only at its ends.
    const steps = Math.max(1, Math.ceil(Math.hypot(to.x - last.x, to.y - last.y) / tolerance))
    const shapes = editor.getCurrentPageShapes().filter((s) => !s.locked)
    const hits = new Set<string>()
    for (let i = 1; i <= steps; i++) {
      const p = { x: last.x + ((to.x - last.x) * i) / steps, y: last.y + ((to.y - last.y) * i) / steps }
      for (const shape of shapes) if (hitTest(shape, p, tolerance)) hits.add(shape.id)
    }
    last = to
    if (hits.size > 0) doc.deleteShapes([...hits])
  }

  eraseAlong(info.page)
  return { move: (now) => eraseAlong(now.page), up() {}, cancel() {} }
}

function beginLine(editor: BoardEditor, info: PointerInfo, type: 'line' | 'arrow'): Gesture {
  const { doc } = editor
  const id = newId()
  const start = info.page
  const { color, size, dash } = editor.getStyle()
  doc.mark()
  doc.createShape({ id, page: editor.getCurrentPageId(), type, color, size, dash, x: start.x, y: start.y, vertices: [0, 0, 0, 0], closed: false })
  let end: Point = { x: 0, y: 0 }
  return {
    move(now) {
      let dx = now.page.x - start.x
      let dy = now.page.y - start.y
      if (now.shift) {
        const angle = Math.round(Math.atan2(dy, dx) / SNAP_ANGLE) * SNAP_ANGLE
        const length = Math.hypot(dx, dy)
        dx = length * Math.cos(angle)
        dy = length * Math.sin(angle)
      }
      end = { x: dx, y: dy }
      doc.updateShape(id, { vertices: [0, 0, dx, dy] })
    },
    up() {
      if (Math.hypot(end.x, end.y) * editor.getCamera().z < MIN_LINE_PX) {
        doc.deleteShapes([id])
        return
      }
      editor.setCurrentTool('select')
      editor.select([id])
    },
    cancel() {
      doc.deleteShapes([id])
    },
  }
}

function beginText(editor: BoardEditor, info: PointerInfo) {
  if (editor.getEditing()) {
    editor.commitText()
    editor.setCurrentTool('select')
    return
  }
  const hit = shapeAt(editor, info.page)
  editor.editText(hit?.type === 'text' ? hit : info.page)
}

// ---- selection ----------------------------------------------------------

/** The box the handles sit on: a lone shape's own turned box, or the selection's bounds. */
export function selectionFrame(editor: BoardEditor): { corners: Point[]; lone: Shape | null } | null {
  const selected = editor.getSelectedShapes()
  if (selected.length === 0) return null
  if (selected.length === 1) {
    const [shape] = selected
    return { corners: boxCorners(localBox(shape)).map((c) => toPage(shape, c)), lone: shape }
  }
  return { corners: boxCorners(selectionBounds(editor)!), lone: null }
}

function insideFrame(editor: BoardEditor, p: Point) {
  const selected = editor.getSelectedShapes()
  if (selected.length === 1) {
    const [shape] = selected
    if (shape.type === 'line' || shape.type === 'arrow') return false
    const local = toLocal(shape, p)
    const box = localBox(shape)
    return local.x >= box.x && local.y >= box.y && local.x <= box.x + box.w && local.y <= box.y + box.h
  }
  const box = selectionBounds(editor)
  return !!box && p.x >= box.x && p.y >= box.y && p.x <= box.x + box.w && p.y <= box.y + box.h
}

function beginSelect(editor: BoardEditor, info: PointerInfo): Gesture | null {
  if (editor.getEditing()) editor.commitText()
  if (info.handle) return beginHandle(editor, info, info.handle)

  const hit = shapeAt(editor, info.page)
  if (hit && info.shift) {
    const ids = editor.getSelectedIds()
    editor.select(ids.includes(hit.id) ? ids.filter((id) => id !== hit.id) : [...ids, hit.id])
    return null
  }
  if (hit && !editor.getSelectedIds().includes(hit.id) && !insideFrame(editor, info.page)) editor.select([hit.id])
  if (hit || insideFrame(editor, info.page)) return beginMove(editor, info)

  if (!info.shift) editor.select([])
  return beginMarquee(editor, info)
}

function beginMove(editor: BoardEditor, info: PointerInfo): Gesture {
  const { doc } = editor
  const start = editor.getSelectedShapes()
  const slop = DRAG_PX / editor.getCamera().z
  let moving = false
  return {
    move(now) {
      const dx = now.page.x - info.page.x
      const dy = now.page.y - info.page.y
      if (!moving) {
        if (Math.hypot(dx, dy) < slop) return
        moving = true
        doc.mark()
      }
      doc.transact(() => {
        for (const shape of start) doc.updateShape(shape.id, { x: shape.x + dx, y: shape.y + dy })
      })
    },
    up() {},
    cancel() {
      doc.transact(() => {
        for (const shape of start) doc.updateShape(shape.id, { x: shape.x, y: shape.y })
      })
    },
  }
}

function beginMarquee(editor: BoardEditor, info: PointerInfo): Gesture {
  const before = editor.getSelectedIds()
  return {
    move(now) {
      const box: Box = {
        x: Math.min(info.page.x, now.page.x),
        y: Math.min(info.page.y, now.page.y),
        w: Math.abs(now.page.x - info.page.x),
        h: Math.abs(now.page.y - info.page.y),
      }
      editor.setMarquee(box)
      const caught = editor.getCurrentPageShapes().filter((s) => !s.locked && touchesMarquee(s, box)).map((s) => s.id)
      editor.select([...new Set([...before, ...caught])])
    },
    up() {
      editor.setMarquee(null)
    },
    cancel() {
      editor.setMarquee(null)
      editor.select(before)
    },
  }
}

function beginHandle(editor: BoardEditor, info: PointerInfo, handle: string): Gesture | null {
  const { doc } = editor
  const start = editor.getSelectedShapes()
  const restore = () => {
    doc.transact(() => {
      for (const shape of start) doc.updateShape(shape.id, shape)
    })
  }
  doc.mark()

  const apply = (now: PointerInfo): void => {
    if (handle.startsWith('vertex:')) {
      const shape = start[0] as PolyShape
      doc.updateShape(shape.id, moveVertex(shape, Number(handle.slice(7)), now.page))
    } else if (handle === 'rotate') {
      rotateSelection(editor, start, info, now)
    } else if (start.length === 1) {
      resizeLone(editor, start[0], handle, now)
    } else {
      resizeMany(editor, start, handle, now)
    }
  }
  return { move: apply, up() {}, cancel: restore }
}

function rotateSelection(editor: BoardEditor, start: Shape[], from: PointerInfo, now: PointerInfo) {
  const corners = start.length === 1 ? boxCorners(localBox(start[0])).map((c) => toPage(start[0], c)) : boxCorners(boundsOf(start))
  const center = { x: (corners[0].x + corners[2].x) / 2, y: (corners[0].y + corners[2].y) / 2 }
  const angleOf = (p: Point) => Math.atan2(p.y - center.y, p.x - center.x)
  let delta = angleOf(now.page) - angleOf(from.page)
  if (now.shift) delta = Math.round(delta / SNAP_ANGLE) * SNAP_ANGLE
  editor.doc.transact(() => {
    for (const shape of start) editor.doc.updateShape(shape.id, rotateAbout(shape, delta, center))
  })
}

function boundsOf(shapes: Shape[]): Box {
  const boxes = shapes.map(pageBounds)
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  return { x, y, w: Math.max(...boxes.map((b) => b.x + b.w)) - x, h: Math.max(...boxes.map((b) => b.y + b.h)) - y }
}

/** `n`, `se` and so on: which sides of the box a handle moves. */
const sidesOf = (handle: string) => ({
  x: handle.includes('w') ? -1 : handle.includes('e') ? 1 : 0,
  y: handle.includes('n') ? -1 : handle.includes('s') ? 1 : 0,
})

function resizeLone(editor: BoardEditor, shape: Shape, handle: string, now: PointerInfo) {
  const from = localBox(shape)
  const sides = sidesOf(handle)
  const p = toLocal(shape, now.page)
  const right = from.x + from.w
  const bottom = from.y + from.h
  const to: Box = { ...from }
  if (sides.x < 0) to.x = Math.min(p.x, right - MIN_BOX)
  if (sides.x > 0) to.w = Math.max(MIN_BOX, p.x - from.x)
  if (sides.x < 0) to.w = right - to.x
  if (sides.y < 0) to.y = Math.min(p.y, bottom - MIN_BOX)
  if (sides.y > 0) to.h = Math.max(MIN_BOX, p.y - from.y)
  if (sides.y < 0) to.h = bottom - to.y

  // Images and text have proportions to keep; everything else does on request.
  if ((shape.type === 'image' || shape.type === 'text' || now.shift) && sides.x && sides.y) {
    const scale = Math.max(to.w / from.w, to.h / from.h)
    to.w = from.w * scale
    to.h = from.h * scale
    if (sides.x < 0) to.x = right - to.w
    if (sides.y < 0) to.y = bottom - to.h
  }
  editor.doc.updateShape(shape.id, resizeShape(shape, from, to))
}

function resizeMany(editor: BoardEditor, start: Shape[], handle: string, now: PointerInfo) {
  const frame = boundsOf(start)
  const sides = sidesOf(handle)
  // The side opposite the handle stays put. Shapes can be turned, so only an
  // even scale keeps them true.
  const anchor = {
    x: sides.x < 0 ? frame.x + frame.w : sides.x > 0 ? frame.x : frame.x + frame.w / 2,
    y: sides.y < 0 ? frame.y + frame.h : sides.y > 0 ? frame.y : frame.y + frame.h / 2,
  }
  const scales: number[] = []
  if (sides.x) scales.push(Math.abs(now.page.x - anchor.x) / frame.w)
  if (sides.y) scales.push(Math.abs(now.page.y - anchor.y) / frame.h)
  const scale = Math.max(0.05, ...scales)
  editor.doc.transact(() => {
    for (const shape of start) editor.doc.updateShape(shape.id, scaleAbout(shape, scale, anchor))
  })
}
