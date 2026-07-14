import { useEffect, useRef, useState } from 'react'
import { Button, EmptyState } from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import type { LessonSummary } from './types.ts'

// Full visual lesson builder is Phase 4 (PLAN.md §6.4/§10) — for now, Phase 1
// only needs the lessons table wired up with JSON import/export so existing
// lesson files round-trip through the new schema.
export function LessonsTab() {
  const [lessons, setLessons] = useState<LessonSummary[] | null>(null)
  const [detail, setDetail] = useState<{ id: string; title: string; doc: unknown } | null>(null)
  const [error, setError] = useState('')
  const [importing, setImporting] = useState(false)
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
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function archive(id: string) {
    await apiFetch(`/api/tutor/lessons/${id}`, { method: 'DELETE' })
    if (detail?.id === id) setDetail(null)
    await reload()
  }

  function exportLesson(id: string, title: string) {
    apiFetch(`/api/tutor/lessons/${id}/export`).then((doc) => {
      const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${title}.json`
      a.click()
      URL.revokeObjectURL(url)
    })
  }

  return (
    <div className="split-panel">
      <div>
        <div className="page-toolbar" style={{ marginBottom: '0.75rem' }}>
          <strong>Lessons</strong>
          <div className="toolbar-actions">
            <input ref={fileRef} type="file" accept="application/json" style={{ display: 'none' }}
              onChange={(e) => e.target.files?.[0] && importFile(e.target.files[0])} />
            <Button variant="ghost" onClick={() => fileRef.current?.click()} disabled={importing}>
              {importing ? 'Importing…' : 'Import JSON'}
            </Button>
          </div>
        </div>
        {error && <p className="field-error">{error}</p>}
        {lessons && lessons.length === 0 ? (
          <EmptyState title="No lessons yet" description="Import a lesson-plan JSON file to get started." />
        ) : (
          <div className="panel-list">
            {lessons?.map((l) => (
              <button key={l.id} className="panel-list-item" data-active={detail?.id === l.id} onClick={() => openLesson(l.id)}>
                <span className="item-title">{l.title}</span>
                <span className="item-meta">v{l.version}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="editor-card">
        {!detail ? (
          <p className="muted">Select a lesson to view its pages, or import one.</p>
        ) : (
          <>
            <div className="page-toolbar" style={{ marginBottom: 0 }}>
              <strong>{detail.title}</strong>
              <div className="toolbar-actions">
                <Button variant="ghost" onClick={() => exportLesson(detail.id, detail.title)}>Export JSON</Button>
                <Button variant="danger" onClick={() => archive(detail.id)}>Archive</Button>
              </div>
            </div>
            <pre className="preview-card" style={{ overflow: 'auto', maxHeight: 480, fontSize: '0.8125rem' }}>
              {JSON.stringify(detail.doc, null, 2)}
            </pre>
          </>
        )}
      </div>
    </div>
  )
}
