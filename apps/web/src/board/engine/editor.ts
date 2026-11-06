import type { Awareness } from 'y-protocols/awareness'
import {
  FONT_SIZES,
  LINE_HEIGHT,
  pageBounds,
  unionBounds,
  type BoardDoc,
  type Box,
  type InkColor,
  type InkDash,
  type InkSize,
  type InkStyle,
  type Page,
  type Point,
  type Shape,
} from '@tittel/board'

// The editor: everything about a board that's local to this viewer (camera,
// page, tool, selection, style) over the shared document. The UI reads through
// `useBoardValue` and calls these methods; pointer logic lives in gestures.ts.

export interface Camera {
  x: number
  y: number
  z: number
}

export interface Collaborator {
  clientId: number
  userId: string
  userName: string
  color: string
  cursor?: { x: number; y: number; page: string }
}

export type BoardTool = 'select' | 'hand' | 'draw' | 'highlight' | 'eraser' | 'shape-ink' | 'line' | 'arrow' | 'text'

/** Text being typed. `id` is null for text that isn't on the board yet. */
export interface EditingText {
  id: string | null
  at: Point
  text: string
  color: InkColor
  fontSize: number
}

const MIN_ZOOM = 0.1
const MAX_ZOOM = 8
const CURSOR_MS = 40
const CLIPBOARD_TYPE = 'slate/shapes'
/** A pasted image starts no wider than this share of the view. */
const IMAGE_FIT = 0.6
const PASTE_OFFSET = 24

export function newId() {
  return crypto.randomUUID()
}

export class BoardEditor {
  readonly doc: BoardDoc
  private awareness: Awareness
  private listeners = new Set<() => void>()
  private container: HTMLElement | null = null

  private camera: Camera = { x: 0, y: 0, z: 1 }
  private cameraLocked = false
  private pageId: string
  private tool: BoardTool = 'select'
  private style: InkStyle = { color: 'black', size: 'm', dash: 'solid' }
  private selection: string[] = []
  private marquee: Box | null = null
  private editing: EditingText | null = null
  private readonly_ = false
  private connected = true
  private lastCursor = 0

  /** Set once a stylus is seen: from then on a finger pans instead of drawing, so a resting palm can't. */
  penMode = false
  /** Puts a file on the server and returns its URL. */
  uploadImage: (file: File) => Promise<string> = () => Promise.reject(new Error('uploads are off'))
  /** Non-image files dropped on the board. */
  onOtherFiles: ((files: File[]) => void) | null = null
  onError: ((message: string) => void) | null = null

  constructor(doc: BoardDoc, awareness: Awareness) {
    this.doc = doc
    this.awareness = awareness
    this.pageId = doc.getPages()[0].id
    doc.subscribe(this.onDocChange)
    awareness.on('change', this.notify)
  }

  private onDocChange = () => {
    if (!this.doc.getPage(this.pageId)) this.setCurrentPage(this.doc.getPages()[0].id)
    if (this.selection.some((id) => !this.doc.getShape(id))) {
      this.selection = this.selection.filter((id) => this.doc.getShape(id))
    }
    this.notify()
  }

  private notify = () => {
    for (const fn of this.listeners) fn()
  }

  subscribe = (fn: () => void) => {
    this.listeners.add(fn)
    return () => {
      this.listeners.delete(fn)
    }
  }

  dispose() {
    this.listeners.clear()
    this.awareness.off('change', this.notify)
  }

  // ---- surface and camera -----------------------------------------------

  getContainer() {
    return this.container!
  }

  setContainer(element: HTMLElement | null) {
    this.container = element
  }

  getCamera() {
    return this.camera
  }

  setCamera(camera: Camera) {
    this.camera = camera
    this.notify()
  }

  isCameraLocked() {
    return this.cameraLocked
  }

  setCameraLocked(locked: boolean) {
    this.cameraLocked = locked
  }

  screenToPage(p: Point): Point {
    return { x: p.x / this.camera.z - this.camera.x, y: p.y / this.camera.z - this.camera.y }
  }

  pageToScreen(p: Point): Point {
    return { x: (p.x + this.camera.x) * this.camera.z, y: (p.y + this.camera.y) * this.camera.z }
  }

  /** The zoom keeps the page point under `screen` where it is. */
  zoomAt(screen: Point, z: number, keep: Point = this.screenToPage(screen)) {
    const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z))
    this.setCamera({ x: screen.x / zoom - keep.x, y: screen.y / zoom - keep.y, z: zoom })
  }

  getViewportCenter(): Point {
    const rect = this.container?.getBoundingClientRect()
    return this.screenToPage({ x: (rect?.width ?? 0) / 2, y: (rect?.height ?? 0) / 2 })
  }

  // ---- pages ------------------------------------------------------------

  getPages() {
    return this.doc.getPages()
  }

  getPage(id: string) {
    return this.doc.getPage(id)
  }

  getCurrentPageId() {
    return this.pageId
  }

  getCurrentPage(): Page {
    return this.doc.getPage(this.pageId)!
  }

  setCurrentPage(id: string) {
    if (id === this.pageId || !this.doc.getPage(id)) return
    this.pageId = id
    this.selection = []
    this.commitText()
    this.notify()
  }

  /** Adds a blank page after the last one and opens it. */
  addPage() {
    const id = newId()
    this.doc.mark()
    this.doc.createPage({ id, name: `Page ${this.doc.getPages().length + 1}` })
    this.setCurrentPage(id)
  }

  // ---- shapes -----------------------------------------------------------

  getShape(id: string) {
    return this.doc.getShape(id)
  }

  getPageShapeIds(pageId: string) {
    return this.doc.getPageShapeIds(pageId)
  }

  getCurrentPageShapes() {
    return this.doc.getPageShapes(this.pageId)
  }

  getShapePageBounds(id: string): Box | undefined {
    const shape = this.doc.getShape(id)
    return shape && pageBounds(shape)
  }

  // ---- tool and style ---------------------------------------------------

  isReadonly() {
    return this.readonly_
  }

  /** Read-only viewers can only look around. */
  setReadonly(readonly: boolean) {
    this.readonly_ = readonly
    this.setCurrentTool(readonly ? 'hand' : 'select')
  }

  getCurrentToolId() {
    return this.tool
  }

  setCurrentTool(tool: BoardTool) {
    if (this.readonly_ && tool !== 'hand') return
    this.commitText()
    this.tool = tool
    if (tool !== 'select') this.selection = []
    this.notify()
  }

  getStyle() {
    return this.style
  }

  /** The style to show: the selection's, where it agrees, else the next shape's. */
  getDisplayStyle(): InkStyle {
    const shared = (key: keyof InkStyle) => {
      const values = new Set(this.getSelectedShapes().map((s) => (s as Partial<InkStyle>)[key]).filter((v) => v !== undefined))
      return values.size === 1 ? [...values][0] : this.style[key]
    }
    return { color: shared('color') as InkColor, size: shared('size') as InkSize, dash: shared('dash') as InkDash }
  }

  setStyle(patch: Partial<InkStyle>) {
    this.style = { ...this.style, ...patch }
    const selected = this.getSelectedShapes()
    if (selected.length > 0) {
      this.doc.mark()
      this.doc.transact(() => {
        for (const shape of selected) {
          const applicable = Object.fromEntries(Object.entries(patch).filter(([key]) => key in shape)) as Partial<Shape>
          if (shape.type === 'text' && patch.size) (applicable as { fontSize?: number }).fontSize = FONT_SIZES[patch.size]
          this.doc.updateShape(shape.id, applicable)
        }
      })
    }
    this.notify()
  }

  // ---- selection --------------------------------------------------------

  getSelectedIds() {
    return this.selection
  }

  getSelectedShapes(): Shape[] {
    return this.selection.map((id) => this.doc.getShape(id)).filter((s): s is Shape => !!s)
  }

  select(ids: string[]) {
    this.selection = ids
    this.notify()
  }

  selectAll() {
    this.setCurrentTool('select')
    this.select(this.getCurrentPageShapes().filter((s) => !s.locked).map((s) => s.id))
  }

  getMarquee() {
    return this.marquee
  }

  setMarquee(box: Box | null) {
    this.marquee = box
    this.notify()
  }

  deleteSelection() {
    if (this.selection.length === 0) return
    this.doc.mark()
    this.doc.deleteShapes(this.selection)
    this.select([])
  }

  /** Clones of the given shapes, nudged and on top, as the new selection. */
  private addCopies(shapes: Shape[], offset: Point) {
    if (shapes.length === 0) return
    const ids: string[] = []
    this.doc.mark()
    this.doc.transact(() => {
      for (const shape of shapes) {
        const id = newId()
        ids.push(id)
        const { z: _z, ...copy } = shape
        this.doc.createShape({ ...copy, id, page: this.pageId, x: shape.x + offset.x, y: shape.y + offset.y })
      }
    })
    this.setCurrentTool('select')
    this.select(ids)
  }

  duplicateSelection() {
    this.addCopies(this.getSelectedShapes(), { x: PASTE_OFFSET, y: PASTE_OFFSET })
  }

  copySelection(data: DataTransfer) {
    const shapes = this.getSelectedShapes()
    if (shapes.length === 0) return false
    const text = JSON.stringify(shapes)
    data.setData(CLIPBOARD_TYPE, text)
    data.setData('text/plain', text)
    return true
  }

  /** Handles a paste; false if the clipboard held nothing for the board. */
  paste(data: DataTransfer): boolean {
    const files = [...data.files]
    if (files.length > 0) {
      void this.insertFiles(files)
      return true
    }
    const shapes = data.getData(CLIPBOARD_TYPE)
    if (shapes) {
      this.addCopies(JSON.parse(shapes) as Shape[], { x: PASTE_OFFSET, y: PASTE_OFFSET })
      return true
    }
    const text = data.getData('text/plain').trim()
    if (!text) return false
    this.addText(text, this.getViewportCenter())
    return true
  }

  // ---- images -----------------------------------------------------------

  /** Puts dropped, pasted or chosen files on the board. */
  async insertFiles(files: File[], at: Point = this.getViewportCenter()) {
    const images = files.filter((f) => f.type.startsWith('image/'))
    const other = files.filter((f) => !f.type.startsWith('image/'))
    if (other.length > 0) this.onOtherFiles?.(other)
    let offset = 0
    for (const file of images) {
      try {
        await this.insertImage(file, { x: at.x + offset, y: at.y + offset })
        offset += PASTE_OFFSET
      } catch (err) {
        this.onError?.(err instanceof Error ? err.message : String(err))
      }
    }
  }

  private async insertImage(file: File, center: Point) {
    const bitmap = await createImageBitmap(file)
    const { width, height } = bitmap
    bitmap.close()
    const src = await this.uploadImage(file)
    const room = (this.container?.clientWidth ?? width) * IMAGE_FIT / this.camera.z
    const scale = Math.min(1, room / width)
    const w = width * scale
    const h = height * scale
    const id = newId()
    this.doc.mark()
    this.doc.createShape({ id, page: this.pageId, type: 'image', src, w, h, x: center.x - w / 2, y: center.y - h / 2 })
    this.setCurrentTool('select')
    this.select([id])
  }

  // ---- text -------------------------------------------------------------

  getEditing() {
    return this.editing
  }

  /** Opens the text box: on an existing text shape, or for new text at a point. */
  editText(target: Shape | Point) {
    if ('type' in target) {
      if (target.type !== 'text') return
      this.editing = { id: target.id, at: { x: target.x, y: target.y }, text: target.text, color: target.color, fontSize: target.fontSize }
    } else {
      this.editing = { id: null, at: target, text: '', color: this.style.color, fontSize: FONT_SIZES[this.style.size] }
    }
    this.notify()
  }

  setEditingText(text: string) {
    if (this.editing) this.editing = { ...this.editing, text }
    this.notify()
  }

  commitText() {
    const editing = this.editing
    if (!editing) return
    this.editing = null
    const text = editing.text.trimEnd()
    const box = measureText(text, editing.fontSize)
    this.doc.mark()
    if (editing.id && !text) this.doc.deleteShapes([editing.id])
    else if (editing.id) this.doc.updateShape(editing.id, { text, ...box })
    else if (text) this.addText(text, editing.at, false)
    this.notify()
  }

  private addText(text: string, at: Point, centered = true) {
    const { color, size } = this.style
    const fontSize = FONT_SIZES[size]
    const box = measureText(text, fontSize)
    this.doc.createShape({
      id: newId(),
      page: this.pageId,
      type: 'text',
      text,
      color,
      size,
      fontSize,
      ...box,
      x: centered ? at.x - box.w / 2 : at.x,
      y: centered ? at.y - box.h / 2 : at.y,
    })
  }

  // ---- presence ---------------------------------------------------------

  getCollaborators(): Collaborator[] {
    const me = this.awareness.clientID
    const out: Collaborator[] = []
    for (const [clientId, state] of this.awareness.getStates()) {
      if (clientId === me || !state.user) continue
      out.push({ clientId, ...state.user, cursor: state.cursor })
    }
    return out
  }

  setCursor(p: Point) {
    const now = performance.now()
    if (now - this.lastCursor < CURSOR_MS) return
    this.lastCursor = now
    this.awareness.setLocalStateField('cursor', { x: Math.round(p.x), y: Math.round(p.y), page: this.pageId })
  }

  isConnected() {
    return this.connected
  }

  setConnected(connected: boolean) {
    this.connected = connected
    this.notify()
  }
}

let measure: CanvasRenderingContext2D | null = null

/** The box text will take up on the board. */
function measureText(text: string, fontSize: number) {
  measure ??= document.createElement('canvas').getContext('2d')!
  measure.font = `${fontSize}px ${getComputedStyle(document.body).fontFamily}`
  const lines = text.split('\n')
  return {
    w: Math.max(fontSize, ...lines.map((line) => measure!.measureText(line).width)),
    h: lines.length * fontSize * LINE_HEIGHT,
  }
}

/** The union of the current selection on the page. */
export function selectionBounds(editor: BoardEditor): Box | null {
  return unionBounds(editor.getSelectedShapes().map(pageBounds))
}
