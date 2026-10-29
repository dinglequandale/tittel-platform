import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Button, Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { useToast } from '../lib/toast.tsx'
import { dayLabel, timeLabel } from './lessons.ts'
import { LinkEventDialog, type GroupWho, type LinkTarget, type Who } from './LinkEventDialog.tsx'
import { proposePeople } from './invitees.ts'

export interface UnmatchedSeries {
  uid: string
  title: string
  next: string
  count: number
  /** Invitees other than the tutor. */
  attendees: string[]
  /** Who it probably is: one student, or several (groupId null = no group of them yet). */
  suggestion: { studentIds: string[]; groupId: string | null; label: string } | null
}
export interface CalendarFilters {
  requireGuest: boolean
  requireVideoLink: boolean
  requireOrganizer: boolean
  keywords: string[]
}
export interface CalendarStatus {
  connected: boolean
  feed?: string
  filters?: CalendarFilters
  lastSync?: {
    at: string; ok: boolean; error?: string; imported: number; filtered: number; unmatched: UnmatchedSeries[]
    /** The series the filters left out (up to 50), to count one in by hand. */
    left_out?: { uid: string; title: string; next: string }[]
  }
}

// "Who is this?" for calendar events the importer couldn't place by email
// (FLOW-SPEC §2.1, §9.2). One answer covers every week of a recurring event.
// When the invite has people the app doesn't know yet, a small dialog,
// already filled in from their addresses and the title, asks who they are,
// so the next invite lands by itself.
export function CalendarInbox({ status, onChanged }: { status: CalendarStatus | null; onChanged: () => void }) {
  const toast = useToast()
  const [students, setStudents] = useState<Who[]>([])
  const [groups, setGroups] = useState<GroupWho[]>([])
  // Answered rows leave at once; the server confirms in the background.
  const [answered, setAnswered] = useState<Set<string>>(new Set())
  const [dialog, setDialog] = useState<{ item: UnmatchedSeries; target: LinkTarget } | null>(null)
  const unmatched = (status?.lastSync?.unmatched ?? []).filter((u) => !answered.has(u.uid))

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
  if (!unmatched.length && !error && !dialog) return null

  const hide = (uid: string) => setAnswered((a) => new Set(a).add(uid))
  const unhide = (uid: string) => setAnswered((a) => { const n = new Set(a); n.delete(uid); return n })

  function linked(uid: string, lessons: number, label: string) {
    hide(uid)
    setDialog(null)
    toast(lessons > 0 ? `Added ${lessons} lesson${lessons === 1 ? '' : 's'} with ${label}` : `Linked to ${label}`)
    onChanged()
  }

  // An existing student or group with nobody new on the invite needs no
  // questions: link straight away. Anything else opens the dialog.
  async function answer(item: UnmatchedSeries, target: LinkTarget) {
    const known = new Set(students.flatMap((s) => (s.emails ?? []).map((e) => e.email)))
    if (item.attendees.some((e) => !known.has(e)) || target.kind === 'new') {
      setDialog({ item, target })
      return
    }
    hide(item.uid)
    try {
      const res = await apiFetch('/api/tutor/calendar/links', {
        method: 'POST',
        body: JSON.stringify({ uid: item.uid, ...(target.kind === 'student' ? { studentId: target.id } : { groupId: target.id }) }),
      })
      const label = target.kind === 'student'
        ? students.find((s) => s.id === target.id)?.name ?? ''
        : groups.find((g) => g.id === target.id)?.name ?? ''
      linked(item.uid, res.linked?.lessons ?? 0, label)
    } catch (err) {
      unhide(item.uid)
      toast((err as Error).message)
    }
  }

  async function notALesson(uid: string) {
    hide(uid)
    try {
      await apiFetch('/api/tutor/calendar/links', { method: 'POST', body: JSON.stringify({ uid, ignore: true }) })
    } catch (err) {
      unhide(uid)
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
            <InboxRow key={u.uid} item={u} students={students} groups={groups}
              onAnswer={(t) => answer(u, t)} onIgnore={() => notALesson(u.uid)} />
          ))}
        </div>
      )}
      {dialog && (
        <LinkEventDialog item={dialog.item} initial={dialog.target} students={students} groups={groups}
          onClose={() => setDialog(null)}
          onLinked={({ lessons, label }) => linked(dialog.item.uid, lessons, label)} />
      )}
    </section>
  )
}

function InboxRow({
  item, students, groups, onAnswer, onIgnore,
}: {
  item: UnmatchedSeries
  students: Who[]
  groups: Who[]
  onAnswer: (target: LinkTarget) => void
  onIgnore: () => void
}) {
  const sg = item.suggestion
  const suggested: LinkTarget | null = !sg ? null
    : sg.groupId ? { kind: 'group', id: sg.groupId }
      : sg.studentIds.length === 1 ? { kind: 'student', id: sg.studentIds[0] }
        : { kind: 'new', studentIds: sg.studentIds }
  // Nobody in the app matches: offer the people the invite itself suggests.
  const known = new Set(students.flatMap((s) => (s.emails ?? []).map((e) => e.email)))
  const proposed = proposePeople(item.title, item.attendees.filter((e) => !known.has(e))).people
  const proposedLabel = proposed.length && proposed.every((p) => p.name)
    ? proposed.length === 1 ? proposed[0].name : `${item.title.trim()} (${proposed.length} new students)`
    : null

  function pick(value: string) {
    if (value === 'new') onAnswer({ kind: 'new' })
    else if (value.startsWith('g:')) onAnswer({ kind: 'group', id: value.slice(2) })
    else onAnswer({ kind: 'student', id: value.slice(2) })
  }

  return (
    <div className="list-row inbox-row">
      <div className="inbox-row-main">
        <div className="list-row-title">{item.title || 'Untitled event'}</div>
        <div className="list-row-sub">
          {dayLabel(item.next)}, {timeLabel(item.next)}
          {item.count > 1 && ` · and ${item.count - 1} more in the next 4 weeks`}
          {item.attendees.length > 0 && ` · with ${item.attendees.join(', ')}`}
        </div>
      </div>
      <div className="slot-actions">
        {suggested && sg ? (
          <Button variant="secondary" onClick={() => onAnswer(suggested)}>
            It's {sg.label}{suggested.kind === 'new' ? ' (new group)' : ''}
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => onAnswer({ kind: 'new' })}>
            {proposedLabel ? `Add ${proposedLabel}…` : 'Who is this?'}
          </Button>
        )}
        <Select value="" onValueChange={pick}>
          <SelectTrigger><SelectValue placeholder={students.length || groups.length ? 'Someone else…' : 'Other…'} /></SelectTrigger>
          <SelectContent>
            {students.map((s) => <SelectItem key={s.id} value={`s:${s.id}`}>{s.name}</SelectItem>)}
            {groups.map((g) => <SelectItem key={g.id} value={`g:${g.id}`}>{g.name} (group)</SelectItem>)}
            <SelectItem value="new">+ New student or group</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="ghost" onClick={onIgnore}>Not a lesson</Button>
      </div>
    </div>
  )
}
