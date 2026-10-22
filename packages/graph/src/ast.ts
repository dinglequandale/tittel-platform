// Expression tree produced by parse.ts from MathQuill LaTeX.

export type CompareOp = '<' | '>' | '<=' | '>=' | '='

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

/** One expression line after parsing. */
export interface Statement {
  /** Operands of a relation chain: `a < b <= c` → items [a,b,c], ops ['<','<=']. */
  items: Node[]
  ops: CompareOp[]
  /** Each `{…}` at the end of the line; all must hold (AND). */
  restrictions: Statement[]
}

export class ParseError extends Error {}
