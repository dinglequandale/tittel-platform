// Headless tests for the stroke recogniser, on synthetic strokes built to look
// hand drawn: uneven speed, slow wobble, fine jitter, a random start point and
// the pen stopping short of or overshooting the place it started.
import { recognise } from '../src/index.ts'

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -> ${detail}`}`)
  if (!ok) failures++
}

const DEG = Math.PI / 180
const near = (a, b, eps) => Math.abs(a - b) <= eps

function random(seed) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const rotated = (p, t) => ({ x: p.x * Math.cos(t) - p.y * Math.sin(t), y: p.x * Math.sin(t) + p.y * Math.cos(t) })

/** Evenly spaced points round a polygon, optionally closed. */
function polyline(vertices, closed = true, step = 2) {
  const out = []
  const route = closed ? [...vertices, vertices[0]] : vertices
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]
    const b = route[i]
    const n = Math.max(2, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step))
    for (let k = 0; k < n; k++) out.push({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n })
  }
  if (!closed) out.push(route[route.length - 1])
  return out
}

/** Rounds corners, the way a hand does, by averaging along the path. */
function soften(points, window, closed = true) {
  const n = points.length
  return points.map((_, i) => {
    let x = 0
    let y = 0
    let count = 0
    for (let k = -window; k <= window; k++) {
      const j = closed ? (i + k + n) % n : Math.min(n - 1, Math.max(0, i + k))
      x += points[j].x
      y += points[j].y
      count++
    }
    return { x: x / count, y: y / count }
  })
}

/**
 * Turns a clean point list into a pen stroke. `wobble` and `jitter` are fractions
 * of the stroke's size. For a closed path, `gap` < 0 stops short of the start
 * and `gap` > 0 runs past it, as fractions of the path.
 */
function pen(clean, seed, { wobble = 0.012, jitter = 0.003, gap = 0, closed = true, sample = 3 } = {}) {
  const rand = random(seed)
  const xs = clean.map((p) => p.x)
  const ys = clean.map((p) => p.y)
  const size = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys))
  const n = clean.length
  const start = closed ? Math.floor(rand() * n) : 0
  const count = Math.round(n * (1 + gap))
  const waves = [0, 1, 2].map((k) => ({
    freq: 1 + k * 1.3 + rand(),
    phase: rand() * 6.3,
    dir: rand() * 6.3,
    amp: wobble * size * (0.6 - k * 0.15),
  }))
  const out = []
  let i = 0
  while (i < count) {
    const t = i / n
    const p = clean[(start + Math.floor(i)) % n]
    let x = p.x
    let y = p.y
    for (const w of waves) {
      const v = w.amp * Math.sin(2 * Math.PI * w.freq * t + w.phase)
      x += v * Math.cos(w.dir)
      y += v * Math.sin(w.dir)
    }
    x += (rand() - 0.5) * 2 * jitter * size
    y += (rand() - 0.5) * 2 * jitter * size
    out.push({ x, y })
    i += sample * (0.4 + 1.2 * rand()) // uneven pen speed
  }
  return out
}

const circleCurve = (cx, cy, r, n = 400) =>
  Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n
    return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) }
  })

const ellipseCurve = (cx, cy, rx, ry, angle = 0, n = 400) =>
  Array.from({ length: n }, (_, i) => {
    const t = (2 * Math.PI * i) / n
    const p = rotated({ x: rx * Math.cos(t), y: ry * Math.sin(t) }, angle)
    return { x: cx + p.x, y: cy + p.y }
  })

const arc = (cx, cy, r, from, to, n = 200) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = from + ((to - from) * i) / n
    return { x: cx + r * Math.cos(t), y: cy + r * Math.sin(t) }
  })

const rectangle = (cx, cy, w, h, angle = 0) =>
  [{ x: -w / 2, y: -h / 2 }, { x: w / 2, y: -h / 2 }, { x: w / 2, y: h / 2 }, { x: -w / 2, y: h / 2 }]
    .map((p) => rotated(p, angle))
    .map((p) => ({ x: p.x + cx, y: p.y + cy }))

const SEEDS = 40

/** Runs `make(seed)` over many seeds and returns the kinds seen, with a count of each. */
function tally(make) {
  const kinds = {}
  const hits = []
  for (let seed = 1; seed <= SEEDS; seed++) {
    const result = recognise(make(seed))
    kinds[result.kind] = (kinds[result.kind] ?? 0) + 1
    hits.push(result)
  }
  return { kinds, hits }
}

const share = (t, kind) => (t.kinds[kind] ?? 0) / SEEDS
const show = (t) => JSON.stringify(t.kinds)

function expectShape(name, kind, make, least = 0.95) {
  const t = tally(make)
  check(`${name} -> ${kind} (${Math.round(share(t, kind) * 100)}%)`, share(t, kind) >= least, show(t))
  return t.hits.filter((h) => h.kind === kind)
}

function expectNone(name, make, least = 1) {
  const t = tally(make)
  check(`${name} -> no match (${Math.round(share(t, 'none') * 100)}%)`, share(t, 'none') >= least, show(t))
}

// ---- edge cases ---------------------------------------------------------
check('no points', recognise([]).kind === 'none')
check('one point', recognise([{ x: 1, y: 1 }]).kind === 'none')
check('a dot: same point repeated', recognise(Array(50).fill({ x: 3, y: 3 })).kind === 'none')
check('NaN points are ignored', recognise([{ x: NaN, y: 0 }, { x: 1, y: Infinity }]).kind === 'none')
check('minSize rejects a small stroke', recognise(circleCurve(0, 0, 10), { minSize: 40 }).kind === 'none')
check('minSize keeps a large stroke', recognise(circleCurve(0, 0, 100), { minSize: 40 }).kind === 'circle')
check('minConfidence of 1.01 rejects everything', recognise(circleCurve(0, 0, 100), { minConfidence: 1.01 }).kind === 'none')

// ---- lines --------------------------------------------------------------
{
  const clean = (angle, len = 300) => polyline([rotated({ x: -len / 2, y: 0 }, angle), rotated({ x: len / 2, y: 0 }, angle)], false)
  const opts = { closed: false, wobble: 0.008 }
  const slanted = expectShape('slanted line', 'line', (s) => pen(clean(33 * DEG), s, opts))
  check(
    'slanted line keeps its angle',
    slanted.every((l) => near(Math.abs(Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x)), 33 * DEG, 3 * DEG) ||
      near(Math.abs(Math.atan2(l.b.y - l.a.y, l.b.x - l.a.x)), 147 * DEG, 3 * DEG)),
  )
  const level = expectShape('nearly level line', 'line', (s) => pen(clean(3 * DEG), s, { ...opts, wobble: 0.004 }))
  check('nearly level line snaps flat', level.every((l) => near(l.a.y, l.b.y, 1e-6)))
  const upright = expectShape('nearly vertical line', 'line', (s) => pen(clean(92 * DEG), s, { ...opts, wobble: 0.004 }))
  check('nearly vertical line snaps upright', upright.every((l) => near(l.a.x, l.b.x, 1e-6)))
  check(
    'a line keeps its length',
    level.every((l) => near(Math.hypot(l.b.x - l.a.x, l.b.y - l.a.y), 300, 15)),
  )
  expectShape('a short fast line of four points', 'line', () => [
    { x: 0, y: 0 }, { x: 40, y: 1 }, { x: 80, y: 0 }, { x: 120, y: 2 },
  ])
}

// ---- circles and ellipses -----------------------------------------------
{
  const circles = expectShape('circle', 'circle', (s) => pen(circleCurve(50, -20, 150), s))
  check('circle centre and radius', circles.every((c) => near(c.center.x, 50, 12) && near(c.center.y, -20, 12) && near(c.radius, 150, 10)))
  expectShape('circle, pen stops short', 'circle', (s) => pen(circleCurve(0, 0, 150), s, { gap: -0.06 }))
  expectShape('circle, pen overshoots', 'circle', (s) => pen(circleCurve(0, 0, 150), s, { gap: 0.07 }))
  expectShape('small circle', 'circle', (s) => pen(circleCurve(0, 0, 30), s))
  expectShape('huge circle', 'circle', (s) => pen(circleCurve(0, 0, 3000), s))
  expectShape('slightly squashed ellipse becomes a circle', 'circle', (s) => pen(ellipseCurve(0, 0, 150, 138, 25 * DEG), s))

  const flat = expectShape('wide ellipse', 'ellipse', (s) => pen(ellipseCurve(10, 10, 200, 90), s))
  check('wide ellipse radii', flat.every((e) => near(e.rx, 200, 16) && near(e.ry, 90, 14)))
  check('wide ellipse angle snaps to the axis', flat.every((e) => e.angle === 0))
  const tall = expectShape('tall ellipse', 'ellipse', (s) => pen(ellipseCurve(10, 10, 90, 200), s, { wobble: 0.01 }))
  check('tall ellipse keeps its axes', tall.every((e) => e.ry > e.rx))
  const tilted = expectShape('tilted ellipse', 'ellipse', (s) => pen(ellipseCurve(0, 0, 200, 90, 30 * DEG), s))
  check('tilted ellipse keeps its tilt', tilted.every((e) => near(Math.abs(e.angle), 30 * DEG, 6 * DEG) || near(Math.abs(e.angle), 60 * DEG, 6 * DEG)))
  expectShape('ellipse, pen overshoots', 'ellipse', (s) => pen(ellipseCurve(0, 0, 220, 100), s, { gap: 0.06 }))
}

// ---- rectangles ---------------------------------------------------------
{
  const clean = (w, h, angle) => soften(polyline(rectangle(0, 0, w, h, angle)), 5)
  const level = expectShape('rectangle', 'rectangle', (s) => pen(clean(300, 180, 0), s))
  check('rectangle size', level.every((r) => near(r.width, 300, 22) && near(r.height, 180, 22)))
  check('rectangle snaps level', level.every((r) => r.angle === 0))
  expectShape('square', 'rectangle', (s) => pen(clean(220, 220, 0), s))
  const skewed = expectShape('rectangle drawn 4° off', 'rectangle', (s) => pen(clean(300, 180, 4 * DEG), s, { wobble: 0.006 }))
  check('4° off snaps level', skewed.every((r) => r.angle === 0))
  const tilted = expectShape('tilted rectangle', 'rectangle', (s) => pen(clean(300, 150, 25 * DEG), s))
  check('tilted rectangle keeps its tilt', tilted.every((r) => near(Math.abs(r.angle), 25 * DEG, 5 * DEG) || near(Math.abs(r.angle), 65 * DEG, 5 * DEG)))
  expectShape('long thin rectangle', 'rectangle', (s) => pen(clean(420, 60, 0), s, { wobble: 0.004 }))
  expectShape('rectangle, pen overshoots', 'rectangle', (s) => pen(clean(300, 180, 0), s, { gap: 0.05 }))
  expectShape('rectangle, pen stops short', 'rectangle', (s) => pen(clean(300, 180, 0), s, { gap: -0.03 }))
  const squareCorners = polyline([
    { x: 0, y: 0 }, { x: 296, y: 12 }, { x: 303, y: 190 }, { x: -6, y: 184 },
  ])
  const hit = recognise(pen(squareCorners, 7))
  check('near-right corners become a true rectangle', hit.kind === 'rectangle', hit.kind)
}

// ---- triangles ----------------------------------------------------------
function angles(v) {
  return v.map((p, i) => {
    const a = v[(i + 1) % 3]
    const b = v[(i + 2) % 3]
    const u = { x: a.x - p.x, y: a.y - p.y }
    const w = { x: b.x - p.x, y: b.y - p.y }
    return Math.abs(Math.atan2(u.x * w.y - u.y * w.x, u.x * w.x + u.y * w.y))
  })
}
const sides = (v) => v.map((p, i) => Math.hypot(v[(i + 1) % 3].x - p.x, v[(i + 1) % 3].y - p.y)).sort((a, b) => a - b)

{
  const clean = (vs) => soften(polyline(vs), 4)
  const scalene = [{ x: 0, y: 0 }, { x: 320, y: 40 }, { x: 110, y: 210 }]
  const general = expectShape('scalene triangle', 'triangle', (s) => pen(clean(scalene), s))
  const trueSides = sides(scalene)
  check(
    'a scalene triangle stays that triangle',
    general.every((t) => sides(t.vertices).every((len, i) => near(len, trueSides[i], 26))),
    JSON.stringify(sides(general[0].vertices)),
  )

  const right = [{ x: 0, y: 0 }, { x: 0, y: 150 }, { x: 400, y: 150 }] // legs 150 and 400
  const rights = expectShape('right triangle with long legs', 'triangle', (s) => pen(clean(right), s, { wobble: 0.006 }))
  check('right angle is exact', rights.every((t) => near(Math.max(...angles(t.vertices)), 90 * DEG, 1e-6)))
  check(
    'right triangle keeps its proportions',
    rights.every((t) => {
      const [a, b] = sides(t.vertices)
      return near(a / b, 150 / 400, 0.05)
    }),
    JSON.stringify(sides(rights[0].vertices)),
  )
  check(
    'right triangle legs land on the axes',
    rights.every((t) => {
      const v = t.vertices
      return v.some((p, i) => near(p.x, v[(i + 1) % 3].x, 1e-6)) && v.some((p, i) => near(p.y, v[(i + 1) % 3].y, 1e-6))
    }),
  )

  const leaning = [0, 1, 2].map((i) => rotated(right[i], 30 * DEG))
  const leaned = expectShape('tilted right triangle', 'triangle', (s) => pen(clean(leaning), s, { wobble: 0.006 }))
  check('tilted right triangle is square but not levelled', leaned.every((t) => {
    const v = t.vertices
    return near(Math.max(...angles(v)), 90 * DEG, 1e-6) && !v.some((p, i) => near(p.y, v[(i + 1) % 3].y, 1))
  }))

  const flatBase = [{ x: 0, y: 3 }, { x: 300, y: -9 }, { x: 170, y: 220 }]
  const based = expectShape('triangle with a nearly level base', 'triangle', (s) => pen(clean(flatBase), s, { wobble: 0.003, jitter: 0.001 }))
  check('nearly level base snaps flat', based.every((t) => t.vertices.some((p, i) => near(p.y, t.vertices[(i + 1) % 3].y, 1e-6))))
  check('the snap turns the triangle, not one vertex', based.every((t) => {
    const trueS = sides(flatBase)
    return sides(t.vertices).every((len, i) => near(len, trueS[i], 16))
  }))

  expectShape('tall thin triangle', 'triangle', (s) => pen(clean([{ x: 0, y: 0 }, { x: 70, y: 0 }, { x: 40, y: 420 }]), s, { wobble: 0.004 }))
  expectShape('triangle, pen overshoots', 'triangle', (s) => pen(clean(scalene), s, { gap: 0.05 }))
}

// ---- invariance ---------------------------------------------------------
{
  const stroke = pen(circleCurve(0, 0, 150), 3)
  const rect = pen(soften(polyline(rectangle(0, 0, 300, 180, 0)), 5), 3)
  const tri = pen(soften(polyline([{ x: 0, y: 0 }, { x: 320, y: 40 }, { x: 110, y: 210 }]), 4), 3)
  for (const [name, s, kind] of [['circle', stroke, 'circle'], ['rectangle', rect, 'rectangle'], ['triangle', tri, 'triangle']]) {
    check(`${name} reversed`, recognise([...s].reverse()).kind === kind)
    check(`${name} at 10x`, recognise(s.map((p) => ({ x: p.x * 10, y: p.y * 10 }))).kind === kind)
    check(`${name} at 0.1x`, recognise(s.map((p) => ({ x: p.x / 10, y: p.y / 10 }))).kind === kind)
    check(`${name} shifted far away`, recognise(s.map((p) => ({ x: p.x + 1e5, y: p.y - 1e5 }))).kind === kind)
  }
}

// ---- strokes that must not match ----------------------------------------
{
  const upright = (fn, n = 300) => Array.from({ length: n + 1 }, (_, i) => fn(i / n))

  expectNone('open arc, 180°', (s) => pen(arc(0, 0, 150, 0, Math.PI), s, { closed: false }))
  expectNone('open arc, 120°', (s) => pen(arc(0, 0, 150, 0.4, 0.4 + (2 * Math.PI) / 3), s, { closed: false }))
  expectNone('open arc, 270°', (s) => pen(arc(0, 0, 150, 0, 1.5 * Math.PI), s, { closed: false }))
  expectNone('open arc, 300°', (s) => pen(arc(0, 0, 150, 0, (5 * Math.PI) / 3), s, { closed: false }))

  // Written digits, stroked the way a hand writes them.
  const eight = (t) => {
    const a = 2 * Math.PI * t
    return { x: 70 * Math.sin(2 * a) * (1 + 0.1 * Math.cos(a)), y: -150 * Math.cos(a) }
  }
  expectNone('digit 8', (s) => pen(upright(eight), s, { closed: false }))
  expectNone('digit 8, written larger', (s) => pen(upright((t) => { const p = eight(t); return { x: p.x * 5, y: p.y * 5 } }), s, { closed: false }))

  // A written 0 is narrow, comes to a point at the top and bottom, leans, and
  // doesn't sit on one ellipse.
  const zero = (t, lean = 0.12, pinch = 0.45) => {
    const a = 2 * Math.PI * t
    const pinched = 1 - pinch * Math.cos(a) ** 2
    const asym = 1 + 0.12 * Math.cos(a)
    return { x: 62 * Math.sin(a) * pinched * asym + lean * (-130 * Math.cos(a)), y: -130 * Math.cos(a) }
  }
  expectNone('digit 0, pointed', (s) => pen(upright(zero), s, { closed: false }), 0.9)
  expectNone('digit 0, pointed and tailed', (s) => {
    const tail = upright((t) => zero(t * 1.08))
    return pen(tail, s, { closed: false })
  }, 0.9)

  const curve = (parts) => (t) => {
    const k = Math.min(parts.length - 1, Math.floor(t * parts.length))
    return parts[k](t * parts.length - k)
  }
  const lerp = (a, b) => (t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t })
  const round = (cx, cy, r, from, to) => (t) => ({ x: cx + r * Math.cos(from + (to - from) * t), y: cy + r * Math.sin(from + (to - from) * t) })
  const open = { closed: false }

  expectNone('digit 2', (s) => pen(upright(curve([round(0, -60, 70, Math.PI, 2.3 * Math.PI), lerp({ x: 47, y: -8 }, { x: -70, y: 110 }), lerp({ x: -70, y: 110 }, { x: 80, y: 110 })])), s, open))
  expectNone('digit 3', (s) => pen(upright(curve([round(0, -60, 60, -0.8 * Math.PI, 0.5 * Math.PI), round(0, 60, 60, -0.5 * Math.PI, 0.8 * Math.PI)])), s, open))
  expectNone('digit 6: a loop with a tail', (s) => pen(upright(curve([lerp({ x: 70, y: -170 }, { x: -50, y: 30 }), round(0, 50, 55, -Math.PI + 0.1, Math.PI + 0.1)])), s, open))
  expectNone('digit 9: a loop with a tail', (s) => pen(upright(curve([round(0, -60, 60, 0, -2 * Math.PI), lerp({ x: 60, y: -60 }, { x: 40, y: 170 })])), s, open))
  expectNone('letter e', (s) => pen(upright(curve([lerp({ x: -70, y: 0 }, { x: 70, y: 0 }), round(0, 0, 70, 0, -1.7 * Math.PI)])), s, open))
  expectNone('digit 4, one stroke', (s) => pen(polyline([{ x: 60, y: 0 }, { x: 0, y: 120 }, { x: 110, y: 120 }, { x: 80, y: 60 }, { x: 80, y: 200 }], false), s, open))
  expectNone('letter w', (s) => pen(polyline([{ x: 0, y: 0 }, { x: 60, y: 140 }, { x: 120, y: 30 }, { x: 180, y: 140 }, { x: 240, y: 0 }], false), s, open))
  expectNone('an L corner', (s) => pen(polyline([{ x: 0, y: 0 }, { x: 0, y: 200 }, { x: 150, y: 200 }], false), s, open))
  expectNone('a tall U', (s) => pen(polyline([{ x: 0, y: 0 }, { x: 0, y: 300 }, { x: 80, y: 300 }, { x: 80, y: 0 }], false), s, open))
  expectNone('a square with one side missing', (s) => pen(polyline([{ x: 0, y: 0 }, { x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }], false), s, open))

  // Scribbles.
  const cursive = (t) => ({ x: 400 * t + 45 * Math.sin(2 * Math.PI * 6 * t), y: 40 * Math.cos(2 * Math.PI * 6 * t) })
  expectNone('cursive loops', (s) => pen(upright(cursive), s, open))
  const spiral = (t) => ({ x: (40 + 110 * t) * Math.cos(6 * Math.PI * t), y: (40 + 110 * t) * Math.sin(6 * Math.PI * t) })
  expectNone('a spiral', (s) => pen(upright(spiral), s, open))
  expectNone('figure of eight on its side', (s) => pen(upright((t) => { const p = eight(t); return { x: p.y, y: p.x } }), s, open))
  expectNone('zigzag', (s) => pen(polyline(Array.from({ length: 9 }, (_, i) => ({ x: i * 50, y: i % 2 ? 60 : -60 })), false), s, open))
  expectNone('crossed-out scratch', (s) => {
    const rand = random(s)
    return Array.from({ length: 60 }, () => ({ x: rand() * 200, y: rand() * 60 }))
  })
  expectNone('a pentagon', (s) => pen(soften(polyline(Array.from({ length: 5 }, (_, i) => rotated({ x: 180, y: 0 }, (i * 2 * Math.PI) / 5 - Math.PI / 2))), 3), s, { wobble: 0.006 }), 0.9)
  expectNone('a star', (s) => pen(polyline(Array.from({ length: 10 }, (_, i) => rotated({ x: i % 2 ? 80 : 200, y: 0 }, (i * Math.PI) / 5))), s))
  expectNone('a skewed quadrilateral', (s) => pen(polyline([{ x: 0, y: 0 }, { x: 320, y: 0 }, { x: 420, y: 190 }, { x: 100, y: 190 }]), s, { wobble: 0.005 }), 0.9)
}

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
