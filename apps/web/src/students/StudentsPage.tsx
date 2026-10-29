import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Button, Field, Input, EmptyState, CopyButton, PageLoading, ConfirmDialog,
  Dialog, DialogTrigger, DialogContent, DialogTitle, DialogClose,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem, paletteFor,
} from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { useToast } from '../lib/toast.tsx'
import { ScheduleLessonDialog } from '../lessons/ScheduleLessonDialog.tsx'
import { shortDate, timeLabel } from '../lessons/lessons.ts'

interface Student {
  id: string
  name: string
  emails: StudentEmail[]
  portal_token: string
  notes: string | null
  meeting_url: string | null
  created_at: string
  board_id: string | null
  next_lesson_id: string | null
  next_lesson_at: string | null
}

interface StudentEmail { email: string; role: 'student' | 'parent' }

interface Group {
  id: string
  name: string
  members: { id: string; name: string }[]
  board_id: string | null
}

function portalUrl(token: string): string {
  return `${window.location.origin}/s/${token}`
}

function boardUrl(id: string): string {
  return `${window.location.origin}/b/${id}`
}

export function StudentsPage() {
  const toast = useToast()
  const [students, setStudents] = useState<Student[] | null>(null)
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Student | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<Student | null>(null)
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<Group | null>(null)
  const [filter, setFilter] = useState<'all' | 'unscheduled' | 'archived'>('all')
  const [archived, setArchived] = useState<{ id: string; name: string }[] | null>(null)
  const [removeMemberTarget, setRemoveMemberTarget] = useState<{ group: Group; member: { id: string; name: string } } | null>(null)
  const [scheduleFor, setScheduleFor] = useState<string | null>(null)
  const [params, setParams] = useSearchParams()

  // Which group(s) each student belongs to — the students endpoint doesn't
  // carry this, so join it in from the groups list for the table's Group column.
  const groupOf = new Map<string, string>()
  for (const g of groups ?? []) {
    for (const m of g.members) if (!groupOf.has(m.id)) groupOf.set(m.id, g.name)
  }

  const unscheduled = (students ?? []).filter((s) => !s.next_lesson_id)
  const shown = filter === 'unscheduled' ? unscheduled : (students ?? [])

  async function reload() {
    try {
      const [s, g] = await Promise.all([
        apiFetch('/api/tutor/students'),
        apiFetch('/api/tutor/groups'),
      ])
      setStudents(s.students)
      setGroups(g.groups)
    } catch (err) {
      setError((err as Error).message)
    }
  }

  useEffect(() => {
    reload()
  }, [])

  // Boards now appear by themselves the first time a lesson starts or the
  // student joins, so the natural next step after adding a student is their
  // first lesson.
  async function createStudent(name: string, emails: StudentEmail[], notes: string, scheduleNext: boolean) {
    const { student } = await apiFetch('/api/tutor/students', {
      method: 'POST',
      body: JSON.stringify({ name, emails, notes: notes || undefined }),
    })
    await reload()
    if (scheduleNext) setScheduleFor(`s:${student.id}`)
  }

  async function createStudents(list: NewStudentRow[]) {
    await apiFetch('/api/tutor/students', { method: 'POST', body: JSON.stringify({ students: list }) })
    await reload()
  }

  async function createStudentBoard(id: string) {
    try {
      await apiFetch(`/api/tutor/students/${id}/board`, { method: 'POST' })
      await reload()
    } catch (err) {
      toast((err as Error).message)
    }
  }

  async function createGroupBoard(id: string) {
    try {
      await apiFetch(`/api/tutor/groups/${id}/board`, { method: 'POST' })
      await reload()
    } catch (err) {
      toast((err as Error).message)
    }
  }

  async function updateStudent(id: string, name: string, emails: StudentEmail[], notes: string, meetingUrl: string) {
    await apiFetch(`/api/tutor/students/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: name.trim(), emails: emails.filter((e) => e.email.trim()), notes: notes.trim() || null,
        meetingUrl: meetingUrl.trim() || null,
      }),
    })
    await reload()
  }

  async function loadArchived() {
    try {
      setArchived((await apiFetch('/api/tutor/students/archived')).students)
    } catch (err) {
      toast((err as Error).message)
    }
  }

  async function restoreStudent(id: string) {
    try {
      await apiFetch(`/api/tutor/students/${id}/restore`, { method: 'POST', body: '{}' })
      await Promise.all([reload(), loadArchived()])
    } catch (err) {
      toast((err as Error).message)
    }
  }

  async function archiveStudent(id: string) {
    try {
      await apiFetch(`/api/tutor/students/${id}`, { method: 'DELETE' })
      setArchived(null)
      await reload()
    } catch (err) {
      toast((err as Error).message)
    }
  }

  async function createGroup(group: NewGroup) {
    await apiFetch('/api/tutor/groups', { method: 'POST', body: JSON.stringify(group) })
    await reload()
  }

  async function deleteGroup(id: string) {
    try {
      await apiFetch(`/api/tutor/groups/${id}`, { method: 'DELETE' })
      await reload()
    } catch (err) {
      toast((err as Error).message)
    }
  }

  async function addMember(groupId: string, studentId: string) {
    try {
      await apiFetch(`/api/tutor/groups/${groupId}/members`, {
        method: 'POST',
        body: JSON.stringify({ studentIds: [studentId] }),
      })
      await reload()
    } catch (err) {
      toast((err as Error).message)
    }
  }

  async function removeMember(groupId: string, studentId: string) {
    try {
      await apiFetch(`/api/tutor/groups/${groupId}/members/${studentId}`, { method: 'DELETE' })
      await reload()
    } catch (err) {
      toast((err as Error).message)
    }
  }

  return (
    <div className="screen">
      <div className="page-toolbar">
        <div className="filter-pills">
          <button className="filter-pill" data-active={filter === 'all'} onClick={() => setFilter('all')}>
            All ({students?.length ?? 0})
          </button>
          <button className="filter-pill" data-active={filter === 'unscheduled'} onClick={() => setFilter('unscheduled')}>
            No lesson scheduled ({unscheduled.length})
          </button>
          <button className="filter-pill" data-active={filter === 'archived'} onClick={() => { setFilter('archived'); void loadArchived() }}>
            Archived
          </button>
        </div>
        <div className="toolbar-actions">
          <NewGroupDialog students={students ?? []} onCreate={createGroup} />
          <NewStudentDialog onCreate={createStudent} onCreateMany={createStudents} defaultOpen={params.get('new') === '1'}
            onClosed={() => params.has('new') && setParams({}, { replace: true })} />
        </div>
      </div>

      {error && <p className="field-error">{error}</p>}

      {filter === 'archived' ? (
        archived === null ? <PageLoading /> : archived.length === 0 ? (
          <p className="muted">No archived students.</p>
        ) : (
          <div className="surface-card card-pad-x">
            {archived.map((s) => (
              <div key={s.id} className="list-row">
                <div className="list-row-title">{s.name}</div>
                <Button variant="ghost" onClick={() => restoreStudent(s.id)}>Restore</Button>
              </div>
            ))}
          </div>
        )
      ) : students === null ? (
        <PageLoading />
      ) : students.length === 0 ? (
        <EmptyState title="No students yet" description="Add your first student to get started." />
      ) : (
        <div className="surface-card" style={{ overflow: 'hidden' }}>
          <div className="stu-row stu-head">
            <span>Name</span><span>Group</span><span>Portal</span><span>Board</span><span>Next lesson</span><span />
          </div>
          {shown.map((s) => (
            <div key={s.id} className="stu-row">
              <div className="data-row-name">
                <span className="avatar-sq" data-c={paletteFor(s.id)}>{s.name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()}</span>
                <Link to={`/app/students/${s.id}`} className="card-link">{s.name}</Link>
              </div>
              <span style={{ color: 'var(--ink-2)' }}>{groupOf.get(s.id) || <span className="muted">—</span>}</span>
              <CopyButton text={portalUrl(s.portal_token)} />
              <span>
                {s.board_id ? (
                  <Link to={`/b/${s.board_id}`}><Button variant="ghost">Open board</Button></Link>
                ) : (
                  <Button variant="ghost" onClick={() => createStudentBoard(s.id)}>Create board</Button>
                )}
              </span>
              <span>
                {s.next_lesson_id && s.next_lesson_at ? (
                  <Link to={`/app/lessons/${s.next_lesson_id}`} className="card-link num">
                    {shortDate(s.next_lesson_at)}, {timeLabel(s.next_lesson_at)}
                  </Link>
                ) : (
                  <Button variant="ghost" onClick={() => setScheduleFor(`s:${s.id}`)}>Schedule</Button>
                )}
              </span>
              <div style={{ display: 'flex', gap: '0.25rem', justifyContent: 'flex-end' }}>
                <Button variant="ghost" onClick={() => setEditing(s)}>Edit</Button>
                <Button variant="ghost" onClick={() => setArchiveTarget(s)}>Archive</Button>
              </div>
            </div>
          ))}
        </div>
      )}

      <h2 style={{ marginTop: '2rem', fontFamily: 'var(--font-display)', fontSize: '1.125rem' }}>Groups</h2>
      {groups && groups.length === 0 ? (
        <p className="muted">No groups yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.75rem' }}>
          {groups?.map((g) => (
            <div key={g.id} className="editor-card">
              <div className="page-toolbar" style={{ marginBottom: 0 }}>
                <strong>{g.name}</strong>
                <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
                  <AddMemberSelect
                    students={students ?? []}
                    excludeIds={g.members.map((m) => m.id)}
                    onSelect={(studentId) => addMember(g.id, studentId)}
                  />
                  <Button variant="ghost" onClick={() => setDeleteGroupTarget(g)}>Delete group</Button>
                </div>
              </div>
              <div className="tag-pill-row">
                {g.members.length === 0 && <span className="muted">No members yet.</span>}
                {g.members.map((m) => (
                  <span key={m.id} className="badge">
                    {m.name}{' '}
                    <button
                      className="badge-x"
                      onClick={() => setRemoveMemberTarget({ group: g, member: m })}
                      aria-label={`Remove ${m.name}`}
                      style={{ marginLeft: 4 }}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <div className="muted" style={{ marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                {g.board_id ? (
                  <>
                    <span>Group board:</span>
                    <code>{boardUrl(g.board_id)}</code>
                    <CopyButton text={boardUrl(g.board_id)} />
                    <Link to={`/b/${g.board_id}`}><Button variant="ghost">Open</Button></Link>
                  </>
                ) : (
                  <Button variant="ghost" onClick={() => createGroupBoard(g.id)}>Create group board</Button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {editing && (
        <EditStudentDialog
          student={editing}
          onOpenChange={(open) => !open && setEditing(null)}
          onSave={updateStudent}
        />
      )}

      <ScheduleLessonDialog open={!!scheduleFor} onOpenChange={(open) => !open && setScheduleFor(null)}
        defaultWho={scheduleFor ?? undefined} />

      <ConfirmDialog
        open={!!removeMemberTarget}
        onOpenChange={(open) => !open && setRemoveMemberTarget(null)}
        title={`Take ${removeMemberTarget?.member.name} out of ${removeMemberTarget?.group.name}?`}
        description="They stay in your students; they just won't be in this group's lessons."
        confirmLabel="Take out"
        onConfirm={() => removeMemberTarget && removeMember(removeMemberTarget.group.id, removeMemberTarget.member.id)}
      />

      <ConfirmDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title={`Archive ${archiveTarget?.name}?`}
        description="Their portal link stops working. You can restore them from Archived."
        confirmLabel="Archive"
        onConfirm={() => archiveTarget && archiveStudent(archiveTarget.id)}
      />

      <ConfirmDialog
        open={!!deleteGroupTarget}
        onOpenChange={(open) => !open && setDeleteGroupTarget(null)}
        title={`Delete ${deleteGroupTarget?.name}?`}
        description="This removes the group. Its students are not affected."
        confirmLabel="Delete"
        onConfirm={() => deleteGroupTarget && deleteGroup(deleteGroupTarget.id)}
      />
    </div>
  )
}

interface NewStudentRow { name: string; emails: StudentEmail[] }

// "Leo Park, leo@x.com, grace@x.com" per line (commas, tabs or semicolons, so
// a spreadsheet column pastes too). The address with the student's first name
// in it is theirs, else the first one; the rest are parents'.
function parseStudentList(text: string): NewStudentRow[] {
  return text.split(/\r?\n/).map((line) => {
    const parts = line.split(/[,;\t]+/).map((x) => x.trim()).filter(Boolean)
    const emails = parts.filter((x) => x.includes('@')).map((x) => x.toLowerCase())
    const name = parts.filter((x) => !x.includes('@')).join(' ')
    const first = name.split(/\s+/)[0]?.toLowerCase() ?? ''
    const own = emails.find((e) => first.length > 1 && e.split('@')[0].includes(first)) ?? emails[0]
    return { name, emails: emails.map((email) => ({ email, role: email === own ? 'student' as const : 'parent' as const })) }
  }).filter((r) => r.name)
}

function NewStudentDialog({
  onCreate, onCreateMany, defaultOpen = false, onClosed,
}: {
  onCreate: (name: string, emails: StudentEmail[], notes: string, scheduleNext: boolean) => Promise<void>
  onCreateMany: (list: NewStudentRow[]) => Promise<void>
  defaultOpen?: boolean
  onClosed?: () => void
}) {
  const toast = useToast()
  // Parent by default: a student's own address is only for 13 and over.
  const blank: StudentEmail[] = [{ email: '', role: 'parent' }]
  const [name, setName] = useState('')
  const [emails, setEmails] = useState<StudentEmail[]>(blank)
  const [notes, setNotes] = useState('')
  const [scheduleNext, setScheduleNext] = useState(true)
  const [pasting, setPasting] = useState(false)
  const [pasted, setPasted] = useState('')
  const [open, setOpenState] = useState(defaultOpen)
  const nameRef = useRef<HTMLInputElement>(null)
  function reset() {
    setName(''); setEmails(blank); setNotes(''); setPasted(''); setPasting(false)
  }
  function setOpen(next: boolean) {
    setOpenState(next)
    if (!next) { reset(); onClosed?.() }
  }
  const [saving, setSaving] = useState(false)
  const dirty = !!(name.trim() || notes.trim() || pasted.trim() || emails.some((e) => e.email.trim()))
  const list = pasting ? parseStudentList(pasted) : []

  // "Save & add another" keeps the dialog open for the next one.
  async function submit(another: boolean) {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      await onCreate(name.trim(), emails.filter((e) => e.email.trim()), notes.trim(), scheduleNext && !another)
      toast(`Added ${name.trim()}`)
      if (another) { reset(); nameRef.current?.focus() } else setOpen(false)
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function submitMany() {
    if (!list.length || saving) return
    setSaving(true)
    try {
      await onCreateMany(list)
      toast(`Added ${list.length} student${list.length === 1 ? '' : 's'}`)
      setOpen(false)
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>New student</Button></DialogTrigger>
      {/* A stray click outside mustn't throw away what's been typed. */}
      <DialogContent onInteractOutside={(e) => dirty && e.preventDefault()}>
        <DialogTitle>{pasting ? 'Add several students' : 'New student'}</DialogTitle>
        {pasting ? (
          <>
            <Field label="One student per line" hint="Name, then their email and any parent emails.">
              <textarea className="input" rows={6} autoFocus value={pasted} onChange={(e) => setPasted(e.target.value)}
                placeholder={'Leo Park, leo.park09@gmail.com, grace.park@gmail.com\nAva Nguyen, ava.nguyen@gmail.com\nIsabel Ruiz'} />
            </Field>
            {list.length > 0 && (
              <div className="paste-preview">
                {list.map((r, i) => (
                  <div key={i} className="paste-row">
                    <strong>{r.name}</strong>
                    <span className="muted">
                      {r.emails.length ? r.emails.map((e) => `${e.email} (${e.role === 'student' ? 'student' : 'parent'})`).join(', ') : 'no email'}
                    </span>
                  </div>
                ))}
              </div>
            )}
            <div className="row-end">
              <Button variant="ghost" onClick={() => setPasting(false)}>Add one at a time</Button>
              <Button onClick={submitMany} disabled={saving || !list.length}>
                {saving ? 'Adding…' : list.length ? `Add ${list.length} student${list.length === 1 ? '' : 's'}` : 'Add students'}
              </Button>
            </div>
          </>
        ) : (
          <form className="dialog-form" onSubmit={(e) => { e.preventDefault(); void submit(false) }}>
            <Field label="Name"><Input ref={nameRef} autoFocus value={name} placeholder="First name and last initial is enough" onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Emails (optional)">
              <EmailList emails={emails} onChange={setEmails} />
            </Field>
            <Field label="Notes (optional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            <label className="check-row">
              <input type="checkbox" checked={scheduleNext} onChange={(e) => setScheduleNext(e.target.checked)} />
              Schedule their first lesson next
            </label>
            <div className="row-end">
              <Button variant="ghost" type="button" onClick={() => setPasting(true)}>Paste a list</Button>
              <Button variant="secondary" type="button" onClick={() => submit(true)} disabled={saving || !name.trim()}>Save &amp; add another</Button>
              <Button type="submit" disabled={saving || !name.trim()}>{saving ? 'Saving…' : 'Save'}</Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  )
}

function EditStudentDialog({
  student, onOpenChange, onSave,
}: {
  student: Student
  onOpenChange: (open: boolean) => void
  onSave: (id: string, name: string, emails: StudentEmail[], notes: string, meetingUrl: string) => Promise<void>
}) {
  const toast = useToast()
  const [name, setName] = useState(student.name)
  const [emails, setEmails] = useState<StudentEmail[]>(student.emails)
  const [notes, setNotes] = useState(student.notes ?? '')
  const [meetingUrl, setMeetingUrl] = useState(student.meeting_url ?? '')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      await onSave(student.id, name, emails, notes, meetingUrl)
      onOpenChange(false)
      toast('Student updated')
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>Edit student</DialogTitle>
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Emails">
          <EmailList emails={emails} onChange={setEmails} />
        </Field>
        <Field label="Notes (optional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <Field label="Meeting link (optional)">
          <Input value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)}
            placeholder="Their usual Meet or Zoom link; blank uses your default" />
        </Field>
        <div className="row-end">
          <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
          <Button onClick={submit} disabled={saving}>{saving ? 'Saving…' : 'Save changes'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

interface NewGroup { name: string; studentIds: string[]; newStudents: { name: string }[]; parentEmails: string[] }

// A group in one step: pick who's already here, type names for anyone new,
// and (for siblings) the parent email they share.
function NewGroupDialog({ students, onCreate }: { students: Student[]; onCreate: (group: NewGroup) => Promise<void> }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [newNames, setNewNames] = useState<string[]>([])
  const [parentEmail, setParentEmail] = useState('')
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const dirty = !!(name.trim() || picked.size || newNames.some((n) => n.trim()) || parentEmail.trim())
  const shown = students.filter((st) => st.name.toLowerCase().includes(filter.trim().toLowerCase()))
  const count = picked.size + newNames.filter((n) => n.trim()).length

  function close(next: boolean) {
    setOpen(next)
    if (!next) { setName(''); setPicked(new Set()); setNewNames([]); setParentEmail(''); setFilter('') }
  }

  async function submit() {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      await onCreate({
        name: name.trim(),
        studentIds: [...picked],
        newStudents: newNames.filter((n) => n.trim()).map((n) => ({ name: n.trim() })),
        parentEmails: parentEmail.trim() ? [parentEmail.trim()] : [],
      })
      toast(`Created ${name.trim()}`)
      close(false)
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogTrigger asChild><Button variant="secondary">New group</Button></DialogTrigger>
      <DialogContent onInteractOutside={(e) => dirty && e.preventDefault()}>
        <DialogTitle>New group</DialogTitle>
        <form className="dialog-form" onSubmit={(e) => { e.preventDefault(); void submit() }}>
          <Field label="Name"><Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Haddad siblings, SAT Sunday group" /></Field>
          <Field label={`Who's in it${count ? ` (${count})` : ''}`}>
            <div className="member-picker">
              {students.length > 8 && (
                <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find a student" />
              )}
              {students.length > 0 && (
                <div className="member-picker-list">
                  {shown.map((st) => (
                    <label key={st.id} className="check-row">
                      <input type="checkbox" checked={picked.has(st.id)} onChange={(e) => {
                        const next = new Set(picked)
                        if (e.target.checked) next.add(st.id); else next.delete(st.id)
                        setPicked(next)
                      }} />
                      {st.name}
                    </label>
                  ))}
                </div>
              )}
              {newNames.map((n, i) => (
                <div key={i} className="email-row">
                  <Input value={n} autoFocus placeholder="New student's name"
                    onChange={(e) => setNewNames(newNames.map((x, j) => (j === i ? e.target.value : x)))} />
                  <span />
                  <Button variant="ghost" type="button" aria-label="Remove" onClick={() => setNewNames(newNames.filter((_, j) => j !== i))}>×</Button>
                </div>
              ))}
              <Button variant="ghost" type="button" onClick={() => setNewNames([...newNames, ''])}>
                + {students.length ? 'Someone new' : 'Add a student'}
              </Button>
            </div>
          </Field>
          <Field label="Parent email for all of them (optional)" hint="For siblings booked through one parent: their invites then land in this group by themselves.">
            <Input type="email" inputMode="email" value={parentEmail} onChange={(e) => setParentEmail(e.target.value)} placeholder="parent@example.com" />
          </Field>
          <div className="row-end">
            <DialogClose asChild><Button variant="ghost" type="button">Cancel</Button></DialogClose>
            <Button type="submit" disabled={saving || !name.trim()}>{saving ? 'Creating…' : 'Create group'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function AddMemberSelect({
  students, excludeIds, onSelect,
}: { students: Student[]; excludeIds: string[]; onSelect: (studentId: string) => void }) {
  const available = students.filter((s) => !excludeIds.includes(s.id))
  if (available.length === 0) return <span className="muted">Everyone's in.</span>
  return (
    <Select value="" onValueChange={onSelect}>
      <SelectTrigger><SelectValue placeholder="Add student…" /></SelectTrigger>
      <SelectContent>
        {available.map((s) => (
          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

// A student's addresses, each theirs or a parent's. Calendar invites to any
// of them are this student's lessons (Settings → Google Calendar).
function EmailList({ emails, onChange }: { emails: StudentEmail[]; onChange: (e: StudentEmail[]) => void }) {
  const set = (i: number, patch: Partial<StudentEmail>) => onChange(emails.map((e, j) => (j === i ? { ...e, ...patch } : e)))
  return (
    <div className="email-list">
      {emails.map((e, i) => (
        <div key={i} className="email-row">
          <Input type="email" inputMode="email" value={e.email} placeholder="name@example.com" onChange={(ev) => set(i, { email: ev.target.value })} />
          <select value={e.role} onChange={(ev) => set(i, { role: ev.target.value as StudentEmail['role'] })}>
            <option value="parent">Parent</option>
            <option value="student">Student's own (13+)</option>
          </select>
          <Button variant="ghost" onClick={() => onChange(emails.filter((_, j) => j !== i))} aria-label={`Remove ${e.email}`}>×</Button>
        </div>
      ))}
      <Button variant="ghost" onClick={() => onChange([...emails, { email: '', role: 'parent' }])}>
        + Add email
      </Button>
      <p className="muted">Calendar invites to any of these count as this student's lessons.</p>
    </div>
  )
}
