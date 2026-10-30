// Calendar import (lib/calendar.ts): recurrence expansion and matching
// against a synthetic Google-style feed, plus Outlook- and iCloud-style
// fixtures (test/fixtures). Run: node --import tsx test/calendar.test.mjs
import { readFileSync } from 'node:fs'
import {
  expandFeed, matchOccurrence, passesFilters, normalizeFilters, calendarOwnerOf, DEFAULT_FILTERS,
  providerOf, feedListsAttendees, lessonRules, feedOwnerOf, googleEventUrl,
} from '../src/lib/calendar.ts'
import { validFeedUrl } from '../src/routes/calendar.ts'

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

// Which hosts the server will fetch, and whose calendar each is.
const host = (u) => validFeedUrl(u)?.hostname ?? null
check('Google secret address accepted', providerOf(host('https://calendar.google.com/calendar/ical/a%40b.com/private-x/basic.ics') ?? '') === 'google')
check('Outlook / Microsoft 365 hosts accepted', ['https://outlook.office365.com/owa/calendar/x/y/calendar.ics',
  'https://outlook.office.com/owa/calendar/x/y/calendar.ics', 'https://OUTLOOK.LIVE.COM/owa/calendar/x/y/calendar.ics']
  .every((u) => providerOf(host(u) ?? '') === 'outlook'))
check('iCloud webcal:// is rewritten and accepted', providerOf(host('webcal://p23-caldav.icloud.com/published/2/abc') ?? '') === 'icloud')
const rejected = ['https://icloud.com.evil.example/published/2/abc', 'https://evilicloud.com/x.ics', 'https://icloud.com/x.ics',
  'https://p23-caldav.icloud.com@evil.example/x.ics', 'https://outlook.office365.com.evil.example/x.ics',
  'https://evil.example/calendar.google.com/x.ics', 'https://localhost/x.ics', 'https://169.254.169.254/x.ics', 'file:///etc/passwd']
check('look-alike and internal hosts rejected (suffix check, not substring)', rejected.every((u) => validFeedUrl(u) === null),
  rejected.filter((u) => validFeedUrl(u) !== null))
check('no owner in an Outlook or iCloud address', calendarOwnerOf('https://outlook.office365.com/owa/calendar/abc@pricetutoring.co.uk/def/calendar.ics') === null
  && calendarOwnerOf('https://p23-caldav.icloud.com/published/2/abc') === null)

// An Outlook published feed with no ATTENDEE lines (UK tutor, Teams and Zoom lessons).
const fixture = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8')
const outlookText = fixture('outlook-no-attendees.ics')
const outlook = expandFeed(outlookText, from, to)
const byTitle = (list, t) => list.filter((o) => o.title === t)
const oliver = byTitle(outlook, 'Oliver - GCSE Maths')
check('outlook: Windows time zone, weekly series (4 Thursdays in Nov)', oliver.length === 4, oliver.map((o) => o.start.toISOString()))
check('outlook: 5pm London after BST ends is 17:00Z', oliver[0]?.start.toISOString() === '2026-11-05T17:00:00.000Z', oliver[0]?.start)
check('outlook: Teams link from a folded DESCRIPTION', !!oliver[0]?.meetingUrl?.startsWith('https://teams.microsoft.com/l/meetup-join/19%3ameeting_oliver'), oliver[0]?.meetingUrl)
check('outlook: no attendees listed anywhere', !feedListsAttendees(outlookText) && outlook.every((o) => o.attendees.length === 0))
check('google-style feed does list attendees', feedListsAttendees(feed))
const hannah = 'hannah.price@pricetutoring.co.uk'
check('outlook: owner is the organizer of most series', feedOwnerOf(outlook, 'hannah@gmail.com') === hannah, feedOwnerOf(outlook, 'hannah@gmail.com'))
check('...not needed when the sign-in address organizes', feedOwnerOf(outlook, 'Hannah.Price@pricetutoring.co.uk') === null)
check('...and none when no one clearly leads', feedOwnerOf([{ uid: 'a', organizer: 'x@e.com' }, { uid: 'b', organizer: 'y@e.com' }], 'me@e.com') === null)
const hannahs = new Set(['hannah@gmail.com', hannah])
const lessonsIn = (list, rules) => [...new Set(list.filter((o) => passesFilters(o, rules, hannahs)).map((o) => o.title))].sort()
check('outlook: the default "someone is invited" rule alone would drop every event', lessonsIn(outlook, DEFAULT_FILTERS).length === 0)
const outlookRules = lessonRules(DEFAULT_FILTERS, feedListsAttendees(outlookText))
check('outlook: without attendee data that rule is skipped', outlookRules.requireGuest === false && outlookRules.requireVideoLink === true)
check("outlook: lessons kept; the dentist (no link) and a colleague's meeting left out",
  JSON.stringify(lessonsIn(outlook, outlookRules)) === JSON.stringify(['Oliver - GCSE Maths', 'Priya A-level Further Maths']), lessonsIn(outlook, outlookRules))
check('outlook: title keywords still apply', JSON.stringify(lessonsIn(outlook, { ...outlookRules, keywords: ['GCSE'] })) === JSON.stringify(['Oliver - GCSE Maths']))
const ukStudents = [{ id: 'oliver', name: 'Oliver Smith', emails: [], parentEmails: [] }]
const oliverMatch = matchOccurrence(oliver[0], { links: new Map(), students: ukStudents, groups: [], tutorEmails: hannahs })
check('outlook: no emails, so the inbox suggests by title', oliverMatch.kind === 'none' && oliverMatch.suggestion?.studentIds.join() === 'oliver', oliverMatch)
check('outlook: no Google event link', googleEventUrl(oliver[0].key, hannah) === null)

// An iCloud published calendar, which here does carry attendees.
const icloudText = fixture('icloud.ics')
const icloud = expandFeed(icloudText, from, to)
const amelia = byTitle(icloud, 'Amelia - 11+ English')
check('icloud: weekly series (4 Wednesdays in Nov)', amelia.length === 4 && amelia[0].start.toISOString() === '2026-11-04T16:00:00.000Z', amelia.map((o) => o.start.toISOString()))
check('icloud: zoom link from LOCATION', amelia[0]?.meetingUrl === 'https://us05web.zoom.us/j/1112223334?pwd=amelia', amelia[0]?.meetingUrl)
check('icloud: attendees listed, so the guest rule stays', feedListsAttendees(icloudText) && lessonRules(DEFAULT_FILTERS, true).requireGuest)
const icloudOwner = feedOwnerOf(icloud, 'hannah@gmail.com')
check('icloud: owner from ORGANIZER', icloudOwner === 'hannah.price@icloud.com', icloudOwner)
const icloudMe = new Set(['hannah@gmail.com', icloudOwner])
check('icloud: the lesson passes the defaults; the gym does not', JSON.stringify([...new Set(icloud.filter((o) => passesFilters(o, DEFAULT_FILTERS, icloudMe)).map((o) => o.title))]) === JSON.stringify(['Amelia - 11+ English']))
const ameliaMatch = matchOccurrence(amelia[0], { links: new Map(), groups: [], tutorEmails: icloudMe,
  students: [{ id: 'amelia', name: 'Amelia Jones', emails: [], parentEmails: ['sarah.jones@example.co.uk'] }] })
check('icloud: parent email match', ameliaMatch.kind === 'student' && ameliaMatch.studentId === 'amelia', ameliaMatch)

console.log(failures ? `\n${failures} calendar check(s) failed.` : '\nAll calendar checks passed.')
process.exit(failures ? 1 : 0)
