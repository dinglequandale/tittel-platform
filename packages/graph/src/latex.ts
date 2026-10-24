// Tokenizer for the LaTeX dialect MathQuill emits (`.latex()`).
import { ParseError } from './ast.ts'

export type Tok =
  | { t: 'num'; v: string }
  | { t: 'letter'; v: string }
  /** `\name` or `\operatorname{name}`, name only. */
  | { t: 'cmd'; v: string }
  /** Operators and delimiters, normalised (see SYMBOL_CMDS / DELIMS). */
  | { t: 'sym'; v: string }

// Backslash commands that are really operators.
const SYMBOL_CMDS: Record<string, string> = {
  le: '<=', leq: '<=', ge: '>=', geq: '>=', lt: '<', gt: '>', ne: '!=',
  cdot: '*', times: '*', ast: '*', div: '/',
  to: '->', rightarrow: '->', sim: '~',
  ldots: '...', dots: '...', cdots: '...',
  quad: ' ', qquad: ' ',
}

// `\left` / `\right` delimiters. Absolute-value bars and set braces need their
// own tokens because the same character opens and closes.
const DELIMS: Record<string, string> = {
  '(': '(', ')': ')', '[': '[', ']': ']',
  '|': '|', '\\{': '{{', '\\}': '}}', '.': '',
  '\\lbrace': '{{', '\\rbrace': '}}',
}

export function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  const n = src.length
  while (i < n) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n') { i++; continue }

    if (/[0-9.]/.test(c)) {
      let j = i
      while (j < n && /[0-9]/.test(src[j])) j++
      if (src[j] === '.' && src[j + 1] !== '.') {
        j++
        while (j < n && /[0-9]/.test(src[j])) j++
      }
      if (j === i) {
        // A lone '.', or the start of an ellipsis.
        if (src.startsWith('...', i)) { out.push({ t: 'sym', v: '...' }); i += 3; continue }
        throw new ParseError('Unexpected "."')
      }
      out.push({ t: 'num', v: src.slice(i, j) })
      i = j
      continue
    }

    if (/[a-zA-Z]/.test(c)) { out.push({ t: 'letter', v: c }); i++; continue }

    if (c === '\\') {
      // \left / \right delimiters
      const lr = /^\\(left|right)(\\\{|\\\}|\\lbrace|\\rbrace|[()[\]|.])/.exec(src.slice(i))
      if (lr) {
        let d = DELIMS[lr[2]]
        if (d === '|') d = lr[1] === 'left' ? 'absL' : 'absR'
        if (d) out.push({ t: 'sym', v: d })
        i += lr[0].length
        continue
      }
      const word = /^\\([a-zA-Z]+)/.exec(src.slice(i))
      if (word) {
        const name = word[1]
        i += word[0].length
        if (name === 'operatorname') {
          const m = /^\s*\{([a-zA-Z]+)\}/.exec(src.slice(i))
          if (!m) throw new ParseError('Bad \\operatorname')
          out.push({ t: 'cmd', v: m[1] })
          i += m[0].length
          continue
        }
        if (name === 'mathrm' || name === 'text') {
          // \mathrm{abc} → treat like an operator name
          const m = /^\s*\{([a-zA-Z]+)\}/.exec(src.slice(i))
          if (m) { out.push({ t: 'cmd', v: m[1] }); i += m[0].length; continue }
        }
        const sym = SYMBOL_CMDS[name]
        if (sym === ' ') continue
        if (sym) { out.push({ t: 'sym', v: sym }); continue }
        out.push({ t: 'cmd', v: name })
        continue
      }
      // \{ \} \, \; \: \! \  \%
      const ch = src[i + 1]
      i += 2
      if (ch === '{') out.push({ t: 'sym', v: '{{' })
      else if (ch === '}') out.push({ t: 'sym', v: '}}' })
      else if (ch === '%') out.push({ t: 'sym', v: '%' })
      // spacing commands are dropped
      continue
    }

    if ('+-=<>()[],!^_{}|:\''.includes(c)) {
      // Plain-text comparisons (when typed outside MathQuill).
      if ((c === '<' || c === '>') && src[i + 1] === '=') { out.push({ t: 'sym', v: c + '=' }); i += 2; continue }
      if (c === '-' && src[i + 1] === '>') { out.push({ t: 'sym', v: '->' }); i += 2; continue }
      out.push({ t: 'sym', v: c === '|' ? 'bar' : c })
      i++
      continue
    }
    if (c === '*') { out.push({ t: 'sym', v: '*' }); i++; continue }
    if (c === '/') { out.push({ t: 'sym', v: '/' }); i++; continue }
    if (c === '~') { out.push({ t: 'sym', v: '~' }); i++; continue }
    if (c === '%') { out.push({ t: 'sym', v: '%' }); i++; continue }
    throw new ParseError(`Unexpected "${c}"`)
  }
  return out
}
