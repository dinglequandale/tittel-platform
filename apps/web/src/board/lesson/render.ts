import { toSvg } from 'html-to-image'
import renderMathInElement from 'katex/contrib/auto-render'
import 'katex/dist/katex.min.css'
import type { LessonBlock } from '@tittel/shared'

// Renders a lesson block to a crisp raster image plus its on-canvas size
// (ported from the legacy whiteboard, restyled to the OVERHAUL §2 type):
//  - 'latex'/'text' blocks: an offscreen HTML card (prose with inline `$...$`
//    and display `$$...$$` math via KaTeX auto-render), rasterized at 3x so it
//    stays sharp when zoomed and embeds cleanly in a board PDF export.
//  - 'image' blocks: the source is used directly; we only measure it.

const PIXEL_RATIO = 3
/** A block that hasn't rendered by now isn't going to; fail so the host can retry. */
const RENDER_TIMEOUT_MS = 20_000

// html-to-image's first capture is often blank until web fonts are decoded and
// embedded; we warm that cache exactly once.
let fontsWarmed = false

// html-to-image's own toBlob waits on `img.decode()` and then a
// requestAnimationFrame, and a background tab runs neither — so a board opened
// behind the meeting tab would hang. Rasterize the SVG ourselves with `onload`.
function rasterize(svgUrl: string, w: number, h: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = Math.ceil(w * PIXEL_RATIO)
      canvas.height = Math.ceil(h * PIXEL_RATIO)
      const ctx = canvas.getContext('2d')!
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Couldn’t render a lesson block'))), 'image/png')
    }
    img.onerror = () => reject(new Error('Couldn’t render a lesson block'))
    img.src = svgUrl
  })
}

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('Rendering the lesson timed out. Try loading it again.')), RENDER_TIMEOUT_MS)
    p.then(resolve, reject).finally(() => clearTimeout(t))
  })
}

export interface RenderedBlock {
  /** PNG to upload as an asset; null for 'image' blocks (use `src`). */
  blob: Blob | null
  src: string | null
  w: number
  h: number
  mimeType: string
}

// The captured node (`card`) is positioned statically; the off-screen offset
// lives on an outer wrapper. html-to-image clones the captured node into an SVG
// <foreignObject>, and any `position/left` on that node would shift its content
// out of the viewport — a correctly sized but blank image.
function buildCard(block: LessonBlock): { wrapper: HTMLDivElement; card: HTMLDivElement } {
  const wrapper = document.createElement('div')
  Object.assign(wrapper.style, {
    position: 'fixed',
    left: '-99999px',
    top: '0',
    pointerEvents: 'none',
  } as Partial<CSSStyleDeclaration>)

  const card = document.createElement('div')
  const heading = block.kind === 'heading'
  Object.assign(card.style, {
    boxSizing: 'border-box',
    width: 'fit-content',
    maxWidth: `${block.maxWidth}px`,
    padding: '16px 20px',
    background: '#ffffff',
    color: '#0F0F0F',
    fontFamily: "'Outfit', 'Segoe UI', system-ui, sans-serif",
    fontSize: heading ? '30px' : '21px',
    fontWeight: heading ? '650' : '400',
    letterSpacing: heading ? '-0.02em' : '0',
    lineHeight: '1.5',
    whiteSpace: 'normal',
    wordBreak: 'break-word',
  } as Partial<CSSStyleDeclaration>)

  // Author line breaks stay real text nodes so auto-render finds the math in them.
  const lines = (block.content ?? '').split('\n')
  lines.forEach((line, i) => {
    if (i > 0) card.appendChild(document.createElement('br'))
    card.appendChild(document.createTextNode(line))
  })

  wrapper.appendChild(card)
  return { wrapper, card }
}

async function renderTextual(block: LessonBlock): Promise<RenderedBlock> {
  const { wrapper, card } = buildCard(block)
  document.body.appendChild(wrapper)
  try {
    renderMathInElement(card, {
      delimiters: [
        { left: '$$', right: '$$', display: true },
        { left: '\\[', right: '\\]', display: true },
        { left: '$', right: '$', display: false },
        { left: '\\(', right: '\\)', display: false },
      ],
      throwOnError: false,
    })
    if (document.fonts?.ready) await document.fonts.ready
    const w = card.offsetWidth
    const h = card.offsetHeight
    const opts = { backgroundColor: '#ffffff', cacheBust: true }
    if (!fontsWarmed) {
      await rasterize(await toSvg(card, opts), w, h)
      fontsWarmed = true
    }
    const blob = await rasterize(await toSvg(card, opts), w, h)
    return { blob, src: null, w, h, mimeType: 'image/png' }
  } finally {
    wrapper.remove()
  }
}

function measureImage(block: LessonBlock): Promise<RenderedBlock> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      const natW = img.naturalWidth || block.maxWidth
      const natH = img.naturalHeight || block.maxWidth
      const w = Math.min(natW, block.maxWidth)
      resolve({ blob: null, src: block.src!, w, h: (natH / natW) * w, mimeType: 'image/*' })
    }
    img.onerror = () => reject(new Error(`Couldn’t load image: ${block.src}`))
    img.src = block.src!
  })
}

export function renderBlock(block: LessonBlock): Promise<RenderedBlock> {
  return withTimeout(block.type === 'image' ? measureImage(block) : renderTextual(block))
}
