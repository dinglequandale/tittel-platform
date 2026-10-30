import { useEffect, useRef, useState } from 'react'
import { Button, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@tittel/ui'
import { saveOrg, type Org } from '../lib/useOrg.ts'
import { useToast } from '../lib/toast.tsx'
import { fillTemplate, DEFAULT_TEMPLATES, PLACEHOLDERS, type TemplateKind } from '../lessons/template.ts'

// What the preview fills each template with: a made-up student, never real data.
const SAMPLE: Record<TemplateKind, Record<string, string>> = {
  lesson: {
    first_name: 'Sam', date: 'Thu, Oct 29', covered: 'Solving quadratics by factoring. Next: completing the square.',
    board_score: '3 of 4 answers right', last_homework: 'Quadratics practice, 1 to go over', homework: 'Factoring set B, due Tue, Nov 3',
    board_notes_link: 'https://…/board-notes.pdf', portal_link: 'https://…/s/sam', tutor_name: 'You',
  },
  report: {
    first_name: 'Sam', period: 'Oct 1 to Oct 31', lesson_count: '4',
    lessons: '- Thu, Oct 8: Linear equations\n- Thu, Oct 15: Systems of equations\n- Thu, Oct 22: Factoring\n- Thu, Oct 29: Quadratics',
    homework_summary: '3 of 4 handed in, 81% right', homework_list: '- Linear practice: 9/10\n- Systems: 7/10\n- Factoring A: 8/10\n- Factoring B: due Tue, Nov 3',
    board_summary: '11 of 14 answers right', portal_link: 'https://…/s/sam', tutor_name: 'You',
  },
}

function TemplateEditor({ kind, saved, label }: { kind: TemplateKind; saved: string | null; label: string }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [text, setText] = useState(saved ?? DEFAULT_TEMPLATES[kind])
  const box = useRef<HTMLTextAreaElement>(null)
  useEffect(() => setText(saved ?? DEFAULT_TEMPLATES[kind]), [saved, kind])
  const preview = fillTemplate(text, SAMPLE[kind])
  const changed = text !== (saved ?? DEFAULT_TEMPLATES[kind])

  function insert(name: string) {
    const el = box.current
    const at = el ? el.selectionStart : text.length
    const next = `${text.slice(0, at)}{${name}}${text.slice(el ? el.selectionEnd : at)}`
    setText(next)
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + name.length + 2, at + name.length + 2) })
  }

  async function save(next: string | null) {
    try {
      await saveOrg({ parentTemplates: { [kind]: next } })
      toast(next === null ? 'Back to the standard wording' : 'Saved')
    } catch (err) {
      toast((err as Error).message)
    }
  }

  if (!open) {
    return (
      <div className="list-row">
        <div>
          <div className="list-row-title">{label}</div>
          <div className="list-row-sub">{saved === null ? 'Standard wording' : 'Your own wording'}</div>
        </div>
        <Button variant="ghost" onClick={() => setOpen(true)}>Edit wording</Button>
      </div>
    )
  }
  return (
    <div className="template-editor">
      <div className="list-row-title">{label}</div>
      <p className="muted">
        Write it how you'd say it. Click a part to add it where the cursor is. A line whose parts are all empty is left out,
        so delete a line to drop that part for good. A first line starting “Subject:” is the email subject.
      </p>
      <div className="chip-row">
        {PLACEHOLDERS[kind].map((p) => (
          <button key={p.name} type="button" className="chip" title={p.hint} onClick={() => insert(p.name)}>{`{${p.name}}`}</button>
        ))}
      </div>
      <div className="template-panes">
        <textarea ref={box} className="input template-text" rows={14} value={text} onChange={(e) => setText(e.target.value)} aria-label={label} />
        <div className="template-preview" aria-label="Preview">
          <div className="list-row-sub">Preview, with a made-up student</div>
          {preview.subject && <div className="list-row-title">{preview.subject}</div>}
          <pre>{preview.body}</pre>
        </div>
      </div>
      <div className="row-end">
        <Button variant="ghost" onClick={() => { setText(DEFAULT_TEMPLATES[kind]); void save(null) }} disabled={saved === null && !changed}>Reset to standard</Button>
        <Button variant="ghost" onClick={() => setOpen(false)}>Close</Button>
        <Button onClick={() => save(text)} disabled={!changed}>Save</Button>
      </div>
    </div>
  )
}

/**
 * Settings → Parents. Some tutors write after every lesson, some send a
 * monthly report, some keep parents out of the app entirely: each piece can
 * be turned off, and the wording of both is the tutor's own.
 */
export function ParentsCard({ org }: { org: Org }) {
  const toast = useToast()
  const pu = org.parentUpdates
  async function set(patch: Partial<Org['parentUpdates']>) {
    try {
      await saveOrg({ parentUpdates: patch })
    } catch (err) {
      toast((err as Error).message)
    }
  }
  return (
    <div className="surface-card settings-card">
      <div className="card-title">Parents</div>
      <p className="muted">Nothing is ever sent by the app: you copy the message or open it in your own email, and can edit it first. Turn either off for one student under Students → Edit.</p>
      <label className="check-row">
        <input type="checkbox" checked={pu.afterLesson} onChange={(e) => set({ afterLesson: e.target.checked })} />
        Offer an update after each lesson
      </label>
      <label className="check-row">
        <input type="checkbox" checked={pu.reports} onChange={(e) => set({ reports: e.target.checked })} />
        Offer progress reports (on a student's page, for any period)
      </label>
      {pu.reports && (
        <div className="due-row">
          <span className="list-row-sub">Remind me on This week</span>
          <Select value={pu.reminder} onValueChange={(v) => set({ reminder: v as Org['parentUpdates']['reminder'] })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Never</SelectItem>
              <SelectItem value="monthly">At the start of each month</SelectItem>
              <SelectItem value="4weeks">Every 4 weeks</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      {pu.afterLesson && <TemplateEditor kind="lesson" saved={org.parentTemplates.lesson} label="After a lesson" />}
      {pu.reports && <TemplateEditor kind="report" saved={org.parentTemplates.report} label="Progress report" />}
    </div>
  )
}
