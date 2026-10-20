import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { PenTool } from 'lucide-react'
import {
  Button, PageLoading, ConfirmDialog, CopyButton, Field, Input,
  Dialog, DialogTrigger, DialogContent, DialogTitle, DialogClose,
} from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { useToast } from '../lib/toast.tsx'

function boardUrl(id: string): string {
  return `${window.location.origin}/b/${id}`
}

interface BoardSummary {
  id: string
  title: string | null
  class_id: string | null
  student_id: string | null
  student_name: string | null
  class_name: string | null
  created_at: string
}

function boardOwner(b: BoardSummary): string | null {
  if (b.student_name) return b.student_name
  if (b.class_name) return b.class_name
  return null
}

// Tutor-facing board management (PLAN.md §6.3). The board page itself
// (BoardPage/BoardCanvas) is chromeless and lives outside the app shell —
// this is just where a tutor creates one and gets the link to send.
export function LivePage() {
  const toast = useToast()
  const [boards, setBoards] = useState<BoardSummary[] | null>(null)
  const [error, setError] = useState('')
  const [archiveTarget, setArchiveTarget] = useState<BoardSummary | null>(null)

  async function reload() {
    const res = await apiFetch('/api/tutor/boards')
    setBoards(res.boards)
  }

  useEffect(() => {
    reload()
  }, [])

  async function createBoard(title: string) {
    setError('')
    try {
      await apiFetch('/api/tutor/boards', { method: 'POST', body: JSON.stringify({ title: title || undefined }) })
      await reload()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function archive(id: string) {
    try {
      await apiFetch(`/api/tutor/boards/${id}`, { method: 'DELETE' })
      await reload()
    } catch (err) {
      toast((err as Error).message)
    }
  }

  return (
    <div className="screen">
      {error && <p className="field-error">{error}</p>}

      {boards === null ? (
        <PageLoading />
      ) : (
        <>
          {boards.length > 0 && (
            <div className="card-grid-3" style={{ marginBottom: 24 }}>
              {boards.map((b) => (
                <div key={b.id} className="surface-card" style={{ padding: 20 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, marginBottom: 4 }}>
                    {b.title || 'Untitled board'}
                  </div>
                  <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginBottom: 16 }}>
                    {boardOwner(b) || 'No roster'} · created {new Date(b.created_at).toLocaleDateString()}
                  </div>
                  <Link to={`/b/${b.id}`} className="card-cta">Open board</Link>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                    <CopyButton text={boardUrl(b.id)} />
                    <Button variant="ghost" onClick={() => setArchiveTarget(b)}>Archive</Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="dashed-cta">
            <div className="dashed-cta-icon">
              <PenTool size={21} strokeWidth={1.8} />
            </div>
            <div className="dashed-cta-body">
              <div className="dashed-cta-title">Start a persistent board</div>
              <div className="dashed-cta-sub">Its link stays the same every session — send it once and reuse it.</div>
            </div>
            <NewBoardDialog onCreate={createBoard} trigger={<Button variant="secondary">New board</Button>} />
          </div>
        </>
      )}

      <ConfirmDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title={`Archive ${archiveTarget?.title || 'this board'}?`}
        description="Its link stops working."
        confirmLabel="Archive"
        onConfirm={() => archiveTarget && archive(archiveTarget.id)}
      />
    </div>
  )
}

function NewBoardDialog({ onCreate, trigger }: { onCreate: (title: string) => Promise<void>; trigger: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (saving) return
    setSaving(true)
    try {
      await onCreate(title.trim())
      setTitle('')
      setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent>
        <DialogTitle>New board</DialogTitle>
        <Field label="Title (optional)">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div className="row-end">
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={submit} disabled={saving}>{saving ? 'Creating…' : 'Create'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
