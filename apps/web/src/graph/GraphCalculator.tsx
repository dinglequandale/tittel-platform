import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Plus, Undo2, Redo2, Wrench, Keyboard } from 'lucide-react'
import {
  analyze, exactOrDecimal, newId, newTable, nextColor, togglePin, DEFAULT_SLIDER,
  type ExpressionItem, type GraphItem, type GraphPin, type GraphSettings, type GraphState, type SliderBounds, type TableItem, type Viewport,
} from '@tittel/graph'
import { ExpressionList, cellKey, nameLatex, type FocusRequest } from './ExpressionList.tsx'
import { GraphPaper } from './GraphPaper.tsx'
import { Keypad } from './Keypad.tsx'
import { loadMathQuill } from './mathquill.ts'
import './graph.css'

// The graphing calculator (GRAPH-SPEC G1–G2). Controlled: `state` in, every
// user-initiated change out through `onChange`. Nothing here ever calls
// onChange in response to a new `state` prop, so mirroring state between
// clients can't loop.

const NARROW_PX = 450
const COALESCE_MS = 800
const NO_PINS: GraphPin[] = []

export function GraphCalculator({
  state,
  onChange,
  editable = true,
  onPinRequest,
}: {
  state: GraphState
  onChange: (next: GraphState) => void
  editable?: boolean
  /** A read-only viewer clicked a point: ask whoever owns `state` to pin it. */
  onPinRequest?: (x: number, y: number) => void
}) {
  const analysis = useMemo(() => analyze(state), [state.items, state.settings])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focus, setFocus] = useState<FocusRequest | null>(null)
  const [narrow, setNarrow] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [keypadOpen, setKeypadOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const history = useRef<{ past: GraphState[]; future: GraphState[]; key?: string; at: number }>({ past: [], future: [], at: 0 })
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setNarrow(el.clientWidth < NARROW_PX))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Load the editor on opening, not on the first row, so that row is live at
  // once. A failure here isn't final: each row loads it again when it mounts.
  useEffect(() => { loadMathQuill().catch(() => {}) }, [])

  const focusRow =(id: string, end: 'left' | 'right' = 'right') =>
    setFocus((f) => ({ id, end, n: (f?.n ?? 0) + 1 }))

  /** Record history (typing in one row coalesces) and emit. */
  const commit = (next: GraphState, key?: string) => {
    const h = history.current
    const now = performance.now()
    if (!(key && h.key === key && now - h.at < COALESCE_MS)) {
      h.past.push(stateRef.current)
      if (h.past.length > 200) h.past.shift()
    }
    h.future = []
    h.key = key
    h.at = now
    stateRef.current = next
    onChange(next)
  }
  const setItems = (items: GraphItem[], key?: string) => commit({ ...stateRef.current, items, pins: undefined }, key)

  const undo = () => {
    const h = history.current
    const prev = h.past.pop()
    if (!prev) return
    h.future.push(stateRef.current)
    h.key = undefined
    stateRef.current = prev
    onChange(prev)
  }
  const redo = () => {
    const h = history.current
    const next = h.future.pop()
    if (!next) return
    h.past.push(stateRef.current)
    h.key = undefined
    stateRef.current = next
    onChange(next)
  }

  const items = state.items
  const makeItem = (latex: string, existing: GraphItem[], slider?: SliderBounds): ExpressionItem => ({
    id: newId(), type: 'expression', latex, color: nextColor(existing), ...(slider ? { slider } : {}),
  })

  const insertAfter = (index: number, latex = '') => {
    const next = [...stateRef.current.items]
    const item = makeItem(latex, next)
    next.splice(index + 1, 0, item)
    setItems(next)
    focusRow(item.id)
  }

  const removeAt = (index: number, focusPrev: boolean) => {
    const cur = stateRef.current.items
    const next = cur.filter((_, i) => i !== index)
    setItems(next)
    if (focusPrev && next.length) focusRow(next[Math.max(0, index - 1)].id)
  }

  const updateExpr = (id: string, f: (it: ExpressionItem) => ExpressionItem, key?: string) =>
    setItems(stateRef.current.items.map((it) => (it.id === id && it.type === 'expression' ? f(it) : it)), key)
  const updateTable = (id: string, f: (t: TableItem) => TableItem, key?: string) =>
    setItems(stateRef.current.items.map((it) => (it.id === id && it.type === 'table' ? f(it) : it)), key)
  const setColumn = (t: TableItem, col: number, patch: Partial<TableItem['columns'][number]>): TableItem => ({
    ...t, columns: t.columns.map((c, i) => (i === col ? { ...c, ...patch } : c)),
  })

  // The next unused table subscript: x_1/y_1, then x_2/y_2, …
  const nextTableIndex = () => {
    const used = new Set<string>()
    for (const it of stateRef.current.items) if (it.type === 'table') it.columns.forEach((c) => used.add(c.latex))
    let i = 1
    while (used.has(`x_{${i}}`) || used.has(`y_{${i}}`)) i++
    return i
  }

  /** Replace row `index` (or insert after it) with a table. */
  const placeTable = (index: number, table: TableItem, replace: boolean) => {
    const next = [...stateRef.current.items]
    next.splice(replace ? index : index + 1, replace ? 1 : 0, table)
    setItems(next)
    setFocus((f) => ({ id: cellKey(table.id, 0, 0), end: 'right', n: (f?.n ?? 0) + 1 }))
  }

  // Find the slider row that defines `name` (analysis knows which rows are sliders).
  const sliderRowIndex = (name: string) =>
    stateRef.current.items.findIndex((it) => analysis.byId.get(it.id)?.slider?.name === name)

  const setSlider = (name: string, value: number, resolution: number) => {
    const idx = sliderRowIndex(name)
    if (idx < 0) return
    const cur = stateRef.current.items
    const it = cur[idx]
    if (it.type !== 'expression') return
    const b = it.slider ?? DEFAULT_SLIDER
    const v = b.step ? b.min + Math.round((value - b.min) / b.step) * b.step : value
    const decimals = Math.min(6, Math.max(0, Math.ceil(-Math.log10(b.step || resolution))))
    const rounded = Number(v.toFixed(decimals))
    // Dragging a point past the slider's range widens the range.
    const slider = { ...b, min: Math.min(b.min, Math.floor(rounded)), max: Math.max(b.max, Math.ceil(rounded)) }
    const latex = `${nameLatex(name)}=${String(rounded)}`
    if (latex === it.latex && slider.min === b.min && slider.max === b.max) return
    const next = cur.map((x, i) => (i === idx ? { ...x, latex, slider } : x))
    setItems(next, `slider:${name}`)
  }

  const callbacks = {
    onLatex: (id: string, latex: string) => {
      // Typing "table" in an empty row makes a table [DOC].
      if (latex === 'table') {
        const index = stateRef.current.items.findIndex((it) => it.id === id)
        placeTable(index, newTable(stateRef.current.items.slice(0, index), nextTableIndex()), true)
        return
      }
      updateExpr(id, (it) => ({ ...it, latex }), `latex:${id}`)
    },
    onEnter: (index: number) => insertAfter(index),
    onMove: (index: number, dir: -1 | 1) => {
      const cur = stateRef.current.items
      const target = cur[index + dir]
      if (target) focusRow(target.id, dir === -1 ? 'right' : 'left')
    },
    onDeleteEmpty: (index: number) => { if (stateRef.current.items.length > 1 || index > 0) removeAt(index, true) },
    onDelete: (index: number) => removeAt(index, false),
    onSelect: (id: string) => setSelectedId(id),
    onToggleHidden: (id: string) => updateExpr(id, (it) => ({ ...it, hidden: !it.hidden })),
    onAddSliders: (index: number, names: string[]) => {
      const next = [...stateRef.current.items]
      const added = names.map((n, k) => makeItem(`${nameLatex(n)}=1`, next.slice(0, index + 1 + k), DEFAULT_SLIDER))
      next.splice(index + 1, 0, ...added)
      setItems(next)
    },
    onSliderValue: setSlider,
    onSliderBounds: (id: string, slider: SliderBounds) => updateExpr(id, (it) => ({ ...it, slider })),
    // Pasting spreadsheet cells (tabs/newlines of numbers) makes a table [DOC].
    onPaste: (index: number, text: string) => {
      const lines = text.replace(/\r/g, '').split('\n').map((l) => l.trim()).filter(Boolean)
      if (lines.length < 2 && !text.includes('\t')) return false
      const grid = lines.map((l) => l.split(/\t|,(?=\s*-?[\d.])/).map((c) => c.trim()))
      const width = Math.max(...grid.map((r) => r.length))
      if (width < 1 || !grid.every((r) => r.every((c) => c === '' || Number.isFinite(Number(c))))) return false
      const k = nextTableIndex()
      const base = newTable(stateRef.current.items.slice(0, index + 1), k, 0)
      const cols = Array.from({ length: Math.max(2, width) }, (_, c) => ({
        ...(base.columns[Math.min(c, 1)]),
        id: newId(),
        latex: c === 0 ? `x_{${k}}` : c === 1 ? `y_{${k}}` : `y_{${k + c - 1}}`,
        values: grid.slice(0, 10_000).map((r) => r[c] ?? ''),
      }))
      const cur = stateRef.current.items[index]
      placeTable(index, { ...base, columns: cols }, cur?.type === 'expression' && !cur.latex.trim())
      return true
    },
    onFocusKey: (key: string, end: 'left' | 'right' = 'right') => setFocus((f) => ({ id: key, end, n: (f?.n ?? 0) + 1 })),
    table: {
      onHeader: (id: string, col: number, latex: string) => updateTable(id, (t) => setColumn(t, col, { latex }), `th:${id}:${col}`),
      onCell: (id: string, col: number, row: number, latex: string) =>
        updateTable(id, (t) => {
          const values = [...t.columns[col].values]
          while (values.length <= row) values.push('')
          values[row] = latex
          while (values.length && !values[values.length - 1].trim()) values.pop()
          return setColumn(t, col, { values })
        }, `td:${id}:${col}:${row}`),
      onAddColumn: (id: string) =>
        updateTable(id, (t) => ({ ...t, columns: [...t.columns, { id: newId(), latex: '', values: [], color: nextColor(stateRef.current.items) }] })),
      onToggleColumn: (id: string, col: number) => updateTable(id, (t) => setColumn(t, col, { hidden: !t.columns[col].hidden })),
    },
  }

  const setViewport = (viewport: Viewport | null) => {
    // Panning and zooming are not undo steps.
    stateRef.current = { ...stateRef.current, viewport }
    onChange(stateRef.current)
  }
  const setSettings = (patch: Partial<GraphSettings>) =>
    commit({ ...stateRef.current, settings: { ...stateRef.current.settings, ...patch }, pins: undefined })

  const exportPoint = (x: number, y: number) => {
    const cur = stateRef.current.items
    commit({ ...stateRef.current, items: [...cur, makeItem(`\\left(${exactOrDecimal(x)},${exactOrDecimal(y)}\\right)`, cur)] })
  }

  const pinPoint = (x: number, y: number) => {
    if (!editable) { onPinRequest?.(x, y); return }
    // Like the viewport, not an undo step.
    stateRef.current = togglePin(stateRef.current, x, y)
    onChange(stateRef.current)
  }

  const onKeyDown = (e: KeyboardEvent) => {
    const mod = e.ctrlKey || e.metaKey
    if (!mod || !editable) return
    const k = e.key.toLowerCase()
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); redo() }
  }

  return (
    <div ref={rootRef} className={`gc${narrow ? ' gc-narrow' : ''}`} onKeyDown={onKeyDown}>
      <div className="gc-body">
      <div className="gc-panel">
        <div className="gc-toolbar">
          {editable && (
            <button type="button" className="gc-tool" title="Add expression" onClick={() => insertAfter(stateRef.current.items.length - 1)}>
              <Plus size={18} />
            </button>
          )}
          <span className="gc-toolbar-spacer" />
          {editable && (
            <>
              <button type="button" className="gc-tool" title="Undo (Ctrl+Z)" onClick={undo} disabled={!history.current.past.length}><Undo2 size={17} /></button>
              <button type="button" className="gc-tool" title="Redo (Ctrl+Y)" onClick={redo} disabled={!history.current.future.length}><Redo2 size={17} /></button>
            </>
          )}
          <span className="gc-toolbar-spacer" />
        </div>
        <ExpressionList
          items={items}
          rows={analysis.byId}
          selectedId={selectedId}
          editable={editable}
          focus={focus}
          onAppend={() => insertAfter(stateRef.current.items.length - 1)}
          {...callbacks}
        />
        {editable && !keypadOpen && (
          <button type="button" className="gc-kp-toggle" title="Show keypad" onMouseDown={(e) => e.preventDefault()} onClick={() => setKeypadOpen(true)}>
            <Keyboard size={18} />
          </button>
        )}
      </div>
      <div className="gc-graph">
        <GraphPaper
          analysis={analysis}
          items={items}
          viewport={state.viewport}
          settings={state.settings}
          selectedId={selectedId}
          pins={state.pins ?? NO_PINS}
          editable={editable}
          onSelect={(id) => { setSelectedId(id); setSettingsOpen(false) }}
          onViewport={setViewport}
          onDragVar={setSlider}
          onExportPoint={exportPoint}
          onPin={pinPoint}
        />
        {editable && (
          <div className="gc-settings">
            <button type="button" className="gp-btn" title="Graph settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen((o) => !o)}>
              <Wrench size={16} />
            </button>
            {settingsOpen && (
              <div className="gc-settings-menu" role="dialog" aria-label="Graph settings">
                <div className="gc-seg" role="radiogroup" aria-label="Angle mode">
                  <button type="button" data-active={!state.settings.degrees || undefined} onClick={() => setSettings({ degrees: false })}>Radians</button>
                  <button type="button" data-active={state.settings.degrees || undefined} onClick={() => setSettings({ degrees: true })}>Degrees</button>
                </div>
                <label className="gc-check"><input type="checkbox" checked={state.settings.showGrid} onChange={(e) => setSettings({ showGrid: e.target.checked })} /> Grid</label>
                <label className="gc-check"><input type="checkbox" checked={state.settings.axisNumbers} onChange={(e) => setSettings({ axisNumbers: e.target.checked })} /> Axis numbers</label>
                <label className="gc-check"><input type="checkbox" checked={state.settings.showAxes} onChange={(e) => setSettings({ showAxes: e.target.checked })} /> Axes</label>
                <label className="gc-check" title="Fit exponential and power models on log-transformed data, like TI ExpReg"><input type="checkbox" checked={!!state.settings.logModeRegressions} onChange={(e) => setSettings({ logModeRegressions: e.target.checked })} /> Log-mode regressions</label>
              </div>
            )}
          </div>
        )}
      </div>
      </div>
      {editable && keypadOpen && <Keypad onClose={() => setKeypadOpen(false)} />}
    </div>
  )
}

/** Accept only our own state shape (a room may still hold a pre-upgrade Desmos state). */
export function isGraphState(s: unknown): s is GraphState {
  const g = s as GraphState | null
  return !!g && g.v === 1 && Array.isArray(g.items) && typeof g.settings === 'object'
}
