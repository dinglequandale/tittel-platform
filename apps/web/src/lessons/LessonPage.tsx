import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { CalendarDays, ChevronLeft, Play, Repeat } from 'lucide-react'
import {
  Button, Field, Input, PageLoading, ConfirmDialog, CopyButton,
  Dialog, DialogContent, DialogTitle, DialogClose,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { useToast } from '../lib/toast.tsx'
import { AiImportDialog } from '../content/SetsTab.tsx'
import { AiImportReview } from '../content/AiImportReview.tsx'
import type { AiImportDraft } from '../content/AiImportReview.tsx'
import type { LessonSummary, ProblemSetSummary } from '../content/types.ts'
import {
  type Lesson, lessonWho, lessonEnd, timeLabel, shortDate, seriesLabel, startLesson, scoreTone,
} from './lessons.ts'

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

  const over = lessonEnd(lesson).getTime() <= Date.now()

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
            <p className="lesson-series"><CalendarDays size={13} strokeWidth={2} /> From your Google Calendar. Move or cancel it there.</p>
          )}
        </div>
        <div className="toolbar-actions">
          {lesson.status !== 'cancelled' && !over && (
            <Button onClick={() => startLesson(lesson, navigate).catch((err) => toast((err as Error).message))}>
              <Play size={14} strokeWidth={2.2} /> Start lesson
            </Button>
          )}
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

function PlanSlot({ lesson, onChange }: { lesson: Lesson; onChange: (body: Record<string, unknown>) => Promise<void> }) {
  const toast = useToast()
  const [plans, setPlans] = useState<LessonSummary[] | null>(null)
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    apiFetch('/api/tutor/lessons').then((r) => setPlans(r.lessons)).catch(() => setPlans([]))
  }, [lesson.plan_id])

  async function importFile(file: File) {
    setImporting(true)
    try {
      const json = JSON.parse(await file.text())
      const { lesson: plan } = await apiFetch('/api/tutor/lessons/import', { method: 'POST', body: JSON.stringify(json) })
      await onChange({ planId: plan.id })
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <section className="surface-card slot">
      <div className="slot-head">
        <span className="card-title-lg">Plan</span>
        {lesson.plan_id && <Button variant="ghost" onClick={() => onChange({ planId: null })}>Remove</Button>}
      </div>
      {lesson.plan_id ? (
        <p className="slot-value">{lesson.plan_title}<span className="muted"> · opens on the board when you start</span></p>
      ) : (
        <>
          <p className="muted">What you'll teach. It's loaded onto the board when you start the lesson.</p>
          <div className="slot-actions">
            {plans && plans.length > 0 && (
              <Select onValueChange={(planId) => onChange({ planId })}>
                <SelectTrigger><SelectValue placeholder="Pick from your library…" /></SelectTrigger>
                <SelectContent>
                  {plans.map((p) => <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            <input ref={fileRef} type="file" accept="application/json" hidden
              onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
            <Button variant="secondary" onClick={() => fileRef.current?.click()} disabled={importing}>
              {importing ? 'Importing…' : 'Import a plan file'}
            </Button>
          </div>
          <p className="muted slot-note">Dropping in a PDF arrives with the board update.</p>
        </>
      )}
    </section>
  )
}

function HomeworkSlot({ lesson, onChanged }: { lesson: Lesson; onChanged: () => Promise<void> }) {
  const toast = useToast()
  const [sets, setSets] = useState<ProblemSetSummary[]>([])
  const [aiEnabled, setAiEnabled] = useState(false)
  const [aiDraft, setAiDraft] = useState<{ draft: AiImportDraft; filename: string } | null>(null)
  const [giving, setGiving] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<string | null>(null)

  useEffect(() => {
    apiFetch('/api/tutor/problem-sets').then((r) => setSets(r.problemSets)).catch(() => {})
    apiFetch('/api/tutor/ai-import/status').then((r) => setAiEnabled(!!r.enabled)).catch(() => {})
  }, [])

  async function give(setId: string) {
    setGiving(true)
    try {
      await apiFetch(`/api/tutor/sessions/${lesson.id}/homework`, { method: 'POST', body: JSON.stringify({ setId }) })
      await onChanged()
      toast(lesson.student_name ? `On ${lesson.student_name}'s portal now` : 'On every group member’s portal now')
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setGiving(false)
    }
  }

  async function remove(assignmentId: string) {
    try {
      await apiFetch(`/api/tutor/assignments/${assignmentId}`, { method: 'DELETE' })
      await onChanged()
    } catch (err) {
      toast((err as Error).message)
    }
  }

  if (aiDraft) {
    return (
      <section className="surface-card slot">
        <AiImportReview
          draft={aiDraft.draft}
          filename={aiDraft.filename}
          onDiscard={() => setAiDraft(null)}
          onCommitted={(setId) => { setAiDraft(null); void give(setId) }}
        />
      </section>
    )
  }

  const usable = sets.filter((s) => s.problem_count > 0)
  const due = lesson.next_lesson_at
    ? `due at the next lesson, ${shortDate(lesson.next_lesson_at)}`
    : 'no due date (no next lesson yet)'

  return (
    <section className="surface-card slot">
      <div className="slot-head"><span className="card-title-lg">Homework</span></div>
      {lesson.homework.map((h) => (
        <div key={h.id} className="list-row">
          <div>
            <div className="list-row-title">{h.title}</div>
            <div className="list-row-sub">
              {h.dueAt ? `Due ${shortDate(h.dueAt)}` : 'No due date'} · {h.submitted}/{h.assigned} done
            </div>
          </div>
          <Button variant="ghost" onClick={() => setRemoveTarget(h.id)}>Remove</Button>
        </div>
      ))}
      {lesson.homework.length === 0 && (
        <p className="muted">It goes straight to {lesson.student_name ? `${lesson.student_name}'s` : 'each member’s'} portal, {due}.</p>
      )}
      <div className="slot-actions">
        <AiImportDialog enabled={aiEnabled} onImported={(draft, filename) => setAiDraft({ draft, filename })} />
        {usable.length > 0 && (
          // value="" keeps the picker an action: it resets to its placeholder after each pick.
          <Select value="" onValueChange={give} disabled={giving}>
            <SelectTrigger><SelectValue placeholder={lesson.homework.length ? 'Add another set…' : 'Pick a problem set…'} /></SelectTrigger>
            <SelectContent>
              {usable.map((s) => <SelectItem key={s.id} value={s.id}>{s.title} ({s.problem_count})</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>
      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title="Remove this homework?"
        description="It comes off the student's portal."
        confirmLabel="Remove"
        onConfirm={() => removeTarget && remove(removeTarget)}
      />
    </section>
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
  return (
    <section className="surface-card slot">
      <div className="slot-head"><span className="card-title-lg">Notes</span></div>
      <textarea className="input" rows={4} value={value} placeholder="For you: what to cover, how it went…"
        onChange={(e) => setValue(e.target.value)}
        onBlur={() => { if (value !== (lesson.notes ?? '')) void onSave(value || null) }} />
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
