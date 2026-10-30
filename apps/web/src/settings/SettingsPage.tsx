import { useEffect, useState } from 'react'
import { Button, Field, Input } from '@tittel/ui'
import { supabase } from '../lib/supabase.ts'
import { useSession } from '../lib/useSession.ts'
import { apiFetch } from '../lib/api.ts'
import { useToast } from '../lib/toast.tsx'
import { CalendarCard } from './CalendarCard.tsx'
import { TeachingPrefs } from './TeachingPrefs.tsx'
import { ParentsCard } from './ParentsCard.tsx'
import { DataCard } from './DataCard.tsx'
import { useOrg } from '../lib/useOrg.ts'

// Account/settings surface (PLAN.md §6.7). Billing/seat management arrives with
// the plans work; for now: the account, the lesson defaults, and sign-out.
export function SettingsPage() {
  const { session } = useSession()
  const toast = useToast()
  const [orgName, setOrgName] = useState('')
  const [tutorName, setTutorName] = useState('')
  const [savedNames, setSavedNames] = useState({ org: '', tutor: '' })
  const [meetingUrl, setMeetingUrl] = useState('')
  const [saved, setSaved] = useState('')
  const [saving, setSaving] = useState(false)
  const [linkSource, setLinkSource] = useState<'invite' | 'own'>('invite')
  const [ai, setAi] = useState<{ available: boolean; on: boolean }>({ available: false, on: true })
  const org = useOrg()

  useEffect(() => {
    apiFetch('/api/tutor/org')
      .then((o) => {
        setOrgName(o.name); setMeetingUrl(o.defaultMeetingUrl); setSaved(o.defaultMeetingUrl)
        setTutorName(o.displayName ?? ''); setSavedNames({ org: o.name, tutor: o.displayName ?? '' })
        setLinkSource(o.meetingLinkSource === 'own' ? 'own' : 'invite')
        setAi({ available: !!o.aiAvailable, on: o.aiHelp !== false })
      })
      .catch(() => {})
  }, [])

  async function saveLinkSource(next: 'invite' | 'own') {
    const prev = linkSource
    setLinkSource(next)
    try {
      await apiFetch('/api/tutor/org', { method: 'PATCH', body: JSON.stringify({ meetingLinkSource: next }) })
    } catch (err) {
      setLinkSource(prev)
      toast((err as Error).message)
    }
  }

  async function saveAi(on: boolean) {
    setAi((a) => ({ ...a, on }))
    try {
      await apiFetch('/api/tutor/org', { method: 'PATCH', body: JSON.stringify({ aiHelp: on }) })
    } catch (err) {
      setAi((a) => ({ ...a, on: !on }))
      toast((err as Error).message)
    }
  }

  async function saveNames() {
    try {
      await apiFetch('/api/tutor/org', { method: 'PATCH', body: JSON.stringify({ name: orgName.trim(), displayName: tutorName.trim() }) })
      setSavedNames({ org: orgName.trim(), tutor: tutorName.trim() })
      toast('Saved')
    } catch (err) {
      toast((err as Error).message)
    }
  }

  async function saveMeetingUrl() {
    setSaving(true)
    try {
      await apiFetch('/api/tutor/org', { method: 'PATCH', body: JSON.stringify({ defaultMeetingUrl: meetingUrl.trim() || null }) })
      setSaved(meetingUrl.trim())
      toast('Saved')
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="screen-narrow" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="surface-card" style={{ padding: 22 }}>
        <div className="card-title" style={{ marginBottom: 16 }}>Account</div>
        <div className="kv-row">
          <span className="kv-row-key">Email</span>
          <span className="kv-row-val">{session?.user.email || '—'}</span>
        </div>
        <Field label="Your name"><Input value={tutorName} autoComplete="name" onChange={(e) => setTutorName(e.target.value)} /></Field>
        <Field label="Business name" hint="Shown to students and parents.">
          <Input value={orgName} onChange={(e) => setOrgName(e.target.value)} />
        </Field>
        <div className="row-end">
          <Button variant="secondary" onClick={saveNames}
            disabled={!orgName.trim() || (orgName.trim() === savedNames.org && tutorName.trim() === savedNames.tutor)}>Save</Button>
        </div>
      </div>

      <div className="surface-card settings-card">
        <div className="card-title">How you teach</div>
        <p className="muted">These set defaults and what's shown. Nothing is locked: any lesson can still be scheduled, started now or logged afterwards.</p>
        {org && <TeachingPrefs org={org} />}
      </div>

      {org && <ParentsCard org={org} />}

      {org?.teachWhere !== 'in_person' && <div className="surface-card settings-card">
        <div className="card-title">Lessons</div>
        <Field label="Your meeting link">
          <Input value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)}
            placeholder="https://meet.google.com/… or your Zoom personal room" />
        </Field>
        <p className="muted">
          Used for every lesson unless a student or a single lesson has its own. Students open it from “Join lesson” on their portal.
        </p>
        <div className="row-end">
          <Button onClick={saveMeetingUrl} disabled={saving || meetingUrl.trim() === saved}>{saving ? 'Saving…' : 'Save'}</Button>
        </div>
        <div className="radio-col">
          <div className="list-row-title">When a calendar invite has its own meeting link</div>
          <label className="check-row">
            <input type="radio" name="link-source" checked={linkSource === 'invite'} onChange={() => saveLinkSource('invite')} />
            Use the invite's link (for example, a new Meet for each invite)
          </label>
          <label className="check-row">
            <input type="radio" name="link-source" checked={linkSource === 'own'} onChange={() => saveLinkSource('own')} />
            Use the student's link, or mine above
          </label>
        </div>
      </div>}

      <CalendarCard />

      {ai.available && (
        <div className="surface-card settings-card">
          <div className="card-title">Claude</div>
          <label className="check-row">
            <input type="checkbox" checked={ai.on} onChange={(e) => saveAi(e.target.checked)} />
            Offer to draft things with Claude
          </label>
          <p className="muted">
            Reading worksheets into questions, more practice like what was missed, and writing up parent updates. Always a
            button you press, and you check everything before it goes out. Off hides these everywhere.
          </p>
        </div>
      )}

      {savedNames.org && <DataCard orgName={savedNames.org} />}

      <div className="surface-card" style={{ padding: 22, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 3 }}>Sign out</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-2)' }}>End your session on this device.</div>
        </div>
        <Button variant="secondary" onClick={() => supabase.auth.signOut()}>Sign out</Button>
      </div>
    </div>
  )
}
