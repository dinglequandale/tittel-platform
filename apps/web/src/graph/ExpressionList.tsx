import { useEffect, useRef, useState, type CSSProperties, type ClipboardEvent } from 'react'
import { AlertTriangle, Plus, Table2, X } from 'lucide-react'
import {
  formatNumber, fractionLatex, isList, pointLatex, toFraction,
  type ExpressionItem, type GraphItem, type RegressionResult, type RowResult, type SliderBounds, type TableItem, type Value,
} from '@tittel/graph'
import { FIELD_CONFIG, activeField, loadMathQuill, type MathField } from './mathquill.ts'
import { Tex } from './Tex.tsx'

/** Focus target: a row id, or a table cell `${tableId}:${col}:${row}`
 *  (row −1 = the header). */
export interface FocusRequest { id: string; end: 'left' | 'right'; n: number }
export const cellKey = (tableId: string, col: number, row: number) => `${tableId}:${col}:${row}`

export interface RowCallbacks {
  onLatex: (id: string, latex: string) => void
  onEnter: (index: number) => void
  onMove: (index: number, dir: -1 | 1) => void
  onDeleteEmpty: (index: number) => void
  onDelete: (index: number) => void
  onSelect: (id: string) => void
  onToggleHidden: (id: string) => void
  onAddSliders: (index: number, names: string[]) => void
  onSliderValue: (name: string, value: number, resolution: number) => void
  onSliderBounds: (id: string, bounds: SliderBounds) => void
  onPaste: (index: number, text: string) => boolean
  onFocusKey: (key: string, end?: 'left' | 'right') => void
  table: {
    onHeader: (id: string, col: number, latex: string) => void
    onCell: (id: string, col: number, row: number, latex: string) => void
    onAddColumn: (id: string) => void
    onToggleColumn: (id: string, col: number) => void
  }
}

export function ExpressionList({
  items,
  rows,
  selectedId,
  editable,
  focus,
  onAppend,
  ...cb
}: RowCallbacks & {
  items: GraphItem[]
  rows: Map<string, RowResult>
  selectedId: string | null
  editable: boolean
  focus: FocusRequest | null
  onAppend: () => void
}) {
  return (
    <div className="gc-list" role="list" aria-label="Expressions">
      {items.map((item, i) =>
        item.type === 'table' ? (
          <TableRow key={item.id} index={i} item={item} result={rows.get(item.id)} selected={selectedId === item.id} editable={editable} focus={focus} {...cb} />
        ) : (
          <Row
            key={item.id}
            index={i}
            item={item}
            result={rows.get(item.id)}
            selected={selectedId === item.id}
            editable={editable}
            focus={focus?.id === item.id ? focus : null}
            {...cb}
          />
        ),
      )}
      {editable && (
        <button type="button" className="gc-row gc-ghost" onClick={onAppend} aria-label="Add expression">
          <span className="gc-gutter"><span className="gc-index">{items.length + 1}</span></span>
          <span className="gc-main" />
        </button>
      )}
    </div>
  )
}

function Row({
  index, item, result, selected, editable, focus, ...cb
}: RowCallbacks & {
  index: number
  item: ExpressionItem
  result?: RowResult
  selected: boolean
  editable: boolean
  focus: FocusRequest | null
}) {
  const [focused, setFocused] = useState(false)
  const graphed = !!(result?.curves?.length || result?.implicits?.length || result?.points?.length || result?.region)
  const warn = result?.error || (result?.missing && result.missing.length > 0)
  const curveLike = !!(result?.curves?.length || result?.implicits?.length || result?.region)

  return (
    <div
      className="gc-row"
      role="listitem"
      data-selected={selected || focused || undefined}
      onFocus={() => { setFocused(true); cb.onSelect(item.id) }}
      onBlur={() => setFocused(false)}
      onPasteCapture={(e: ClipboardEvent) => {
        if (editable && cb.onPaste(index, e.clipboardData.getData('text/plain'))) { e.preventDefault(); e.stopPropagation() }
      }}
    >
      <div className="gc-gutter">
        <span className="gc-index">{index + 1}</span>
        {warn ? (
          <span className="gc-warn" title={result?.error ?? `Undefined: ${result?.missing?.join(', ')}`}>
            <AlertTriangle size={16} strokeWidth={2.25} />
          </span>
        ) : graphed ? (
          <Swatch color={item.color} hidden={!!item.hidden} curve={curveLike} onClick={() => cb.onToggleHidden(item.id)} />
        ) : null}
      </div>

      <div className="gc-main">
        <MathInput
          latex={item.latex}
          editable={editable}
          focus={focus}
          onEdit={(l) => cb.onLatex(item.id, l)}
          onEnter={() => cb.onEnter(index)}
          onUp={() => cb.onMove(index, -1)}
          onDown={() => cb.onMove(index, 1)}
          onDeleteEmpty={() => cb.onDeleteEmpty(index)}
        />
        {result?.missing && result.missing.length > 0 && editable && (
          <div className="gc-prompt">
            <span className="gc-prompt-label">add slider:</span>
            {result.missing.map((n) => (
              <button key={n} type="button" className="gc-pill" onClick={() => cb.onAddSliders(index, [n])}>
                <Tex latex={nameLatex(n)} />
              </button>
            ))}
            {result.missing.length > 1 && (
              <button type="button" className="gc-pill gc-pill-all" onClick={() => cb.onAddSliders(index, result.missing!)}>all</button>
            )}
          </div>
        )}
        {result?.slider && (
          <Slider
            name={result.slider.name}
            value={result.slider.value}
            bounds={item.slider ?? { min: -10, max: 10, step: 0 }}
            editable={editable}
            onValue={cb.onSliderValue}
            onBounds={(b) => cb.onSliderBounds(item.id, b)}
          />
        )}
        {result?.regression && <Regression r={result.regression} />}
        {result?.value !== undefined && !result.slider && <ValueChip value={result.value} />}
      </div>

      {editable && (
        <button type="button" className="gc-del" title="Delete" onClick={() => cb.onDelete(index)}>
          <X size={16} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}

function Swatch({ color, hidden, curve, onClick }: { color: string; hidden: boolean; curve: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className="gc-swatch"
      style={{ '--c': color } as CSSProperties}
      data-hidden={hidden || undefined}
      onClick={onClick}
      title={hidden ? 'Show' : 'Hide'}
      aria-pressed={!hidden}
    >
      <svg viewBox="0 0 20 20" aria-hidden="true">
        {curve ? <path d="M3 13c2.5-9 5-9 7-3s4.5 6 7-3" /> : <circle cx="10" cy="10" r="3.2" />}
      </svg>
    </button>
  )
}

// ---- tables ----------------------------------------------------------------

function TableRow({
  index, item, result, selected, editable, focus, ...cb
}: RowCallbacks & {
  index: number
  item: TableItem
  result?: RowResult
  selected: boolean
  editable: boolean
  focus: FocusRequest | null
}) {
  const [focused, setFocused] = useState(false)
  const t = cb.table
  // One blank row at the end grows the table as you type into it [DOC].
  const nRows = Math.max(0, ...item.columns.map((c, i) => Math.max(c.values.length, result?.columns?.[i]?.computed?.length ?? 0))) + (editable ? 1 : 0)
  const at = (c: number, r: number) => (focus?.id === cellKey(item.id, c, r) ? focus : null)
  const move = (c: number, r: number, end: 'left' | 'right' = 'right') => cb.onFocusKey(cellKey(item.id, c, r), end)

  return (
    <div
      className="gc-row gc-table-row"
      role="listitem"
      data-selected={selected || focused || undefined}
      onFocus={() => { setFocused(true); cb.onSelect(item.id) }}
      onBlur={() => setFocused(false)}
    >
      <div className="gc-gutter">
        <span className="gc-index">{index + 1}</span>
        <span className="gc-table-icon"><Table2 size={17} strokeWidth={2} /></span>
      </div>
      <div className="gc-main">
        <div className="gc-table-wrap">
          <table className="gc-table">
            <thead>
              <tr>
                {item.columns.map((col, c) => {
                  const cr = result?.columns?.[c]
                  const bad = cr?.error || cr?.missing?.length
                  return (
                    <th key={col.id} title={cr?.error ?? (cr?.missing?.length ? `Undefined: ${cr.missing.join(', ')}` : undefined)} data-bad={bad || undefined}>
                      <div className="gc-th">
                        {c > 0 && <Swatch color={col.color} hidden={!!col.hidden} curve={false} onClick={() => t.onToggleColumn(item.id, c)} />}
                        <MathInput
                          latex={col.latex}
                          editable={editable}
                          focus={at(c, -1)}
                          onEdit={(l) => t.onHeader(item.id, c, l)}
                          onEnter={() => move(c, 0)}
                          onDown={() => move(c, 0)}
                          onUp={() => cb.onMove(index, -1)}
                          onDeleteEmpty={() => {}}
                        />
                      </div>
                    </th>
                  )
                })}
                {editable && (
                  <th className="gc-th-add">
                    <button type="button" className="gc-tool" title="Add column" onClick={() => t.onAddColumn(item.id)}><Plus size={15} /></button>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: nRows }, (_, r) => (
                <tr key={r}>
                  {item.columns.map((col, c) => {
                    const computed = result?.columns?.[c]?.computed
                    if (computed) {
                      const v = computed[r]
                      return <td key={col.id} className="gc-td-computed">{v !== undefined && Number.isFinite(v) ? <Tex latex={formatNumber(v)} /> : null}</td>
                    }
                    return (
                      <td key={col.id}>
                        <MathInput
                          latex={col.values[r] ?? ''}
                          editable={editable}
                          focus={at(c, r)}
                          onEdit={(l) => t.onCell(item.id, c, r, l)}
                          onEnter={() => move(c, r + 1)}
                          onUp={() => move(c, r - 1)}
                          onDown={() => (r + 1 < nRows ? move(c, r + 1) : cb.onMove(index, 1))}
                          onDeleteEmpty={() => (c > 0 ? move(c - 1, r) : r > 0 && move(item.columns.length - 1, r - 1))}
                          small
                        />
                      </td>
                    )
                  })}
                  {editable && <td />}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      {editable && (
        <button type="button" className="gc-del" title="Delete table" onClick={() => cb.onDelete(index)}>
          <X size={16} strokeWidth={2} />
        </button>
      )}
    </div>
  )
}

// ---- values, regressions, sliders ------------------------------------------

function valueLatex(v: Value): string {
  if (isList(v)) {
    const shown = v.list.slice(0, 20).map((x) => (typeof x === 'number' ? formatNumber(x) : pointLatex(formatNumber(x[0]), formatNumber(x[1]))))
    return `\\left[${shown.join(',')}${v.list.length > 20 ? ',...' : ''}\\right]`
  }
  if (typeof v !== 'number') return pointLatex(formatNumber(v[0]), formatNumber(v[1]))
  return formatNumber(v)
}

function ValueChip({ value }: { value: Value }) {
  const [asFraction, setAsFraction] = useState(false)
  const fr = typeof value === 'number' ? toFraction(value) : undefined
  return (
    <div className="gc-value">
      <Tex latex={`=${asFraction && fr ? fractionLatex(fr) : valueLatex(value)}`} />
      {fr && (
        <button type="button" className="gc-frac" onClick={() => setAsFraction((f) => !f)} title={asFraction ? 'Show decimal' : 'Show fraction'}>
          {asFraction ? '0.5' : 'a/b'}
        </button>
      )}
    </div>
  )
}

const STAT_LATEX = { r: 'r', r2: 'r^{2}', R2: 'R^{2}' } as const

function Regression({ r }: { r: RegressionResult }) {
  return (
    <div className="gc-reg">
      <div className="gc-reg-block">
        <span className="gc-reg-label">Statistics{r.logMode ? ' · log mode' : ''}</span>
        <div className="gc-reg-items">
          {r.stats.map((s) => <Tex key={s.name} latex={`${STAT_LATEX[s.name]}=${formatNumber(Number(s.value.toPrecision(6)))}`} />)}
        </div>
      </div>
      <div className="gc-reg-block">
        <span className="gc-reg-label">Parameters</span>
        <div className="gc-reg-items">
          {r.params.map((p) => <Tex key={p.name} latex={`${nameLatex(p.name)}=${formatNumber(Number(p.value.toPrecision(6)))}`} />)}
        </div>
      </div>
    </div>
  )
}

function Slider({
  name, value, bounds, editable, onValue, onBounds,
}: {
  name: string
  value: number
  bounds: SliderBounds
  editable: boolean
  onValue: (name: string, value: number, resolution: number) => void
  onBounds: (b: SliderBounds) => void
}) {
  const res = bounds.step || (bounds.max - bounds.min) / 200
  return (
    <div className="gc-slider">
      <BoundField value={bounds.min} editable={editable} label="Lower bound" onCommit={(min) => min < bounds.max && onBounds({ ...bounds, min })} />
      <input
        type="range"
        className="gc-range"
        min={bounds.min}
        max={bounds.max}
        step={bounds.step || 'any'}
        value={Math.min(bounds.max, Math.max(bounds.min, value))}
        disabled={!editable}
        aria-label={`${name} slider`}
        onChange={(e) => onValue(name, Number(e.target.value), res)}
      />
      <BoundField value={bounds.max} editable={editable} label="Upper bound" onCommit={(max) => max > bounds.min && onBounds({ ...bounds, max })} />
    </div>
  )
}

function BoundField({ value, editable, label, onCommit }: { value: number; editable: boolean; label: string; onCommit: (v: number) => void }) {
  const [text, setText] = useState<string | null>(null)
  if (text === null) {
    return (
      <button type="button" className="gc-bound" disabled={!editable} aria-label={`${label}: ${value}`} onClick={() => setText(String(value))}>
        {String(value).replace('-', '−')}
      </button>
    )
  }
  const commit = () => {
    const v = Number(text)
    if (text.trim() !== '' && Number.isFinite(v)) onCommit(v)
    setText(null)
  }
  return (
    <input
      className="gc-bound-input"
      autoFocus
      value={text}
      aria-label={label}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setText(null) }}
    />
  )
}

/** `x_1` → `x_{1}`, `theta` → `\theta`. */
export function nameLatex(name: string): string {
  const [base, sub] = name.split('_')
  const b = base.length > 1 ? `\\${base}` : base
  return sub ? `${b}_{${sub}}` : b
}

// ---- the MathQuill field -----------------------------------------------------

function MathInput({
  latex, editable, focus, onEdit, onEnter, onUp, onDown, onDeleteEmpty, small,
}: {
  latex: string
  editable: boolean
  focus: FocusRequest | null
  onEdit: (latex: string) => void
  onEnter: () => void
  onUp: () => void
  onDown: () => void
  onDeleteEmpty: () => void
  small?: boolean
}) {
  const spanRef = useRef<HTMLSpanElement>(null)
  const mfRef = useRef<MathField | null>(null)
  const settingRef = useRef(false)
  const latexRef = useRef(latex)
  latexRef.current = latex
  const cb = useRef({ onEdit, onEnter, onUp, onDown, onDeleteEmpty })
  cb.current = { onEdit, onEnter, onUp, onDown, onDeleteEmpty }

  const setLatex = (mf: MathField, l: string) => {
    settingRef.current = true
    try { mf.latex(l) } finally { settingRef.current = false }
  }

  useEffect(() => {
    let dead = false
    loadMathQuill().then((MQ) => {
      const el = spanRef.current
      if (dead || !el) return
      if (!editable) {
        const sm = MQ.StaticMath(el)
        sm.latex(latexRef.current)
        mfRef.current = sm
        return
      }
      const mf = MQ.MathField(el, {
        ...FIELD_CONFIG,
        handlers: {
          edit: () => { if (!settingRef.current) cb.current.onEdit(mf.latex()) },
          enter: () => cb.current.onEnter(),
          upOutOf: () => cb.current.onUp(),
          downOutOf: () => cb.current.onDown(),
          deleteOutOf: (dir: number) => { if (dir === MQ.L && mf.latex() === '') cb.current.onDeleteEmpty() },
        },
      })
      setLatex(mf, latexRef.current)
      mfRef.current = mf
    })
    return () => {
      dead = true
      if (activeField.current === mfRef.current) activeField.current = null
      mfRef.current?.revert()
      mfRef.current = null
    }
  }, [editable])

  // Remote or programmatic changes (sync, slider drags) flow into the field.
  useEffect(() => {
    const mf = mfRef.current
    if (mf && mf.latex() !== latex) setLatex(mf, latex)
  }, [latex])

  useEffect(() => {
    if (!focus) return
    let tries = 0
    const go = () => {
      const mf = mfRef.current
      if (!mf) { if (tries++ < 20) setTimeout(go, 25); return }
      mf.focus()
      if (focus.end === 'right') mf.moveToRightEnd(); else mf.moveToLeftEnd()
    }
    go()
  }, [focus])

  return (
    <span
      ref={spanRef}
      className={`gc-math${small ? ' gc-math-sm' : ''}`}
      onFocus={() => { if (editable && mfRef.current) activeField.current = mfRef.current }}
    />
  )
}
