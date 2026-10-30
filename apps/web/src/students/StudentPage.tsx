import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { CalendarPlus, ChevronLeft, FileText } from 'lucide-react'
import { Button, CopyButton, PageLoading } from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { ScheduleLessonDialog } from '../lessons/ScheduleLessonDialog.tsx'
import { shortDate, timeLabel, scoreTone, dueLabel } from '../lessons/lessons.ts'
import { portalLink, firstName } from '../lessons/ParentUpdate.tsx'
import { QuickLessonButtons } from '../lessons/QuickLesson.tsx'
import { ProgressReportDialog, type Period } from './ProgressReport.tsx'
import { useOrg } from '../lib/useOrg.ts'

interface Record {
  student: {
    id: string; name: string; portal_token: string; notes: string | null; archived_at: string | null
    meeting_url: string | null; parent_updates: boolean
    emails: { email: string; role: 'student' | 'parent' }[]
    groups: { id: string; name: string }[]
  }
  lessons: { id: string; scheduled_at: string; duration_min: number | null; status: string; notes: string | null; group_name: string | null; plan_title: string | null }[]
  homework: {
    id: string; title: string; due_at: string | null; created_at: string; status: string | null
    attempt_token: string | null; submitted_at: string | null; tutor_comment: string | null; score: number; total: number
  }[]
}

type Hw = Record['homework'][number]

function hwState(h: Hw): { label: string; tone: string } {
  if (h.status === 'submitted' || h.status === 'expired') {
    return h.total ? { label: `${h.score}/${h.total}`, tone: scoreTone(h.score, h.total) } : { label: 'Handed in', tone: 'correct' }
  }
  if (h.due_at && new Date(h.due_at).getTime() < Date.now()) return { label: 'Overdue', tone: 'warning' }
  return { label: h.status === 'active' ? 'Started' : 'Not started', tone: 'neutral' }
}

// One student, all in one place (OVERHAUL O6): who to contact, what's next,
// what each past lesson covered (its notes), and how every piece of homework
// went. Where the tutor looks before a lesson or a parent call.
export function StudentPage() {
  const { studentId } = useParams()
  const [data, setData] = useState<Record | null>(null)
  const [error, setError] = useState('')
  const [scheduling, setScheduling] = useState(false)
  // ?report=<period> opens the progress report (from Home's reminder).
  const [search, setSearch] = useSearchParams()
  const reporting = search.get('report') as Period | null
  const setReporting = (p: Period | null) => setSearch(p ? { report: p } : {}, { replace: true })
  const org = useOrg()

  function load() {
    apiFetch(`/api/tutor/students/${studentId}`).then(setData).catch((e) => setError((e as Error).message))
  }
  useEffect(load, [studentId])

  if (error) return <div className="screen"><p className="field-error">{error}</p></div>
  if (!data) return <PageLoading />

  const { student, lessons, homework } = data
  const now = Date.now()
  const upcoming = lessons.filter((l) => new Date(l.scheduled_at).getTime() >= now && l.status !== 'cancelled').reverse().slice(0, 5)
  const past = lessons.filter((l) => new Date(l.scheduled_at).getTime() < now && l.status !== 'cancelled')
  const parents = student.emails.filter((e) => e.role === 'parent')
  const own = student.emails.filter((e) => e.role === 'student')
  const overdue = homework.filter((h) => hwState(h).label === 'Overdue')
  const first = firstName(student.name)

  return (
    <div className="screen screen-narrow-wide">
      <Link to="/app/students" className="content-back"><ChevronLeft size={14} strokeWidth={2} /> Students</Link>
      <div className="screen-head screen-head-row">
        <div>
          <h1>{student.name}</h1>
          <p>
            {own.length > 0 && <>{own.map((e) => e.email).join(', ')}</>}
            {parents.length > 0 && <>{own.length > 0 && ' · '}Parent: {parents.map((e) => e.email).join(', ')}</>}
            {student.emails.length === 0 && 'No email saved'}
            {student.groups.length > 0 && <> · In {student.groups.map((g) => g.name).join(', ')}</>}
          </p>
          {student.archived_at && <p className="muted">Archived. Restore them from Students → Archived.</p>}
        </div>
        <div className="toolbar-actions">
          <Button onClick={() => setScheduling(true)}><CalendarPlus size={14} strokeWidth={2} /> Schedule</Button>
          {org?.parentUpdates.reports && student.parent_updates && (
            <Button variant="secondary" onClick={() => setReporting('last4')}><FileText size={14} strokeWidth={2} /> Progress report</Button>
          )}
        </div>
      </div>
      <div className="student-quick">
        <QuickLessonButtons who={{ studentId: student.id, meetingUrl: student.meeting_url }} whoKey={`s:${student.id}`} />
      </div>

      <div className="lesson-grid">
        <div className="lesson-col">
          <section className="surface-card slot">
            <div className="slot-head"><span className="card-title-lg">Homework</span>
              {overdue.length > 0 && <span className="badge badge-warning">{overdue.length} overdue</span>}</div>
            {homework.length === 0 ? <p className="muted">None given yet.</p> : homework.map((h) => {
              const st = hwState(h)
              const done = h.status === 'submitted' || h.status === 'expired'
              return (
                <div key={h.id} className="list-row">
                  <div>
                    <div className="list-row-title">
                      {done && h.attempt_token ? <Link to={`/review/${h.attempt_token}`} className="card-link">{h.title}</Link> : h.title}
                    </div>
                    <div className="list-row-sub">
                      Given {shortDate(h.created_at)}
                      {done && h.submitted_at ? ` · handed in ${shortDate(h.submitted_at)}` : h.due_at ? ` · due ${dueLabel(h.due_at)}` : ''}
                      {h.tutor_comment && ' · commented'}
                    </div>
                  </div>
                  <span className={`badge badge-${st.tone} num`}>{st.label}</span>
                </div>
              )
            })}
          </section>

          <section className="surface-card slot">
            <div className="slot-head"><span className="card-title-lg">What you've covered</span></div>
            {past.length === 0 ? <p className="muted">No lessons yet.</p> : past.map((l) => (
              <Link key={l.id} to={`/app/lessons/${l.id}`} className="list-row covered-row">
                <div>
                  <div className="list-row-sub">{shortDate(l.scheduled_at)}{l.group_name ? ` · ${l.group_name}` : ''}{l.plan_title ? ` · ${l.plan_title}` : ''}</div>
                  <div className={l.notes ? 'covered-notes' : 'muted'}>{l.notes || 'No notes'}</div>
                </div>
              </Link>
            ))}
          </section>
        </div>

        <div className="lesson-col">
          <section className="surface-card slot">
            <div className="slot-head"><span className="card-title-lg">Coming up</span></div>
            {upcoming.length === 0 ? <p className="muted">Nothing scheduled.</p> : upcoming.map((l) => (
              <Link key={l.id} to={`/app/lessons/${l.id}`} className="list-row">
                <div className="list-row-title">{shortDate(l.scheduled_at)}, {timeLabel(l.scheduled_at)}</div>
                <span className="muted">{l.group_name ?? ''}</span>
              </Link>
            ))}
          </section>
          <section className="surface-card slot">
            <div className="slot-head"><span className="card-title-lg">Their portal</span></div>
            <p className="muted">One private link for {first}'s lessons and homework.</p>
            <div className="meeting-link"><code>{portalLink(student.portal_token)}</code><CopyButton text={portalLink(student.portal_token)} /></div>
          </section>
          {student.notes && (
            <section className="surface-card slot">
              <div className="slot-head"><span className="card-title-lg">About {first}</span></div>
              <p>{student.notes}</p>
            </section>
          )}
        </div>
      </div>

      <ScheduleLessonDialog open={scheduling} onOpenChange={(o) => { setScheduling(o); if (!o) load() }} defaultWho={`s:${student.id}`} />
      {reporting && (
        <ProgressReportDialog studentId={student.id} defaultPeriod={reporting}
          onClose={() => setReporting(null)} />
      )}
    </div>
  )
}
