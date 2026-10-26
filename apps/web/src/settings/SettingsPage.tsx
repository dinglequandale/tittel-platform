import { useEffect, useState } from 'react'
import { Button, Field, Input } from '@tittel/ui'
import { supabase } from '../lib/supabase.ts'
import { useSession } from '../lib/useSession.ts'
import { apiFetch } from '../lib/api.ts'
import { useToast } from '../lib/toast.tsx'

// Account/settings surface (PLAN.md §6.7). Billing/seat management arrives with
// the plans work; for now: the account, the lesson defaults, and sign-out.
export function SettingsPage() {
  const { session } = useSession()
  const toast = useToast()
  const [orgName, setOrgName] = useState('')
  const [meetingUrl, setMeetingUrl] = useState('')
  const [saved, setSaved] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    apiFetch('/api/tutor/org')
      .then((o) => { setOrgName(o.name); setMeetingUrl(o.defaultMeetingUrl); setSaved(o.defaultMeetingUrl) })
      .catch(() => {})
  }, [])

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
        <div className="kv-row">
          <span className="kv-row-key">Workspace</span>
          <span className="kv-row-val">{orgName || '—'}</span>
        </div>
      </div>

      <div className="surface-card settings-card">
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
      </div>

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
