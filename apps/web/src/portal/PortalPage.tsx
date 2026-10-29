import { useEffect, useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { BRAND_NAME } from '@tittel/shared'
import { Button } from '@tittel/ui'
import { apiFetch, linkErrorMessage } from '../lib/api.ts'
import { dayLabel, timeLabel, isJoinable, lessonEnd, dueLabel, shortDate } from '../lessons/lessons.ts'
import { fileUrl } from '../lib/files.ts'

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
  commented: boolean
}

interface PortalLesson {
  id: string
  scheduled_at: string
  duration_min: number | null
  group_name: string | null
  meeting_url: string | null
}

export function PortalPage() {
  const { studentToken } = useParams()
  const navigate = useNavigate()
  const [studentName, setStudentName] = useState('')
  const [lessons, setLessons] = useState<PortalLesson[]>([])
  const [notes, setNotes] = useState<{ id: string; scheduled_at: string; group_name: string | null; board_pdf: string }[]>([])
  const [assignments, setAssignments] = useState<Assignment[] | null>(null)
  const [error, setError] = useState('')
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!studentToken) return
    apiFetch(`/api/portal/${studentToken}`)
      .then((d) => { setStudentName(d.studentName); setLessons(d.lessons ?? []); setNotes(d.notes ?? []); setAssignments(d.assignments) })
      .catch((e) => setError(linkErrorMessage(e)))
    // Join lights up 15 minutes before; re-check each minute.
    const t = window.setInterval(() => setTick((n) => n + 1), 60_000)
    return () => window.clearInterval(t)
  }, [studentToken])

  // One click: the meeting opens in a new tab (synchronously, or the browser
  // blocks it as a popup) and this tab goes to the board.
  async function join(l: PortalLesson) {
    if (l.meeting_url) window.open(l.meeting_url, '_blank', 'noopener')
    try {
      const { boardId } = await apiFetch(`/api/portal/${studentToken}/lessons/${l.id}/join`, { method: 'POST', body: '{}' })
      navigate(`/b/${boardId}`)
    } catch (e) {
      setError(linkErrorMessage(e))
    }
  }

  if (error) {
    return (
      <main className="page">
        <div className="page-brand">{BRAND_NAME}</div>
        <div className="page-card page-error">
          <h1 style={{ fontFamily: 'var(--font-display)' }}>Couldn't open this portal</h1>
          <p>{error}</p>
        </div>
      </main>
    )
  }
  if (!assignments) {
    return (
      <main className="page">
        <div className="page-brand">{BRAND_NAME}</div>
        <p className="page-loading">Loading…</p>
      </main>
    )
  }

  return (
    <main className="page">
      <div className="page-brand">{BRAND_NAME}</div>
      <h1 style={{ fontFamily: 'var(--font-display)' }}>Hi, {studentName.split(' ')[0]}</h1>

      {lessons.length > 0 && (
        <section className="portal-section">
          <h2 className="portal-section-title">Lessons</h2>
          {lessons.map((l) => {
            const open = isJoinable(l)
            return (
              <div key={l.id} className="editor-card portal-lesson" data-open={open}>
                <div>
                  <strong>{dayLabel(l.scheduled_at)}, {timeLabel(l.scheduled_at)}–{timeLabel(lessonEnd(l).toISOString())}</strong>
                  {l.group_name && <div className="muted">{l.group_name}</div>}
                </div>
                {open
                  ? <Button onClick={() => join(l)}>Join lesson</Button>
                  : <span className="muted">Join opens 15 minutes before</span>}
              </div>
            )
          })}
        </section>
      )}

      <section className="portal-section">
        <h2 className="portal-section-title">Homework</h2>
        {assignments.length === 0 ? (
          <p className="muted">Nothing assigned yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {assignments.map((a) => (
              <div key={a.assignment_id} className="editor-card">
                <strong>{a.title || a.set_title}</strong>
                <div className="muted">
                  {a.status === 'pending' && 'Not started'}
                  {a.status === 'active' && 'In progress'}
                  {(a.status === 'submitted' || a.status === 'expired') && (a.total ? `Score: ${a.score} / ${a.total}` : 'Handed in')}
                  {a.status === 'expired' && ' · time expired'}
                  {a.due_at && a.status !== 'submitted' && ` · due ${dueLabel(a.due_at)}`}
                  {a.commented && ' · your tutor left a comment'}
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
      </section>

      {notes.length > 0 && (
        <section className="portal-section">
          <h2 className="portal-section-title">Notes from your lessons</h2>
          <div className="editor-card portal-notes">
            {notes.map((n) => (
              <a key={n.id} href={fileUrl(n.board_pdf)} target="_blank" rel="noopener noreferrer">
                {shortDate(n.scheduled_at)}{n.group_name ? ` · ${n.group_name}` : ''} — the board
              </a>
            ))}
          </div>
        </section>
      )}
    </main>
  )
}
