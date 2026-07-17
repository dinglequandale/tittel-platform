import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Button, Table, EmptyState, Field, Input, CopyButton, PageLoading, ConfirmDialog,
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
  created_at: string
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
    <div>
      <div className="page-toolbar">
        <h1>Live</h1>
        <NewBoardDialog onCreate={createBoard} />
      </div>
      {error && <p className="field-error">{error}</p>}

      {boards === null ? (
        <PageLoading />
      ) : boards.length === 0 ? (
        <EmptyState title="No boards yet" description="Start a persistent board — its link stays the same every session." />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Link</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {boards?.map((b) => (
              <tr key={b.id}>
                <td>{b.title || <span className="muted">Untitled board</span>}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
                    <code>{boardUrl(b.id)}</code>
                    <CopyButton text={boardUrl(b.id)} />
                  </div>
                </td>
                <td>{new Date(b.created_at).toLocaleDateString()}</td>
                <td style={{ display: 'flex', gap: '0.375rem' }}>
                  <Link to={`/b/${b.id}`}>
                    <Button variant="ghost">Open</Button>
                  </Link>
                  <Button variant="ghost" onClick={() => setArchiveTarget(b)}>
                    Archive
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
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

function NewBoardDialog({ onCreate }: { onCreate: (title: string) => Promise<void> }) {
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
      <DialogTrigger asChild>
        <Button>New board</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>New board</DialogTitle>
        <Field label="Title (optional)">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <DialogClose asChild>
            <Button variant="ghost">Cancel</Button>
          </DialogClose>
          <Button onClick={submit} disabled={saving}>{saving ? 'Creating…' : 'Create'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
