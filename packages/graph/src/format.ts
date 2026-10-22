// Number display (GRAPH-SPEC §3.4, §3.7). All functions return LaTeX.

/** Evaluation display: ~12 significant digits, scientific notation for very
 *  large or small magnitudes [INF: exact thresholds still to observe]. */
export function formatNumber(v: number): string {
  if (Number.isNaN(v)) return '\\operatorname{undefined}'
  if (v === Infinity) return '\\infty'
  if (v === -Infinity) return '-\\infty'
  if (v === 0 || Math.abs(v) < 1e-300) return '0'
  const a = Math.abs(v)
  if (a >= 1e-6 && a < 1e12) {
    return trim(Number(v.toPrecision(12)).toString())
  }
  const exp = Math.floor(Math.log10(a))
  let mant = Number((v / 10 ** exp).toPrecision(12))
  let e = exp
  if (Math.abs(mant) >= 10) { mant /= 10; e++ }
  return `${trim(mant.toString())}\\times10^{${e}}`
}

function trim(s: string): string {
  return s.includes('.') && !s.includes('e') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

/** Best rational p/q for v (continued fractions, q ≤ maxDen), or undefined
 *  when v is not (close enough to) a simple fraction. The small denominator
 *  cap keeps π, √2 etc. from getting a meaningless "fraction". */
export function toFraction(v: number, maxDen = 10_000, tol = 1e-10): { n: number; d: number } | undefined {
  if (!Number.isFinite(v) || Number.isInteger(v)) return undefined
  const sign = v < 0 ? -1 : 1
  let x = Math.abs(v)
  let [h0, h1, k0, k1] = [0, 1, 1, 0]
  for (let i = 0; i < 40; i++) {
    const a = Math.floor(x)
    ;[h0, h1] = [h1, a * h1 + h0]
    ;[k0, k1] = [k1, a * k1 + k0]
    if (k1 > maxDen) return undefined
    if (Math.abs(h1 / k1 - Math.abs(v)) <= tol * Math.max(1, Math.abs(v))) {
      return k1 === 1 ? undefined : { n: sign * h1, d: k1 }
    }
    const frac = x - a
    if (frac < 1e-15) return undefined
    x = 1 / frac
  }
  return undefined
}

export function fractionLatex(f: { n: number; d: number }): string {
  return `${f.n < 0 ? '-' : ''}\\frac{${Math.abs(f.n)}}{${f.d}}`
}

/** Point-of-interest coordinate: integers and (p/q)·π (q ≤ 12) in exact form,
 *  everything else as a decimal rounded to `decimals`. The reference shows
 *  (−3π/2, 1) [OBS]; whether plain rationals like 1/3 also show exactly is
 *  unverified (GRAPH-SPEC §9), so they stay decimal. */
export function exactOrDecimal(v: number, decimals = 3): string {
  if (!Number.isFinite(v)) return formatNumber(v)
  const tol = 1e-9 * Math.max(1, Math.abs(v))
  if (Math.abs(v) < 1e-10) return '0'
  if (Math.abs(v - Math.round(v)) < tol) return String(Math.round(v))
  const small = (x: number) => {
    for (let q = 2; q <= 12; q++) {
      const p = Math.round(x * q)
      if (p !== 0 && Math.abs(p / q - x) < 1e-9 * Math.max(1, Math.abs(x))) {
        const g = gcd(Math.abs(p), q)
        if (g === 1) return { p, q }
      }
    }
    return undefined
  }
  const piM = v / Math.PI
  if (Math.abs(piM - Math.round(piM)) < 1e-9 * Math.max(1, Math.abs(piM))) {
    const k = Math.round(piM)
    return k === 1 ? '\\pi' : k === -1 ? '-\\pi' : `${k}\\pi`
  }
  const rp = small(piM)
  if (rp) {
    const top = Math.abs(rp.p) === 1 ? '\\pi' : `${Math.abs(rp.p)}\\pi`
    return `${rp.p < 0 ? '-' : ''}\\frac{${top}}{${rp.q}}`
  }
  return trim(v.toFixed(decimals)).replace(/^-0$/, '0')
}

export function pointLatex(x: string, y: string): string {
  return `\\left(${x},\\ ${y}\\right)`
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b]
  return a
}
