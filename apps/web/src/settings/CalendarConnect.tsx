import { useState, type ReactNode } from 'react'
import { ExternalLink } from 'lucide-react'
import { Button, Field, Input } from '@tittel/ui'
import { BRAND_NAME } from '@tittel/shared'
import { apiFetch } from '../lib/api.ts'
import type { CalendarStatus } from '../lessons/CalendarInbox.tsx'

export const PROVIDER_NAME = { google: 'Google Calendar', outlook: 'Outlook calendar', icloud: 'iCloud Calendar' } as const

type Provider = keyof typeof PROVIDER_NAME

interface Guide {
  title: string
  sub: string
  opens: { label: string; href: string }[]
  steps: ReactNode[]
  placeholder: string
  /** The usual reason an address doesn't open. */
  tip: string
}

const GUIDES: Record<Provider, Guide> = {
  google: {
    title: 'Google Calendar',
    sub: 'Including Google Workspace accounts',
    opens: [{ label: 'Open Google Calendar settings', href: 'https://calendar.google.com/calendar/r/settings' }],
    steps: [
      <>On the left, under “Settings for my calendars”, click your calendar.</>,
      <>Scroll to <strong>Integrate calendar</strong>.</>,
      <>Copy <strong>Secret address in iCal format</strong> and paste it below.</>,
    ],
    placeholder: 'https://calendar.google.com/calendar/ical/…/basic.ics',
    tip: 'Copy the Secret address in iCal format, not the public address.',
  },
  outlook: {
    title: 'Outlook or Microsoft 365',
    sub: 'Work, school or personal accounts',
    opens: [
      { label: 'Open Outlook for work or school', href: 'https://outlook.office.com/calendar/' },
      { label: 'Open personal Outlook', href: 'https://outlook.live.com/calendar/' },
    ],
    steps: [
      <>Go to Settings, then Calendar, then <strong>Shared calendars</strong>.</>,
      <>Under “Publish a calendar”, pick your calendar and <strong>Can view all details</strong>, then Publish.</>,
      <>Copy the <strong>ICS</strong> link and paste it below.</>,
    ],
    placeholder: 'https://outlook.office365.com/owa/calendar/…/calendar.ics',
    tip: 'Copy the ICS link, not the HTML link.',
  },
  icloud: {
    title: 'iCloud Calendar',
    sub: 'The calendar on your iPhone or Mac',
    opens: [{ label: 'Open iCloud Calendar', href: 'https://www.icloud.com/calendar/' }],
    steps: [
      <>Click the share button next to your calendar.</>,
      <>Tick <strong>Public Calendar</strong>.</>,
      <>Copy the link and paste it below. It starts with webcal://.</>,
    ],
    placeholder: 'webcal://p01-caldav.icloud.com/published/2/…',
    tip: 'Check that Public Calendar is still ticked.',
  },
}

/**
 * Choosing a calendar and pasting its private address: read-only, with no
 * sign-in. The instructions open beside this page in a new tab, so nothing
 * here is lost while the tutor fetches the address. `later` adds a way on for
 * tutors with no calendar to connect (/welcome).
 */
export function CalendarConnect({ onConnected, later }: {
  onConnected: (s: CalendarStatus) => void
  later?: { chosen: boolean; choose: (chosen: boolean) => void }
}) {
  const [provider, setProvider] = useState<Provider | null>(null)
  const [url, setUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ message: string; tip?: string } | null>(null)
  const guide = provider && GUIDES[provider]

  function pick(p: Provider | null) {
    setProvider(p)
    setError(null)
    later?.choose(p === null)
  }

  async function connect() {
    setBusy(true)
    setError(null)
    try {
      const s: CalendarStatus = await apiFetch('/api/tutor/calendar', { method: 'PUT', body: JSON.stringify({ icsUrl: url }) })
      if (s.connected) onConnected(s)
    } catch (err) {
      const message = (err as Error).message
      // The server can't reach or read it: the address looked right but didn't open.
      setError(message.startsWith("Couldn't read")
        ? { message: "That address didn't open as a calendar.", tip: guide?.tip }
        : { message: `That isn't a calendar address ${BRAND_NAME} can read.`, tip: 'Copy the whole address, then paste it again.' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="choice-list" role="radiogroup" aria-label="Your calendar">
      {(Object.keys(GUIDES) as Provider[]).map((p) => (
        <div key={p}>
          <Choice selected={provider === p} title={GUIDES[p].title} sub={GUIDES[p].sub} onSelect={() => pick(p)} />
          {provider === p && guide && (
            <div className="choice-detail">
              <div className="cal-opens">
                {guide.opens.map((o) => (
                  <a key={o.href} className="card-link" href={o.href} target="_blank" rel="noreferrer">
                    {o.label} <ExternalLink size={13} strokeWidth={2} aria-label="(opens in a new tab)" />
                  </a>
                ))}
              </div>
              <ol className="cal-steps">{guide.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
              <Field label="Your calendar's private address">
                <Input value={url} onChange={(e) => { setUrl(e.target.value); setError(null) }} placeholder={guide.placeholder} spellCheck={false} />
              </Field>
              <p className="muted">Treat this address like a password: anyone who has it can see your calendar.</p>
              {error && (
                <div className="cal-error" role="alert">
                  <strong>{error.message}</strong> {error.tip}
                  {later && <> Or <button type="button" className="link-button" onClick={() => pick(null)}>set this up later</button>.</>}
                </div>
              )}
              <div className="row-end">
                <Button onClick={connect} disabled={busy || !url.trim()}>{busy ? 'Checking your calendar…' : `Connect ${guide.title}`}</Button>
              </div>
            </div>
          )}
        </div>
      ))}
      {later && (
        <div>
          <Choice selected={later.chosen} title="None of these" sub={`Or not now. You'll schedule lessons in ${BRAND_NAME}.`} onSelect={() => pick(null)} />
          {later.chosen && (
            <div className="choice-detail">
              <p className="muted">That works. Everything in {BRAND_NAME} runs without a calendar, and you can connect one any time in Settings.</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** One line of a single-choice list, with room under it for what the choice opens. */
export function Choice({ selected, title, sub, onSelect }: { selected: boolean; title: string; sub?: string; onSelect: () => void }) {
  return (
    <button type="button" role="radio" aria-checked={selected} className="choice" onClick={onSelect}>
      <span className="choice-dot" aria-hidden="true" />
      <span>
        <span className="choice-title">{title}</span>
        {sub && <span className="choice-sub">{sub}</span>}
      </span>
    </button>
  )
}
