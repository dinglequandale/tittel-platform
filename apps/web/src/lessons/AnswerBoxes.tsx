import { useState } from 'react'
import { X } from 'lucide-react'
import {
  Button, Input, Dialog, DialogContent, DialogTitle, DialogClose,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@tittel/ui'
import type { LessonDoc } from '@tittel/shared'
import { boxesOf, withBoxes, type PageBox } from './composer.ts'

const KINDS: { value: PageBox['choices']; label: string }[] = [
  { value: 'ABCD', label: 'A to D' },
  { value: 'ABCDE', label: 'A to E' },
  { value: 'typed', label: 'Typed answer' },
]

/**
 * Answer boxes on a plan's PDF or photo pages. A page is only a picture, so
 * the tutor clicks where a question is printed and says what the answer is;
 * in the lesson, students answer right there and it counts like any other
 * answer box.
 */
export function AnswerBoxesDialog({ doc, onSave, onClose }: {
  doc: LessonDoc
  onSave: (doc: LessonDoc) => Promise<void>
  onClose: () => void
}) {
  const [boxes, setBoxes] = useState<PageBox[]>(() => boxesOf(doc))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  // Numbered the way the board will number them: down each page, page by page.
  const numbered = doc.pages.flatMap((_, page) => boxes.filter((b) => b.page === page).sort((a, b) => a.y - b.y || a.x - b.x))
  const numberOf = (b: PageBox) => numbered.indexOf(b) + 1
  const change = (b: PageBox, patch: Partial<PageBox>) => setBoxes(boxes.map((x) => (x === b ? { ...x, ...patch } : x)))

  async function save() {
    const missing = numbered.find((b) => !b.key.trim())
    if (missing) return setError(`Q${numberOf(missing)} needs its answer.`)
    setSaving(true)
    setError('')
    try {
      await onSave(withBoxes(doc, boxes))
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="dialog-content dialog-wide">
        <DialogTitle>Answer boxes</DialogTitle>
        <p className="muted">Click a page where a question is printed, then give its answer. You open each box during the lesson.</p>
        <div className="box-pages">
          {doc.pages.map((page, pi) => {
            const src = page.blocks.find((b) => b.type === 'image')?.src
            if (!src) return null
            const here = numbered.filter((b) => b.page === pi)
            return (
              <div key={pi} className="box-page">
                <div className="box-sheet">
                  <img src={src} alt={page.label} onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect()
                    setBoxes([...boxes, { page: pi, x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height, choices: 'ABCD', key: '' }])
                  }} />
                  {here.map((b) => (
                    <span key={numberOf(b)} className="box-pin" style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%` }}>Q{numberOf(b)}</span>
                  ))}
                </div>
                <div className="box-rows">
                <div className="list-row-sub">{page.label}</div>
                {!here.length && <p className="muted slot-note">Click the page to add a box.</p>}
                {here.map((b) => (
                  <div key={numberOf(b)} className="box-row">
                    <span className="box-row-label num">Q{numberOf(b)}</span>
                    <Select value={b.choices} onValueChange={(v) => change(b, { choices: v as PageBox['choices'], key: '' })}>
                      <SelectTrigger aria-label={`Q${numberOf(b)} answer type`}><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {KINDS.map((k) => <SelectItem key={k.value} value={k.value}>{k.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Button variant="ghost" aria-label={`Remove Q${numberOf(b)}`} onClick={() => setBoxes(boxes.filter((x) => x !== b))}>
                      <X size={15} strokeWidth={2} />
                    </Button>
                    {b.choices === 'typed' ? (
                      <Input aria-label={`Q${numberOf(b)} answer`} value={b.key} placeholder="Answer" onChange={(e) => change(b, { key: e.target.value })} />
                    ) : (
                      <div className="box-keys" role="group" aria-label={`Q${numberOf(b)} answer`}>
                        {[...b.choices].map((c) => (
                          <button key={c} type="button" className="box-key" data-on={b.key === c} onClick={() => change(b, { key: c })}>{c}</button>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                </div>
              </div>
            )
          })}
        </div>
        {error && <p className="field-error">{error}</p>}
        <div className="row-end">
          <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
