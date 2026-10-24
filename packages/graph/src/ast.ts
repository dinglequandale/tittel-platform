// Expression tree produced by parse.ts from MathQuill LaTeX.

export type CompareOp = '<' | '>' | '<=' | '>=' | '='
/** Statement-level relations: comparisons plus `~` (regression). */
export type RelOp = CompareOp | '~'

export type Node =
  | { k: 'num'; v: number }
  /** A variable or constant: `x`, `a`, `x_1`, `theta`, `pi`. */
  | { k: 'var'; name: string }
  | { k: 'bin'; op: '+' | '-' | '*' | '/' | '^'; a: Node; b: Node }
  | { k: 'neg'; a: Node }
  | { k: 'fact'; a: Node }
  | { k: 'abs'; a: Node }
  | { k: 'sqrt'; a: Node; index?: Node }
  /** A built-in function: sin, log, nthroot … `base` is a subscript (`log_2 x`).
   *  A superscript on the name (`sin^2 x`) parses as a power of the call. */
  | { k: 'call'; fn: string; args: Node[]; base?: Node }
  /** `name(args)`: a user function call or, if `name` is not a function,
   *  multiplication (`a(x+1)`). Resolved at analysis time. */
  | { k: 'apply'; name: string; args: Node[] }
  | { k: 'point'; items: Node[] }
  /** Comma-separated items at the top level, e.g. several points. */
  | { k: 'list'; items: Node[] }
  /** `[a, b, c]` */
  | { k: 'listlit'; items: Node[] }
  /** `[a...b]` or `[a, b...c]`; `end` is absent only inside an index (`L[3...]`). */
  | { k: 'range'; start: Node; second?: Node; end?: Node }
  /** `L[i]`, `L[1,3]`, `L[2...4]`, `L[L>0]` (a cmp index filters). */
  | { k: 'index'; a: Node; idx: Node }
  /** `{c₁: v₁, c₂: v₂, else}`; a branch without a value yields 1. */
  | { k: 'piecewise'; branches: { cond: Node; value?: Node }[]; otherwise?: Node }
  /** A comparison chain used as a value: 1 when it holds, else 0. */
  | { k: 'cmp'; items: Node[]; ops: CompareOp[] }

/** One expression line after parsing. */
export interface Statement {
  /** Operands of a relation chain: `a < b <= c` → items [a,b,c], ops ['<','<=']. */
  items: Node[]
  ops: RelOp[]
  /** Each `{…}` at the end of the line; all must hold (AND). */
  restrictions: Statement[]
}

export class ParseError extends Error {}
