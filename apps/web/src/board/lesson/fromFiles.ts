import { apiFetch } from '../../lib/api.ts'
import { uploadFile, pdfToPages, fileUrl, isPdf, isImage } from '../../lib/files.ts'
import { planFromImages } from '../../lessons/composer.ts'

const baseName = (name: string) => name.replace(/\.[^.]+$/, '')

/**
 * A PDF or photos the tutor brings to the board mid-lesson, saved as a library
 * plan the same way the lesson page's PlanSlot does: one page image per PDF
 * page or photo, each a durable /api/files URL. Returns the new plan's id for
 * `loadLibraryLesson`, or null when none of the files is a PDF or image.
 */
export async function planFromFiles(files: File[], onStatus: (msg: string) => void): Promise<string | null> {
  const usable = files.filter((f) => isPdf(f) || isImage(f))
  if (!usable.length) return null
  const urls: string[] = []
  for (const f of usable) {
    if (isPdf(f)) {
      onStatus(`Reading ${f.name}…`)
      const pages = await pdfToPages(f, (n, total) => onStatus(`Reading page ${n} of ${total}…`))
      for (let i = 0; i < pages.length; i++) {
        onStatus(`Saving page ${i + 1} of ${pages.length}…`)
        urls.push(fileUrl((await uploadFile(pages[i], `${baseName(f.name)} p${i + 1}.jpg`)).token))
      }
    } else {
      onStatus(`Saving ${f.name}…`)
      urls.push(fileUrl((await uploadFile(f, f.name)).token))
    }
  }
  const doc = planFromImages(urls, baseName(usable[0].name))
  const { lesson } = await apiFetch('/api/tutor/lessons', { method: 'POST', body: JSON.stringify({ title: doc.title, doc }) })
  return lesson.id
}
