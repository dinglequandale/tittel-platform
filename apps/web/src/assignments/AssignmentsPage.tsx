import { useEffect, useState } from 'react'
import {
  Button, Field, Input, Table, EmptyState,
  Dialog, DialogTrigger, DialogContent, DialogTitle, DialogClose,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'

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

interface Link { studentId: string; studentName: string; attemptToken: string }

interface Analytics {
  title: string | null
  setTitle: string
  assigned: number
  submitted: number
  perProblem: { problemId: string; ordinal: number; attempts: number; answered: number; correct: number; pctCorrect: number | null }[]
  perStudent: { studentName: string; status: string; score: number; total: number }[]
}

export function AssignmentsPage() {
  const [assignments, setAssignments] = useState<AssignmentSummary[] | null>(null)
  const [sets, setSets] = useState<ProblemSetOption[]>([])
  const [students, setStudents] = useState<Student[]>([])
  const [links, setLinks] = useState<Link[] | null>(null)
  const [analyticsFor, setAnalyticsFor] = useState<string | null>(null)
  const [analytics, setAnalytics] = useState<Analytics | null>(null)
  const [error, setError] = useState('')

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
    await apiFetch(`/api/tutor/assignments/${id}`, { method: 'DELETE' })
    if (analyticsFor === id) { setAnalyticsFor(null); setAnalytics(null) }
    await reload()
  }

  async function viewAnalytics(id: string) {
    setAnalyticsFor(id)
    const data = await apiFetch(`/api/tutor/assignments/${id}/analytics`)
    setAnalytics(data)
  }

  return (
    <div>
      <div className="page-toolbar">
        <h1>Assignments</h1>
        <NewAssignmentDialog sets={sets} students={students} onCreate={create} />
      </div>
      {error && <p className="field-error">{error}</p>}

      {assignments && assignments.length === 0 ? (
        <EmptyState title="No assignments yet" description="Assign a problem set to one or more students." />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Title</th><th>Set</th><th>Timing</th><th>Due</th><th>Progress</th><th />
            </tr>
          </thead>
          <tbody>
            {assignments?.map((a) => (
              <tr key={a.id}>
                <td>{a.title || <span className="muted">Untitled</span>}</td>
                <td>{a.set_title}</td>
                <td>{a.time_limit_sec ? `${Math.round(a.time_limit_sec / 60)} min` : 'Untimed'}</td>
                <td>{a.due_at ? new Date(a.due_at).toLocaleDateString() : <span className="muted">—</span>}</td>
                <td>{a.submitted} / {a.assigned} submitted</td>
                <td style={{ display: 'flex', gap: '0.375rem' }}>
                  <Button variant="ghost" onClick={() => viewAnalytics(a.id)}>Analytics</Button>
                  <Button variant="ghost" onClick={() => archive(a.id)}>Archive</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}

      {analyticsFor && analytics && (
        <div className="editor-card" style={{ marginTop: '1.5rem' }}>
          <strong>{analytics.title || 'Untitled'} — {analytics.setTitle}</strong>
          <p className="muted">{analytics.submitted} / {analytics.assigned} submitted</p>

          <h3 style={{ fontSize: '1rem' }}>By problem</h3>
          <Table>
            <thead><tr><th>#</th><th>Attempts</th><th>Correct</th><th>% correct</th></tr></thead>
            <tbody>
              {analytics.perProblem.map((p) => (
                <tr key={p.problemId}>
                  <td>{p.ordinal + 1}</td>
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
                <code>/hw/{l.attemptToken}</code>
              </div>
            ))}
          </div>
          <DialogClose asChild><Button style={{ alignSelf: 'flex-end' }}>Done</Button></DialogClose>
        </DialogContent>
      </Dialog>
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
  const [untimed, setUntimed] = useState(false)
  const [minutes, setMinutes] = useState('15')
  const [dueAt, setDueAt] = useState('')
  const [selected, setSelected] = useState<string[]>([])

  function toggleStudent(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  }

  async function submit() {
    if (!setId || selected.length === 0) return
    await onCreate({
      setId,
      title: title.trim(),
      timeLimitSec: untimed ? undefined : Math.max(1, Math.round(Number(minutes) * 60)),
      dueAt: dueAt || undefined,
      studentIds: selected,
    })
    setTitle(''); setSetId(''); setSelected([]); setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>New assignment</Button></DialogTrigger>
      <DialogContent>
        <DialogTitle>New assignment</DialogTitle>
        <Field label="Title (optional)"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Problem set">
          <Select value={setId} onValueChange={setSetId}>
            <SelectTrigger><SelectValue placeholder="Choose a set…" /></SelectTrigger>
            <SelectContent>
              {sets.map((s) => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}
            </SelectContent>
          </Select>
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
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
          <Button onClick={submit} disabled={!setId || selected.length === 0}>Create</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
