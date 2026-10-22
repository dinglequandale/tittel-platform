// Recursive-descent parser: MathQuill LaTeX → Statement (GRAPH-SPEC §2.2, §4).
import { ParseError, type CompareOp, type Node, type Statement } from './ast.ts'
import { tokenize, type Tok } from './latex.ts'
import { FUNCTION_NAMES, GREEK } from './builtins.ts'

const RELATIONS = new Set(['<', '>', '<=', '>=', '='])

export function parseStatement(latex: string): Statement {
  const p = new Parser(tokenize(latex))
  const st = p.statement()
  if (!p.done()) throw new ParseError(`Unexpected "${p.peekText()}"`)
  return st
}

class Parser {
  private i = 0
  constructor(private toks: Tok[]) {}

  done() { return this.i >= this.toks.length }
  peek(): Tok | undefined { return this.toks[this.i] }
  peekText() { const t = this.peek(); return t ? t.v : 'end' }
  next(): Tok {
    const t = this.toks[this.i++]
    if (!t) throw new ParseError('Incomplete expression')
    return t
  }
  isSym(v: string, t = this.peek()) { return t?.t === 'sym' && t.v === v }
  eat(v: string) { if (this.isSym(v)) { this.i++; return true } return false }
  expect(v: string) {
    if (!this.eat(v)) throw new ParseError(this.done() ? 'Incomplete expression' : `Expected "${v}"`)
  }

  statement(endSym?: string): Statement {
    const items: Node[] = [this.commaList(endSym)]
    const ops: CompareOp[] = []
    for (let t = this.peek(); t?.t === 'sym' && RELATIONS.has(t.v); t = this.peek()) {
      this.i++
      ops.push(t.v as CompareOp)
      items.push(this.commaList(endSym))
    }
    const restrictions: Statement[] = []
    while (!endSym && this.eat('{{')) {
      restrictions.push(this.statement('}}'))
      this.expect('}}')
    }
    return { items, ops, restrictions }
  }

  // Top level only: `(1,2),(3,4)` is a list of points.
  commaList(endSym?: string): Node {
    const first = this.expr()
    if (endSym || !this.isSym(',')) return first
    const items = [first]
    while (this.eat(',')) items.push(this.expr())
    return { k: 'list', items }
  }

  expr(): Node {
    let left = this.term()
    for (;;) {
      if (this.eat('+')) left = { k: 'bin', op: '+', a: left, b: this.term() }
      else if (this.eat('-')) left = { k: 'bin', op: '-', a: left, b: this.term() }
      else return left
    }
  }

  term(): Node {
    let left = this.unary()
    for (;;) {
      if (this.eat('*')) left = { k: 'bin', op: '*', a: left, b: this.unary() }
      else if (this.eat('/')) left = { k: 'bin', op: '/', a: left, b: this.unary() }
      else if (this.startsFactor()) left = { k: 'bin', op: '*', a: left, b: this.power() }
      else return left
    }
  }

  unary(): Node {
    if (this.eat('-')) return { k: 'neg', a: this.unary() }
    if (this.eat('+')) return this.unary()
    return this.power()
  }

  power(): Node {
    const base = this.postfix()
    if (this.eat('^')) return { k: 'bin', op: '^', a: base, b: this.exponent() }
    return base
  }

  exponent(): Node {
    if (this.eat('{')) {
      const e = this.expr()
      this.expect('}')
      return e
    }
    // Unbraced: a single character (MathQuill braces anything longer).
    const t = this.next()
    if (t.t === 'num') return { k: 'num', v: Number(t.v[0]) }
    if (t.t === 'sym' && t.v === '-') return { k: 'neg', a: this.exponent() }
    this.i--
    return this.atom()
  }

  postfix(): Node {
    let a = this.atom()
    while (this.eat('!')) a = { k: 'fact', a }
    return a
  }

  startsFactor(t = this.peek()): boolean {
    if (!t) return false
    if (t.t === 'num' || t.t === 'letter' || t.t === 'cmd') return true
    return t.t === 'sym' && (t.v === '(' || t.v === 'absL' || t.v === '{' || t.v === 'bar')
  }

  isFunctionToken(t = this.peek()): boolean {
    return t?.t === 'cmd' && FUNCTION_NAMES.has(t.v)
  }

  atom(): Node {
    const t = this.next()
    if (t.t === 'num') return { k: 'num', v: Number(t.v) }
    if (t.t === 'letter') return this.identifier(t.v)
    if (t.t === 'cmd') return this.command(t.v)
    switch (t.v) {
      case '(': {
        const items = [this.expr()]
        while (this.eat(',')) items.push(this.expr())
        this.expect(')')
        if (items.length === 1) return items[0]
        if (items.length === 2) return { k: 'point', items }
        throw new ParseError('Points can only have 2 coordinates')
      }
      case 'absL': {
        const a = this.expr()
        this.expect('absR')
        return { k: 'abs', a }
      }
      case 'bar': {
        const a = this.expr()
        this.expect('bar')
        return { k: 'abs', a }
      }
      case '{': {
        const a = this.expr()
        this.expect('}')
        return a
      }
    }
    throw new ParseError(this.done() && RELATIONS.has(t.v) ? 'Incomplete expression' : `Unexpected "${t.v}"`)
  }

  subscript(): string {
    // x_1, x_{12}, a_{bc}
    if (this.eat('{')) {
      let s = ''
      while (!this.isSym('}')) {
        const t = this.next()
        if (t.t !== 'num' && t.t !== 'letter') throw new ParseError('Subscripts can only contain letters and numbers')
        s += t.v
      }
      this.expect('}')
      return s
    }
    const t = this.next()
    if (t.t !== 'num' && t.t !== 'letter') throw new ParseError('Bad subscript')
    return t.v
  }

  identifier(letter: string): Node {
    let name = letter
    if (this.eat('_')) name += '_' + this.subscript()
    if (this.isSym('(')) {
      // Could be f(x) or a(x+1): decided later, once definitions are known.
      this.i++
      const args = [this.expr()]
      while (this.eat(',')) args.push(this.expr())
      this.expect(')')
      return { k: 'apply', name, args }
    }
    return { k: 'var', name }
  }

  command(name: string): Node {
    if (name === 'frac') {
      this.expect('{'); const a = this.expr(); this.expect('}')
      this.expect('{'); const b = this.expr(); this.expect('}')
      return { k: 'bin', op: '/', a, b }
    }
    if (name === 'sqrt') {
      let index: Node | undefined
      if (this.eat('[')) { index = this.expr(); this.expect(']') }
      this.expect('{'); const a = this.expr(); this.expect('}')
      return { k: 'sqrt', a, index }
    }
    if (name === 'pi' || name === 'tau') return { k: 'var', name }
    if (name === 'infty' || name === 'infinity') return { k: 'num', v: Infinity }
    if (GREEK.has(name)) return this.identifier(name)
    if (FUNCTION_NAMES.has(name)) return this.functionCall(name)
    throw new ParseError(`"${name}" is not a function`)
  }

  functionCall(name: string): Node {
    let fn = name
    let power: Node | undefined
    let base: Node | undefined
    for (;;) {
      if (this.eat('^')) {
        const p = this.exponent()
        // sin^{-1} is the inverse function, not 1/sin.
        if (p.k === 'neg' && p.a.k === 'num' && p.a.v === 1 && FUNCTION_NAMES.has('arc' + fn)) fn = 'arc' + fn
        else power = p
      } else if (this.eat('_')) {
        base = this.exponent()
      } else break
    }
    let args: Node[]
    if (this.eat('(')) {
      args = [this.expr()]
      while (this.eat(',')) args.push(this.expr())
      this.expect(')')
    } else {
      // Juxtaposition: `sin 2x` = sin(2x); stops at + − relations and at the
      // next function, so `sin x cos x` = sin(x)·cos(x).
      if (!this.startsFactor() && !this.isSym('-')) throw new ParseError(`Function "${name}" requires an argument`)
      let arg: Node = this.eat('-') ? { k: 'neg', a: this.power() } : this.power()
      while (this.startsFactor() && !this.isFunctionToken()) arg = { k: 'bin', op: '*', a: arg, b: this.power() }
      args = [arg]
    }
    const call: Node = { k: 'call', fn, args, base }
    return power ? { k: 'bin', op: '^', a: call, b: power } : call
  }
}
