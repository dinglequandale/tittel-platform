import { useEffect, useRef, useState } from 'react'
import {
  Button, Field, Input, EmptyState,
  Dialog, DialogTrigger, DialogContent, DialogTitle, DialogClose,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { RichText } from '../lib/Math.tsx'
import type { Problem, ProblemSetDetail, ProblemSetSummary } from './types.ts'

export function SetsTab() {
  const [sets, setSets] = useState<ProblemSetSummary[] | null>(null)
  const [detail, setDetail] = useState<ProblemSetDetail | null>(null)
  const [bank, setBank] = useState<Problem[]>([])
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function reload() {
    const [s, p] = await Promise.all([
      apiFetch('/api/tutor/problem-sets'),
      apiFetch('/api/tutor/problems'),
    ])
    setSets(s.problemSets)
    setBank(p.problems)
  }

  useEffect(() => { reload() }, [])

  async function openSet(id: string) {
    const { problemSet } = await apiFetch(`/api/tutor/problem-sets/${id}`)
    setDetail(problemSet)
  }

  async function createSet(title: string) {
    const { problemSet } = await apiFetch('/api/tutor/problem-sets', {
      method: 'POST', body: JSON.stringify({ title }),
    })
    await reload()
    await openSet(problemSet.id)
  }

  async function addProblem(problemId: string) {
    if (!detail) return
    await apiFetch(`/api/tutor/problem-sets/${detail.id}/problems`, {
      method: 'POST', body: JSON.stringify({ problemId }),
    })
    await openSet(detail.id)
    await reload()
  }

  async function removeProblem(problemId: string) {
    if (!detail) return
    await apiFetch(`/api/tutor/problem-sets/${detail.id}/problems/${problemId}`, { method: 'DELETE' })
    await openSet(detail.id)
    await reload()
  }

  async function reorder(problemIds: string[]) {
    if (!detail) return
    await apiFetch(`/api/tutor/problem-sets/${detail.id}/order`, {
      method: 'PUT', body: JSON.stringify({ problemIds }),
    })
    await openSet(detail.id)
  }

  function move(index: number, dir: -1 | 1) {
    if (!detail) return
    const ids = detail.problems.map((p) => p.id)
    const j = index + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[index], ids[j]] = [ids[j], ids[index]]
    reorder(ids)
  }

  async function importFile(file: File) {
    setImporting(true)
    setError('')
    try {
      const text = await file.text()
      const json = JSON.parse(text)
      await apiFetch('/api/tutor/problem-sets/import', { method: 'POST', body: JSON.stringify(json) })
      await reload()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const availableToAdd = bank.filter((p) => !detail?.problems.some((sp) => sp.id === p.id))

  return (
    <div className="split-panel">
      <div>
        <div className="page-toolbar" style={{ marginBottom: '0.75rem' }}>
          <strong>Sets</strong>
          <div className="toolbar-actions">
            <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }}
              onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
            <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={importing}>
              {importing ? 'Importing…' : 'Import JSON'}
            </Button>
            <NewSetDialog onCreate={createSet} />
          </div>
        </div>
        {error && <p className="field-error">{error}</p>}
        {sets && sets.length === 0 ? (
          <EmptyState title="No problem sets yet" description="Compose one from the bank, or import a legacy JSON file." />
        ) : (
          <div className="panel-list">
            {sets?.map((s) => (
              <button key={s.id} className="panel-list-item" data-active={detail?.id === s.id} onClick={() => openSet(s.id)}>
                <span className="item-title">{s.title}</span>
                <span className="item-meta">{s.problem_count} problems · {s.template}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="editor-card">
        {!detail ? (
          <p className="muted">Select a set, or create a new one.</p>
        ) : (
          <>
            <div className="page-toolbar" style={{ marginBottom: 0 }}>
              <strong>{detail.title}</strong>
              {availableToAdd.length > 0 && (
                <Select onValueChange={addProblem}>
                  <SelectTrigger><SelectValue placeholder="Add problem from bank…" /></SelectTrigger>
                  <SelectContent>
                    {availableToAdd.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {p.stem_latex.replace(/\$/g, '').slice(0, 40) || '(empty stem)'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
            {detail.problems.length === 0 ? (
              <p className="muted">No problems in this set yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {detail.problems.map((p, i) => (
                  <div key={p.id} className="set-problem-row">
                    <div style={{ minWidth: 0 }}>
                      <RichText text={p.stem_latex} figures={p.figures.filter((f): f is typeof f & { svg: string } => !!f.svg)} />
                    </div>
                    <div style={{ display: 'flex', gap: '0.25rem', flexShrink: 0 }}>
                      <Button variant="ghost" onClick={() => move(i, -1)} disabled={i === 0}>↑</Button>
                      <Button variant="ghost" onClick={() => move(i, 1)} disabled={i === detail.problems.length - 1}>↓</Button>
                      <Button variant="ghost" onClick={() => removeProblem(p.id)}>Remove</Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function NewSetDialog({ onCreate }: { onCreate: (title: string) => Promise<void> }) {
  const [title, setTitle] = useState('')
  const [open, setOpen] = useState(false)

  async function submit() {
    if (!title.trim()) return
    await onCreate(title.trim())
    setTitle(''); setOpen(false)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button>New set</Button></DialogTrigger>
      <DialogContent>
        <DialogTitle>New problem set</DialogTitle>
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
          <Button onClick={submit}>Create</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
