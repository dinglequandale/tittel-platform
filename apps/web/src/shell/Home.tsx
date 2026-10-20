import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Play, Check } from 'lucide-react'
import { apiFetch } from '../lib/api.ts'
import { useSession } from '../lib/useSession.ts'

interface Assignment {
  id: string
  title: string | null
  set_title: string
  due_at: string | null
  assigned: number
  submitted: number
}
interface Student { id: string; name: string; email: string | null; board_id: string | null; created_at: string }

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function initials(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
}

function dueLabel(a: Assignment): string {
  if (!a.due_at) return 'No deadline'
  const d = new Date(a.due_at)
  const days = Math.round((d.getTime() - Date.now()) / 86_400_000)
  if (days < 0) return 'Overdue'
  if (days === 0) return 'Due today'
  if (days === 1) return 'Due tomorrow'
  return `Due ${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

// Today-centric dashboard (PLAN.md §6.1) — driven by real assignments, students
// and sets. Score/mastery signals arrive with richer analytics later; until then
// the cards show honest counts, derived state, and empty states.
export function Home() {
  const { session } = useSession()
  const [assignments, setAssignments] = useState<Assignment[] | null>(null)
  const [students, setStudents] = useState<Student[] | null>(null)
  const [setCount, setSetCount] = useState<number | null>(null)

  useEffect(() => {
    apiFetch('/api/tutor/assignments').then((r) => setAssignments(r.assignments)).catch(() => setAssignments([]))
    apiFetch('/api/tutor/students').then((r) => setStudents(r.students)).catch(() => setStudents([]))
    apiFetch('/api/tutor/problem-sets').then((r) => setSetCount(r.problemSets.length)).catch(() => setSetCount(0))
  }, [])

  const name = session?.user.email?.split('@')[0]
  const displayName = name ? name.charAt(0).toUpperCase() + name.slice(1) : ''

  const steps = [
    { label: 'Add your first student', hint: 'They get a private portal link', done: (students?.length ?? 0) > 0 },
    { label: 'Create a problem set', hint: 'Generate from a document or build one', done: (setCount ?? 0) > 0 },
    { label: 'Assign it', hint: 'Send each student their link', done: (assignments?.length ?? 0) > 0 },
  ]
  const doneCount = steps.filter((s) => s.done).length
  const showOnboarding = doneCount < steps.length && assignments !== null && students !== null && setCount !== null

  return (
    <div className="screen">
      <div className="screen-head">
        <h1>{greeting()}{displayName && `, ${displayName}`}</h1>
        <p>Here's what needs your attention today.</p>
      </div>

      {showOnboarding && (
        <div className="surface-card" style={{ padding: '20px 24px', marginBottom: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <span style={{ fontSize: 15, fontWeight: 600 }}>Get started</span>
            <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{doneCount} of {steps.length} done</span>
          </div>
          <div className="progress" style={{ height: 4, marginBottom: 16 }}>
            <i style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
          <div style={{ display: 'flex', gap: 14 }}>
            {steps.map((s) => (
              <div key={s.label} style={{ flex: 1, display: 'flex', gap: 10, alignItems: 'flex-start', padding: 12, borderRadius: 8, background: s.done ? 'var(--accent-wash)' : 'transparent' }}>
                <span style={{ width: 20, height: 20, borderRadius: '50%', flexShrink: 0, marginTop: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', background: s.done ? 'var(--accent)' : 'transparent', border: s.done ? 'none' : '1.75px solid var(--ink-3)' }}>
                  {s.done && <Check size={12} strokeWidth={2.6} color="#fff" />}
                </span>
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 600 }}>{s.label}</div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>{s.hint}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card-grid-2" style={{ marginBottom: 24 }}>
        <div className="surface-card card-pad">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
            <div className="card-title">Students</div>
            <Link to="/app/students" style={{ fontSize: 12.5, color: 'var(--ink-3)', textDecoration: 'none' }}>View all</Link>
          </div>
          {students === null ? (
            <p className="muted">Loading…</p>
          ) : students.length === 0 ? (
            <p className="muted">No students yet — add your first to get started.</p>
          ) : (
            students.slice(0, 4).map((s) => (
              <Link key={s.id} to="/app/students" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--surface-2)', textDecoration: 'none', color: 'inherit' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span className="avatar-sq">{initials(s.name)}</span>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{s.name}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{s.email || 'No email on file'}</div>
                  </div>
                </div>
                <span className={s.board_id ? 'badge badge-correct' : 'badge badge-warning'}>{s.board_id ? 'Ready' : 'Needs board'}</span>
              </Link>
            ))
          )}
        </div>

        <div className="surface-card card-pad">
          <div className="card-title" style={{ marginBottom: 14 }}>Upcoming</div>
          {assignments === null ? (
            <p className="muted">Loading…</p>
          ) : assignments.length === 0 ? (
            <p className="muted">No assignments yet.</p>
          ) : (
            assignments.slice(0, 4).map((a) => {
              const pct = a.assigned ? Math.round((a.submitted / a.assigned) * 100) : 0
              return (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--surface-2)' }}>
                  <div>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{a.title || a.set_title}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{a.assigned} student{a.assigned === 1 ? '' : 's'} · {dueLabel(a)}</div>
                  </div>
                  <div className="ring" style={{ background: `conic-gradient(var(--accent) ${pct * 3.6}deg, var(--surface-2) 0deg)` }}>
                    <span>{pct}</span>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Link to="/app/students" className="home-quick">
          <Plus size={17} strokeWidth={1.9} className="quick-action-icon" /> New student
        </Link>
        <Link to="/app/content" className="home-quick">
          <Plus size={17} strokeWidth={1.9} className="quick-action-icon" /> New lesson
        </Link>
        <Link to="/app/assignments" className="home-quick">
          <Plus size={17} strokeWidth={1.9} className="quick-action-icon" /> New assignment
        </Link>
        <Link to="/app/live" className="home-quick home-quick-accent">
          <Play size={17} strokeWidth={1.9} /> Start a class
        </Link>
      </div>
    </div>
  )
}
