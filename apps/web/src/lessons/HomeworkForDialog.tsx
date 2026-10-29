import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button, Field, Dialog, DialogContent, DialogTitle, DialogClose,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { shortDate, type Lesson } from './lessons.ts'

interface Who { id: string; name: string; next_lesson_id?: string | null }

// New ▸ Homework: homework belongs to a lesson (it's due at the next one), so
// this asks who it's for and opens their most recent or next lesson at its
// Homework card. With no lesson at all, a one-off from Insights.
export function HomeworkForDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const [students, setStudents] = useState<Who[]>([])
  const [groups, setGroups] = useState<Who[]>([])
  const [lessons, setLessons] = useState<Lesson[]>([])
  const [who, setWho] = useState('')

  useEffect(() => {
    if (!open) return
    setWho('')
    const from = new Date(Date.now() - 7 * 86400e3).toISOString()
    const to = new Date(Date.now() + 30 * 86400e3).toISOString()
    Promise.all([apiFetch('/api/tutor/students'), apiFetch('/api/tutor/groups'), apiFetch(`/api/tutor/sessions?from=${from}&to=${to}`)])
      .then(([s, g, l]) => { setStudents(s.students); setGroups(g.groups); setLessons(l.lessons) })
      .catch(() => {})
  }, [open])

  // The lesson that just happened (homework is usually given after it), else the next one.
  const theirs = lessons.filter((l) => l.status !== 'cancelled' && (who === `s:${l.student_id}` || who === `g:${l.group_id}`))
  const past = theirs.filter((l) => new Date(l.scheduled_at).getTime() <= Date.now()).pop()
  const target = past ?? theirs[0]

  function go() {
    onOpenChange(false)
    navigate(target ? `/app/lessons/${target.id}#homework` : '/app/insights?tab=homework')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Homework for…</DialogTitle>
        <Field label="Student or group">
          <Select value={who} onValueChange={setWho}>
            <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
            <SelectContent>
              {students.map((s) => <SelectItem key={s.id} value={`s:${s.id}`}>{s.name}</SelectItem>)}
              {groups.map((g) => <SelectItem key={g.id} value={`g:${g.id}`}>{g.name} (group)</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        {who && (
          <p className="muted">
            {target ? `Opens their lesson on ${shortDate(target.scheduled_at)}; it's due at the one after.` : 'No lesson around now, so it opens as a one-off in Insights.'}
          </p>
        )}
        <div className="row-end">
          <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
          <Button onClick={go} disabled={!who}>Continue</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
