import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, PageLoading } from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'

interface Row {
  id: string
  name: string
  emails: { email: string; role: 'student' | 'parent' }[]
  lessons: number
  minutes: number
  group_lessons: number
  upcoming: number
  upcoming_minutes: number
}

interface Family { key: string; label: string; contact: string; students: Row[] }

const hours = (min: number) => String(Number((min / 60).toFixed(2)))

/**
 * Students who share a parent address are one family: one invoice. Anyone
 * with no parent address is their own.
 */
function families(rows: Row[]): Family[] {
  const out = new Map<string, Family>()
  for (const r of rows) {
    const parent = r.emails.find((e) => e.role === 'parent')?.email
    const key = parent ?? `student:${r.id}`
    const f = out.get(key) ?? { key, label: '', contact: parent ?? r.emails[0]?.email ?? '', students: [] }
    f.students.push(r)
    f.label = f.students.map((s) => s.name).join(', ')
    out.set(key, f)
  }
  return [...out.values()].sort((a, b) => a.label.localeCompare(b.label))
}

function csv(fams: Family[], month: string): string {
  const q = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
  const lines = [['Month', 'Family contact', 'Student', 'Lessons taught', 'Of which group', 'Hours taught', 'Still scheduled', 'Hours scheduled'].map(q).join(',')]
  for (const f of fams) for (const s of f.students) {
    lines.push([month, f.contact, s.name, s.lessons, s.group_lessons, hours(s.minutes), s.upcoming, hours(s.upcoming_minutes)].map(q).join(','))
  }
  return lines.join('\r\n')
}

// Hours per family for a month, for invoicing parents. A group lesson counts
// for each child in it; cancelled lessons don't count.
export function HoursPage() {
  const now = new Date()
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`)
  const [rows, setRows] = useState<Row[] | null>(null)

  useEffect(() => {
    const [y, m] = month.split('-').map(Number)
    setRows(null)
    apiFetch(`/api/tutor/hours?from=${new Date(y, m - 1, 1).toISOString()}&to=${new Date(y, m, 1).toISOString()}`)
      .then((r) => setRows(r.students)).catch(() => setRows([]))
  }, [month])

  const fams = families(rows ?? [])
  const totalMin = (rows ?? []).reduce((n, r) => n + r.minutes, 0)

  function download() {
    const blob = new Blob([csv(fams, month)], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `lessons-${month}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="screen">
      <div className="page-toolbar">
        <label className="check-row">Month <input type="month" className="input" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} /></label>
        <Button variant="secondary" onClick={download} disabled={!rows?.length}>Download CSV</Button>
      </div>
      {rows === null ? <PageLoading /> : rows.length === 0 ? (
        <p className="muted">No lessons this month.</p>
      ) : (
        <>
          <p className="muted">{hours(totalMin)} hours taught across {fams.length} {fams.length === 1 ? 'family' : 'families'}. Group lessons count for each child.</p>
          <div className="surface-card card-pad-x">
            {fams.map((f) => (
              <div key={f.key} className="hours-family">
                <div className="list-row-sub">{f.contact || 'No email saved'}</div>
                {f.students.map((s) => (
                  <div key={s.id} className="list-row">
                    <Link to={`/app/students/${s.id}`} className="list-row-title card-link">{s.name}</Link>
                    <span className="num">
                      {s.lessons} lesson{s.lessons === 1 ? '' : 's'}, {hours(s.minutes)} h
                      {s.group_lessons > 0 && <span className="muted"> ({s.group_lessons} in a group)</span>}
                      {s.upcoming > 0 && <span className="muted"> · {s.upcoming} more scheduled</span>}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
