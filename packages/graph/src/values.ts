// Runtime values: numbers, points, and lists of either (GRAPH-SPEC §4 item 17).
// Arithmetic broadcasts over lists; two lists combine element-wise up to the
// shorter length [INF: matches the reference's documented "on each element"].

export type Pt = [number, number]
export type Scalar = number | Pt
export interface List { readonly list: Scalar[] }
export type Value = Scalar | List

export const MAX_LIST = 10_000

export const isPt = (v: Value): v is Pt => Array.isArray(v)
export const isList = (v: Value): v is List => typeof v === 'object' && !Array.isArray(v)
export const mkList = (xs: Scalar[]): List => ({ list: xs })
export const num = (v: Value): number => (typeof v === 'number' ? v : NaN)

/** Apply a scalar operation, broadcasting over lists. */
export function lift1(a: Value, f: (x: Scalar) => Scalar): Value {
  return isList(a) ? mkList(a.list.map(f)) : f(a)
}

export function lift2(a: Value, b: Value, f: (x: Scalar, y: Scalar) => Scalar): Value {
  const la = isList(a) ? a.list : null
  const lb = isList(b) ? b.list : null
  if (!la && !lb) return f(a as Scalar, b as Scalar)
  const n = la && lb ? Math.min(la.length, lb.length) : (la ?? lb)!.length
  const out: Scalar[] = new Array(n)
  for (let i = 0; i < n; i++) out[i] = f(la ? la[i] : (a as Scalar), lb ? lb[i] : (b as Scalar))
  return mkList(out)
}

export function addS(a: Scalar, b: Scalar, sign: 1 | -1): Scalar {
  if (isPt(a) && isPt(b)) return [a[0] + sign * b[0], a[1] + sign * b[1]]
  if (isPt(a) || isPt(b)) return NaN
  return a + sign * b
}
export function mulS(a: Scalar, b: Scalar): Scalar {
  if (isPt(a) && !isPt(b)) return [a[0] * b, a[1] * b]
  if (!isPt(a) && isPt(b)) return [a * b[0], a * b[1]]
  if (isPt(a) || isPt(b)) return NaN
  return a * b
}
export function divS(a: Scalar, b: Scalar): Scalar {
  if (isPt(b)) return NaN
  if (isPt(a)) return [a[0] / b, a[1] / b]
  return a / b
}

/** Numbers of a value: a list's numeric entries, or a single number. */
export function numbers(v: Value): number[] {
  if (isList(v)) return v.list.map((x) => (typeof x === 'number' ? x : NaN))
  return [num(v)]
}

/** Truthiness for conditions: comparisons evaluate to 1 or 0. */
export const truthy = (v: Scalar) => v === 1
