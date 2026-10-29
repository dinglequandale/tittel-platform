import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Dialog, DialogContent, DialogTitle } from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'

/**
 * Once per workspace, before any students go in (OVERHAUL §5, child data):
 * the tutor confirms they have parents' permission and will keep student
 * details to what's needed. Shown in the app rather than at signup so it
 * covers Google sign-ups too.
 */
export function ConsentDialog({ onDone }: { onDone: () => void }) {
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  return (
    <Dialog open>
      <DialogContent onInteractOutside={(e) => e.preventDefault()} onEscapeKeyDown={(e) => e.preventDefault()}>
        <DialogTitle>Before you add students</DialogTitle>
        <p className="muted">Many tutoring students are children, so please confirm:</p>
        <ul className="consent-list">
          <li>I have a parent's or guardian's permission to use this app with each student under 13: their name, their homework, and photos of their work.</li>
          <li>I'll keep it to what's needed. A first name and last initial is enough, and a student's own email only if they're 13 or older.</li>
        </ul>
        <label className="check-row">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} />
          I confirm both
        </label>
        <p className="muted">How student information is handled: <Link to="/privacy" target="_blank">Privacy Policy</Link>.</p>
        <div className="row-end">
          <Button disabled={!checked || busy} onClick={async () => {
            setBusy(true)
            try {
              await apiFetch('/api/tutor/org', { method: 'PATCH', body: JSON.stringify({ consent: true }) })
              onDone()
            } finally {
              setBusy(false)
            }
          }}>Continue</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
