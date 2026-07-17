import { useEffect, useState } from 'react'
import { Button, Field, Input, EmptyState, PageLoading, ConfirmDialog } from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { useToast } from '../lib/toast.tsx'
import type { Tag } from './types.ts'

export function TagsTab() {
  const toast = useToast()
  const [tags, setTags] = useState<Tag[] | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<Tag | null>(null)

  async function reload() {
    const { tags } = await apiFetch('/api/tutor/tags')
    setTags(tags)
  }

  useEffect(() => { reload() }, [])

  async function create() {
    if (!name.trim()) return
    try {
      await apiFetch('/api/tutor/tags', { method: 'POST', body: JSON.stringify({ name: name.trim() }) })
      setName('')
      await reload()
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function remove(id: string) {
    try {
      await apiFetch(`/api/tutor/tags/${id}`, { method: 'DELETE' })
      await reload()
    } catch (err) {
      toast((err as Error).message)
    }
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <Field label="New tag" error={error}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
          <Button onClick={create}>Add</Button>
        </div>
      </Field>
      {tags === null ? (
        <PageLoading />
      ) : tags.length === 0 ? (
        <EmptyState title="No tags yet" description="Tags organize the problem bank by topic." />
      ) : (
        <div className="tag-pill-row" style={{ marginTop: '0.75rem' }}>
          {tags.map((t) => (
            <span key={t.id} className="badge">
              {t.name}{' '}
              <button className="badge-x" onClick={() => setDeleteTarget(t)} aria-label={`Remove ${t.name}`}>×</button>
            </span>
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={`Delete ${deleteTarget?.name}?`}
        description="Problems and lessons keep their content, they just lose this tag."
        confirmLabel="Delete"
        onConfirm={() => deleteTarget && remove(deleteTarget.id)}
      />
    </div>
  )
}
