// Adaptive curve sampling for explicit curves (GRAPH-SPEC §3.3, item 36).
import type { Curve } from './analyze.ts'
import type { Viewport } from './state.ts'

/** A polyline in math coordinates: [x0, y0, x1, y1, …]. A 2-length entry is an
 *  isolated point (e.g. a single defined sample). */
export type Polyline = number[]

const MAX_DEPTH = 12
/** Evaluations per curve before we stop refining ("lower resolution" mode). */
const BUDGET = 120_000

export function sampleCurve(curve: Curve, view: Viewport, widthPx: number, heightPx: number): Polyline[] {
  const dep = curve.orientation
  // t = independent variable, v = dependent, in that orientation's axes.
  const [t0, t1] = dep === 'y' ? [view.xmin, view.xmax] : [view.ymin, view.ymax]
  const [v0, v1] = dep === 'y' ? [view.ymin, view.ymax] : [view.xmin, view.xmax]
  const tPx = (dep === 'y' ? widthPx : heightPx) / (t1 - t0)
  const vPx = (dep === 'y' ? heightPx : widthPx) / (v1 - v0)

  const restrict = curve.restrict
  let evals = 0
  const f = (t: number): number => {
    evals++
    const v = curve.fn(t)
    if (!Number.isFinite(v)) return NaN
    if (restrict) {
      const ok = dep === 'y' ? restrict(t, v) : restrict(v, t)
      if (!ok) return NaN
    }
    return v
  }

  const out: Polyline[] = []
  let cur: number[] = []
  const emit = (t: number, v: number) => {
    if (dep === 'y') cur.push(t, v)
    else cur.push(v, t)
  }
  const flush = () => {
    if (cur.length) out.push(cur)
    cur = []
  }

  // Which side of the visible band a value is on (with a margin): −1 below,
  // 1 above, 0 visible. Segments wholly off one side are never refined or
  // split: they are invisible, and steep tails (tan, 1/x) would otherwise
  // shatter into hundreds of pieces and burn the budget.
  const lo = Math.min(v0, v1) - Math.abs(v1 - v0) * 0.5
  const hi = Math.max(v0, v1) + Math.abs(v1 - v0) * 0.5
  const side = (v: number) => (v < lo ? -1 : v > hi ? 1 : 0)
  // Jump across a discontinuity: more than 2px of change over a sub-pixel step.
  const isJump = (va: number, vb: number) => Math.abs(vb - va) * vPx > 2 && !(side(va) !== 0 && side(va) === side(vb))

  const segment = (ta: number, va: number, tb: number, vb: number, depth: number) => {
    const fa = !Number.isNaN(va)
    const fb = !Number.isNaN(vb)
    const tm = (ta + tb) / 2
    if (depth >= MAX_DEPTH || evals > BUDGET || (tb - ta) * tPx < 1e-4) {
      if (fa && fb) {
        if (isJump(va, vb)) { flush(); emit(tb, vb) } else emit(tb, vb)
      } else if (fb) { flush(); emit(tb, vb) } else if (fa) flush()
      return
    }
    if (!fa && !fb) {
      // Both ends undefined: probe the middle once so small islands still show.
      if (depth < 3) {
        const vm = f(tm)
        if (!Number.isNaN(vm)) { segment(ta, va, tm, vm, depth + 1); segment(tm, vm, tb, vb, depth + 1) }
      }
      return
    }
    const vm = f(tm)
    if (fa && fb && !Number.isNaN(vm)) {
      const s = side(va)
      if (s !== 0 && s === side(vb) && s === side(vm)) { emit(tb, vb); return }
      // Linear in pixel space? Then the chord is good enough.
      const dev = Math.abs(vm - (va + vb) / 2) * vPx
      if (dev < 0.25) { emit(tb, vb); return }
    }
    segment(ta, va, tm, vm, depth + 1)
    segment(tm, vm, tb, vb, depth + 1)
  }

  const n = Math.max(8, Math.ceil(Math.abs(t1 - t0) * tPx / 3))
  let ta = t0
  let va = f(ta)
  if (!Number.isNaN(va)) emit(ta, va)
  for (let i = 1; i <= n; i++) {
    const tb = t0 + ((t1 - t0) * i) / n
    const vb = f(tb)
    segment(ta, va, tb, vb, 0)
    ta = tb
    va = vb
  }
  flush()
  return out
}
