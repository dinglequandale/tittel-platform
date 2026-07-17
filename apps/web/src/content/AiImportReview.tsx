import { useState } from 'react'
import { Button, Field, Input } from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { useToast } from '../lib/toast.tsx'
import { RichText } from '../lib/Math.tsx'

interface DraftChoice { id: string; content: string }
interface DraftProblem {
  type: 'mc' | 'multi' | 'numeric' | 'text' | 'frq'
  stemLatex: string
  choices?: DraftChoice[]
  correct?: string | null
  correctMulti?: string[]
  accept?: string[]
  explanationLatex?: string | null
  answerConfidence: 'found' | 'inferred' | 'missing'
}
export interface AiImportDraft {
  title: string
  problems: DraftProblem[]
}

const TYPE_LABEL: Record<DraftProblem['type'], string> = {
  mc: 'Multiple choice',
  multi: 'Multi-select',
  numeric: 'Numeric',
  text: 'Text',
  frq: 'Free response',
}

function answerText(p: DraftProblem): string {
  if (p.type === 'multi') return (p.correctMulti ?? []).join(', ')
  return p.correct ?? ''
}

export function AiImportReview({
  draft, filename, onCommitted, onDiscard,
}: {
  draft: AiImportDraft
  filename: string
  onCommitted: (setId: string) => void
  onDiscard: () => void
}) {
  const toast = useToast()
  const [title, setTitle] = useState(draft.title)
  const [problems, setProblems] = useState<DraftProblem[]>(draft.problems)
  const [committing, setCommitting] = useState(false)
  const [error, setError] = useState('')

  const found = problems.filter((p) => p.answerConfidence === 'found').length
  const inferred = problems.filter((p) => p.answerConfidence === 'inferred').length
  const missing = problems.filter((p) => p.answerConfidence === 'missing').length

  function updateProblem(i: number, patch: Partial<DraftProblem>) {
    setProblems((ps) => ps.map((p, j) => (j === i ? { ...p, ...patch } : p)))
  }

  function setAnswerText(i: number, value: string) {
    const p = problems[i]
    if (p.type === 'multi') {
      updateProblem(i, { correctMulti: value.split(',').map((s) => s.trim()).filter(Boolean) })
    } else {
      updateProblem(i, { correct: value })
    }
  }

  function removeProblem(i: number) {
    setProblems((ps) => ps.filter((_, j) => j !== i))
  }

  async function commit() {
    if (!title.trim() || problems.length === 0 || committing) return
    setCommitting(true)
    setError('')
    try {
      const result = await apiFetch('/api/tutor/ai-import/commit', {
        method: 'POST',
        body: JSON.stringify({ title: title.trim(), problems, filename }),
      })
      toast('Added to bank')
      onCommitted(result.setId)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setCommitting(false)
    }
  }

  return (
    <div>
      <div className="page-toolbar">
        <Field label="Set title"><Input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      </div>
      <p className="muted">
        {problems.length} problems · {found} answers found
        {inferred > 0 && ` · ${inferred} inferred`}
        {missing > 0 && ` · ${missing} missing`}
      </p>
      {error && <p className="field-error">{error}</p>}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.75rem' }}>
        {problems.map((p, i) => (
          <div key={i} className="editor-card">
            <div className="page-toolbar" style={{ marginBottom: 0 }}>
              <span className="badge badge-accent">{TYPE_LABEL[p.type]}</span>
              <Button variant="ghost" onClick={() => removeProblem(i)}>Remove</Button>
            </div>
            <RichText text={p.stemLatex} />
            {p.choices && p.choices.length > 0 && (
              <ul style={{ marginTop: '0.5rem' }}>
                {p.choices.map((c) => (
                  <li key={c.id}><strong>{c.id}</strong>: <RichText text={c.content} /></li>
                ))}
              </ul>
            )}
            {p.type !== 'frq' && (
              <Field label={p.type === 'multi' ? 'Correct choice ids (comma-separated)' : 'Correct answer'}>
                <Input
                  value={answerText(p)}
                  onChange={(e) => setAnswerText(i, e.target.value)}
                  style={p.answerConfidence !== 'found' ? { background: 'color-mix(in srgb, var(--warning) 14%, transparent)' } : undefined}
                />
              </Field>
            )}
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', marginTop: '1rem' }}>
        <Button variant="ghost" onClick={onDiscard}>Discard</Button>
        <Button onClick={commit} disabled={committing || !title.trim() || problems.length === 0}>
          {committing ? 'Adding…' : 'Add to bank'}
        </Button>
      </div>
    </div>
  )
}
