import { useEffect, useState } from 'react'
import { StatTile, PageLoading, EmptyState } from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'

interface Assignment {
  id: string
  title: string | null
  set_title: string
  assigned: number
  submitted: number
}

function barColor(pct: number): string {
  if (pct >= 85) return 'var(--correct)'
  if (pct >= 50) return 'var(--warning)'
  return 'var(--incorrect)'
}

// Overview analytics (PLAN.md §6.6). Per-tag mastery arrives with the richer
// attempt analytics later; for now these are honest aggregates computed from
// the assignment summaries and student roster — no placeholder numbers.
export function AnalyticsPage() {
  const [assignments, setAssignments] = useState<Assignment[] | null>(null)
  const [studentCount, setStudentCount] = useState<number | null>(null)

  useEffect(() => {
    apiFetch('/api/tutor/assignments').then((r) => setAssignments(r.assignments)).catch(() => setAssignments([]))
    apiFetch('/api/tutor/students').then((r) => setStudentCount(r.students.length)).catch(() => setStudentCount(0))
  }, [])

  if (assignments === null || studentCount === null) return <PageLoading />

  const totalAssigned = assignments.reduce((n, a) => n + a.assigned, 0)
  const totalSubmitted = assignments.reduce((n, a) => n + a.submitted, 0)
  const completionRate = totalAssigned ? Math.round((totalSubmitted / totalAssigned) * 100) : 0

  return (
    <div className="screen">
      <div className="card-grid-4" style={{ marginBottom: 24 }}>
        <StatTile label="Active students" value={String(studentCount)} />
        <StatTile label="Assignments" value={String(assignments.length)} />
        <StatTile label="Submissions" value={String(totalSubmitted)} />
        <StatTile label="Completion rate" value={`${completionRate}%`} />
      </div>

      <div className="surface-card card-pad">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <span className="card-title">Completion by assignment</span>
          <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>All students</span>
        </div>
        {assignments.length === 0 ? (
          <EmptyState title="No data yet" description="Assign a problem set to start seeing completion here." />
        ) : (
          assignments.map((a) => {
            const pct = a.assigned ? Math.round((a.submitted / a.assigned) * 100) : 0
            return (
              <div key={a.id} className="bar-row">
                <span className="bar-row-label">{a.title || a.set_title}</span>
                <div className="bar-track"><i style={{ width: `${pct}%`, background: barColor(pct) }} /></div>
                <span className="bar-row-val" style={{ color: barColor(pct) }}>{pct}%</span>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
