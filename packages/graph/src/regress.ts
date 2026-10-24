// Least-squares fitting for `y₁ ~ model` (GRAPH-SPEC §4 items 29–31). [DOC]:
// all regressions minimise the sum of squared errors; models linear in their
// parameters are solved exactly; nonlinear ones iterate from several initial
// guesses in ±5000 (denser near 0), honouring parameter restrictions, and keep
// the best result.

export interface Fit { params: number[]; sse: number; linear: boolean }
export type Bounds = ([number, number] | undefined)[]

const BAD = 1e8 // stand-in residual where the model is undefined

/** Householder QR least squares: minimise ‖A x − b‖ (A is m×n, m ≥ n). */
export function solveLS(A: number[][], b: number[]): number[] | undefined {
  const m = A.length
  const n = A[0]?.length ?? 0
  if (m < n || !n) return undefined
  const R = A.map((r) => [...r])
  const y = [...b]
  for (let k = 0; k < n; k++) {
    let norm = 0
    for (let i = k; i < m; i++) norm += R[i][k] ** 2
    norm = Math.sqrt(norm)
    if (norm < 1e-300) return undefined
    const alpha = R[k][k] > 0 ? -norm : norm
    const v = new Array(m).fill(0)
    v[k] = R[k][k] - alpha
    for (let i = k + 1; i < m; i++) v[i] = R[i][k]
    const vv = v.reduce((s, x) => s + x * x, 0)
    if (vv < 1e-300) continue
    for (let j = k; j < n; j++) {
      let d = 0
      for (let i = k; i < m; i++) d += v[i] * R[i][j]
      const f = (2 * d) / vv
      for (let i = k; i < m; i++) R[i][j] -= f * v[i]
    }
    let d = 0
    for (let i = k; i < m; i++) d += v[i] * y[i]
    const f = (2 * d) / vv
    for (let i = k; i < m; i++) y[i] -= f * v[i]
  }
  const x = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    if (Math.abs(R[i][i]) < 1e-12 * Math.max(1, Math.abs(R[0][0]))) return undefined
    let s = y[i]
    for (let j = i + 1; j < n; j++) s -= R[i][j] * x[j]
    x[i] = s / R[i][i]
  }
  return x
}

/** Gaussian elimination with partial pivoting for a small square system. */
function solveSquare(A: number[][], b: number[]): number[] | undefined {
  const n = b.length
  const M = A.map((r, i) => [...r, b[i]])
  for (let c = 0; c < n; c++) {
    let p = c
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r
    if (Math.abs(M[p][c]) < 1e-300) return undefined
    ;[M[c], M[p]] = [M[p], M[c]]
    for (let r = c + 1; r < n; r++) {
      const f = M[r][c] / M[c][c]
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k]
    }
  }
  const x = new Array(n).fill(0)
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n]
    for (let j = i + 1; j < n; j++) s -= M[i][j] * x[j]
    x[i] = s / M[i][i]
  }
  return x
}

const sseOf = (r: number[]) => r.reduce((s, x) => s + x * x, 0)

export function fit(residuals: (p: number[]) => number[], nParams: number, bounds: Bounds = [], seed = 1): Fit | undefined {
  const R = (p: number[]) => residuals(p).map((v) => (Number.isFinite(v) ? v : BAD))
  const clamp = (p: number[]) => p.map((v, i) => { const b = bounds[i]; return b ? Math.min(b[1], Math.max(b[0], v)) : v })

  // Linear in the parameters? r(p) = r0 + J p for all p.
  const zero = new Array(nParams).fill(0)
  const r0 = R(zero)
  const J = Array.from({ length: nParams }, (_, j) => {
    const e = [...zero]; e[j] = 1
    return R(e).map((v, i) => v - r0[i])
  })
  const probe = Array.from({ length: nParams }, (_, j) => 0.7 + j * 1.3)
  const rp = R(probe)
  const linear = rp.every((v, i) => {
    const pred = r0[i] + J.reduce((s, col, j) => s + col[i] * probe[j], 0)
    return Math.abs(v - pred) <= 1e-7 * (1 + Math.abs(v)) && Math.abs(v) < BAD / 10
  })
  if (linear) {
    const A = r0.map((_, i) => J.map((col) => col[i]))
    const x = solveLS(A, r0.map((v) => -v))
    if (x && x.every(Number.isFinite)) {
      const p = clamp(x)
      if (p.every((v, i) => v === x[i])) return { params: p, sse: sseOf(R(p)), linear: true }
    }
  }

  // Nonlinear: Levenberg–Marquardt from several starts.
  let rng = seed >>> 0 || 1
  const rand = () => { rng = (rng * 1664525 + 1013904223) >>> 0; return rng / 2 ** 32 }
  const guess = (i: number): number => {
    const b = bounds[i]
    if (b) return b[0] + (b[1] - b[0]) * rand()
    const mag = 10 ** (-2 + rand() * 5.7) // 0.01 … ~5000, log-uniform
    return (rand() < 0.5 ? -1 : 1) * mag
  }
  const starts: number[][] = [new Array(nParams).fill(1), new Array(nParams).fill(0.5)]
  for (let s = 0; s < 30; s++) starts.push(Array.from({ length: nParams }, (_, i) => guess(i)))

  let best: Fit | undefined
  for (const s0 of starts) {
    const r = lm(R, clamp(s0), clamp)
    if (r && (!best || r.sse < best.sse)) best = { ...r, linear: false }
  }
  return best
}

function lm(R: (p: number[]) => number[], p0: number[], clamp: (p: number[]) => number[]): { params: number[]; sse: number } | undefined {
  let p = p0
  let r = R(p)
  let sse = sseOf(r)
  if (!Number.isFinite(sse)) return undefined
  let lambda = 1e-3
  const n = p.length
  for (let it = 0; it < 120; it++) {
    const J = p.map((pj, j) => {
      const h = 1e-6 * Math.max(1, Math.abs(pj))
      const up = [...p]; up[j] += h
      const dn = [...p]; dn[j] -= h
      const ru = R(up), rd = R(dn)
      return ru.map((v, i) => (v - rd[i]) / (2 * h))
    })
    const A = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => J[a].reduce((s, x, i) => s + x * J[b][i], 0)))
    const g = J.map((col) => col.reduce((s, x, i) => s + x * r[i], 0))
    let improved = false
    while (lambda < 1e12) {
      const D = A.map((row, i) => row.map((v, j) => (i === j ? v + lambda * Math.max(v, 1e-12) : v)))
      const step = solveSquare(D, g.map((v) => -v))
      if (!step) { lambda *= 10; continue }
      const np = clamp(p.map((v, i) => v + step[i]))
      const nr = R(np)
      const nsse = sseOf(nr)
      if (nsse < sse) {
        const done = sse - nsse <= 1e-14 * (1 + sse)
        p = np; r = nr; sse = nsse
        lambda = Math.max(lambda / 3, 1e-12)
        improved = true
        if (done) return { params: p, sse }
        break
      }
      lambda *= 4
    }
    if (!improved) break
  }
  return { params: p, sse }
}
