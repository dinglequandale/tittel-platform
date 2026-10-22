// Loads the vendored MathQuill build (vendor/mathquill/NOTICE.md) and holds
// the field configuration from GRAPH-SPEC §2.1. MathQuill is a classic script
// that sets window.MathQuill, so it's injected as a <script>, not imported.
import mqUrl from './vendor/mathquill/mathquill.js?url'
import './vendor/mathquill/mathquill.css'

export interface MathField {
  latex(): string
  latex(s: string): MathField
  focus(): MathField
  blur(): MathField
  write(s: string): MathField
  cmd(s: string): MathField
  keystroke(keys: string): MathField
  typedText(s: string): MathField
  moveToLeftEnd(): MathField
  moveToRightEnd(): MathField
  el(): HTMLElement
  revert(): void
  reflow(): void
}

export interface MQHandlers {
  edit?: (mf: MathField) => void
  enter?: (mf: MathField) => void
  upOutOf?: (mf: MathField) => void
  downOutOf?: (mf: MathField) => void
  deleteOutOf?: (dir: number, mf: MathField) => void
  moveOutOf?: (dir: number, mf: MathField) => void
}

export interface MQInterface {
  MathField(el: HTMLElement, config?: Record<string, unknown>): MathField
  StaticMath(el: HTMLElement): MathField
  L: number
  R: number
}

// Function names that type as upright operators, with screen-reader names.
const OPERATOR_NAMES = [
  'sin|sine', 'cos|cosine', 'tan|tangent', 'csc|cosecant', 'sec|secant', 'cot|cotangent',
  'arcsin|arc-sine', 'arccos|arc-cosine', 'arctan|arc-tangent', 'arccsc', 'arcsec', 'arccot',
  'sinh', 'cosh', 'tanh', 'csch', 'sech', 'coth',
  'ln|natural-log', 'log', 'exp', 'abs', 'floor', 'ceil', 'round', 'sign', 'mod',
  'min', 'max', 'gcd', 'lcm', 'nCr', 'nPr',
].join(' ')

// Functions after which "-" is a negative sign, so `sin -1` isn't `sin − 1`.
const PREFIX_OPERATORS = 'sin cos tan csc sec cot arcsin arccos arctan arccsc arcsec arccot sinh cosh tanh csch sech coth ln log exp'

export const FIELD_CONFIG = {
  spaceBehavesLikeTab: true,
  leftRightIntoCmdGoes: 'up',
  restrictMismatchedBrackets: true,
  supSubsRequireOperand: true,
  charsThatBreakOutOfSupSub: '+-=<>',
  autoSubscriptNumerals: true,
  // Words that become symbols as you type. sum/prod/int arrive with calculus (G3).
  autoCommands: 'pi tau theta sqrt nthroot infinity infty',
  autoOperatorNames: OPERATOR_NAMES,
  prefixOperatorNames: PREFIX_OPERATORS,
  infixOperatorNames: 'for with',
  enableDigitGrouping: true,
  tripleDotsAreEllipsis: true,
  disableAutoSubstitutionInSubscripts: { except: 'log' },
}

let loading: Promise<MQInterface> | null = null

export function loadMathQuill(): Promise<MQInterface> {
  const w = window as unknown as { MathQuill?: { getInterface(v: number): MQInterface } }
  if (w.MathQuill) return Promise.resolve(w.MathQuill.getInterface(3))
  if (!loading) {
    loading = new Promise((resolve, reject) => {
      const s = document.createElement('script')
      s.src = mqUrl
      s.onload = () => (w.MathQuill ? resolve(w.MathQuill.getInterface(3)) : reject(new Error('MathQuill failed to load')))
      s.onerror = () => { loading = null; reject(new Error('MathQuill failed to load')) }
      document.head.appendChild(s)
    })
  }
  return loading
}
