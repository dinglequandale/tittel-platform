import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Button, Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { useToast } from '../lib/toast.tsx'
import { dayLabel, timeLabel } from './lessons.ts'

export interface UnmatchedSeries {
  uid: string
  title: string
  next: string
  count: number
  attendees: string[]
  suggestion: { studentId: string; name: string } | null
}
export interface CalendarStatus {
  connected: boolean
  feed?: string
  lastSync?: { at: string; ok: boolean; error?: string; imported: number; unmatched: UnmatchedSeries[] }
}

interface Who { id: string; name: string }

// "Who is this?" for calendar events the importer couldn't place by email
// (FLOW-SPEC §2.1). One answer covers every week of a recurring event, and
// can teach the importer the attendee's email for next time.
export function CalendarInbox({ status, onChanged }: { status: CalendarStatus | null; onChanged: () => void }) {
  const toast = useToast()
  const [students, setStudents] = useState<Who[]>([])
  const [groups, setGroups] = useState<Who[]>([])
  const unmatched = status?.lastSync?.unmatched ?? []

  useEffect(() => {
    if (!unmatched.length) return
    Promise.all([apiFetch('/api/tutor/students'), apiFetch('/api/tutor/groups')])
      .then(([s, g]) => { setStudents(s.students); setGroups(g.groups) })
      .catch(() => {})
  }, [unmatched.length])

  if (!status) return null
  if (!status.connected) {
    return (
      <div className="surface-card calendar-prompt">
        <div>
          <div className="list-row-title">Bring in your Google Calendar</div>
          <div className="list-row-sub">Your lessons appear here by themselves, with their Meet links.</div>
        </div>
        <Link to="/app/settings#calendar" className="card-link">Connect</Link>
      </div>
    )
  }

  const error = status.lastSync && !status.lastSync.ok ? status.lastSync.error : null
  if (!unmatched.length && !error) return null

  async function link(uid: string, body: Record<string, unknown>) {
    try {
      await apiFetch('/api/tutor/calendar/links', { method: 'POST', body: JSON.stringify({ uid, ...body }) })
      onChanged()
    } catch (err) {
      toast((err as Error).message)
    }
  }

  return (
    <section className="week-day">
      <h2 className="week-day-title">From your calendar</h2>
      {error && <p className="field-error">Couldn't reach your calendar: {error}</p>}
      {unmatched.length > 0 && (
        <div className="surface-card card-pad-x">
          {unmatched.map((u) => (
            <InboxRow key={u.uid} item={u} students={students} groups={groups} onLink={(body) => link(u.uid, body)} />
          ))}
        </div>
      )}
    </section>
  )
}

function InboxRow({
  item, students, groups, onLink,
}: {
  item: UnmatchedSeries
  students: Who[]
  groups: Who[]
  onLink: (body: Record<string, unknown>) => void
}) {
  const guest = item.attendees.length === 1 ? item.attendees[0] : null
  const [remember, setRemember] = useState<'' | 'student' | 'parent'>(guest ? 'student' : '')

  function pick(value: string) {
    const [kind, id] = [value.slice(0, 1), value.slice(2)]
    if (kind === 'g') return onLink({ groupId: id })
    onLink({ studentId: id, ...(guest && remember ? { rememberEmail: { email: guest, as: remember } } : {}) })
  }

  return (
    <div className="list-row inbox-row">
      <div className="inbox-row-main">
        <div className="list-row-title">{item.title || 'Untitled event'}</div>
        <div className="list-row-sub">
          {dayLabel(item.next)}, {timeLabel(item.next)}
          {item.count > 1 && ` · and ${item.count - 1} more in the next 4 weeks`}
          {guest && ` · with ${guest}`}
        </div>
        {guest && (
          <label className="check-row inbox-remember">
            <input type="checkbox" checked={!!remember} onChange={(e) => setRemember(e.target.checked ? 'student' : '')} />
            Recognise {guest} next time, as the
            <select value={remember || 'student'} disabled={!remember}
              onChange={(e) => setRemember(e.target.value as 'student' | 'parent')}>
              <option value="student">student's email</option>
              <option value="parent">parent's email</option>
            </select>
          </label>
        )}
      </div>
      <div className="slot-actions">
        {item.suggestion && (
          <Button variant="secondary" onClick={() => pick(`s:${item.suggestion!.studentId}`)}>
            It's {item.suggestion.name}
          </Button>
        )}
        <Select value="" onValueChange={pick}>
          <SelectTrigger><SelectValue placeholder="Who is this?" /></SelectTrigger>
          <SelectContent>
            {students.map((s) => <SelectItem key={s.id} value={`s:${s.id}`}>{s.name}</SelectItem>)}
            {groups.map((g) => <SelectItem key={g.id} value={`g:${g.id}`}>{g.name} (group)</SelectItem>)}
          </SelectContent>
        </Select>
        <Button variant="ghost" onClick={() => onLink({ ignore: true })}>Not a lesson</Button>
      </div>
    </div>
  )
}
