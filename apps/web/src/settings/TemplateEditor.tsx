import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ClipboardEvent, type ReactNode } from 'react'
import { Check, Plus } from 'lucide-react'
import { saveOrg } from '../lib/useOrg.ts'
import { useToast } from '../lib/toast.tsx'
import {
  fillTemplate, joinTemplate, splitTemplate, templateParts, toggleSection, hasSection,
  DEFAULT_TEMPLATES, PLACEHOLDERS, SECTIONS, type TemplateKind,
} from '../lessons/template.ts'

// What the preview fills each template with: a made-up student, never real data.
const SAMPLE: Record<TemplateKind, Record<string, string>> = {
  lesson: {
    first_name: 'Sam', date: 'Thu, Oct 29', covered: 'Solving quadratics by factoring. Next: completing the square.',
    board_score: '3 of 4 answers right', last_homework: 'Quadratics practice, 1 to go over', homework: 'Factoring set B, due Tue, Nov 3',
    board_notes_link: 'https://…/board-notes.pdf', portal_link: 'https://…/s/sam',
  },
  report: {
    first_name: 'Sam', period: 'Oct 1 to Oct 31', lesson_count: '4',
    lessons: '- Thu, Oct 8: Linear equations\n- Thu, Oct 15: Systems of equations\n- Thu, Oct 22: Factoring\n- Thu, Oct 29: Quadratics',
    homework_summary: '3 of 4 handed in, 81% right', homework_list: '- Linear practice: 9/10\n- Systems: 7/10\n- Factoring A: 8/10\n- Factoring B: due Tue, Nov 3',
    board_summary: '11 of 14 answers right', portal_link: 'https://…/s/sam',
  },
}

/** The message as a parent would get it, filled in for the made-up student. */
export function TemplatePreview({ kind, template, tutorName }: { kind: TemplateKind; template: string; tutorName: string }) {
  const { subject, body } = fillTemplate(template, { ...SAMPLE[kind], tutor_name: tutorName || 'You' })
  return (
    <div className="tpl-mail" aria-label="Preview">
      {subject && <div className="tpl-mail-subject">{subject}</div>}
      <pre>{body}</pre>
    </div>
  )
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function toHtml(text: string, kind: TemplateKind): string {
  return templateParts(text, kind).map((p) => ('name' in p
    ? `<span class="tpl-pill" contenteditable="false" data-name="${p.name}">${escapeHtml(p.label)}<i data-remove aria-hidden="true">×</i></span>`
    : escapeHtml(p.text).replace(/\n/g, '<br>'))).join('')
}

/** Back to template text. Phone keyboards and pasted text can leave divs, so those count as new lines too. */
function fromDom(root: Node): string {
  let out = ''
  const walk = (parent: Node) => parent.childNodes.forEach((n) => {
    if (n.nodeType === Node.TEXT_NODE) out += (n.textContent ?? '').replace(/ /g, ' ')
    else if (n instanceof HTMLElement) {
      if (n.dataset.name) out += `{${n.dataset.name}}`
      else if (n.tagName === 'BR') out += '\n'
      else {
        if (n.tagName === 'DIV' && out && !out.endsWith('\n')) out += '\n'
        walk(n)
      }
    }
  })
  walk(root)
  // The editor always ends in one <br>, which is where the cursor rests.
  return out.replace(/\n$/, '')
}

interface LetterHandle { insert: (text: string) => void }

// Words the tutor types, with the details that fill in by themselves as
// pills: nothing to get wrong. A contenteditable is left to the browser (so
// undo works) and only rewritten when `value` changes from outside it.
const Letter = forwardRef<LetterHandle, {
  kind: TemplateKind; value: string; label: string; singleLine?: boolean
  onChange: (v: string) => void; onFocus: () => void
}>(function Letter({ kind, value, label, singleLine, onChange, onFocus }, ref) {
  const box = useRef<HTMLDivElement>(null)
  const caret = useRef<Range | null>(null)

  useEffect(() => {
    const el = box.current!
    if (fromDom(el) !== value || !el.hasChildNodes()) el.innerHTML = `${toHtml(value, kind)}<br>`
  }, [value, kind])

  // A tap on a detail can take the focus away, so remember where the cursor was.
  useEffect(() => {
    const remember = () => {
      const sel = document.getSelection()
      if (sel?.rangeCount && box.current?.contains(sel.anchorNode)) caret.current = sel.getRangeAt(0).cloneRange()
    }
    document.addEventListener('selectionchange', remember)
    return () => document.removeEventListener('selectionchange', remember)
  }, [])

  useImperativeHandle(ref, () => ({
    insert(text) {
      const el = box.current!
      el.focus()
      const sel = document.getSelection()!
      sel.removeAllRanges()
      if (caret.current) sel.addRange(caret.current)
      else { sel.selectAllChildren(el); sel.collapseToEnd() }
      document.execCommand('insertHTML', false, toHtml(text, kind))
    },
  }), [kind])

  function copy(e: ClipboardEvent, cut: boolean) {
    const range = document.getSelection()?.getRangeAt(0)
    if (!range || range.collapsed) return
    const holder = document.createElement('div')
    holder.append(range.cloneContents())
    e.clipboardData.setData('text/plain', fromDom(holder))
    e.preventDefault()
    if (cut) document.execCommand('delete')
  }

  return (
    <div
      ref={box}
      className="tpl-letter"
      data-single={singleLine || undefined}
      role="textbox"
      aria-label={label}
      aria-multiline={!singleLine}
      contentEditable
      suppressContentEditableWarning
      spellCheck
      onInput={(e) => onChange(fromDom(e.currentTarget))}
      onFocus={onFocus}
      onKeyDown={(e) => {
        if (e.key !== 'Enter') return
        e.preventDefault()
        if (!singleLine) document.execCommand('insertLineBreak')
      }}
      onCopy={(e) => copy(e, false)}
      onCut={(e) => copy(e, true)}
      onPaste={(e) => {
        e.preventDefault()
        const text = e.clipboardData.getData('text/plain').replace(/\r/g, '')
        document.execCommand('insertHTML', false, toHtml(singleLine ? text.replace(/\n/g, ' ') : text, kind))
      }}
      onClick={(e) => {
        const pill = (e.target as HTMLElement).closest('[data-remove]')?.parentElement
        if (!pill) return
        pill.remove()
        onChange(fromDom(e.currentTarget))
      }}
    />
  )
})

export interface TemplateEditorControls {
  /** Differs from what's saved. */
  changed: boolean
  busy: boolean
  /** Saves the wording; the standard wording is saved as "none of their own". False if it didn't save. */
  save: () => Promise<boolean>
}

/**
 * The tutor's own wording for a parent message (Settings → Parents, and
 * /welcome for the progress report). What's saved is still a plain template
 * (lessons/template.ts); the tutor only ever sees words and named details.
 */
export function TemplateEditor({
  kind, saved, tutorName, footer,
}: { kind: TemplateKind; saved: string | null; tutorName: string; footer: (c: TemplateEditorControls) => ReactNode }) {
  const toast = useToast()
  const standard = DEFAULT_TEMPLATES[kind]
  const [draft, setDraft] = useState(() => splitTemplate(saved ?? standard))
  const [view, setView] = useState<'write' | 'preview'>('write')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const subject = useRef<LetterHandle>(null)
  const body = useRef<LetterHandle>(null)
  const active = useRef<typeof subject | null>(null)

  const template = joinTemplate(draft)
  const changed = template !== (saved ?? standard).replace(/\r/g, '')

  async function save() {
    if (template.length > 5000) {
      setError('This is too long to save. Shorten it to under 5,000 characters.')
      return false
    }
    setBusy(true)
    setError('')
    try {
      await saveOrg({ parentTemplates: { [kind]: template === standard ? null : template } })
      return true
    } catch (err) {
      toast((err as Error).message)
      return false
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tpl" data-view={view}>
      <div className="seg tpl-views" role="radiogroup" aria-label="Show">
        {(['write', 'preview'] as const).map((v) => (
          <button key={v} type="button" role="radio" aria-checked={view === v} data-active={view === v} onClick={() => setView(v)}>
            {v === 'write' ? 'Write' : 'Preview'}
          </button>
        ))}
      </div>
      <div className="tpl-panes">
        <div className="tpl-write">
          <div className="tpl-group">
            <div className="tpl-heading">What to include</div>
            <div className="chip-row">
              {SECTIONS[kind].map((s) => {
                const on = hasSection(draft.body, kind, s.key)
                return (
                  <button key={s.key} type="button" className="tpl-part" aria-pressed={on}
                    onClick={() => setDraft({ ...draft, body: toggleSection(draft.body, kind, s.key) })}>
                    {on ? <Check size={13} strokeWidth={3} /> : <Plus size={13} strokeWidth={2.5} />} {s.label}
                  </button>
                )
              })}
            </div>
          </div>
          <div className="tpl-group">
            <div className="tpl-heading">Email subject</div>
            <Letter ref={subject} kind={kind} label="Email subject" singleLine value={draft.subject}
              onChange={(s) => setDraft((d) => ({ ...d, subject: s }))} onFocus={() => { active.current = subject }} />
          </div>
          <div className="tpl-group">
            <div className="tpl-heading">Your message</div>
            <Letter ref={body} kind={kind} label="Your message" value={draft.body}
              onChange={(b) => setDraft((d) => ({ ...d, body: b }))} onFocus={() => { active.current = body }} />
            <p className="muted">Click anywhere and type. The coloured parts fill in by themselves for each student, and a line with nothing to report is left out.</p>
          </div>
          <div className="tpl-group">
            <div className="tpl-heading">Add a detail where your cursor is</div>
            <div className="chip-row">
              {PLACEHOLDERS[kind].filter((p) => !p.block).map((p) => (
                <button key={p.name} type="button" className="tpl-pill tpl-add" title={p.hint}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => (active.current ?? body).current?.insert(`{${p.name}}`)}>
                  <Plus size={12} strokeWidth={2.5} /> {p.label}
                </button>
              ))}
            </div>
          </div>
          <button type="button" className="link-button" disabled={!changed && !saved}
            onClick={() => setDraft(splitTemplate(standard))}>Go back to the standard wording</button>
        </div>
        <div className="tpl-preview">
          <div className="tpl-heading">How it will look, for a made-up student</div>
          <TemplatePreview kind={kind} template={template} tutorName={tutorName} />
        </div>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
      {footer({ changed, busy, save })}
    </div>
  )
}
