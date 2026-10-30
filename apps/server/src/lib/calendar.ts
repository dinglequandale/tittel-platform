import ICAL from 'ical.js'

// Calendar import (FLOW-SPEC §3 stage B, §9): parse a calendar's secret or
// published iCal feed (Google, Outlook / Microsoft 365, iCloud) into
// lesson-shaped occurrences, and match each to a student or group. Pure
// functions: routes/calendar.ts does the fetching and the DB.

export type CalProvider = 'google' | 'outlook' | 'icloud'

/**
 * Whose calendar a feed host belongs to, or null for any other host. The
 * server fetches the feed, so this is also the allowlist: exact hosts, and
 * iCloud's numbered ones (p23-caldav.icloud.com) by a suffix check on the
 * parsed hostname, never a substring of the URL.
 */
export function providerOf(hostname: string): CalProvider | null {
  const h = hostname.toLowerCase()
  if (h === 'calendar.google.com') return 'google'
  if (h === 'outlook.office365.com' || h === 'outlook.office.com' || h === 'outlook.live.com') return 'outlook'
  if (h.endsWith('.icloud.com')) return 'icloud'
  return null
}

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
  /** Attendees who declined (PARTSTAT=DECLINED), lower-cased. */
  declined: string[]
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
    declined: item.attendees
      .filter((a) => String(a.getParameter('partstat') ?? '').toUpperCase() === 'DECLINED')
      .map((a) => email(a.getFirstValue()))
      .filter((e): e is string => !!e),
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

/**
 * Which calendar events count as lessons (Settings → Google Calendar). A
 * tutor's calendar is mostly not lessons; without these, every dinner and
 * meeting lands in the inbox. Each rule is optional; an event must pass all
 * the enabled ones. A series the tutor linked by hand always counts.
 */
export interface CalFilters {
  /** Someone besides the tutor is invited. */
  requireGuest: boolean
  /** The event has a Meet, Zoom or Teams link. */
  requireVideoLink: boolean
  /** The tutor sent the invite (organiser), not someone inviting them. */
  requireOrganizer: boolean
  /** If any, the title must contain one of these (case-insensitive). */
  keywords: string[]
}

// Measured on a real tutor calendar (2026-10-28): 101 event series in four
// weeks; these three defaults kept 7, of which 6 were lessons.
export const DEFAULT_FILTERS: CalFilters = {
  requireGuest: true,
  requireVideoLink: true,
  requireOrganizer: true,
  keywords: [],
}

export function normalizeFilters(raw: unknown): CalFilters {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const bool = (k: keyof CalFilters) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : (DEFAULT_FILTERS[k] as boolean))
  const keywords = Array.isArray(r.keywords)
    ? r.keywords.filter((k): k is string => typeof k === 'string').map((k) => k.trim()).filter(Boolean).slice(0, 30)
    : []
  return { requireGuest: bool('requireGuest'), requireVideoLink: bool('requireVideoLink'), requireOrganizer: bool('requireOrganizer'), keywords }
}

/**
 * Outlook's and iCloud's published feeds may carry no ATTENDEE lines at all.
 * Then "someone besides you is invited" would drop every event, so it's
 * skipped: title keywords and the inbox do the sorting instead. Checked on
 * the whole feed, not the window, so a quiet month on Google doesn't count.
 */
export function feedListsAttendees(text: string): boolean {
  return /^ATTENDEE[;:]/im.test(text)
}

export function lessonRules(filters: CalFilters, listsAttendees: boolean): CalFilters {
  return listsAttendees ? filters : { ...filters, requireGuest: false }
}

/**
 * The tutor's address in a feed whose URL doesn't name it (Outlook, iCloud):
 * the ORGANIZER of the most event series, since a tutor sends most of their
 * lesson invites. Null when the sign-in address already organizes something
 * (it's the tutor anyway), or when no one clearly leads.
 */
export function feedOwnerOf(occurrences: Pick<CalOccurrence, 'uid' | 'organizer'>[], signInEmail: string): string | null {
  const series = new Map<string, string>()
  for (const o of occurrences) if (o.organizer) series.set(o.uid, o.organizer)
  const counts = new Map<string, number>()
  for (const org of series.values()) counts.set(org, (counts.get(org) ?? 0) + 1)
  if (counts.has(signInEmail.toLowerCase())) return null
  const [first, second] = [...counts].sort((a, b) => b[1] - a[1])
  return first && (!second || first[1] > second[1]) ? first[0] : null
}

/**
 * The email a Google calendar's secret address belongs to: it's the calendar
 * id in the path (…/calendar/ical/<id>/private-…/basic.ics). It can differ
 * from the address the tutor signs in with, and both are "the tutor". Null
 * for other providers' addresses, which don't carry it.
 */
export function calendarOwnerOf(feedUrl: string): string | null {
  try {
    const parts = new URL(feedUrl).pathname.split('/')
    const i = parts.indexOf('ical')
    const id = i >= 0 ? decodeURIComponent(parts[i + 1] ?? '').toLowerCase() : ''
    return id.includes('@') ? id : null
  } catch {
    return null
  }
}

/**
 * A link that opens a lesson's event in Google Calendar, where the tutor moves
 * or cancels it (for a recurring one, the series). Google's event id is the
 * iCal UID without "@google.com"; the link carries it with the calendar's
 * address, base64-encoded. Null for events Google didn't make.
 */
export function googleEventUrl(calendarUid: string, owner: string | null): string | null {
  const uid = calendarUid.split('|')[0]
  if (!owner || !uid.endsWith('@google.com')) return null
  const eid = Buffer.from(`${uid.slice(0, -'@google.com'.length)} ${owner}`).toString('base64').replace(/=+$/, '')
  return `https://www.google.com/calendar/event?eid=${eid}`
}

/** Room and resource calendars are attendees, but never people. */
function isPerson(addr: string): boolean {
  return !/@resource\.calendar\.google\.com$/i.test(addr)
}

export function guestsOf(occ: Pick<CalOccurrence, 'attendees'>, tutorEmails: Set<string>): string[] {
  return occ.attendees.filter((e) => !tutorEmails.has(e) && isPerson(e))
}

export function passesFilters(
  occ: Pick<CalOccurrence, 'title' | 'attendees' | 'declined' | 'organizer' | 'meetingUrl'>,
  filters: CalFilters,
  tutorEmails: Set<string>,
): boolean {
  // An invite the tutor turned down is never a lesson they're teaching.
  if (occ.declined.some((e) => tutorEmails.has(e))) return false
  if (filters.requireGuest && guestsOf(occ, tutorEmails).length === 0) return false
  if (filters.requireVideoLink && !occ.meetingUrl) return false
  // No ORGANIZER means the event was made in this calendar, i.e. by the tutor.
  if (filters.requireOrganizer && occ.organizer && !tutorEmails.has(occ.organizer)) return false
  if (filters.keywords.length) {
    const t = occ.title.toLowerCase()
    if (!filters.keywords.some((k) => t.includes(k.toLowerCase()))) return false
  }
  return true
}

export interface MatchStudent {
  id: string
  name: string
  /** The student's own addresses (school, personal, …), lower-cased. */
  emails: string[]
  /** Their parents' addresses, lower-cased. */
  parentEmails: string[]
}
export interface MatchGroup { id: string; memberIds: string[] }
export interface CalLink { studentId: string | null; groupId: string | null; ignored: boolean }

/**
 * Who the inbox thinks an unmatched event is with. One student, or several:
 * then `groupId` is the existing group of exactly them, or null for "make a
 * group of these students".
 */
export interface CalSuggestion { studentIds: string[]; groupId: string | null }

export type CalMatch =
  | { kind: 'student'; studentId: string }
  | { kind: 'group'; groupId: string }
  | { kind: 'ignored' }
  | { kind: 'none'; suggestion: CalSuggestion | null }

/** The group made of these students: exactly them if one exists, else the only group containing them all. */
function groupOf(ids: string[], groups: MatchGroup[]): string | null {
  const containing = groups.filter((g) => ids.every((id) => g.memberIds.includes(id)))
  const exact = containing.filter((g) => g.memberIds.length === ids.length)
  if (exact.length === 1) return exact[0].id
  return containing.length === 1 ? containing[0].id : null
}

/**
 * Who an occurrence is with. In order: what the tutor already told us for
 * this series; invitees against students' own addresses; then against
 * parents' (Konrad invites students, or the parent when the student is
 * young). Several matched students are their group, if they have one; if
 * not, the inbox suggests making it. A name in the title is only ever a
 * suggestion — "Dinner with Maya" must not become a lesson by itself.
 */
export function matchOccurrence(
  occ: Pick<CalOccurrence, 'uid' | 'title' | 'attendees'>,
  ctx: { links: Map<string, CalLink>; students: MatchStudent[]; groups: MatchGroup[]; tutorEmails: Set<string> },
): CalMatch {
  const link = ctx.links.get(occ.uid)
  if (link?.ignored) return { kind: 'ignored' }
  if (link?.studentId) return { kind: 'student', studentId: link.studentId }
  if (link?.groupId) return { kind: 'group', groupId: link.groupId }

  const guests = new Set(guestsOf(occ, ctx.tutorEmails))
  const byOwn = ctx.students.filter((s) => s.emails.some((e) => guests.has(e)))
  const matched = byOwn.length ? byOwn : ctx.students.filter((s) => s.parentEmails.some((e) => guests.has(e)))

  if (matched.length === 1) return { kind: 'student', studentId: matched[0].id }
  if (matched.length > 1) {
    // In invite order, so a suggestion reads "Rayan + Deen" as the invite does.
    const pos = (s: MatchStudent) => Math.min(...[...s.emails, ...s.parentEmails].map((e) => {
      const i = occ.attendees.indexOf(e)
      return i < 0 ? Infinity : i
    }))
    const ids = [...matched].sort((a, b) => pos(a) - pos(b)).map((s) => s.id)
    const groupId = groupOf(ids, ctx.groups)
    if (groupId) return { kind: 'group', groupId }
    return { kind: 'none', suggestion: { studentIds: ids, groupId: null } }
  }
  return { kind: 'none', suggestion: suggestByTitle(occ.title, ctx.students, ctx.groups) }
}

// "Seb Math Class" -> Seb; "Rayan + Deen Math Class" -> Rayan and Deen. A
// full name, or a first name no other student shares, counts as a mention.
function suggestByTitle(title: string, students: MatchStudent[], groups: MatchGroup[]): CalSuggestion | null {
  const words = (name: string) => name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
  const t = ` ${words(title)} `
  const firstName = (st: MatchStudent) => words(st.name).split(' ')[0]
  const firstCount = new Map<string, number>()
  for (const st of students) firstCount.set(firstName(st), (firstCount.get(firstName(st)) ?? 0) + 1)
  const mentioned = students.filter((st) => {
    const full = words(st.name)
    if (full && t.includes(` ${full} `)) return true
    const f = firstName(st)
    return f.length > 1 && firstCount.get(f) === 1 && t.includes(` ${f} `)
  })
  if (mentioned.length === 0) return null
  // In title order: "Rayan + Deen Math Class" suggests "Rayan + Deen".
  const at = (st: MatchStudent) => {
    const i = t.indexOf(` ${words(st.name)} `)
    return i >= 0 ? i : t.indexOf(` ${firstName(st)} `)
  }
  const ids = [...mentioned].sort((a, b) => at(a) - at(b)).map((st) => st.id)
  return { studentIds: ids, groupId: ids.length > 1 ? groupOf(ids, groups) : null }
}
