import {
  DrawShapeTool,
  LineShapeUtil,
  Vec,
  createShapeId,
  getIndices,
  sortByIndex,
  type Editor,
  type TLDrawShape,
  type TLHandleDragInfo,
  type TLLineShape,
  type TLShapeId,
  type TLShapePartial,
} from 'tldraw'
import { recognise, type Point, type Recognition } from '@tittel/ink'

// Below this on screen a stroke is a tick or a dot, whatever its shape.
const MIN_STROKE_PX = 20

// The pen, plus recognition: a finished stroke that reads as a shape is swapped
// for a real one. Only this tool ever recognises, so the normal pen can't touch
// mathematical writing.
export class ShapeInkTool extends DrawShapeTool {
  static override id = 'shape-ink'

  // Every shape of the stroke being drawn: the draw tool splits long strokes.
  private strokeIds: TLShapeId[] = []

  private currentInkId() {
    return (this.children!.drawing as unknown as { initialShape?: TLDrawShape }).initialShape?.id
  }

  private noteInk() {
    const id = this.currentInkId()
    if (id && !this.strokeIds.includes(id)) this.strokeIds.push(id)
  }

  override onPointerMove() {
    this.noteInk()
  }

  // Drawing finishes by telling its parent to go idle, on cancel as well as on
  // completion; `finishStroke` tells them apart by the ink's `isComplete`.
  override transition(id: string, info?: unknown) {
    const leavingStroke = id === 'idle' && this.getCurrent()?.id === 'drawing'
    if (id === 'drawing') this.strokeIds = []
    const result = super.transition(id, info)
    if (leavingStroke) this.finishStroke()
    return result
  }

  private finishStroke() {
    this.noteInk()
    const ink = this.strokeIds
      .map((id) => this.editor.getShape<TLDrawShape>(id))
      .filter((shape): shape is TLDrawShape => !!shape && shape.props.isComplete)
    if (ink.length === 0 || ink.length !== this.strokeIds.length) return

    const recognised = recognise(ink.flatMap((shape) => inkPoints(this.editor, shape)), {
      minSize: MIN_STROKE_PX / this.editor.getZoomLevel(),
    })
    if (recognised.kind === 'none') return

    // The mark sits after the ink, so one undo brings the ink back and a second removes it.
    this.editor.markHistoryStoppingPoint('recognise shape')
    this.editor.run(() => {
      this.editor.deleteShapes(ink.map((shape) => shape.id))
      this.editor.createShape(shapeFor(recognised, ink[0]))
    })
  }
}

function inkPoints(editor: Editor, shape: TLDrawShape): Point[] {
  const points = shape.props.segments.flatMap((segment) => segment.points)
  return editor.getShapePageTransform(shape).applyToPoints(points)
}

function shapeFor(recognised: Exclude<Recognition, { kind: 'none' }>, ink: TLDrawShape): TLShapePartial {
  const { color, size, fill, scale } = ink.props
  // `draw` is tldraw's pressure ink. On a clean outline it would be a wobble, and
  // our toolbar calls it solid.
  const dash = ink.props.dash === 'draw' ? 'solid' : ink.props.dash
  const common = { id: createShapeId(), opacity: ink.opacity }
  const lineStyle = { color, size, dash, scale, spline: 'line' as const }
  const geoStyle = { color, size, dash, scale, fill }

  switch (recognised.kind) {
    case 'line':
      return { ...common, type: 'line', x: recognised.a.x, y: recognised.a.y, props: { ...lineStyle, ...linePoints([recognised.a, recognised.b]) } }
    case 'triangle': {
      // tldraw's geo triangle is isosceles by construction, so it couldn't keep the
      // tutor's vertices. A line through all three and back to the start can.
      const [a, b, c] = recognised.vertices
      return { ...common, type: 'line', x: a.x, y: a.y, meta: { closed: true }, props: { ...lineStyle, ...linePoints([a, b, c, a]) } }
    }
    case 'circle': {
      const { center, radius } = recognised
      return { ...common, type: 'geo', ...boxPlacement(center, radius * 2, radius * 2, 0), props: { ...geoStyle, geo: 'ellipse', w: radius * 2, h: radius * 2 } }
    }
    case 'ellipse': {
      const { center, rx, ry, angle } = recognised
      return { ...common, type: 'geo', ...boxPlacement(center, rx * 2, ry * 2, angle), props: { ...geoStyle, geo: 'ellipse', w: rx * 2, h: ry * 2 } }
    }
    case 'rectangle': {
      const { center, width, height, angle } = recognised
      return { ...common, type: 'geo', ...boxPlacement(center, width, height, angle), props: { ...geoStyle, geo: 'rectangle', w: width, h: height } }
    }
  }
}

/** A line shape's points, relative to the first. */
function linePoints(points: Point[]): Pick<TLLineShape['props'], 'points'> {
  const [origin] = points
  const indices = getIndices(points.length)
  const entries = points.map((p, i) => {
    const index = indices[i]
    return [index, { id: index, index, x: p.x - origin.x, y: p.y - origin.y }]
  })
  return { points: Object.fromEntries(entries) }
}

/** tldraw rotates a box about its top-left corner, so that corner has to be worked back from the centre. */
function boxPlacement(center: Point, w: number, h: number, rotation: number) {
  const { x, y } = Vec.Sub(center, Vec.Rot({ x: w / 2, y: h / 2 }, rotation))
  return { x, y, rotation }
}

// Keeps a recognised triangle closed: its first and last points coincide, so
// dragging that corner has to move both.
export class BoardLineShapeUtil extends LineShapeUtil {
  override onHandleDrag(shape: TLLineShape, info: TLHandleDragInfo<TLLineShape>) {
    const next = super.onHandleDrag(shape, info)
    if (!shape.meta.closed) return next

    const ordered = Object.values(next.props.points).sort(sortByIndex)
    const first = ordered[0]
    const last = ordered[ordered.length - 1]
    if (info.handle.id !== first.id && info.handle.id !== last.id) return next

    const moved = info.handle.id === first.id ? first : last
    return {
      ...next,
      props: {
        ...next.props,
        points: {
          ...next.props.points,
          [first.id]: { ...first, x: moved.x, y: moved.y },
          [last.id]: { ...last, x: moved.x, y: moved.y },
        },
      },
    }
  }
}
