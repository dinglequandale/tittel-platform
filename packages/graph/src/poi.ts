// Points of interest for the selected curve (GRAPH-SPEC §3.4): zeros, the
// y-intercept, local extrema, and intersections with other curves.
// G1 covers y = f(x) curves; x = f(y) and implicit curves arrive later.
import type { Curve } from './analyze.ts'
import type { Viewport } from './state.ts'

export type PoiKind = 'zero' | 'intercept' | 'max' | 'min' | 'intersection'
export interface Poi { x: number; y: number; kind: PoiKind }

const MAX_PER_KIND = 60

/** Bisection on a sign change of g over [a, b] (g(a), g(b) of opposite sign). */
function bisect(g: (x: number) => number, a: number, b: number): number {
  let ga = g(a)
  for (let i = 0; i < 80; i++) {
    const m = (a + b) / 2
    if (m === a || m === b) break
    const gm = g(m)
    if (gm === 0) return m
    if (Math.sign(gm) === Math.sign(ga)) { a = m; ga = gm } else b = m
  }
  return (a + b) / 2
}

/** Locate an extremum in [a, b] as the root of a central-difference
 *  derivative: precise to ~1e-10, unlike golden-section search (~1e-8), which
 *  matters for recognising exact values such as −3π/2. */
function extremum(f: (x: number) => number, a: number, b: number, scale: number): number {
  const h = 1e-6 * Math.max(1, scale)
  const d = (x: number) => f(x + h) - f(x - h)
  const da = d(a)
  const db = d(b)
  if (Number.isNaN(da) || Number.isNaN(db) || Math.sign(da) === Math.sign(db)) return (a + b) / 2
  return bisect(d, a, b)
}

function zerosOf(g: (x: number) => number, view: Viewport, n: number, jumpLimit: number): number[] {
  const xs: number[] = []
  const step = (view.xmax - view.xmin) / n
  let xa = view.xmin
  let ga = g(xa)
  for (let i = 1; i <= n && xs.length < MAX_PER_KIND; i++) {
    const xb = view.xmin + i * step
    const gb = g(xb)
    if (Number.isFinite(ga) && Number.isFinite(gb)) {
      if (ga === 0) xs.push(xa)
      else if (Math.sign(ga) !== Math.sign(gb) && gb !== 0 && Math.abs(gb - ga) < jumpLimit) {
        const r = bisect(g, xa, xb)
        // Reject sign changes across a pole (|g| large near the "root").
        if (Math.abs(g(r)) < 1e-6 * Math.max(1, jumpLimit)) xs.push(r)
      }
    }
    xa = xb
    ga = gb
  }
  return xs
}

export function pointsOfInterest(
  curve: Curve,
  others: Curve[],
  view: Viewport,
  widthPx: number,
): Poi[] {
  if (curve.orientation !== 'y') return []
  const f = (x: number) => {
    const y = curve.fn(x)
    if (!Number.isFinite(y)) return NaN
    if (curve.restrict && !curve.restrict(x, y)) return NaN
    return y
  }
  const n = Math.max(200, Math.ceil(widthPx))
  const yRange = view.ymax - view.ymin
  const jump = yRange * 2
  const inY = (y: number) => y >= view.ymin - 1e-9 && y <= view.ymax + 1e-9
  const out: Poi[] = []

  for (const x of zerosOf(f, view, n, jump)) out.push({ x, y: 0, kind: 'zero' })

  if (view.xmin <= 0 && view.xmax >= 0) {
    const y0 = f(0)
    if (Number.isFinite(y0) && inY(y0)) out.push({ x: 0, y: y0, kind: 'intercept' })
  }

  // Extrema: strict sign change of the sampled slope.
  const step = (view.xmax - view.xmin) / n
  let prev = f(view.xmin)
  let cur = f(view.xmin + step)
  let ext = 0
  for (let i = 2; i <= n && ext < MAX_PER_KIND; i++) {
    const x = view.xmin + i * step
    const nxt = f(x)
    if ([prev, cur, nxt].every(Number.isFinite)) {
      const d1 = cur - prev
      const d2 = nxt - cur
      const isMax = d1 > 0 && d2 < 0
      const isMin = d1 < 0 && d2 > 0
      if ((isMax || isMin) && Math.abs(d1) < jump && Math.abs(d2) < jump) {
        const ex = extremum(f, x - 2 * step, x, Math.abs(x))
        const ey = f(ex)
        if (Number.isFinite(ey) && inY(ey)) {
          out.push({ x: ex, y: ey, kind: isMax ? 'max' : 'min' })
          ext++
        }
      }
    }
    prev = cur
    cur = nxt
  }

  for (const o of others) {
    if (o.orientation !== 'y') continue
    const g = (x: number) => {
      const a = f(x)
      const b = o.fn(x)
      if (!Number.isFinite(b) || (o.restrict && !o.restrict(x, b))) return NaN
      return a - b
    }
    for (const x of zerosOf(g, view, n, jump)) {
      const y = f(x)
      if (inY(y)) out.push({ x, y, kind: 'intersection' })
    }
  }

  // Merge coincident points (e.g. a zero that is also an extremum, like x² at 0).
  const eps = (view.xmax - view.xmin) * 1e-7
  const merged: Poi[] = []
  for (const p of out) {
    if (!merged.some((q) => Math.abs(q.x - p.x) < eps && Math.abs(q.y - p.y) < eps * 10)) merged.push(p)
  }
  return merged
}
