// Whole-graph analysis: parse every item, resolve definitions across rows
// (variables, functions, table columns, regression parameters), compile to
// closures, and classify each row (GRAPH-SPEC §4).
import { ParseError, type CompareOp, type Node, type Statement } from './ast.ts'
import { parseStatement } from './parse.ts'
import { BUILTINS, CONSTANTS, LIST_FUNCS, factorial, nthRoot, realPow } from './builtins.ts'
import type { ExpressionItem, GraphItem, GraphState, TableItem } from './state.ts'
import {
  MAX_LIST, addS, divS, isList, isPt, lift1, lift2, mkList, mulS, num, numbers, truthy,
  type List, type Scalar, type Value,
} from './values.ts'
import { fit, solveLS, type Bounds } from './regress.ts'
import { corr } from './stats.ts'

export type { Pt, Value, List } from './values.ts'
export type Locals = Record<string, number>
type Compiled = (L: Locals) => Value

export interface Curve {
  /** 'y': y = fn(x).  'x': x = fn(y). */
  orientation: 'y' | 'x'
  fn: (t: number) => number
  /** Restrictions `{…}`: drawn only where this holds. */
  restrict?: (x: number, y: number) => boolean
  /** Boundary of a strict inequality. */
  dashed?: boolean
}

/** F(x, y) = 0. */
export interface Implicit {
  f: (x: number, y: number) => number
  restrict?: (x: number, y: number) => boolean
  dashed?: boolean
}

/** Where an inequality holds (shaded). */
export interface Region { test: (x: number, y: number) => boolean }

export interface PlotPoint {
  x: number
  y: number
  /** Slider variable this coordinate drags (GRAPH-SPEC item 27). */
  dragX?: string
  dragY?: string
  /** Table points carry their column's colour. */
  color?: string
  /** Join to the previous point of the same column. */
  line?: boolean
}

export interface RegressionResult {
  params: { name: string; value: number }[]
  /** `r` and `r²` for y ~ mx + b, otherwise `R²` [DOC]. */
  stats: { name: 'r' | 'r2' | 'R2'; value: number }[]
  logMode: boolean
}

export interface ColumnResult {
  /** Computed cell values (header is an expression), shown greyed [DOC]. */
  computed?: number[]
  error?: string
  missing?: string[]
}

export interface RowResult {
  id: string
  error?: string
  /** Undefined variables, in order of appearance → the "add slider" prompt. */
  missing?: string[]
  slider?: { name: string; value: number }
  /** Shown as "= value" at the right of the row. */
  value?: Value
  curves?: Curve[]
  implicits?: Implicit[]
  region?: Region
  points?: PlotPoint[]
  regression?: RegressionResult
  columns?: ColumnResult[]
}

export interface Analysis {
  rows: RowResult[]
  byId: Map<string, RowResult>
}

class EvalError extends Error {}

// x and y are the plane; e/pi/tau are constants; θ and r are reserved for polar
// (G3), so they never become sliders.
const RESERVED = new Set(['x', 'y', 'e', 'pi', 'tau', 'theta', 'r'])
const MAX_CALL_DEPTH = 64

interface Definition {
  row: number
  name: string
  params?: string[]
  body?: Node
  /** `a = 3` (a plain number) → a slider. */
  literal?: number
  /** Table data column: parsed cells (undefined = blank). */
  cells?: (Node | undefined)[]
  /** Supplied by the regression on this row. */
  regression?: number
}

function numericLiteral(n: Node): number | undefined {
  if (n.k === 'num') return n.v
  if (n.k === 'neg' && n.a.k === 'num') return -n.a.v
  return undefined
}

function definitionOf(st: Statement | undefined, row: number): Definition | undefined {
  if (!st || st.ops.length !== 1 || st.ops[0] !== '=') return undefined
  const [lhs, body] = st.items
  if (lhs.k === 'var' && !RESERVED.has(lhs.name)) return { row, name: lhs.name, body, literal: numericLiteral(body) }
  if (lhs.k === 'apply' && !RESERVED.has(lhs.name) && lhs.args.every((a) => a.k === 'var')) {
    const params = lhs.args.map((a) => (a as { name: string }).name)
    if (new Set(params).size === params.length) return { row, name: lhs.name, params, body }
  }
  return undefined
}

function compare(op: CompareOp, a: number, b: number): boolean {
  switch (op) {
    case '<': return a < b
    case '>': return a > b
    case '<=': return a <= b
    case '>=': return a >= b
    case '=': return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))
  }
}

/** Every variable/apply name a node mentions. */
function namesIn(n: Node, out = new Set<string>()): Set<string> {
  const walk = (m: Node | undefined) => { if (m) namesIn(m, out) }
  switch (n.k) {
    case 'num': break
    case 'var': out.add(n.name); break
    case 'apply': out.add(n.name); n.args.forEach(walk); break
    case 'bin': walk(n.a); walk(n.b); break
    case 'neg': case 'fact': case 'abs': walk(n.a); break
    case 'sqrt': walk(n.a); walk(n.index); break
    case 'call': n.args.forEach(walk); walk(n.base); break
    case 'point': case 'list': case 'listlit': n.items.forEach(walk); break
    case 'range': walk(n.start); walk(n.second); walk(n.end); break
    case 'index': walk(n.a); walk(n.idx); break
    case 'piecewise': n.branches.forEach((b) => { walk(b.cond); walk(b.value) }); walk(n.otherwise); break
    case 'cmp': n.items.forEach(walk); break
  }
  return out
}
const usesName = (n: Node, name: string) => namesIn(n).has(name)
const isVar = (n: Node, name: string) => n.k === 'var' && n.name === name

// ---- scope: definitions and their lazily computed values ------------------

interface RegressionRun {
  values: Map<string, number>
  result: RegressionResult
  /** The list variable standing in for x when plotting the model. */
  xName?: string
}

class Scope {
  private values = new Map<string, Value>()
  private visiting = new Set<string>()
  private fns = new Map<string, { params: string[]; body: Compiled }>()
  private regressions = new Map<number, RegressionRun | EvalError>()
  depth = 0

  constructor(
    readonly defs: Map<string, Definition>,
    readonly duplicates: Set<string>,
    readonly degrees: boolean,
    readonly logMode: boolean,
    readonly statements: (Statement | undefined)[],
  ) {}

  varValue(name: string): Value {
    const cached = this.values.get(name)
    if (cached !== undefined) return cached
    const def = this.defs.get(name)!
    if (def.regression !== undefined) {
      const run = this.regression(def.regression)
      return run.values.get(name) ?? NaN
    }
    if (this.visiting.has(name)) throw new EvalError(`"${name}" is defined in terms of itself`)
    this.visiting.add(name)
    try {
      let v: Value
      if (def.cells) {
        v = mkList(def.cells.map((cell) => {
          if (!cell) return NaN
          const c = new Compiler(this, new Set())
          const out = c.compile(cell)({})
          return isList(out) ? NaN : out
        }))
      } else {
        const c = new Compiler(this, new Set())
        const f = c.compile(def.body!)
        if (c.missing.size) throw new EvalError(`"${[...c.missing][0]}" is not defined`)
        v = f({})
      }
      this.values.set(name, v)
      return v
    } finally {
      this.visiting.delete(name)
    }
  }

  fn(name: string) {
    let f = this.fns.get(name)
    if (!f) {
      const def = this.defs.get(name)!
      if (this.visiting.has(name)) throw new EvalError(`"${name}" is defined in terms of itself`)
      this.visiting.add(name)
      try {
        const c = new Compiler(this, new Set(def.params))
        f = { params: def.params!, body: c.compile(def.body!) }
        this.fns.set(name, f)
      } finally {
        this.visiting.delete(name)
      }
    }
    return f
  }

  regression(row: number): RegressionRun {
    const cached = this.regressions.get(row)
    if (cached instanceof EvalError) throw cached
    if (cached) return cached
    const key = `~${row}`
    if (this.visiting.has(key)) throw new EvalError('This regression depends on its own parameters')
    this.visiting.add(key)
    try {
      const run = runRegression(this, this.statements[row]!, row)
      this.regressions.set(row, run)
      return run
    } catch (e) {
      const err = e instanceof EvalError ? e : new EvalError('Regression failed')
      this.regressions.set(row, err)
      throw err
    } finally {
      this.visiting.delete(key)
    }
  }
}

// ---- compiler --------------------------------------------------------------

class Compiler {
  missing = new Set<string>()
  used = new Set<string>()
  constructor(
    private scope: Scope,
    private locals: Set<string>,
    /** Variable → local substitution (plotting a regression model in x). */
    private aliases: Map<string, string> = new Map(),
  ) {}

  compile(n: Node): Compiled {
    switch (n.k) {
      case 'num': { const v = n.v; return () => v }
      case 'var': return this.variable(n.name)
      case 'neg': { const a = this.compile(n.a); return (L) => lift1(a(L), (x) => mulS(x, -1)) }
      case 'fact': { const a = this.compile(n.a); return (L) => lift1(a(L), (x) => factorial(num(x))) }
      case 'abs': {
        const a = this.compile(n.a)
        return (L) => lift1(a(L), (v) => (isPt(v) ? Math.hypot(v[0], v[1]) : Math.abs(v)))
      }
      case 'sqrt': {
        const a = this.compile(n.a)
        if (!n.index) return (L) => lift1(a(L), (x) => Math.sqrt(num(x)))
        const k = this.compile(n.index)
        return (L) => lift2(a(L), k(L), (x, i) => nthRoot(num(x), num(i)))
      }
      case 'bin': {
        // `a(x+1)^2` where a is not a function: the exponent belongs to the
        // parenthesis, a·(x+1)², not (a·(x+1))².
        if (n.op === '^' && n.a.k === 'apply' && !this.isFunction(n.a.name)) {
          const group: Node = n.a.args.length === 1 ? n.a.args[0] : { k: 'point', items: n.a.args }
          return this.compile({ k: 'bin', op: '*', a: { k: 'var', name: n.a.name }, b: { k: 'bin', op: '^', a: group, b: n.b } })
        }
        const a = this.compile(n.a)
        const b = this.compile(n.b)
        switch (n.op) {
          case '+': return (L) => lift2(a(L), b(L), (x, y) => addS(x, y, 1))
          case '-': return (L) => lift2(a(L), b(L), (x, y) => addS(x, y, -1))
          case '*': return (L) => lift2(a(L), b(L), mulS)
          case '/': return (L) => lift2(a(L), b(L), divS)
          case '^': return (L) => lift2(a(L), b(L), (x, y) => realPow(num(x), num(y)))
        }
      }
      case 'point': {
        if (n.items.length !== 2) throw new EvalError('Points need exactly 2 coordinates')
        const [px, py] = n.items.map((it) => this.compile(it))
        return (L) => lift2(px(L), py(L), (x, y): Scalar => (isPt(x) || isPt(y) ? NaN : [x, y]))
      }
      case 'list': throw new EvalError('Separate items with commas only for points, or use a list: [1,2,3]')
      case 'listlit': {
        const cs = n.items.map((it) => this.compile(it))
        return (L) => mkList(cs.flatMap((c) => { const v = c(L); return isList(v) ? v.list : [v] }))
      }
      case 'range': {
        const start = this.compile(n.start)
        const second = n.second && this.compile(n.second)
        const end = this.compile(n.end!)
        return (L) => rangeList(num(start(L)), second ? num(second(L)) : undefined, num(end(L)))
      }
      case 'index': return this.index(n.a, n.idx)
      case 'cmp': return this.comparison(n.items, n.ops)
      case 'piecewise': return this.piecewise(n)
      case 'call': return this.call(n.fn, n.args, n.base)
      case 'apply': return this.apply(n.name, n.args)
    }
  }

  private isFunction(name: string): boolean {
    return !!this.scope.defs.get(name)?.params && !this.locals.has(name)
  }

  private variable(name: string): Compiled {
    const alias = this.aliases.get(name)
    if (alias) { this.used.add(alias); return (L) => L[alias] }
    if (this.locals.has(name)) {
      this.used.add(name)
      return (L) => L[name]
    }
    if (this.scope.duplicates.has(name)) throw new EvalError(`"${name}" is defined more than once`)
    if (CONSTANTS[name] !== undefined && !this.scope.defs.has(name)) {
      const v = CONSTANTS[name]
      return () => v
    }
    if (this.scope.defs.has(name)) {
      if (this.scope.defs.get(name)!.params) throw new EvalError(`"${name}" is a function; use ${name}(…)`)
      const v = this.scope.varValue(name)
      return () => v
    }
    if (name === 'x' || name === 'y') {
      this.used.add(name)
      return () => NaN
    }
    if (name === 'theta' || name === 'r') throw new EvalError('Polar graphs are not supported yet')
    this.missing.add(name)
    return () => NaN
  }

  private comparison(items: Node[], ops: CompareOp[]): Compiled {
    const cs = items.map((it) => this.compile(it))
    return (L) => {
      let acc: Value = 1
      for (let i = 0; i < ops.length; i++) {
        const op = ops[i]
        const r = lift2(cs[i](L), cs[i + 1](L), (a, b) => (compare(op, num(a), num(b)) ? 1 : 0))
        acc = lift2(acc, r, (p, q) => (truthy(p) && truthy(q) ? 1 : 0))
      }
      return acc
    }
  }

  private piecewise(n: Extract<Node, { k: 'piecewise' }>): Compiled {
    const branches = n.branches.map((b) => ({ cond: this.compile(b.cond), value: b.value ? this.compile(b.value) : () => 1 }))
    const otherwise = n.otherwise ? this.compile(n.otherwise) : () => NaN
    return (L) => {
      for (const b of branches) {
        const c = b.cond(L)
        if (isList(c)) {
          // List condition: decide element by element.
          return mkList(c.list.map((ci, i) => {
            if (truthy(ci)) return pick(b.value(L), i)
            return pick(piecewiseRest(L, branches.slice(branches.indexOf(b) + 1), otherwise), i)
          }))
        }
        if (truthy(c)) return b.value(L)
      }
      return otherwise(L)
    }
  }

  private index(a: Node, idx: Node): Compiled {
    const list = this.compile(a)
    const asList = (v: Value): List => {
      if (!isList(v)) throw new EvalError('Only lists can be indexed, like L[1]')
      return v
    }
    if (idx.k === 'cmp') {
      const cond = this.compile(idx)
      return (L) => {
        const l = asList(list(L))
        const c = cond(L)
        return mkList(l.list.filter((_, i) => truthy(isList(c) ? c.list[i] : c)))
      }
    }
    if (idx.k === 'range') {
      const start = this.compile(idx.start)
      const second = idx.second && this.compile(idx.second)
      const end = idx.end && this.compile(idx.end)
      return (L) => {
        const l = asList(list(L))
        const ix = rangeList(num(start(L)), second ? num(second(L)) : undefined, end ? num(end(L)) : l.list.length)
        return mkList(ix.list.map((i) => l.list[num(i) - 1] ?? NaN))
      }
    }
    const i = this.compile(idx.k === 'listlit' && idx.items.length === 1 ? idx.items[0] : idx)
    return (L) => {
      const l = asList(list(L))
      const iv = i(L)
      const at = (k: Scalar) => (Number.isInteger(k) ? l.list[(k as number) - 1] ?? NaN : NaN)
      return isList(iv) ? mkList(iv.list.map(at)) : at(iv as Scalar)
    }
  }

  private call(fn: string, args: Node[], base?: Node): Compiled {
    const lf = LIST_FUNCS[fn]
    const b = BUILTINS[fn]
    const [lo, hi] = lf ? lf.arity : typeof b.arity === 'number' ? [b.arity, b.arity] : b.arity
    if (args.length < lo || args.length > hi) {
      throw new EvalError(`"${fn}" takes ${lo === hi ? lo : hi === Infinity ? `at least ${lo}` : `${lo}–${hi}`} argument${hi === 1 ? '' : 's'}`)
    }
    const cs = args.map((a) => this.compile(a))
    if (lf) return (L) => lf.fn(cs.map((c) => c(L)))
    const ctx = { degrees: this.scope.degrees }
    if (fn === 'log' && base) {
      const bc = this.compile(base)
      return (L) => lift2(cs[0](L), bc(L), (x, k) => Math.log(num(x)) / Math.log(num(k)))
    }
    if (cs.length === 1) {
      const [c] = cs
      return (L) => lift1(c(L), (x) => b.fn([num(x)], ctx))
    }
    // Several arguments: broadcast over any list arguments; variadic
    // functions (gcd, lcm) take a whole list as their argument list.
    return (L) => {
      const vs = cs.map((c) => c(L))
      if (hi === Infinity) return b.fn(vs.flatMap(numbers), ctx)
      const lists = vs.filter(isList)
      if (!lists.length) return b.fn(vs.map(num), ctx)
      const n = Math.min(...lists.map((l) => l.list.length))
      return mkList(Array.from({ length: n }, (_, i) => b.fn(vs.map((v) => num(isList(v) ? v.list[i] : v)), ctx)))
    }
  }

  private apply(name: string, args: Node[]): Compiled {
    const def = this.scope.defs.get(name)
    if (def?.params && !this.locals.has(name)) {
      if (def.params.length !== args.length) {
        throw new EvalError(`"${name}" takes ${def.params.length} argument${def.params.length === 1 ? '' : 's'}`)
      }
      const cs = args.map((a) => this.compile(a))
      const scope = this.scope
      const callOnce = (vals: number[]): Value => {
        const f = scope.fn(name)
        if (scope.depth > MAX_CALL_DEPTH) return NaN
        const inner: Locals = {}
        for (let i = 0; i < vals.length; i++) inner[f.params[i]] = vals[i]
        scope.depth++
        try { return f.body(inner) } finally { scope.depth-- }
      }
      return (L) => {
        const vs = cs.map((c) => c(L))
        const lists = vs.filter(isList)
        if (!lists.length) return callOnce(vs.map(num))
        // f(L): call once per element.
        const n = Math.min(...lists.map((l) => l.list.length))
        return mkList(Array.from({ length: n }, (_, i) => {
          const r = callOnce(vs.map((v) => num(isList(v) ? v.list[i] : v)))
          return isList(r) ? NaN : r
        }))
      }
    }
    // Not a function: `a(x+1)` is multiplication; `a(1,2)` scales a point.
    const left = this.variable(name)
    const right = args.length === 1 ? this.compile(args[0]) : this.compile({ k: 'point', items: args })
    return (L) => lift2(left(L), right(L), mulS)
  }
}

/** Finish evaluating the remaining branches of a piecewise. */
function piecewiseRest(L: Locals, branches: { cond: Compiled; value: Compiled }[], otherwise: Compiled): Value {
  for (const b of branches) {
    const c = b.cond(L)
    if (!isList(c) && truthy(c)) return b.value(L)
    if (isList(c)) return mkList(c.list.map((ci, i) => (truthy(ci) ? pick(b.value(L), i) : NaN)))
  }
  return otherwise(L)
}

const pick = (v: Value, i: number): Scalar => (isList(v) ? v.list[i] ?? NaN : v)

function rangeList(start: number, second: number | undefined, end: number): List {
  if (![start, end].every(Number.isFinite) || (second !== undefined && !Number.isFinite(second))) {
    throw new EvalError('Range bounds must be numbers')
  }
  const step = second !== undefined ? second - start : end >= start ? 1 : -1
  if (step === 0) throw new EvalError('A range needs a non-zero step')
  const n = Math.floor((end - start) / step + 1e-9) + 1
  if (n > MAX_LIST) throw new EvalError(`Lists can have at most ${MAX_LIST} elements`)
  if (n <= 0) return mkList([])
  const out: number[] = []
  for (let i = 0; i < n; i++) out.push(Number((start + i * step).toPrecision(15)))
  return mkList(out)
}

function compileRestrictions(c: Compiler, rs: Statement[]): ((L: Locals) => boolean) | undefined {
  if (!rs.length) return undefined
  const preds = rs.map((st) => {
    if (!st.ops.length || st.ops.includes('~')) throw new EvalError('Restrictions need a comparison, like {x>0}')
    const f = c.compile({ k: 'cmp', items: st.items, ops: st.ops as CompareOp[] })
    return (L: Locals) => { const v = f(L); return !isList(v) && truthy(v) }
  })
  return (L) => preds.every((p) => p(L))
}

// ---- regressions -------------------------------------------------------------

/** Model shapes that log mode linearises [DOC: Log Mode]. */
type LogForm =
  | { kind: 'exp-base'; a: string; b: string }   // a·b^x
  | { kind: 'exp-e'; a: string; b: string }      // a·e^(b·x)
  | { kind: 'power'; a: string; b: string }      // a·x^b

function logForm(rhs: Node, params: Set<string>, xName: string): LogForm | undefined {
  if (rhs.k !== 'bin' || rhs.op !== '*') return undefined
  const sides: [Node, Node][] = [[rhs.a, rhs.b], [rhs.b, rhs.a]]
  for (const [coef, pow] of sides) {
    if (coef.k !== 'var' || !params.has(coef.name) || pow.k !== 'bin' || pow.op !== '^') continue
    const a = coef.name
    const { a: base, b: exp } = pow
    if (base.k === 'var' && params.has(base.name) && isVar(exp, xName)) return { kind: 'exp-base', a, b: base.name }
    if (isVar(base, xName) && exp.k === 'var' && params.has(exp.name)) return { kind: 'power', a, b: exp.name }
    if (isVar(base, 'e') && exp.k === 'bin' && exp.op === '*') {
      const k = [exp.a, exp.b].find((m) => m.k === 'var' && params.has(m.name)) as { name: string } | undefined
      if (k && [exp.a, exp.b].some((m) => isVar(m, xName))) return { kind: 'exp-e', a, b: k.name }
    }
  }
  return undefined
}

/** `m·x₁ + b` (either order) → the parameter names, for reporting r. */
function linearForm(rhs: Node, params: Set<string>, xName: string): boolean {
  if (rhs.k !== 'bin' || rhs.op !== '+') return false
  const isSlopeTerm = (n: Node) =>
    n.k === 'bin' && n.op === '*' &&
    ((n.a.k === 'var' && params.has(n.a.name) && isVar(n.b, xName)) || (n.b.k === 'var' && params.has(n.b.name) && isVar(n.a, xName)))
  const isParam = (n: Node) => n.k === 'var' && params.has(n.name)
  return (isSlopeTerm(rhs.a) && isParam(rhs.b)) || (isSlopeTerm(rhs.b) && isParam(rhs.a))
}

function regressionParams(st: Statement, defs: Map<string, Definition>): string[] {
  const out: string[] = []
  for (const n of [...namesIn(st.items[0]), ...namesIn(st.items[1])]) {
    if (RESERVED.has(n) || CONSTANTS[n] !== undefined || defs.has(n) || out.includes(n)) continue
    out.push(n)
  }
  return out
}

function runRegression(scope: Scope, st: Statement, row: number): RegressionRun {
  const [lhs, rhs] = st.items
  const params = [...scope.defs.values()].filter((d) => d.regression === row).map((d) => d.name)
  if (!params.length) throw new EvalError('This regression has no parameters to fit')
  const pset = new Set(params)

  const yc = new Compiler(scope, new Set())
  const yv = yc.compile(lhs)({})
  if (yc.missing.size) throw new EvalError(`"${[...yc.missing][0]}" is not defined`)
  if (!isList(yv)) throw new EvalError('Regressions need list data, like a table column: y_1 ~ mx_1 + b')
  const ys = numbers(yv)

  const mc = new Compiler(scope, pset)
  const model = mc.compile(rhs)
  if (mc.missing.size) throw new EvalError(`"${[...mc.missing][0]}" is not defined`)

  // The data variable the model is "in" (for plotting and log mode).
  const listVars = [...namesIn(rhs)].filter((n) => !pset.has(n) && scope.defs.has(n) && isList(safeValue(scope, n)))
  const xName = listVars.length === 1 ? listVars[0] : undefined

  const evalModel = (p: number[]): number[] => {
    const L: Locals = {}
    params.forEach((name, i) => (L[name] = p[i]))
    const v = model(L)
    return isList(v) ? numbers(v) : ys.map(() => num(v))
  }

  // Parameter bounds from simple restrictions, e.g. {1 < b < 5}.
  const bounds: Bounds = params.map(() => undefined)
  for (const r of st.restrictions) {
    for (let i = 0; i < r.ops.length; i++) {
      const [a, b] = [r.items[i], r.items[i + 1]]
      const op = r.ops[i]
      const constVal = (n: Node) => { const c = new Compiler(scope, new Set()); const v = c.compile(n)({}); return c.missing.size ? NaN : num(v) }
      for (const [pn, other, pIsLeft] of [[a, b, true], [b, a, false]] as const) {
        if (pn.k !== 'var' || !pset.has(pn.name)) continue
        const v = constVal(other)
        if (!Number.isFinite(v)) continue
        const k = params.indexOf(pn.name)
        const cur = bounds[k] ?? [-Infinity, Infinity]
        const upper = (op === '<' || op === '<=') === pIsLeft
        bounds[k] = upper ? [cur[0], Math.min(cur[1], v)] : [Math.max(cur[0], v), cur[1]]
      }
    }
  }

  const xs = xName ? numbers(safeValue(scope, xName)) : []
  const n = Math.min(ys.length, xName ? xs.length : ys.length)
  const keep = Array.from({ length: n }, (_, i) => i).filter((i) => Number.isFinite(ys[i]) && (!xName || Number.isFinite(xs[i])))
  if (keep.length < params.length) throw new EvalError('Not enough data points for this regression')

  // Log mode: fit a linear model to log-transformed data.
  const form = scope.logMode && xName ? logForm(rhs, pset, xName) : undefined
  if (form && keep.every((i) => ys[i] > 0 && (form.kind !== 'power' || xs[i] > 0))) {
    const tx = keep.map((i) => (form.kind === 'power' ? Math.log(xs[i]) : xs[i]))
    const ty = keep.map((i) => Math.log(ys[i]))
    const sol = solveLS(tx.map((t) => [t, 1]), ty)
    if (sol) {
      const [slope, icept] = sol
      const values = new Map(params.map((p) => [p, NaN] as [string, number]))
      values.set(form.a, Math.exp(icept))
      values.set(form.b, form.kind === 'exp-base' ? Math.exp(slope) : slope)
      const r = corr(tx, ty)
      return {
        values,
        xName,
        result: { params: params.map((p) => ({ name: p, value: values.get(p)! })), stats: [{ name: 'r2', value: r * r }, { name: 'r', value: r }], logMode: true },
      }
    }
  }

  const residuals = (p: number[]) => { const m = evalModel(p); return keep.map((i) => ys[i] - m[i]) }
  const f = fit(residuals, params.length, bounds, row + 1)
  if (!f || !f.params.every(Number.isFinite)) throw new EvalError('Could not find a fit for this model')
  // Round-off dust (b = 2.9×10⁻¹⁵ for exact data) reads as 0.
  const scale = Math.max(1, ...keep.map((i) => Math.abs(ys[i])), ...(xName ? keep.map((i) => Math.abs(xs[i])) : []))
  const clean = f.params.map((v) => (Math.abs(v) < 1e-11 * scale ? 0 : v))
  const values = new Map(params.map((p, i) => [p, clean[i]] as [string, number]))
  const yk = keep.map((i) => ys[i])
  const ym = yk.reduce((s, y) => s + y, 0) / yk.length
  const sst = yk.reduce((s, y) => s + (y - ym) ** 2, 0)
  const r2 = sst > 0 ? 1 - f.sse / sst : NaN
  const stats: RegressionResult['stats'] = []
  if (xName && linearForm(rhs, pset, xName)) {
    const r = corr(keep.map((i) => xs[i]), yk)
    stats.push({ name: 'r2', value: r * r }, { name: 'r', value: r })
  } else stats.push({ name: 'R2', value: r2 })
  return { values, xName, result: { params: params.map((p) => ({ name: p, value: values.get(p)! })), stats, logMode: false } }
}

function safeValue(scope: Scope, name: string): Value {
  try { return scope.varValue(name) } catch { return NaN }
}

// ---- analysis --------------------------------------------------------------

type Parsed =
  | { item: ExpressionItem; st?: Statement; error?: string }
  | { item: TableItem; headers: ({ st: Statement } | { error: string })[]; cells: (Node | undefined)[][] }

function parseCell(latex: string): Node | undefined {
  if (!latex.trim()) return undefined
  try {
    const st = parseStatement(latex)
    return st.ops.length || st.restrictions.length ? undefined : st.items[0]
  } catch {
    return undefined
  }
}

export function analyze(state: GraphState): Analysis {
  const parsed: Parsed[] = state.items.map((item: GraphItem) => {
    if (item.type === 'table') {
      return {
        item,
        headers: item.columns.map((c) => {
          try { return { st: parseStatement(c.latex) } } catch (e) { return { error: e instanceof ParseError ? e.message : 'Invalid header' } }
        }),
        cells: item.columns.map((c) => c.values.map(parseCell)),
      }
    }
    if (!item.latex.trim()) return { item }
    try {
      return { item, st: parseStatement(item.latex) }
    } catch (e) {
      return { item, error: e instanceof ParseError ? e.message : 'Invalid expression' }
    }
  })

  const defs = new Map<string, Definition>()
  const duplicates = new Set<string>()
  const add = (d: Definition) => {
    if (defs.has(d.name)) duplicates.add(d.name)
    else defs.set(d.name, d)
  }
  const statements: (Statement | undefined)[] = []
  parsed.forEach((p, i) => {
    if ('headers' in p) {
      p.headers.forEach((h, c) => {
        if ('st' in h && !h.st.ops.length && h.st.items[0].k === 'var' && !RESERVED.has(h.st.items[0].name)) {
          add({ row: i, name: h.st.items[0].name, cells: p.cells[c] })
        }
      })
      return
    }
    statements[i] = p.st
    const d = definitionOf(p.st, i)
    if (d) add(d)
  })
  // Regression parameters: names a `~` row uses that nothing else defines.
  parsed.forEach((p, i) => {
    if ('headers' in p || !p.st || p.st.ops.length !== 1 || p.st.ops[0] !== '~') return
    for (const name of regressionParams(p.st, defs)) add({ row: i, name, regression: i })
  })

  const scope = new Scope(defs, duplicates, state.settings.degrees, !!state.settings.logModeRegressions, statements)
  const sliderNames = new Set([...defs.values()].filter((d) => d.literal !== undefined).map((d) => d.name))

  const rows = parsed.map((p, i): RowResult => {
    const id = p.item.id
    if ('headers' in p) return classifyTable(p, scope)
    if (p.error) return { id, error: p.error }
    if (!p.st) return { id }
    try {
      return classify(id, p.st, scope, sliderNames, i)
    } catch (e) {
      return { id, error: e instanceof EvalError ? e.message : 'Invalid expression' }
    }
  })
  return { rows, byId: new Map(rows.map((r) => [r.id, r])) }
}

function classifyTable(p: Extract<Parsed, { headers: unknown }>, scope: Scope): RowResult {
  const { item } = p
  const columns: ColumnResult[] = []
  const lists: (number[] | undefined)[] = []
  p.headers.forEach((h, c) => {
    if ('error' in h) { columns.push({ error: h.error }); lists.push(undefined); return }
    const head = h.st.items[0]
    if (h.st.ops.length) { columns.push({ error: 'Column headers are a variable or an expression' }); lists.push(undefined); return }
    try {
      if (head.k === 'var' && scope.defs.get(head.name)?.cells === p.cells[c]) {
        columns.push({})
        lists.push(numbers(scope.varValue(head.name)))
        return
      }
      if (head.k === 'var' && scope.duplicates.has(head.name)) throw new EvalError(`"${head.name}" is defined more than once`)
      const comp = new Compiler(scope, new Set())
      const v = comp.compile(head)({})
      if (comp.missing.size) { columns.push({ missing: [...comp.missing] }); lists.push(undefined); return }
      const vals = numbers(isList(v) ? v : mkList(item.columns[0].values.map(() => num(v))))
      columns.push({ computed: vals })
      lists.push(vals)
    } catch (e) {
      columns.push({ error: e instanceof EvalError ? e.message : 'Invalid column' })
      lists.push(undefined)
    }
  })

  const points: PlotPoint[] = []
  const xs = lists[0]
  if (xs) {
    item.columns.forEach((col, c) => {
      if (c === 0 || col.hidden || !lists[c]) return
      const ys = lists[c]!
      let first = true
      for (let i = 0; i < Math.min(xs.length, ys.length); i++) {
        if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) { first = true; continue }
        points.push({ x: xs[i], y: ys[i], color: col.color, line: !!col.lines && !first })
        first = false
      }
    })
  }
  return { id: item.id, columns, points }
}

/** y = f(x) where f may be list-valued → one curve per element. */
function curvesOf(f: Compiled, indep: 'x' | 'y', restrict?: (x: number, y: number) => boolean, dashed?: boolean): Curve[] {
  const orientation = indep === 'x' ? 'y' : 'x'
  let probe: Value = NaN
  for (const t of [0.37, 1.73, -2.41, 0]) { probe = f({ [indep]: t }); if (isList(probe) || Number.isFinite(num(probe))) break }
  if (isPt(probe as Scalar) && !isList(probe)) throw new EvalError('A point cannot be graphed as a curve')
  if (isList(probe)) {
    return probe.list.map((_, i) => ({
      orientation,
      fn: (t: number) => { const v = f({ [indep]: t }); return num(isList(v) ? v.list[i] ?? NaN : v) },
      restrict, dashed,
    }))
  }
  return [{ orientation, fn: (t: number) => num(f({ [indep]: t })), restrict, dashed }]
}

function pointsOf(v: Value, drag?: { dx?: string; dy?: string }): PlotPoint[] {
  const one = (s: Scalar): PlotPoint | undefined => (isPt(s) ? { x: s[0], y: s[1], dragX: drag?.dx, dragY: drag?.dy } : undefined)
  if (isList(v)) return v.list.map(one).filter((p): p is PlotPoint => !!p)
  const p = one(v as Scalar)
  return p ? [p] : []
}

function classify(id: string, st: Statement, scope: Scope, sliderNames: Set<string>, row: number): RowResult {
  const missingOf = (c: Compiler): RowResult | undefined => (c.missing.size ? { id, missing: [...c.missing] } : undefined)

  // Regression: `y₁ ~ model`.
  if (st.ops.includes('~')) {
    if (st.ops.length !== 1) throw new EvalError('Use one ~ per regression')
    const run = scope.regression(row)
    const result: RowResult = { id, regression: run.result }
    if (run.xName) {
      const c = new Compiler(scope, new Set(['x']), new Map([[run.xName, 'x']]))
      const f = c.compile(st.items[1])
      result.curves = [{ orientation: 'y', fn: (x) => num(f({ x })) }]
    }
    return result
  }

  const def = definitionOf(st, row)
  if (def) {
    if (scope.duplicates.has(def.name)) throw new EvalError(`"${def.name}" is defined more than once`)
    if (def.params) {
      const c = new Compiler(scope, new Set(def.params))
      const body = c.compile(def.body!)
      const m = missingOf(c)
      if (m) return m
      // f(x) = … also graphs when its one parameter is x.
      if (def.params.length === 1 && def.params[0] === 'x' && !usesName(def.body!, 'y')) return { id, curves: curvesOf(body, 'x') }
      return { id }
    }
    if (def.literal !== undefined) return { id, slider: { name: def.name, value: def.literal } }
    const c = new Compiler(scope, new Set())
    c.compile(def.body!)
    const m = missingOf(c)
    if (m) return m
    const value = scope.varValue(def.name)
    const pts = pointsOf(value)
    return pts.length ? { id, value, points: pts } : { id, value }
  }

  const c = new Compiler(scope, new Set(['x', 'y']))
  const restrict = compileRestrictions(c, st.restrictions)
  const restrictFn = restrict && ((x: number, y: number) => restrict({ x, y }))

  if (st.ops.length === 0) {
    const n = st.items[0]
    if (n.k === 'list' || n.k === 'point') {
      const items = n.k === 'list' ? n.items : [n]
      const pts: PlotPoint[] = []
      for (const p of items) {
        if (p.k !== 'point') throw new EvalError('Only points can be separated by commas')
        const dx = p.items[0], dy = p.items[1]
        const v = c.compile(p)({})
        pts.push(...pointsOf(v, {
          dx: dx.k === 'var' && sliderNames.has(dx.name) ? dx.name : undefined,
          dy: dy.k === 'var' && sliderNames.has(dy.name) ? dy.name : undefined,
        }))
      }
      return missingOf(c) ?? { id, points: pts }
    }
    const f = c.compile(n)
    const m = missingOf(c)
    if (m) return m
    if (c.used.has('y')) throw new EvalError('Add an equals sign to graph this, e.g. y = …')
    // A bare expression in x graphs as y = f(x) [INF, GRAPH-SPEC §4 item 14].
    if (c.used.has('x')) return { id, curves: curvesOf(f, 'x', restrictFn) }
    const value = f({})
    const pts = pointsOf(value)
    return pts.length ? { id, value, points: pts } : { id, value }
  }

  const ops = st.ops as CompareOp[]
  const equation = ops.length === 1 && ops[0] === '='

  if (equation) {
    const [lhs, rhs] = st.items
    const explicit = (dep: 'y' | 'x', side: Node): RowResult => {
      const f = c.compile(side)
      return missingOf(c) ?? { id, curves: curvesOf(f, dep === 'y' ? 'x' : 'y', restrictFn) }
    }
    if (isVar(lhs, 'y') && !usesName(rhs, 'y')) return explicit('y', rhs)
    if (isVar(rhs, 'y') && !usesName(lhs, 'y')) return explicit('y', lhs)
    if (isVar(lhs, 'x') && !usesName(rhs, 'x')) return explicit('x', rhs)
    if (isVar(rhs, 'x') && !usesName(lhs, 'x')) return explicit('x', lhs)
    // Implicit: F(x, y) = lhs − rhs = 0 [DOC item 11].
    const F = c.compile({ k: 'bin', op: '-', a: lhs, b: rhs })
    const m = missingOf(c)
    if (m) return m
    if (!c.used.has('x') && !c.used.has('y')) throw new EvalError('Equations need x or y to graph')
    return { id, implicits: implicitsOf(F, restrictFn) }
  }

  if (ops.includes('=')) throw new EvalError('Mix = with < or > using restrictions, e.g. y=x{x>0}')

  // Inequalities [DOC]: strict → dashed boundary, non-strict → solid.
  const strictAt = (i: number) => ops[i] === '<' || ops[i] === '>'
  const items = st.items
  const parts = items.map((n) => c.compile(n))
  const m = missingOf(c)
  if (m) return m
  if (!c.used.has('x') && !c.used.has('y')) throw new EvalError('Inequalities need x or y to graph')

  const test = (x: number, y: number) => {
    if (restrictFn && !restrictFn(x, y)) return false
    const L = { x, y }
    for (let i = 0; i < ops.length; i++) if (!compare(ops[i], num(parts[i](L)), num(parts[i + 1](L)))) return false
    return true
  }

  // Boundaries: explicit where a side is just y (or x), implicit otherwise.
  const curves: Curve[] = []
  const implicits: Implicit[] = []
  for (let i = 0; i < ops.length; i++) {
    const [a, b] = [items[i], items[i + 1]]
    const dashed = strictAt(i)
    const plain = (dep: 'y' | 'x', other: Node, f: Compiled) => {
      if (usesName(other, dep)) return false
      curves.push(...curvesOf(f, dep === 'y' ? 'x' : 'y', restrictFn, dashed))
      return true
    }
    if (isVar(a, 'y') && plain('y', b, parts[i + 1])) continue
    if (isVar(b, 'y') && plain('y', a, parts[i])) continue
    if (isVar(a, 'x') && plain('x', b, parts[i + 1])) continue
    if (isVar(b, 'x') && plain('x', a, parts[i])) continue
    const F = (L: Locals) => lift2(parts[i](L), parts[i + 1](L), (p, q) => num(p) - num(q))
    implicits.push(...implicitsOf(F, restrictFn, dashed))
  }
  return { id, region: { test }, curves, implicits }
}

function implicitsOf(F: (L: Locals) => Value, restrict?: (x: number, y: number) => boolean, dashed?: boolean): Implicit[] {
  const probe = F({ x: 0.37, y: 0.53 })
  if (isList(probe)) {
    return probe.list.map((_, i) => ({ f: (x: number, y: number) => num(pick(F({ x, y }), i)), restrict, dashed }))
  }
  return [{ f: (x: number, y: number) => num(F({ x, y })), restrict, dashed }]
}
