import { Button } from '@tittel/ui'
import { BRAND_NAME } from '@tittel/shared'
import { supabase } from '../lib/supabase.ts'
import { useSession } from '../lib/useSession.ts'

// Account/settings surface (PLAN.md §6.7). Billing/seat management arrives with
// the plans work; for now this shows the real account and sign-out.
export function SettingsPage() {
  const { session } = useSession()

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
          <span className="kv-row-val">{BRAND_NAME}</span>
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
