import { useState, type MouseEvent, type ReactNode } from 'react'
import { CornerDownLeft, Delete, ArrowLeft, ArrowRight, ChevronDown } from 'lucide-react'
import { activeField, type MathField } from './mathquill.ts'
import { Tex } from './Tex.tsx'

// On-screen keypad (GRAPH-SPEC §3.8). Key positions on the main page follow
// the reference calculator's layout [OBS] so SAT practice transfers; styling
// is ours. Keys drive MathQuill's own typing (typedText/cmd/keystroke), so a
// tapped key behaves exactly like the same key typed.

type Action = (mf: MathField) => void
const type = (s: string): Action => (mf) => mf.typedText(s)
const cmd = (s: string): Action => (mf) => mf.cmd(s)
const write = (s: string): Action => (mf) => mf.write(s)
const fn = (name: string): Action => (mf) => { mf.typedText(name); mf.typedText('(') }

interface Key { label: ReactNode; act: Action; tone?: 'num' | 'op' | 'fn' | 'primary' | 'muted'; aria?: string; span?: number }

const k = (label: ReactNode, act: Action, tone?: Key['tone'], aria?: string): Key => ({ label, act, tone, aria })
const tex = (l: string) => <Tex latex={l} />

const MAIN_LEFT: Key[] = [
  k(tex('x'), type('x')), k(tex('y'), type('y')), k(tex('a^2'), write('^2'), undefined, 'squared'), k(tex('a^b'), cmd('^'), undefined, 'superscript'),
  k(tex('('), type('(')), k(tex(')'), type(')')), k(tex('<'), type('<')), k(tex('>'), type('>')),
  k(tex('|a|'), type('|'), undefined, 'absolute value'), k(tex(','), type(',')), k(tex('\\le'), write('\\le '), undefined, 'less than or equal'), k(tex('\\ge'), write('\\ge '), undefined, 'greater than or equal'),
]
const MAIN_NUM: Key[] = [
  k('7', type('7'), 'num'), k('8', type('8'), 'num'), k('9', type('9'), 'num'), k(tex('\\div'), type('/'), 'op', 'divide'),
  k('4', type('4'), 'num'), k('5', type('5'), 'num'), k('6', type('6'), 'num'), k(tex('\\times'), type('*'), 'op', 'times'),
  k('1', type('1'), 'num'), k('2', type('2'), 'num'), k('3', type('3'), 'num'), k(tex('-'), type('-'), 'op', 'minus'),
  k('0', type('0'), 'num'), k('.', type('.'), 'num'), k(tex('='), type('='), 'op', 'equals'), k(tex('+'), type('+'), 'op', 'plus'),
]

const QWERTY = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']

const FUNCTIONS: { title: string; keys: Key[] }[] = [
  { title: 'Trig', keys: ['sin', 'cos', 'tan', 'csc', 'sec', 'cot'].map((f) => k(f, fn(f), 'fn')) },
  {
    title: 'Inverse trig',
    keys: ['sin', 'cos', 'tan', 'csc', 'sec', 'cot'].map((f) => k(tex(`\\${f === 'csc' || f === 'sec' || f === 'cot' ? `operatorname{${f}}` : f}^{-1}`), (mf) => { mf.typedText(`arc${f}`); mf.typedText('(') }, 'fn', `inverse ${f}`)),
  },
  {
    title: 'Statistics',
    keys: ['mean', 'median', 'min', 'max', 'quartile', 'quantile', 'stdev', 'stdevp', 'var', 'mad', 'cov', 'corr'].map((f) => k(f, fn(f), 'fn')),
  },
  { title: 'List operations', keys: ['sort', 'unique', 'join', 'count', 'total'].map((f) => k(f, fn(f), 'fn')) },
  {
    title: 'Logs and roots',
    keys: [
      k('ln', fn('ln'), 'fn'), k('log', fn('log'), 'fn'), k(tex('\\log_a'), (mf) => { mf.typedText('log'); mf.cmd('_') }, 'fn', 'log base a'),
      k(tex('e^x'), (mf) => { mf.typedText('e'); mf.cmd('^') }, 'fn', 'e to the x'), k(tex('\\sqrt{\\ }'), cmd('\\sqrt'), 'fn', 'square root'),
      k(tex('\\sqrt[n]{\\ }'), cmd('\\nthroot'), 'fn', 'nth root'),
    ],
  },
  { title: 'Hyperbolic trig', keys: ['sinh', 'cosh', 'tanh', 'csch', 'sech', 'coth'].map((f) => k(f, fn(f), 'fn')) },
  {
    title: 'Number theory',
    keys: [
      ...['gcd', 'lcm', 'mod', 'floor', 'ceil', 'round', 'abs', 'sign'].map((f) => k(f, fn(f), 'fn')),
      k(tex('n!'), type('!'), 'fn', 'factorial'), k('nPr', fn('nPr'), 'fn'), k('nCr', fn('nCr'), 'fn'),
    ],
  },
]

export function Keypad({ onClose }: { onClose: () => void }) {
  const [page, setPage] = useState<'main' | 'abc' | 'fn'>('main')
  const [shift, setShift] = useState(false)

  const press = (act: Action) => {
    const mf = activeField.current
    if (!mf) return
    act(mf)
    mf.focus()
  }
  // Keys must not take focus from the math field they type into.
  const keep = (e: MouseEvent) => e.preventDefault()

  const btn = (key: Key, i: number) => (
    <button
      key={i}
      type="button"
      className={`kp-key${key.tone ? ` kp-${key.tone}` : ''}`}
      aria-label={key.aria}
      onMouseDown={keep}
      onClick={() => press(key.act)}
    >
      {key.label}
    </button>
  )

  const right = (
    <div className="kp-right">
      <button type="button" className={`kp-key kp-wide${page === 'fn' ? ' kp-active' : ''}`} onMouseDown={keep} onClick={() => setPage(page === 'fn' ? 'main' : 'fn')}>functions</button>
      <div className="kp-pair">
        {btn(k(<ArrowLeft size={18} />, (mf) => mf.keystroke('Left'), 'muted', 'left'), 0)}
        {btn(k(<ArrowRight size={18} />, (mf) => mf.keystroke('Right'), 'muted', 'right'), 1)}
      </div>
      {btn(k(<Delete size={18} />, (mf) => mf.keystroke('Backspace'), 'muted', 'backspace'), 2)}
      {btn(k(<CornerDownLeft size={18} />, (mf) => mf.typedText('\n'), 'primary', 'enter'), 3)}
    </div>
  )

  return (
    <div className="kp" role="group" aria-label="Math keypad">
      <div className="kp-top">
        <div className="kp-tabs">
          <button type="button" data-active={page === 'main' || undefined} onMouseDown={keep} onClick={() => setPage('main')}>123</button>
          <button type="button" data-active={page === 'abc' || undefined} onMouseDown={keep} onClick={() => setPage('abc')}>ABC</button>
          <button type="button" data-active={page === 'fn' || undefined} onMouseDown={keep} onClick={() => setPage('fn')}>functions</button>
        </div>
        <button type="button" className="gc-tool" title="Hide keypad" onMouseDown={keep} onClick={onClose}><ChevronDown size={18} /></button>
      </div>

      {page === 'main' && (
        <div className="kp-main">
          <div className="kp-grid kp-left">
            {MAIN_LEFT.map(btn)}
            <button type="button" className="kp-key kp-muted" onMouseDown={keep} onClick={() => setPage('abc')}>ABC</button>
            {btn(k(tex('\\theta'), cmd('\\theta'), undefined, 'theta'), 13)}
            {btn(k(tex('\\sqrt{\\ }'), cmd('\\sqrt'), undefined, 'square root'), 14)}
            {btn(k(tex('\\pi'), cmd('\\pi'), undefined, 'pi'), 15)}
          </div>
          <div className="kp-grid kp-num">{MAIN_NUM.map(btn)}</div>
          {right}
        </div>
      )}

      {page === 'abc' && (
        <div className="kp-main">
          <div className="kp-abc">
            {QWERTY.map((rowKeys, r) => (
              <div key={r} className="kp-abc-row">
                {r === 2 && (
                  <button type="button" className={`kp-key kp-muted${shift ? ' kp-active' : ''}`} aria-label="shift" onMouseDown={keep} onClick={() => setShift((s) => !s)}>⇧</button>
                )}
                {rowKeys.split('').map((ch, i) => {
                  const c = shift ? ch.toUpperCase() : ch
                  return btn(k(c, type(c)), i)
                })}
              </div>
            ))}
            <div className="kp-abc-row">
              {btn(k(tex('a_b'), cmd('_'), 'muted', 'subscript'), 0)}
              {btn(k('!', type('!'), 'muted'), 1)}
              {btn(k(tex('\\sim'), type('~'), 'muted', 'tilde, for regressions'), 2)}
              {btn(k('%', type('%'), 'muted'), 3)}
              {btn(k(tex('[\\ ]'), type('['), 'muted', 'list'), 4)}
              {btn(k(tex('\\{\\ \\}'), type('{'), 'muted', 'braces'), 5)}
              {btn(k(':', type(':'), 'muted'), 6)}
              {btn(k("'", type("'"), 'muted', 'prime'), 7)}
            </div>
          </div>
          {right}
        </div>
      )}

      {page === 'fn' && (
        <div className="kp-main">
          <div className="kp-fnpanel">
            {FUNCTIONS.map((g) => (
              <section key={g.title}>
                <h4 className="kp-fn-title">{g.title}</h4>
                <div className="kp-fn-grid">{g.keys.map(btn)}</div>
              </section>
            ))}
          </div>
          {right}
        </div>
      )}
    </div>
  )
}
