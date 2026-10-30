import { Router } from 'express'
import { newId } from '@tittel/shared'
import { orgQuery } from '../db.ts'
import { parseEmails, parseNewStudents, createStudents, addStudentEmails, type StudentEmail } from './students.ts'
import {
  expandFeed, matchOccurrence, passesFilters, normalizeFilters, calendarOwnerOf, guestsOf,
  providerOf, feedOwnerOf, feedListsAttendees, lessonRules,
  type CalFilters, type CalProvider, type CalLink, type CalOccurrence, type CalSuggestion,
} from '../lib/calendar.ts'

// Calendar import (FLOW-SPEC §3 stage B, §9). The tutor pastes their
// calendar's secret or published iCal address (Google, Outlook, iCloud) once; opening the app syncs the next four
// weeks into lessons. Events the importer can't place by email go to an
// inbox on Home, where one click links the whole series.
export const calendarRouter = Router()

const WINDOW_BACK_MS = 24 * 3600_000
const WINDOW_AHEAD_MS = 28 * 24 * 3600_000
const STALE_MS = 5 * 60_000
const FETCH_TIMEOUT_MS = 10_000
const MAX_FEED_BYTES = 5 * 1024 * 1024
/** How close in time a native lesson must be to adopt a calendar event instead of duplicating it. */
const ADOPT_WITHIN_SEC = 10 * 60

// The feed URL is user-supplied and the server fetches it, so only known
// calendar hosts (providerOf; no redirects, size- and time-capped): never an
// internal address. ICS_ALLOW_HOSTS widens the list (comma-separated) for testing.
const EXTRA_HOSTS = (process.env.ICS_ALLOW_HOSTS ?? '')
  .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)

export function validFeedUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string') return null
  let url: URL
  try {
    url = new URL(raw.trim().replace(/^webcal:/i, 'https:'))
  } catch {
    return null
  }
  if (!providerOf(url.hostname) && !EXTRA_HOSTS.includes(url.hostname.toLowerCase())) return null
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && process.env.NODE_ENV !== 'production')) return null
  return url
}

async function fetchFeed(url: URL): Promise<string> {
  const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })
  if (!res.ok) throw new Error(`calendar answered ${res.status}`)
  const reader = res.body?.getReader()
  if (!reader) throw new Error('calendar sent nothing')
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_FEED_BYTES) {
      await reader.cancel()
      throw new Error('calendar feed is too large')
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

interface UnmatchedSeries {
  uid: string
  title: string
  next: string
  count: number
  attendees: string[]
  /** Who it probably is, with a display label ("Seb", "Rayan + Deen", a group's name). */
  suggestion: (CalSuggestion & { label: string }) | null
}
interface SyncStatus {
  at: string
  ok: boolean
  error?: string
  imported: number
  /** Event series in the window the tutor's filters left out. */
  filtered: number
  /** Those series (up to 50), so the tutor can see them and count one in. */
  left_out?: { uid: string; title: string; next: string }[]
  /** The feed lists no invitees at all, so the "someone is invited" rule is skipped. */
  no_attendees?: boolean
  unmatched: UnmatchedSeries[]
}

// Single instance (OVERHAUL R13): the last sync per org lives in memory. A
// restart just means the next Home load syncs again.
const lastSync = new Map<string, SyncStatus>()
const inFlight = new Map<string, Promise<SyncStatus>>()
// The feed as last downloaded. Answering the inbox re-matches this copy
// instead of downloading the calendar again, so the new lessons show at once.
const lastFeed = new Map<string, { occurrences: CalOccurrence[]; tutorEmails: Set<string>; listsAttendees: boolean; to: Date }>()

async function calendarSettings(orgId: string): Promise<{ icsUrl: string | null; filters: CalFilters }> {
  const [org] = await orgQuery<{ ics_url: string | null; filters: unknown }>(
    orgId,
    `select settings->>'icsUrl' as ics_url, settings->'calendarFilters' as filters
       from orgs where id = $1::text /* org_id */`,
  )
  return { icsUrl: org?.ics_url ?? null, filters: normalizeFilters(org?.filters) }
}

/**
 * Sync if the last one is older than STALE_MS, or always when `force`d.
 * Unforced callers share a run already in flight. A forced run follows
 * something the tutor just changed (a link, a filter, an email), so a run
 * that started before that change is stale: it waits for it, then runs
 * fresh. `refetch: false` re-matches the feed already in memory (an inbox
 * answer) instead of downloading the calendar again.
 */
export function syncCalendar(orgId: string, tutorEmail: string, force = false, refetch = true): Promise<SyncStatus> {
  // A run in flight is newer than the last result (say, a re-match after a
  // new student), so unforced readers wait for it.
  const running = inFlight.get(orgId)
  if (running && !force) return running
  const prev = lastSync.get(orgId)
  if (!force && prev && Date.now() - new Date(prev.at).getTime() < STALE_MS) return Promise.resolve(prev)
  const run: Promise<SyncStatus> = (running ? running.catch(() => undefined) : Promise.resolve())
    .then(() => (!refetch && lastFeed.has(orgId) ? applyFeed(orgId) : runSync(orgId, tutorEmail)))
    .then((s) => {
      const before = lastSync.get(orgId)
      return s.ok || !before ? s : { ...before, at: s.at, ok: false, error: s.error }
    })
    .then((s) => { lastSync.set(orgId, s); return s })
    .finally(() => { if (inFlight.get(orgId) === run) inFlight.delete(orgId) })
  inFlight.set(orgId, run)
  return run
}

/**
 * The roster changed (a student, an address, a group): re-match the calendar
 * already in memory, in the background, so an invite that now matches leaves
 * the inbox and becomes lessons without waiting for the next download.
 */
export function rematchCalendar(orgId: string): void {
  if (lastFeed.has(orgId)) void syncCalendar(orgId, '', true, false).catch(() => undefined)
}

/**
 * For schedule reads (Home, lesson lists): sync when stale, but never make
 * the page wait more than `waitMs` on a slow calendar — the sync carries on
 * and the next load shows it.
 */
export async function syncCalendarBriefly(orgId: string, tutorEmail: string, waitMs = 3000): Promise<void> {
  if (!(await calendarSettings(orgId)).icsUrl) return
  const run = syncCalendar(orgId, tutorEmail)
  await Promise.race([run.catch(() => undefined), new Promise((r) => setTimeout(r, waitMs))])
}

async function runSync(orgId: string, tutorEmail: string): Promise<SyncStatus> {
  const at = new Date().toISOString()
  const { icsUrl: raw } = await calendarSettings(orgId)
  const url = raw ? validFeedUrl(raw) : null
  if (!url) return { at, ok: false, error: 'no calendar connected', imported: 0, filtered: 0, unmatched: [] }

  const from = new Date(Date.now() - WINDOW_BACK_MS)
  const to = new Date(Date.now() + WINDOW_AHEAD_MS)
  try {
    const text = await fetchFeed(url)
    const occurrences = expandFeed(text, from, to)
    // The calendar's own address and the sign-in address are both the tutor.
    // Google's is in the secret address; other feeds only show it as ORGANIZER.
    const owner = calendarOwnerOf(url.toString()) ?? feedOwnerOf(occurrences, tutorEmail)
    const tutorEmails = new Set([tutorEmail.toLowerCase(), owner].filter((e): e is string => !!e))
    lastFeed.set(orgId, { occurrences, tutorEmails, listsAttendees: feedListsAttendees(text), to })
  } catch (err) {
    // A failed fetch must never look like "every event was deleted".
    return { at, ok: false, error: (err as Error).message, imported: 0, filtered: 0, unmatched: [] }
  }
  return applyFeed(orgId)
}

type Existing = {
  id: string; calendar_uid: string; scheduled_at: Date; duration_min: number | null
  calendar_meeting_url: string | null; student_id: string | null; group_id: string | null; status: string
  skipped: boolean
}

/**
 * Turn the feed in memory into lessons. Reads everything it compares
 * against up front and writes only what changed (new lessons in one
 * statement), because each database round trip is ~90 ms from Render to
 * Supabase and a calendar has dozens of occurrences.
 */
async function applyFeed(orgId: string): Promise<SyncStatus> {
  const at = new Date().toISOString()
  const feed = lastFeed.get(orgId)!
  const { tutorEmails, listsAttendees, to } = feed

  // Independent reads, in parallel: each is a ~90 ms round trip.
  const [{ filters: saved }, students, groupRows, linkRows, existingRows, natives] = await Promise.all([
    calendarSettings(orgId),
    orgQuery<{ id: string; name: string; emails: string[]; parent_emails: string[] }>(
      orgId,
      `select s.id, s.name,
              coalesce(array_agg(e.email) filter (where e.role = 'student'), '{}') as emails,
              coalesce(array_agg(e.email) filter (where e.role = 'parent'), '{}') as parent_emails
         from students s left join student_emails e on e.student_id = s.id
        where s.org_id = $1 and s.archived_at is null
        group by s.id`,
    ),
    orgQuery<{ id: string; name: string; member_ids: string[] }>(
      orgId,
      `select g.id, g.name, coalesce(array_agg(gm.student_id) filter (where gm.student_id is not null), '{}') as member_ids
         from groups g left join group_members gm on gm.group_id = g.id
        where g.org_id = $1 and g.archived_at is null
        group by g.id`,
    ),
    orgQuery<{ uid: string; student_id: string | null; group_id: string | null; ignored: boolean }>(
      orgId,
      `select uid, student_id, group_id, ignored from calendar_links where org_id = $1`,
    ),
    orgQuery<Existing>(
      orgId,
      `select id, calendar_uid, scheduled_at, duration_min, calendar_meeting_url, student_id, group_id, status, skipped
         from sessions where org_id = $1 and calendar_uid is not null`,
    ),
    // Lessons scheduled in the app that a calendar event may turn out to be.
    orgQuery<{ id: string; scheduled_at: Date; student_id: string | null; group_id: string | null; status: string }>(
      orgId,
      `select id, scheduled_at, student_id, group_id, status from sessions
        where org_id = $1 and calendar_uid is null and status != 'cancelled'
          and scheduled_at > now() - interval '2 days' and scheduled_at < $2`,
      [new Date(to.getTime() + ADOPT_WITHIN_SEC * 1000).toISOString()],
    ),
  ])
  const existing = new Map(existingRows.map((r) => [r.calendar_uid, r]))
  const filters = lessonRules(saved, listsAttendees)

  const ctx = {
    students: students.map((s) => ({ id: s.id, name: s.name, emails: s.emails, parentEmails: s.parent_emails })),
    groups: groupRows.map((g) => ({ id: g.id, memberIds: g.member_ids })),
    links: new Map<string, CalLink>(linkRows.map((l) => [l.uid, { studentId: l.student_id, groupId: l.group_id, ignored: l.ignored }])),
    tutorEmails,
  }
  const nameOf = new Map(students.map((s) => [s.id, s.name]))
  const groupName = new Map(groupRows.map((g) => [g.id, g.name]))
  const label = (sg: CalSuggestion) =>
    (sg.groupId && groupName.get(sg.groupId)) || sg.studentIds.map((id) => nameOf.get(id)?.split(' ')[0] ?? '').join(' + ')

  const seen: string[] = []
  const unmatched = new Map<string, UnmatchedSeries>()
  const filteredOut = new Set<string>()
  const leftOut: { uid: string; title: string; next: string }[] = []
  const adopted = new Set<string>()
  const updates: unknown[][] = []
  const inserts: { id: string; key: string; at: string; dur: number; url: string | null; sid: string | null; gid: string | null }[] = []
  let imported = 0

  for (const occ of feed.occurrences) {
    // A series the tutor linked by hand always counts; everything else has
    // to look like a lesson first (Settings → Calendar).
    if (!ctx.links.has(occ.uid) && !passesFilters(occ, filters, tutorEmails)) {
      if (!filteredOut.has(occ.uid) && !occ.cancelled && occ.end.getTime() > Date.now() && leftOut.length < 50) {
        leftOut.push({ uid: occ.uid, title: occ.title, next: occ.start.toISOString() })
      }
      filteredOut.add(occ.uid)
      continue
    }
    const match = matchOccurrence(occ, ctx)
    if (match.kind === 'ignored') continue
    if (match.kind === 'none') {
      // Only what's still ahead belongs in the inbox.
      if (occ.cancelled || occ.end.getTime() < Date.now()) continue
      const u = unmatched.get(occ.uid)
      if (u) u.count++
      else unmatched.set(occ.uid, {
        uid: occ.uid, title: occ.title, next: occ.start.toISOString(), count: 1,
        attendees: guestsOf(occ, tutorEmails),
        suggestion: match.suggestion ? { ...match.suggestion, label: label(match.suggestion) } : null,
      })
      continue
    }

    const studentId = match.kind === 'student' ? match.studentId : null
    const groupId = match.kind === 'group' ? match.groupId : null
    const dur = Math.max(5, Math.round((occ.end.getTime() - occ.start.getTime()) / 60_000))
    const row = existing.get(occ.key)
    if (row) {
      // The calendar owns time, length, who and cancelled (a live lesson
      // stays live); plan, homework, notes and the meeting override are the tutor's.
      // A week the tutor skipped in the app stays cancelled.
      const status = occ.cancelled || row.skipped ? 'cancelled' : row.status === 'live' ? 'live' : 'scheduled'
      if (new Date(row.scheduled_at).getTime() !== occ.start.getTime() || row.duration_min !== dur
        || row.calendar_meeting_url !== occ.meetingUrl || row.student_id !== studentId
        || row.group_id !== groupId || row.status !== status) {
        updates.push([row.id, occ.key, occ.start.toISOString(), dur, occ.meetingUrl, studentId, groupId, status])
      }
    } else {
      if (occ.cancelled) continue
      // A lesson already scheduled in the app at the same time with the same
      // person is this event: adopt it rather than show the lesson twice.
      const native = natives.find((n) => !adopted.has(n.id)
        && (studentId ? n.student_id === studentId : n.group_id === groupId)
        && Math.abs(new Date(n.scheduled_at).getTime() - occ.start.getTime()) <= ADOPT_WITHIN_SEC * 1000)
      if (native) {
        adopted.add(native.id)
        updates.push([native.id, occ.key, occ.start.toISOString(), dur, occ.meetingUrl, studentId, groupId, native.status === 'live' ? 'live' : 'scheduled'])
      } else {
        inserts.push({ id: newId(), key: occ.key, at: occ.start.toISOString(), dur, url: occ.meetingUrl, sid: studentId, gid: groupId })
      }
    }
    seen.push(occ.key)
    imported++
  }

  for (const u of updates) {
    await orgQuery(
      orgId,
      `update sessions set calendar_uid = $3, scheduled_at = $4, duration_min = $5, calendar_meeting_url = $6,
                           student_id = $7, group_id = $8, status = $9
        where org_id = $1 and id = $2`,
      u,
    )
  }
  if (inserts.length) {
    await orgQuery(
      orgId,
      `insert into sessions (id, org_id, calendar_uid, scheduled_at, duration_min, calendar_meeting_url,
                             student_id, group_id, started_at, status)
       select x.id, $1, x.uid, x.at, x.dur, x.url, x.sid, x.gid, null, 'scheduled'
         from unnest($2::text[], $3::text[], $4::timestamptz[], $5::int[], $6::text[], $7::text[], $8::text[])
              as x(id, uid, at, dur, url, sid, gid)
       on conflict do nothing`,
      [inserts.map((i) => i.id), inserts.map((i) => i.key), inserts.map((i) => i.at), inserts.map((i) => i.dur),
       inserts.map((i) => i.url), inserts.map((i) => i.sid), inserts.map((i) => i.gid)],
    )
  }

  // Events deleted from (or no longer matched in) the calendar: a future
  // lesson nobody prepared goes; one with a plan or homework is cancelled
  // instead, so that work isn't lost.
  await orgQuery(
    orgId,
    `delete from sessions se
      where se.org_id = $1 and se.calendar_uid is not null and se.series_id is null
        and se.status = 'scheduled' and se.scheduled_at > now() and se.scheduled_at < $2
        and not (se.calendar_uid = any($3::text[]))
        and se.plan_id is null and not exists (select 1 from assignments a where a.session_id = se.id)`,
    [to.toISOString(), seen],
  )
  await orgQuery(
    orgId,
    `update sessions se set status = 'cancelled'
      where se.org_id = $1 and se.calendar_uid is not null and se.status = 'scheduled'
        and se.scheduled_at > now() and se.scheduled_at < $2
        and not (se.calendar_uid = any($3::text[]))`,
    [to.toISOString(), seen],
  )

  return {
    at, ok: true, imported, filtered: filteredOut.size, left_out: leftOut, unmatched: [...unmatched.values()],
    ...(listsAttendees ? {} : { no_attendees: true }),
  }
}

function feedProvider(raw: string): CalProvider | null {
  try {
    return providerOf(new URL(raw).hostname)
  } catch {
    return null
  }
}

function maskFeed(raw: string): string {
  try {
    const u = new URL(raw)
    return `${u.hostname}/…${u.pathname.slice(-12)}`
  } catch {
    return 'connected'
  }
}

async function status(orgId: string, tutorEmail: string, force = false) {
  const { icsUrl: raw, filters } = await calendarSettings(orgId)
  if (!raw) return { connected: false }
  const s = await syncCalendar(orgId, tutorEmail, force)
  return { connected: true, feed: maskFeed(raw), provider: feedProvider(raw), filters, lastSync: s }
}

calendarRouter.get('/calendar', async (req, res) => {
  res.json(await status(req.auth!.orgId, req.auth!.email))
})

// Connect: validate, prove the feed parses, then save and sync.
calendarRouter.put('/calendar', async (req, res) => {
  const orgId = req.auth!.orgId
  const url = validFeedUrl(req.body?.icsUrl)
  if (!url) {
    return res.status(400).json({
      error: "That isn't a calendar address we can read. Paste Google Calendar's secret iCal address (https://calendar.google.com/…), "
        + "Outlook or Microsoft 365's published ICS link (https://outlook.office365.com/… or https://outlook.live.com/…), "
        + 'or an iCloud public calendar link (webcal://….icloud.com/…).',
    })
  }
  try {
    expandFeed(await fetchFeed(url), new Date(), new Date(Date.now() + WINDOW_AHEAD_MS))
  } catch (err) {
    return res.status(422).json({ error: `Couldn't read that calendar: ${(err as Error).message}` })
  }
  await orgQuery(
    orgId,
    `update orgs set settings = jsonb_set(settings, '{icsUrl}', to_jsonb($2::text)) where id = $1::text /* org_id */`,
    [url.toString()],
  )
  lastSync.delete(orgId)
  res.json(await status(orgId, req.auth!.email, true))
})

// Disconnect: forget the address; future imported lessons nobody prepared go.
calendarRouter.delete('/calendar', async (req, res) => {
  const orgId = req.auth!.orgId
  await orgQuery(orgId, `update orgs set settings = settings - 'icsUrl' where id = $1::text /* org_id */`)
  await orgQuery(
    orgId,
    `delete from sessions se
      where se.org_id = $1 and se.calendar_uid is not null and se.series_id is null
        and se.status = 'scheduled' and se.scheduled_at > now()
        and se.plan_id is null and not exists (select 1 from assignments a where a.session_id = se.id)`,
  )
  await orgQuery(orgId, `update sessions set calendar_uid = null where org_id = $1 and calendar_uid is not null`)
  lastSync.delete(orgId)
  res.json({ connected: false })
})

calendarRouter.post('/calendar/sync', async (req, res) => {
  res.json(await status(req.auth!.orgId, req.auth!.email, true))
})

// Answer the inbox for a whole event series: "Not a lesson", or who it's
// with: an existing student or group, a new student ({name, emails?}), or a
// new group ({name, studentIds?, newStudents?: [{name, emails?}]}, two or
// more people in all). `emails` saves invitees as a student's own address or
// their parent's (studentId '*': a parent of everyone in the lesson), so
// future invites with them are recognised without asking again (FLOW-SPEC §9.2).
calendarRouter.post('/calendar/links', async (req, res) => {
  const orgId = req.auth!.orgId
  const { uid, ignore, newStudent, newGroup } = req.body ?? {}
  // `include`: count a series the filters left out; it then goes through the inbox like any other.
  const include = !!req.body?.include && !ignore
  let studentId: string | null = typeof req.body?.studentId === 'string' ? req.body.studentId : null
  let groupId: string | null = typeof req.body?.groupId === 'string' ? req.body.groupId : null
  if (typeof uid !== 'string' || !uid) return res.status(400).json({ error: 'uid is required' })

  if (!ignore && !include) {
    const targets = [studentId, groupId, newStudent, newGroup].filter(Boolean).length
    if (targets !== 1) return res.status(400).json({ error: 'say who it is with: one student, group, new student or new group' })
  }

  // Invitees to remember, each tied to one student the lesson is with.
  const rawEmails: unknown[] = Array.isArray(req.body?.emails) ? req.body.emails : []
  const emailSets = new Map<string, StudentEmail[]>()
  let memberIds: string[] = []

  if (!ignore && !include) {
    // Check everything before creating anyone, so a bad answer leaves nothing behind.
    const newIds: unknown[] = Array.isArray(newGroup?.studentIds) ? newGroup.studentIds : []
    for (const e of rawEmails) {
      const item = e as { email?: unknown; role?: unknown; studentId?: unknown }
      if (!parseEmails([{ email: item?.email, role: item?.role }])) {
        return res.status(400).json({ error: "one of those email addresses doesn't look right" })
      }
      // New people have no id yet: their addresses are theirs or everyone's.
      const owner = item.studentId
      if ((newStudent && owner !== undefined && owner !== '*') || (newGroup && owner !== '*' && !newIds.includes(owner))) {
        return res.status(400).json({ error: 'each email must belong to someone in this lesson' })
      }
    }
    if (newStudent) {
      const list = parseNewStudents([newStudent], 1)
      if (typeof list === 'string') return res.status(400).json({ error: 'the new student needs a name' })
      ;[studentId] = await createStudents(orgId, list)
    } else if (newGroup) {
      const ids: string[] = Array.isArray(newGroup.studentIds) ? newGroup.studentIds.filter((x: unknown) => typeof x === 'string') : []
      const fresh = Array.isArray(newGroup.newStudents) && newGroup.newStudents.length ? parseNewStudents(newGroup.newStudents, 30) : []
      const name = typeof newGroup.name === 'string' && newGroup.name.trim() ? newGroup.name.trim() : null
      if (typeof fresh === 'string') return res.status(400).json({ error: fresh })
      const found = ids.length
        ? await orgQuery(orgId, `select id from students where org_id = $1 and id = any($2::text[]) and archived_at is null`, [ids])
        : []
      if (!name || found.length !== ids.length || ids.length + fresh.length < 2) {
        return res.status(400).json({ error: 'a new group needs a name and two or more students' })
      }
      groupId = newId()
      await orgQuery(orgId, `insert into groups (id, org_id, name) values ($2, $1, $3)`, [groupId, name])
      const all = [...ids, ...(fresh.length ? await createStudents(orgId, fresh) : [])]
      await orgQuery(
        orgId,
        `insert into group_members (group_id, student_id)
         select $2, s.id from students s where s.org_id = $1 and s.id = any($3::text[])`,
        [groupId, all],
      )
    }

    if (studentId) {
      const [s] = await orgQuery(orgId, `select id from students where org_id = $1 and id = $2 and archived_at is null`, [studentId])
      if (!s) return res.status(404).json({ error: 'student not found' })
      memberIds = [studentId]
    } else if (groupId) {
      const members = await orgQuery<{ id: string }>(
        orgId,
        `select s.id from groups g join group_members gm on gm.group_id = g.id join students s on s.id = gm.student_id
          where g.org_id = $1 and g.id = $2 and g.archived_at is null and s.archived_at is null`,
        [groupId],
      )
      const [g] = await orgQuery(orgId, `select id from groups where org_id = $1 and id = $2 and archived_at is null`, [groupId])
      if (!g) return res.status(404).json({ error: 'group not found' })
      memberIds = members.map((m) => m.id)
    }

    for (const e of rawEmails) {
      const item = e as { email?: unknown; role?: unknown; studentId?: unknown }
      const owners = item.studentId === '*' ? memberIds
        : typeof item.studentId === 'string' ? [item.studentId] : memberIds.length === 1 ? memberIds : []
      if (!owners.length || !owners.every((o) => memberIds.includes(o))) {
        return res.status(400).json({ error: 'each email must belong to someone in this lesson' })
      }
      const parsed = parseEmails([{ email: item.email, role: item.role }])!
      for (const owner of owners) emailSets.set(owner, [...(emailSets.get(owner) ?? []), ...parsed])
    }
  }

  await orgQuery(
    orgId,
    `insert into calendar_links (org_id, uid, student_id, group_id, ignored) values ($1, $2, $3, $4, $5)
     on conflict (org_id, uid) do update set student_id = $3, group_id = $4, ignored = $5`,
    [uid, ignore ? null : studentId, ignore ? null : groupId, !!ignore],
  )
  for (const [owner, list] of emailSets) await addStudentEmails(orgId, owner, list)

  const cached = lastSync.get(orgId)
  if (cached) lastSync.set(orgId, { ...cached, unmatched: cached.unmatched.filter((u) => u.uid !== uid) })
  if (ignore) {
    // Nothing to import, so answer at once; re-matching in the background
    // removes any lesson this series had already produced.
    void syncCalendar(orgId, req.auth!.email, true, false).catch(() => undefined)
    const { icsUrl, filters } = await calendarSettings(orgId)
    return res.json({ connected: !!icsUrl, feed: icsUrl ? maskFeed(icsUrl) : undefined, provider: icsUrl ? feedProvider(icsUrl) : undefined, filters, lastSync: lastSync.get(orgId) })
  }
  // Re-match the feed in memory (no download): this series' lessons, plus
  // any other series the newly saved emails now recognise, appear at once.
  const { icsUrl, filters } = await calendarSettings(orgId)
  const s = await syncCalendar(orgId, req.auth!.email, true, false)
  res.json({
    connected: !!icsUrl, feed: icsUrl ? maskFeed(icsUrl) : undefined, provider: icsUrl ? feedProvider(icsUrl) : undefined, filters, lastSync: s,
    linked: { studentId, groupId, lessons: (lastFeed.get(orgId)?.occurrences ?? []).filter((o) => o.uid === uid && !o.cancelled).length },
  })
})

// Which events count as lessons. Saving re-syncs, so the inbox and the week
// reflect the new rules straight away.
calendarRouter.put('/calendar/filters', async (req, res) => {
  const orgId = req.auth!.orgId
  const filters = normalizeFilters(req.body?.filters)
  await orgQuery(
    orgId,
    `update orgs set settings = jsonb_set(settings, '{calendarFilters}', $2::jsonb) where id = $1::text /* org_id */`,
    [JSON.stringify(filters)],
  )
  res.json(await status(orgId, req.auth!.email, true))
})
