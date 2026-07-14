import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { apiFetch } from '../lib/api.ts'

interface Assignment {
  assignment_id: string
  title: string | null
  set_title: string
  time_limit_sec: number | null
  due_at: string | null
  attempt_token: string | null
  status: 'pending' | 'active' | 'submitted' | 'expired'
  total: number
  score: number
}

export function PortalPage() {
  const { studentToken } = useParams()
  const [studentName, setStudentName] = useState('')
  const [assignments, setAssignments] = useState<Assignment[] | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!studentToken) return
    apiFetch(`/api/portal/${studentToken}`)
      .then((d) => { setStudentName(d.studentName); setAssignments(d.assignments) })
      .catch((e) => setError(e.message))
  }, [studentToken])

  if (error) {
    return <main className="page"><h1>Couldn't open this portal</h1><p className="muted">{error}</p></main>
  }
  if (!assignments) {
    return <main className="page"><p className="muted">Loading…</p></main>
  }

  return (
    <main className="page" style={{ maxWidth: 640, margin: '0 auto', padding: '2rem 1rem' }}>
      <h1 style={{ fontFamily: 'var(--font-display)' }}>Hi, {studentName}</h1>
      {assignments.length === 0 ? (
        <p className="muted">Nothing assigned yet.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1.5rem' }}>
          {assignments.map((a) => (
            <div key={a.assignment_id} className="editor-card">
              <strong>{a.title || a.set_title}</strong>
              <div className="muted">
                {a.status === 'pending' && 'Not started'}
                {a.status === 'active' && 'In progress'}
                {(a.status === 'submitted' || a.status === 'expired') && `Score: ${a.score} / ${a.total}`}
                {a.status === 'expired' && ' · time expired'}
                {a.due_at && ` · due ${new Date(a.due_at).toLocaleDateString()}`}
              </div>
              {a.attempt_token && (
                <Link to={a.status === 'submitted' || a.status === 'expired' ? `/review/${a.attempt_token}` : `/hw/${a.attempt_token}`}>
                  {a.status === 'submitted' || a.status === 'expired' ? 'Review your answers →' : a.status === 'active' ? 'Continue →' : 'Start →'}
                </Link>
              )}
            </div>
          ))}
        </div>
      )}
    </main>
  )
}
