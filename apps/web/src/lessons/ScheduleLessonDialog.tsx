import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button, Field, Input, Dialog, DialogContent, DialogTitle, DialogClose,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'

interface Who { id: string; name: string }

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Schedules a lesson (optionally every week) and goes straight to it, since
// the next thing a tutor does with a new lesson is prepare it.
export function ScheduleLessonDialog({
  open, onOpenChange, defaultWho,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** "s:<studentId>" or "g:<groupId>" to preselect. */
  defaultWho?: string
}) {
  const navigate = useNavigate()
  const [students, setStudents] = useState<Who[]>([])
  const [groups, setGroups] = useState<Who[] | null>(null)
  const [who, setWho] = useState(defaultWho ?? '')
  const [date, setDate] = useState(localDate(new Date()))
  const [time, setTime] = useState('16:00')
  const [duration, setDuration] = useState('60')
  const [weekly, setWeekly] = useState(true)
  const [meetingUrl, setMeetingUrl] = useState('')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    setWho(defaultWho ?? '')
    setError('')
    Promise.all([apiFetch('/api/tutor/students'), apiFetch('/api/tutor/groups')])
      .then(([s, g]) => { setStudents(s.students); setGroups(g.groups) })
      .catch((err) => setError((err as Error).message))
  }, [open, defaultWho])

  async function submit() {
    if (!who || !date || !time || saving) return
    setSaving(true)
    setError('')
    try {
      const [kind, id] = [who.slice(0, 1), who.slice(2)]
      const { lesson } = await apiFetch('/api/tutor/sessions', {
        method: 'POST',
        body: JSON.stringify({
          ...(kind === 's' ? { studentId: id } : { groupId: id }),
          scheduledAt: new Date(`${date}T${time}`).toISOString(),
          durationMin: Number(duration),
          repeatWeekly: weekly,
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          meetingUrl: meetingUrl.trim() || undefined,
        }),
      })
      onOpenChange(false)
      navigate(`/app/lessons/${lesson.id}`)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  // groups doubles as the loaded flag, so the empty notice never flashes.
  const nobody = groups !== null && students.length === 0 && groups.length === 0

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Schedule a lesson</DialogTitle>
        {nobody ? (
          <p className="muted">Add a student first. Lessons are always with a student or a group.</p>
        ) : (
          <>
            <Field label="With">
              <Select value={who} onValueChange={setWho}>
                <SelectTrigger><SelectValue placeholder="Choose a student or group…" /></SelectTrigger>
                <SelectContent>
                  {students.map((s) => <SelectItem key={s.id} value={`s:${s.id}`}>{s.name}</SelectItem>)}
                  {(groups ?? []).map((g) => <SelectItem key={g.id} value={`g:${g.id}`}>{g.name} (group)</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <div className="form-row">
              <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
              <Field label="Time"><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
              <Field label="Length">
                <Select value={duration} onValueChange={setDuration}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['30', '45', '60', '90', '120'].map((m) => <SelectItem key={m} value={m}>{m} min</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </div>
            <label className="check-row">
              <input type="checkbox" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} />
              Every week at this time
            </label>
            <Field label="Meeting link (optional)">
              <Input value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)}
                placeholder="Leave blank to use the student's or your default link" />
            </Field>
          </>
        )}
        {error && <p className="field-error">{error}</p>}
        <div className="row-end">
          <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
          {!nobody && (
            <Button onClick={submit} disabled={!who || saving}>{saving ? 'Scheduling…' : 'Schedule'}</Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
