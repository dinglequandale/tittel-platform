import { useEffect, useState } from 'react'
import {
  Button, Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@tittel/ui'
import type { LessonDoc } from '@tittel/shared'
import { apiFetch } from '../lib/api.ts'
import { useToast } from '../lib/toast.tsx'
import { uploadFile, pdfToPages, fileUrl, isPdf, isImage } from '../lib/files.ts'
import type { LessonSummary } from '../content/types.ts'
import { planFromImages, planFromText } from './composer.ts'
import { DropZone, PasteDialog } from './Drop.tsx'
import type { Lesson } from './lessons.ts'

const baseName = (name: string) => name.replace(/\.[^.]+$/, '')

/**
 * What the lesson teaches, on the board when it starts. Tutors mostly teach
 * from material they already have, so the quickest way in is to drop it: a
 * PDF becomes one board page per page, photos one page each. Typed or pasted
 * text works too, with answer boxes where it says "Answer: …".
 */
export function PlanSlot({ lesson, onChange }: { lesson: Lesson; onChange: (body: Record<string, unknown>) => Promise<void> }) {
  const toast = useToast()
  const [plans, setPlans] = useState<LessonSummary[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [writing, setWriting] = useState(false)

  useEffect(() => {
    apiFetch('/api/tutor/lessons').then((r) => setPlans(r.lessons)).catch(() => setPlans([]))
  }, [lesson.plan_id])

  async function save(doc: LessonDoc) {
    const { lesson: plan } = await apiFetch('/api/tutor/lessons', { method: 'POST', body: JSON.stringify({ title: doc.title, doc }) })
    await onChange({ planId: plan.id })
  }

  async function addFiles(files: File[]) {
    const usable = files.filter((f) => isPdf(f) || isImage(f))
    if (!usable.length) return toast('Drop a PDF or images (PNG, JPEG).')
    try {
      const urls: string[] = []
      for (const f of usable) {
        if (isPdf(f)) {
          setBusy(`Reading ${f.name}…`)
          const pages = await pdfToPages(f, (n, total) => setBusy(`Reading page ${n} of ${total}…`))
          for (let i = 0; i < pages.length; i++) {
            setBusy(`Saving page ${i + 1} of ${pages.length}…`)
            urls.push(fileUrl((await uploadFile(pages[i], `${baseName(f.name)} p${i + 1}.jpg`)).token))
          }
        } else {
          setBusy(`Saving ${f.name}…`)
          urls.push(fileUrl((await uploadFile(f, f.name)).token))
        }
      }
      await save(planFromImages(urls, baseName(usable[0].name)))
      toast(`${urls.length} page${urls.length === 1 ? '' : 's'} ready for the board`)
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="surface-card slot">
      <div className="slot-head">
        <span className="card-title-lg">Plan</span>
        {lesson.plan_id && <Button variant="ghost" onClick={() => onChange({ planId: null })}>Remove</Button>}
      </div>
      {lesson.plan_id ? (
        <p className="slot-value">{lesson.plan_title}<span className="muted"> · on the board when you start</span></p>
      ) : (
        <>
          <DropZone accept="application/pdf,image/png,image/jpeg,image/webp" multiple busy={busy} onFiles={addFiles}>
            <strong>Drop a PDF or photos</strong>
            <span className="muted">or click to choose. Each page goes on the board.</span>
          </DropZone>
          <div className="slot-actions">
            <Button variant="secondary" onClick={() => setWriting(true)} disabled={!!busy}>Write or paste</Button>
            {plans && plans.length > 0 && (
              <Select value="" onValueChange={(planId) => onChange({ planId })}>
                <SelectTrigger><SelectValue placeholder="Reuse a plan…" /></SelectTrigger>
                <SelectContent>
                  {plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
          </div>
        </>
      )}
      {writing && (
        <PasteDialog
          title="Write or paste a plan"
          nameLabel="Plan name"
          defaultName=""
          placeholder={'# Factoring quadratics\nFind two numbers that multiply to $c$ and add to $b$.\n\n1. Factor $x^2+5x+6$.\nAnswer: (x+2)(x+3)\n---\n# Practice\n2. Which is $x^2-9$ factored? A) (x-3)(x+3)  B) (x-9)(x+1)\nAnswer: A'}
          hint={'Blank lines separate blocks; "---" starts a new board page; "# " is a heading; "Answer: …" adds an answer box. Math in $…$ (or \\( \\)).'}
          describe={(text) => {
            const doc = planFromText(text, '')
            const answers = doc.pages.reduce((n, p) => n + p.blocks.filter((b) => b.answer).length, 0)
            return `${doc.pages.length} board page${doc.pages.length === 1 ? '' : 's'}${answers ? `, ${answers} with answer boxes` : ''}.`
          }}
          confirmLabel="Use this plan"
          onClose={() => setWriting(false)}
          onUse={async (text, name) => {
            const doc = planFromText(text, name || `${lesson.student_name ?? lesson.group_name ?? 'Lesson'} plan`)
            if (!doc.pages.length) throw new Error('Nothing to put on the board yet.')
            await save(doc)
            setWriting(false)
          }}
        />
      )}
    </section>
  )
}
