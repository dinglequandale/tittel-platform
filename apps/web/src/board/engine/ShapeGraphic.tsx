import { getStroke, getStrokePoints } from 'perfect-freehand'
import {
  INK_COLORS,
  LINE_HEIGHT,
  STROKE_WIDTHS,
  inkPoints,
  polyPoints,
  type InkDash,
  type InkShape,
  type Point,
  type PolyShape,
  type Shape,
} from '@tittel/board'

// How a shape looks, as pure SVG from its data. The canvas and the PDF export
// both draw through this, so what's exported is what's on the board.

const easeOutSine = (t: number) => Math.sin((t * Math.PI) / 2)

function strokeOptions(shape: InkShape) {
  const width = STROKE_WIDTHS[shape.size]
  if (shape.type === 'highlight') {
    return { size: width * 5 + 4, thinning: 0, smoothing: 0.5, streamline: 0.5, simulatePressure: false, last: shape.done }
  }
  return shape.pen
    ? { size: 1 + width * 1.2, thinning: 0.62, smoothing: 0.62, streamline: 0.62, simulatePressure: false, easing: easeOutSine, last: shape.done }
    : { size: 1 + width * 1.5, thinning: 0.5, smoothing: 0.62, streamline: 0.62, simulatePressure: true, last: shape.done }
}

function inputPoints(shape: InkShape) {
  return inkPoints(shape).map((p, i) => [p.x, p.y, shape.points[i * 3 + 2]])
}

/** The filled outline of a stroke, as smooth quadratic curves through midpoints. */
function outlinePath(outline: number[][]) {
  if (outline.length === 0) return ''
  const mid = (a: number[], b: number[]) => `${(a[0] + b[0]) / 2} ${(a[1] + b[1]) / 2}`
  let d = `M ${mid(outline[0], outline[1] ?? outline[0])} Q`
  for (let i = 1; i < outline.length; i++) {
    const next = outline[(i + 1) % outline.length]
    d += ` ${outline[i][0]} ${outline[i][1]} ${mid(outline[i], next)}`
  }
  return `${d} Z`
}

function dashArray(dash: InkDash, width: number) {
  if (dash === 'dashed') return `${width * 2.5} ${width * 2.5}`
  if (dash === 'dotted') return `0.01 ${width * 2.2}`
  return undefined
}

function strokeProps(shape: { color: Shape extends never ? never : keyof typeof INK_COLORS; size: keyof typeof STROKE_WIDTHS; dash: InkDash }) {
  const width = STROKE_WIDTHS[shape.size]
  return {
    stroke: INK_COLORS[shape.color].solid,
    strokeWidth: width,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    strokeDasharray: dashArray(shape.dash, width),
    fill: 'none',
  }
}

function Ink({ shape }: { shape: InkShape }) {
  const points = inputPoints(shape)
  const options = strokeOptions(shape)
  if (shape.type === 'highlight') {
    return (
      <path
        d={outlinePath(getStroke(points, options))}
        fill={INK_COLORS[shape.color].highlight}
        style={{ mixBlendMode: 'multiply' }}
        opacity={0.8}
      />
    )
  }
  if (shape.dash !== 'solid') {
    const line = getStrokePoints(points, options).map((p) => p.point.join(' '))
    return <path d={`M ${line.join(' L ')}`} {...strokeProps(shape)} />
  }
  return <path d={outlinePath(getStroke(points, options))} fill={INK_COLORS[shape.color].solid} />
}

function arrowHead(points: Point[], width: number) {
  const tip = points[points.length - 1]
  const from = points[points.length - 2]
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x)
  const length = 10 + width * 2.5
  const barb = (turn: number) => `${tip.x - length * Math.cos(angle + turn)} ${tip.y - length * Math.sin(angle + turn)}`
  return `M ${barb(0.45)} L ${tip.x} ${tip.y} L ${barb(-0.45)}`
}

function Poly({ shape }: { shape: PolyShape }) {
  const points = polyPoints(shape)
  const d = `M ${points.map((p) => `${p.x} ${p.y}`).join(' L ')}${shape.closed ? ' Z' : ''}`
  const props = strokeProps(shape)
  if (shape.type === 'arrow') {
    return (
      <>
        <path d={d} {...props} />
        <path d={arrowHead(points, props.strokeWidth)} {...props} strokeDasharray={undefined} />
      </>
    )
  }
  return <path d={d} {...props} />
}

export function ShapeGraphic({ shape }: { shape: Shape }) {
  const transform = `translate(${shape.x} ${shape.y}) rotate(${(shape.rotation * 180) / Math.PI})`
  return (
    <g transform={transform} opacity={shape.opacity}>
      <ShapeBody shape={shape} />
    </g>
  )
}

function ShapeBody({ shape }: { shape: Shape }) {
  switch (shape.type) {
    case 'ink':
    case 'highlight':
      return <Ink shape={shape} />
    case 'line':
    case 'arrow':
      return <Poly shape={shape} />
    case 'rect':
    case 'ellipse': {
      const props = strokeProps(shape)
      const fill = shape.fill ? { fill: props.stroke, fillOpacity: 0.15 } : {}
      return shape.type === 'rect' ? (
        <rect width={shape.w} height={shape.h} rx={Math.min(6, shape.w / 4, shape.h / 4)} {...props} {...fill} />
      ) : (
        <ellipse cx={shape.w / 2} cy={shape.h / 2} rx={shape.w / 2} ry={shape.h / 2} {...props} {...fill} />
      )
    }
    case 'text':
      return (
        <text fontSize={shape.fontSize} fill={INK_COLORS[shape.color].solid} style={{ fontFamily: 'var(--font-body)', whiteSpace: 'pre' }}>
          {shape.text.split('\n').map((line, i) => (
            <tspan key={i} x={0} y={(i + 0.85) * shape.fontSize * LINE_HEIGHT - shape.fontSize * 0.1}>
              {line || ' '}
            </tspan>
          ))}
        </text>
      )
    case 'image':
      return <image href={shape.src} width={shape.w} height={shape.h} preserveAspectRatio="none" />
  }
}
