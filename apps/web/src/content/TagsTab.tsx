import { useEffect, useState } from 'react'
import { Button, Field, Input, EmptyState } from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import type { Tag } from './types.ts'

export function TagsTab() {
  const [tags, setTags] = useState<Tag[] | null>(null)
  const [name, setName] = useState('')
  const [error, setError] = useState('')

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
    await apiFetch(`/api/tutor/tags/${id}`, { method: 'DELETE' })
    await reload()
  }

  return (
    <div style={{ maxWidth: 480 }}>
      <Field label="New tag" error={error}>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <Input value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && create()} />
          <Button onClick={create}>Add</Button>
        </div>
      </Field>
      {tags && tags.length === 0 ? (
        <EmptyState title="No tags yet" description="Tags organize the problem bank by topic." />
      ) : (
        <div className="tag-pill-row" style={{ marginTop: '0.75rem' }}>
          {tags?.map((t) => (
            <span key={t.id} className="badge">
              {t.name}{' '}
              <button onClick={() => remove(t.id)} aria-label={`Remove ${t.name}`} style={{ marginLeft: 4, cursor: 'pointer' }}>×</button>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
