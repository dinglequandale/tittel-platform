import { useEffect, useRef, useState } from 'react'
import { BookOpen, ChevronLeft } from 'lucide-react'
import { Button, EmptyState, PageLoading, ConfirmDialog } from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { useToast } from '../lib/toast.tsx'
import type { LessonSummary } from './types.ts'

// Plans (the `lessons` table; the UI says "Plan" because a Lesson is now a
// scheduled meeting, FLOW-SPEC §1.1). The composer is O3; for now plans
// round-trip as JSON and are attached to lessons from the lesson page.
export function LessonsTab() {
  const toast = useToast()
  const [lessons, setLessons] = useState<LessonSummary[] | null>(null)
  const [detail, setDetail] = useState<{ id: string; title: string; doc: unknown } | null>(null)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
  const [archiveConfirm, setArchiveConfirm] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  async function reload() {
    const { lessons } = await apiFetch('/api/tutor/lessons')
    setLessons(lessons)
  }

  useEffect(() => { reload() }, [])

  async function openLesson(id: string) {
    const { lesson } = await apiFetch(`/api/tutor/lessons/${id}`)
    setDetail(lesson)
  }

  async function importFile(file: File) {
    setImporting(true)
    setError('')
    try {
      const text = await file.text()
      const json = JSON.parse(text)
      await apiFetch('/api/tutor/lessons/import', { method: 'POST', body: JSON.stringify(json) })
      await reload()
      toast('Plan imported')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function archive(id: string) {
    try {
      await apiFetch(`/api/tutor/lessons/${id}`, { method: 'DELETE' })
      if (detail?.id === id) setDetail(null)
      await reload()
    } catch (err) {
      toast((err as Error).message)
    }
  }

  function exportLesson(id: string, title: string) {
    apiFetch(`/api/tutor/lessons/${id}/export`)
      .then((doc) => {
        const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `${title}.json`
        a.click()
        URL.revokeObjectURL(url)
      })
      .catch((err) => toast((err as Error).message))
  }

  if (detail) {
    return (
      <div>
        <button className="content-back" onClick={() => setDetail(null)}>
          <ChevronLeft size={14} strokeWidth={2} /> Back to plans
        </button>
        <div className="editor-card">
          <div className="page-toolbar" style={{ marginBottom: 0 }}>
            <strong>{detail.title}</strong>
            <div className="toolbar-actions">
              <Button variant="ghost" onClick={() => exportLesson(detail.id, detail.title)}>Export JSON</Button>
              <Button variant="danger" onClick={() => setArchiveConfirm(true)}>Archive</Button>
            </div>
          </div>
          <pre className="preview-card" style={{ overflow: 'auto', maxHeight: 480, fontSize: '0.8125rem' }}>
            {JSON.stringify(detail.doc, null, 2)}
          </pre>
        </div>

        <ConfirmDialog
          open={archiveConfirm}
          onOpenChange={setArchiveConfirm}
          title="Archive this plan?"
          description="It's removed from your library. Lessons that already use it keep it."
          confirmLabel="Archive"
          onConfirm={() => archive(detail.id)}
        />
      </div>
    )
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 18 }}>
        <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }}
          onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
        <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={importing}>
          {importing ? 'Importing…' : 'Import JSON'}
        </Button>
      </div>
      {error && <p className="field-error">{error}</p>}
      {lessons === null ? (
        <PageLoading />
      ) : lessons.length === 0 ? (
        <EmptyState title="No plans yet" description="Import a plan file, or add one straight from a lesson." />
      ) : (
        <div className="card-grid-3">
          {lessons.map((l) => (
            <button key={l.id} className="surface-card entity-card" onClick={() => openLesson(l.id)}>
              <div className="entity-card-icon"><BookOpen size={17} strokeWidth={1.8} /></div>
              <div className="entity-card-title">{l.title}</div>
              <div className="entity-card-meta"><span>Plan</span><span>v{l.version}</span></div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
