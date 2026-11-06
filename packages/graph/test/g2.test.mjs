// G2 engine tests (GRAPH-SPEC §6 G2): lists, statistics, piecewise,
// inequalities, implicit curves, tables, regressions.
import { analyze, emptyState, contour, isList, togglePin, MAX_PINS } from '../src/index.ts'

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -> ${detail}`}`)
  if (!ok) failures++
}
const near = (a, b, eps = 1e-9) => Math.abs(a - b) <= eps * Math.max(1, Math.abs(b))
const VIEW = { xmin: -10, xmax: 10, ymin: -8, ymax: 8 }

function graphItems(items, settings = {}) {
  const s = emptyState()
  Object.assign(s.settings, settings)
  s.items = items.map((it, i) => (typeof it === 'string' ? { id: 'r' + i, type: 'expression', latex: it, color: '#000' } : { id: 'r' + i, ...it }))
  return analyze(s)
}
const graph = (...latexes) => graphItems(latexes)
const row = (a, i = 0) => a.rows[i]
const table = (cols) => ({
  type: 'table',
  columns: cols.map(([latex, values], j) => ({ id: 'c' + j, latex, values: values.map(String), color: '#123' })),
})
const L = (v) => (isList(v) ? v.list : undefined)
const sameList = (v, xs) => { const l = L(v); return !!l && l.length === xs.length && l.every((x, i) => near(x, xs[i])) }
const pv = (r, n) => r.params.find((p) => p.name === n)?.value

// ---- lists (item 17) ----------------------------------------------------
{
  const v = (latex) => row(graph(latex)).value
  check('[1,2,3] is a list', sameList(v('\\left[1,2,3\\right]'), [1, 2, 3]))
  check('[1...5]^2 broadcasts', sameList(v('\\left[1...5\\right]^{2}'), [1, 4, 9, 16, 25]))
  check('[1,3...11] has the six odd numbers', sameList(v('\\left[1,3...11\\right]'), [1, 3, 5, 7, 9, 11]))
  const a = graph('L=\\left[5,1,4,2\\right]', 'L\\left[1\\right]', 'L\\left[2...3\\right]', 'L\\left[3...\\right]', 'L\\left[L>2\\right]', 'L\\left[\\left[1,3\\right]\\right]')
  check('L[1] is 1-based', row(a, 1).value === 5, JSON.stringify(row(a, 1)))
  check('L[2...3]', sameList(row(a, 2).value, [1, 4]))
  check('L[3...] runs to the end', sameList(row(a, 3).value, [4, 2]))
  check('L[L>2] filters', sameList(row(a, 4).value, [5, 4]))
  check('L[[1,3]] picks', sameList(row(a, 5).value, [5, 4]))
  const st = graph('L=\\left[1,5,5,10\\right]', '\\operatorname{mean}\\left(L\\right)', '\\operatorname{median}\\left(L\\right)', '\\operatorname{total}\\left(L\\right)', '\\operatorname{count}\\left(L\\right)', '\\operatorname{stdev}\\left(L\\right)', '\\operatorname{stdevp}\\left(L\\right)', '\\operatorname{sort}\\left(\\left[3,1,2\\right]\\right)', '\\max\\left(L\\right)')
  const sample = Math.sqrt(((1 - 5.25) ** 2 + 2 * (5 - 5.25) ** 2 + (10 - 5.25) ** 2) / 3)
  check('mean([1,5,5,10]) = 5.25', near(row(st, 1).value, 5.25), JSON.stringify(row(st, 1)))
  check('median = 5', row(st, 2).value === 5)
  check('total = 21', row(st, 3).value === 21)
  check('count = 4', row(st, 4).value === 4)
  check('stdev (sample)', near(row(st, 5).value, sample))
  check('stdevp (population)', near(row(st, 6).value, sample * Math.sqrt(3 / 4)))
  check('sort', sameList(row(st, 7).value, [1, 2, 3]))
  check('max of a list', row(st, 8).value === 10, JSON.stringify(row(st, 8)))
  check('mean(1,5,5,10) takes numbers too', near(v('\\operatorname{mean}\\left(1,5,5,10\\right)'), 5.25))
  check('quartile, Moore & McCabe', row(graph('\\operatorname{quartile}\\left(\\left[1,2,3,4,5,6,7\\right],1\\right)')).value === 2)
  const lc = graph('y=\\left[1,2,3\\right]x')
  check('y = [1,2,3]x draws three curves', row(lc).curves?.length === 3 && row(lc).curves[2].fn(2) === 6)
  const lp = graph('L=\\left[1,2,3\\right]', '\\left(L,L^{2}\\right)')
  check('(L, L^2) is a list of points', row(lp, 1).points?.length === 3 && row(lp, 1).points[2].y === 9, JSON.stringify(row(lp, 1)))
  const fl = graph('f\\left(x\\right)=x^{2}', 'f\\left(\\left[1,2,3\\right]\\right)')
  check('f(list) maps over the list', sameList(row(fl, 1).value, [1, 4, 9]))
  check('sin broadcasts over a list', sameList(v('\\sin\\left(\\left[0,\\frac{\\pi}{2}\\right]\\right)'), [0, 1]))
}

// ---- exponent after a parenthesis --------------------------------------------
{
  const mul = row(graph('a=2', 'y=a\\left(x+1\\right)^{2}'), 1).curves[0]
  check('a(x+1)^2 with a variable = a·(x+1)^2', mul.fn(1) === 8)
  const fn = row(graph('f\\left(x\\right)=x+1', 'y=f\\left(x\\right)^{2}'), 1).curves[0]
  check('f(x)^2 with a function = (f(x))^2', fn.fn(1) === 4)
}

// ---- piecewise (item 19) -------------------------------------------------
{
  const pw = row(graph('y=\\left\\{x<0:-x,x\\right\\}')).curves[0]
  check('piecewise {x<0: -x, x}', pw.fn(-2) === 2 && pw.fn(3) === 3)
  const pw2 = row(graph('y=\\left\\{x<0:\\sin x,x\\ge0:2x\\right\\}')).curves[0]
  check('piecewise with two conditions (FAQ example)', near(pw2.fn(-1), Math.sin(-1)) && pw2.fn(2) === 4)
  const cond = row(graph('y=\\left\\{x>0\\right\\}')).curves[0]
  check('{x>0} alone is 1 where true, undefined elsewhere', cond.fn(1) === 1 && Number.isNaN(cond.fn(-1)))
}

// ---- inequalities (item 35) and implicit curves (item 11) ----------------
{
  const r1 = row(graph('y>x^{2}'))
  check('y > x^2 shades above', r1.region?.test(0, 1) && !r1.region.test(0, -1), JSON.stringify(r1))
  check('strict inequality boundary is dashed', r1.curves?.[0].dashed === true)
  const r2 = row(graph('y\\le2x+1'))
  check('y <= 2x+1: solid boundary, shades below', r2.curves?.[0].dashed === false && r2.region.test(0, 0) && !r2.region.test(0, 5))
  const r3 = row(graph('x^{2}+y^{2}<4'))
  check('x^2+y^2<4 shades the disc', r3.region.test(0, 0) && !r3.region.test(3, 0))
  check('disc boundary is an implicit dashed curve', r3.implicits?.length === 1 && r3.implicits[0].dashed === true)
  const band = row(graph('1<y<x'))
  check('1 < y < x: band between two boundaries', band.region.test(5, 2) && !band.region.test(5, 0.5) && band.curves?.length === 2, JSON.stringify(band))
  const rr = row(graph('x^{2}+y^{2}\\le25\\left\\{x>0\\right\\}'))
  check('restriction clips an inequality region', rr.region.test(1, 1) && !rr.region.test(-1, 1))

  const circ = row(graph('x^{2}+y^{2}=25'))
  check('x^2+y^2=25 is implicit', circ.implicits?.length === 1, JSON.stringify(circ))
  const segs = contour(circ.implicits[0].f, VIEW, 860, 688)
  let worst = 0
  for (let i = 0; i < segs.length; i += 2) worst = Math.max(worst, Math.abs(Math.hypot(segs[i], segs[i + 1]) - 5))
  check('circle contour lies on radius 5', segs.length > 200 && worst < 0.02, `${segs.length / 4} segs, worst ${worst}`)
  const hyp = contour(row(graph('xy=1')).implicits[0].f, VIEW, 860, 688)
  let bad = 0
  for (let i = 0; i < hyp.length; i += 2) if (Math.abs(hyp[i] * hyp[i + 1] - 1) > 0.05) bad++
  check('xy=1 contour has no false segments across the axes', hyp.length > 100 && bad === 0, `${bad} bad of ${hyp.length / 2}`)
}

// ---- tables -----------------------------------------------------------------
{
  const t = graphItems([table([['x_{1}', [1, 2, 3]], ['y_{1}', [2, 4, 6]], ['x_{1}^{2}', []]])])
  check('table plots its y column', row(t).points?.length >= 3, JSON.stringify(row(t)))
  check('computed column x_1^2 fills from x_1', JSON.stringify(row(t).columns?.[2].computed) === '[1,4,9]', JSON.stringify(row(t).columns))
  const t2 = graphItems([table([['x_{1}', [1, 2, 3]], ['y_{1}', [2, 4, 6]]]), '\\operatorname{mean}\\left(y_{1}\\right)'])
  check('table columns are list variables elsewhere', row(t2, 1).value === 4, JSON.stringify(row(t2, 1)))
}

// ---- regressions (items 29-31) ----------------------------------------------
{
  const data = table([['x_{1}', [1, 2, 3]], ['y_{1}', [2, 4, 6]]])
  const lin = graphItems([data, 'y_{1}\\sim mx_{1}+b', 'm'])
  const reg = row(lin, 1).regression
  check('linear regression m = 2, b = 0 (exactly, no round-off dust)', reg && near(pv(reg, 'm'), 2) && pv(reg, 'b') === 0, JSON.stringify(row(lin, 1)))
  check('linear regression reports r = 1', reg?.stats.some((s) => s.name === 'r' && near(s.value, 1)))
  check('fitted parameters are variables elsewhere', near(row(lin, 2).value, 2), JSON.stringify(row(lin, 2)))
  check('the model is plotted as y = mx + b', near(row(lin, 1).curves?.[0].fn(5), 10))

  const qd = table([['x_{1}', [-2, -1, 0, 1, 2, 3]], ['y_{1}', [9, 4, 1, 0, 1, 4]]])
  const q = row(graphItems([qd, 'y_{1}\\sim ax_{1}^{2}+bx_{1}+c']), 1).regression
  check('quadratic (linear in params) is exact: (x-1)^2', q && near(pv(q, 'a'), 1) && near(pv(q, 'b'), -2) && near(pv(q, 'c'), 1) && q.stats[0].name === 'R2', JSON.stringify(q))

  const vx = row(graphItems([qd, 'y_{1}\\sim a\\left(x_{1}-h\\right)^{2}+k']), 1).regression
  check('vertex form (nonlinear) converges to a=1, h=1, k=0', vx && near(pv(vx, 'a'), 1, 1e-5) && near(pv(vx, 'h'), 1, 1e-5) && Math.abs(pv(vx, 'k')) < 1e-5, JSON.stringify(vx))

  const ed = table([['x_{1}', [0, 1, 2, 3, 4]], ['y_{1}', [3, 6.2, 11.8, 24.5, 47]]])
  const logOn = row(graphItems([ed, 'y_{1}\\sim ab^{x_{1}}'], { logModeRegressions: true }), 1).regression
  const logOff = row(graphItems([ed, 'y_{1}\\sim ab^{x_{1}}']), 1).regression
  check('log mode used when enabled (SAT)', logOn?.logMode === true, JSON.stringify(logOn))
  check('log mode and plain least squares differ on noisy data', logOn && logOff && Math.abs(pv(logOn, 'b') - pv(logOff, 'b')) > 1e-4, `${logOn && pv(logOn, 'b')} vs ${logOff && pv(logOff, 'b')}`)
  // TI-style ExpReg: least squares of ln y on x.
  const lx = [0, 1, 2, 3, 4]
  const ly = [3, 6.2, 11.8, 24.5, 47].map(Math.log)
  const mx = lx.reduce((s, v) => s + v, 0) / 5
  const my = ly.reduce((s, v) => s + v, 0) / 5
  const slope = lx.reduce((s, v, i) => s + (v - mx) * (ly[i] - my), 0) / lx.reduce((s, v) => s + (v - mx) ** 2, 0)
  check('log-mode b matches ExpReg', logOn && near(pv(logOn, 'b'), Math.exp(slope), 1e-9))

  const sd = table([['x_{1}', [0, 1, 2, 3, 4, 5, 6, 7, 8]], ['y_{1}', [0, 1, 2, 3, 4, 5, 6, 7, 8].map((x) => 2 * Math.sin(0.5 * x))]])
  const sn = row(graphItems([sd, 'y_{1}\\sim a\\sin\\left(bx_{1}\\right)']), 1).regression
  const r2 = sn?.stats.find((s) => s.name === 'R2')?.value
  check('sinusoidal fit (nonlinear) R^2 > 0.999', r2 > 0.999, JSON.stringify(sn))

  const pd = table([['x_{1}', [1, 2, 3, 4]], ['y_{1}', [2, 8, 18, 32]]])
  const bnd = row(graphItems([pd, 'y_{1}\\sim ax_{1}^{b}\\left\\{1<b<5\\right\\}']), 1).regression
  check('parameter restriction respected, power fit a=2 b=2', bnd && near(pv(bnd, 'a'), 2, 1e-5) && near(pv(bnd, 'b'), 2, 1e-5), JSON.stringify(bnd))

  check('regression without data errors helpfully', /list data/.test(row(graph('y\\sim mx+b')).error ?? ''), JSON.stringify(row(graph('y\\sim mx+b'))))
}

// ---- pins ---------------------------------------------------------------------
{
  const one = togglePin(emptyState(), 2, 4)
  check('pin adds', one.pins?.length === 1 && one.pins[0].x === 2 && one.pins[0].y === 4)
  check('same point again removes it', togglePin(one, 2, 4).pins?.length === 0)
  let many = one
  for (let i = 0; i < MAX_PINS; i++) many = togglePin(many, i + 10, 0)
  check('past the cap, the oldest pin drops', many.pins?.length === MAX_PINS && many.pins[0].x === 10)
}

console.log(failures ? `\n${failures} FAILED` : '\nALL GREEN')
process.exit(failures ? 1 : 0)
