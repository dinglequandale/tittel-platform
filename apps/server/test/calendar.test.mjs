// Calendar import (lib/calendar.ts): recurrence expansion and matching
// against a synthetic Google-style feed. Run: node --import tsx test/calendar.test.mjs
import {
  expandFeed, matchOccurrence, passesFilters, normalizeFilters, calendarOwnerOf, DEFAULT_FILTERS,
} from '../src/lib/calendar.ts'

let failures = 0
function check(name, ok, got) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(got)})`}`)
  if (!ok) failures++
}

const VTZ = `BEGIN:VTIMEZONE
TZID:America/New_York
BEGIN:DAYLIGHT
TZOFFSETFROM:-0500
TZOFFSETTO:-0400
TZNAME:EDT
DTSTART:19700308T020000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:-0400
TZOFFSETTO:-0500
TZNAME:EST
DTSTART:19701101T020000
RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU
END:STANDARD
END:VTIMEZONE`

const feed = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Google Inc//Google Calendar 70.9054//EN
${VTZ}
BEGIN:VEVENT
UID:maya-weekly@google.com
SUMMARY:Maya SAT
DTSTART;TZID=America/New_York:20261006T160000
DTEND;TZID=America/New_York:20261006T170000
RRULE:FREQ=WEEKLY;BYDAY=TU
EXDATE;TZID=America/New_York:20261110T160000
ORGANIZER:mailto:konrad@example.com
ATTENDEE;CN=Maya:mailto:Maya.Chen@example.com
ATTENDEE:mailto:konrad@example.com
X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij
DESCRIPTION:Join with Google Meet: https://meet.google.com/abc-defg-hij
END:VEVENT
BEGIN:VEVENT
UID:maya-weekly@google.com
RECURRENCE-ID;TZID=America/New_York:20261117T160000
SUMMARY:Maya SAT (moved)
DTSTART;TZID=America/New_York:20261118T170000
DTEND;TZID=America/New_York:20261118T180000
ATTENDEE:mailto:maya.chen@example.com
X-GOOGLE-CONFERENCE:https://meet.google.com/abc-defg-hij
END:VEVENT
BEGIN:VEVENT
UID:maya-weekly@google.com
RECURRENCE-ID;TZID=America/New_York:20261124T160000
SUMMARY:Maya SAT
STATUS:CANCELLED
DTSTART;TZID=America/New_York:20261124T160000
DTEND;TZID=America/New_York:20261124T170000
END:VEVENT
BEGIN:VEVENT
UID:leo-once@google.com
SUMMARY:Leo – fractions
DTSTART:20261105T220000Z
DTEND:20261105T224500Z
ATTENDEE:mailto:parent.of.leo@example.com
LOCATION:https://us02web.zoom.us/j/123456789?pwd=abc
END:VEVENT
BEGIN:VEVENT
UID:algebra-group@google.com
SUMMARY:Algebra group
DTSTART:20261107T150000Z
DTEND:20261107T160000Z
ATTENDEE:mailto:maya.chen@example.com
ATTENDEE:mailto:sam@example.com
END:VEVENT
BEGIN:VEVENT
UID:holiday@google.com
SUMMARY:Thanksgiving
DTSTART;VALUE=DATE:20261126
DTEND;VALUE=DATE:20261127
END:VEVENT
BEGIN:VEVENT
UID:dinner@google.com
SUMMARY:Dinner with Maya
DTSTART:20261108T230000Z
DTEND:20261109T000000Z
END:VEVENT
BEGIN:VEVENT
UID:ancient-series@google.com
RECURRENCE-ID:20260101T150000Z
SUMMARY:Ethan make-up
DTSTART:20261112T150000Z
DTEND:20261112T160000Z
END:VEVENT
END:VCALENDAR`.replace(/\n/g, '\r\n')

const from = new Date('2026-11-01T00:00:00Z')
const to = new Date('2026-11-29T00:00:00Z')
const occ = expandFeed(feed, from, to)
const maya = occ.filter((o) => o.uid === 'maya-weekly@google.com')

const nyClock = (d) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(d)

// Series: Tue Nov 3, (Nov 10 EXDATE), Nov 17 moved to Wed Nov 18 5pm, Nov 24 cancelled.
check('weekly series: 3 occurrences in window (one EXDATE removed)', maya.length === 3, maya.map((o) => o.start.toISOString()))
check('stays 4pm local after DST ends (21:00Z)', maya[0]?.start.toISOString() === '2026-11-03T21:00:00.000Z', maya[0]?.start)
check('moved week lands on Wed 5pm', nyClock(maya[1]?.start ?? new Date(0)) === 'Wed 5:00 PM', maya[1] && nyClock(maya[1].start))
check('moved week keeps its original key', maya[1]?.key === 'maya-weekly@google.com|2026-11-17T21:00:00.000Z', maya[1]?.key)
check('cancelled week is flagged, not dropped', maya[2]?.cancelled === true && maya.filter((o) => o.cancelled).length === 1)
check('meet link from X-GOOGLE-CONFERENCE', maya[0]?.meetingUrl === 'https://meet.google.com/abc-defg-hij', maya[0]?.meetingUrl)
check('attendee emails lower-cased', maya[0]?.attendees.includes('maya.chen@example.com'))
check('all-day events skipped', !occ.some((o) => o.uid === 'holiday@google.com'))
const leo = occ.find((o) => o.uid === 'leo-once@google.com')
check('zoom link from LOCATION', leo?.meetingUrl === 'https://us02web.zoom.us/j/123456789?pwd=abc', leo?.meetingUrl)
check('one-off duration 45 min', leo && (leo.end - leo.start) === 45 * 60_000)
check('orphan exception (master outside feed) still imported', occ.some((o) => o.uid === 'ancient-series@google.com'))
check('nothing outside the window', occ.every((o) => o.end > from && o.start < to))

// Matching.
const students = [
  // Maya uses two addresses (school + personal); either one is her.
  { id: 'maya', name: 'Maya Chen', emails: ['maya@school.example.org', 'maya.chen@example.com'], parentEmails: [] },
  { id: 'leo', name: 'Leo Brandt', emails: [], parentEmails: ['parent.of.leo@example.com'] },
  { id: 'sam', name: 'Sam Ortiz', emails: ['sam@example.com'], parentEmails: [] },
  { id: 'ethan', name: 'Ethan Park', emails: [], parentEmails: [] },
  { id: 'rayan', name: 'Rayan Ali', emails: ['rayan@example.com'], parentEmails: [] },
  { id: 'deen', name: 'Deen Ali', emails: ['deen@example.com'], parentEmails: [] },
]
const groups = [{ id: 'alg', memberIds: ['maya', 'sam'] }]
const ctx = (links = new Map()) => ({ links, students, groups, tutorEmails: new Set(['konrad@example.com']) })
const m = (uid, c = ctx()) => matchOccurrence(occ.find((o) => o.uid === uid), c)

check('student email match', JSON.stringify(m('maya-weekly@google.com')) === JSON.stringify({ kind: 'student', studentId: 'maya' }), m('maya-weekly@google.com'))
check('parent email match', m('leo-once@google.com').studentId === 'leo', m('leo-once@google.com'))
check('any of a student\'s several addresses matches', matchOccurrence({ uid: 'm2', title: 'x', attendees: ['maya@school.example.org'] }, ctx()).studentId === 'maya')
const pair = matchOccurrence({ uid: 'rd', title: 'Math Class', attendees: ['rayan@example.com', 'deen@example.com'] }, ctx())
check('two students with no group -> suggest making one', pair.kind === 'none' && pair.suggestion?.groupId === null
  && JSON.stringify(pair.suggestion.studentIds.sort()) === JSON.stringify(['deen', 'rayan']), pair)
const pairTitle = matchOccurrence({ uid: 'rd2', title: 'Rayan + Deen Math Class!', attendees: [] }, ctx())
check('two first names in the title -> a two-student suggestion', pairTitle.suggestion?.studentIds.length === 2, pairTitle)
const sharedFirst = matchOccurrence({ uid: 'al', title: 'Ali review', attendees: [] }, ctx())
check('a surname shared by siblings is not a first-name mention', sharedFirst.suggestion === null, sharedFirst)
check('two students who form a group -> the group', m('algebra-group@google.com').groupId === 'alg', m('algebra-group@google.com'))
const dinner = m('dinner@google.com')
check('name in title is only a suggestion', dinner.kind === 'none' && dinner.suggestion?.studentIds.join() === 'maya', dinner)
const makeup = m('ancient-series@google.com')
check('first-name suggestion when unique', makeup.kind === 'none' && makeup.suggestion?.studentIds.join() === 'ethan', makeup)
const linked = m('dinner@google.com', ctx(new Map([['dinner@google.com', { studentId: null, groupId: null, ignored: true }]])))
check('tutor said "not a lesson" -> ignored', linked.kind === 'ignored')
const linked2 = m('ancient-series@google.com', ctx(new Map([['ancient-series@google.com', { studentId: 'ethan', groupId: null, ignored: false }]])))
check('remembered link wins', linked2.kind === 'student' && linked2.studentId === 'ethan')
check('tutor\'s own email never matches a student', matchOccurrence({ uid: 'x', title: 'Admin', attendees: ['konrad@example.com'] },
  { ...ctx(), students: [...students, { id: 'me', name: 'Konrad', emails: ['konrad@example.com'], parentEmails: [] }] }).kind === 'none')

// Which events count as lessons (defaults: a guest, a video link, sent by the tutor).
const me = new Set(['konrad@example.com', 'konrad.cal@gmail.com'])
const ev = (o) => ({ title: 'Math', attendees: [], declined: [], organizer: 'konrad.cal@gmail.com', meetingUrl: 'https://meet.google.com/x', ...o })
const pass = (o, f = DEFAULT_FILTERS) => passesFilters(ev(o), f, me)
check('lesson: guest + link + sent by the calendar owner', pass({ attendees: ['konrad.cal@gmail.com', 'seb@example.com'] }))
check('no guests (a personal event) is not a lesson', !pass({ attendees: ['konrad.cal@gmail.com'] }))
check('a meeting room is not a guest', !pass({ attendees: ['konrad.cal@gmail.com', 'c_123@resource.calendar.google.com'] }))
check('no video link is not a lesson by default', !pass({ attendees: ['seb@example.com'], meetingUrl: null }))
check('…but is when that rule is off', pass({ attendees: ['seb@example.com'], meetingUrl: null }, { ...DEFAULT_FILTERS, requireVideoLink: false }))
check('someone else\'s invite (a party) is not a lesson', !pass({ attendees: ['seb@example.com'], organizer: 'friend@example.com' }))
check('no ORGANIZER = made in this calendar = the tutor\'s', pass({ attendees: ['seb@example.com'], organizer: null }))
check('declined by the tutor is never a lesson', !pass({ attendees: ['seb@example.com'], declined: ['konrad.cal@gmail.com'] }, normalizeFilters({ requireGuest: false, requireVideoLink: false, requireOrganizer: false })))
const kw = { ...DEFAULT_FILTERS, keywords: ['math class', 'SAT'] }
check('keywords: title must contain one (case-insensitive)', pass({ title: 'Seb Math Class', attendees: ['seb@example.com'] }, kw) && !pass({ title: 'Sponsor call', attendees: ['seb@example.com'] }, kw))
check('normalizeFilters fills defaults and drops junk', JSON.stringify(normalizeFilters({ requireGuest: false, keywords: [' sat ', 3, ''] })) === JSON.stringify({ requireGuest: false, requireVideoLink: true, requireOrganizer: true, keywords: ['sat'] }))
check('calendar owner from the secret address', calendarOwnerOf('https://calendar.google.com/calendar/ical/konrad.cal%40gmail.com/private-abc123/basic.ics') === 'konrad.cal@gmail.com')
check('…including an address that differs from the sign-in one', matchOccurrence({ uid: 'u', title: 'x', attendees: ['konrad.cal@gmail.com'] },
  { ...ctx(), tutorEmails: me, students: [...students, { id: 'me2', name: 'Me', emails: ['konrad.cal@gmail.com'], parentEmails: [] }] }).kind === 'none')

console.log(failures ? `\n${failures} calendar check(s) failed.` : '\nAll calendar checks passed.')
process.exit(failures ? 1 : 0)
