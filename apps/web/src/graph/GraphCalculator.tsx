import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Plus, Undo2, Redo2, Wrench } from 'lucide-react'
import {
  analyze, exactOrDecimal, newId, nextColor, DEFAULT_SLIDER,
  type GraphItem, type GraphSettings, type GraphState, type SliderBounds, type Viewport,
} from '@tittel/graph'
import { ExpressionList, nameLatex, type FocusRequest } from './ExpressionList.tsx'
import { GraphPaper } from './GraphPaper.tsx'
import './graph.css'

// The graphing calculator (GRAPH-SPEC G1). Controlled: `state` in, every
// user-initiated change out through `onChange`. Nothing here ever calls
// onChange in response to a new `state` prop, so mirroring state between
// clients can't loop.

const NARROW_PX = 450
const COALESCE_MS = 800

export function GraphCalculator({
  state,
  onChange,
  editable = true,
}: {
  state: GraphState
  onChange: (next: GraphState) => void
  editable?: boolean
}) {
  const analysis = useMemo(() => analyze(state), [state.items, state.settings])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [focus, setFocus] = useState<FocusRequest | null>(null)
  const [narrow, setNarrow] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
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

  const focusRow = (id: string, end: 'left' | 'right' = 'right') =>
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
  const setItems = (items: GraphItem[], key?: string) => commit({ ...stateRef.current, items }, key)

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
  const makeItem = (latex: string, existing: GraphItem[], slider?: SliderBounds): GraphItem => ({
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

  // Find the slider row that defines `name` (analysis knows which rows are sliders).
  const sliderRowIndex = (name: string) =>
    stateRef.current.items.findIndex((it) => analysis.byId.get(it.id)?.slider?.name === name)

  const setSlider = (name: string, value: number, resolution: number) => {
    const idx = sliderRowIndex(name)
    if (idx < 0) return
    const cur = stateRef.current.items
    const it = cur[idx]
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
    onLatex: (id: string, latex: string) =>
      setItems(stateRef.current.items.map((it) => (it.id === id ? { ...it, latex } : it)), `latex:${id}`),
    onEnter: (index: number) => insertAfter(index),
    onMove: (index: number, dir: -1 | 1) => {
      const cur = stateRef.current.items
      const target = cur[index + dir]
      if (target) focusRow(target.id, dir === -1 ? 'right' : 'left')
    },
    onDeleteEmpty: (index: number) => { if (stateRef.current.items.length > 1 || index > 0) removeAt(index, true) },
    onDelete: (index: number) => removeAt(index, false),
    onSelect: (id: string) => setSelectedId(id),
    onToggleHidden: (id: string) =>
      setItems(stateRef.current.items.map((it) => (it.id === id ? { ...it, hidden: !it.hidden } : it))),
    onAddSliders: (index: number, names: string[]) => {
      const next = [...stateRef.current.items]
      const added = names.map((n, k) => makeItem(`${nameLatex(n)}=1`, next.slice(0, index + 1 + k), DEFAULT_SLIDER))
      next.splice(index + 1, 0, ...added)
      setItems(next)
    },
    onSliderValue: setSlider,
    onSliderBounds: (id: string, slider: SliderBounds) =>
      setItems(stateRef.current.items.map((it) => (it.id === id ? { ...it, slider } : it))),
  }

  const setViewport = (viewport: Viewport | null) => {
    // Panning and zooming are not undo steps.
    stateRef.current = { ...stateRef.current, viewport }
    onChange(stateRef.current)
  }
  const setSettings = (patch: Partial<GraphSettings>) =>
    commit({ ...stateRef.current, settings: { ...stateRef.current.settings, ...patch } })

  const exportPoint = (x: number, y: number) => {
    const cur = stateRef.current.items
    setItems([...cur, makeItem(`\\left(${exactOrDecimal(x)},${exactOrDecimal(y)}\\right)`, cur)])
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
      </div>
      <div className="gc-graph">
        <GraphPaper
          analysis={analysis}
          items={items}
          viewport={state.viewport}
          settings={state.settings}
          selectedId={selectedId}
          editable={editable}
          onSelect={(id) => { setSelectedId(id); setSettingsOpen(false) }}
          onViewport={setViewport}
          onDragVar={setSlider}
          onExportPoint={exportPoint}
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
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Accept only our own state shape (a room may still hold a pre-upgrade Desmos state). */
export function isGraphState(s: unknown): s is GraphState {
  const g = s as GraphState | null
  return !!g && g.v === 1 && Array.isArray(g.items) && typeof g.settings === 'object'
}
