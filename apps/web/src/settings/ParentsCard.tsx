import { useState } from 'react'
import { Button, Dialog, DialogContent, DialogDescription, DialogTitle, Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@tittel/ui'
import { saveOrg, type Org } from '../lib/useOrg.ts'
import { useToast } from '../lib/toast.tsx'
import { TemplateEditor } from './TemplateEditor.tsx'
import type { TemplateKind } from '../lessons/template.ts'

function TemplateRow({ kind, saved, label, tutorName }: { kind: TemplateKind; saved: string | null; label: string; tutorName: string }) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  return (
    <div className="list-row">
      <div>
        <div className="list-row-title">{label}</div>
        <div className="list-row-sub">{saved === null ? 'Standard wording' : 'Your own wording'}</div>
      </div>
      <Button variant="ghost" onClick={() => setOpen(true)}>Edit wording</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="dialog-content tpl-dialog">
          <DialogTitle className="card-title-lg">{label}</DialogTitle>
          <DialogDescription>Nothing goes to parents until you've checked it.</DialogDescription>
          <TemplateEditor kind={kind} saved={saved} tutorName={tutorName} footer={({ changed, busy, save }) => (
            <div className="row-end">
              <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancel</Button>
              <Button disabled={busy || !changed} onClick={async () => {
                if (await save()) { setOpen(false); toast('Saved') }
              }}>{busy ? 'Saving…' : 'Save'}</Button>
            </div>
          )} />
        </DialogContent>
      </Dialog>
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
      {pu.afterLesson && <TemplateRow kind="lesson" saved={org.parentTemplates.lesson} label="After a lesson" tutorName={org.displayName} />}
      {pu.reports && <TemplateRow kind="report" saved={org.parentTemplates.report} label="Progress report" tutorName={org.displayName} />}
    </div>
  )
}
