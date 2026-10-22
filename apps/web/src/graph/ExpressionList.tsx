import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { AlertTriangle, X } from 'lucide-react'
import {
  formatNumber, fractionLatex, pointLatex, toFraction,
  type GraphItem, type RowResult, type SliderBounds, type Value,
} from '@tittel/graph'
import { FIELD_CONFIG, loadMathQuill, type MathField } from './mathquill.ts'
import { Tex } from './Tex.tsx'

export interface FocusRequest { id: string; end: 'left' | 'right'; n: number }

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
      {items.map((item, i) => (
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
      ))}
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
  item: GraphItem
  result?: RowResult
  selected: boolean
  editable: boolean
  focus: FocusRequest | null
}) {
  const [focused, setFocused] = useState(false)
  const graphed = !!(result?.curve || result?.points)
  const warn = result?.error || (result?.missing && result.missing.length > 0)

  return (
    <div
      className="gc-row"
      role="listitem"
      data-selected={selected || focused || undefined}
      onFocus={() => { setFocused(true); cb.onSelect(item.id) }}
      onBlur={() => setFocused(false)}
    >
      <div className="gc-gutter">
        <span className="gc-index">{index + 1}</span>
        {warn ? (
          <span className="gc-warn" title={result?.error ?? `Undefined: ${result?.missing?.join(', ')}`}>
            <AlertTriangle size={16} strokeWidth={2.25} />
          </span>
        ) : graphed ? (
          <button
            type="button"
            className="gc-swatch"
            style={{ '--c': item.color } as CSSProperties}
            data-hidden={item.hidden || undefined}
            onClick={() => cb.onToggleHidden(item.id)}
            title={item.hidden ? 'Show' : 'Hide'}
            aria-pressed={!item.hidden}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              {result?.curve ? <path d="M3 13c2.5-9 5-9 7-3s4.5 6 7-3" /> : <circle cx="10" cy="10" r="3.2" />}
            </svg>
          </button>
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

function ValueChip({ value }: { value: Value }) {
  const [asFraction, setAsFraction] = useState(false)
  if (typeof value !== 'number') return <div className="gc-value"><Tex latex={`=${pointLatex(formatNumber(value[0]), formatNumber(value[1]))}`} /></div>
  const fr = toFraction(value)
  return (
    <div className="gc-value">
      <Tex latex={`=${asFraction && fr ? fractionLatex(fr) : formatNumber(value)}`} />
      {fr && (
        <button type="button" className="gc-frac" onClick={() => setAsFraction((f) => !f)} title={asFraction ? 'Show decimal' : 'Show fraction'}>
          {asFraction ? '0.5' : 'a/b'}
        </button>
      )}
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

function MathInput({
  latex, editable, focus, onEdit, onEnter, onUp, onDown, onDeleteEmpty,
}: {
  latex: string
  editable: boolean
  focus: FocusRequest | null
  onEdit: (latex: string) => void
  onEnter: () => void
  onUp: () => void
  onDown: () => void
  onDeleteEmpty: () => void
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

  return <span ref={spanRef} className="gc-math" />
}
