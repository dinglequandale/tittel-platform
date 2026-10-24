// Headless tests for the graph engine: GRAPH-SPEC §4 catalogue items and §7
// golden cases that apply to G1. Inputs are written as MathQuill emits them.
import {
  analyze, emptyState, parseStatement, sampleCurve, pointsOfInterest,
  formatNumber, toFraction, exactOrDecimal, defaultViewport, gridStep, gridLabel,
} from '../src/index.ts'

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -> ${detail}`}`)
  if (!ok) failures++
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b))

function graph(...latexes) {
  const s = emptyState()
  s.items = latexes.map((latex, i) => ({ id: 'r' + i, type: 'expression', latex, color: '#000' }))
  return analyze(s)
}
const row = (a, i = 0) => a.rows[i]
const VIEW = { xmin: -10, xmax: 10, ymin: -8, ymax: 8 }

// ---- parsing / typing behaviour (items 2-9) ---------------------------
{
  const v = (latex) => row(graph(latex)).value
  check('2+3 = 5', v('2+3') === 5)
  check('implicit multiplication 2\\pi', near(v('2\\pi'), 2 * Math.PI))
  check('juxtaposition \\sin x graphs sin(x)', near(row(graph('y=\\sin x')).curves[0].fn(1), Math.sin(1)))
  check('\\sin 2x = sin(2x)', near(row(graph('y=\\sin 2x')).curves[0].fn(1), Math.sin(2)))
  check('\\sin x\\cos x = sin(x)cos(x)', near(row(graph('y=\\sin x\\cos x')).curves[0].fn(1), Math.sin(1) * Math.cos(1)))
  check('\\sin^{-1} is arcsin', near(v('\\sin^{-1}\\left(1\\right)'), Math.PI / 2))
  check('\\sin^2 x is (sin x)^2', near(row(graph('y=\\sin^{2}x')).curves[0].fn(1), Math.sin(1) ** 2))
  check('\\log is base 10', near(v('\\log100'), 2))
  check('\\log_{2}8 = 3', near(v('\\log_{2}8'), 3))
  check('\\ln e = 1', near(v('\\ln e'), 1))
  check('\\frac{1}{3}', near(v('\\frac{1}{3}'), 1 / 3))
  check('\\sqrt[3]{-8} = -2 (real cube root)', near(v('\\sqrt[3]{-8}'), -2))
  check('\\left|-5\\right| = 5', v('\\left|-5\\right|') === 5)
  check('-x^2 is -(x^2)', row(graph('y=-x^{2}')).curves[0].fn(3) === -9)
  check('x_1 is a distinct variable', row(graph('x_{1}=4', 'x_{1}+1'), 1).value === 5)
  check('4! = 24', v('4!') === 24)
  check('0^0 = 1', v('0^{0}') === 1)
  check('(-8)^(1/3) = -2', near(v('\\left(-8\\right)^{\\frac{1}{3}}'), -2))
  check('parse error reported', !!row(graph('2+')).error)
}

// ---- item classification (items 10-15) --------------------------------
{
  const a = graph('y=x^{2}', 'x=3', '2x+1=y', 'x^{2}', '\\left(1,2\\right)', '\\left(1,2\\right),\\left(3,4\\right)')
  check('y=x^2 is an explicit curve', row(a, 0).curves?.[0].orientation === 'y')
  check('x=3 is a vertical curve', row(a, 1).curves?.[0].orientation === 'x' && row(a, 1).curves[0].fn(0) === 3)
  check('2x+1=y explicit (y on the right)', row(a, 2).curves?.[0].fn(2) === 5)
  check('bare x^2 graphs as y=x^2', row(a, 3).curves?.[0].fn(3) === 9)
  check('(1,2) is a point', row(a, 4).points?.[0].x === 1 && row(a, 4).points[0].y === 2)
  check('(1,2),(3,4) is two points', row(a, 5).points?.length === 2)

  const f = graph('f\\left(x\\right)=x^{2}+3x', 'f\\left(3\\right)', 'y=f\\left(x\\right)+2')
  check('f(x)=x^2+3x graphs (param x)', row(f, 0).curves?.[0].fn(1) === 4)
  check('f(3) = 18', row(f, 1).value === 18)
  check('f(x)+2 uses the function', row(f, 2).curves?.[0].fn(1) === 6)

  const notFn = graph('a=2', 'a\\left(x+1\\right)')
  check('a(x+1) is multiplication when a is not a function', row(notFn, 1).curves?.[0].fn(1) === 4)

  check('a = b+1 shows its value', row(graph('b=2', 'a=b+1'), 1).value === 3)
  check('duplicate definition errors', /more than once/.test(row(graph('a=1', 'a=2')).error ?? ''))
  check('circular definition errors', !!row(graph('a=b', 'b=a')).error)
}

// ---- sliders (item 26) and draggable points (item 27) -----------------
{
  const a = graph('y=mx+b')
  check('free variables -> add slider prompt', JSON.stringify(row(a).missing) === '["m","b"]', JSON.stringify(row(a)))
  const b = graph('y=mx+b', 'm=1', 'b=1')
  check('m=1 is a slider', row(b, 1).slider?.name === 'm' && row(b, 1).slider.value === 1)
  check('with sliders the line plots', row(b, 0).curves?.[0].fn(2) === 3)
  check('reserved names never prompt sliders', !row(graph('y=e^{x}')).missing)
  const p = graph('a=1', 'f\\left(x\\right)=x^{2}', '\\left(a,f\\left(a\\right)\\right)')
  check('(a, f(a)) drags along x via slider a', row(p, 2).points?.[0].dragX === 'a' && !row(p, 2).points[0].dragY)
  check('(a, f(a)) sits on the curve', row(p, 2).points?.[0].y === 1)
}

// ---- restrictions -------------------------------------------------------
{
  const c = row(graph('y=x\\left\\{-2<x<2\\right\\}')).curves[0]
  check('restriction keeps inside', c.restrict(1, 1) === true)
  check('restriction drops outside', c.restrict(3, 3) === false)
  const lines = sampleCurve(c, VIEW, 800, 640)
  const xs = lines.flatMap((l) => l.filter((_, i) => i % 2 === 0))
  check('restricted segment spans about -2..2', near(Math.min(...xs), -2, 1e-2) && near(Math.max(...xs), 2, 1e-2), `${Math.min(...xs)}..${Math.max(...xs)}`)
}

// ---- plotting -------------------------------------------------------------
{
  const sq = row(graph('y=\\sqrt{x}')).curves[0]
  const l = sampleCurve(sq, VIEW, 800, 640)
  check('sqrt plots one polyline from its domain edge', l.length === 1 && Math.abs(l[0][0]) < 1e-3, `${l.length} lines, starts ${l[0]?.[0]}`)
  const tan = row(graph('y=\\tan x')).curves[0]
  const tl = sampleCurve(tan, VIEW, 800, 640)
  check('tan breaks at its asymptotes (7 branches in [-10,10])', tl.length === 7, `${tl.length}`)
  const rec = row(graph('y=\\frac{1}{x}')).curves[0]
  check('1/x splits into two branches', sampleCurve(rec, VIEW, 800, 640).length === 2)
}

// ---- points of interest (item 34, golden cases) -----------------------
{
  const a = graph('y=x^{2}-3x+1', 'y=\\sin x')
  const poi = pointsOfInterest(row(a, 0).curves[0], [row(a, 1).curves[0]], VIEW, 860)
  const has = (kind, x, y) => poi.some((p) => p.kind === kind && near(p.x, x, 1e-6) && near(p.y, y, 1e-6))
  check('vertex (1.5, -1.25)', has('min', 1.5, -1.25), JSON.stringify(poi))
  check('zeros at (3±√5)/2', has('zero', (3 - Math.sqrt(5)) / 2, 0) && has('zero', (3 + Math.sqrt(5)) / 2, 0))
  check('y-intercept (0, 1)', has('intercept', 0, 1))
  check('intersections with sin x found', poi.filter((p) => p.kind === 'intersection').length >= 1)

  const s = pointsOfInterest(row(a, 1).curves[0], [], VIEW, 860)
  const max = s.find((p) => p.kind === 'max' && p.x < -4 && p.x > -5)
  check('sin max near -3π/2 located', !!max)
  check('label reads -3π/2 exactly', max && exactOrDecimal(max.x) === '-\\frac{3\\pi}{2}', max && exactOrDecimal(max.x))
  check('label y reads 1', max && exactOrDecimal(max.y) === '1')
  const sq = pointsOfInterest(row(graph('y=x^{2}')).curves[0], [], VIEW, 860)
  check('x^2: zero and minimum at origin merge into one point', sq.length === 1, JSON.stringify(sq))
}

// ---- number formatting ------------------------------------------------
{
  check('1/3 -> 0.333333333333', formatNumber(1 / 3) === '0.333333333333', formatNumber(1 / 3))
  check('integers stay integers', formatNumber(18) === '18')
  check('large numbers use scientific notation', formatNumber(1.5e15) === '1.5\\times10^{15}', formatNumber(1.5e15))
  check('small numbers use scientific notation', formatNumber(2.5e-8) === '2.5\\times10^{-8}', formatNumber(2.5e-8))
  check('NaN is undefined', /undefined/.test(formatNumber(NaN)))
  const fr = toFraction(1.625)
  check('1.625 -> 13/8 fraction toggle', fr?.n === 13 && fr?.d === 8)
  check('pi has no simple fraction', toFraction(Math.PI) === undefined)
  check('exact pi/2', exactOrDecimal(Math.PI / 2) === '\\frac{\\pi}{2}')
  check('decimals rounded to 3', exactOrDecimal(0.381966011) === '0.382')
}

// ---- degrees -----------------------------------------------------------
{
  const s = emptyState()
  s.settings.degrees = true
  s.items = [{ id: 'd', type: 'expression', latex: '\\sin90', color: '#000' }]
  check('degree mode: sin 90 = 1', near(analyze(s).rows[0].value, 1))
}

// ---- view geometry ------------------------------------------------------
{
  const v = defaultViewport(860, 688)
  check('default view x in [-10,10], 1:1 aspect', v.xmin === -10 && v.xmax === 10 && near(v.ymax, 8))
  const g = gridStep(20 / 860)
  check('±10 over 860px -> major 2, minor 0.5 [OBS]', g.major === 2 && g.minor === 0.5, JSON.stringify(g))
  check('grid labels have no float noise', gridLabel(0.1 + 0.2, 0.1) === '0.3')
  check('negative labels use a true minus', gridLabel(-4, 2) === '−4')
}

// ---- parser smoke on a statement shape ---------------------------------
{
  const st = parseStatement('y=x\\left\\{x>0\\right\\}\\left\\{x<3\\right\\}')
  check('two restriction groups parsed', st.restrictions.length === 2)
}

console.log(failures ? `\n${failures} FAILED` : '\nALL GREEN')
process.exit(failures ? 1 : 0)
