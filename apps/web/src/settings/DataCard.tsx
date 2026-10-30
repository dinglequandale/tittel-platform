import { useState } from 'react'
import { Button, Field, Input, Dialog, DialogContent, DialogTitle, DialogClose } from '@tittel/ui'
import { supabase } from '../lib/supabase.ts'
import { apiFetch } from '../lib/api.ts'
import { useToast } from '../lib/toast.tsx'

/** Settings → Your data: take everything away as one file, or delete the workspace. */
export function DataCard({ orgName }: { orgName: string }) {
  const toast = useToast()
  const [exporting, setExporting] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)

  // A plain link can't carry the sign-in header, so the file is fetched and handed over.
  async function download() {
    setExporting(true)
    try {
      const { data } = await supabase.auth.getSession()
      const res = await fetch('/api/tutor/export', { headers: { authorization: `Bearer ${data.session?.access_token ?? ''}` } })
      if (!res.ok) throw new Error(`Export failed (${res.status})`)
      const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') ?? '')?.[1] ?? 'export.json'
      const url = URL.createObjectURL(await res.blob())
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setExporting(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await apiFetch('/api/tutor/org', { method: 'DELETE', body: JSON.stringify({ confirm: typed }) })
      await supabase.auth.signOut()
    } catch (err) {
      toast((err as Error).message)
      setBusy(false)
    }
  }

  return (
    <div className="surface-card settings-card">
      <div className="card-title">Your data</div>
      <div className="list-row">
        <div>
          <div className="list-row-title">Download everything</div>
          <div className="list-row-sub">Students, lessons, notes, plans, problems, homework and answers, and every uploaded file, in one JSON file.</div>
        </div>
        <Button variant="secondary" onClick={download} disabled={exporting}>{exporting ? 'Preparing…' : 'Download'}</Button>
      </div>
      <div className="list-row">
        <div>
          <div className="list-row-title">Delete this workspace</div>
          <div className="list-row-sub">Removes all of it for good, and every student and homework link stops working.</div>
        </div>
        <Button variant="danger" onClick={() => { setTyped(''); setDeleting(true) }}>Delete…</Button>
      </div>

      <Dialog open={deleting} onOpenChange={setDeleting}>
        <DialogContent>
          <DialogTitle>Delete {orgName}?</DialogTitle>
          <p className="muted">
            Every student, lesson, plan, problem, piece of homework, answer and file goes, and links you've sent stop working.
            This can't be undone. Download your data first if you might want it.
          </p>
          <p className="muted">Your sign-in stays. Signing in again starts an empty workspace.</p>
          <Field label={`Type “${orgName}” to confirm`}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </Field>
          <div className="row-end">
            <DialogClose asChild><Button variant="ghost">Keep it</Button></DialogClose>
            <Button variant="danger" onClick={remove} disabled={busy || typed.trim().toLowerCase() !== orgName.trim().toLowerCase()}>
              {busy ? 'Deleting…' : 'Delete everything'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
