import { useState } from 'react'
import {
  Button, Field, Input, Dialog, DialogContent, DialogTitle, DialogClose,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { dayLabel, timeLabel } from './lessons.ts'
import { proposePeople } from './invitees.ts'
import type { UnmatchedSeries } from './CalendarInbox.tsx'

export interface Who { id: string; name: string; emails?: { email: string; role: 'student' | 'parent' }[] }
export interface GroupWho extends Who { members: Who[] }

/** Who an answer starts out as: someone in the app, or new people (optionally starting from these students). */
export type LinkTarget =
  | { kind: 'student'; id: string }
  | { kind: 'group'; id: string }
  | { kind: 'new'; studentIds?: string[] }

/** Someone the lesson is with: a student already in the app (key = their id), or one to create ('new:N'). */
interface Person { key: string; name: string; isNew: boolean; surname?: string }

const NEW = 'new'
const EVERYONE = '*'
const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name
const surnameOf = (name: string) => name.trim().split(/\s+/).slice(1).join(' ').toLowerCase()
const isNewKey = (key: string) => key.startsWith('new:')

/** Invitees the app already knows, and whose they are. */
function knownEmails(students: Who[]): Map<string, Who> {
  const out = new Map<string, Who>()
  for (const s of students) for (const e of s.emails ?? []) out.set(e.email, s)
  return out
}

/**
 * Who each invitee is, for students already in the app: a student's own
 * address when their first name is in it, a parent when it shares their
 * family name (of everyone, when the whole group does), else nobody.
 */
function guessRoles(attendees: string[], members: Person[]): Record<string, string> {
  const out: Record<string, string> = {}
  attendees.forEach((email, i) => {
    const local = email.split('@')[0].toLowerCase()
    const named = members.find((m) => firstName(m.name).length > 1 && local.includes(firstName(m.name).toLowerCase()))
    const family = members.filter((m) => surnameOf(m.name).length > 1 && local.includes(surnameOf(m.name)))
    if (named) out[email] = `${named.key}|student`
    else if (members.length === 1) out[email] = `${members[0].key}|${i === 0 ? 'student' : 'parent'}`
    else if (family.length === members.length) out[email] = `${EVERYONE}|parent`
    else if (family.length === 1) out[email] = `${family[0].key}|parent`
    else out[email] = 'none'
  })
  return out
}

/** New people read off the invite, plus any students in the app it already names. */
function proposal(item: UnmatchedSeries, students: Who[], startWith: string[] = []) {
  const known = knownEmails(students)
  const existing = [...new Set([...startWith, ...item.attendees.filter((e) => known.has(e)).map((e) => known.get(e)!.id)])]
    .map((id) => students.find((s) => s.id === id))
    .filter((s): s is Who => !!s)
    .map((s): Person => ({ key: s.id, name: s.name, isNew: false }))
  const unknown = item.attendees.filter((e) => !known.has(e))
  // Students the server already suggested are the whole answer; only guess at new people otherwise.
  const p = startWith.length ? { people: [], parents: unknown } : proposePeople(item.title, unknown)
  const fresh = p.people.map((x, i): Person => ({ key: `new:${i}`, name: x.name, isNew: true, surname: x.surname }))
  const people = [...existing, ...fresh]
  const roles: Record<string, string> = guessRoles(unknown, existing)
  p.people.forEach((x, i) => { if (x.email) roles[x.email] = `new:${i}|student` })
  for (const e of p.parents) if (!startWith.length || roles[e] === 'none') roles[e] = people.length > 1 ? `${EVERYONE}|parent` : `${people[0]?.key}|parent`
  const groupName = people.length > 1
    ? startWith.length ? people.map((m) => firstName(m.name)).join(' + ') : item.title.trim()
    : ''
  return { people, roles, groupName }
}

/**
 * Link an unmatched calendar event to who it's with, and fill in what the
 * invite didn't say: new students' names, a new group, and which invitees
 * are students or parents. Saving the addresses is what makes the next
 * invite with them land by itself.
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
  const start = initial.kind === 'new' ? proposal(item, students, initial.studentIds) : null
  const [choice, setChoice] = useState(initial.kind === 'student' ? `s:${initial.id}` : initial.kind === 'group' ? `g:${initial.id}` : NEW)
  const [people, setPeople] = useState<Person[]>(start?.people ?? [])
  const [groupName, setGroupName] = useState(start?.groupName ?? '')
  const [roles, setRoles] = useState<Record<string, string>>(() => start?.roles ?? guessRoles(item.attendees, membersOf(choice)))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const known = knownEmails(students)

  function membersOf(c: string): Person[] {
    if (c.startsWith('s:')) return students.filter((s) => s.id === c.slice(2)).map((s) => ({ key: s.id, name: s.name, isNew: false }))
    if (c.startsWith('g:')) return (groups.find((g) => g.id === c.slice(2))?.members ?? []).map((s) => ({ key: s.id, name: s.name, isNew: false }))
    return people
  }
  const members = membersOf(choice)

  function choose(value: string) {
    setChoice(value)
    if (value === NEW) {
      const p = proposal(item, students)
      setPeople(p.people); setGroupName(p.groupName); setRoles(p.roles)
    } else {
      setRoles(guessRoles(item.attendees.filter((e) => !known.has(e)), membersOf(value)))
    }
  }

  let nextKey = people.reduce((n, p) => Math.max(n, isNewKey(p.key) ? Number(p.key.slice(4)) + 1 : n), 0)
  function setPeopleAndGroup(next: Person[]) {
    if (next.length > 1 && people.length <= 1 && !groupName) setGroupName(next.map((m) => firstName(m.name)).filter(Boolean).join(' + ') || item.title)
    setPeople(next)
    // Anything that pointed at someone no longer here goes back to "someone else".
    setRoles((r) => Object.fromEntries(Object.entries(r).map(([e, v]) => {
      const key = v.split('|')[0]
      if (key === EVERYONE) return [e, next.length > 1 ? v : next[0] ? `${next[0].key}|parent` : 'none']
      return [e, v === 'none' || next.some((m) => m.key === key) ? v : 'none']
    })))
  }

  const label = choice.startsWith('s:') ? students.find((s) => `s:${s.id}` === choice)?.name ?? ''
    : choice.startsWith('g:') ? groups.find((g) => `g:${g.id}` === choice)?.name ?? ''
      : people.length > 1 ? groupName.trim() : people[0]?.name.trim() ?? ''

  async function save() {
    if (choice === NEW) {
      if (!people.length) return setError('Add who the lesson is with.')
      if (people.some((p) => p.isNew && !p.name.trim())) return setError('Give each new student a name.')
      if (people.length > 1 && !groupName.trim()) return setError('Give the group a name.')
    }
    setSaving(true)
    setError('')
    // "Omar" typed under "First name (Haddad family)" is Omar Haddad.
    const nameOf = (p: Person) => (p.surname && !/\s/.test(p.name.trim()) ? `${p.name.trim()} ${p.surname}` : p.name.trim())
    // Each address goes to its person; a new person's go along with them.
    const ownEmails = new Map<string, { email: string; role: string }[]>()
    const emails: { email: string; role: string; studentId?: string }[] = []
    for (const [email, v] of Object.entries(roles)) {
      if (v === 'none' || known.has(email)) continue
      const [key, role] = v.split('|')
      if (isNewKey(key) && people.length > 1) ownEmails.set(key, [...(ownEmails.get(key) ?? []), { email, role }])
      else emails.push({ email, role, ...(isNewKey(key) ? {} : { studentId: key }) })
    }
    const who = choice.startsWith('s:') ? { studentId: choice.slice(2) }
      : choice.startsWith('g:') ? { groupId: choice.slice(2) }
        : people.length === 1
          ? people[0].isNew ? { newStudent: { name: nameOf(people[0]) } } : { studentId: people[0].key }
          : {
              newGroup: {
                name: groupName.trim(),
                studentIds: people.filter((p) => !p.isNew).map((p) => p.key),
                newStudents: people.filter((p) => p.isNew).map((p) => ({ name: nameOf(p), emails: ownEmails.get(p.key) ?? [] })),
              },
            }
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

  const others = students.filter((s) => !people.some((p) => p.key === s.id))
  const display = (m: Person, i: number) => m.name.trim() || `Student ${i + 1}`

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent onInteractOutside={(e) => e.preventDefault()}>
        <DialogTitle>{item.title || 'Untitled event'}</DialogTitle>
        <p className="muted">
          {dayLabel(item.next)}, {timeLabel(item.next)}
          {item.count > 1 && ` · ${item.count} times in the next 4 weeks`}
        </p>

        <Field label="A lesson with">
          <Select value={choice} onValueChange={choose}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NEW}>
                {choice === NEW && people.length > 1 ? `New group: ${groupName || 'these students'}` : 'New student or group'}
              </SelectItem>
              {students.map((s) => <SelectItem key={s.id} value={`s:${s.id}`}>{s.name}</SelectItem>)}
              {groups.map((g) => <SelectItem key={g.id} value={`g:${g.id}`}>{g.name} (group)</SelectItem>)}
            </SelectContent>
          </Select>
        </Field>

        {choice === NEW && (
          <>
            {people.length > 1 && (
              <Field label="Group name">
                <Input value={groupName} onChange={(e) => setGroupName(e.target.value)} />
              </Field>
            )}
            <div className="people-list">
              <div className="list-row-title">{people.length > 1 ? 'Students' : 'Student'}</div>
              {people.map((m, i) => (
                <div key={m.key} className="person-row">
                  {m.isNew ? (
                    <Input value={m.name} autoFocus={i === people.findIndex((p) => p.isNew && !p.name)}
                      placeholder={m.surname ? `First name (${m.surname} family)` : "Student's name"}
                      onChange={(e) => setPeople(people.map((p) => (p.key === m.key ? { ...p, name: e.target.value } : p)))} />
                  ) : (
                    <span className="person-existing">{m.name}</span>
                  )}
                  {people.length > 1 && (
                    <Button variant="ghost" aria-label={`Remove ${display(m, i)}`}
                      onClick={() => setPeopleAndGroup(people.filter((p) => p.key !== m.key))}>×</Button>
                  )}
                </div>
              ))}
              <div className="person-add">
                <Button variant="ghost" onClick={() => setPeopleAndGroup([...people, { key: `new:${nextKey++}`, name: '', isNew: true }])}>
                  + New student
                </Button>
                {others.length > 0 && (
                  <Select value="" onValueChange={(id) => {
                    const s = students.find((x) => x.id === id)
                    if (s) setPeopleAndGroup([...people, { key: s.id, name: s.name, isNew: false }])
                  }}>
                    <SelectTrigger><SelectValue placeholder="+ Someone already here" /></SelectTrigger>
                    <SelectContent>
                      {others.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
              </div>
            </div>
          </>
        )}

        {item.attendees.length > 0 && (
          <div className="invitees">
            <div className="list-row-title">Who's on the invite</div>
            <p className="muted">Saved addresses are recognised next time, so their invites land by themselves.</p>
            {item.attendees.map((email) => (
              <div key={email} className="invitee-row">
                <span className="invitee-email">{email}</span>
                {known.has(email) ? (
                  <span className="muted">{firstName(known.get(email)!.name)}'s, saved</span>
                ) : (
                  <select value={roles[email] ?? 'none'} onChange={(e) => setRoles({ ...roles, [email]: e.target.value })}>
                    {members.map((m, i) => (
                      <optgroup key={m.key} label={display(m, i)}>
                        <option value={`${m.key}|student`}>{firstName(display(m, i))}'s own (13+)</option>
                        <option value={`${m.key}|parent`}>{firstName(display(m, i))}'s parent</option>
                      </optgroup>
                    ))}
                    {members.length > 1 && <option value={`${EVERYONE}|parent`}>Parent of all of them</option>}
                    <option value="none">Someone else</option>
                  </select>
                )}
              </div>
            ))}
          </div>
        )}

        {error && <p className="field-error">{error}</p>}
        <div className="row-end">
          <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Adding…' : `Add ${item.count} lesson${item.count === 1 ? '' : 's'}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
