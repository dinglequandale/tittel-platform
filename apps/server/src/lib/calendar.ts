import ICAL from 'ical.js'

// Google Calendar import (FLOW-SPEC §3 stage B): parse a calendar's secret
// iCal feed into lesson-shaped occurrences, and match each to a student or
// group. Pure functions: routes/calendar.ts does the fetching and the DB.

export interface CalOccurrence {
  /** The event series' iCal UID — what a tutor's "this is Maya" is remembered by. */
  uid: string
  /** One occurrence: UID + its original start (RECURRENCE-ID), stable across moves. */
  key: string
  title: string
  start: Date
  end: Date
  cancelled: boolean
  /** Lower-cased attendee and organizer emails. */
  attendees: string[]
  organizer: string | null
  meetingUrl: string | null
}

const MAX_RECURRENCE_STEPS = 20_000

function email(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const e = v.replace(/^mailto:/i, '').trim().toLowerCase()
  return e.includes('@') ? e : null
}

// Google puts the Meet link in X-GOOGLE-CONFERENCE and the description;
// Zoom/Teams links usually sit in the location or description.
const MEETING_RE = /https:\/\/(?:meet\.google\.com\/[a-z0-9-]+|[\w-]+\.zoom\.us\/[^\s<>"'\\]+|zoom\.us\/[^\s<>"'\\]+|teams\.microsoft\.com\/[^\s<>"'\\]+|teams\.live\.com\/[^\s<>"'\\]+)/i

export function meetingUrlOf(event: ICAL.Event): string | null {
  const conf = event.component.getFirstPropertyValue('x-google-conference')
  if (typeof conf === 'string' && conf.startsWith('https://')) return conf
  for (const text of [event.location, event.description]) {
    const m = typeof text === 'string' ? text.match(MEETING_RE) : null
    if (m) return m[0]
  }
  return null
}

function toOccurrence(uid: string, key: string, item: ICAL.Event, start: Date, end: Date): CalOccurrence {
  return {
    uid,
    key,
    title: item.summary ?? '',
    start,
    end,
    cancelled: String(item.component.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED',
    attendees: item.attendees.map((a) => email(a.getFirstValue())).filter((e): e is string => !!e),
    organizer: email(item.organizer),
    meetingUrl: meetingUrlOf(item),
  }
}

/**
 * Every timed occurrence overlapping [from, to]. Recurrences are expanded
 * with their exceptions (moved or cancelled instances) and EXDATEs applied.
 * All-day events are skipped: they're never lessons.
 */
export function expandFeed(text: string, from: Date, to: Date): CalOccurrence[] {
  const root = new ICAL.Component(ICAL.parse(text))
  for (const tz of root.getAllSubcomponents('vtimezone')) ICAL.TimezoneService.register(tz)

  const masters = new Map<string, ICAL.Component>()
  const exceptions = new Map<string, ICAL.Component[]>()
  for (const ve of root.getAllSubcomponents('vevent')) {
    const uid = String(ve.getFirstPropertyValue('uid') ?? '')
    if (!uid) continue
    if (ve.hasProperty('recurrence-id')) exceptions.set(uid, [...(exceptions.get(uid) ?? []), ve])
    else masters.set(uid, ve)
  }

  const out: CalOccurrence[] = []
  const overlaps = (s: Date, e: Date) => e > from && s < to

  for (const [uid, master] of masters) {
    const ev = new ICAL.Event(master, { exceptions: exceptions.get(uid) ?? [], strictExceptions: true })
    if (ev.startDate.isDate) continue
    if (!ev.isRecurring()) {
      const s = ev.startDate.toJSDate(), e = ev.endDate.toJSDate()
      if (overlaps(s, e)) out.push(toOccurrence(uid, `${uid}|${s.toISOString()}`, ev, s, e))
      continue
    }
    const it = ev.iterator()
    for (let i = 0, next = it.next(); next && i < MAX_RECURRENCE_STEPS; i++, next = it.next()) {
      const details = ev.getOccurrenceDetails(next)
      const s = details.startDate.toJSDate(), e = details.endDate.toJSDate()
      // A moved exception can land anywhere, so stop on the series' own
      // slot, not on where an exception was moved to.
      if (next.toJSDate() > to && s > to) break
      if (!overlaps(s, e)) continue
      out.push(toOccurrence(uid, `${uid}|${details.recurrenceId.toJSDate().toISOString()}`, details.item, s, e))
    }
  }

  // An exception whose master isn't in the feed (e.g. the series ended long
  // ago, but one instance was moved into range) is still a real event.
  for (const [uid, list] of exceptions) {
    if (masters.has(uid)) continue
    for (const ve of list) {
      const ev = new ICAL.Event(ve)
      if (ev.startDate.isDate) continue
      const s = ev.startDate.toJSDate(), e = ev.endDate.toJSDate()
      if (overlaps(s, e)) out.push(toOccurrence(uid, `${uid}|${ev.recurrenceId.toJSDate().toISOString()}`, ev, s, e))
    }
  }

  return out.sort((a, b) => a.start.getTime() - b.start.getTime())
}

export interface MatchStudent { id: string; name: string; email: string | null; parent_email: string | null }
export interface MatchGroup { id: string; memberIds: string[] }
export interface CalLink { studentId: string | null; groupId: string | null; ignored: boolean }

export type CalMatch =
  | { kind: 'student'; studentId: string }
  | { kind: 'group'; groupId: string }
  | { kind: 'ignored' }
  | { kind: 'none'; suggestion: { studentId: string; name: string } | null }

/**
 * Who an occurrence is with. In order: what the tutor already told us for
 * this series; attendee emails against student emails; then against parent
 * emails (Konrad invites students, or the parent when the student is
 * young); several matched students who make up one group are that group.
 * A name in the title is only ever a suggestion — "Dinner with Maya" must
 * not become a lesson by itself.
 */
export function matchOccurrence(
  occ: Pick<CalOccurrence, 'uid' | 'title' | 'attendees'>,
  ctx: { links: Map<string, CalLink>; students: MatchStudent[]; groups: MatchGroup[]; tutorEmail: string },
): CalMatch {
  const link = ctx.links.get(occ.uid)
  if (link?.ignored) return { kind: 'ignored' }
  if (link?.studentId) return { kind: 'student', studentId: link.studentId }
  if (link?.groupId) return { kind: 'group', groupId: link.groupId }

  const tutor = ctx.tutorEmail.toLowerCase()
  const guests = new Set(occ.attendees.filter((e) => e !== tutor))
  const byOwn = ctx.students.filter((s) => s.email && guests.has(s.email.toLowerCase()))
  const matched = byOwn.length
    ? byOwn
    : ctx.students.filter((s) => s.parent_email && guests.has(s.parent_email.toLowerCase()))

  if (matched.length === 1) return { kind: 'student', studentId: matched[0].id }
  if (matched.length > 1) {
    const ids = matched.map((s) => s.id)
    const groups = ctx.groups.filter((g) => ids.every((id) => g.memberIds.includes(id)))
    if (groups.length === 1) return { kind: 'group', groupId: groups[0].id }
  }
  return { kind: 'none', suggestion: suggestByTitle(occ.title, ctx.students) }
}

function suggestByTitle(title: string, students: MatchStudent[]): { studentId: string; name: string } | null {
  const t = ` ${title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ')} `
  const words = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const full = students.filter((s) => words(s.name) && t.includes(` ${words(s.name)} `))
  if (full.length === 1) return { studentId: full[0].id, name: full[0].name }
  const first = students.filter((s) => {
    const f = words(s.name).split(' ')[0]
    return f.length > 1 && t.includes(` ${f} `)
  })
  return first.length === 1 ? { studentId: first[0].id, name: first[0].name } : null
}
