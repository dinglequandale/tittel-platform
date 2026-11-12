import * as Y from 'yjs'

// Lesson content on a board is the tutor's: locked blocks, question records
// (shapes with `meta.q`) and the plan's pages (`meta.lesson`). A guest who may
// write can still send edits to them, whatever their client shows, so the sync
// room puts every protected record a guest's update touched back as it was,
// in the same transaction: the host and the other students never see it change.

type Fields = Record<string, unknown>

const hasKey = (meta: unknown, key: string) => !!meta && typeof meta === 'object' && key in meta

function protectedShape(map: Y.Map<unknown> | undefined): boolean {
  if (!map) return false
  const meta = map.get('meta')
  return map.get('locked') === true || hasKey(meta, 'q') || hasKey(meta, 'lesson')
}

const protectedPage = (page: Fields | undefined) => !!page && hasKey(page.meta, 'lesson')

/** JSON with the top-level keys sorted, so equal records compare equal. */
function stable(record: Fields): string {
  return JSON.stringify(Object.fromEntries(Object.entries(record).sort(([a], [b]) => (a < b ? -1 : 1))))
}

/** A shape as BoardDoc stores it: one Y.Map, ink points in a Y.Array. */
function shapeMap(record: Fields): Y.Map<unknown> {
  const map = new Y.Map<unknown>()
  for (const [key, value] of Object.entries(record)) {
    map.set(key, key === 'points' && Array.isArray(value) ? Y.Array.from(value) : value)
  }
  return map
}

export class LessonLock {
  private shapes: Y.Map<Y.Map<unknown>>
  private pages: Y.Map<Fields>
  /** Protected records as they last stood after an edit that was allowed in. */
  private keptShapes = new Map<string, string>()
  private keptPages = new Map<string, string>()

  constructor(doc: Y.Doc) {
    this.shapes = doc.getMap('shapes')
    this.pages = doc.getMap('pages')
    for (const id of this.shapes.keys()) this.keepShape(id)
    for (const id of this.pages.keys()) this.keepPage(id)
    doc.on('afterTransaction', (tr: Y.Transaction) => {
      const { shapeIds, pageIds } = this.touched(tr)
      for (const id of shapeIds) this.keepShape(id)
      for (const id of pageIds) this.keepPage(id)
    })
  }

  /**
   * Call inside the transaction that applied a guest's update: puts back every
   * protected record it changed or deleted, and removes any it created.
   * Returns how many records were put back.
   */
  restore(tr: Y.Transaction): number {
    const { shapeIds, pageIds } = this.touched(tr)
    let restored = 0
    for (const id of shapeIds) {
      const kept = this.keptShapes.get(id)
      const now = this.shapes.get(id)
      if (kept === undefined) {
        if (protectedShape(now)) {
          this.shapes.delete(id)
          restored++
        }
      } else if (!now || stable(now.toJSON()) !== kept) {
        this.shapes.set(id, shapeMap(JSON.parse(kept)))
        restored++
      }
    }
    for (const id of pageIds) {
      const kept = this.keptPages.get(id)
      const now = this.pages.get(id)
      if (kept === undefined) {
        if (protectedPage(now)) {
          this.pages.delete(id)
          restored++
        }
      } else if (!now || stable(now) !== kept) {
        this.pages.set(id, JSON.parse(kept))
        restored++
      }
    }
    return restored
  }

  private keepShape(id: string) {
    const map = this.shapes.get(id)
    if (protectedShape(map)) this.keptShapes.set(id, stable(map!.toJSON()))
    else this.keptShapes.delete(id)
  }

  private keepPage(id: string) {
    const page = this.pages.get(id)
    if (protectedPage(page)) this.keptPages.set(id, stable(page!))
    else this.keptPages.delete(id)
  }

  /** The shape and page ids a transaction changed, nested edits included. */
  private touched(tr: Y.Transaction): { shapeIds: Set<string>; pageIds: Set<string> } {
    const shapeIds = new Set<string>()
    const pageIds = new Set<string>()
    for (const [type, keys] of tr.changed) {
      if ((type as unknown) === this.shapes) {
        for (const key of keys) if (key) shapeIds.add(key)
      } else if ((type as unknown) === this.pages) {
        for (const key of keys) if (key) pageIds.add(key)
      } else {
        const id = this.shapeIdOf(type)
        if (id) shapeIds.add(id)
      }
    }
    return { shapeIds, pageIds }
  }

  /** Walks up from a nested type (a shape's map, or its points) to the shape's id. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private shapeIdOf(type: Y.AbstractType<any>): string | null {
    let item = type._item
    while (item) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const parent = item.parent as Y.AbstractType<any> | null
      if ((parent as unknown) === this.shapes) return item.parentSub
      item = parent?._item ?? null
    }
    return null
  }
}
