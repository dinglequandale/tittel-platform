// The whiteboard's shapes. Plain data: what's stored in the Yjs doc is exactly
// this, so the same types serve the editor, the server and the importer.

export type InkColor =
  | 'black' | 'grey' | 'red' | 'light-red' | 'orange' | 'yellow'
  | 'green' | 'light-green' | 'blue' | 'light-blue' | 'violet' | 'light-violet' | 'white'
export type InkSize = 's' | 'm' | 'l' | 'xl'
export type InkDash = 'solid' | 'dashed' | 'dotted'

export interface InkStyle {
  color: InkColor
  size: InkSize
  dash: InkDash
}

export const INK_COLORS: Record<InkColor, { solid: string; highlight: string }> = {
  black: { solid: '#1d1d1d', highlight: '#fddd00' },
  grey: { solid: '#9fa8b2', highlight: '#cbe7f1' },
  red: { solid: '#e03131', highlight: '#ff636e' },
  'light-red': { solid: '#f87777', highlight: '#ff7fa3' },
  orange: { solid: '#e16919', highlight: '#ffa500' },
  yellow: { solid: '#f1ac4b', highlight: '#fddd00' },
  green: { solid: '#099268', highlight: '#00ffc8' },
  'light-green': { solid: '#4cb05e', highlight: '#65f641' },
  blue: { solid: '#4465e9', highlight: '#10acff' },
  'light-blue': { solid: '#4ba1f1', highlight: '#00f4ff' },
  violet: { solid: '#ae3ec9', highlight: '#c77cff' },
  'light-violet': { solid: '#e085f4', highlight: '#ff88ff' },
  white: { solid: '#ffffff', highlight: '#ffffff' },
}

export const STROKE_WIDTHS: Record<InkSize, number> = { s: 2, m: 3.5, l: 5, xl: 10 }
export const FONT_SIZES: Record<InkSize, number> = { s: 18, m: 24, l: 36, xl: 44 }
export const LINE_HEIGHT = 1.3

export interface ShapeBase {
  id: string
  page: string
  /** Position of the shape's origin. It rotates about this point. */
  x: number
  y: number
  rotation: number
  /** Stacking order within the page. */
  z: number
  /** Lesson content: not selectable, movable or erasable. */
  locked: boolean
  opacity: number
  /** Synced to everyone, so never put an answer key here (lesson/keys.ts). */
  meta: Record<string, unknown>
}

export interface InkShape extends ShapeBase, InkStyle {
  type: 'ink' | 'highlight'
  /** Flat x, y, pressure triples relative to the origin. */
  points: number[]
  /** Resize factors, kept apart so resizing doesn't rewrite the points. */
  sx: number
  sy: number
  /** Real pen pressure rather than simulated. */
  pen: boolean
  done: boolean
}

export interface PolyShape extends ShapeBase, InkStyle {
  type: 'line' | 'arrow'
  /** Flat x, y pairs relative to the origin. */
  vertices: number[]
  closed: boolean
}

export interface BoxShape extends ShapeBase, InkStyle {
  type: 'rect' | 'ellipse'
  w: number
  h: number
  fill: boolean
}

export interface TextShape extends ShapeBase {
  type: 'text'
  text: string
  color: InkColor
  size: InkSize
  fontSize: number
  /** Measured when the text was committed. */
  w: number
  h: number
}

export interface ImageShape extends ShapeBase {
  type: 'image'
  src: string
  w: number
  h: number
}

export type Shape = InkShape | PolyShape | BoxShape | TextShape | ImageShape
export type ShapeOf<T extends Shape['type']> = Extract<Shape, { type: T }>

/** A shape before it joins a page: the document fills in the rest. */
export type NewShape = Shape extends infer S
  ? S extends Shape
    ? Omit<S, 'page' | 'z' | 'rotation' | 'locked' | 'opacity' | 'meta'> & Partial<Pick<S, 'page' | 'z' | 'rotation' | 'locked' | 'opacity' | 'meta'>>
    : never
  : never

export interface Page {
  id: string
  name: string
  order: number
  meta: Record<string, unknown>
}

/** The page every board starts with. The server seeds it, so two clients can't each make one. */
export const FIRST_PAGE: Page = { id: 'page-1', name: 'Page 1', order: 1, meta: {} }
