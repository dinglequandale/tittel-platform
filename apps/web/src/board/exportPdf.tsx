import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { jsPDF } from 'jspdf'
import { toBlob } from 'html-to-image'
import { pageBounds, unionBounds, type Page, type Shape } from '@tittel/board'
import type { BoardEditor } from './engine/editor.ts'
import { ShapeGraphic } from './engine/ShapeGraphic.tsx'
import { lessonRefOf } from './lesson/load.ts'

// Exports the whole board — every page — to a multi-page PDF so students can keep
// exactly what was worked on after the ephemeral room is gone. Each page is drawn
// off screen through the same graphics as the canvas, turned into a high-res PNG,
// and given that board page's natural content aspect ratio (rather than a fixed
// paper size, which would shrink an expansive page into illegible mush). Reading
// shapes by page id never switches the tutor's current page, so students
// following along don't get yanked around.

const PADDING = 40
const PIXEL_RATIO = 2

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(blob)
  })
}

export async function exportBoardToPdf(editor: BoardEditor, filename = 'whiteboard.pdf'): Promise<number> {
  const { pdf, exported } = await pagesToPdf(editor, editor.getPages())
  if (!pdf) throw new Error('Nothing to export yet — the board is empty.')
  pdf.save(filename)
  return exported
}

/**
 * The pages a lesson worked on, as a PDF kept as the student's notes
 * (OVERHAUL O3): from the lesson's first plan page to the end of the board
 * (scratch pages added during the lesson come after it), or just the current
 * page when the lesson had no plan. Null when those pages are empty.
 */
export async function lessonNotesPdf(editor: BoardEditor, sessionId: string): Promise<Blob | null> {
  const pages = editor.getPages()
  const first = pages.findIndex((p) => {
    const ref = lessonRefOf(p.meta)
    return ref?.kind === 'session' && ref.id === sessionId
  })
  const { pdf } = await pagesToPdf(editor, first >= 0 ? pages.slice(first) : [editor.getCurrentPage()])
  return pdf ? pdf.output('blob') : null
}

/** One board page as a PNG, drawn in a throwaway element out of sight. */
async function renderPage(shapes: Shape[]): Promise<{ blob: Blob; width: number; height: number }> {
  const bounds = unionBounds(shapes.map(pageBounds))!
  const width = Math.ceil(bounds.w + PADDING * 2)
  const height = Math.ceil(bounds.h + PADDING * 2)
  // The element captured can't be the one moved out of sight: the capture copies
  // its styles, and would draw it just as far outside its own frame.
  const offscreen = document.createElement('div')
  offscreen.style.cssText = 'position:fixed;left:-100000px;top:0'
  const host = document.createElement('div')
  host.style.cssText = `width:${width}px;height:${height}px;background:#fff`
  offscreen.appendChild(host)
  document.body.appendChild(offscreen)
  const root = createRoot(host)
  try {
    flushSync(() =>
      root.render(
        <svg width={width} height={height} viewBox={`${bounds.x - PADDING} ${bounds.y - PADDING} ${width} ${height}`}>
          {shapes.map((shape) => (
            <ShapeGraphic key={shape.id} shape={shape} />
          ))}
        </svg>,
      ),
    )
    const blob = await toBlob(host, { pixelRatio: PIXEL_RATIO, backgroundColor: '#ffffff' })
    if (!blob) throw new Error('Couldn’t draw this page for the PDF.')
    return { blob, width: width * PIXEL_RATIO, height: height * PIXEL_RATIO }
  } finally {
    root.unmount()
    offscreen.remove()
  }
}

async function pagesToPdf(editor: BoardEditor, pages: Page[]): Promise<{ pdf: jsPDF | null; exported: number }> {
  let pdf: jsPDF | null = null
  let exported = 0

  for (const page of pages) {
    const shapes = editor.doc.getPageShapes(page.id)
    if (shapes.length === 0) continue // skip empty pages (e.g. a blank scratch page)

    const { blob, width, height } = await renderPage(shapes)
    const dataUrl = await blobToDataUrl(blob)

    // jsPDF takes the format in portrait spec [short, long] and swaps it for
    // landscape, so this lands the page at exactly [width, height] either way.
    const shorter = Math.min(width, height)
    const longer = Math.max(width, height)
    const orientation = width >= height ? 'landscape' : 'portrait'
    const format: [number, number] = [shorter, longer]

    if (!pdf) pdf = new jsPDF({ unit: 'px', format, orientation, compress: true })
    else pdf.addPage(format, orientation)

    pdf.addImage(dataUrl, 'PNG', 0, 0, width, height)
    exported++
  }

  return { pdf, exported }
}
