import { apiFetch } from './api.ts'

// Uploads kept by the server (routes/files.ts) and served by token, so a
// plan's pages, a worksheet and a student's photos all have a stable address.
export interface StoredFile { token: string; name: string; type: string }

export const fileUrl = (token: string) => `/api/files/${token}`

export const isPdf = (f: { type: string; name: string }) => f.type === 'application/pdf' || /\.pdf$/i.test(f.name)
export const isImage = (f: { type: string }) => /^image\/(png|jpeg|webp|gif)$/.test(f.type)

export async function fileToBase64(file: Blob): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export async function uploadFile(blob: Blob, name: string): Promise<StoredFile> {
  const { file } = await apiFetch(`/api/tutor/files?name=${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { 'content-type': blob.type || 'application/octet-stream' },
    body: blob,
  })
  return file
}

/**
 * A PDF's pages as images, rendered in the browser (pdf.js, loaded only
 * when needed). Wide enough to stay sharp on the board at 900px.
 */
export async function pdfToPages(file: File, onPage?: (done: number, total: number) => void): Promise<Blob[]> {
  const pdfjs = await import('pdfjs-dist')
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise
  if (doc.numPages > 40) throw new Error('That PDF has more than 40 pages. Split it, or pick the pages you need.')
  const pages: Blob[] = []
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n)
    const base = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: 1800 / base.width })
    const canvas = document.createElement('canvas')
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    const ctx = canvas.getContext('2d')!
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    // 'print' renders in one go; the default screen intent waits on animation
    // frames, which stop in a background tab (a tutor drops a PDF, switches away).
    await page.render({ canvasContext: ctx, viewport, intent: 'print' }).promise
    pages.push(await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Couldn’t read a page of that PDF'))), 'image/jpeg', 0.9)))
    onPage?.(n, doc.numPages)
  }
  return pages
}
