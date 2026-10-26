import { useEffect, useState } from 'react'
import { Button, ConfirmDialog, Field, Input } from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { useToast } from '../lib/toast.tsx'
import type { CalendarStatus } from '../lessons/CalendarInbox.tsx'

// Connect Google Calendar through its secret iCal address (FLOW-SPEC §3 B):
// read-only, no Google sign-in, no app verification. The address is a
// credential, so the server never sends it back; we only show where it points.
export function CalendarCard() {
  const toast = useToast()
  const [status, setStatus] = useState<CalendarStatus | null>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)

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

  async function connect() {
    const s = await call('PUT', '/api/tutor/calendar', { icsUrl: url })
    if (s?.connected) {
      setUrl('')
      const n = s.lastSync?.imported ?? 0
      const u = s.lastSync?.unmatched.length ?? 0
      toast(`Connected. ${n} lesson${n === 1 ? '' : 's'} imported${u ? `, ${u} to sort out on This week` : ''}.`)
    }
  }

  const sync = status?.lastSync

  return (
    <div className="surface-card settings-card" id="calendar">
      <div className="card-title">Google Calendar</div>
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
                : `Couldn't sync: ${sync.error}`}
            </p>
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
          <p className="muted">
            In Google Calendar: Settings → click your calendar under “Settings for my calendars” → Integrate
            calendar → copy <strong>Secret address in iCal format</strong>. Paste it here. Treat it like a password.
          </p>
          <Field label="Secret address in iCal format">
            <Input value={url} onChange={(e) => setUrl(e.target.value)}
              placeholder="https://calendar.google.com/calendar/ical/…/basic.ics" />
          </Field>
          <div className="row-end">
            <Button onClick={connect} disabled={busy || !url.trim()}>{busy ? 'Connecting…' : 'Connect'}</Button>
          </div>
        </>
      )}
      {error && <p className="field-error">{error}</p>}
      <ConfirmDialog
        open={confirmDisconnect}
        onOpenChange={setConfirmDisconnect}
        title="Disconnect Google Calendar?"
        description="Upcoming imported lessons you haven't prepared are removed. Lessons with a plan or homework stay."
        confirmLabel="Disconnect"
        onConfirm={() => call('DELETE', '/api/tutor/calendar')}
      />
    </div>
  )
}
