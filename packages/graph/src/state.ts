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

export type GraphItem = ExpressionItem

export interface Viewport { xmin: number; xmax: number; ymin: number; ymax: number }

export interface GraphSettings {
  degrees: boolean
  showGrid: boolean
  showAxes: boolean
  axisNumbers: boolean
}

export interface GraphState {
  v: 1
  settings: GraphSettings
  /** null = default viewport (x ∈ [−10, 10], 1:1 aspect, set by the view). */
  viewport: Viewport | null
  items: GraphItem[]
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

let counter = 0
export function newId(): string {
  counter = (counter + 1) % 1e6
  return Date.now().toString(36) + counter.toString(36) + Math.random().toString(36).slice(2, 6)
}

/** The next colour in the cycle, given the items already present. */
export function nextColor(items: GraphItem[]): string {
  return CURVE_COLORS[items.length % CURVE_COLORS.length]
}
