import { useEffect, useState } from 'react'
import {
  Button, ConfirmDialog, Dialog, DialogContent, DialogTitle, DialogClose,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { useToast } from '../lib/toast.tsx'
import { uploadFile, fileToBase64, isPdf, isImage, type StoredFile } from '../lib/files.ts'
import { AiImportReview, type AiImportDraft } from '../content/AiImportReview.tsx'
import type { ProblemSetSummary } from '../content/types.ts'
import { draftFromText } from './composer.ts'
import { DropZone, PasteDialog } from './Drop.tsx'
import { type Lesson, shortDate, dueLabel } from './lessons.ts'
import { useOrg } from '../lib/useOrg.ts'

const baseName = (name: string) => name.replace(/\.[^.]+$/, '')
const DAY_MS = 86_400_000

/** When homework is due: the tutor's default (Settings → How you teach), changeable each time. */
type DueChoice = string // 'next_lesson' | 'in_days:<n>' | 'none' | 'date'

function dueAtFor(choice: DueChoice, lesson: Lesson, date: string): string | null {
  if (choice === 'none') return null
  if (choice === 'date') return date ? new Date(`${date}T23:59`).toISOString() : null
  if (choice === 'next_lesson' && lesson.next_lesson_at) return lesson.next_lesson_at
  // "Next lesson" with none booked yet means a week, like the server's default.
  const days = choice.startsWith('in_days:') ? Number(choice.slice('in_days:'.length)) : 7
  return new Date(new Date(lesson.scheduled_at).getTime() + days * DAY_MS).toISOString()
}

/**
 * Homework from the lesson, in whatever form the tutor has it: a worksheet
 * (PDF or photo) the student does on paper and hands in as photos, or that
 * Claude turns into auto-graded questions; problems typed or pasted (say,
 * from ChatGPT, answer key and all); or a set from the library.
 */
export function HomeworkSlot({ lesson, onChanged }: { lesson: Lesson; onChanged: () => Promise<void> }) {
  const toast = useToast()
  const [sets, setSets] = useState<ProblemSetSummary[]>([])
  const [aiEnabled, setAiEnabled] = useState(false)
  const [draft, setDraft] = useState<{ draft: AiImportDraft; filename: string; materials: StoredFile[] } | null>(null)
  const [worksheet, setWorksheet] = useState<{ file: File; stored: StoredFile } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [pasting, setPasting] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<string | null>(null)
  const org = useOrg()
  const [due, setDue] = useState<DueChoice | null>(null)
  const [dueDate, setDueDate] = useState('')
  // Digital-SAT-style: the homework page offers a calculator and a reference sheet.
  const [satTools, setSatTools] = useState(false)
  const choice = due ?? org?.homeworkDue ?? 'next_lesson'
  const who = lesson.student_name ? `${lesson.student_name}'s portal` : 'every member’s portal'

  useEffect(() => {
    apiFetch('/api/tutor/problem-sets').then((r) => setSets(r.problemSets)).catch(() => {})
    apiFetch('/api/tutor/ai-import/status').then((r) => setAiEnabled(!!r.enabled)).catch(() => {})
  }, [])

  async function give(body: Record<string, unknown>) {
    setBusy('Giving it…')
    try {
      const dueAt = dueAtFor(choice, lesson, dueDate)
      await apiFetch(`/api/tutor/sessions/${lesson.id}/homework`, { method: 'POST', body: JSON.stringify({ ...body, dueAt, ...(satTools ? { tools: { calculator: true, reference: true } } : {}) }) })
      await onChanged()
      toast(`On ${who} now`)
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function addWorksheet(files: File[]) {
    const f = files[0]
    if (!isPdf(f) && !isImage(f)) return toast('Drop a PDF or a photo of the worksheet.')
    setBusy(`Saving ${f.name}…`)
    try {
      const stored = await uploadFile(f, f.name)
      // Without Claude there's one way to do it: on paper.
      if (!aiEnabled) await give({ paper: { title: baseName(f.name) }, materials: [stored.token] })
      else setWorksheet({ file: f, stored })
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function readWorksheet(w: { file: File; stored: StoredFile }) {
    setWorksheet(null)
    setBusy('Claude is reading the worksheet…')
    try {
      const { draft: d } = await apiFetch('/api/tutor/ai-import', {
        method: 'POST',
        body: JSON.stringify({ filename: w.file.name, mimeType: w.file.type, dataBase64: await fileToBase64(w.file) }),
      })
      setDraft({ draft: d, filename: w.file.name, materials: [w.stored] })
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (draft) {
    return (
      <section className="surface-card slot">
        <AiImportReview
          draft={draft.draft}
          filename={draft.filename}
          onDiscard={() => setDraft(null)}
          confirmLabel={`Give to ${lesson.student_name ?? lesson.group_name ?? 'them'}`}
          onCommitted={(setId) => {
            const materials = draft.materials.map((m) => m.token)
            setDraft(null)
            void give({ setId, materials })
          }}
        />
      </section>
    )
  }

  const usable = sets.filter((s) => s.problem_count > 0)
  const dueAt = dueAtFor(choice, lesson, dueDate)
  const dueText = choice === 'none' ? 'with no due date' : dueAt ? `due ${shortDate(dueAt)}` : 'due on the date you pick'

  return (
    <section className="surface-card slot" id="homework">
      <div className="slot-head"><span className="card-title-lg">Homework</span></div>
      {lesson.homework.map((h) => (
        <div key={h.id} className="list-row">
          <div>
            <div className="list-row-title">{h.title}</div>
            <div className="list-row-sub">
              {h.dueAt ? `Due ${dueLabel(h.dueAt)}` : 'No due date'} · {h.submitted}/{h.assigned} handed in
            </div>
          </div>
          <Button variant="ghost" onClick={() => setRemoveTarget(h.id)}>Remove</Button>
        </div>
      ))}
      {lesson.homework.length === 0 && <p className="muted">It goes straight to {who}, {dueText}.</p>}
      <div className="due-row">
        <span className="list-row-sub">Due</span>
        <Select value={choice} onValueChange={setDue}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="next_lesson">{lesson.next_lesson_at ? `At the next lesson (${shortDate(lesson.next_lesson_at)})` : 'Next lesson (none booked: a week)'}</SelectItem>
            <SelectItem value="in_days:3">3 days after this lesson</SelectItem>
            <SelectItem value="in_days:7">A week after this lesson</SelectItem>
            <SelectItem value="in_days:14">Two weeks after this lesson</SelectItem>
            <SelectItem value="date">On a date…</SelectItem>
            <SelectItem value="none">No due date</SelectItem>
          </SelectContent>
        </Select>
        {choice === 'date' && <input type="date" className="input due-date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} aria-label="Due date" />}
      </div>
      <label className="check-row">
        <input type="checkbox" checked={satTools} onChange={(e) => setSatTools(e.target.checked)} />
        Digital-SAT-style: a calculator and reference sheet on the homework page
      </label>
      <DropZone accept="application/pdf,image/png,image/jpeg,image/webp" busy={busy} onFiles={addWorksheet}>
        <strong>Drop a worksheet</strong>
        <span className="muted">PDF or photo. {aiEnabled ? 'Done on paper, or turned into auto-graded questions.' : 'They do it on paper and hand in photos.'}</span>
      </DropZone>
      <div className="slot-actions">
        <Button variant="secondary" onClick={() => setPasting(true)} disabled={!!busy}>Type or paste problems</Button>
        {usable.length > 0 && (
          // value="" keeps the picker an action: it resets to its placeholder after each pick.
          <Select value="" onValueChange={(setId) => give({ setId })} disabled={!!busy}>
            <SelectTrigger><SelectValue placeholder={lesson.homework.length ? 'Add a set…' : 'Use a problem set…'} /></SelectTrigger>
            <SelectContent>
              {usable.map((s) => <SelectItem key={s.id} value={s.id}>{s.title} ({s.problem_count})</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {worksheet && (
        <Dialog open onOpenChange={(open) => !open && setWorksheet(null)}>
          <DialogContent>
            <DialogTitle>How should they do {baseName(worksheet.file.name)}?</DialogTitle>
            <div className="choice-list">
              <button className="choice-card" onClick={() => { const w = worksheet; setWorksheet(null); void give({ paper: { title: baseName(w.file.name) }, materials: [w.stored.token] }) }}>
                <strong>On paper</strong>
                <span className="muted">They see the worksheet on their portal and hand in photos of their work. You mark it.</span>
              </button>
              <button className="choice-card" onClick={() => readWorksheet(worksheet)}>
                <strong>Answer online, auto-graded</strong>
                <span className="muted">Claude reads the questions and answers for you to check first. The worksheet stays attached.</span>
              </button>
            </div>
            <div className="row-end"><DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose></div>
          </DialogContent>
        </Dialog>
      )}

      {pasting && (
        <PasteDialog
          title="Type or paste problems"
          nameLabel="Homework name"
          defaultName={`${lesson.student_name ?? lesson.group_name ?? 'Lesson'} homework`}
          placeholder={'1. Factor $x^2+5x+6$.\n2. Which is $x^2-9$ factored?\nA) (x-3)(x+3)\nB) (x-9)(x+1)\n3. Solve $x^2-7x+12=0$. Give the larger root.\n\nAnswers:\n1. (x+2)(x+3)\n2. A\n3. 4'}
          hint={'Numbered problems, or one per paragraph. Answers under each ("Answer: 4") or in an "Answers" list at the end. Lettered lines are choices. No answer = they write it out and you mark it.'}
          describe={(text) => {
            const d = draftFromText(text, '')
            const graded = d.problems.filter((p) => p.type !== 'frq').length
            return `${d.problems.length} problem${d.problems.length === 1 ? '' : 's'}: ${graded} auto-graded, ${d.problems.length - graded} you mark.`
          }}
          confirmLabel="Check and give"
          onClose={() => setPasting(false)}
          onUse={(text, name) => {
            const d = draftFromText(text, name)
            if (!d.problems.length) throw new Error('No problems found yet.')
            setPasting(false)
            setDraft({ draft: d, filename: 'typed', materials: [] })
          }}
        />
      )}

      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title="Remove this homework?"
        description="It comes off the student's portal."
        confirmLabel="Remove"
        onConfirm={async () => {
          if (!removeTarget) return
          try {
            await apiFetch(`/api/tutor/assignments/${removeTarget}`, { method: 'DELETE' })
            await onChanged()
          } catch (err) {
            toast((err as Error).message)
          }
        }}
      />
    </section>
  )
}
