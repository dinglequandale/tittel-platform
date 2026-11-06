// Headless tests for the board document: sync between two docs, per-user undo,
// geometry, and importing a real tldraw 3.15.5 document (tldraw-fixture.json
// holds records dumped from a running tldraw editor).
import { readFileSync } from 'node:fs'
import * as Y from 'yjs'
import {
  BoardDoc, FIRST_PAGE, hitTest, importTldrawSnapshot, localBox, moveVertex, pageBounds,
  resizeShape, rotateAbout, scaleAbout, touchesMarquee,
} from '../src/index.ts'

let failures = 0
function check(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : `  -> ${detail}`}`)
  if (!ok) failures++
}
const near = (a, b, eps = 1e-6) => Math.abs(a - b) <= eps

const ink = (over = {}) => ({
  id: 'ink1', page: 'page-1', type: 'ink', x: 10, y: 20, color: 'red', size: 'm', dash: 'solid',
  points: [0, 0, 0.5, 10, 0, 0.5, 20, 10, 0.5], sx: 1, sy: 1, pen: false, done: true, ...over,
})
const rect = (over = {}) => ({
  id: 'r1', page: 'page-1', type: 'rect', x: 100, y: 100, w: 50, h: 30, color: 'blue', size: 'm', dash: 'solid', fill: false, ...over,
})

/** Two docs joined the way the server joins them: every update reaches the other. */
function pair() {
  const a = new Y.Doc()
  const b = new Y.Doc()
  a.on('update', (u, origin) => origin !== 'peer' && Y.applyUpdate(b, u, 'peer'))
  b.on('update', (u, origin) => origin !== 'peer' && Y.applyUpdate(a, u, 'peer'))
  const docA = new BoardDoc(a)
  const docB = new BoardDoc(b)
  docA.seedFirstPage()
  return [docA, docB]
}

// ---- document and sync --------------------------------------------------
{
  const [a, b] = pair()
  check('seeded page reaches the peer', b.getPages()[0]?.id === FIRST_PAGE.id)
  a.seedFirstPage()
  check('seeding twice adds nothing', a.getPages().length === 1)

  a.createShape(ink())
  check('a shape syncs', b.getShape('ink1')?.color === 'red')
  const before = b.getShape('ink1')
  check('reading twice returns the same object', before === b.getShape('ink1'))
  a.appendPoints('ink1', [30, 10, 0.6])
  check('appended points sync', b.getShape('ink1').points.length === 12)
  check('a changed shape is a new object', before !== b.getShape('ink1'))
  check('the old object is unchanged', before.points.length === 9)

  a.createShape(rect())
  check('new shapes stack on top', b.getPageShapeIds('page-1').join() === 'ink1,r1')
  const ids = b.getPageShapeIds('page-1')
  a.updateShape('r1', { x: 200 })
  check('moving keeps the id list stable', b.getPageShapeIds('page-1') === ids)
  a.updateShape('r1', { z: 0 })
  check('changing z reorders', b.getPageShapeIds('page-1').join() === 'r1,ink1')

  a.updateShape('r1', { x: 1 })
  b.updateShape('r1', { y: 2 })
  const r = a.getShape('r1')
  check('concurrent edits to different fields both land', r.x === 1 && r.y === 2)

  a.createPage({ id: 'p2', name: 'Two' })
  a.createShape(rect({ id: 'r2', page: 'p2' }))
  check('pages sort by order', b.getPages().map((p) => p.id).join() === 'page-1,p2')
  a.renamePage('p2', 'Renamed')
  check('rename syncs', b.getPage('p2').name === 'Renamed')
  b.deletePage('p2')
  check('deleting a page takes its shapes', !a.getShape('r2') && !a.getPage('p2'))
  a.deletePage('page-1')
  check('the last page cannot be deleted', !!a.getPage('page-1') && !!a.getShape('r1'))
}

// ---- undo ---------------------------------------------------------------
{
  const [a, b] = pair()
  a.mark()
  a.createShape(ink())
  a.appendPoints('ink1', [30, 10, 0.6])
  a.updateShape('ink1', { done: true })
  a.mark()
  a.transact(() => {
    a.deleteShapes(['ink1'])
    a.createShape(rect())
  })
  check('after recognition: only the shape', !a.getShape('ink1') && !!a.getShape('r1'))
  a.undo()
  check('one undo restores the ink, whole', a.getShape('ink1')?.points.length === 12 && !a.getShape('r1'))
  check('the peer sees the undo', b.getShape('ink1')?.points.length === 12 && !b.getShape('r1'))
  a.undo()
  check('a second undo removes the ink', !a.getShape('ink1'))
  a.redo()
  a.redo()
  check('redo twice returns to the shape', !a.getShape('ink1') && !!a.getShape('r1'))

  b.mark()
  b.createShape(rect({ id: 'theirs' }))
  check('a peer edit is not on my undo stack', a.canRedo() === false)
  a.mark()
  a.undo()
  check('undo leaves a collaborator\'s shape alone', !!a.getShape('theirs'))

  const [c] = pair()
  check('nothing to undo on a fresh board', c.canUndo() === false)
  c.createShape(rect())
  check('canUndo after an edit', c.canUndo() === true)
}

// ---- geometry -----------------------------------------------------------
{
  const [d] = pair()
  d.createShape(rect())
  const r = d.getShape('r1')
  check('rect outline is hit', hitTest(r, { x: 100, y: 115 }, 4))
  check('hollow rect is not hit inside', !hitTest(r, { x: 125, y: 115 }, 4))
  check('filled rect is hit inside', hitTest({ ...r, fill: true }, { x: 125, y: 115 }, 4))
  const turned = { ...r, rotation: Math.PI / 2 }
  const b = pageBounds(turned)
  check('rotated bounds', near(b.w, 30) && near(b.h, 50) && near(b.x, 70) && near(b.y, 100))
  check('rotated hit', hitTest(turned, { x: 70, y: 125 }, 4) && !hitTest(turned, { x: 125, y: 115 }, 4))

  const stroke = { ...ink(), rotation: 0, z: 1, locked: false, opacity: 1, meta: {} }
  check('ink is hit near its path', hitTest(stroke, { x: 15, y: 21 }, 3))
  check('ink is not hit far away', !hitTest(stroke, { x: 15, y: 60 }, 3))
  check('resized ink hit follows the factors', hitTest({ ...stroke, sx: 3, sy: 1 }, { x: 55, y: 21 }, 3))

  const ellipse = { ...r, type: 'ellipse', w: 100, h: 60 }
  check('ellipse edge hit', hitTest(ellipse, { x: 100, y: 130 }, 3) && !hitTest(ellipse, { x: 150, y: 130 }, 3))

  const line = { ...stroke, type: 'line', vertices: [0, 0, 100, 0, 50, 80], closed: true }
  check('closed line is hit on its closing edge', hitTest(line, { x: 35, y: 60 }, 4))
  check('open line is not', !hitTest({ ...line, closed: false }, { x: 35, y: 60 }, 4))
  check('marquee catches a shape by its ink', touchesMarquee(line, { x: 0, y: 0, w: 20, h: 30 }))
  check('marquee misses', !touchesMarquee(line, { x: 500, y: 0, w: 20, h: 30 }))

  const patch = resizeShape(r, localBox(r), { x: 0, y: 0, w: 100, h: 60 })
  check('resize doubles a box from its corner', patch.w === 100 && patch.h === 60 && patch.x === 100 && patch.y === 100)
  const fromLeft = resizeShape(r, localBox(r), { x: -50, y: 0, w: 100, h: 30 })
  check('resizing from the left moves the origin', fromLeft.x === 50 && fromLeft.w === 100)
  const inkPatch = resizeShape(stroke, localBox(stroke), { x: 0, y: 0, w: 40, h: 20 })
  check('resizing ink stores factors, not points', inkPatch.sx === 2 && inkPatch.sy === 2 && !('points' in inkPatch))
  const rotatedResize = resizeShape(turned, localBox(turned), { x: -50, y: 0, w: 100, h: 30 })
  check('resizing a rotated shape moves along its own axes', near(rotatedResize.x, 100) && near(rotatedResize.y, 50))
  const scaled = scaleAbout(r, 2, { x: 0, y: 0 })
  check('group scale', scaled.x === 200 && scaled.w === 100)
  const spun = rotateAbout(r, Math.PI, { x: 0, y: 0 })
  check('rotate about a point', near(spun.x, -100) && near(spun.y, -100) && near(spun.rotation, Math.PI))
  const moved = moveVertex({ ...line, x: 10, y: 10 }, 1, { x: 60, y: 70 })
  check('vertex drag', moved.vertices[2] === 50 && moved.vertices[3] === 60)
}

// ---- importing a real tldraw board --------------------------------------
{
  const snapshot = JSON.parse(readFileSync(new URL('./tldraw-fixture.json', import.meta.url), 'utf8'))
  const doc = new BoardDoc()
  const result = importTldrawSnapshot(doc, snapshot)
  const by = (id) => doc.getShape(id)

  check('every page arrives, prefixes stripped', doc.getPages().map((p) => p.id).join() === 'vw2Q6U1T90SoiAnMuu3VI,second')
  check('page meta survives', doc.getPage('second').meta.lesson.version === 2)
  check('nothing was skipped', result.skipped === 0, JSON.stringify(result))

  const stroke = by('ink')
  check('ink: both segments, with pressure', stroke.type === 'ink' && stroke.points.length === 15 && stroke.points[8] === 0.7)
  check('ink: style', stroke.color === 'red' && stroke.size === 'l' && stroke.dash === 'solid' && stroke.pen === true)
  check('highlight', by('hl').type === 'highlight' && by('hl').color === 'yellow')

  const r = by('rect')
  check('rect keeps position, rotation, dash, fill', r.type === 'rect' && r.x === 200 && r.rotation === 0.5 && r.dash === 'dashed' && r.fill)
  check('ellipse', by('oval').type === 'ellipse' && by('oval').dash === 'dotted' && by('oval').w === 100)
  check('triangle becomes a closed line', by('tri').type === 'line' && by('tri').closed && by('tri').vertices.length === 6)
  check('diamond becomes a closed line', by('dia').type === 'line' && by('dia').closed && by('dia').vertices.length === 8)
  check('a geo label becomes text', by('dia-label')?.text === 'label')
  check('open line keeps its three points in order', by('line').vertices.join() === '0,0,100,20,150,90')
  check('arrow', by('arrow').type === 'arrow' && by('arrow').vertices.join() === '0,0,120,40')
  check('text: paragraphs become lines', by('text').text === 'x = 2\ny = 3')
  check('note: a filled square plus its text', by('note').fill && by('note-label')?.text === 'note')

  const image = by('img')
  check('image resolves its asset', image.src === '/uploads/ink-fixture-1/a.png' && image.w === 200)
  check('image stays locked with its question', image.locked && image.meta.q.id === 'q1')

  const g2 = by('g2')
  const expectX = 600 + 100 * Math.cos(0.3)
  const expectY = 500 + 100 * Math.sin(0.3)
  check('a grouped shape lands where the group put it', near(g2.x, expectX) && near(g2.y, expectY) && near(g2.rotation, 0.3))
  check('the group itself is gone', !by('grp'))

  const page = doc.getPages()[0].id
  const order = doc.getPageShapeIds(page)
  check('stacking follows tldraw order', order.indexOf('ink') < order.indexOf('hl') && order.indexOf('hl') < order.indexOf('img'), order.join())

  const scratch = new BoardDoc()
  check('an empty snapshot imports nothing', importTldrawSnapshot(scratch, null).shapes === 0)

  const bad = { documents: [{ state: { typeName: 'page', id: 'page:a', name: 'A', index: 'a1' } },
    { state: { typeName: 'shape', type: 'embed', id: 'shape:e', parentId: 'page:a', index: 'a1', x: 0, y: 0, rotation: 0, props: {} } },
    { state: { typeName: 'shape', type: 'draw', id: 'shape:broken', parentId: 'page:a', index: 'a2', x: 0, y: 0, rotation: 0, props: {} } }] }
  const partial = importTldrawSnapshot(new BoardDoc(), bad)
  check('unknown or broken shapes are skipped, not fatal', partial.skipped === 2 && partial.shapes === 0, JSON.stringify(partial))

  const saved = Y.encodeStateAsUpdate(doc.ydoc)
  const reloadedDoc = new Y.Doc()
  Y.applyUpdate(reloadedDoc, saved)
  check('an imported board survives save and load', new BoardDoc(reloadedDoc).getShape('ink').points.length === 15)
}

console.log(failures ? `\n${failures} failed` : '\nall passed')
process.exit(failures ? 1 : 0)
