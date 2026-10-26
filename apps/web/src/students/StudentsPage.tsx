import { useEffect, useState } from 'react'
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
  email: string | null
  parent_email: string | null
  portal_token: string
  notes: string | null
  meeting_url: string | null
  created_at: string
  board_id: string | null
  next_lesson_id: string | null
  next_lesson_at: string | null
}

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
  const [filter, setFilter] = useState<'all' | 'unscheduled'>('all')
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
  async function createStudent(name: string, email: string, notes: string, scheduleNext: boolean) {
    const { student } = await apiFetch('/api/tutor/students', {
      method: 'POST',
      body: JSON.stringify({ name, email: email || undefined, notes: notes || undefined }),
    })
    await reload()
    if (scheduleNext) setScheduleFor(`s:${student.id}`)
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

  async function updateStudent(id: string, name: string, email: string, notes: string, meetingUrl: string, parentEmail: string) {
    await apiFetch(`/api/tutor/students/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        name: name.trim(), email: email.trim() || null, notes: notes.trim() || null, meetingUrl: meetingUrl.trim() || null,
        parentEmail: parentEmail.trim() || null,
      }),
    })
    await reload()
  }

  async function archiveStudent(id: string) {
    try {
      await apiFetch(`/api/tutor/students/${id}`, { method: 'DELETE' })
      await reload()
    } catch (err) {
      toast((err as Error).message)
    }
  }

  async function createGroup(name: string) {
    await apiFetch('/api/tutor/groups', { method: 'POST', body: JSON.stringify({ name }) })
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
        </div>
        <div className="toolbar-actions">
          <NewGroupDialog onCreate={createGroup} />
          <NewStudentDialog onCreate={createStudent} defaultOpen={params.get('new') === '1'}
            onClosed={() => params.has('new') && setParams({}, { replace: true })} />
        </div>
      </div>

      {error && <p className="field-error">{error}</p>}

      {students === null ? (
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
                <span>{s.name}</span>
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
                      onClick={() => removeMember(g.id, m.id)}
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
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title={`Archive ${archiveTarget?.name}?`}
        description="Students lose access to their portal link once archived."
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

function NewStudentDialog({
  onCreate, defaultOpen = false, onClosed,
}: {
  onCreate: (name: string, email: string, notes: string, scheduleNext: boolean) => Promise<void>
  defaultOpen?: boolean
  onClosed?: () => void
}) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [scheduleNext, setScheduleNext] = useState(true)
  const [open, setOpenState] = useState(defaultOpen)
  function setOpen(next: boolean) {
    setOpenState(next)
    if (!next) onClosed?.()
  }
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      await onCreate(name.trim(), email.trim(), notes.trim(), scheduleNext)
      setName(''); setEmail(''); setNotes(''); setOpen(false)
      toast('Student added')
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>New student</Button></DialogTrigger>
      <DialogContent>
        <DialogTitle>New student</DialogTitle>
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Email (optional)"><Input value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Notes (optional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <label className="check-row">
          <input type="checkbox" checked={scheduleNext} onChange={(e) => setScheduleNext(e.target.checked)} />
          Schedule their first lesson next
        </label>
        <div className="row-end">
          <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
          <Button onClick={submit} disabled={saving}>{saving ? 'Creating…' : 'Create'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function EditStudentDialog({
  student, onOpenChange, onSave,
}: {
  student: Student
  onOpenChange: (open: boolean) => void
  onSave: (id: string, name: string, email: string, notes: string, meetingUrl: string, parentEmail: string) => Promise<void>
}) {
  const toast = useToast()
  const [name, setName] = useState(student.name)
  const [email, setEmail] = useState(student.email ?? '')
  const [notes, setNotes] = useState(student.notes ?? '')
  const [meetingUrl, setMeetingUrl] = useState(student.meeting_url ?? '')
  const [parentEmail, setParentEmail] = useState(student.parent_email ?? '')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      await onSave(student.id, name, email, notes, meetingUrl, parentEmail)
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
        <Field label="Email (optional)"><Input value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
        <Field label="Parent's email (optional)">
          <Input value={parentEmail} onChange={(e) => setParentEmail(e.target.value)}
            placeholder="Calendar invites to this address count as this student's lessons" />
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

function NewGroupDialog({ onCreate }: { onCreate: (name: string) => Promise<void> }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      await onCreate(name.trim())
      setName(''); setOpen(false)
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="secondary">New group</Button></DialogTrigger>
      <DialogContent>
        <DialogTitle>New group</DialogTitle>
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <div className="row-end">
          <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
          <Button onClick={submit} disabled={saving}>{saving ? 'Creating…' : 'Create'}</Button>
        </div>
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
    <Select onValueChange={onSelect}>
      <SelectTrigger><SelectValue placeholder="Add student…" /></SelectTrigger>
      <SelectContent>
        {available.map((s) => (
          <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
