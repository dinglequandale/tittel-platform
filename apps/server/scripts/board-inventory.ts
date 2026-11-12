// Read-only inventory of saved boards, to run before the first deploy of the
// new board engine (LAUNCH.md L2.5). It changes nothing: the whole run is one
// READ ONLY transaction, so even a mistake here can't write.
//
//   cd apps/server && npx tsx scripts/board-inventory.ts
//
// Uses DATABASE_URL (from apps/server/.env if present). For each board it
// reports the size of its old tldraw save (boards.snapshot) and of its new
// document (boards.doc), and which tldraw shapes the importer
// (packages/board/src/fromTldraw.ts) will drop or draw as a plain rectangle.
import '../src/env.ts'
import { pool } from '../src/db.ts'

const MAX_DOC_BYTES = 5 * 1024 * 1024 // rooms.ts MAX_SNAPSHOT_BYTES
const KEPT_GEO = new Set(['rectangle', 'ellipse', 'oval', 'triangle', 'diamond'])
const KEPT_TYPES = new Set(['draw', 'highlight', 'line', 'arrow', 'text', 'image', 'geo', 'note', 'group'])

type Rec = Record<string, any>

interface BoardReport {
  shapes: number
  /** Shapes the importer leaves out, by tldraw type. */
  dropped: Record<string, number>
  /** Shapes that arrive as a rectangle, by tldraw type (geo:<kind> for geo shapes). */
  asRectangle: Record<string, number>
  /** Arrows that arrive straight and unattached (curved or bound in tldraw). */
  simplifiedArrows: number
  /** Images whose data sits inside the save itself rather than in uploads. */
  inlineImages: number
}

const bump = (counts: Record<string, number>, key: string) => {
  counts[key] = (counts[key] ?? 0) + 1
}

/** What the importer will do with one tldraw snapshot. */
function inspectSnapshot(snapshot: unknown): BoardReport {
  const records: Rec[] = ((snapshot as Rec | null)?.documents ?? []).map((d: Rec) => d.state).filter(Boolean)
  const assets = new Map(records.filter((r) => r.typeName === 'asset').map((r) => [r.id, r]))
  const bound = new Set(records.filter((r) => r.typeName === 'binding').map((r) => r.fromId))
  const report: BoardReport = { shapes: 0, dropped: {}, asRectangle: {}, simplifiedArrows: 0, inlineImages: 0 }
  for (const r of records) {
    if (r.typeName !== 'shape' || r.type === 'group') continue
    report.shapes++
    const p = r.props ?? {}
    if (!KEPT_TYPES.has(r.type)) bump(report.dropped, r.type)
    else if (r.type === 'geo' && !KEPT_GEO.has(p.geo)) bump(report.asRectangle, `geo:${p.geo}`)
    else if (r.type === 'note') bump(report.asRectangle, 'note')
    else if (r.type === 'arrow' && (bound.has(r.id) || (p.bend ?? 0) !== 0)) report.simplifiedArrows++
    else if (r.type === 'image') {
      const src = assets.get(p.assetId)?.props?.src ?? p.url
      if (!src) bump(report.dropped, 'image (no source)')
      else if (String(src).startsWith('data:')) report.inlineImages++
    } else if (r.type === 'text' && !JSON.stringify(p.richText ?? '').includes('"text"')) bump(report.dropped, 'text (empty)')
  }
  return report
}

const kb = (n: number | null) => (n == null ? '-' : `${Math.round(n / 1024)} KB`)
const list = (counts: Record<string, number>) => Object.entries(counts).map(([k, v]) => `${v} ${k}`).join(', ')

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set')
  const client = await pool.connect()
  try {
    await client.query('begin transaction read only')
    const { rows: boards } = await client.query<{ id: string; title: string | null; archived: boolean; snap_bytes: number | null; doc_bytes: number | null }>(
      `select id, title, archived_at is not null as archived,
              octet_length(snapshot::text) as snap_bytes, octet_length(doc) as doc_bytes
         from boards order by created_at`,
    )
    const totals = { boards: boards.length, withSnapshot: 0, imported: 0, toImport: 0, shapes: 0, overCap: 0, nearCap: 0 }
    const dropped: Record<string, number> = {}
    const asRectangle: Record<string, number> = {}
    let simplifiedArrows = 0
    let inlineImages = 0
    const notes: string[] = []

    for (const b of boards) {
      const name = `${b.id}${b.title ? ` "${b.title}"` : ''}${b.archived ? ' (archived)' : ''}`
      const biggest = Math.max(b.doc_bytes ?? 0, b.snap_bytes ?? 0)
      if (b.doc_bytes != null) totals.imported++
      if (biggest > MAX_DOC_BYTES) totals.overCap++
      else if (biggest > MAX_DOC_BYTES * 0.8) totals.nearCap++
      if (b.snap_bytes == null) continue
      totals.withSnapshot++
      if (b.doc_bytes == null) totals.toImport++
      // One snapshot at a time: they can be megabytes each.
      const { rows: [row] } = await client.query<{ snapshot: unknown }>('select snapshot from boards where id = $1', [b.id])
      const r = inspectSnapshot(row.snapshot)
      totals.shapes += r.shapes
      for (const [k, v] of Object.entries(r.dropped)) dropped[k] = (dropped[k] ?? 0) + v
      for (const [k, v] of Object.entries(r.asRectangle)) asRectangle[k] = (asRectangle[k] ?? 0) + v
      simplifiedArrows += r.simplifiedArrows
      inlineImages += r.inlineImages
      const issues = [
        Object.keys(r.dropped).length ? `drops ${list(r.dropped)}` : '',
        Object.keys(r.asRectangle).length ? `rectangles for ${list(r.asRectangle)}` : '',
        r.simplifiedArrows ? `${r.simplifiedArrows} arrows straightened/unbound` : '',
        r.inlineImages ? `${r.inlineImages} inline images` : '',
        biggest > MAX_DOC_BYTES * 0.8 ? `${kb(biggest)}: ${biggest > MAX_DOC_BYTES ? 'over' : 'near'} the 5 MB save cap` : '',
      ].filter(Boolean)
      if (issues.length) notes.push(`  ${name} (snapshot ${kb(b.snap_bytes)}, doc ${kb(b.doc_bytes)}): ${issues.join('; ')}`)
    }
    await client.query('rollback')

    console.log('Board inventory (read-only)')
    console.log(`  boards: ${totals.boards}; with a tldraw save: ${totals.withSnapshot}; already opened on the new engine: ${totals.imported}; still to import: ${totals.toImport}`)
    console.log(`  tldraw shapes: ${totals.shapes}`)
    console.log(`  dropped on import: ${list(dropped) || 'none'}`)
    console.log(`  drawn as rectangles: ${list(asRectangle) || 'none'}`)
    console.log(`  arrows straightened or unbound: ${simplifiedArrows}`)
    console.log(`  images stored inside the save: ${inlineImages}`)
    console.log(`  boards over the 5 MB save cap: ${totals.overCap}; over 80%: ${totals.nearCap}`)
    console.log(notes.length ? `\nBoards to look at:\n${notes.join('\n')}` : '\nNo board needs a look.')
  } finally {
    client.release()
    await pool.end()
  }
}

main().catch((err) => {
  console.error('board inventory failed:', err.message)
  process.exit(1)
})
