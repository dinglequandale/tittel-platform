import { useEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import { Plus, Minus, Home, ListPlus, X } from 'lucide-react'
import {
  contour, defaultViewport, exactOrDecimal, fitAspect, gridLabel, gridStep, pointLatex, pointsOfInterest,
  regionMask, sampleCurve, zoomAbout,
  type Analysis, type Curve, type GraphItem, type GraphPin, type GraphSettings, type Poi, type Polyline, type RegionMask,
  type Segments, type Viewport,
} from '@tittel/graph'
import { Tex } from './Tex.tsx'

// The graph paper (GRAPH-SPEC §3.3–3.4): grid, axes, curves, points, points
// of interest. Canvas-drawn; DOM only for the overlay buttons and POI cards.

const HIT_CURVE_PX = 7
const HIT_POINT_PX = 11
const HIT_POI_PX = 9

interface DragTarget extends GraphPin { name: string; axis: 'x' | 'y'; other?: { name: string; axis: 'x' | 'y' } }

export function GraphPaper({
  analysis,
  items,
  viewport,
  settings,
  selectedId,
  pins,
  editable,
  onSelect,
  onViewport,
  onDragVar,
  onExportPoint,
  onPin,
}: {
  analysis: Analysis
  items: GraphItem[]
  viewport: Viewport | null
  settings: GraphSettings
  selectedId: string | null
  /** Coordinate labels, shared with everyone viewing this graph. */
  pins: GraphPin[]
  editable: boolean
  onSelect: (id: string | null) => void
  onViewport: (v: Viewport | null) => void
  /** A draggable point moved: set slider `name` to `value` (rounded to `resolution`). */
  onDragVar: (name: string, value: number, resolution: number) => void
  onExportPoint: (x: number, y: number) => void
  /** Pin the point at (x, y), or unpin it if it's already pinned. */
  onPin: (x: number, y: number) => void
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [hover, setHover] = useState<Poi | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    // Measure now as well: ResizeObserver only reports during rendering frames,
    // which a background tab doesn't get, so the paper would start blank there.
    measure()
    const ro = new ResizeObserver(measure)
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

  // Colour and visibility per row. Tables colour their points per column, so
  // their row is never hidden as a whole.
  const style = useMemo(() => {
    const m = new Map<string, { color: string; hidden: boolean }>()
    for (const it of items) m.set(it.id, it.type === 'table' ? { color: it.columns[1]?.color ?? '#000', hidden: false } : { color: it.color, hidden: !!it.hidden })
    return m
  }, [items])
  const visible = (id: string) => { const st = style.get(id); return st && !st.hidden ? st : undefined }

  // Sampled geometry for everything visible, recomputed when the view or graph changes.
  const geometry = useMemo(() => {
    const curves: { id: string; color: string; dashed: boolean; curve: Curve; lines: Polyline[] }[] = []
    const implicits: { id: string; color: string; dashed: boolean; segs: Segments }[] = []
    const regions: { id: string; color: string; mask: RegionMask }[] = []
    if (!size.w) return { curves, implicits, regions }
    for (const r of analysis.rows) {
      const st = visible(r.id)
      if (!st) continue
      if (r.region) regions.push({ id: r.id, color: st.color, mask: regionMask(r.region.test, view, size.w, size.h) })
      for (const c of r.curves ?? []) curves.push({ id: r.id, color: st.color, dashed: !!c.dashed, curve: c, lines: sampleCurve(c, view, size.w, size.h) })
      for (const im of r.implicits ?? []) {
        const f = im.restrict ? (x: number, y: number) => (im.restrict!(x, y) ? im.f(x, y) : NaN) : im.f
        implicits.push({ id: r.id, color: st.color, dashed: !!im.dashed, segs: contour(f, view, size.w, size.h) })
      }
    }
    return { curves, implicits, regions }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, style, view, size])
  const { curves, implicits, regions } = geometry

  const points = useMemo(() => {
    const out: { id: string; color: string; x: number; y: number; line?: boolean; dragX?: string; dragY?: string }[] = []
    for (const r of analysis.rows) {
      const st = visible(r.id)
      if (!r.points || !st) continue
      for (const p of r.points) if (Number.isFinite(p.x) && Number.isFinite(p.y)) out.push({ id: r.id, ...p, color: p.color ?? st.color })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, style])

  // Points of interest: explicit y = f(x) curves of the selected row, against
  // every other visible explicit curve (G1 scope, GRAPH-SPEC §3.4).
  const pois = useMemo(() => {
    if (!selectedId || !visible(selectedId) || !size.w) return []
    const explicit = (c: Curve) => c.orientation === 'y' && !c.dashed
    const mine = (analysis.byId.get(selectedId)?.curves ?? []).filter(explicit)
    if (!mine.length) return []
    const others = analysis.rows
      .filter((r) => r.id !== selectedId && visible(r.id))
      .flatMap((r) => (r.curves ?? []).filter(explicit))
    return mine.flatMap((c, i) => pointsOfInterest(c, [...others, ...mine.filter((_, j) => j !== i)], view, size.w))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, selectedId, style, view, size])

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

    // Inequality shading (fill opacity ≈ 0.4 [API]; lighter where regions overlap
    // reads better, so 0.3).
    for (const rg of regions) {
      const { cols, rows, cellPx, mask } = rg.mask
      g.fillStyle = rg.color
      g.globalAlpha = 0.3
      for (let r = 0; r < rows; r++) {
        let c = 0
        while (c < cols) {
          if (!mask[r * cols + c]) { c++; continue }
          const start = c
          while (c < cols && mask[r * cols + c]) c++
          g.fillRect(start * cellPx, r * cellPx, (c - start) * cellPx, cellPx)
        }
      }
      g.globalAlpha = 1
    }

    // Implicit curves (contour segments).
    for (const im of implicits) {
      g.strokeStyle = im.color
      g.globalAlpha = 0.9
      g.lineWidth = im.id === selectedId ? 3.75 : 2.5
      g.lineCap = 'round'
      g.setLineDash(im.dashed ? [9, 7] : [])
      g.beginPath()
      for (let i = 0; i < im.segs.length; i += 4) {
        const [ax, ay] = toPx(im.segs[i], im.segs[i + 1])
        const [bx, by] = toPx(im.segs[i + 2], im.segs[i + 3])
        g.moveTo(ax, ay); g.lineTo(bx, by)
      }
      g.stroke()
      g.setLineDash([])
      g.globalAlpha = 1
    }

    // Curves: selected one drawn last and thicker [OBS].
    const ordered = [...curves].sort((a, b) => (a.id === selectedId ? 1 : 0) - (b.id === selectedId ? 1 : 0))
    const clamp = (v: number) => Math.max(-1e4, Math.min(1e4 + Math.max(w, h), v))
    for (const cv of ordered) {
      g.strokeStyle = cv.color
      g.globalAlpha = 0.9
      g.lineWidth = cv.id === selectedId ? 3.75 : 2.5
      g.lineJoin = 'round'
      g.lineCap = cv.dashed ? 'butt' : 'round'
      g.setLineDash(cv.dashed ? [9, 7] : [])
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
      g.setLineDash([])
      g.globalAlpha = 1
    }

    // Table columns styled "lines": join each point to the previous one.
    g.lineWidth = 2.5
    for (let i = 1; i < points.length; i++) {
      const p = points[i]
      if (!p.line) continue
      const q = points[i - 1]
      const [ax, ay] = toPx(q.x, q.y)
      const [bx, by] = toPx(p.x, p.y)
      g.strokeStyle = p.color
      g.globalAlpha = 0.9
      g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke()
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

    for (const p of pois) {
      const [px, py] = toPx(p.x, p.y)
      const strong = hover && hover.x === p.x && hover.y === p.y
      g.fillStyle = strong ? '#0F0F0F' : '#A4A6A3'
      g.beginPath(); g.arc(px, py, strong ? 5.5 : 4.25, 0, Math.PI * 2); g.fill()
    }

    g.fillStyle = '#0F0F0F'
    for (const p of pins) {
      const [px, py] = toPx(p.x, p.y)
      g.beginPath(); g.arc(px, py, 5.5, 0, Math.PI * 2); g.fill()
    }
  }

  // ---- interaction ----------------------------------------------------------
  const drag = useRef<
    | { kind: 'pan'; startX: number; startY: number; base: Viewport; moved: boolean }
    | { kind: 'point'; target: DragTarget; startX: number; startY: number; moved: boolean }
    | null
  >(null)

  const local = (e: { clientX: number; clientY: number }) => {
    const r = canvasRef.current!.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top] as const
  }

  const hitPoi = (px: number, py: number) =>
    pois.find((p) => { const [x, y] = toPx(p.x, p.y); return Math.hypot(x - px, y - py) <= HIT_POI_PX })

  const hitPin = (px: number, py: number) =>
    pins.find((p) => { const [x, y] = toPx(p.x, p.y); return Math.hypot(x - px, y - py) <= HIT_POI_PX })

  const hitPoint = (px: number, py: number) =>
    points.find((p) => { const [x, y] = toPx(p.x, p.y); return Math.hypot(x - px, y - py) <= HIT_POINT_PX })

  const hitDraggable = (px: number, py: number): DragTarget | undefined => {
    if (!editable) return undefined
    for (let i = points.length - 1; i >= 0; i--) {
      const p = points[i]
      if (!p.dragX && !p.dragY) continue
      const [x, y] = toPx(p.x, p.y)
      if (Math.hypot(x - px, y - py) > HIT_POINT_PX) continue
      const at = { x: p.x, y: p.y }
      if (p.dragX && p.dragY) return { ...at, name: p.dragX, axis: 'x', other: { name: p.dragY, axis: 'y' } }
      return p.dragX ? { ...at, name: p.dragX, axis: 'x' } : { ...at, name: p.dragY!, axis: 'y' }
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
    for (const im of implicits) {
      for (let i = 0; i < im.segs.length; i += 4) {
        const [ax, ay] = toPx(im.segs[i], im.segs[i + 1])
        const [bx, by] = toPx(im.segs[i + 2], im.segs[i + 3])
        const d = segDist(px, py, ax, ay, bx, by)
        if (d < bestD) { bestD = d; best = im.id }
      }
    }
    if (best) return best
    for (const p of points) {
      const [x, y] = toPx(p.x, p.y)
      if (Math.hypot(x - px, y - py) <= HIT_POINT_PX) return p.id
    }
    return undefined
  }

  /** Where a click on row `id` landed on its curve. On y = f(x) and x = f(y) the
   *  free coordinate rounds to what a pixel can tell apart, so a click near
   *  x = 2 on y = x² reads (2, 4), not (2.013, 4.052). */
  const pointOnCurve = (id: string, px: number, py: number): GraphPin => {
    let bestD = Infinity
    let best: [number, number] = [px, py]
    let curve: Curve | undefined
    const consider = (ax: number, ay: number, bx: number, by: number, c?: Curve) => {
      const q = segClosest(px, py, ax, ay, bx, by)
      const d = Math.hypot(px - q[0], py - q[1])
      if (d < bestD) { bestD = d; best = q; curve = c }
    }
    for (const cv of curves) {
      if (cv.id !== id) continue
      for (const line of cv.lines) {
        for (let i = 0; i + 3 < line.length; i += 2) {
          const [ax, ay] = toPx(line[i], line[i + 1])
          const [bx, by] = toPx(line[i + 2], line[i + 3])
          consider(ax, ay, bx, by, cv.curve)
        }
      }
    }
    for (const im of implicits) {
      if (im.id !== id) continue
      for (let i = 0; i < im.segs.length; i += 4) {
        const [ax, ay] = toPx(im.segs[i], im.segs[i + 1])
        const [bx, by] = toPx(im.segs[i + 2], im.segs[i + 3])
        consider(ax, ay, bx, by)
      }
    }
    const [mx, my] = toMath(best[0], best[1])
    if (!curve) return { x: mx, y: my }
    const decimals = Math.max(0, -Math.ceil(Math.log10((view.xmax - view.xmin) / size.w)))
    const t = Number((curve.orientation === 'y' ? mx : my).toFixed(decimals))
    const v = curve.fn(t)
    if (!Number.isFinite(v)) return { x: mx, y: my }
    return curve.orientation === 'y' ? { x: t, y: v } : { x: v, y: t }
  }

  const onPointerDown = (e: RPointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0) return
    const [px, py] = local(e)
    const target = hitDraggable(px, py)
    if (target) {
      drag.current = { kind: 'point', target, startX: e.clientX, startY: e.clientY, moved: false }
      e.currentTarget.setPointerCapture(e.pointerId)
      return
    }
    const hit = hitPin(px, py) ?? hitPoi(px, py)
    if (hit) {
      onPin(hit.x, hit.y)
      return
    }
    drag.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, base: view, moved: false }
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  const onPointerMove = (e: RPointerEvent<HTMLCanvasElement>) => {
    const [px, py] = local(e)
    const d = drag.current
    if (d?.kind === 'point') {
      if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < 3) return
      d.moved = true
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
    el.style.cursor = hitDraggable(px, py) ? 'grab' : poi || hitPin(px, py) || hitCurve(px, py) ? 'pointer' : editable ? 'move' : 'default'
  }

  const onPointerUp = (e: RPointerEvent<HTMLCanvasElement>) => {
    const d = drag.current
    drag.current = null
    if (d?.kind === 'point' && !d.moved) onPin(d.target.x, d.target.y)
    if (d?.kind === 'pan' && !d.moved) {
      const [px, py] = local(e)
      const id = hitCurve(px, py)
      onSelect(id ?? null)
      if (!id) return
      const at = hitPoint(px, py) ?? pointOnCurve(id, px, py)
      onPin(at.x, at.y)
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

  const cards = [...pins]
  if (hover && !pins.some((p) => p.x === hover.x && p.y === hover.y)) cards.push(hover)

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
        const isPinned = pins.some((q) => q.x === p.x && q.y === p.y)
        const flip = px > size.w - 170
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
            {isPinned && (
              <button type="button" className="gp-card-export" title="Remove label" onClick={() => onPin(p.x, p.y)}>
                <X size={15} />
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

function segClosest(px: number, py: number, ax: number, ay: number, bx: number, by: number): [number, number] {
  const dx = bx - ax, dy = by - ay
  const len = dx * dx + dy * dy
  const t = len ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len)) : 0
  return [ax + t * dx, ay + t * dy]
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const [qx, qy] = segClosest(px, py, ax, ay, bx, by)
  return Math.hypot(px - qx, py - qy)
}
