// List statistics (GRAPH-SPEC §5, "Statistics" and "Lists"). Definitions follow
// standard practice; quartiles use the Moore & McCabe method the reference
// documents for boxplots (exclude the median for odd n) [DOC].

const finite = (xs: number[]) => xs.filter(Number.isFinite)
const sorted = (xs: number[]) => [...finite(xs)].sort((a, b) => a - b)

export const total = (xs: number[]) => xs.reduce((s, x) => s + x, 0)
export const mean = (xs: number[]) => (xs.length ? total(xs) / xs.length : NaN)

export function median(xs: number[]): number {
  const s = sorted(xs)
  if (!s.length) return NaN
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function variance(xs: number[], sample: boolean): number {
  const n = xs.length
  if (n < (sample ? 2 : 1)) return NaN
  const m = mean(xs)
  return xs.reduce((s, x) => s + (x - m) ** 2, 0) / (sample ? n - 1 : n)
}

export function covariance(a: number[], b: number[], sample: boolean): number {
  const n = Math.min(a.length, b.length)
  if (n < (sample ? 2 : 1)) return NaN
  const ma = mean(a.slice(0, n))
  const mb = mean(b.slice(0, n))
  let s = 0
  for (let i = 0; i < n; i++) s += (a[i] - ma) * (b[i] - mb)
  return s / (sample ? n - 1 : n)
}

export function corr(a: number[], b: number[]): number {
  return covariance(a, b, true) / Math.sqrt(variance(a.slice(0, b.length), true) * variance(b.slice(0, a.length), true))
}

function ranks(xs: number[]): number[] {
  const idx = xs.map((x, i) => [x, i] as const).sort((p, q) => p[0] - q[0])
  const r = new Array(xs.length)
  for (let i = 0; i < idx.length; ) {
    let j = i
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg
    i = j + 1
  }
  return r
}
export const spearman = (a: number[], b: number[]) => corr(ranks(a), ranks(b))

/** q-th quartile, q ∈ {0..4}, Moore & McCabe. */
export function quartile(xs: number[], q: number): number {
  const s = sorted(xs)
  if (!s.length || !Number.isInteger(q) || q < 0 || q > 4) return NaN
  if (q === 0) return s[0]
  if (q === 4) return s[s.length - 1]
  if (q === 2) return median(s)
  const half = s.length >> 1
  return median(q === 1 ? s.slice(0, half) : s.slice(s.length - half))
}

/** p-th quantile, p ∈ [0, 1], linear interpolation between order statistics. */
export function quantile(xs: number[], p: number): number {
  const s = sorted(xs)
  if (!s.length || !(p >= 0 && p <= 1)) return NaN
  const h = (s.length - 1) * p
  const lo = Math.floor(h)
  return s[lo] + (h - lo) * ((s[Math.min(lo + 1, s.length - 1)] ?? s[lo]) - s[lo])
}

export const mad = (xs: number[]) => { const m = mean(xs); return mean(xs.map((x) => Math.abs(x - m))) }

export function unique(xs: number[]): number[] {
  const seen = new Set<number>()
  return xs.filter((x) => (seen.has(x) ? false : (seen.add(x), true)))
}
