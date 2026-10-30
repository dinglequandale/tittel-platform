// Recognises one pen stroke as a simple shape, by geometry rather than templates.
// A stroke is either open (only a line can match) or closed (ellipse, rectangle
// or triangle can match). Each candidate is fitted and scored by its distance
// from the ink, and the best one wins if it clears the confidence threshold.
// No engine imports: this has to outlive the move away from tldraw.

export interface Point {
  x: number
  y: number
}

/** `angle` is in radians, in (-45°, 45°]. `rx`/`width` run along it, so neither is necessarily the longer. */
export type Recognition =
  | { kind: 'line'; a: Point; b: Point; confidence: number }
  | { kind: 'circle'; center: Point; radius: number; confidence: number }
  | { kind: 'ellipse'; center: Point; rx: number; ry: number; angle: number; confidence: number }
  | { kind: 'rectangle'; center: Point; width: number; height: number; angle: number; confidence: number }
  | { kind: 'triangle'; vertices: [Point, Point, Point]; confidence: number }
  | { kind: 'none' }

export interface RecogniseOptions {
  /** Below this confidence (0–1) the stroke is left alone. */
  minConfidence?: number
  /** Strokes whose bounding-box diagonal is under this, in the points' own units, never match. */
  minSize?: number
}

type Shape = Exclude<Recognition, { kind: 'none' }>

const NONE: Recognition = { kind: 'none' }

const DEG = Math.PI / 180
const SAMPLES = 128 // uniform points along a stroke, so drawing speed doesn't weight the fit
const MIN_INPUT_POINTS = 3
const DEFAULT_MIN_CONFIDENCE = 0.5

// Closedness: how much overshoot may be trimmed from each end, and how wide the
// remaining gap may be (relative to the path, and to the shape's narrow side, so
// a tall U doesn't count as closed).
const MAX_TRIM = 0.1
const MAX_GAP_OF_LENGTH = 0.12
const MAX_GAP_OF_MINOR = 0.35

// Every shape we recognise is convex and winds once. Anything that turns much
// more than one full circle is writing.
const MAX_TURNING = 1.45 * 2 * Math.PI

// Fit scoring. Errors are divided by these limits, then confidence = 1 - ratio,
// so the default threshold accepts half of each limit.
const LINE_RMS = 0.05 // of the line's length
const LINE_MAX = 0.12
const SHAPE_RMS = 0.11 // of the square root of the enclosed area
const SHAPE_MAX = 0.3
const NARROW_RMS = 0.09 // of a narrow ellipse's minor radius
const STRAIGHTNESS = 0.9 // chord / path length

// Regularisation.
const CIRCLE_RATIO = 0.84 // minor/major axis at or above this is a circle
const AXIS_SNAP = 6 * DEG
const ELLIPSE_AXIS_SNAP = 8 * DEG
const RIGHT_ANGLE_SNAP = 8 * DEG
const RECTANGLE_CORNER_TOLERANCE = 22 * DEG

// Corner detection on the simplified path.
const SIMPLIFY_OF_SIZE = 0.05
const SIMPLIFY_OF_MINOR = 0.3
const MIN_EDGE_OF_PERIMETER = 0.09
const MIN_EDGE_OF_MINOR = 0.6 // a thin shape's short side is not a rounded corner
const MIN_CORNER_TURN = 28 * DEG
const MIN_TRIANGLE_ANGLE = 8 * DEG
const POLYGON_BEATS_ELLIPSE = 0.6 // a polygon we can't name this much closer than the ellipse means no match

export function recognise(input: readonly Point[], options: RecogniseOptions = {}): Recognition {
  const { minConfidence = DEFAULT_MIN_CONFIDENCE, minSize = 0 } = options
  const points = dedupe(input)
  if (points.length < MIN_INPUT_POINTS) return NONE

  const size = diagonal(points)
  if (size === 0 || size < minSize) return NONE

  const path = resample(points, SAMPLES, false)
  const line = fitLine(path)
  const candidate = line ?? recogniseClosed(path, size)
  return candidate && candidate.confidence >= minConfidence ? candidate : NONE
}

// ---- lines --------------------------------------------------------------

function fitLine(path: Point[]): Extract<Recognition, { kind: 'line' }> | null {
  const start = path[0]
  const end = path[path.length - 1]
  const chord = dist(start, end)
  if (chord === 0 || chord / pathLength(path) < STRAIGHTNESS) return null

  const { center, axis } = principalAxes(path)
  let lo = Infinity
  let hi = -Infinity
  let squares = 0
  let worst = 0
  // Pens hook at the very start and end of a stroke, so the ends don't count
  // towards the worst deviation.
  const margin = Math.floor(path.length * 0.05)
  path.forEach((p, i) => {
    const along = dot(sub(p, center), axis)
    const off = Math.abs(cross(sub(p, center), axis))
    lo = Math.min(lo, along)
    hi = Math.max(hi, along)
    squares += off * off
    if (i >= margin && i < path.length - margin) worst = Math.max(worst, off)
  })
  const rms = Math.sqrt(squares / path.length)
  const confidence = 1 - Math.max(rms / (LINE_RMS * chord), worst / (LINE_MAX * chord))

  const angle = snapToAxis(Math.atan2(axis.y, axis.x), AXIS_SNAP)
  const dir = { x: Math.cos(angle), y: Math.sin(angle) }
  const mid = add(center, scale(axis, (lo + hi) / 2))
  const half = (hi - lo) / 2
  return { kind: 'line', a: add(mid, scale(dir, -half)), b: add(mid, scale(dir, half)), confidence }
}

// ---- closed shapes ------------------------------------------------------

function recogniseClosed(path: Point[], size: number): Shape | null {
  const loop = closeLoop(path)
  if (!loop) return null

  const coarse = loop.filter((_, i) => i % 4 === 0)
  const { winding, total } = turning(coarse)
  if (Math.abs(winding) !== 1 || total > MAX_TURNING) return null

  const area = Math.abs(signedArea(loop))
  if (area === 0) return null
  const scaleRef = Math.sqrt(area)

  const ellipse = fitEllipseCandidate(loop, scaleRef)
  const polygon = fitPolygonCandidate(loop, size, scaleRef)

  if (polygon?.shape && (!ellipse || polygon.score < ellipse.score)) return polygon.shape
  if (polygon && !polygon.shape && ellipse && polygon.score < ellipse.score * POLYGON_BEATS_ELLIPSE) return null
  return ellipse?.shape ?? null
}

/**
 * Cuts the overshoot off a stroke that returns to its start, and returns the
 * closed loop as evenly spaced points; null if the stroke doesn't really close.
 */
function closeLoop(path: Point[]): Point[] | null {
  const window = Math.ceil(path.length * MAX_TRIM)
  let from = 0
  let to = path.length - 1
  let gap = Infinity
  for (let i = 0; i < window; i++) {
    for (let j = path.length - window; j < path.length; j++) {
      const d = dist(path[i], path[j])
      if (d < gap) {
        gap = d
        from = i
        to = j
      }
    }
  }
  const loop = path.slice(from, to + 1)
  const { minorExtent } = principalAxes(loop)
  if (gap > MAX_GAP_OF_LENGTH * pathLength(loop) || gap > MAX_GAP_OF_MINOR * minorExtent) return null
  return resample(loop, SAMPLES, true)
}

/** Signed turning of a closed polyline, in whole turns, plus the total absolute turning in radians. */
function turning(loop: Point[]) {
  let signed = 0
  let total = 0
  const n = loop.length
  for (let i = 0; i < n; i++) {
    const a = sub(loop[(i + 1) % n], loop[i])
    const b = sub(loop[(i + 2) % n], loop[(i + 1) % n])
    const delta = Math.atan2(cross(a, b), dot(a, b))
    signed += delta
    total += Math.abs(delta)
  }
  return { winding: Math.round(signed / (2 * Math.PI)), total }
}

interface Candidate {
  shape: Shape | null
  score: number // normalised error; lower is better, 1 is the limit
}

function shapeScore(residuals: number[], scaleRef: number) {
  return Math.max(rmsOf(residuals) / (SHAPE_RMS * scaleRef), Math.max(...residuals) / (SHAPE_MAX * scaleRef))
}

// ---- circle and ellipse -------------------------------------------------

function fitEllipseCandidate(loop: Point[], scaleRef: number): Candidate | null {
  const fit = fitConicEllipse(loop)
  if (!fit) return null
  const major = Math.max(fit.rx, fit.ry)
  const minor = Math.min(fit.rx, fit.ry)

  if (minor / major >= CIRCLE_RATIO) {
    const circle = fitCircle(loop)
    if (!circle) return null
    const score = shapeScore(
      loop.map((p) => Math.abs(dist(p, circle.center) - circle.radius)),
      scaleRef,
    )
    return { score, shape: { kind: 'circle', ...circle, confidence: 1 - score } }
  }

  const residuals = loop.map((p) => ellipseDistance(p, fit))
  // Narrow ovals are where handwriting lives (a 0 is one), and an error that is
  // small for the whole shape can be a pinched end, so judge them by their width.
  // (Very thin ovals with a shaky hand fall below the bar too, and stay as ink.)
  const narrow = rmsOf(residuals) / (NARROW_RMS * minor)
  const score = Math.max(shapeScore(residuals, scaleRef), narrow)
  const angle = snapToAxis(fit.angle, ELLIPSE_AXIS_SNAP)
  return { score, shape: { kind: 'ellipse', center: fit.center, rx: fit.rx, ry: fit.ry, angle, confidence: 1 - score } }
}

/** Kåsa's algebraic circle fit. */
function fitCircle(points: Point[]) {
  const origin = centroid(points)
  let sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0
  for (const p of points) {
    const { x, y } = sub(p, origin)
    const z = x * x + y * y
    sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z
  }
  const solved = solve3(
    [[sxx, sxy, sx], [sxy, syy, sy], [sx, sy, points.length]],
    [sxz, syz, sz],
  )
  if (!solved) return null
  const local = { x: solved[0] / 2, y: solved[1] / 2 }
  const radius = Math.sqrt(Math.max(0, solved[2] + local.x * local.x + local.y * local.y))
  return radius > 0 ? { center: add(origin, local), radius } : null
}

interface Ellipse {
  center: Point
  rx: number
  ry: number
  angle: number
}

/** Direct least-squares ellipse fit (Fitzgibbon, in Halíř and Flusser's stable form). */
function fitConicEllipse(points: Point[]): Ellipse | null {
  const { center } = principalAxes(points)
  const spread = Math.max(...points.map((p) => dist(p, center)))
  if (spread === 0) return null
  const local = points.map((p) => scale(sub(p, center), 1 / spread))

  const quad = zeros3()
  const mixed = zeros3()
  const linear = zeros3()
  for (const { x, y } of local) {
    const q = [x * x, x * y, y * y]
    const l = [x, y, 1]
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        quad[i][j] += q[i] * q[j]
        mixed[i][j] += q[i] * l[j]
        linear[i][j] += l[i] * l[j]
      }
    }
  }
  const linearInv = invert3(linear)
  if (!linearInv) return null
  const t = mul3(linearInv, transpose3(mixed)).map((row) => row.map((v) => -v))
  const reduced = mul3(mixed, t).map((row, i) => row.map((v, j) => v + quad[i][j]))
  // Multiplying by the inverse of the ellipse constraint matrix.
  const m = [reduced[2].map((v) => v / 2), reduced[1].map((v) => -v), reduced[0].map((v) => v / 2)]

  for (const lambda of eigenvalues3(m)) {
    const v = nullVector3(m, lambda)
    if (!v || 4 * v[0] * v[2] - v[1] * v[1] <= 0) continue
    const [a, b, c] = v
    const [d, e, f] = t.map((row) => row[0] * a + row[1] * b + row[2] * c)
    const fit = ellipseFromConic(a, b, c, d, e, f)
    if (!fit) continue
    return {
      center: add(center, scale(fit.center, spread)),
      rx: fit.rx * spread,
      ry: fit.ry * spread,
      angle: fit.angle,
    }
  }
  return null
}

function ellipseFromConic(a: number, b: number, c: number, d: number, e: number, f: number): Ellipse | null {
  if (a + c < 0) {
    a = -a; b = -b; c = -c; d = -d; e = -e; f = -f
  }
  const det = 4 * a * c - b * b
  if (det <= 0) return null
  const center = { x: (b * e - 2 * c * d) / det, y: (b * d - 2 * a * e) / det }
  const offset = a * center.x * center.x + b * center.x * center.y + c * center.y * center.y + d * center.x + e * center.y + f
  const mean = (a + c) / 2
  const spread = Math.hypot((a - c) / 2, b / 2)
  const small = mean - spread
  const large = mean + spread
  if (offset >= 0 || small <= 0) return null
  // The large eigenvalue's axis (at theta) is the short one; rx runs along the
  // long axis until normalise moves it into (-45°, 45°].
  const theta = Math.atan2(b, a - c) / 2
  return normaliseAxes({
    center,
    rx: Math.sqrt(-offset / small),
    ry: Math.sqrt(-offset / large),
    angle: theta + Math.PI / 2,
  })
}

/** Rewrites an ellipse so its angle lies in (-45°, 45°], swapping the radii to match. */
function normaliseAxes(e: Ellipse): Ellipse {
  const quarter = Math.round(e.angle / (Math.PI / 2))
  const angle = e.angle - quarter * (Math.PI / 2)
  return quarter % 2 === 0 ? { ...e, angle } : { ...e, angle, rx: e.ry, ry: e.rx }
}

/** Distance to an ellipse, approximated by scaling the point radially onto it. */
function ellipseDistance(p: Point, e: Ellipse) {
  const local = rotate(sub(p, e.center), -e.angle)
  const r = Math.hypot(local.x / e.rx, local.y / e.ry)
  return r === 0 ? Math.min(e.rx, e.ry) : Math.hypot(local.x, local.y) * Math.abs(1 - 1 / r)
}

// ---- rectangle and triangle ---------------------------------------------

function fitPolygonCandidate(loop: Point[], size: number, scaleRef: number): Candidate | null {
  const corners = detectCorners(loop, size)
  if (corners.length < 3) return null
  const edges = corners.map((c, i) => fitEdge(loop, c, corners[(i + 1) % corners.length]))
  if (edges.some((e) => !e)) return null
  const lines = edges as EdgeLine[]
  const vertices = lines.map((edge, i) => {
    const raw = loop[corners[(i + 1) % corners.length]]
    const hit = intersect(edge, lines[(i + 1) % lines.length])
    // Near-parallel edges meet far from the ink; the raw corner is the better guess.
    return hit && dist(hit, raw) < 0.15 * size ? hit : raw
  })

  if (vertices.length === 3) return triangleCandidate(loop, vertices as [Point, Point, Point], scaleRef)
  if (vertices.length === 4) return rectangleCandidate(loop, vertices, lines, scaleRef)
  return { shape: null, score: shapeScore(polygonResiduals(loop, vertices), scaleRef) }
}

/** Indices into `loop` of its corners, in order. */
function detectCorners(loop: Point[], size: number): number[] {
  const n = loop.length
  const { minorExtent } = principalAxes(loop)
  const tolerance = Math.min(SIMPLIFY_OF_SIZE * size, SIMPLIFY_OF_MINOR * minorExtent)

  // Split the loop at two far-apart points, which gives Douglas–Peucker two arcs
  // whose ends are true extremes rather than wherever the pen happened to start.
  const first = farthestFrom(loop, centroid(loop))
  const second = farthestFrom(loop, loop[first])
  const unrolled = [...loop.slice(first), ...loop.slice(0, first)]
  const split = (second - first + n) % n
  const kept = [
    ...douglasPeucker(unrolled, 0, split, tolerance),
    ...douglasPeucker([...unrolled, unrolled[0]], split, n, tolerance).filter((i) => i !== n),
  ]
  let corners = [...new Set(kept)].sort((a, b) => a - b).map((i) => (i + first) % n)

  const perimeter = pathLength([...loop, loop[0]])
  corners = mergeShortEdges(loop, corners, Math.min(MIN_EDGE_OF_PERIMETER * perimeter, MIN_EDGE_OF_MINOR * minorExtent))

  // Drop the flattest corner until the rest all turn: the pen's start point
  // lands mid-edge as a corner of almost zero turn.
  while (corners.length > 3) {
    const turns = corners.map((_, i) => cornerTurn(loop, corners, i))
    const least = Math.min(...turns)
    if (least >= MIN_CORNER_TURN) break
    corners.splice(turns.indexOf(least), 1)
  }
  return corners
}

function douglasPeucker(points: Point[], from: number, to: number, tolerance: number): number[] {
  let worst = -1
  let farthest = 0
  for (let i = from + 1; i < to; i++) {
    const d = distanceToSegment(points[i], points[from], points[to])
    if (d > farthest) {
      farthest = d
      worst = i
    }
  }
  if (worst === -1 || farthest <= tolerance) return [from, to]
  return [...douglasPeucker(points, from, worst, tolerance), ...douglasPeucker(points, worst, to, tolerance)]
}

/** A rounded corner simplifies to two close vertices; collapse them into one. */
function mergeShortEdges(loop: Point[], corners: number[], minEdge: number): number[] {
  const out = [...corners]
  let merged = true
  while (merged && out.length > 3) {
    merged = false
    for (let i = 0; i < out.length; i++) {
      const j = (i + 1) % out.length
      if (dist(loop[out[i]], loop[out[j]]) < minEdge) {
        const a = out[i]
        const b = out[j] < a ? out[j] + loop.length : out[j]
        out[i] = Math.round((a + b) / 2) % loop.length
        out.splice(j, 1)
        merged = true
        break
      }
    }
  }
  return out.sort((a, b) => a - b)
}

function cornerTurn(loop: Point[], corners: number[], i: number) {
  const n = corners.length
  const before = loop[corners[(i + n - 1) % n]]
  const at = loop[corners[i]]
  const after = loop[corners[(i + 1) % n]]
  const a = sub(at, before)
  const b = sub(after, at)
  return Math.abs(Math.atan2(cross(a, b), dot(a, b)))
}

interface EdgeLine {
  center: Point
  axis: Point
}

/** Fits a line to the middle of an edge, away from the corners' rounding. */
function fitEdge(loop: Point[], from: number, to: number): EdgeLine | null {
  const n = loop.length
  const span = (to - from + n) % n
  if (span < 4) return null
  const inner: Point[] = []
  for (let i = Math.ceil(span * 0.15); i <= Math.floor(span * 0.85); i++) inner.push(loop[(from + i) % n])
  const { center, axis } = principalAxes(inner)
  // Keep every edge pointing the way the loop runs.
  const along = sub(loop[to], loop[from])
  return { center, axis: dot(axis, along) < 0 ? scale(axis, -1) : axis }
}

function intersect(a: EdgeLine, b: EdgeLine): Point | null {
  const denom = cross(a.axis, b.axis)
  if (Math.abs(denom) < 1e-6) return null
  return add(a.center, scale(a.axis, cross(sub(b.center, a.center), b.axis) / denom))
}

function polygonResiduals(loop: Point[], vertices: Point[]) {
  return loop.map((p) =>
    Math.min(...vertices.map((v, i) => distanceToSegment(p, v, vertices[(i + 1) % vertices.length]))),
  )
}

function triangleCandidate(loop: Point[], vertices: [Point, Point, Point], scaleRef: number): Candidate {
  const score = shapeScore(polygonResiduals(loop, vertices), scaleRef)
  const angles = vertices.map((_, i) => interiorAngle(vertices, i))
  if (Math.min(...angles) < MIN_TRIANGLE_ANGLE) return { shape: null, score }
  return { score, shape: { kind: 'triangle', vertices: regulariseTriangle(vertices), confidence: 1 - score } }
}

function regulariseTriangle(input: [Point, Point, Point]): [Point, Point, Point] {
  const vertices = [...input] as [Point, Point, Point]

  // Square up a near-right corner by turning its two legs equally, which keeps
  // the corner and both leg lengths: the tutor's proportions survive.
  const right = vertices.findIndex((_, i) => Math.abs(interiorAngle(vertices, i) - 90 * DEG) <= RIGHT_ANGLE_SNAP)
  if (right !== -1) {
    const at = vertices[right]
    const [p, q] = [vertices[(right + 1) % 3], vertices[(right + 2) % 3]]
    const legP = sub(p, at)
    const legQ = sub(q, at)
    const bisector = Math.atan2(legP.y, legP.x) + signedAngle(legP, legQ) / 2
    const side = Math.sign(signedAngle(legP, legQ))
    vertices[(right + 1) % 3] = add(at, rotate({ x: length(legP), y: 0 }, bisector - (side * Math.PI) / 4))
    vertices[(right + 2) % 3] = add(at, rotate({ x: length(legQ), y: 0 }, bisector + (side * Math.PI) / 4))
  }

  // Then turn the whole triangle (never one vertex) so its most nearly level or
  // upright edge sits on the axis. A rigid turn leaves every angle and length alone.
  let turn = 0
  let closest = AXIS_SNAP
  for (let i = 0; i < 3; i++) {
    const edge = sub(vertices[(i + 1) % 3], vertices[i])
    const angle = Math.atan2(edge.y, edge.x)
    const off = Math.abs(toQuarter(angle))
    if (off <= closest) {
      closest = off
      turn = -toQuarter(angle)
    }
  }
  if (turn === 0) return vertices
  const pivot = centroid(vertices)
  return vertices.map((v) => add(pivot, rotate(sub(v, pivot), turn))) as [Point, Point, Point]
}

function rectangleCandidate(loop: Point[], vertices: Point[], edges: EdgeLine[], scaleRef: number): Candidate {
  const raw = shapeScore(polygonResiduals(loop, vertices), scaleRef)
  const square = vertices.every((_, i) => Math.abs(interiorAngle(vertices, i) - 90 * DEG) <= RECTANGLE_CORNER_TOLERANCE)
  if (!square) return { shape: null, score: raw }

  // All four edges vote for the orientation, the long ones counting for more.
  let c = 0
  let s = 0
  vertices.forEach((v, i) => {
    const edge = sub(vertices[(i + 1) % 4], v)
    const theta = 4 * Math.atan2(edge.y, edge.x)
    c += length(edge) * Math.cos(theta)
    s += length(edge) * Math.sin(theta)
  })
  const angle = snapToAxis(Math.atan2(s, c) / 4, AXIS_SNAP)

  // Each pair of opposite edges fixes one dimension.
  const xs: number[] = []
  const ys: number[] = []
  for (const edge of edges) {
    const at = rotate(edge.center, -angle)
    const dir = rotate(edge.axis, -angle)
    if (Math.abs(dir.x) > Math.abs(dir.y)) ys.push(at.y)
    else xs.push(at.x)
  }
  if (xs.length !== 2 || ys.length !== 2) return { shape: null, score: raw }
  const left = Math.min(...xs)
  const right = Math.max(...xs)
  const top = Math.min(...ys)
  const bottom = Math.max(...ys)
  const width = right - left
  const height = bottom - top
  const center = rotate({ x: (left + right) / 2, y: (top + bottom) / 2 }, angle)

  const corners = [
    { x: -width / 2, y: -height / 2 },
    { x: width / 2, y: -height / 2 },
    { x: width / 2, y: height / 2 },
    { x: -width / 2, y: height / 2 },
  ].map((p) => add(center, rotate(p, angle)))
  const score = shapeScore(polygonResiduals(loop, corners), scaleRef)
  return { score, shape: { kind: 'rectangle', center, width, height, angle, confidence: 1 - score } }
}

function interiorAngle(vertices: Point[], i: number) {
  const n = vertices.length
  const a = sub(vertices[(i + 1) % n], vertices[i])
  const b = sub(vertices[(i + n - 1) % n], vertices[i])
  return Math.abs(Math.atan2(cross(a, b), dot(a, b)))
}

// ---- path helpers -------------------------------------------------------

function dedupe(input: readonly Point[]): Point[] {
  const out: Point[] = []
  for (const p of input) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) continue
    const last = out[out.length - 1]
    if (!last || last.x !== p.x || last.y !== p.y) out.push({ x: p.x, y: p.y })
  }
  return out
}

function pathLength(points: Point[]) {
  let total = 0
  for (let i = 1; i < points.length; i++) total += dist(points[i - 1], points[i])
  return total
}

/** `count` points evenly spaced along the path. A closed path includes the last-to-first segment. */
function resample(points: Point[], count: number, closed: boolean): Point[] {
  const route = closed ? [...points, points[0]] : points
  const total = pathLength(route)
  const step = total / (closed ? count : count - 1)
  const out = [route[0]]
  let walked = 0
  let target = step
  for (let i = 1; i < route.length && out.length < count; i++) {
    const a = route[i - 1]
    const b = route[i]
    const d = dist(a, b)
    while (d > 0 && target <= walked + d && out.length < count) {
      const t = (target - walked) / d
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
      target += step
    }
    walked += d
  }
  while (out.length < count) out.push(route[route.length - 1])
  return out
}

function diagonal(points: Point[]) {
  const xs = points.map((p) => p.x)
  const ys = points.map((p) => p.y)
  return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
}

function centroid(points: Point[]): Point {
  const sum = points.reduce((acc, p) => add(acc, p), { x: 0, y: 0 })
  return scale(sum, 1 / points.length)
}

/** Centre, unit principal axis and the extent across it. */
function principalAxes(points: Point[]) {
  const center = centroid(points)
  let xx = 0
  let xy = 0
  let yy = 0
  for (const p of points) {
    const d = sub(p, center)
    xx += d.x * d.x
    xy += d.x * d.y
    yy += d.y * d.y
  }
  const theta = Math.atan2(2 * xy, xx - yy) / 2
  const axis = { x: Math.cos(theta), y: Math.sin(theta) }
  const across = points.map((p) => cross(sub(p, center), axis))
  return { center, axis, minorExtent: Math.max(...across) - Math.min(...across) }
}

function signedArea(loop: Point[]) {
  let area = 0
  for (let i = 0; i < loop.length; i++) area += cross(loop[i], loop[(i + 1) % loop.length])
  return area / 2
}

function farthestFrom(points: Point[], from: Point) {
  let best = 0
  let far = -1
  points.forEach((p, i) => {
    const d = dist(p, from)
    if (d > far) {
      far = d
      best = i
    }
  })
  return best
}

function distanceToSegment(p: Point, a: Point, b: Point) {
  const ab = sub(b, a)
  const len = dot(ab, ab)
  if (len === 0) return dist(p, a)
  const t = Math.min(1, Math.max(0, dot(sub(p, a), ab) / len))
  return dist(p, add(a, scale(ab, t)))
}

function rmsOf(values: number[]) {
  return Math.sqrt(values.reduce((sum, v) => sum + v * v, 0) / values.length)
}

/** The signed offset from `angle` to its nearest multiple of 90°. */
function toQuarter(angle: number) {
  return angle - Math.round(angle / (Math.PI / 2)) * (Math.PI / 2)
}

function snapToAxis(angle: number, within: number) {
  const off = toQuarter(angle)
  return Math.abs(off) <= within ? angle - off : angle
}

function signedAngle(a: Point, b: Point) {
  return Math.atan2(cross(a, b), dot(a, b))
}

const add = (a: Point, b: Point): Point => ({ x: a.x + b.x, y: a.y + b.y })
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const scale = (a: Point, k: number): Point => ({ x: a.x * k, y: a.y * k })
const dot = (a: Point, b: Point) => a.x * b.x + a.y * b.y
const cross = (a: Point, b: Point) => a.x * b.y - a.y * b.x
const length = (a: Point) => Math.hypot(a.x, a.y)
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const rotate = (a: Point, t: number): Point => ({
  x: a.x * Math.cos(t) - a.y * Math.sin(t),
  y: a.x * Math.sin(t) + a.y * Math.cos(t),
})

// ---- small linear algebra -----------------------------------------------

type Matrix3 = number[][]

const zeros3 = (): Matrix3 => [[0, 0, 0], [0, 0, 0], [0, 0, 0]]
const transpose3 = (m: Matrix3): Matrix3 => m[0].map((_, j) => m.map((row) => row[j]))
const mul3 = (a: Matrix3, b: Matrix3): Matrix3 =>
  a.map((row) => [0, 1, 2].map((j) => row[0] * b[0][j] + row[1] * b[1][j] + row[2] * b[2][j]))

function det3(m: Matrix3) {
  return (
    m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1]) -
    m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0]) +
    m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0])
  )
}

function crossRows(a: number[], b: number[]) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function invert3(m: Matrix3): Matrix3 | null {
  const det = det3(m)
  if (Math.abs(det) < 1e-12) return null
  return transpose3([crossRows(m[1], m[2]), crossRows(m[2], m[0]), crossRows(m[0], m[1])]).map((row) =>
    row.map((v) => v / det),
  )
}

function solve3(m: Matrix3, b: number[]) {
  const inv = invert3(m)
  return inv && inv.map((row) => row[0] * b[0] + row[1] * b[1] + row[2] * b[2])
}

/** The real eigenvalues of a 3×3 matrix. */
function eigenvalues3(m: Matrix3): number[] {
  const trace = m[0][0] + m[1][1] + m[2][2]
  const minors =
    m[0][0] * m[1][1] - m[0][1] * m[1][0] + m[0][0] * m[2][2] - m[0][2] * m[2][0] + m[1][1] * m[2][2] - m[1][2] * m[2][1]
  return realCubicRoots(-trace, minors, -det3(m))
}

/** Real roots of x³ + bx² + cx + d. */
function realCubicRoots(b: number, c: number, d: number): number[] {
  const shift = -b / 3
  const p = c - (b * b) / 3
  const q = (2 * b * b * b) / 27 - (b * c) / 3 + d
  const discriminant = (q * q) / 4 + (p * p * p) / 27
  if (discriminant > 0) {
    const root = Math.sqrt(discriminant)
    return [Math.cbrt(-q / 2 + root) + Math.cbrt(-q / 2 - root) + shift]
  }
  if (p === 0) return [shift]
  const r = 2 * Math.sqrt(-p / 3)
  const phi = Math.acos(Math.max(-1, Math.min(1, (3 * q) / (p * r)))) / 3
  return [0, 1, 2].map((k) => r * Math.cos(phi - (2 * Math.PI * k) / 3) + shift)
}

/** A vector the matrix (m - λI) sends to zero: the cross product of two of its rows. */
function nullVector3(m: Matrix3, lambda: number): number[] | null {
  const shifted = m.map((row, i) => row.map((v, j) => (i === j ? v - lambda : v)))
  let best: number[] | null = null
  let bestNorm = 1e-14
  for (const [i, j] of [[0, 1], [0, 2], [1, 2]]) {
    const v = crossRows(shifted[i], shifted[j])
    const norm = Math.hypot(v[0], v[1], v[2])
    if (norm > bestNorm) {
      best = v.map((x) => x / norm)
      bestNorm = norm
    }
  }
  return best
}
