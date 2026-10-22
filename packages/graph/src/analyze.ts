// Whole-graph analysis: parse every row, resolve definitions across rows,
// compile to closures, and classify each row (GRAPH-SPEC §4 items 10–15, 26–27).
import { ParseError, type Node, type Statement } from './ast.ts'
import { parseStatement } from './parse.ts'
import { BUILTINS, CONSTANTS, factorial, nthRoot, realPow } from './builtins.ts'
import type { GraphState, GraphItem } from './state.ts'

export type Pt = [number, number]
export type Value = number | Pt
export type Locals = Record<string, number>
type Compiled = (L: Locals) => Value

export interface Curve {
  /** 'y': y = fn(x).  'x': x = fn(y). */
  orientation: 'y' | 'x'
  fn: (t: number) => number
  /** Restrictions `{…}`: the curve is drawn only where this holds. */
  restrict?: (x: number, y: number) => boolean
}

export interface PlotPoint {
  x: number
  y: number
  /** Slider variable this coordinate drags, when it is one (GRAPH-SPEC item 27). */
  dragX?: string
  dragY?: string
}

export interface RowResult {
  id: string
  error?: string
  /** Undefined variables, in order of appearance → the "add slider" prompt. */
  missing?: string[]
  slider?: { name: string; value: number }
  /** Shown as "= value" at the right of the row. */
  value?: Value
  curve?: Curve
  points?: PlotPoint[]
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
  body: Node
  /** `a = 3` (a plain number) → a slider. */
  literal?: number
}

function numericLiteral(n: Node): number | undefined {
  if (n.k === 'num') return n.v
  if (n.k === 'neg' && n.a.k === 'num') return -n.a.v
  return undefined
}

function definitionOf(st: Statement | undefined, row: number): Definition | undefined {
  if (!st || st.ops.length !== 1 || st.ops[0] !== '=') return undefined
  const [lhs, body] = st.items
  if (lhs.k === 'var' && !RESERVED.has(lhs.name)) {
    return { row, name: lhs.name, body, literal: numericLiteral(body) }
  }
  if (lhs.k === 'apply' && !RESERVED.has(lhs.name) && lhs.args.every((a) => a.k === 'var')) {
    const params = lhs.args.map((a) => (a as { name: string }).name)
    if (new Set(params).size === params.length) return { row, name: lhs.name, params, body }
  }
  return undefined
}

function isPoint(v: Value): v is Pt { return typeof v !== 'number' }
const num = (v: Value): number => (typeof v === 'number' ? v : NaN)

function add(a: Value, b: Value, sign: 1 | -1): Value {
  if (isPoint(a) && isPoint(b)) return [a[0] + sign * b[0], a[1] + sign * b[1]]
  if (isPoint(a) || isPoint(b)) return NaN
  return a + sign * b
}
function mul(a: Value, b: Value): Value {
  if (isPoint(a) && !isPoint(b)) return [a[0] * b, a[1] * b]
  if (!isPoint(a) && isPoint(b)) return [a * b[0], a * b[1]]
  if (isPoint(a) || isPoint(b)) return NaN
  return a * b
}
function div(a: Value, b: Value): Value {
  if (isPoint(b)) return NaN
  if (isPoint(a)) return [a[0] / b, a[1] / b]
  return a / b
}

/** Shared per-analysis state: definitions and their lazily computed values. */
class Scope {
  private values = new Map<string, Value>()
  private visiting = new Set<string>()
  private fns = new Map<string, { params: string[]; body: Compiled }>()
  depth = 0

  constructor(
    readonly defs: Map<string, Definition>,
    readonly duplicates: Set<string>,
    readonly degrees: boolean,
  ) {}

  varValue(name: string): Value {
    const cached = this.values.get(name)
    if (cached !== undefined) return cached
    if (this.visiting.has(name)) throw new EvalError(`"${name}" is defined in terms of itself`)
    const def = this.defs.get(name)!
    this.visiting.add(name)
    try {
      const c = new Compiler(this, new Set())
      const f = c.compile(def.body)
      if (c.missing.size) throw new EvalError(`"${[...c.missing][0]}" is not defined`)
      const v = f({})
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
        f = { params: def.params!, body: c.compile(def.body) }
        this.fns.set(name, f)
      } finally {
        this.visiting.delete(name)
      }
    }
    return f
  }
}

class Compiler {
  missing = new Set<string>()
  used = new Set<string>()
  constructor(private scope: Scope, private locals: Set<string>) {}

  compile(n: Node): Compiled {
    switch (n.k) {
      case 'num': { const v = n.v; return () => v }
      case 'var': return this.variable(n.name)
      case 'neg': { const a = this.compile(n.a); return (L) => mul(a(L), -1) }
      case 'fact': { const a = this.compile(n.a); return (L) => factorial(num(a(L))) }
      case 'abs': {
        const a = this.compile(n.a)
        return (L) => { const v = a(L); return isPoint(v) ? Math.hypot(v[0], v[1]) : Math.abs(v) }
      }
      case 'sqrt': {
        const a = this.compile(n.a)
        if (!n.index) return (L) => Math.sqrt(num(a(L)))
        const k = this.compile(n.index)
        return (L) => nthRoot(num(a(L)), num(k(L)))
      }
      case 'bin': {
        const a = this.compile(n.a)
        const b = this.compile(n.b)
        switch (n.op) {
          case '+': return (L) => add(a(L), b(L), 1)
          case '-': return (L) => add(a(L), b(L), -1)
          case '*': return (L) => mul(a(L), b(L))
          case '/': return (L) => div(a(L), b(L))
          case '^': return (L) => realPow(num(a(L)), num(b(L)))
        }
      }
      case 'point': {
        if (n.items.length !== 2) throw new EvalError('Points need exactly 2 coordinates')
        const [px, py] = n.items.map((it) => this.compile(it))
        return (L) => [num(px(L)), num(py(L))]
      }
      case 'list': throw new EvalError('Lists are not supported here yet')
      case 'call': return this.call(n.fn, n.args, n.base)
      case 'apply': return this.apply(n.name, n.args)
    }
  }

  private variable(name: string): Compiled {
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
      // x or y outside a curve context
      this.used.add(name)
      return () => NaN
    }
    if (name === 'theta' || name === 'r') throw new EvalError('Polar graphs are not supported yet')
    this.missing.add(name)
    return () => NaN
  }

  private call(fn: string, args: Node[], base?: Node): Compiled {
    const b = BUILTINS[fn]
    const [lo, hi] = typeof b.arity === 'number' ? [b.arity, b.arity] : b.arity
    if (args.length < lo || args.length > hi) {
      throw new EvalError(`"${fn}" takes ${lo === hi ? lo : `${lo}–${hi}`} argument${hi === 1 ? '' : 's'}`)
    }
    const cs = args.map((a) => this.compile(a))
    const ctx = { degrees: this.scope.degrees }
    if (fn === 'log' && base) {
      const bc = this.compile(base)
      return (L) => Math.log(num(cs[0](L))) / Math.log(num(bc(L)))
    }
    if (cs.length === 1) {
      const [c] = cs
      return (L) => b.fn([num(c(L))], ctx)
    }
    return (L) => b.fn(cs.map((c) => num(c(L))), ctx)
  }

  private apply(name: string, args: Node[]): Compiled {
    const def = this.scope.defs.get(name)
    if (def?.params && !this.locals.has(name)) {
      if (def.params.length !== args.length) {
        throw new EvalError(`"${name}" takes ${def.params.length} argument${def.params.length === 1 ? '' : 's'}`)
      }
      const cs = args.map((a) => this.compile(a))
      const scope = this.scope
      const name_ = name
      return (L) => {
        const f = scope.fn(name_)
        if (scope.depth > MAX_CALL_DEPTH) return NaN
        const inner: Locals = {}
        for (let i = 0; i < cs.length; i++) inner[f.params[i]] = num(cs[i](L))
        scope.depth++
        try { return f.body(inner) } finally { scope.depth-- }
      }
    }
    // Not a function: `a(x+1)` is multiplication; `a(1,2)` scales a point.
    const left = this.variable(name)
    const right = args.length === 1 ? this.compile(args[0]) : this.compile({ k: 'point', items: args })
    return (L) => mul(left(L), right(L))
  }
}

function compileRestrictions(c: Compiler, rs: Statement[]): ((L: Locals) => boolean) | undefined {
  if (!rs.length) return undefined
  const preds = rs.map((st) => {
    if (!st.ops.length) throw new EvalError('Restrictions need a comparison, like {x>0}')
    const parts = st.items.map((n) => c.compile(n))
    const ops = st.ops
    return (L: Locals) => {
      for (let i = 0; i < ops.length; i++) {
        const a = num(parts[i](L))
        const b = num(parts[i + 1](L))
        const op = ops[i]
        const ok = op === '<' ? a < b : op === '>' ? a > b : op === '<=' ? a <= b : op === '>=' ? a >= b : Math.abs(a - b) < 1e-9
        if (!ok) return false
      }
      return true
    }
  })
  return (L) => preds.every((p) => p(L))
}

function usesName(n: Node, name: string): boolean {
  switch (n.k) {
    case 'num': return false
    case 'var': return n.name === name
    case 'bin': return usesName(n.a, name) || usesName(n.b, name)
    case 'neg': case 'fact': case 'abs': return usesName(n.a, name)
    case 'sqrt': return usesName(n.a, name) || (!!n.index && usesName(n.index, name))
    case 'call': return n.args.some((a) => usesName(a, name)) || (!!n.base && usesName(n.base, name))
    case 'apply': return n.name === name || n.args.some((a) => usesName(a, name))
    case 'point': case 'list': return n.items.some((a) => usesName(a, name))
  }
}

const isVar = (n: Node, name: string) => n.k === 'var' && n.name === name

export function analyze(state: GraphState): Analysis {
  const parsed: { item: GraphItem; st?: Statement; error?: string }[] = state.items.map((item) => {
    if (!item.latex.trim()) return { item }
    try {
      return { item, st: parseStatement(item.latex) }
    } catch (e) {
      return { item, error: e instanceof ParseError ? e.message : 'Invalid expression' }
    }
  })

  const defs = new Map<string, Definition>()
  const duplicates = new Set<string>()
  parsed.forEach((p, i) => {
    const d = definitionOf(p.st, i)
    if (!d) return
    if (defs.has(d.name)) duplicates.add(d.name)
    else defs.set(d.name, d)
  })
  const scope = new Scope(defs, duplicates, state.settings.degrees)
  const sliderNames = new Set([...defs.values()].filter((d) => d.literal !== undefined).map((d) => d.name))

  const rows = parsed.map((p, i): RowResult => {
    const id = p.item.id
    if (p.error) return { id, error: p.error }
    if (!p.st) return { id }
    try {
      return classify(id, p.st, duplicates, scope, sliderNames, i)
    } catch (e) {
      return { id, error: e instanceof EvalError ? e.message : 'Invalid expression' }
    }
  })
  return { rows, byId: new Map(rows.map((r) => [r.id, r])) }
}

function classify(
  id: string,
  st: Statement,
  duplicates: Set<string>,
  scope: Scope,
  sliderNames: Set<string>,
  row: number,
): RowResult {
  const missingOf = (c: Compiler): RowResult | undefined =>
    c.missing.size ? { id, missing: [...c.missing] } : undefined

  const def = definitionOf(st, row)
  if (def) {
    if (duplicates.has(def.name)) throw new EvalError(`"${def.name}" is defined more than once`)
    if (def.params) {
      // f(x) = … is a definition; it also graphs when its one parameter is x.
      const c = new Compiler(scope, new Set(def.params))
      const body = c.compile(def.body)
      const m = missingOf(c)
      if (m) return m
      if (def.params.length === 1 && def.params[0] === 'x' && !usesName(def.body, 'y')) {
        return { id, curve: { orientation: 'y', fn: (x) => num(body({ x })) } }
      }
      return { id }
    }
    if (def.literal !== undefined) return { id, slider: { name: def.name, value: def.literal } }
    const c = new Compiler(scope, new Set())
    c.compile(def.body)
    const m = missingOf(c)
    if (m) return m
    const value = scope.varValue(def.name)
    return isPoint(value) ? { id, value, points: [{ x: value[0], y: value[1] }] } : { id, value }
  }

  const c = new Compiler(scope, new Set(['x', 'y']))
  const restrict = compileRestrictions(c, st.restrictions)
  const restrictFn = restrict && ((x: number, y: number) => restrict({ x, y }))

  if (st.ops.length === 0) {
    const n = st.items[0]
    if (n.k === 'list' || n.k === 'point') {
      const pts = (n.k === 'list' ? n.items : [n]).map((p) => {
        if (p.k !== 'point') throw new EvalError('Only points can be separated by commas')
        const v = c.compile(p)({})
        if (!isPoint(v)) throw new EvalError('Expected a point')
        const dx = p.items[0], dy = p.items[1]
        return {
          x: v[0], y: v[1],
          dragX: dx.k === 'var' && sliderNames.has(dx.name) ? dx.name : undefined,
          dragY: dy.k === 'var' && sliderNames.has(dy.name) ? dy.name : undefined,
        }
      })
      return missingOf(c) ?? { id, points: pts }
    }
    const f = c.compile(n)
    const m = missingOf(c)
    if (m) return m
    if (c.used.has('y')) throw new EvalError('Add an equals sign to graph this, e.g. y = …')
    // A bare expression in x graphs as y = f(x) [INF, GRAPH-SPEC §4 item 14].
    if (c.used.has('x')) return { id, curve: { orientation: 'y', fn: (x) => num(f({ x })), restrict: restrictFn } }
    return { id, value: f({}) }
  }

  if (st.ops.some((o) => o !== '=')) throw new EvalError('Inequalities are not supported yet')
  if (st.ops.length > 1) throw new EvalError('Too many equals signs')

  const [lhs, rhs] = st.items
  const orient = (dep: 'y' | 'x', side: Node): RowResult => {
    const indep = dep === 'y' ? 'x' : 'y'
    const f = c.compile(side)
    const m = missingOf(c)
    if (m) return m
    return { id, curve: { orientation: dep, fn: (t) => num(f({ [indep]: t })), restrict: restrictFn } }
  }
  if (isVar(lhs, 'y') && !usesName(rhs, 'y')) return orient('y', rhs)
  if (isVar(rhs, 'y') && !usesName(lhs, 'y')) return orient('y', lhs)
  if (isVar(lhs, 'x') && !usesName(rhs, 'x')) return orient('x', rhs)
  if (isVar(rhs, 'x') && !usesName(lhs, 'x')) return orient('x', lhs)

  // Neither side is just x or y: implicit curves arrive in G2.
  c.compile(lhs)
  c.compile(rhs)
  return missingOf(c) ?? { id, error: 'Equations like this are not supported yet' }
}
