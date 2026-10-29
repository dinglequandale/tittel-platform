import { useEffect, useState } from 'react'
import { Button, Field, Input, Dialog, DialogContent, DialogTitle, DialogClose } from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { useToast } from '../lib/toast.tsx'

interface Contact { name: string; emails: { email: string; role: 'student' | 'parent' }[]; portal_token: string }

/** Who to write to: the parents' addresses, or the student's own when there are none. */
export function recipientsOf(students: Pick<Contact, 'emails'>[]): string[] {
  return [...new Set(students.flatMap((s) => {
    const parents = s.emails.filter((e) => e.role === 'parent').map((e) => e.email)
    return parents.length ? parents : s.emails.map((e) => e.email)
  }))]
}

export const portalLink = (token: string) => `${window.location.origin}/s/${token}`
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name

/**
 * A short update for a parent, drafted from what the app knows, for the
 * tutor to edit and send from their own email (or copy into a text). Nothing
 * is sent by the app.
 */
export function ParentUpdateDialog({
  load, onClose, draftWithAi,
}: {
  /** Builds the draft once its data is fetched: who it goes to and what it says. */
  load: () => Promise<{ to: string[]; subject: string; body: string }>
  onClose: () => void
  /** When Claude is on: the same facts written up as prose, replacing the message. */
  draftWithAi?: () => Promise<string>
}) {
  const toast = useToast()
  const [to, setTo] = useState('')
  const [subject, setSubject] = useState('')
  const [body, setBody] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [drafting, setDrafting] = useState(false)

  useEffect(() => {
    load().then((d) => { setTo(d.to.join(', ')); setSubject(d.subject); setBody(d.body) }).catch((e) => setError((e as Error).message))
  }, [])

  const mailto = `mailto:${to.split(/[,;\s]+/).filter(Boolean).map(encodeURIComponent).join(',')}`
    + `?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body ?? '')}`

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="dialog-content dialog-wide">
        <DialogTitle>Update for parents</DialogTitle>
        {error && <p className="field-error">{error}</p>}
        {body === null && !error ? <p className="muted">Drafting…</p> : (
          <>
            <Field label="To" hint={to ? undefined : 'No parent email saved yet. Add one under Students → Edit.'}>
              <Input type="email" multiple value={to} onChange={(e) => setTo(e.target.value)} placeholder="parent@example.com" />
            </Field>
            <Field label="Subject"><Input value={subject} onChange={(e) => setSubject(e.target.value)} /></Field>
            <Field label="Message"><textarea className="input" rows={10} value={body ?? ''} onChange={(e) => setBody(e.target.value)} /></Field>
            {draftWithAi && (
              <Button variant="ghost" disabled={drafting} onClick={async () => {
                setDrafting(true); setError('')
                try { setBody(await draftWithAi()) } catch (e) { setError((e as Error).message) } finally { setDrafting(false) }
              }}>{drafting ? 'Claude is writing…' : 'Write it up with Claude'}</Button>
            )}
            <p className="muted">Opens in your own email app to send. Or copy it into a text.</p>
            <div className="row-end">
              <DialogClose asChild><Button variant="ghost">Close</Button></DialogClose>
              <Button variant="secondary" onClick={() => navigator.clipboard.writeText(body ?? '').then(() => toast('Copied'), () => toast('Couldn’t copy'))}>Copy text</Button>
              <a className="btn btn-primary" href={mailto} onClick={() => setTimeout(onClose, 300)}>Open in email</a>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}

/** The students a lesson is with, with their addresses and portal links. */
export async function lessonContacts(l: { student_id: string | null; group_id: string | null }): Promise<Contact[]> {
  const [{ students }, { groups }] = await Promise.all([apiFetch('/api/tutor/students'), l.group_id ? apiFetch('/api/tutor/groups') : Promise.resolve({ groups: [] })])
  const ids: string[] = l.student_id ? [l.student_id] : (groups.find((g: { id: string }) => g.id === l.group_id)?.members ?? []).map((m: { id: string }) => m.id)
  return students.filter((s: { id: string }) => ids.includes(s.id))
}
