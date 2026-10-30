import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Play, NotebookPen } from 'lucide-react'
import {
  Button, Field, Dialog, DialogContent, DialogTitle, DialogClose,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { useToast } from '../lib/toast.tsx'
import { useOrg, type Org } from '../lib/useOrg.ts'
import { ScheduleLessonDialog } from './ScheduleLessonDialog.tsx'

export interface Who { studentId?: string; groupId?: string; meetingUrl?: string | null }

/**
 * A lesson right now, for tutors who teach as needed: no scheduling first.
 * It's an ordinary one-off lesson starting this minute, so it shows on the
 * student's record and counts in Hours. As with Start, the meeting has to be
 * opened inside the click, before any await, or the browser blocks the tab.
 */
export async function startNow(who: Who, org: Org | null, navigate: (to: string) => void) {
  const link = org?.teachWhere === 'in_person' ? null : (who.meetingUrl || org?.defaultMeetingUrl || null)
  if (link) window.open(link, '_blank', 'noopener')
  const at = new Date()
  at.setSeconds(0, 0)
  const { lesson } = await apiFetch('/api/tutor/sessions', {
    method: 'POST',
    body: JSON.stringify({
      ...(who.studentId ? { studentId: who.studentId } : { groupId: who.groupId }),
      scheduledAt: at.toISOString(),
      durationMin: 60,
      tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  })
  const { boardId } = await apiFetch(`/api/tutor/sessions/${lesson.id}/start`, { method: 'POST', body: '{}' })
  navigate(`/b/${boardId}?lesson=${encodeURIComponent(lesson.id)}`)
}

/** Start now and Log a lesson for one student or group. */
export function QuickLessonButtons({ who, whoKey }: { who: Who; whoKey: string }) {
  const navigate = useNavigate()
  const toast = useToast()
  const org = useOrg()
  const [logging, setLogging] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <div className="toolbar-actions">
      <Button variant="secondary" disabled={busy} onClick={() => {
        setBusy(true)
        startNow(who, org, navigate).catch((err) => { toast((err as Error).message); setBusy(false) })
      }}><Play size={14} strokeWidth={2.2} /> Start now</Button>
      <Button variant="ghost" onClick={() => setLogging(true)}><NotebookPen size={14} strokeWidth={2} /> Log a lesson</Button>
      <ScheduleLessonDialog open={logging} onOpenChange={setLogging} defaultWho={whoKey} mode="log" />
    </div>
  )
}

interface Person { id: string; name: string; meeting_url?: string | null }

/** New ▸ Lesson now: who with, then straight onto their board. */
export function StartNowDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const navigate = useNavigate()
  const toast = useToast()
  const org = useOrg()
  const [students, setStudents] = useState<Person[]>([])
  const [groups, setGroups] = useState<Person[]>([])
  const [who, setWho] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setWho('')
    setBusy(false)
    Promise.all([apiFetch('/api/tutor/students'), apiFetch('/api/tutor/groups')])
      .then(([s, g]) => { setStudents(s.students); setGroups(g.groups) })
      .catch(() => {})
  }, [open])

  function go() {
    const [kind, id] = [who.slice(0, 1), who.slice(2)]
    const target: Who = kind === 's' ? { studentId: id, meetingUrl: students.find((s) => s.id === id)?.meeting_url } : { groupId: id }
    setBusy(true)
    startNow(target, org, (to) => { onOpenChange(false); navigate(to) }).catch((err) => { toast((err as Error).message); setBusy(false) })
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Start a lesson now</DialogTitle>
        <Field label="With">
          <Select value={who} onValueChange={setWho}>
            <SelectTrigger><SelectValue placeholder="Choose a student or group…" /></SelectTrigger>
            <SelectContent>
              {students.map((s) => <SelectItem key={s.id} value={`s:${s.id}`}>{s.name}</SelectItem>)}
              {groups.map((g) => <SelectItem key={g.id} value={`g:${g.id}`}>{g.name} (group)</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>
        <p className="muted">Opens their board{org?.teachWhere === 'in_person' ? '' : ' and your meeting link'}. It's kept as a one-hour lesson from now.</p>
        <div className="row-end">
          <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
          <Button onClick={go} disabled={!who || busy}><Play size={14} strokeWidth={2.2} /> {busy ? 'Starting…' : 'Start'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

/** Home for tutors who teach as needed: everyone, each a click from a lesson. */
export function QuickStudents() {
  const [students, setStudents] = useState<Person[] | null>(null)
  const [groups, setGroups] = useState<Person[]>([])
  useEffect(() => {
    apiFetch('/api/tutor/students').then((r) => setStudents(r.students)).catch(() => setStudents([]))
    apiFetch('/api/tutor/groups').then((r) => setGroups(r.groups)).catch(() => {})
  }, [])
  if (!students || students.length + groups.length === 0) return null
  return (
    <section className="week-day">
      <h2 className="week-day-title">Teach someone now</h2>
      <div className="surface-card card-pad-x quick-list">
        {students.map((s) => (
          <div key={s.id} className="list-row">
            <div className="list-row-title">{s.name}</div>
            <QuickLessonButtons who={{ studentId: s.id, meetingUrl: s.meeting_url }} whoKey={`s:${s.id}`} />
          </div>
        ))}
        {groups.map((g) => (
          <div key={g.id} className="list-row">
            <div className="list-row-title">{g.name} <span className="muted">(group)</span></div>
            <QuickLessonButtons who={{ groupId: g.id }} whoKey={`g:${g.id}`} />
          </div>
        ))}
      </div>
    </section>
  )
}
