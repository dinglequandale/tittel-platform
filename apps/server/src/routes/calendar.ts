import { Router } from 'express'
import { newId } from '@tittel/shared'
import { orgQuery } from '../db.ts'
import {
  expandFeed, matchOccurrence, passesFilters, normalizeFilters, calendarOwnerOf, guestsOf,
  type CalFilters, type CalLink, type CalOccurrence,
} from '../lib/calendar.ts'

// Google Calendar import (FLOW-SPEC §3 stage B). The tutor pastes their
// calendar's secret iCal address once; opening the app syncs the next four
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
// calendar hosts (no redirects, size- and time-capped): never an internal
// address. ICS_ALLOW_HOSTS widens the list (comma-separated) for testing.
const ALLOWED_HOSTS = (process.env.ICS_ALLOW_HOSTS ?? 'calendar.google.com')
  .split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)

export function validFeedUrl(raw: unknown): URL | null {
  if (typeof raw !== 'string') return null
  let url: URL
  try {
    url = new URL(raw.trim().replace(/^webcal:/i, 'https:'))
  } catch {
    return null
  }
  if (!ALLOWED_HOSTS.includes(url.hostname.toLowerCase())) return null
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
  suggestion: { studentId: string; name: string } | null
}
interface SyncStatus {
  at: string
  ok: boolean
  error?: string
  imported: number
  /** Event series in the window the tutor's filters left out. */
  filtered: number
  unmatched: UnmatchedSeries[]
}

// Single instance (OVERHAUL R13): the last sync per org lives in memory. A
// restart just means the next Home load syncs again.
const lastSync = new Map<string, SyncStatus>()
const inFlight = new Map<string, Promise<SyncStatus>>()

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
 * Unforced callers share a run already in flight. A forced sync follows
 * something the tutor just changed (a link, a filter), so a run that started
 * before that change is stale: it waits for it, then runs fresh.
 */
export function syncCalendar(orgId: string, tutorEmail: string, force = false): Promise<SyncStatus> {
  const prev = lastSync.get(orgId)
  if (!force && prev && Date.now() - new Date(prev.at).getTime() < STALE_MS) return Promise.resolve(prev)
  const running = inFlight.get(orgId)
  if (running && !force) return running
  const run: Promise<SyncStatus> = (running ? running.catch(() => undefined) : Promise.resolve())
    .then(() => runSync(orgId, tutorEmail))
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
  const { icsUrl: raw, filters } = await calendarSettings(orgId)
  const url = raw ? validFeedUrl(raw) : null
  if (!url) return { at, ok: false, error: 'no calendar connected', imported: 0, filtered: 0, unmatched: [] }
  // The calendar's own address and the sign-in address are both the tutor.
  const tutorEmails = new Set([tutorEmail.toLowerCase(), calendarOwnerOf(url.toString())].filter((e): e is string => !!e))

  let occurrences: CalOccurrence[]
  const from = new Date(Date.now() - WINDOW_BACK_MS)
  const to = new Date(Date.now() + WINDOW_AHEAD_MS)
  try {
    occurrences = expandFeed(await fetchFeed(url), from, to)
  } catch (err) {
    // A failed fetch must never look like "every event was deleted".
    return { at, ok: false, error: (err as Error).message, imported: 0, filtered: 0, unmatched: [] }
  }

  const students = await orgQuery<{ id: string; name: string; email: string | null; parent_email: string | null }>(
    orgId,
    `select id, name, email, parent_email from students where org_id = $1 and archived_at is null`,
  )
  const groupRows = await orgQuery<{ id: string; member_ids: string[] }>(
    orgId,
    `select g.id, coalesce(array_agg(gm.student_id) filter (where gm.student_id is not null), '{}') as member_ids
       from groups g left join group_members gm on gm.group_id = g.id
      where g.org_id = $1 and g.archived_at is null
      group by g.id`,
  )
  const linkRows = await orgQuery<{ uid: string; student_id: string | null; group_id: string | null; ignored: boolean }>(
    orgId,
    `select uid, student_id, group_id, ignored from calendar_links where org_id = $1`,
  )
  const ctx = {
    students,
    groups: groupRows.map((g) => ({ id: g.id, memberIds: g.member_ids })),
    links: new Map<string, CalLink>(linkRows.map((l) => [l.uid, { studentId: l.student_id, groupId: l.group_id, ignored: l.ignored }])),
    tutorEmails,
  }

  const seen: string[] = []
  const unmatched = new Map<string, UnmatchedSeries>()
  const filteredOut = new Set<string>()
  let imported = 0
  for (const occ of occurrences) {
    // A series the tutor linked by hand always counts; everything else has
    // to look like a lesson first (Settings → Google Calendar).
    if (!ctx.links.has(occ.uid) && !passesFilters(occ, filters, tutorEmails)) {
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
        attendees: guestsOf(occ, tutorEmails), suggestion: match.suggestion,
      })
      continue
    }
    if (await upsertOccurrence(orgId, occ, match.kind === 'student' ? match.studentId : null, match.kind === 'group' ? match.groupId : null)) {
      seen.push(occ.key)
      imported++
    }
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

  return { at, ok: true, imported, filtered: filteredOut.size, unmatched: [...unmatched.values()] }
}

/** Returns false when there's nothing to import (a cancelled week we never had). */
async function upsertOccurrence(orgId: string, occ: CalOccurrence, studentId: string | null, groupId: string | null): Promise<boolean> {
  const durationMin = Math.max(5, Math.round((occ.end.getTime() - occ.start.getTime()) / 60_000))
  const fields = [occ.key, occ.start.toISOString(), durationMin, occ.meetingUrl, studentId, groupId, occ.cancelled]
  // The calendar owns time, length, who and status (a live lesson stays live);
  // plan, homework, notes and the tutor's meeting override are never touched.
  const set = `scheduled_at = $3, duration_min = $4, calendar_meeting_url = $5, student_id = $6, group_id = $7,
               status = case when $8 then 'cancelled' when status = 'live' then 'live' else 'scheduled' end`
  const [updated] = await orgQuery(
    orgId,
    `update sessions set ${set} where org_id = $1 and calendar_uid = $2 returning id`,
    fields,
  )
  if (updated) return true
  if (occ.cancelled) return false

  // A lesson already scheduled in the app at the same time with the same
  // person is this event: adopt it rather than show the lesson twice.
  const [adopted] = await orgQuery(
    orgId,
    `update sessions set calendar_uid = $2, ${set}
      where id = (select id from sessions
                   where org_id = $1 and calendar_uid is null and status != 'cancelled'
                     and (student_id = $6 or group_id = $7)
                     and abs(extract(epoch from scheduled_at - $3::timestamptz)) <= ${ADOPT_WITHIN_SEC}
                   order by abs(extract(epoch from scheduled_at - $3::timestamptz)) limit 1)
        and org_id = $1
      returning id`,
    fields,
  )
  if (adopted) return true

  await orgQuery(
    orgId,
    `insert into sessions (id, org_id, calendar_uid, scheduled_at, duration_min, calendar_meeting_url,
                           student_id, group_id, started_at, status)
     values ($9, $1, $2, $3, $4, $5, $6, $7, null, case when $8 then 'cancelled' else 'scheduled' end)
     on conflict do nothing`,
    [...fields, newId()],
  )
  return true
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
  return { connected: true, feed: maskFeed(raw), filters, lastSync: s }
}

calendarRouter.get('/calendar', async (req, res) => {
  res.json(await status(req.auth!.orgId, req.auth!.email))
})

// Connect: validate, prove the feed parses, then save and sync.
calendarRouter.put('/calendar', async (req, res) => {
  const orgId = req.auth!.orgId
  const url = validFeedUrl(req.body?.icsUrl)
  if (!url) {
    return res.status(400).json({ error: "That isn't a Google Calendar iCal address. It starts with https://calendar.google.com/calendar/ical/ and ends in .ics." })
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

// "This is Maya" / "Not a lesson" for a whole event series. Optionally
// remember an attendee's email on the student (or as their parent's), so the
// next new event with them matches by itself.
calendarRouter.post('/calendar/links', async (req, res) => {
  const orgId = req.auth!.orgId
  const { uid, studentId, groupId, ignore, rememberEmail } = req.body ?? {}
  if (typeof uid !== 'string' || !uid) return res.status(400).json({ error: 'uid is required' })
  if (!ignore && (typeof studentId === 'string') === (typeof groupId === 'string')) {
    return res.status(400).json({ error: 'pass exactly one of studentId or groupId, or ignore' })
  }
  if (typeof studentId === 'string') {
    const [s] = await orgQuery(orgId, `select id from students where org_id = $1 and id = $2 and archived_at is null`, [studentId])
    if (!s) return res.status(404).json({ error: 'student not found' })
  }
  if (typeof groupId === 'string') {
    const [g] = await orgQuery(orgId, `select id from groups where org_id = $1 and id = $2 and archived_at is null`, [groupId])
    if (!g) return res.status(404).json({ error: 'group not found' })
  }
  await orgQuery(
    orgId,
    `insert into calendar_links (org_id, uid, student_id, group_id, ignored) values ($1, $2, $3, $4, $5)
     on conflict (org_id, uid) do update set student_id = $3, group_id = $4, ignored = $5`,
    [uid, ignore ? null : studentId ?? null, ignore ? null : groupId ?? null, !!ignore],
  )
  if (!ignore && typeof studentId === 'string' && rememberEmail && typeof rememberEmail.email === 'string') {
    const column = rememberEmail.as === 'parent' ? 'parent_email' : 'email'
    // Never overwrite an email the tutor already set.
    await orgQuery(
      orgId,
      `update students set ${column} = $3 where org_id = $1 and id = $2 and ${column} is null`,
      [studentId, rememberEmail.email.trim().toLowerCase()],
    )
  }
  const cached = lastSync.get(orgId)
  if (cached) lastSync.set(orgId, { ...cached, unmatched: cached.unmatched.filter((u) => u.uid !== uid) })
  if (ignore) {
    // Nothing to import, so answer at once; a background sync removes any
    // lesson this series had already produced.
    void syncCalendar(orgId, req.auth!.email, true).catch(() => undefined)
    const { icsUrl, filters } = await calendarSettings(orgId)
    return res.json({ connected: !!icsUrl, feed: icsUrl ? maskFeed(icsUrl) : undefined, filters, lastSync: lastSync.get(orgId) })
  }
  res.json(await status(orgId, req.auth!.email, true))
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
