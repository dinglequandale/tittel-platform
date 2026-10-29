import { useRef, useState, type ReactNode } from 'react'
import {
  Button, Field, Input, Dialog, DialogContent, DialogTitle, DialogClose,
} from '@tittel/ui'

/** Drop files here, or click to choose: the way tutors bring in what they already have. */
export function DropZone({
  accept, multiple = false, busy, onFiles, children,
}: { accept: string; multiple?: boolean; busy?: string | null; onFiles: (files: File[]) => void; children: ReactNode }) {
  const input = useRef<HTMLInputElement>(null)
  const [over, setOver] = useState(false)
  return (
    <div className="drop-zone" data-over={over} data-busy={!!busy} role="button" tabIndex={0}
      onClick={() => !busy && input.current?.click()}
      onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !busy) { e.preventDefault(); input.current?.click() } }}
      onDragOver={(e) => { e.preventDefault(); setOver(true) }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault(); setOver(false)
        if (!busy && e.dataTransfer.files.length) onFiles([...e.dataTransfer.files].slice(0, multiple ? 20 : 1))
      }}>
      <input ref={input} type="file" accept={accept} multiple={multiple} hidden
        onChange={(e) => { if (e.target.files?.length) onFiles([...e.target.files]); e.target.value = '' }} />
      {busy ? <span className="muted">{busy}</span> : children}
    </div>
  )
}

/**
 * Type or paste text (from ChatGPT, a doc, your notes) and turn it into
 * something: a plan or a homework set. `describe` says what the text reads
 * as so far, so the tutor sees it was understood before going on.
 */
export function PasteDialog({
  title, nameLabel, defaultName, placeholder, hint, describe, confirmLabel, onUse, onClose,
}: {
  title: string
  nameLabel: string
  defaultName: string
  placeholder: string
  hint: string
  describe: (text: string) => string
  confirmLabel: string
  onUse: (text: string, name: string) => Promise<void> | void
  onClose: () => void
}) {
  const [text, setText] = useState('')
  const [name, setName] = useState(defaultName)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="dialog-content dialog-wide" onInteractOutside={(e) => text.trim() && e.preventDefault()}>
        <DialogTitle>{title}</DialogTitle>
        <Field label={nameLabel}><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Text" hint={hint}>
          <textarea className="input" rows={12} autoFocus value={text} placeholder={placeholder} onChange={(e) => setText(e.target.value)} />
        </Field>
        {text.trim() && <p className="muted">{describe(text)}</p>}
        {error && <p className="field-error">{error}</p>}
        <div className="row-end">
          <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
          <Button disabled={!text.trim() || busy} onClick={async () => {
            setBusy(true); setError('')
            try { await onUse(text, name) } catch (err) { setError((err as Error).message); setBusy(false) }
          }}>{busy ? 'Working…' : confirmLabel}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
