// Implicit curves F(x, y) = 0 and inequality regions (GRAPH-SPEC §3.5, item 11).
// Contours: a coarse grid, refined recursively only in cells whose corners
// change sign, then marching squares with linear interpolation.
import type { Viewport } from './state.ts'

/** Line segments in math coordinates: [x1, y1, x2, y2, x1, y1, …]. */
export type Segments = number[]

const COARSE_PX = 8
const MIN_PX = 1
const BUDGET = 400_000

export function contour(F: (x: number, y: number) => number, view: Viewport, widthPx: number, heightPx: number): Segments {
  const out: number[] = []
  const nx = Math.max(4, Math.ceil(widthPx / COARSE_PX))
  const ny = Math.max(4, Math.ceil(heightPx / COARSE_PX))
  const dx = (view.xmax - view.xmin) / nx
  const dy = (view.ymax - view.ymin) / ny
  const minCell = ((view.xmax - view.xmin) / widthPx) * MIN_PX
  let evals = 0
  const f = (x: number, y: number) => { evals++; const v = F(x, y); return Number.isFinite(v) ? v : NaN }

  // Coarse corner values, shared between neighbouring cells.
  const grid = new Float64Array((nx + 1) * (ny + 1))
  for (let j = 0; j <= ny; j++) for (let i = 0; i <= nx; i++) grid[j * (nx + 1) + i] = f(view.xmin + i * dx, view.ymin + j * dy)

  const cell = (x0: number, y0: number, w: number, h: number, a: number, b: number, c: number, d: number) => {
    // a: (x0,y0)  b: (x0+w,y0)  c: (x0+w,y0+h)  d: (x0,y0+h)
    const vals = [a, b, c, d]
    if (vals.some(Number.isNaN)) {
      if (vals.every(Number.isNaN) || w <= minCell) return
    } else {
      const pos = vals.filter((v) => v > 0).length
      if (pos === 0 || pos === 4) {
        // No sign change at the corners. A thin feature can still hide inside
        // a coarse cell, so probe the centre once at the top level.
        if (w < dx * 0.99) return
        const m = f(x0 + w / 2, y0 + h / 2)
        if (Number.isNaN(m) || (m > 0) === (a > 0)) return
      }
    }
    if (w > minCell && evals < BUDGET) {
      const hw = w / 2
      const hh = h / 2
      const mab = f(x0 + hw, y0)
      const mbc = f(x0 + w, y0 + hh)
      const mcd = f(x0 + hw, y0 + h)
      const mda = f(x0, y0 + hh)
      const mm = f(x0 + hw, y0 + hh)
      cell(x0, y0, hw, hh, a, mab, mm, mda)
      cell(x0 + hw, y0, hw, hh, mab, b, mbc, mm)
      cell(x0 + hw, y0 + hh, hw, hh, mm, mbc, c, mcd)
      cell(x0, y0 + hh, hw, hh, mda, mm, mcd, d)
      return
    }
    if (vals.some(Number.isNaN)) return
    // Reject sign changes across a pole: the centre would be huge, not ~0.
    const m = f(x0 + w / 2, y0 + h / 2)
    const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c), Math.abs(d))
    if (!(Math.abs(m) <= scale * 2)) return
    marching(x0, y0, w, h, a, b, c, d, m, out)
  }

  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const k = j * (nx + 1) + i
      cell(view.xmin + i * dx, view.ymin + j * dy, dx, dy, grid[k], grid[k + 1], grid[k + nx + 2], grid[k + nx + 1])
    }
  }
  return out
}

function marching(x0: number, y0: number, w: number, h: number, a: number, b: number, c: number, d: number, m: number, out: number[]) {
  const lerp = (p: number, q: number) => p / (p - q)
  // Edge crossing points: bottom (a→b), right (b→c), top (d→c), left (a→d).
  const pts: Record<string, [number, number]> = {}
  if ((a > 0) !== (b > 0)) pts.B = [x0 + w * lerp(a, b), y0]
  if ((b > 0) !== (c > 0)) pts.R = [x0 + w, y0 + h * lerp(b, c)]
  if ((d > 0) !== (c > 0)) pts.T = [x0 + w * lerp(d, c), y0 + h]
  if ((a > 0) !== (d > 0)) pts.L = [x0, y0 + h * lerp(a, d)]
  const keys = Object.keys(pts)
  const seg = (p: string, q: string) => out.push(pts[p][0], pts[p][1], pts[q][0], pts[q][1])
  if (keys.length === 2) seg(keys[0], keys[1])
  else if (keys.length === 4) {
    // Saddle: the centre's sign decides which corners connect.
    if ((m > 0) === (a > 0)) { seg('B', 'R'); seg('T', 'L') } else { seg('B', 'L'); seg('T', 'R') }
  }
}

/** A coarse raster of where an inequality holds, for shading. */
export interface RegionMask { cols: number; rows: number; cellPx: number; mask: Uint8Array }

export function regionMask(test: (x: number, y: number) => boolean, view: Viewport, widthPx: number, heightPx: number, cellPx = 3): RegionMask {
  const cols = Math.ceil(widthPx / cellPx)
  const rows = Math.ceil(heightPx / cellPx)
  const mask = new Uint8Array(cols * rows)
  const ux = (view.xmax - view.xmin) / widthPx
  const uy = (view.ymax - view.ymin) / heightPx
  for (let r = 0; r < rows; r++) {
    const y = view.ymax - (r + 0.5) * cellPx * uy
    for (let c = 0; c < cols; c++) {
      if (test(view.xmin + (c + 0.5) * cellPx * ux, y)) mask[r * cols + c] = 1
    }
  }
  return { cols, rows, cellPx, mask }
}
