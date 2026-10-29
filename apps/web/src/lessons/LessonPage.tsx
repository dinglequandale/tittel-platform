import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CalendarDays, ChevronLeft, ExternalLink, Mail, Play, Repeat } from 'lucide-react'
import {
  Button, Field, Input, PageLoading, ConfirmDialog, CopyButton,
  Dialog, DialogContent, DialogTitle, DialogClose,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { useToast } from '../lib/toast.tsx'
import { useSession } from '../lib/useSession.ts'
import { useHashScroll } from '../lib/useHashScroll.ts'
import {
  type Lesson, lessonWho, lessonEnd, timeLabel, shortDate, seriesLabel, startLesson, scoreTone, canOpenBoard, dueLabel,
} from './lessons.ts'
import { PlanSlot } from './PlanSlot.tsx'
import { HomeworkSlot } from './HomeworkSlot.tsx'
import { ParentUpdateDialog, lessonContacts, recipientsOf, portalLink, firstName } from './ParentUpdate.tsx'

function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function localTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// The lesson hub (FLOW-SPEC §2.2): everything about one lesson, prepared in
// place. The plan and homework are chosen or created here, never by a detour
// through the library.
export function LessonPage() {
  const { lessonId } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const [lesson, setLesson] = useState<Lesson | null>(null)
  const [error, setError] = useState('')
  const [rescheduling, setRescheduling] = useState(false)
  const [confirmCancel, setConfirmCancel] = useState(false)
  const [confirmStop, setConfirmStop] = useState(false)
  const [updating, setUpdating] = useState(false)
  const { session } = useSession()
  useHashScroll(!!lesson)

  async function reload() {
    try {
      const { lesson } = await apiFetch(`/api/tutor/sessions/${lessonId}`)
      setLesson(lesson)
    } catch (err) {
      setError((err as Error).message)
    }
  }
  useEffect(() => { reload() }, [lessonId])

  async function patch(body: Record<string, unknown>) {
    try {
      await apiFetch(`/api/tutor/sessions/${lessonId}`, { method: 'PATCH', body: JSON.stringify(body) })
      await reload()
    } catch (err) {
      toast((err as Error).message)
    }
  }

  if (error) return <div className="screen"><p className="field-error">{error}</p></div>
  if (!lesson) return <PageLoading />

  const started = lesson.status === 'live' || !!lesson.board_id

  return (
    <div className="screen screen-narrow-wide">
      <Link to="/app" className="content-back"><ChevronLeft size={14} strokeWidth={2} /> This week</Link>

      <div className="screen-head screen-head-row">
        <div>
          <h1>{lessonWho(lesson)}</h1>
          <p>
            {shortDate(lesson.scheduled_at)} · {timeLabel(lesson.scheduled_at)}–{timeLabel(lessonEnd(lesson).toISOString())}
            {lesson.status === 'cancelled' && ' · cancelled'}
          </p>
          {lesson.series && (
            <p className="lesson-series"><Repeat size={13} strokeWidth={2} /> {seriesLabel(lesson.series, lesson.scheduled_at)}</p>
          )}
          {lesson.from_calendar && (
            <p className="lesson-series">
              <CalendarDays size={13} strokeWidth={2} />
              {lesson.skipped ? 'Skipped this week (still in your Google Calendar).' : 'From your Google Calendar.'}
              {lesson.calendar_event_url && (
                <a href={lesson.calendar_event_url} target="_blank" rel="noopener noreferrer" className="inline-link">
                  Move or cancel it there <ExternalLink size={12} strokeWidth={2} />
                </a>
              )}
            </p>
          )}
        </div>
        <div className="toolbar-actions">
          {canOpenBoard(lesson) && (
            <Button onClick={() => startLesson(lesson, navigate).catch((err) => toast((err as Error).message))}>
              <Play size={14} strokeWidth={2.2} /> {started ? 'Open board' : 'Start lesson'}
            </Button>
          )}
          <Button variant="secondary" onClick={() => setUpdating(true)}><Mail size={14} strokeWidth={2} /> Update parents</Button>
          {lesson.from_calendar && (lesson.skipped
            ? <Button variant="ghost" onClick={() => patch({ skipped: false })}>Undo skip</Button>
            : <Button variant="ghost" onClick={() => patch({ skipped: true })}>Skip this week</Button>)}
          {!lesson.from_calendar && <Button variant="secondary" onClick={() => setRescheduling(true)}>Move</Button>}
          {!lesson.from_calendar && (lesson.status === 'cancelled'
            ? <Button variant="ghost" onClick={() => patch({ status: 'scheduled' })}>Restore</Button>
            : <Button variant="ghost" onClick={() => setConfirmCancel(true)}>Cancel lesson</Button>)}
        </div>
      </div>

      <div className="lesson-grid">
        <div className="lesson-col">
          <PlanSlot lesson={lesson} onChange={patch} />
          <HomeworkSlot lesson={lesson} onChanged={reload} />
        </div>
        <div className="lesson-col">
          <MeetingSlot lesson={lesson} onSave={(meetingUrl) => patch({ meetingUrl })} />
          <LastHomeworkSlot lesson={lesson} />
          <NotesSlot lesson={lesson} onSave={(notes) => patch({ notes })} />
          {lesson.series && (
            <button className="link-button" onClick={() => setConfirmStop(true)}>Stop repeating this lesson</button>
          )}
        </div>
      </div>

      {updating && (
        <ParentUpdateDialog onClose={() => setUpdating(false)} load={async () => {
          const people = await lessonContacts(lesson)
          const hw = lesson.homework[lesson.homework.length - 1]
          const names = people.map((p) => firstName(p.name))
          const who = names.length ? names.join(' and ') : lessonWho(lesson)
          const tutor = session?.user.email?.split('@')[0] ?? ''
          const lines = [
            'Hi,',
            '',
            `A quick update on ${who}'s lesson on ${shortDate(lesson.scheduled_at)}.`,
            '',
            lesson.notes ? `What we covered: ${lesson.notes.trim()}` : lesson.plan_title ? `What we covered: ${lesson.plan_title}` : 'What we covered: ',
          ]
          if (hw) lines.push('', `Homework: ${hw.title}${hw.dueAt ? `, due ${dueLabel(hw.dueAt)}` : ''}.`)
          if (lesson.last_homework) lines.push(`Last homework: ${lesson.last_homework.score}/${lesson.last_homework.total}.`)
          if (people.length) {
            lines.push('', people.length === 1 ? `${names[0]}'s homework and lessons are here: ${portalLink(people[0].portal_token)}`
              : `Their homework and lessons:\n${people.map((p) => `${firstName(p.name)}: ${portalLink(p.portal_token)}`).join('\n')}`)
          }
          lines.push('', 'Best,', tutor ? tutor.charAt(0).toUpperCase() + tutor.slice(1) : '')
          return { to: recipientsOf(people), subject: `${who}: lesson on ${shortDate(lesson.scheduled_at)}`, body: lines.join('\n') }
        }} />
      )}
      {rescheduling && (
        <MoveDialog lesson={lesson} onClose={() => setRescheduling(false)}
          onSave={async (scheduledAt, durationMin) => { await patch({ scheduledAt, durationMin }); setRescheduling(false) }} />
      )}
      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Cancel this lesson?"
        description={lesson.series ? 'Only this week. The weekly slot carries on.' : 'It comes off your week and the student’s portal.'}
        confirmLabel="Cancel lesson"
        onConfirm={() => patch({ status: 'cancelled' })}
      />
      <ConfirmDialog
        open={confirmStop}
        onOpenChange={setConfirmStop}
        title="Stop repeating?"
        description="Future weeks you haven't prepared are removed. Any lesson that already has a plan or homework stays."
        confirmLabel="Stop repeating"
        onConfirm={async () => {
          try {
            await apiFetch(`/api/tutor/series/${lesson.series_id}`, { method: 'DELETE' })
            await reload()
          } catch (err) {
            toast((err as Error).message)
          }
        }}
      />
    </div>
  )
}

function MeetingSlot({ lesson, onSave }: { lesson: Lesson; onSave: (url: string | null) => Promise<void> }) {
  const [value, setValue] = useState(lesson.own_meeting_url ?? '')
  useEffect(() => setValue(lesson.own_meeting_url ?? ''), [lesson.own_meeting_url])
  const inherited = !lesson.own_meeting_url && lesson.meeting_url
  return (
    <section className="surface-card slot">
      <div className="slot-head"><span className="card-title-lg">Meeting</span></div>
      {lesson.meeting_url ? (
        <div className="meeting-link">
          <a href={lesson.meeting_url} target="_blank" rel="noopener noreferrer">{lesson.meeting_url}</a>
          <CopyButton text={lesson.meeting_url} />
        </div>
      ) : (
        <p className="muted">No meeting link yet. Set a default in Settings, or one for this student.</p>
      )}
      <Field label={inherited ? 'Different link for this lesson only' : 'Link for this lesson'}>
        <Input value={value} placeholder="https://meet.google.com/… or Zoom"
          onChange={(e) => setValue(e.target.value)}
          onBlur={() => { if (value.trim() !== (lesson.own_meeting_url ?? '')) void onSave(value.trim() || null) }} />
      </Field>
      <p className="muted slot-note">The student sees it on their portal as “Join lesson”.</p>
    </section>
  )
}

function LastHomeworkSlot({ lesson }: { lesson: Lesson }) {
  const h = lesson.last_homework
  if (!lesson.student_id) return null
  return (
    <section className="surface-card slot">
      <div className="slot-head"><span className="card-title-lg">Last homework</span></div>
      {h ? (
        <div className="list-row">
          <div>
            <div className="list-row-title">{h.title}</div>
            <div className="list-row-sub">Done {shortDate(h.doneAt)} · <a href={`/review/${h.attemptToken}`} target="_blank" rel="noopener noreferrer">See answers</a></div>
          </div>
          <span className={`badge badge-${scoreTone(h.score, h.total)} num`}>{h.score}/{h.total}</span>
        </div>
      ) : (
        <p className="muted">Nothing back yet.</p>
      )}
    </section>
  )
}

function NotesSlot({ lesson, onSave }: { lesson: Lesson; onSave: (notes: string | null) => Promise<void> }) {
  const [value, setValue] = useState(lesson.notes ?? '')
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const saved = useRef(lesson.notes ?? '')
  const timer = useRef<number>()

  async function save(next: string) {
    window.clearTimeout(timer.current)
    if (next === saved.current) return
    setState('saving')
    saved.current = next
    await onSave(next || null)
    setState('saved')
  }
  // Saves a moment after typing stops, and on leaving the box.
  useEffect(() => () => window.clearTimeout(timer.current), [])

  return (
    <section className="surface-card slot">
      <div className="slot-head">
        <span className="card-title-lg">Notes</span>
        <span className="muted slot-state">{state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : ''}</span>
      </div>
      {lesson.prev_notes && lesson.prev_at && (
        <div className="prev-notes">
          <div className="list-row-sub">Last time, {shortDate(lesson.prev_at)}</div>
          <p>{lesson.prev_notes}</p>
        </div>
      )}
      <textarea className="input" rows={6} value={value} placeholder="What you covered, how it went, what's next. Only you see these."
        onChange={(e) => {
          setValue(e.target.value)
          setState('idle')
          window.clearTimeout(timer.current)
          const next = e.target.value
          timer.current = window.setTimeout(() => void save(next), 1000)
        }}
        onBlur={() => void save(value)} />
    </section>
  )
}

function MoveDialog({
  lesson, onClose, onSave,
}: { lesson: Lesson; onClose: () => void; onSave: (scheduledAt: string, durationMin: number) => Promise<void> }) {
  const start = new Date(lesson.scheduled_at)
  const [date, setDate] = useState(localDate(start))
  const [time, setTime] = useState(localTime(start))
  const [duration, setDuration] = useState(String(lesson.duration_min ?? 60))
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        <DialogTitle>Move this lesson</DialogTitle>
        {lesson.series && <p className="muted">Only this week moves. The weekly slot stays where it is.</p>}
        <div className="form-row">
          <Field label="Date"><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></Field>
          <Field label="Time"><Input type="time" value={time} onChange={(e) => setTime(e.target.value)} /></Field>
          <Field label="Length">
            <Select value={duration} onValueChange={setDuration}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {['30', '45', '60', '90', '120'].map((m) => <SelectItem key={m} value={m}>{m} min</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <div className="row-end">
          <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
          <Button onClick={() => onSave(new Date(`${date}T${time}`).toISOString(), Number(duration))}>Move</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
