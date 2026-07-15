import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Button, Table, EmptyState, Field, Input, Dialog, DialogTrigger, DialogContent, DialogTitle, DialogClose } from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'

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
  const [boards, setBoards] = useState<BoardSummary[] | null>(null)
  const [error, setError] = useState('')

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
    await apiFetch(`/api/tutor/boards/${id}`, { method: 'DELETE' })
    await reload()
  }

  return (
    <div>
      <div className="page-toolbar">
        <h1>Live</h1>
        <NewBoardDialog onCreate={createBoard} />
      </div>
      {error && <p className="field-error">{error}</p>}

      {boards && boards.length === 0 ? (
        <EmptyState title="No boards yet" description="Start a persistent board — its link stays the same every session." />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Title</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {boards?.map((b) => (
              <tr key={b.id}>
                <td>{b.title || <span className="muted">Untitled board</span>}</td>
                <td>{new Date(b.created_at).toLocaleDateString()}</td>
                <td style={{ display: 'flex', gap: '0.375rem' }}>
                  <Link to={`/b/${b.id}`}>
                    <Button variant="ghost">Open</Button>
                  </Link>
                  <Button variant="ghost" onClick={() => archive(b.id)}>
                    Archive
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  )
}

function NewBoardDialog({ onCreate }: { onCreate: (title: string) => Promise<void> }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')

  async function submit() {
    await onCreate(title.trim())
    setTitle('')
    setOpen(false)
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
          <Button onClick={submit}>Create</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
