import type { BoardDoc } from './doc.ts'
import { FONT_SIZES, INK_COLORS, LINE_HEIGHT, type InkColor, type InkDash, type InkSize, type NewShape } from './schema.ts'
import { toPage } from './geometry.ts'

// Reads a board saved by the old tldraw engine (boards.snapshot, a sync room
// snapshot from tldraw 3.15.5) into our document. It runs once per board, the
// first time it opens. Best effort by design: anything with no equivalent here is
// counted in `skipped` rather than failing the board.

type Rec = Record<string, any>

const stripPrefix = (id: string) => id.slice(id.indexOf(':') + 1)

const asColor = (c: unknown): InkColor => (typeof c === 'string' && c in INK_COLORS ? (c as InkColor) : 'black')
const asSize = (s: unknown): InkSize => (s === 's' || s === 'm' || s === 'l' || s === 'xl' ? s : 'm')
const asDash = (d: unknown): InkDash => (d === 'dashed' || d === 'dotted' ? d : 'solid')

/** Plain text of a tldraw rich-text doc: one line per paragraph. */
function plainText(rich: Rec | undefined): string {
  const lines = (rich?.content ?? []).map((para: Rec) =>
    (para.content ?? []).map((node: Rec) => node.text ?? '').join(''),
  )
  return lines.join('\n').trim()
}

function textBox(text: string, fontSize: number) {
  const lines = text.split('\n')
  const longest = Math.max(...lines.map((l) => l.length))
  return { w: Math.max(fontSize, longest * fontSize * 0.55), h: lines.length * fontSize * LINE_HEIGHT }
}

/** A shape's position and rotation on the page, through any groups it sits in. */
function placement(rec: Rec, byId: Map<string, Rec>): { page: string; x: number; y: number; rotation: number } {
  const parent = byId.get(rec.parentId)
  if (!parent || parent.typeName !== 'shape') {
    return { page: stripPrefix(rec.parentId), x: rec.x, y: rec.y, rotation: rec.rotation }
  }
  const outer = placement(parent, byId)
  const at = toPage({ ...outer } as never, { x: rec.x, y: rec.y })
  return { ...outer, x: at.x, y: at.y, rotation: outer.rotation + rec.rotation }
}

/** The closed polygon for a geo shape that isn't a plain box. */
function geoVertices(geo: string, w: number, h: number): number[] | null {
  if (geo === 'triangle') return [w / 2, 0, w, h, 0, h]
  if (geo === 'diamond') return [w / 2, 0, w, h / 2, w / 2, h, 0, h / 2]
  return null
}

function convert(rec: Rec, byId: Map<string, Rec>, assets: Map<string, Rec>): NewShape[] {
  const p = rec.props
  const base = {
    id: stripPrefix(rec.id),
    ...placement(rec, byId),
    locked: !!rec.isLocked,
    opacity: rec.opacity ?? 1,
    meta: rec.meta ?? {},
  }
  const style = { color: asColor(p.color), size: asSize(p.size), dash: asDash(p.dash) }

  const label = (cx: number, cy: number): NewShape[] => {
    const text = plainText(p.richText)
    if (!text) return []
    const fontSize = FONT_SIZES[style.size]
    const box = textBox(text, fontSize)
    const at = toPage({ ...base } as never, { x: cx - box.w / 2, y: cy - box.h / 2 })
    return [{ ...base, ...at, id: `${base.id}-label`, type: 'text', text, color: asColor(p.labelColor ?? p.color), size: style.size, fontSize, ...box }]
  }

  switch (rec.type) {
    case 'draw':
    case 'highlight': {
      const points: number[] = []
      for (const segment of p.segments) {
        for (const q of segment.points) points.push(q.x, q.y, q.z ?? 0.5)
      }
      return [{ ...base, ...style, type: rec.type === 'draw' ? 'ink' : 'highlight', points, sx: 1, sy: 1, pen: !!p.isPen, done: true }]
    }
    case 'line': {
      const ordered = Object.values(p.points as Record<string, Rec>).sort((a, b) => (a.index < b.index ? -1 : 1))
      const closed = !!rec.meta?.closed
      const vertices = (closed ? ordered.slice(0, -1) : ordered).flatMap((q) => [q.x, q.y])
      const { closed: _dropped, ...meta } = base.meta as Record<string, unknown>
      return [{ ...base, meta, ...style, type: 'line', vertices, closed }]
    }
    case 'arrow':
      return [{ ...base, ...style, type: 'arrow', vertices: [p.start.x, p.start.y, p.end.x, p.end.y], closed: false }]
    case 'geo': {
      const h = p.h + (p.growY ?? 0)
      const vertices = geoVertices(p.geo, p.w, h)
      const shape: NewShape = vertices
        ? { ...base, ...style, type: 'line', vertices, closed: true }
        : { ...base, ...style, type: p.geo === 'ellipse' || p.geo === 'oval' ? 'ellipse' : 'rect', w: p.w, h, fill: p.fill !== 'none' }
      return [shape, ...label(p.w / 2, h / 2)]
    }
    case 'text': {
      const text = plainText(p.richText)
      if (!text) return []
      const fontSize = FONT_SIZES[style.size]
      return [{ ...base, type: 'text', text, color: style.color, size: style.size, fontSize, ...textBox(text, fontSize) }]
    }
    case 'note': {
      const side = 200
      return [
        { ...base, ...style, dash: 'solid', type: 'rect', w: side, h: side, fill: true },
        ...label(side / 2, side / 2),
      ]
    }
    case 'image': {
      const asset = assets.get(p.assetId)
      const src = asset?.props.src ?? p.url
      return src ? [{ ...base, type: 'image', src, w: p.w, h: p.h }] : []
    }
    default:
      return []
  }
}

/** Fills an empty document from a tldraw snapshot. */
export function importTldrawSnapshot(doc: BoardDoc, snapshot: unknown): { shapes: number; skipped: number } {
  const records: Rec[] = ((snapshot as Rec | null)?.documents ?? []).map((d: Rec) => d.state)
  const byId = new Map(records.map((r) => [r.id as string, r]))
  const assets = new Map(records.filter((r) => r.typeName === 'asset').map((r) => [r.id as string, r]))
  const pages = records.filter((r) => r.typeName === 'page').sort((a, b) => (a.index < b.index ? -1 : 1))
  // Fractional indices sort as strings, so stacking follows them, page by page.
  const shapes = records.filter((r) => r.typeName === 'shape' && r.type !== 'group').sort((a, b) => (a.index < b.index ? -1 : 1))

  let imported = 0
  let skipped = 0
  doc.ydoc.transact(() => {
    pages.forEach((page, i) => doc.createPage({ id: stripPrefix(page.id), name: page.name, order: i + 1, meta: page.meta ?? {} }))
    shapes.forEach((rec, z) => {
      try {
        const converted = convert(rec, byId, assets)
        if (converted.length === 0) skipped++
        for (const shape of converted) {
          doc.createShape({ ...shape, z: z + 1 })
          imported++
        }
      } catch {
        skipped++
      }
    })
  })
  return { shapes: imported, skipped }
}
