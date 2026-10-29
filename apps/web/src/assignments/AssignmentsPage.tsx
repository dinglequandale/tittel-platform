import { useEffect, useState } from 'react'
import {
  Button, Field, Input, Table, EmptyState, CopyButton, PageLoading, ConfirmDialog,
  Dialog, DialogTrigger, DialogContent, DialogTitle, DialogClose,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { useToast } from '../lib/toast.tsx'
import { shortDate } from '../lessons/lessons.ts'

function attemptUrl(token: string): string {
  return `${window.location.origin}/hw/${token}`
}

interface AssignmentSummary {
  id: string
  title: string | null
  set_title: string
  time_limit_sec: number | null
  due_at: string | null
  assigned: number
  submitted: number
  created_at: string
}

interface Student { id: string; name: string }
interface ProblemSetOption { id: string; title: string }

interface Link { studentId: string; studentName: string; attemptToken: string; status?: string }

interface Analytics {
  title: string | null
  setTitle: string
  assigned: number
  submitted: number
  frqCount: number
  perProblem: { problemId: string; ordinal: number; attempts: number; answered: number; correct: number; pctCorrect: number | null }[]
  perStudent: { studentName: string; status: string; score: number; total: number }[]
}

export function AssignmentsPage() {
  const toast = useToast()
  const [assignments, setAssignments] = useState<AssignmentSummary[] | null>(null)
  const [sets, setSets] = useState<ProblemSetOption[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [links, setLinks] = useState<Link[] | null>(null)
  const [analyticsFor, setAnalyticsFor] = useState<string | null>(null)
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [error, setError] = useState('')
  const [archiveTarget, setArchiveTarget] = useState<AssignmentSummary | null>(null)

  async function reload() {
    const [a, s, st] = await Promise.all([
      apiFetch('/api/tutor/assignments'),
      apiFetch('/api/tutor/problem-sets'),
      apiFetch('/api/tutor/students'),
    ])
    setAssignments(a.assignments)
    setSets(s.problemSets)
    setStudents(st.students)
  }

  useEffect(() => { reload() }, [])

  async function create(body: { setId: string; title: string; timeLimitSec?: number; dueAt?: string; studentIds: string[] }) {
    setError('')
    try {
      const result = await apiFetch('/api/tutor/assignments', { method: 'POST', body: JSON.stringify(body) })
      setLinks(result.links)
      await reload()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function archive(id: string) {
    try {
      await apiFetch(`/api/tutor/assignments/${id}`, { method: 'DELETE' })
      if (analyticsFor === id) { setAnalyticsFor(null); setAnalytics(null) }
      await reload()
    } catch (err) {
      toast((err as Error).message)
    }
  }

  async function viewAnalytics(id: string) {
    setAnalyticsFor(id)
    try {
      const data = await apiFetch(`/api/tutor/assignments/${id}/analytics`)
      setAnalytics(data)
    } catch (err) {
      toast((err as Error).message)
    }
  }

  async function viewLinks(id: string) {
    try {
      const data = await apiFetch(`/api/tutor/assignments/${id}/links`)
      setLinks(data.links)
    } catch (err) {
      toast((err as Error).message)
    }
  }

  return (
    <div className="screen">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 18 }}>
        <NewAssignmentDialog sets={sets} students={students} onCreate={create} />
      </div>
      {error && <p className="field-error">{error}</p>}

      {assignments === null ? (
        <PageLoading />
      ) : assignments.length === 0 ? (
        <EmptyState title="No homework yet" description="Give homework from a lesson, or set a one-off here." />
      ) : (
        <div className="surface-card">
          {assignments.map((a) => {
            const pct = a.assigned ? Math.round((a.submitted / a.assigned) * 100) : 0
            return (
              <div key={a.id} className="data-row" style={{ gap: 20 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 4 }}>
                    {a.title || a.set_title}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
                    {a.set_title} · {a.assigned} student{a.assigned === 1 ? '' : 's'}
                    {' · '}{a.time_limit_sec ? `${Math.round(a.time_limit_sec / 60)} min` : 'Untimed'}
                    {a.due_at ? ` · Due ${shortDate(a.due_at)}` : ''}
                  </div>
                </div>
                <div style={{ width: 160 }}>
                  <div className="progress"><i style={{ width: `${pct}%` }} /></div>
                  <div style={{ fontSize: 11.5, color: 'var(--ink-3)', textAlign: 'right', marginTop: 6 }}>
                    {a.submitted}/{a.assigned} submitted
                  </div>
                </div>
                <div style={{ display: 'flex', gap: '0.375rem' }}>
                  <Button variant="ghost" onClick={() => viewLinks(a.id)}>Links</Button>
                  <Button variant="ghost" onClick={() => viewAnalytics(a.id)}>Analytics</Button>
                  <Button variant="ghost" onClick={() => setArchiveTarget(a)}>Archive</Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {analyticsFor && analytics && (
        <div className="editor-card" style={{ marginTop: '1.5rem' }}>
          <strong>{analytics.title || analytics.setTitle}</strong>
          <p className="muted">
            {analytics.submitted} / {analytics.assigned} submitted
            {analytics.frqCount > 0 && ` · ${analytics.frqCount} free-response question${analytics.frqCount === 1 ? '' : 's'} not auto-graded`}
          </p>

          <h3 style={{ fontSize: '1rem' }}>By problem</h3>
          <Table>
            <thead><tr><th>#</th><th>Attempts</th><th>Correct</th><th>% correct</th></tr></thead>
            <tbody>
              {analytics.perProblem.map((p, i) => (
                <tr key={p.problemId}>
                  <td>{i + 1}</td>
                  <td>{p.attempts}</td>
                  <td>{p.correct}</td>
                  <td>{p.pctCorrect != null ? `${Math.round(p.pctCorrect * 100)}%` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>

          <h3 style={{ fontSize: '1rem' }}>By student</h3>
          <Table>
            <thead><tr><th>Student</th><th>Status</th><th>Score</th></tr></thead>
            <tbody>
              {analytics.perStudent.map((s, i) => (
                <tr key={i}><td>{s.studentName}</td><td>{s.status}</td><td>{s.score} / {s.total}</td></tr>
              ))}
            </tbody>
          </Table>
        </div>
      )}

      <Dialog open={!!links} onOpenChange={(open) => !open && setLinks(null)}>
        <DialogContent>
          <DialogTitle>Student links</DialogTitle>
          <p className="muted">Share each student's link — it's their whole way in, no login required.</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {links?.map((l) => (
              <div key={l.studentId} className="set-problem-row">
                <span>{l.studentName}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                  <code>{attemptUrl(l.attemptToken)}</code>
                  <CopyButton text={attemptUrl(l.attemptToken)} />
                </div>
              </div>
            ))}
          </div>
          <DialogClose asChild><Button style={{ alignSelf: 'flex-end' }}>Done</Button></DialogClose>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title={`Archive ${archiveTarget?.title || 'this assignment'}?`}
        description="Students lose access to it."
        confirmLabel="Archive"
        onConfirm={() => archiveTarget && archive(archiveTarget.id)}
      />
    </div>
  )
}

function NewAssignmentDialog({
  sets, students, onCreate,
}: {
  sets: ProblemSetOption[]
  students: Student[]
  onCreate: (body: { setId: string; title: string; timeLimitSec?: number; dueAt?: string; studentIds: string[] }) => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [setId, setSetId] = useState('')
  const [untimed, setUntimed] = useState(true)
  const [minutes, setMinutes] = useState('15')
  const [dueAt, setDueAt] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [saving, setSaving] = useState(false)

  function toggleStudent(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  // A blank or zero field used to become a 1-second time limit.
  const minutesValid = untimed || Number(minutes) >= 1
  const canCreate = !!setId && selected.length > 0 && minutesValid && !saving

  async function submit() {
    if (!canCreate) return
    setSaving(true)
    try {
      await onCreate({
        setId,
        title: title.trim(),
        timeLimitSec: untimed ? undefined : Math.round(Number(minutes) * 60),
        // The date picker gives a bare "YYYY-MM-DD", which the server reads as
        // UTC midnight: the evening before, anywhere west of UTC. Due means the
        // end of that day where the tutor is.
        dueAt: dueAt ? new Date(`${dueAt}T23:59:59`).toISOString() : undefined,
        studentIds: selected,
      })
      setTitle(''); setSetId(''); setSelected([]); setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>New homework</Button></DialogTrigger>
      <DialogContent>
        <DialogTitle>New homework</DialogTitle>
        <p className="muted">For homework that isn't tied to a lesson. Homework given from a lesson is due at the next one.</p>
        <Field label="Title (optional)"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Problem set">
          {sets.length === 0 ? (
            <p className="muted">No problem sets yet. Give homework from a lesson (drop a worksheet or paste problems), or make a set in Library → Problem sets.</p>
          ) : (
            <Select value={setId} onValueChange={setSetId}>
              <SelectTrigger><SelectValue placeholder="Choose a set…" /></SelectTrigger>
              <SelectContent>
                {sets.map((s) => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </Field>
        <div className="form-row">
          <Field label="Timing">
            <label style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              <input type="checkbox" checked={untimed} onChange={(e) => setUntimed(e.target.checked)} />
              Untimed
            </label>
          </Field>
          {!untimed && (
            <Field label="Minutes"><Input type="number" value={minutes} onChange={(e) => setMinutes(e.target.value)} /></Field>
          )}
          <Field label="Due date (optional)"><Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></Field>
        </div>
        <Field label="Students">
          <div className="tag-pill-row">
            {students.map((s) => (
              <button key={s.id} type="button" className="badge"
                style={{ cursor: 'pointer', opacity: selected.includes(s.id) ? 1 : 0.5 }}
                onClick={() => toggleStudent(s.id)}>
                {s.name}
              </button>
            ))}
            {students.length === 0 && <span className="muted">No students yet.</span>}
          </div>
        </Field>
        <div className="row-end">
          <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
          <Button onClick={submit} disabled={!canCreate}>{saving ? 'Creating…' : 'Create'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
