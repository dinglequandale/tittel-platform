import { useState } from 'react'
import {
  Button, Field, Input, Dialog, DialogContent, DialogTitle, DialogClose,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { dayLabel, timeLabel } from './lessons.ts'
import type { UnmatchedSeries } from './CalendarInbox.tsx'

export interface Who { id: string; name: string }
export interface GroupWho extends Who { members: Who[] }

export type LinkTarget =
  | { kind: 'student'; id: string }
  | { kind: 'group'; id: string }
  | { kind: 'newStudent' }
  | { kind: 'newGroup'; studentIds: string[] }

const NEW = 'new'
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name

// "Seb Math Class" -> "Seb": a starting guess for a new student's name.
function nameFromTitle(title: string): string {
  const w = title.trim().split(/[\s,+/|:-]+/)[0] ?? ''
  return /^\p{Lu}\p{L}+$/u.test(w) ? w : ''
}

/**
 * Who each invitee is: a student's own address, their parent's, or neither.
 * The first guess uses the name in the address ("maya.chen@…" is Maya's);
 * with one student, the first invitee is taken as the student and the rest
 * as parents, which is how Konrad's invites usually look.
 */
function guessRoles(attendees: string[], members: Who[]): Record<string, string> {
  const out: Record<string, string> = {}
  attendees.forEach((email, i) => {
    const local = email.split('@')[0].toLowerCase()
    const named = members.find((m) => firstName(m.name).length > 1 && local.includes(firstName(m.name).toLowerCase()))
    if (named) out[email] = `${named.id}|student`
    else if (members.length === 1) out[email] = `${members[0].id}|${i === 0 ? 'student' : 'parent'}`
    else out[email] = 'none'
  })
  return out
}

/**
 * Link an unmatched calendar event to who it's with, and fill in what the
 * app couldn't work out from the invite: a new student's name, a new group,
 * and which invitees are students or parents. Saving the addresses is what
 * makes the next invite with them land by itself.
 */
export function LinkEventDialog({
  item, initial, students, groups, onClose, onLinked,
}: {
  item: UnmatchedSeries
  initial: LinkTarget
  students: Who[]
  groups: GroupWho[]
  onClose: () => void
  onLinked: (result: { lessons: number; label: string }) => void
}) {
  const [target, setTarget] = useState<LinkTarget>(initial)
  const [newName, setNewName] = useState(
    initial.kind === 'newGroup'
      ? initial.studentIds.map((id) => firstName(students.find((s) => s.id === id)?.name ?? '')).join(' + ')
      : nameFromTitle(item.title),
  )
  const members: Who[] =
    target.kind === 'student' ? students.filter((s) => s.id === target.id)
      : target.kind === 'group' ? groups.find((g) => g.id === target.id)?.members ?? []
        : target.kind === 'newGroup' ? students.filter((s) => target.studentIds.includes(s.id))
          : [{ id: NEW, name: newName || 'New student' }]
  const [roles, setRoles] = useState<Record<string, string>>(() => guessRoles(item.attendees, members))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  function choose(value: string) {
    const next: LinkTarget = value === NEW ? { kind: 'newStudent' }
      : value.startsWith('g:') ? { kind: 'group', id: value.slice(2) } : { kind: 'student', id: value.slice(2) }
    setTarget(next)
    const nextMembers = next.kind === 'student' ? students.filter((s) => s.id === next.id)
      : next.kind === 'group' ? groups.find((g) => g.id === next.id)?.members ?? [] : [{ id: NEW, name: newName }]
    setRoles(guessRoles(item.attendees, nextMembers))
  }

  const pickerValue = target.kind === 'student' ? `s:${target.id}` : target.kind === 'group' ? `g:${target.id}`
    : target.kind === 'newStudent' ? NEW : 'newGroup'
  const label = target.kind === 'newStudent' || target.kind === 'newGroup' ? newName.trim()
    : target.kind === 'group' ? groups.find((g) => g.id === target.id)?.name ?? ''
      : students.find((s) => s.id === target.id)?.name ?? ''

  async function save() {
    if ((target.kind === 'newStudent' || target.kind === 'newGroup') && !newName.trim()) {
      setError(target.kind === 'newStudent' ? 'Give the student a name.' : 'Give the group a name.')
      return
    }
    setSaving(true)
    setError('')
    const emails = Object.entries(roles)
      .filter(([, v]) => v !== 'none')
      .map(([email, v]) => {
        const [studentId, role] = v.split('|')
        return { email, role, ...(studentId === NEW ? {} : { studentId }) }
      })
    const who = target.kind === 'student' ? { studentId: target.id }
      : target.kind === 'group' ? { groupId: target.id }
        : target.kind === 'newStudent' ? { newStudent: { name: newName.trim() } }
          : { newGroup: { name: newName.trim(), studentIds: target.studentIds } }
    try {
      const res = await apiFetch('/api/tutor/calendar/links', {
        method: 'POST',
        body: JSON.stringify({ uid: item.uid, ...who, emails }),
      })
      onLinked({ lessons: res.linked?.lessons ?? 0, label })
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>{item.title || 'Untitled event'}</DialogTitle>
        <p className="muted">
          {dayLabel(item.next)}, {timeLabel(item.next)}
          {item.count > 1 && ` · ${item.count} times in the next 4 weeks`}
        </p>

        <Field label="A lesson with">
          <Select value={pickerValue} onValueChange={choose}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {target.kind === 'newGroup' && <SelectItem value="newGroup">New group: {newName || 'these students'}</SelectItem>}
              {students.map((s) => <SelectItem key={s.id} value={`s:${s.id}`}>{s.name}</SelectItem>)}
              {groups.map((g) => <SelectItem key={g.id} value={`g:${g.id}`}>{g.name} (group)</SelectItem>)}
              <SelectItem value={NEW}>+ New student</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        {(target.kind === 'newStudent' || target.kind === 'newGroup') && (
          <Field label={target.kind === 'newStudent' ? "Student's name" : 'Group name'}>
            <Input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
          </Field>
        )}

        {item.attendees.length > 0 && (
          <div className="invitees">
            <div className="list-row-title">Who's on the invite</div>
            <p className="muted">Saved addresses are recognised next time, so their invites land by themselves.</p>
            {item.attendees.map((email) => (
              <div key={email} className="invitee-row">
                <span className="invitee-email">{email}</span>
                <select value={roles[email] ?? 'none'} onChange={(e) => setRoles({ ...roles, [email]: e.target.value })}>
                  {members.map((m) => (
                    <optgroup key={m.id} label={m.name}>
                      <option value={`${m.id}|student`}>{firstName(m.name)}'s email</option>
                      <option value={`${m.id}|parent`}>{firstName(m.name)}'s parent</option>
                    </optgroup>
                  ))}
                  <option value="none">Someone else</option>
                </select>
              </div>
            ))}
          </div>
        )}

        {error && <p className="field-error">{error}</p>}
        <div className="row-end">
          <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
          <Button onClick={save} disabled={saving}>{saving ? 'Adding…' : 'Add lessons'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
