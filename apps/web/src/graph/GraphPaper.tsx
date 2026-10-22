import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { Plus, Minus, Home, ListPlus } from 'lucide-react'
import {
  defaultViewport, exactOrDecimal, fitAspect, gridLabel, gridStep, pointLatex, pointsOfInterest,
  sampleCurve, zoomAbout,
  type Analysis, type GraphItem, type GraphSettings, type Poi, type Polyline, type Viewport,
} from '@tittel/graph'
import { Tex } from './Tex.tsx'

// The graph paper (GRAPH-SPEC §3.3–3.4): grid, axes, curves, points, points
// of interest. Canvas-drawn; DOM only for the overlay buttons and POI cards.

const HIT_CURVE_PX = 7
const HIT_POINT_PX = 11
const HIT_POI_PX = 9

interface DragTarget { name: string; axis: 'x' | 'y'; other?: { name: string; axis: 'x' | 'y' } }

export function GraphPaper({
  analysis,
  items,
  viewport,
  settings,
  selectedId,
  editable,
  onSelect,
  onViewport,
  onDragVar,
  onExportPoint,
}: {
  analysis: Analysis
  items: GraphItem[]
  viewport: Viewport | null
  settings: GraphSettings
  selectedId: string | null
  editable: boolean
  onSelect: (id: string | null) => void
  onViewport: (v: Viewport | null) => void
  /** A draggable point moved: set slider `name` to `value` (rounded to `resolution`). */
  onDragVar: (name: string, value: number, resolution: number) => void
  onExportPoint: (x: number, y: number) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [hover, setHover] = useState<Poi | null>(null)
  const [pinned, setPinned] = useState<Poi[]>([])

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const view = useMemo<Viewport>(() => {
    if (!size.w || !size.h) return { xmin: -10, xmax: 10, ymin: -10, ymax: 10 }
    return viewport ? fitAspect(viewport, size.w, size.h) : defaultViewport(size.w, size.h)
  }, [viewport, size])

  const toPx = (x: number, y: number): [number, number] => [
    ((x - view.xmin) / (view.xmax - view.xmin)) * size.w,
    ((view.ymax - y) / (view.ymax - view.ymin)) * size.h,
  ]
  const toMath = (px: number, py: number): [number, number] => [
    view.xmin + (px / size.w) * (view.xmax - view.xmin),
    view.ymax - (py / size.h) * (view.ymax - view.ymin),
  ]

  const colorOf = useMemo(() => new Map(items.map((it) => [it.id, it])), [items])

  // Sampled geometry for every visible curve, recomputed when the view or graph changes.
  const curves = useMemo(() => {
    if (!size.w) return []
    const out: { id: string; color: string; lines: Polyline[] }[] = []
    for (const r of analysis.rows) {
      const it = colorOf.get(r.id)
      if (!r.curve || !it || it.hidden) continue
      out.push({ id: r.id, color: it.color, lines: sampleCurve(r.curve, view, size.w, size.h) })
    }
    return out
  }, [analysis, colorOf, view, size])

  const points = useMemo(() => {
    const out: { id: string; color: string; x: number; y: number; dragX?: string; dragY?: string }[] = []
    for (const r of analysis.rows) {
      const it = colorOf.get(r.id)
      if (!r.points || !it || it.hidden) continue
      for (const p of r.points) if (Number.isFinite(p.x) && Number.isFinite(p.y)) out.push({ id: r.id, color: it.color, ...p })
    }
    return out
  }, [analysis, colorOf])

  const pois = useMemo(() => {
    const sel = selectedId ? analysis.byId.get(selectedId) : undefined
    const it = selectedId ? colorOf.get(selectedId) : undefined
    if (!sel?.curve || !it || it.hidden || !size.w) return []
    const others = analysis.rows
      .filter((r) => r.id !== selectedId && r.curve && !colorOf.get(r.id)?.hidden)
      .map((r) => r.curve!)
    return pointsOfInterest(sel.curve, others, view, size.w)
  }, [analysis, selectedId, colorOf, view, size])

  // Pinned labels belong to the selection they were made on.
  useEffect(() => setPinned([]), [selectedId])

  useEffect(() => {
    const c = canvasRef.current
    if (!c || !size.w) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(size.w * dpr)
    c.height = Math.round(size.h * dpr)
    const g = c.getContext('2d')!
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    draw(g)
  })

  function draw(g: CanvasRenderingContext2D) {
    const { w, h } = size
    g.fillStyle = '#FFFFFF'
    g.fillRect(0, 0, w, h)
    const step = gridStep((view.xmax - view.xmin) / w)
    const [ox, oy] = toPx(0, 0)

    const lines = (spacing: number, color: string, width: number) => {
      g.strokeStyle = color
      g.lineWidth = width
      g.beginPath()
      for (let x = Math.ceil(view.xmin / spacing) * spacing; x <= view.xmax; x += spacing) {
        const px = Math.round(toPx(x, 0)[0]) + 0.5
        g.moveTo(px, 0); g.lineTo(px, h)
      }
      for (let y = Math.ceil(view.ymin / spacing) * spacing; y <= view.ymax; y += spacing) {
        const py = Math.round(toPx(0, y)[1]) + 0.5
        g.moveTo(0, py); g.lineTo(w, py)
      }
      g.stroke()
    }
    if (settings.showGrid) {
      lines(step.minor, '#EEEEEB', 1)
      lines(step.major, '#D6D6D2', 1)
    }
    if (settings.showAxes) {
      g.strokeStyle = '#0F0F0F'
      g.lineWidth = 1.25
      g.beginPath()
      if (oy >= 0 && oy <= h) { g.moveTo(0, oy); g.lineTo(w, oy) }
      if (ox >= 0 && ox <= w) { g.moveTo(ox, 0); g.lineTo(ox, h) }
      g.stroke()
    }
    if (settings.axisNumbers) {
      g.font = '500 12px Outfit, system-ui, sans-serif'
      g.lineWidth = 3
      g.strokeStyle = '#FFFFFF'
      g.fillStyle = '#3B3D3B'
      // x labels below the axis (pinned to the edge when the axis is off-screen)
      const ly = Math.min(Math.max(oy + 4, 2), h - 16)
      g.textAlign = 'center'
      g.textBaseline = 'top'
      for (let x = Math.ceil(view.xmin / step.major) * step.major; x <= view.xmax; x += step.major) {
        if (Math.abs(x) < step.major * 1e-9) continue
        const t = gridLabel(x, step.major)
        const px = toPx(x, 0)[0]
        g.strokeText(t, px, ly); g.fillText(t, px, ly)
      }
      const lx = Math.min(Math.max(ox - 6, 30), w - 4)
      g.textAlign = 'right'
      g.textBaseline = 'middle'
      for (let y = Math.ceil(view.ymin / step.major) * step.major; y <= view.ymax; y += step.major) {
        if (Math.abs(y) < step.major * 1e-9) continue
        const t = gridLabel(y, step.major)
        const py = toPx(0, y)[1]
        g.strokeText(t, lx, py); g.fillText(t, lx, py)
      }
      if (ox >= 0 && ox <= w && oy >= 0 && oy <= h) {
        g.textAlign = 'right'; g.textBaseline = 'top'
        g.strokeText('0', ox - 5, oy + 4); g.fillText('0', ox - 5, oy + 4)
      }
    }

    // Curves: selected one drawn last and thicker [OBS].
    const ordered = [...curves].sort((a, b) => (a.id === selectedId ? 1 : 0) - (b.id === selectedId ? 1 : 0))
    const clamp = (v: number) => Math.max(-1e4, Math.min(1e4 + Math.max(w, h), v))
    for (const cv of ordered) {
      g.strokeStyle = cv.color
      g.globalAlpha = 0.9
      g.lineWidth = cv.id === selectedId ? 3.75 : 2.5
      g.lineJoin = 'round'
      g.lineCap = 'round'
      for (const line of cv.lines) {
        g.beginPath()
        for (let i = 0; i < line.length; i += 2) {
          const [px, py] = toPx(line[i], line[i + 1])
          if (i === 0) g.moveTo(clamp(px), clamp(py))
          else g.lineTo(clamp(px), clamp(py))
        }
        if (line.length === 2) {
          const [px, py] = toPx(line[0], line[1])
          g.arc(px, py, g.lineWidth / 2, 0, Math.PI * 2)
        }
        g.stroke()
      }
      g.globalAlpha = 1
    }

    for (const p of points) {
      const [px, py] = toPx(p.x, p.y)
      if (p.dragX || p.dragY) {
        g.fillStyle = p.color
        g.globalAlpha = 0.25
        g.beginPath(); g.arc(px, py, 12, 0, Math.PI * 2); g.fill()
        g.globalAlpha = 1
      }
      g.fillStyle = p.color
      g.beginPath(); g.arc(px, py, 4.5, 0, Math.PI * 2); g.fill()
    }

    const pinnedSet = new Set(pinned.map((p) => `${p.x},${p.y}`))
    for (const p of pois) {
      const [px, py] = toPx(p.x, p.y)
      const strong = pinnedSet.has(`${p.x},${p.y}`) || (hover && hover.x === p.x && hover.y === p.y)
      g.fillStyle = strong ? '#0F0F0F' : '#A4A6A3'
      g.beginPath(); g.arc(px, py, strong ? 5.5 : 4.25, 0, Math.PI * 2); g.fill()
    }
  }

  // ---- interaction ----------------------------------------------------------
  const drag = useRef<
    | { kind: 'pan'; startX: number; startY: number; base: Viewport; moved: boolean }
    | { kind: 'point'; target: DragTarget }
    | null
  >(null)

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top] as const
  }

  const hitPoi = (px: number, py: number) =>
    pois.find((p) => { const [x, y] = toPx(p.x, p.y); return Math.hypot(x - px, y - py) <= HIT_POI_PX })

  const hitDraggable = (px: number, py: number): DragTarget | undefined => {
    if (!editable) return undefined
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i]
      if (!p.dragX && !p.dragY) continue
      const [x, y] = toPx(p.x, p.y)
      if (Math.hypot(x - px, y - py) > HIT_POINT_PX) continue
      if (p.dragX && p.dragY) return { name: p.dragX, axis: 'x', other: { name: p.dragY, axis: 'y' } }
      return p.dragX ? { name: p.dragX, axis: 'x' } : { name: p.dragY!, axis: 'y' }
    }
    return undefined
  }

  const hitCurve = (px: number, py: number): string | undefined => {
    let best: string | undefined
    let bestD = HIT_CURVE_PX
    for (const cv of curves) {
      for (const line of cv.lines) {
        for (let i = 0; i + 3 < line.length; i += 2) {
          const [ax, ay] = toPx(line[i], line[i + 1])
          const [bx, by] = toPx(line[i + 2], line[i + 3])
          const d = segDist(px, py, ax, ay, bx, by)
          if (d < bestD) { bestD = d; best = cv.id }
        }
      }
    }
    if (best) return best
    for (const p of points) {
      const [x, y] = toPx(p.x, p.y)
      if (Math.hypot(x - px, y - py) <= HIT_POINT_PX) return p.id
    }
    return undefined
  }

  const onPointerDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    const [px, py] = local(e)
    const target = hitDraggable(px, py)
    if (target) {
      drag.current = { kind: 'point', target }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    const poi = hitPoi(px, py)
    if (poi) {
      const same = (q: Poi) => q.x === poi.x && q.y === poi.y
      setPinned((ps) => (ps.some(same) ? ps.filter((q) => !same(q)) : [...ps, poi]))
      return
    }
    drag.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, base: view, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const [px, py] = local(e)
    const d = drag.current
    if (d?.kind === 'point') {
      const [mx, my] = toMath(px, py)
      const res = (view.xmax - view.xmin) / size.w
      onDragVar(d.target.name, d.target.axis === 'x' ? mx : my, res)
      if (d.target.other) onDragVar(d.target.other.name, d.target.other.axis === 'x' ? mx : my, res)
      return
    }
    if (d?.kind === 'pan') {
      const dx = e.clientX - d.startX
      const dy = e.clientY - d.startY
      if (!d.moved && Math.hypot(dx, dy) < 3) return
      d.moved = true
      if (!editable) return
      const ux = ((d.base.xmax - d.base.xmin) / size.w) * dx
      const uy = ((d.base.ymax - d.base.ymin) / size.h) * dy
      onViewport({ xmin: d.base.xmin - ux, xmax: d.base.xmax - ux, ymin: d.base.ymin + uy, ymax: d.base.ymax + uy })
      return
    }
    const poi = hitPoi(px, py)
    setHover(poi ?? null)
    const el = e.currentTarget
    el.style.cursor = hitDraggable(px, py) ? 'grab' : poi || hitCurve(px, py) ? 'pointer' : editable ? 'move' : 'default'
  }

  const onPointerUp = (e: RPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current
    drag.current = null
    if (d?.kind === 'pan' && !d.moved) {
      const [px, py] = local(e)
      onSelect(hitCurve(px, py) ?? null)
    }
  }

  // Wheel zoom about the cursor. Non-passive so the page doesn't scroll.
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const onWheel = (e: WheelEvent) => {
      if (!editable) return
      e.preventDefault()
      const [px, py] = local(e)
      const [mx, my] = toMath(px, py)
      onViewport(zoomAbout(view, mx, my, Math.exp(e.deltaY * 0.0015)))
    }
    c.addEventListener('wheel', onWheel, { passive: false })
    return () => c.removeEventListener('wheel', onWheel)
  })

  const zoomCenter = (factor: number) => {
    onViewport(zoomAbout(view, (view.xmin + view.xmax) / 2, (view.ymin + view.ymax) / 2, factor))
  }

  const cards = [...pinned]
  if (hover && !pinned.some((p) => p.x === hover.x && p.y === hover.y)) cards.push(hover)

  return (
    <div ref={wrapRef} className="gp">
      <canvas
        ref={canvasRef}
        className="gp-canvas"
        style={{ width: size.w, height: size.h }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        aria-label="Graph"
        role="img"
      />
      {cards.map((p) => {
        const [px, py] = toPx(p.x, p.y)
        const isPinned = pinned.some((q) => q.x === p.x && q.y === p.y)
        const flip = px > size.w - 150
        return (
          <div
            key={`${p.x},${p.y}`}
            className={`gp-card${flip ? ' flip' : ''}`}
            style={{ left: px, top: py }}
          >
            <Tex latex={pointLatex(exactOrDecimal(p.x), exactOrDecimal(p.y))} />
            {isPinned && editable && (
              <button type="button" className="gp-card-export" title="Add to the expression list" onClick={() => onExportPoint(p.x, p.y)}>
                <ListPlus size={15} />
              </button>
            )}
          </div>
        )
      })}
      {editable && (
        <div className="gp-zoom">
          <button type="button" className="gp-btn" title="Zoom in" onClick={() => zoomCenter(0.8)}><Plus size={17} /></button>
          <button type="button" className="gp-btn" title="Zoom out" onClick={() => zoomCenter(1.25)}><Minus size={17} /></button>
          {viewport && (
            <button type="button" className="gp-btn gp-home" title="Default viewport" onClick={() => onViewport(null)}><Home size={16} /></button>
          )}
        </div>
      )}
    </div>
  )
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}
