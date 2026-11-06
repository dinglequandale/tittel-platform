import * as Y from 'yjs'
import { FIRST_PAGE, type NewShape, type Page, type Shape } from './schema.ts'

// A board is a Yjs doc: `pages` holds plain page records and `shapes` holds one
// Y.Map per shape, so two people editing different fields never collide. Ink
// points live in a Y.Array, which lets a stroke in progress send only its new
// points rather than the whole stroke on every move.
//
// Readers get immutable plain objects, rebuilt only for shapes that changed,
// so a view can compare by identity.

/** Marks this client's own edits. Undo only ever touches these, never a collaborator's. */
const LOCAL = Symbol('local')

type ShapeMap = Y.Map<unknown>

export class BoardDoc {
  readonly ydoc: Y.Doc
  private pages: Y.Map<Page>
  private shapes: Y.Map<ShapeMap>
  private undoManager: Y.UndoManager
  private plain = new Map<string, Shape>()
  private pageIds = new Map<string, string[]>()
  private listeners = new Set<() => void>()

  constructor(ydoc: Y.Doc = new Y.Doc()) {
    this.ydoc = ydoc
    this.pages = ydoc.getMap('pages')
    this.shapes = ydoc.getMap('shapes')
    // Grouping is by gesture, not time: `mark()` closes a step, so the timeout
    // only has to outlast the slowest stroke.
    this.undoManager = new Y.UndoManager([this.pages, this.shapes], {
      trackedOrigins: new Set([LOCAL]),
      captureTimeout: 24 * 60 * 60 * 1000,
    })
    this.shapes.observeDeep((events) => {
      for (const event of events) {
        if (event.target === this.shapes) {
          for (const id of event.changes.keys.keys()) this.plain.delete(id)
          this.pageIds.clear()
        } else {
          this.plain.delete(event.path[0] as string)
          const keys = event.changes.keys
          if (keys.has('z') || keys.has('page')) this.pageIds.clear()
        }
      }
    })
    this.pages.observe(() => this.pageIds.clear())
    ydoc.on('afterTransaction', this.notify)
    this.undoManager.on('stack-item-added', this.notify)
    this.undoManager.on('stack-item-popped', this.notify)
  }

  private notify = () => {
    for (const fn of this.listeners) fn()
  }

  subscribe(fn: () => void) {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  /** Runs several edits as one sync message. */
  transact(fn: () => void) {
    this.ydoc.transact(fn, LOCAL)
  }

  // ---- undo -------------------------------------------------------------

  /** Closes the undo step: edits after this undo separately from edits before it. */
  mark() {
    this.undoManager.stopCapturing()
  }

  undo() {
    this.undoManager.undo()
  }

  redo() {
    this.undoManager.redo()
  }

  canUndo() {
    return this.undoManager.canUndo()
  }

  canRedo() {
    return this.undoManager.canRedo()
  }

  // ---- pages ------------------------------------------------------------

  getPages(): Page[] {
    return [...this.pages.values()].sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
  }

  getPage(id: string): Page | undefined {
    return this.pages.get(id)
  }

  createPage(page: Pick<Page, 'id' | 'name'> & Partial<Page>) {
    const last = this.getPages().at(-1)
    this.transact(() => this.pages.set(page.id, { order: (last?.order ?? 0) + 1, meta: {}, ...page }))
  }

  renamePage(id: string, name: string) {
    const page = this.pages.get(id)
    if (page) this.transact(() => this.pages.set(id, { ...page, name }))
  }

  /** Removes a page and its shapes. The last page can't go. */
  deletePage(id: string) {
    if (this.pages.size <= 1) return
    this.transact(() => {
      this.deleteShapes(this.getPageShapeIds(id))
      this.pages.delete(id)
    })
  }

  /** A new board's starting page. Only the server calls this. */
  seedFirstPage() {
    if (this.pages.size === 0) this.ydoc.transact(() => this.pages.set(FIRST_PAGE.id, FIRST_PAGE))
  }

  // ---- shapes -----------------------------------------------------------

  getShape(id: string): Shape | undefined {
    const cached = this.plain.get(id)
    if (cached) return cached
    const map = this.shapes.get(id)
    if (!map) return undefined
    const shape = map.toJSON() as Shape
    this.plain.set(id, shape)
    return shape
  }

  /** Ids on a page, back to front. Stable until the set or the order changes. */
  getPageShapeIds(pageId: string): string[] {
    let ids = this.pageIds.get(pageId)
    if (!ids) {
      const onPage: { id: string; z: number }[] = []
      for (const [id, map] of this.shapes) {
        if (map.get('page') === pageId) onPage.push({ id, z: map.get('z') as number })
      }
      ids = onPage.sort((a, b) => a.z - b.z || a.id.localeCompare(b.id)).map((s) => s.id)
      this.pageIds.set(pageId, ids)
    }
    return ids
  }

  getPageShapes(pageId: string): Shape[] {
    return this.getPageShapeIds(pageId).map((id) => this.getShape(id)!)
  }

  /** Adds a shape on top of its page. `shape.page` must be set. */
  createShape(shape: NewShape): string {
    // Read from the maps, not the cached lists: those lag inside a transaction.
    let top = 0
    for (const map of this.shapes.values()) {
      if (map.get('page') === shape.page) top = Math.max(top, map.get('z') as number)
    }
    const full = { rotation: 0, locked: false, opacity: 1, meta: {}, z: top + 1, ...shape }
    this.transact(() => {
      const map: ShapeMap = new Y.Map()
      for (const [key, value] of Object.entries(full)) {
        map.set(key, key === 'points' ? Y.Array.from(value as number[]) : value)
      }
      this.shapes.set(full.id, map)
    })
    return full.id
  }

  updateShape(id: string, patch: Partial<Shape>) {
    const map = this.shapes.get(id)
    if (!map) return
    this.transact(() => {
      for (const [key, value] of Object.entries(patch)) {
        if (map.get(key) !== value) map.set(key, value)
      }
    })
  }

  /** Adds points to a stroke in progress. */
  appendPoints(id: string, points: number[]) {
    const array = this.shapes.get(id)?.get('points') as Y.Array<number> | undefined
    if (array) this.transact(() => array.push(points))
  }

  deleteShapes(ids: string[]) {
    this.transact(() => {
      for (const id of ids) this.shapes.delete(id)
    })
  }
}
