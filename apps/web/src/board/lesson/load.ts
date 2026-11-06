import { parseLessonDoc, type QuestionKey } from '@tittel/shared'
import type { BoardEditor } from '../engine/editor.ts'
import { uploadBoardImage } from '../assetStore.ts'
import { renderBlock } from './render.ts'
import { computeLayout, blockId, pageId } from './layout.ts'
import { questionMetaFor, questionKeysFromDoc } from './keys.ts'

// Host-side injection of a lesson plan into the live, synced board document
// (OVERHAUL.md O2, plan-load contract). Every student sees the pages appear
// through sync; no separate broadcast. Unlike the legacy loader this APPENDS:
// a board keeps its earlier pages, and each plan's ids carry its `idPrefix`,
// so loading the same plan twice just reopens it.
//
// Answer keys never touch the document. Each lesson page's `meta.lesson` records
// where the plan came from, so a host who reloads can re-fetch it and rebuild
// the keys (see useLessonKeys.ts); answerable shapes carry only `meta.q`.

/** Where a loaded plan came from. Stored in page meta, so it must stay JSON. */
export type LessonRef =
  | { kind: 'session'; id: string; version: number }
  | { kind: 'plan'; id: string; version: number }

export function lessonPrefix(ref: LessonRef): string {
  return ref.kind === 'session' ? `lesson-${ref.id}` : `plan-${ref.id}-v${ref.version}`
}

/** The lesson ref on a page, if it's a loaded lesson page. */
export function lessonRefOf(meta: Record<string, unknown> | undefined): LessonRef | null {
  const l = meta?.lesson as Record<string, unknown> | undefined
  if (!l || typeof l !== 'object' || typeof l.id !== 'string' || typeof l.version !== 'number') return null
  if (l.kind !== 'session' && l.kind !== 'plan') return null
  return { kind: l.kind, id: l.id, version: l.version }
}

const dayFmt = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })

export interface LoadResult {
  /** False when the plan's pages were already on the board and were just reopened. */
  added: boolean
  /** The pages on the board came from an older version of the plan; `keys` is empty. */
  stale: boolean
  pages: number
  keys: QuestionKey[]
}

export interface LoadOptions {
  boardId: string
  authParams: string
  ref: LessonRef
  /** The plan's title, for page names. Falls back to the doc's own title. */
  title?: string
  /** The lesson's date, for page names. Defaults to today. */
  date?: Date
  onProgress?: (done: number, total: number) => void
}

export async function loadPlanOntoBoard(editor: BoardEditor, raw: unknown, opts: LoadOptions): Promise<LoadResult> {
  if ((raw as { source?: unknown } | null)?.source === 'pdf') {
    throw new Error('PDF plans can’t be loaded onto the board yet')
  }
  const doc = parseLessonDoc(raw)
  const prefix = lessonPrefix(opts.ref)
  const keys = questionKeysFromDoc(doc, prefix)
  if (doc.pages.length === 0) throw new Error('This plan has no pages yet')

  const firstPage = pageId(prefix, 0)
  const existing = editor.getPage(firstPage)
  if (existing) {
    editor.setCurrentPage(firstPage)
    // A plan edited after it went on the board no longer matches its pages'
    // question ids, so its keys would grade the wrong problems.
    const stale = lessonRefOf(existing.meta)?.version !== opts.ref.version
    return { added: false, stale, pages: doc.pages.length, keys: stale ? [] : keys }
  }

  // 1. Render + upload every block.
  const total = doc.pages.reduce((n, p) => n + p.blocks.length, 0)
  type Built = { url: string; w: number; h: number }
  const built = new Map<string, Built>()
  let done = 0
  for (let pi = 0; pi < doc.pages.length; pi++) {
    for (let bi = 0; bi < doc.pages[pi].blocks.length; bi++) {
      const rendered = await renderBlock(doc.pages[pi].blocks[bi])
      const url = rendered.blob ? await uploadBoardImage(opts.boardId, opts.authParams, rendered.blob, 'lesson.png') : rendered.src!
      built.set(`${pi}:${bi}`, { url, w: rendered.w, h: rendered.h })
      opts.onProgress?.(++done, total)
    }
  }

  // 2. Flow positions from the measured sizes.
  const placed = computeLayout(doc, prefix, (pi, bi) => built.get(`${pi}:${bi}`))

  // 3. Inject as one undo step, appended after the board's existing pages.
  const title = (opts.title ?? doc.title).trim() || 'Lesson'
  const baseName = `${dayFmt.format(opts.date ?? new Date())} · ${title}`
  const pageMeta = { lesson: { ...opts.ref } }
  const board = editor.doc
  board.mark()
  board.transact(() => {
    for (const page of placed) {
      const name = placed.length > 1 ? `${baseName} · ${page.pageIndex + 1}` : baseName
      board.createPage({ id: page.id, name, meta: pageMeta })

      for (const pb of page.blocks) {
        const info = built.get(`${page.pageIndex}:${pb.blockIndex}`)!
        const block = doc.pages[page.pageIndex].blocks[pb.blockIndex]
        const q = questionMetaFor(block, prefix, page.pageIndex, pb.blockIndex)
        // Rebuilt as a literal: a grid-in's `choices` is undefined, which isn't JSON.
        const meta = q
          ? { lesson: prefix, q: { id: q.id, format: q.format, ...(q.choices ? { choices: q.choices } : {}) } }
          : { lesson: prefix }
        board.createShape({
          id: blockId(prefix, page.pageIndex, pb.blockIndex),
          type: 'image',
          page: page.id,
          src: info.url,
          x: pb.x,
          y: pb.y,
          w: pb.w,
          h: pb.h,
          locked: true, // lesson content shouldn't be nudged by stray clicks
          meta,
        })
      }
    }
  })

  // Land the tutor on the first new page (page-follow carries students).
  editor.setCurrentPage(firstPage)
  return { added: true, stale: false, pages: placed.length, keys }
}
