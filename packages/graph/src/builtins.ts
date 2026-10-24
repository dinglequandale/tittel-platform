// Built-in functions and constants (GRAPH-SPEC §5). Names match Desmos's so
// typing feels identical; implementations are ordinary maths.
import { isList, mkList, numbers, type Value } from './values.ts'
import * as st from './stats.ts'

export const GREEK = new Set([
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'zeta', 'eta', 'theta', 'iota', 'kappa', 'lambda',
  'mu', 'nu', 'xi', 'rho', 'sigma', 'upsilon', 'phi', 'chi', 'psi', 'omega',
  'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Sigma', 'Upsilon', 'Phi', 'Psi', 'Omega',
])

export interface CallContext { degrees: boolean }
type Fn = (args: number[], ctx: CallContext) => number

const toRad = (x: number, c: CallContext) => (c.degrees ? (x * Math.PI) / 180 : x)
const fromRad = (x: number, c: CallContext) => (c.degrees ? (x * 180) / Math.PI : x)

const trig = (f: (x: number) => number): Fn => ([x], c) => f(toRad(x, c))
const plain = (f: (x: number) => number): Fn => ([x]) => f(x)
const inv = (f: (x: number) => number): Fn => ([x], c) => fromRad(f(x), c)

function gcd2(a: number, b: number): number {
  a = Math.abs(Math.round(a)); b = Math.abs(Math.round(b))
  while (b) [a, b] = [b, a % b]
  return a
}

export function factorial(n: number): number {
  if (n < 0 && Number.isInteger(n)) return NaN
  if (Number.isInteger(n)) {
    if (n > 170) return Infinity
    let r = 1
    for (let i = 2; i <= n; i++) r *= i
    return r
  }
  return gamma(n + 1)
}

// Lanczos approximation (g=7), for non-integer factorials.
function gamma(z: number): number {
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gamma(1 - z))
  const g = 7
  const c = [0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313,
    -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7]
  z -= 1
  let x = c[0]
  for (let i = 1; i < g + 2; i++) x += c[i] / (z + i)
  const t = z + g + 0.5
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * x
}

function choose(n: number, k: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(k) || k < 0 || n < 0) return NaN
  if (k > n) return 0
  k = Math.min(k, n - k)
  let r = 1
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i
  return Math.round(r)
}

/** Arity: number of arguments, or [min, max] (Infinity for variadic). */
interface Builtin { fn: Fn; arity: number | [number, number] }

export const BUILTINS: Record<string, Builtin> = {
  sin: { fn: trig(Math.sin), arity: 1 },
  cos: { fn: trig(Math.cos), arity: 1 },
  tan: { fn: trig(Math.tan), arity: 1 },
  csc: { fn: trig((x) => 1 / Math.sin(x)), arity: 1 },
  sec: { fn: trig((x) => 1 / Math.cos(x)), arity: 1 },
  cot: { fn: trig((x) => 1 / Math.tan(x)), arity: 1 },
  arcsin: { fn: inv(Math.asin), arity: 1 },
  arccos: { fn: inv(Math.acos), arity: 1 },
  arctan: { fn: inv(Math.atan), arity: [1, 2] },
  arccsc: { fn: inv((x) => Math.asin(1 / x)), arity: 1 },
  arcsec: { fn: inv((x) => Math.acos(1 / x)), arity: 1 },
  arccot: { fn: inv((x) => Math.PI / 2 - Math.atan(x)), arity: 1 },
  sinh: { fn: plain(Math.sinh), arity: 1 },
  cosh: { fn: plain(Math.cosh), arity: 1 },
  tanh: { fn: plain(Math.tanh), arity: 1 },
  csch: { fn: plain((x) => 1 / Math.sinh(x)), arity: 1 },
  sech: { fn: plain((x) => 1 / Math.cosh(x)), arity: 1 },
  coth: { fn: plain((x) => 1 / Math.tanh(x)), arity: 1 },
  ln: { fn: ([x]) => Math.log(x), arity: 1 },
  log: { fn: ([x]) => Math.log10(x), arity: 1 },
  exp: { fn: ([x]) => Math.exp(x), arity: 1 },
  abs: { fn: ([x]) => Math.abs(x), arity: 1 },
  floor: { fn: ([x]) => Math.floor(x), arity: 1 },
  ceil: { fn: ([x]) => Math.ceil(x), arity: 1 },
  round: { fn: ([x, p = 0]) => { const m = 10 ** Math.round(p); return Math.round(x * m) / m }, arity: [1, 2] },
  sign: { fn: ([x]) => Math.sign(x), arity: 1 },
  mod: { fn: ([a, b]) => ((a % b) + b) % b, arity: 2 },
  nthroot: { fn: ([x, n]) => nthRoot(x, n), arity: 2 },
  gcd: { fn: (xs) => xs.reduce(gcd2), arity: [1, Infinity] },
  lcm: { fn: (xs) => xs.reduce((a, b) => Math.abs(Math.round(a) * Math.round(b)) / gcd2(a, b)), arity: [1, Infinity] },
  nCr: { fn: ([n, k]) => choose(n, k), arity: 2 },
  nPr: { fn: ([n, k]) => (k > n ? 0 : choose(n, k) * factorial(k)), arity: 2 },
}
// arctan(y, x) is the two-argument angle.
BUILTINS.arctan.fn = ([a, b], c) => fromRad(b === undefined ? Math.atan(a) : Math.atan2(a, b), c)

/** Functions over whole lists (aggregates and list operations). They receive
 *  the raw argument values; scalar BUILTINS instead broadcast element-wise. */
type ListFn = (args: Value[]) => Value
/** Aggregates accept one list or several numbers: mean([1,2]) = mean(1,2). */
const agg = (f: (xs: number[]) => number): ListFn => (args) =>
  f(args.length === 1 ? numbers(args[0]) : args.flatMap(numbers))
const two = (f: (a: number[], b: number[]) => number): ListFn => ([a, b]) => f(numbers(a), numbers(b ?? NaN))

export const LIST_FUNCS: Record<string, { fn: ListFn; arity: [number, number] }> = {
  mean: { fn: agg(st.mean), arity: [1, Infinity] },
  median: { fn: agg(st.median), arity: [1, Infinity] },
  total: { fn: agg(st.total), arity: [1, Infinity] },
  count: { fn: agg((xs) => xs.length), arity: [1, Infinity] },
  min: { fn: agg((xs) => (xs.length ? Math.min(...xs) : NaN)), arity: [1, Infinity] },
  max: { fn: agg((xs) => (xs.length ? Math.max(...xs) : NaN)), arity: [1, Infinity] },
  stdev: { fn: agg((xs) => Math.sqrt(st.variance(xs, true))), arity: [1, Infinity] },
  stdevp: { fn: agg((xs) => Math.sqrt(st.variance(xs, false))), arity: [1, Infinity] },
  stddev: { fn: agg((xs) => Math.sqrt(st.variance(xs, true))), arity: [1, Infinity] },
  var: { fn: agg((xs) => st.variance(xs, true)), arity: [1, Infinity] },
  varp: { fn: agg((xs) => st.variance(xs, false)), arity: [1, Infinity] },
  mad: { fn: agg(st.mad), arity: [1, Infinity] },
  cov: { fn: two((a, b) => st.covariance(a, b, true)), arity: [2, 2] },
  covp: { fn: two((a, b) => st.covariance(a, b, false)), arity: [2, 2] },
  corr: { fn: two(st.corr), arity: [2, 2] },
  spearman: { fn: two(st.spearman), arity: [2, 2] },
  quartile: { fn: ([l, q]) => st.quartile(numbers(l), numbers(q)[0]), arity: [2, 2] },
  quantile: { fn: ([l, q]) => st.quantile(numbers(l), numbers(q)[0]), arity: [2, 2] },
  sort: { fn: ([l]) => mkList([...numbers(l)].sort((a, b) => a - b)), arity: [1, 1] },
  unique: { fn: ([l]) => mkList(st.unique(numbers(l))), arity: [1, 1] },
  join: { fn: (args) => mkList(args.flatMap((a) => (isList(a) ? a.list : [a]))), arity: [1, Infinity] },
}

export const FUNCTION_NAMES = new Set([...Object.keys(BUILTINS), ...Object.keys(LIST_FUNCS)])

/** Real nth root: odd roots of negatives stay real (∛−8 = −2). */
export function nthRoot(x: number, n: number): number {
  if (x < 0 && Number.isInteger(n) && Math.abs(n) % 2 === 1) return -Math.pow(-x, 1 / n)
  return Math.pow(x, 1 / n)
}

/** Real power, with odd-denominator rational exponents of negatives kept real
 *  ((−8)^(1/3) = −2), and 0^0 = 1 (GRAPH-SPEC catalogue). */
export function realPow(a: number, b: number): number {
  if (a < 0 && !Number.isInteger(b)) {
    // b ≈ p/q with q odd → real result
    for (let q = 3; q <= 15; q += 2) {
      const p = Math.round(b * q)
      if (Math.abs(p / q - b) < 1e-12) {
        const r = Math.pow(-a, b)
        return p % 2 === 0 ? r : -r
      }
    }
    return NaN
  }
  return Math.pow(a, b)
}

export const CONSTANTS: Record<string, number> = { pi: Math.PI, tau: 2 * Math.PI, e: Math.E }
