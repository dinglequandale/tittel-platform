import { useEffect, useState } from 'react'
import {
  Button, Field, Input, Table, EmptyState, CopyButton, PageLoading, ConfirmDialog,
  Dialog, DialogTrigger, DialogContent, DialogTitle, DialogClose,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { useToast } from '../lib/toast.tsx'

interface Student {
  id: string
  name: string
  email: string | null
  portal_token: string
  notes: string | null
  created_at: string
}

interface Group {
  id: string
  name: string
  members: { id: string; name: string }[]
}

function portalUrl(token: string): string {
  return `${window.location.origin}/s/${token}`
}

export function StudentsPage() {
  const toast = useToast()
  const [students, setStudents] = useState<Student[] | null>(null)
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState<Student | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<Student | null>(null)
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<Group | null>(null)

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

  async function createStudent(name: string, email: string, notes: string) {
    await apiFetch('/api/tutor/students', {
      method: 'POST',
      body: JSON.stringify({ name, email: email || undefined, notes: notes || undefined }),
    })
    await reload()
  }

  async function updateStudent(id: string, name: string, email: string, notes: string) {
    await apiFetch(`/api/tutor/students/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: name.trim(), email: email.trim() || null, notes: notes.trim() || null }),
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
    <div>
      <div className="page-toolbar">
        <h1>Students</h1>
        <div className="toolbar-actions">
          <NewGroupDialog onCreate={createGroup} />
          <NewStudentDialog onCreate={createStudent} />
        </div>
      </div>

      {error && <p className="field-error">{error}</p>}

      {students === null ? (
        <PageLoading />
      ) : students.length === 0 ? (
        <EmptyState title="No students yet" description="Add your first student to get started." />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Portal link</th>
              <th>Notes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {students.map((s) => (
              <tr key={s.id}>
                <td>{s.name}</td>
                <td>{s.email || <span className="muted">—</span>}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                    <code>{portalUrl(s.portal_token)}</code>
                    <CopyButton text={portalUrl(s.portal_token)} />
                  </div>
                </td>
                <td>{s.notes || <span className="muted">—</span>}</td>
                <td style={{ display: 'flex', gap: '0.375rem' }}>
                  <Button variant="ghost" onClick={() => setEditing(s)}>Edit</Button>
                  <Button variant="ghost" onClick={() => setArchiveTarget(s)}>Archive</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
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

function NewStudentDialog({ onCreate }: { onCreate: (name: string, email: string, notes: string) => Promise<void> }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [notes, setNotes] = useState('')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      await onCreate(name.trim(), email.trim(), notes.trim())
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
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
  onSave: (id: string, name: string, email: string, notes: string) => Promise<void>
}) {
  const toast = useToast()
  const [name, setName] = useState(student.name)
  const [email, setEmail] = useState(student.email ?? '')
  const [notes, setNotes] = useState(student.notes ?? '')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      await onSave(student.id, name, email, notes)
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
        <Field label="Notes (optional)"><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
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
