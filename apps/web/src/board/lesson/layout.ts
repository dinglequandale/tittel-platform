import type { LessonDoc } from '@tittel/shared'

// Pure flow-layout computation, ported from the legacy whiteboard: given a
// parsed lesson and the *measured* pixel size of each rendered block, decide
// where every block sits on its page. Blocks stack top-to-bottom, separated by
// each block's `spacingAfter` (the workspace gap). No DOM.
//
// One change from the legacy port: every id carries an `idPrefix` (one per
// loaded plan — `lesson-<sessionId>` or `plan-<planId>-v<version>`), so several
// plans can share a board without their pages, shapes or question ids colliding.

export interface BlockMeasure {
  w: number
  h: number
}

export interface PlacedBlock {
  id: string
  blockIndex: number
  x: number
  y: number
  w: number
  h: number
}

export interface PlacedPage {
  id: string
  pageIndex: number
  blocks: PlacedBlock[]
}

/** Top padding before the first block on every page. */
const TOP_MARGIN = 80

export function blockId(prefix: string, pageIndex: number, blockIndex: number): string {
  return `${prefix}-${pageIndex}-${blockIndex}`
}
export function pageId(prefix: string, pageIndex: number): string {
  return `${prefix}-${pageIndex}`
}

export function computeLayout(
  doc: LessonDoc,
  prefix: string,
  measure: (pageIndex: number, blockIndex: number) => BlockMeasure | undefined,
): PlacedPage[] {
  return doc.pages.map((page, pi) => {
    let y = TOP_MARGIN
    const blocks: PlacedBlock[] = page.blocks.map((block, bi) => {
      const m = measure(pi, bi) ?? { w: 200, h: 40 }
      const placed: PlacedBlock = { id: blockId(prefix, pi, bi), blockIndex: bi, x: 0, y, w: m.w, h: m.h }
      y += m.h + block.spacingAfter
      return placed
    })
    return { id: pageId(prefix, pi), pageIndex: pi, blocks }
  })
}
