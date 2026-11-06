// Our own graph state (GRAPH-SPEC §2.3): plain JSON, fully owned, so applying a
// remote copy is deterministic and never triggers a re-broadcast.

export interface SliderBounds {
  min: number
  max: number
  /** 0 = continuous */
  step: number
}

export interface ExpressionItem {
  id: string
  type: 'expression'
  latex: string
  color: string
  hidden?: boolean
  /** Present once a row has been a slider; keeps its bounds across edits. */
  slider?: SliderBounds
}

export interface TableColumn {
  id: string
  /** Header: a variable (`x_1`) whose cells are data, or an expression
   *  (`x_1^2`) whose cells are computed. */
  latex: string
  /** Cell LaTeX, one per row ('' = blank). Ignored for computed columns. */
  values: string[]
  color: string
  hidden?: boolean
  /** Connect the points with line segments (style menu "lines"). */
  lines?: boolean
}

export interface TableItem {
  id: string
  type: 'table'
  columns: TableColumn[]
}

export type GraphItem = ExpressionItem | TableItem

export interface Viewport { xmin: number; xmax: number; ymin: number; ymax: number }

export interface GraphSettings {
  degrees: boolean
  showGrid: boolean
  showAxes: boolean
  axisNumbers: boolean
  /** Fit exponential/power models on log-transformed data (GRAPH-SPEC §4
   *  item 30). Off by default; SAT mode forces it on [CB]. */
  logModeRegressions?: boolean
}

/** A clicked point, labelled with its coordinates for everyone viewing this state. */
export interface GraphPin { x: number; y: number }

export interface GraphState {
  v: 1
  settings: GraphSettings
  /** null = default viewport (x ∈ [−10, 10], 1:1 aspect, set by the view). */
  viewport: Viewport | null
  items: GraphItem[]
  /** Cleared when the math changes, since a pin may no longer be on its curve. */
  pins?: GraphPin[]
}

/** Curve colours, in the same roles and order as the reference calculator's
 *  (red, blue, green, purple, orange, black) but our own hues, each ≥ 3:1 on
 *  white for 2.5px strokes. */
export const CURVE_COLORS = ['#D6402B', '#2140E8', '#1A8F4E', '#7B3FD1', '#D96A00', '#0F0F0F']

export const DEFAULT_SLIDER: SliderBounds = { min: -10, max: 10, step: 0 }

export function emptyState(): GraphState {
  return {
    v: 1,
    settings: { degrees: false, showGrid: true, showAxes: true, axisNumbers: true },
    viewport: null,
    items: [],
  }
}

export const MAX_PINS = 12

/** Add a pin at (x, y), or remove the one already there. The oldest pin drops off past MAX_PINS. */
export function togglePin(state: GraphState, x: number, y: number): GraphState {
  const pins = state.pins ?? []
  const rest = pins.filter((p) => p.x !== x || p.y !== y)
  return { ...state, pins: rest.length < pins.length ? rest : [...pins, { x, y }].slice(-MAX_PINS) }
}

let counter = 0
export function newId(): string {
  counter = (counter + 1) % 1e6
  return Date.now().toString(36) + counter.toString(36) + Math.random().toString(36).slice(2, 6)
}

/** The next colour in the cycle, given the items already present. */
export function nextColor(items: GraphItem[]): string {
  const used = items.reduce((n, it) => n + (it.type === 'table' ? Math.max(1, it.columns.length - 1) : 1), 0)
  return CURVE_COLORS[used % CURVE_COLORS.length]
}

/** A new table: columns x₁ and y₁ [DOC], `rows` blank rows. */
export function newTable(items: GraphItem[], index = 1, rows = 2): TableItem {
  const color = nextColor(items)
  const blank = () => Array.from({ length: rows }, () => '')
  return {
    id: newId(),
    type: 'table',
    columns: [
      { id: newId(), latex: `x_{${index}}`, values: blank(), color },
      { id: newId(), latex: `y_{${index}}`, values: blank(), color },
    ],
  }
}
