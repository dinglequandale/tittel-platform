import { STROKE_WIDTHS, type InkShape, type PolyShape, type Shape } from './schema.ts'

// Pure geometry on shapes: bounds, hit testing and the maths behind resizing and
// rotating. A shape's local space has its origin at (x, y) and turns with it.

export interface Point {
  x: number
  y: number
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

const rotate = (p: Point, t: number): Point => ({
  x: p.x * Math.cos(t) - p.y * Math.sin(t),
  y: p.x * Math.sin(t) + p.y * Math.cos(t),
})

export function toPage(shape: Shape, p: Point): Point {
  const r = rotate(p, shape.rotation)
  return { x: r.x + shape.x, y: r.y + shape.y }
}

export function toLocal(shape: Shape, p: Point): Point {
  return rotate({ x: p.x - shape.x, y: p.y - shape.y }, -shape.rotation)
}

/** An ink shape's points after its resize factors, as local x, y pairs. */
export function inkPoints(shape: InkShape): Point[] {
  const out: Point[] = []
  for (let i = 0; i < shape.points.length; i += 3) {
    out.push({ x: shape.points[i] * shape.sx, y: shape.points[i + 1] * shape.sy })
  }
  return out
}

export function polyPoints(shape: PolyShape): Point[] {
  const out: Point[] = []
  for (let i = 0; i < shape.vertices.length; i += 2) out.push({ x: shape.vertices[i], y: shape.vertices[i + 1] })
  return out
}

function boxOf(points: Point[]): Box {
  if (points.length === 0) return { x: 0, y: 0, w: 0, h: 0 }
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

/** The shape's box in its own local space. */
export function localBox(shape: Shape): Box {
  switch (shape.type) {
    case 'ink':
    case 'highlight':
      return boxOf(inkPoints(shape))
    case 'line':
    case 'arrow':
      return boxOf(polyPoints(shape))
    default:
      return { x: 0, y: 0, w: shape.w, h: shape.h }
  }
}

export function boxCorners(b: Box): Point[] {
  return [
    { x: b.x, y: b.y },
    { x: b.x + b.w, y: b.y },
    { x: b.x + b.w, y: b.y + b.h },
    { x: b.x, y: b.y + b.h },
  ]
}

/** Axis-aligned bounds on the page. */
export function pageBounds(shape: Shape): Box {
  return boxOf(boxCorners(localBox(shape)).map((c) => toPage(shape, c)))
}

export function unionBounds(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null
  return boxOf(boxes.flatMap(boxCorners))
}

function distanceToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len = dx * dx + dy * dy
  const t = len === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len))
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t))
}

function distanceToPath(p: Point, points: Point[], closed: boolean) {
  if (points.length === 1) return Math.hypot(p.x - points[0].x, p.y - points[0].y)
  let best = Infinity
  for (let i = 1; i < points.length; i++) best = Math.min(best, distanceToSegment(p, points[i - 1], points[i]))
  if (closed) best = Math.min(best, distanceToSegment(p, points[points.length - 1], points[0]))
  return best
}

function inBox(p: Point, b: Box, margin = 0) {
  return p.x >= b.x - margin && p.y >= b.y - margin && p.x <= b.x + b.w + margin && p.y <= b.y + b.h + margin
}

/** Whether a page point touches the shape, within `tolerance` page units of its ink. */
export function hitTest(shape: Shape, point: Point, tolerance: number): boolean {
  const p = toLocal(shape, point)
  const local = localBox(shape)
  switch (shape.type) {
    case 'ink':
    case 'highlight': {
      const reach = tolerance + STROKE_WIDTHS[shape.size] * (shape.type === 'highlight' ? 3 : 0.75)
      return inBox(p, local, reach) && distanceToPath(p, inkPoints(shape), false) <= reach
    }
    case 'line':
    case 'arrow': {
      const reach = tolerance + STROKE_WIDTHS[shape.size] / 2
      return distanceToPath(p, polyPoints(shape), shape.closed) <= reach
    }
    case 'rect': {
      const reach = tolerance + STROKE_WIDTHS[shape.size] / 2
      if (shape.fill && inBox(p, local)) return true
      return distanceToPath(p, boxCorners(local), true) <= reach
    }
    case 'ellipse': {
      const reach = tolerance + STROKE_WIDTHS[shape.size] / 2
      const rx = shape.w / 2
      const ry = shape.h / 2
      if (rx === 0 || ry === 0) return false
      const dx = p.x - rx
      const dy = p.y - ry
      const r = Math.hypot(dx / rx, dy / ry)
      if (shape.fill && r <= 1) return true
      return r !== 0 && Math.hypot(dx, dy) * Math.abs(1 - 1 / r) <= reach
    }
    default:
      return inBox(p, local, tolerance)
  }
}

/** Points along the shape's ink, on the page: what a marquee has to catch. */
function outline(shape: Shape): Point[] {
  switch (shape.type) {
    case 'ink':
    case 'highlight':
      return inkPoints(shape).map((p) => toPage(shape, p))
    case 'line':
    case 'arrow':
      return polyPoints(shape).map((p) => toPage(shape, p))
    default:
      return boxCorners(localBox(shape)).map((p) => toPage(shape, p))
  }
}

export function touchesMarquee(shape: Shape, marquee: Box) {
  return outline(shape).some((p) => inBox(p, marquee))
}

/** The patch that scales a shape about its own origin. */
function scalePatch(shape: Shape, sx: number, sy: number): Partial<Shape> {
  switch (shape.type) {
    case 'ink':
    case 'highlight':
      return { sx: shape.sx * sx, sy: shape.sy * sy } as Partial<Shape>
    case 'line':
    case 'arrow':
      return { vertices: shape.vertices.map((v, i) => v * (i % 2 ? sy : sx)) } as Partial<Shape>
    case 'text':
      return { w: shape.w * sx, h: shape.h * sy, fontSize: shape.fontSize * Math.sqrt(sx * sy) } as Partial<Shape>
    default:
      return { w: shape.w * sx, h: shape.h * sy } as Partial<Shape>
  }
}

/** Resizes one shape so that its local box `from` becomes `to`. */
export function resizeShape(shape: Shape, from: Box, to: Box): Partial<Shape> {
  const sx = from.w === 0 ? 1 : to.w / from.w
  const sy = from.h === 0 ? 1 : to.h / from.h
  const origin = toPage(shape, { x: to.x - from.x * sx, y: to.y - from.y * sy })
  return { ...scalePatch(shape, sx, sy), x: origin.x, y: origin.y }
}

/** Scales a shape about a page point, the way a multiple selection resizes. */
export function scaleAbout(shape: Shape, scale: number, anchor: Point): Partial<Shape> {
  return {
    ...scalePatch(shape, scale, scale),
    x: anchor.x + (shape.x - anchor.x) * scale,
    y: anchor.y + (shape.y - anchor.y) * scale,
  }
}

export function rotateAbout(shape: Shape, angle: number, center: Point): Partial<Shape> {
  const r = rotate({ x: shape.x - center.x, y: shape.y - center.y }, angle)
  return { x: center.x + r.x, y: center.y + r.y, rotation: shape.rotation + angle }
}

/** Moves one vertex of a line to a page point. */
export function moveVertex(shape: PolyShape, index: number, point: Point): Partial<PolyShape> {
  const p = toLocal(shape, point)
  const vertices = [...shape.vertices]
  vertices[index * 2] = p.x
  vertices[index * 2 + 1] = p.y
  return { vertices }
}
