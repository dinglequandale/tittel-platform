import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Button, Field, Input, Dialog, DialogContent, DialogTitle, DialogClose,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { useOrg } from '../lib/useOrg.ts'

interface Who { id: string; name: string }

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** The next free-looking slot: the coming whole hour, or 4 pm tomorrow when it's late. */
function nextSlot(): { date: string; time: string } {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  d.setHours(d.getHours() + 1)
  if (d.getHours() >= 21 || d.getHours() < 8) {
    if (d.getHours() >= 21) d.setDate(d.getDate() + 1)
    d.setHours(16)
  }
  return { date: localDate(d), time: `${String(d.getHours()).padStart(2, '0')}:00` }
}

/** The hour that has just started: when a lesson being logged most likely began. */
function thisHour(): { date: string; time: string } {
  const d = new Date()
  d.setMinutes(0, 0, 0)
  if (d.getHours() < 8) { d.setDate(d.getDate() - 1); d.setHours(16) }
  return { date: localDate(d), time: `${String(d.getHours()).padStart(2, '0')}:00` }
}

// Schedules a lesson (optionally every week) and goes straight to it, since
// the next thing a tutor does with a new lesson is prepare it. In "log" mode
// it records a lesson that already happened (in person, or booked ad hoc),
// with notes, so it's on the student's record and in Hours.
export function ScheduleLessonDialog({
  open, onOpenChange, defaultWho, mode = 'schedule',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** "s:<studentId>" or "g:<groupId>" to preselect. */
  defaultWho?: string
  mode?: 'schedule' | 'log'
}) {
  const navigate = useNavigate()
  const org = useOrg()
  const logging = mode === 'log'
  const [notes, setNotes] = useState('')
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
    setNotes('')
    const slot = logging ? thisHour() : nextSlot()
    setDate(slot.date)
    setTime(slot.time)
    Promise.all([apiFetch('/api/tutor/students'), apiFetch('/api/tutor/groups')])
      .then(([s, g]) => { setStudents(s.students); setGroups(g.groups) })
      .catch((err) => setError((err as Error).message))
  }, [open, defaultWho, logging])

  // Tutors who book as needed rarely want a weekly series.
  useEffect(() => { if (open && org) setWeekly(org.schedule === 'regular') }, [open, org])

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
          repeatWeekly: !logging && weekly,
          tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
          meetingUrl: (!logging && meetingUrl.trim()) || undefined,
        }),
      })
      if (logging && notes.trim()) {
        await apiFetch(`/api/tutor/sessions/${lesson.id}`, { method: 'PATCH', body: JSON.stringify({ notes: notes.trim() }) })
      }
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
        <DialogTitle>{logging ? 'Log a lesson' : 'Schedule a lesson'}</DialogTitle>
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
            {logging ? (
              <Field label="Notes (optional)">
                <textarea className="input" rows={4} value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="What you covered, how it went, what's next. Only you see these." />
              </Field>
            ) : (
              <>
                <label className="check-row">
                  <input type="checkbox" checked={weekly} onChange={(e) => setWeekly(e.target.checked)} />
                  Every week at this time
                </label>
                {org?.teachWhere !== 'in_person' && (
                  <Field label="Meeting link (optional)">
                    <Input value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)}
                      placeholder="Leave blank to use the student's or your default link" />
                  </Field>
                )}
              </>
            )}
          </>
        )}
        {error && <p className="field-error">{error}</p>}
        <div className="row-end">
          <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
          {!nobody && (
            <Button onClick={submit} disabled={!who || saving}>
              {saving ? 'Saving…' : logging ? 'Save lesson' : 'Schedule'}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
