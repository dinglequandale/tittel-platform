import { useEffect, useRef, useState } from 'react'
import { Sparkles, FileText, ChevronLeft } from 'lucide-react'
import {
  Button, Field, Input, EmptyState, PageLoading, ConfirmDialog,
  Dialog, DialogTrigger, DialogContent, DialogTitle, DialogClose,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { useToast } from '../lib/toast.tsx'
import { RichText } from '../lib/Math.tsx'
import { AiImportReview } from './AiImportReview.tsx'
import type { AiImportDraft } from './AiImportReview.tsx'
import type { Problem, ProblemSetDetail, ProblemSetSummary } from './types.ts'

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

export function SetsTab() {
  const toast = useToast()
  const [sets, setSets] = useState<ProblemSetSummary[] | null>(null)
  const [detail, setDetail] = useState<ProblemSetDetail | null>(null)
  const [bank, setBank] = useState<Problem[]>([])
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [archiveConfirm, setArchiveConfirm] = useState(false)
  const [aiEnabled, setAiEnabled] = useState(false)
  const [aiDraft, setAiDraft] = useState<{ draft: AiImportDraft; filename: string } | null>(null)
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
  useEffect(() => {
    apiFetch('/api/tutor/ai-import/status').then((r) => setAiEnabled(!!r.enabled)).catch(() => {})
  }, [])

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
    try {
      await apiFetch(`/api/tutor/problem-sets/${detail.id}/problems`, {
        method: 'POST', body: JSON.stringify({ problemId }),
      })
      await openSet(detail.id)
      await reload()
    } catch (err) {
      toast((err as Error).message)
    }
  }

  async function removeProblem(problemId: string) {
    if (!detail) return
    try {
      await apiFetch(`/api/tutor/problem-sets/${detail.id}/problems/${problemId}`, { method: 'DELETE' })
      await openSet(detail.id)
      await reload()
    } catch (err) {
      toast((err as Error).message)
    }
  }

  async function reorder(problemIds: string[]) {
    if (!detail) return
    try {
      await apiFetch(`/api/tutor/problem-sets/${detail.id}/order`, {
        method: 'PUT', body: JSON.stringify({ problemIds }),
      })
      await openSet(detail.id)
    } catch (err) {
      toast((err as Error).message)
    }
  }

  function move(index: number, dir: -1 | 1) {
    if (!detail) return
    const ids = detail.problems.map((p) => p.id)
    const j = index + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[index], ids[j]] = [ids[j], ids[index]]
    void reorder(ids)
  }

  async function archiveSet(id: string) {
    try {
      await apiFetch(`/api/tutor/problem-sets/${id}`, { method: 'DELETE' })
      if (detail?.id === id) setDetail(null)
      await reload()
    } catch (err) {
      toast((err as Error).message)
    }
  }

  async function importFile(file: File) {
    setImporting(true)
    setError('')
    try {
      const text = await file.text()
      const json = JSON.parse(text)
      await apiFetch('/api/tutor/problem-sets/import', { method: 'POST', body: JSON.stringify(json) })
      await reload()
      toast('Problem set imported')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const availableToAdd = bank.filter((p) => !detail?.problems.some((sp) => sp.id === p.id))

  if (aiDraft) {
    return (
      <AiImportReview
        draft={aiDraft.draft}
        filename={aiDraft.filename}
        onDiscard={() => setAiDraft(null)}
        onCommitted={(setId) => {
          setAiDraft(null)
          reload().then(() => openSet(setId))
        }}
      />
    )
  }

  if (detail) {
    return (
      <div>
        <button className="content-back" onClick={() => setDetail(null)}>
          <ChevronLeft size={14} strokeWidth={2} /> Back to sets
        </button>
        <div className="editor-card">
          <div className="page-toolbar" style={{ marginBottom: 0 }}>
            <strong>{detail.title}</strong>
            <div style={{ display: 'flex', gap: '0.375rem', alignItems: 'center' }}>
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
              <Button variant="danger" onClick={() => setArchiveConfirm(true)}>Archive</Button>
            </div>
          </div>
          <p className="muted">Changes here apply to homework you assign from now on. Already-assigned homework keeps its questions.</p>
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
        </div>

        <ConfirmDialog
          open={archiveConfirm}
          onOpenChange={setArchiveConfirm}
          title={`Archive ${detail.title || 'this set'}?`}
          description="Assignments already using it are unaffected; it stops appearing for new ones."
          confirmLabel="Archive"
          onConfirm={() => archiveSet(detail.id)}
        />
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginBottom: 18 }}>
        <AiImportDialog
          enabled={aiEnabled}
          onImported={(draft, filename) => setAiDraft({ draft, filename })}
        />
        <NewSetDialog onCreate={createSet} />
        <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }}
          onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
        <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={importing}>
          {importing ? 'Importing…' : 'Import JSON'}
        </Button>
      </div>
      {error && <p className="field-error">{error}</p>}
      {sets === null ? (
        <PageLoading />
      ) : sets.length === 0 ? (
        <EmptyState title="No problem sets yet" description="Generate one from a lesson plan or worksheet, or assemble one from the bank." />
      ) : (
        <div className="card-grid-3">
          {sets.map((s) => (
            <button key={s.id} className="surface-card entity-card" onClick={() => openSet(s.id)}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                <div className="entity-card-icon" style={{ background: 'var(--surface-2)', color: 'var(--ink-2)', marginBottom: 0 }}>
                  <FileText size={17} strokeWidth={1.8} />
                </div>
                <span className="badge">{s.template}</span>
              </div>
              <div className="entity-card-title">{s.title}</div>
              <div className="entity-card-meta"><span>{s.problem_count} problems</span></div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

export function AiImportDialog({ enabled, onImported }: { enabled: boolean; onImported: (draft: AiImportDraft, filename: string) => void }) {
  const [open, setOpen] = useState(false)
  const [hint, setHint] = useState('')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File) {
    setImporting(true)
    setError('')
    try {
      const dataBase64 = await fileToBase64(file)
      const { draft } = await apiFetch('/api/tutor/ai-import', {
        method: 'POST',
        body: JSON.stringify({ filename: file.name, mimeType: file.type, dataBase64, hint: hint.trim() || undefined }),
      })
      onImported(draft, file.name)
      setOpen(false)
      setHint('')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  if (!enabled) {
    return (
      <Button variant="primary" disabled title="Set ANTHROPIC_API_KEY on the server to turn this on">
        <Sparkles size={16} strokeWidth={1.75} /> Generate from document
      </Button>
    )
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="primary"><Sparkles size={16} strokeWidth={1.75} /> Generate from document</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogTitle>Generate a set from a document</DialogTitle>
        <p className="muted">Upload a lesson plan or worksheet (PDF, DOCX, or text) — Claude extracts the problems for you to review before anything is saved.</p>
        <Field label="Hint (optional)">
          <Input value={hint} onChange={(e) => setHint(e.target.value)} placeholder="e.g. SAT math, answers are on the last page" />
        </Field>
        <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" style={{ display: 'none' }}
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
        {importing && <p className="muted">Reading your document…</p>}
        {error && <p className="field-error">{error}</p>}
        <div className="row-end">
          <DialogClose asChild><Button variant="ghost" disabled={importing}>Cancel</Button></DialogClose>
          <Button onClick={() => fileRef.current?.click()} disabled={importing}>
            {importing ? 'Reading…' : 'Choose file'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

function NewSetDialog({ onCreate }: { onCreate: (title: string) => Promise<void> }) {
  const [title, setTitle] = useState('')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  async function submit() {
    if (!title.trim() || saving) return
    setSaving(true)
    try {
      await onCreate(title.trim())
      setTitle(''); setOpen(false)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="secondary">New blank set</Button></DialogTrigger>
      <DialogContent>
        <DialogTitle>New problem set</DialogTitle>
        <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
        <div className="row-end">
          <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
          <Button onClick={submit} disabled={saving}>{saving ? 'Creating…' : 'Create'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
