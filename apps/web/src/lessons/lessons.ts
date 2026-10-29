import { apiFetch } from '../lib/api.ts'

// A Lesson is one scheduled meeting with a student or group (server:
// routes/sessions.ts). Its Plan is a library plan; its homework are
// assignments given from it. FLOW-SPEC §1.
export interface LessonHomework {
  id: string
  title: string
  dueAt: string | null
  assigned: number
  submitted: number
}

export interface LastHomework {
  title: string
  doneAt: string
  score: number
  total: number
  attemptToken: string
}

export interface Lesson {
  id: string
  scheduled_at: string
  duration_min: number | null
  status: 'scheduled' | 'live' | 'cancelled'
  notes: string | null
  series_id: string | null
  board_id: string | null
  student_id: string | null
  student_name: string | null
  group_id: string | null
  group_name: string | null
  plan_id: string | null
  plan_title: string | null
  own_meeting_url: string | null
  meeting_url: string | null
  /** Imported from Google Calendar: its time and status are edited there. */
  from_calendar: boolean
  /** A calendar lesson skipped in the app for this week. */
  skipped: boolean
  /** Where to move or cancel a calendar lesson (lesson page only). */
  calendar_event_url?: string | null
  /** The last earlier lesson's notes with the same student or group. */
  prev_notes: string | null
  prev_at: string | null
  series: { weekday: number; startTime: string; tz: string } | null
  homework: LessonHomework[]
  last_homework: LastHomework | null
  next_lesson_at?: string | null
}

export function lessonWho(l: Pick<Lesson, 'student_name' | 'group_name'>): string {
  return l.student_name ?? l.group_name ?? 'Lesson'
}

export function lessonEnd(l: Pick<Lesson, 'scheduled_at' | 'duration_min'>): Date {
  return new Date(new Date(l.scheduled_at).getTime() + (l.duration_min ?? 60) * 60_000)
}

export function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function dayLabel(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
export function seriesLabel(s: NonNullable<Lesson['series']>, scheduledAt: string): string {
  // The series is stored in its own zone; show it in the viewer's local time,
  // which is what the occurrence itself already is.
  return `Every ${WEEKDAYS[new Date(scheduledAt).getDay()]} at ${timeLabel(scheduledAt)}`
    + (s.tz !== Intl.DateTimeFormat().resolvedOptions().timeZone ? ` (${s.tz})` : '')
}

/** Homework score colour: semantic, never the categorical palette. */
export function scoreTone(score: number, total: number): 'correct' | 'warning' | 'incorrect' {
  const pct = total ? score / total : 0
  return pct >= 0.8 ? 'correct' : pct >= 0.6 ? 'warning' : 'incorrect'
}

/** "today", "tomorrow", or "Wed, Nov 4": never a bare weekday that could mean this week or next. */
export function dueLabel(iso: string): string {
  const day = dayLabel(iso)
  return day === 'Today' || day === 'Tomorrow' ? day.toLowerCase() : shortDate(iso)
}

/** A lesson can be started (or its board reopened) until three hours after it ends: lessons run late. */
export function canOpenBoard(l: Pick<Lesson, 'scheduled_at' | 'duration_min' | 'status'>, now = Date.now()): boolean {
  return l.status !== 'cancelled' && now < lessonEnd(l).getTime() + 3 * 3600_000
}

/** Start opens from 15 minutes before until the lesson ends. */
export function isJoinable(l: Pick<Lesson, 'scheduled_at' | 'duration_min'>, now = Date.now()): boolean {
  return now >= new Date(l.scheduled_at).getTime() - 15 * 60_000 && now < lessonEnd(l).getTime()
}

// Start a lesson in one click: the meeting opens in a new tab and this tab
// goes to the student's board, where the plan is loaded (?lesson=, O2).
// window.open has to happen synchronously inside the click, before any
// await, or the browser treats it as a popup and blocks it.
export async function startLesson(lesson: Pick<Lesson, 'id' | 'meeting_url'>, navigate: (to: string) => void) {
  if (lesson.meeting_url) window.open(lesson.meeting_url, '_blank', 'noopener')
  const { boardId } = await apiFetch(`/api/tutor/sessions/${lesson.id}/start`, { method: 'POST', body: '{}' })
  navigate(`/b/${boardId}?lesson=${encodeURIComponent(lesson.id)}`)
}
