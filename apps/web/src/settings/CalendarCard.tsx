import { useEffect, useState } from 'react'
import { Button, ConfirmDialog, Field, Input } from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { useToast } from '../lib/toast.tsx'
import type { CalendarFilters, CalendarStatus } from '../lessons/CalendarInbox.tsx'
import { dayLabel, timeLabel } from '../lessons/lessons.ts'
import { useHashScroll } from '../lib/useHashScroll.ts'
import { CalendarConnect, PROVIDER_NAME } from './CalendarConnect.tsx'

// Connect a calendar through its secret or published iCal address (FLOW-SPEC
// §3 B, §9): Google, Outlook / Microsoft 365 or iCloud. Read-only, no sign-in,
// no app verification. The address is a credential, so the server never sends
// it back; we only show where it points.
export function CalendarCard() {
  const toast = useToast()
  const [status, setStatus] = useState<CalendarStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const [showLeftOut, setShowLeftOut] = useState(false)
  useHashScroll(status !== null)

  useEffect(() => {
    apiFetch('/api/tutor/calendar').then(setStatus).catch(() => setStatus({ connected: false }))
  }, [])

  async function call(method: string, path: string, body?: unknown) {
    setBusy(true)
    setError('')
    try {
      const s = await apiFetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })
      setStatus(s)
      return s as CalendarStatus
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function connected(s: CalendarStatus) {
    setStatus(s)
    const n = s.lastSync?.imported ?? 0
    const u = s.lastSync?.unmatched.length ?? 0
    toast(`Connected. ${n} lesson${n === 1 ? '' : 's'} imported${u ? `, ${u} to sort out on This week` : ''}.`)
  }

  const sync = status?.lastSync

  return (
    <div className="surface-card settings-card" id="calendar">
      <div className="card-title">{status?.connected && status.provider ? PROVIDER_NAME[status.provider] : 'Calendar'}</div>
      {status === null ? (
        <p className="muted">Checking…</p>
      ) : status.connected ? (
        <>
          <p>
            Connected to <span className="num">{status.feed}</span>. Lessons for the next four weeks come in by
            themselves; invites to a student's or parent's email are matched automatically.
          </p>
          {sync && (
            <p className="muted">
              {sync.ok
                ? `Last synced ${new Date(sync.at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} · ${sync.imported} lesson${sync.imported === 1 ? '' : 's'}`
                  + (sync.filtered ? ` · ${sync.filtered} other event${sync.filtered === 1 ? '' : 's'} left out` : '')
                : `Couldn't sync: ${sync.error}`}
              {sync.ok && !!sync.left_out?.length && (
                <> · <button className="link-button" onClick={() => setShowLeftOut(!showLeftOut)}>{showLeftOut ? 'Hide them' : 'See them'}</button></>
              )}
            </p>
          )}
          {showLeftOut && sync?.left_out && (
            <div className="surface-card card-pad-x left-out">
              {sync.left_out.map((e) => (
                <div key={e.uid} className="list-row">
                  <div>
                    <div className="list-row-title">{e.title || 'Untitled event'}</div>
                    <div className="list-row-sub">{dayLabel(e.next)}, {timeLabel(e.next)}</div>
                  </div>
                  <Button variant="ghost" disabled={busy} onClick={async () => {
                    const s = await call('POST', '/api/tutor/calendar/links', { uid: e.uid, include: true })
                    if (s) toast(`${e.title || 'It'} is in your inbox on This week, to say who it's with`)
                  }}>It's a lesson</Button>
                </div>
              ))}
            </div>
          )}
          {sync?.ok && sync.no_attendees && (
            <p className="muted">
              Your calendar's feed doesn't list who's invited, so “Someone besides you is invited” is skipped and
              invites can't be matched to students by email. Add title keywords below to pick out lessons; the rest
              wait on This week for you to say who they're with.
            </p>
          )}
          {status.filters && (
            <FiltersEditor filters={status.filters} busy={busy} noGuests={!!sync?.no_attendees}
              onSave={(filters) => call('PUT', '/api/tutor/calendar/filters', { filters })} />
          )}
          <div className="row-end">
            <Button variant="ghost" onClick={() => setConfirmDisconnect(true)} disabled={busy}>Disconnect</Button>
            <Button variant="secondary" onClick={() => call('POST', '/api/tutor/calendar/sync')} disabled={busy}>
              {busy ? 'Syncing…' : 'Sync now'}
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="muted">Your lessons come in by themselves and nothing is written back. Pick your calendar to see where to find its private address.</p>
          <CalendarConnect onConnected={connected} />
        </>
      )}
      {error && <p className="field-error">{error}</p>}
      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect your calendar?"
        description="Upcoming imported lessons you haven't prepared are removed. Lessons with a plan or homework stay."
        confirmLabel="Disconnect"
        onConfirm={() => call('DELETE', '/api/tutor/calendar')}
      />
    </div>
  )
}

// Which calendar events count as lessons. Each rule is optional and an event
// must pass every one that's on; a series linked by hand always counts.
function FiltersEditor({
  filters, busy, noGuests, onSave,
}: { filters: CalendarFilters; busy: boolean; noGuests: boolean; onSave: (f: CalendarFilters) => void }) {
  const [draft, setDraft] = useState(filters)
  const [keywords, setKeywords] = useState(filters.keywords.join(', '))
  useEffect(() => { setDraft(filters); setKeywords(filters.keywords.join(', ')) }, [filters])

  const next: CalendarFilters = { ...draft, keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean) }
  const changed = JSON.stringify(next) !== JSON.stringify(filters)
  const rule = (key: 'requireGuest' | 'requireVideoLink' | 'requireOrganizer', label: string, disabled = false) => (
    <label className="check-row">
      <input type="checkbox" checked={draft[key]} disabled={disabled}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.checked })} />
      {label}
    </label>
  )

  return (
    <div className="calendar-filters">
      <div className="list-row-title">Which events are lessons?</div>
      <p className="muted">An event has to match every rule that's on. Anything you've linked by hand always counts.</p>
      {rule('requireGuest', noGuests ? 'Someone besides you is invited (skipped: your feed lists no guests)' : 'Someone besides you is invited', noGuests)}
      {rule('requireVideoLink', 'It has a Meet, Zoom or Teams link (turn off for in-person lessons)')}
      {rule('requireOrganizer', 'You sent the invite')}
      <Field label="Title includes one of (optional, comma-separated)">
        <Input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="e.g. Math, SAT, lesson" />
      </Field>
      <div className="row-end">
        <Button variant="secondary" onClick={() => onSave(next)} disabled={busy || !changed}>
          {busy ? 'Applying…' : 'Apply'}
        </Button>
      </div>
    </div>
  )
}
