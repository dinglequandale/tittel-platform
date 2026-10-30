import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Check, Play, Plus } from 'lucide-react'
import { Button, EmptyState, FlipNumber, PageLoading, paletteFor } from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { useSession } from '../lib/useSession.ts'
import { useToast } from '../lib/toast.tsx'
import { ScheduleLessonDialog } from '../lessons/ScheduleLessonDialog.tsx'
import { CalendarInbox, type CalendarStatus } from '../lessons/CalendarInbox.tsx'
import { QuickStudents } from '../lessons/QuickLesson.tsx'
import { TeachingPrefs } from '../settings/TeachingPrefs.tsx'
import { useOrg } from '../lib/useOrg.ts'
import {
  type Lesson, lessonWho, lessonEnd, timeLabel, dayLabel, isJoinable, startLesson, scoreTone, canOpenBoard, dueLabel,
} from '../lessons/lessons.ts'

interface Returned {
  attempt_token: string
  student_name: string
  title: string
  done_at: string
  score: number
  total: number
  next_lesson_id: string | null
}
interface Overdue { student_name: string; title: string; due_at: string; next_lesson_id: string | null }

/**
 * The period a progress-report reminder covers (Settings → Parents), in the
 * tutor's own time zone: last calendar month from the 1st, or the last four
 * weeks. Reports sent since the period ended count as done.
 */
function reminderWindow(reminder: 'monthly' | '4weeks') {
  const d = new Date()
  if (reminder === 'monthly') {
    const thisMonth = new Date(d.getFullYear(), d.getMonth(), 1)
    return { since: new Date(d.getFullYear(), d.getMonth() - 1, 1), until: thisMonth, sentBefore: thisMonth, period: 'last_month', label: 'Last month' }
  }
  const since = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 27)
  return { since, until: d, sentBefore: since, period: 'last4', label: 'Last 4 weeks' }
}

function greeting(): string {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

function initials(name: string): string {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase()
}

function startOfToday(): Date {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

// "This week" (FLOW-SPEC §2.1): the tutor's week of lessons is the first
// screen. Each lesson shows what's prepared (plan, homework) and what came
// back (last homework), and starts in one click.
export function Home() {
  const { session } = useSession()
  const navigate = useNavigate()
  const toast = useToast()
  const [lessons, setLessons] = useState<Lesson[] | null>(null)
  const [returned, setReturned] = useState<Returned[]>([])
  const [overdue, setOverdue] = useState<Overdue[]>([])
  const [studentCount, setStudentCount] = useState<number | null>(null)
  const [homeworkCount, setHomeworkCount] = useState<number | null>(null)
  const [scheduling, setScheduling] = useState(false)
  const [calendar, setCalendar] = useState<CalendarStatus | null>(null)
  const [tutorName, setTutorName] = useState('')
  const [demo, setDemo] = useState<{ studentId: string; lessonId: string; assignmentIds: string[] } | null>(null)
  const [trying, setTrying] = useState(false)
  const [, setTick] = useState(0)
  const org = useOrg()
  const [reportsDue, setReportsDue] = useState<{ id: string; name: string }[]>([])
  const reminder = org?.parentUpdates.reports && org.parentUpdates.reminder !== 'none' ? reminderWindow(org.parentUpdates.reminder) : null
  useEffect(() => {
    if (!reminder) { setReportsDue([]); return }
    const q = `since=${reminder.since.toISOString()}&until=${reminder.until.toISOString()}&sentBefore=${reminder.sentBefore.toISOString()}`
    apiFetch(`/api/tutor/reports/due?${q}`).then((r) => setReportsDue(r.students)).catch(() => {})
  }, [reminder?.period])

  // The lessons read syncs Google Calendar first (when connected), so the
  // calendar status is fetched after it and reflects that sync.
  function load() {
    const from = startOfToday()
    const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 8)
    apiFetch(`/api/tutor/sessions?from=${from.toISOString()}&to=${to.toISOString()}`)
      .then((r) => setLessons(r.lessons))
      .catch(() => setLessons([]))
      .finally(() => apiFetch('/api/tutor/calendar').then(setCalendar).catch(() => {}))
    apiFetch('/api/tutor/attention').then((r) => { setReturned(r.returned); setOverdue(r.overdue) }).catch(() => {})
    // Re-counted on every load: answering the calendar inbox can add students.
    apiFetch('/api/tutor/students').then((r) => setStudentCount(r.students.length)).catch(() => setStudentCount(0))
    apiFetch('/api/tutor/assignments').then((r) => setHomeworkCount(r.assignments.length)).catch(() => setHomeworkCount(0))
  }

  useEffect(() => {
    load()
    apiFetch('/api/tutor/org').then((o) => { setTutorName((o.displayName ?? '').split(' ')[0]); setDemo(o.demo ?? null) }).catch(() => {})
    // Start buttons light up 15 minutes before a lesson; re-check each minute.
    const t = window.setInterval(() => setTick((n) => n + 1), 60_000)
    return () => window.clearInterval(t)
  }, [])

  const name = session?.user.email?.split('@')[0]
  const displayName = tutorName || (name ? name.charAt(0).toUpperCase() + name.slice(1) : '')

  if (lessons === null) return <PageLoading />

  const now = Date.now()
  const today = startOfToday().toDateString()
  const todays = lessons.filter((l) => new Date(l.scheduled_at).toDateString() === today)
  const later = lessons.filter((l) => new Date(l.scheduled_at).toDateString() !== today)
  const byDay = new Map<string, Lesson[]>()
  for (const l of later) {
    const k = new Date(l.scheduled_at).toDateString()
    byDay.set(k, [...(byDay.get(k) ?? []), l])
  }
  const upcomingToday = todays.filter((l) => lessonEnd(l).getTime() > now)
  const needPrep = lessons.filter((l) => lessonEnd(l).getTime() > now && (!l.plan_id || l.homework.length === 0)).length

  // The sample student doesn't count towards getting started.
  const steps = [
    { label: 'Add a student', hint: 'They get one private link for everything', done: (studentCount ?? 0) - (demo ? 1 : 0) > 0 },
    { label: 'Schedule a lesson', hint: 'Weekly slots repeat by themselves', done: lessons.some((l) => l.student_id !== demo?.studentId) },
    { label: 'Give homework', hint: 'From the lesson, in one step', done: (homeworkCount ?? 0) - (demo?.assignmentIds.length ?? 0) > 0 },
  ]
  const doneCount = steps.filter((s) => s.done).length
  const showOnboarding = studentCount !== null && homeworkCount !== null && doneCount < steps.length
  const stepColors = ['blue', 'mint', 'gold'] as const

  async function tryDemo() {
    setTrying(true)
    try {
      const { lessonId } = await apiFetch('/api/tutor/demo', { method: 'POST', body: '{}' })
      navigate(`/app/lessons/${lessonId}`)
    } catch (err) {
      toast((err as Error).message)
      setTrying(false)
    }
  }

  async function removeDemo() {
    try {
      await apiFetch('/api/tutor/demo', { method: 'DELETE' })
      setDemo(null)
      load()
      toast('Sample removed')
    } catch (err) {
      toast((err as Error).message)
    }
  }

  async function start(l: Lesson) {
    try {
      await startLesson(org?.teachWhere === 'in_person' ? { ...l, meeting_url: null } : l, navigate)
    } catch (err) {
      toast((err as Error).message)
    }
  }

  return (
    <div className="screen">
      <div className="screen-head screen-head-row">
        <div>
          <h1>
            {greeting()}
            {displayName && <>, <span className="serif-em">{displayName}</span></>}
          </h1>
          <p>
            {lessons.length === 0
              ? 'Nothing scheduled this week yet.'
              : todays.length === 0
                ? 'A free day today.'
                : upcomingToday.length === 0
                  ? 'That’s today’s lessons done.'
                  : `${upcomingToday.length} lesson${upcomingToday.length === 1 ? '' : 's'} left today.`}
            {needPrep > 0 && <> {needPrep} still <span className="serif-em">need prep</span>.</>}
          </p>
        </div>
        <Button onClick={() => setScheduling(true)}><Plus size={15} strokeWidth={2.1} /> Schedule lesson</Button>
      </div>

      {showOnboarding && (
        <div className="surface-card onboard">
          <div className="onboard-head">
            <span className="card-title-lg">Get started</span>
            <span className="list-row-sub num">{doneCount} of {steps.length} done</span>
          </div>
          <div className="onboard-steps">
            {steps.map((s, i) => (
              <div key={s.label} className="step" data-done={s.done}>
                <span className="step-num" data-c={stepColors[i]} data-done={s.done}>
                  {s.done ? <Check size={14} strokeWidth={3} /> : <FlipNumber value={i + 1} delay={i * 140} />}
                </span>
                <div>
                  <div className="step-title">{s.label}</div>
                  <div className="step-hint">{s.hint}</div>
                </div>
              </div>
            ))}
          </div>
          {!demo && (
            <div className="onboard-try">
              <Button variant="secondary" onClick={tryDemo} disabled={trying}>{trying ? 'Setting it up…' : 'Explore with a sample student'}</Button>
              <span className="muted">A lesson that's already happened, with homework and answers to follow up on. Remove it any time.</span>
            </div>
          )}
        </div>
      )}

      {demo && (
        <div className="surface-card demo-banner">
          <span>You're exploring with a sample student, <Link to={`/app/lessons/${demo.lessonId}`} className="card-link">Sam R.</Link></span>
          <Button variant="ghost" onClick={removeDemo}>Remove sample</Button>
        </div>
      )}

      {org && org.consentAt && !org.teachingAskedAt && (
        <div className="surface-card teach-card">
          <div>
            <div className="card-title-lg">How do you teach?</div>
            <p className="muted">So the app fits how you work. It only sets defaults, and you can change any of it in Settings.</p>
          </div>
          <TeachingPrefs org={org} onboarding />
        </div>
      )}

      <CalendarInbox status={calendar} onChanged={load} />

      {org?.schedule === 'as_needed' && <QuickStudents />}

      {lessons.length === 0 ? (
        org?.schedule === 'as_needed' && (studentCount ?? 0) > 0 ? null : <EmptyState
          art="pythagoras"
          title="Your week is empty"
          description="Schedule your first lesson. Its plan, homework and meeting link all live on it."
          action={<Button onClick={() => setScheduling(true)}>Schedule a lesson</Button>}
        />
      ) : (
        <div className="week">
          <section className="week-day">
            <h2 className="week-day-title">Today</h2>
            {todays.length === 0 ? (
              <p className="muted">No lessons today.</p>
            ) : (
              <div className="lesson-cards">
                {todays.map((l) => <LessonCard key={l.id} lesson={l} onStart={start} now={now} />)}
              </div>
            )}
          </section>
          {[...byDay.entries()].map(([k, ls]) => (
            <section key={k} className="week-day">
              <h2 className="week-day-title">{dayLabel(ls[0].scheduled_at)}</h2>
              <div className="surface-card card-pad-x">
                {ls.map((l) => <LessonRow key={l.id} lesson={l} />)}
              </div>
            </section>
          ))}
        </div>
      )}

      {(returned.length > 0 || overdue.length > 0 || reportsDue.length > 0) && (
        <section className="week-day">
          <h2 className="week-day-title">Needs attention</h2>
          <div className="surface-card card-pad-x">
            {returned.map((r) => {
              const to = r.next_lesson_id ? `/app/lessons/${r.next_lesson_id}` : `/review/${r.attempt_token}`
              return (
                <Link key={r.attempt_token} to={to} className="list-row">
                  <div>
                    <div className="list-row-title">{r.student_name} finished {r.title}</div>
                    <div className="list-row-sub">{r.next_lesson_id ? 'Open their next lesson' : 'See their answers'}</div>
                  </div>
                  <span className={`badge badge-${scoreTone(r.score, r.total)} num`}>{r.score}/{r.total}</span>
                </Link>
              )
            })}
            {overdue.map((o, i) => (
              <Link key={i} to={o.next_lesson_id ? `/app/lessons/${o.next_lesson_id}` : '/app/students'} className="list-row">
                <div>
                  <div className="list-row-title">{o.student_name} hasn't done {o.title}</div>
                  <div className="list-row-sub">Was due {new Date(o.due_at).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</div>
                </div>
                <span className="badge badge-warning">Overdue</span>
              </Link>
            ))}
            {reminder && reportsDue.map((st) => (
              <Link key={st.id} to={`/app/students/${st.id}?report=${reminder.period}`} className="list-row">
                <div>
                  <div className="list-row-title">Progress report for {st.name}</div>
                  <div className="list-row-sub">{reminder.label}, for their parents</div>
                </div>
                <span className="badge badge-accent">Report</span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <ScheduleLessonDialog open={scheduling} onOpenChange={setScheduling} />
    </div>
  )
}

function Avatar({ lesson }: { lesson: Lesson }) {
  const id = lesson.student_id ?? lesson.group_id ?? lesson.id
  return <span className="avatar-sq" data-c={paletteFor(id)}>{initials(lessonWho(lesson))}</span>
}

function PrepChips({ lesson }: { lesson: Lesson }) {
  const hw = lesson.homework[0]
  return (
    <div className="chip-row">
      <span className="chip" data-done={!!lesson.plan_id}>
        {lesson.plan_id ? <><Check size={12} strokeWidth={3} /> {lesson.plan_title}</> : <><Plus size={12} strokeWidth={2.5} /> Plan</>}
      </span>
      <span className="chip" data-done={!!hw}>
        {hw
          ? <><Check size={12} strokeWidth={3} /> Homework{hw.dueAt ? ` · due ${dueLabel(hw.dueAt)}` : ''}</>
          : <><Plus size={12} strokeWidth={2.5} /> Homework</>}
      </span>
      {lesson.last_homework && (
        <span className={`chip chip-score num`} data-tone={scoreTone(lesson.last_homework.score, lesson.last_homework.total)}>
          Last HW {lesson.last_homework.score}/{lesson.last_homework.total}
        </span>
      )}
    </div>
  )
}

function LessonCard({ lesson, onStart, now }: { lesson: Lesson; onStart: (l: Lesson) => void; now: number }) {
  const over = lessonEnd(lesson).getTime() <= now
  const live = isJoinable(lesson, now)
  const started = lesson.status === 'live' || !!lesson.board_id
  return (
    <div className="surface-card lesson-card" data-over={over}>
      <Link to={`/app/lessons/${lesson.id}`} className="lesson-card-main">
        <div className="lesson-card-time num">
          {timeLabel(lesson.scheduled_at)}<span>–{timeLabel(lessonEnd(lesson).toISOString())}</span>
        </div>
        <div className="list-row-main">
          <Avatar lesson={lesson} />
          <div className="list-row-title">{lessonWho(lesson)}</div>
        </div>
        <PrepChips lesson={lesson} />
      </Link>
      {/* Lessons run late: Start (or reopening the board) stays until a while after the end. */}
      {canOpenBoard(lesson, now) && (
        <Button variant={live ? 'primary' : 'secondary'} onClick={() => onStart(lesson)}>
          <Play size={14} strokeWidth={2.2} /> {started ? 'Open board' : over ? 'Start anyway' : 'Start'}
        </Button>
      )}
    </div>
  )
}

function LessonRow({ lesson }: { lesson: Lesson }) {
  return (
    <Link to={`/app/lessons/${lesson.id}`} className="list-row lesson-row">
      <div className="list-row-main">
        <span className="lesson-row-time num">{timeLabel(lesson.scheduled_at)}</span>
        <Avatar lesson={lesson} />
        <div className="list-row-title">{lessonWho(lesson)}</div>
      </div>
      <PrepChips lesson={lesson} />
    </Link>
  )
}
