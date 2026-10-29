import { useEffect, useState } from 'react'
import {
  Button, Field, Input, EmptyState, PageLoading, ConfirmDialog,
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { useToast } from '../lib/toast.tsx'
import { RichText } from '../lib/Math.tsx'
import type { Problem, Tag, Choice, FigureDraft } from './types.ts'

const TYPES: Problem['type'][] = ['mc', 'multi', 'numeric', 'text', 'frq']
const TYPE_LABEL: Record<Problem['type'], string> = {
  mc: 'Multiple choice',
  multi: 'Pick all that apply',
  numeric: 'Number',
  text: 'Short answer',
  frq: 'Written answer (you mark it)',
}

// A new problem keeps the type of the last one: tutors make several alike.
function blankDraft(type: Problem['type'] = 'mc'): Draft {
  return {
    id: null,
    type,
    stemLatex: '',
    choices: [{ id: 'A', content: '' }, { id: 'B', content: '' }],
    correctText: '',
    acceptText: '',
    explanationLatex: '',
    figures: [],
    difficulty: '',
    source: '',
    tagIds: [],
  }
}

interface Draft {
  id: string | null
  type: Problem['type']
  stemLatex: string
  choices: Choice[]
  correctText: string
  acceptText: string
  explanationLatex: string
  figures: FigureDraft[]
  difficulty: string
  source: string
  tagIds: string[]
}

function toDraft(p: Problem): Draft {
  return {
    id: p.id,
    type: p.type,
    stemLatex: p.stem_latex,
    choices: p.choices.length ? p.choices : [{ id: 'A', content: '' }, { id: 'B', content: '' }],
    correctText: Array.isArray(p.correct)
      ? p.correct.join(', ')
      : typeof p.correct === 'string' ? p.correct : p.correct ? JSON.stringify(p.correct) : '',
    acceptText: (p.accept ?? []).join(', '),
    explanationLatex: p.explanation_latex ?? '',
    figures: p.figures ?? [],
    difficulty: p.difficulty != null ? String(p.difficulty) : '',
    source: p.source ?? '',
    tagIds: p.tags.map((t) => t.id),
  }
}

export function ProblemsTab() {
  const toast = useToast()
  const [problems, setProblems] = useState<Problem[] | null>(null)
  const [tags, setTags] = useState<Tag[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Draft>(blankDraft())
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [archiveConfirm, setArchiveConfirm] = useState(false)

  async function reload() {
    const [p, t] = await Promise.all([
      apiFetch('/api/tutor/problems'),
      apiFetch('/api/tutor/tags'),
    ])
    setProblems(p.problems)
    setTags(t.tags)
  }

  useEffect(() => { reload() }, [])

  function selectProblem(p: Problem) {
    setSelectedId(p.id)
    setDraft(toDraft(p))
    setError('')
  }

  function newProblem() {
    setSelectedId(null)
    setDraft((d) => blankDraft(d.type))
    setError('')
  }

  async function renderFigure(index: number) {
    const fig = draft.figures[index]
    try {
      const { svg } = await apiFetch('/api/tutor/render-figure', {
        method: 'POST',
        body: JSON.stringify({ latex: fig.latex, label: fig.label }),
      })
      setDraft((d) => {
        const figures = [...d.figures]
        figures[index] = { ...figures[index], svg }
        return { ...d, figures }
      })
      setError('')
    } catch (err) {
      setError((err as Error).message)
    }
  }

  async function save() {
    setSaving(true)
    setError('')
    try {
      // Any figure without a rendered svg yet gets rendered now, so Save
      // always produces a fully-rendered problem (mirrors the editor's
      // "Preview" action, just applied to whatever wasn't previewed).
      const figures = await Promise.all(
        draft.figures.map(async (f) => {
          if (f.svg) return f
          const { svg } = await apiFetch('/api/tutor/render-figure', {
            method: 'POST',
            body: JSON.stringify({ latex: f.latex, label: f.label }),
          })
          return { ...f, svg }
        }),
      )

      // Empty optional fields go as null, not undefined: PATCH reads an
      // absent field as "keep the old value", so a cleared field never cleared.
      const body = {
        type: draft.type,
        stemLatex: draft.stemLatex,
        choices: draft.type === 'mc' || draft.type === 'multi' ? draft.choices : [],
        correct: draft.type === 'multi'
          ? draft.correctText.split(',').map((s) => s.trim()).filter(Boolean)
          : draft.correctText || null,
        accept: draft.acceptText.split(',').map((s) => s.trim()).filter(Boolean),
        explanationLatex: draft.explanationLatex || null,
        figures,
        difficulty: draft.difficulty ? Number(draft.difficulty) : null,
        source: draft.source || null,
        tagIds: draft.tagIds,
      }

      if (draft.id) {
        await apiFetch(`/api/tutor/problems/${draft.id}`, { method: 'PATCH', body: JSON.stringify(body) })
      } else {
        await apiFetch('/api/tutor/problems', { method: 'POST', body: JSON.stringify(body) })
      }
      await reload()
      newProblem()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setSaving(false)
    }
  }

  async function archive(id: string) {
    try {
      await apiFetch(`/api/tutor/problems/${id}`, { method: 'DELETE' })
      if (selectedId === id) newProblem()
      await reload()
    } catch (err) {
      toast((err as Error).message)
    }
  }

  function toggleTag(id: string) {
    setDraft((d) => ({
      ...d,
      tagIds: d.tagIds.includes(id) ? d.tagIds.filter((t) => t !== id) : [...d.tagIds, id],
    }))
  }

  return (
    <div className="split-panel">
      <div>
        <div className="page-toolbar" style={{ marginBottom: '0.75rem' }}>
          <strong>Bank</strong>
          <Button variant="secondary" onClick={newProblem}>New problem</Button>
        </div>
        {problems === null ? (
          <PageLoading />
        ) : problems.length === 0 ? (
          <EmptyState title="No problems yet" description="Create one or import a problem-set JSON." />
        ) : (
          <div className="panel-list">
            {problems?.map((p) => (
              <button
                key={p.id}
                className="panel-list-item"
                data-active={selectedId === p.id}
                onClick={() => selectProblem(p)}
              >
                <span className="item-title">{p.stem_latex.replace(/\$/g, '').slice(0, 60) || '(empty stem)'}</span>
                <span className="item-meta">{p.type} · {p.tags.map((t) => t.name).join(', ') || 'no tags'}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="editor-card">
        <div className="form-row">
          <Field label="Type">
            <Select value={draft.type} onValueChange={(v) => setDraft((d) => ({ ...d, type: v as Problem['type'] }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {TYPES.map((t) => <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Difficulty (optional)">
            <Input value={draft.difficulty} onChange={(e) => setDraft((d) => ({ ...d, difficulty: e.target.value }))} />
          </Field>
          <Field label="Source (optional)">
            <Input value={draft.source} onChange={(e) => setDraft((d) => ({ ...d, source: e.target.value }))} />
          </Field>
        </div>

        <Field label="Question" hint="Math between $ signs, e.g. $x^2+1$.">
          <textarea className="input" rows={3} value={draft.stemLatex}
            onChange={(e) => setDraft((d) => ({ ...d, stemLatex: e.target.value }))} />
        </Field>

        {(draft.type === 'mc' || draft.type === 'multi') && (
          <Field label="Choices">
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
              {draft.choices.map((c, i) => (
                <div key={i} style={{ display: 'flex', gap: '0.5rem' }}>
                  <Input style={{ width: 60 }} value={c.id}
                    onChange={(e) => setDraft((d) => {
                      const choices = [...d.choices]; choices[i] = { ...choices[i], id: e.target.value }
                      return { ...d, choices }
                    })} />
                  <Input value={c.content}
                    onChange={(e) => setDraft((d) => {
                      const choices = [...d.choices]; choices[i] = { ...choices[i], content: e.target.value }
                      return { ...d, choices }
                    })} />
                  <Button variant="ghost" onClick={() => setDraft((d) => ({ ...d, choices: d.choices.filter((_, j) => j !== i) }))}>Remove</Button>
                </div>
              ))}
              <Button variant="ghost" onClick={() => setDraft((d) => ({ ...d, choices: [...d.choices, { id: '', content: '' }] }))}>
                Add choice
              </Button>
            </div>
          </Field>
        )}

        {draft.type !== 'frq' && (
          <>
            <Field label={draft.type === 'mc' ? 'Correct letter' : draft.type === 'multi' ? 'Correct letters (comma-separated)' : 'Correct answer'}>
              <Input value={draft.correctText} onChange={(e) => setDraft((d) => ({ ...d, correctText: e.target.value }))} />
            </Field>
            <Field label="Also accept (comma-separated, optional)" hint="Other ways of writing the same answer. “x = 4” already counts for 4.">
              <Input value={draft.acceptText} onChange={(e) => setDraft((d) => ({ ...d, acceptText: e.target.value }))} />
            </Field>
          </>
        )}
        <Field label="Explanation (optional)">
          <textarea className="input" rows={2} value={draft.explanationLatex}
            onChange={(e) => setDraft((d) => ({ ...d, explanationLatex: e.target.value }))} />
        </Field>

        <details className="advanced">
        <summary>Diagrams (drawn with TikZ code)</summary>
        <Field label="Diagrams">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {draft.figures.map((f, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem', border: '1px solid var(--line)', borderRadius: 'var(--radius-control)', padding: '0.5rem' }}>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <Input placeholder="name, put it in the question as ![name]" value={f.id}
                    onChange={(e) => setDraft((d) => {
                      const figures = [...d.figures]; figures[i] = { ...figures[i], id: e.target.value, svg: undefined }
                      return { ...d, figures }
                    })} />
                  <Input placeholder="caption (optional)" value={f.label ?? ''}
                    onChange={(e) => setDraft((d) => {
                      const figures = [...d.figures]; figures[i] = { ...figures[i], label: e.target.value, svg: undefined }
                      return { ...d, figures }
                    })} />
                </div>
                <textarea className="input" rows={2} placeholder="\begin{tikzpicture}...\end{tikzpicture}" value={f.latex}
                  onChange={(e) => setDraft((d) => {
                    const figures = [...d.figures]; figures[i] = { ...figures[i], latex: e.target.value, svg: undefined }
                    return { ...d, figures }
                  })} />
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <Button variant="ghost" onClick={() => renderFigure(i)}>Preview</Button>
                  <Button variant="ghost" onClick={() => setDraft((d) => ({ ...d, figures: d.figures.filter((_, j) => j !== i) }))}>Remove</Button>
                </div>
                {f.svg && <div className="preview-card" dangerouslySetInnerHTML={{ __html: f.svg }} />}
              </div>
            ))}
            <Button variant="ghost" onClick={() => setDraft((d) => ({ ...d, figures: [...d.figures, { id: `fig${d.figures.length + 1}`, latex: '' }] }))}>
              Add diagram
            </Button>
          </div>
        </Field>
        </details>

        <Field label="Tags">
          <div className="tag-pill-row">
            {tags.map((t) => (
              <button key={t.id} type="button" className="badge"
                style={{ cursor: 'pointer', opacity: draft.tagIds.includes(t.id) ? 1 : 0.5 }}
                onClick={() => toggleTag(t.id)}>
                {t.name}
              </button>
            ))}
            {tags.length === 0 && <span className="muted">No tags yet — create some from the Tags panel.</span>}
          </div>
        </Field>

        <div className="preview-card">
          <div className="muted" style={{ marginBottom: '0.375rem' }}>Live preview</div>
          <RichText text={draft.stemLatex} figures={draft.figures.filter((f) => f.svg) as { id: string; svg: string; label?: string }[]} />
        </div>

        {error && <p className="field-error">{error}</p>}

        <div style={{ display: 'flex', justifyContent: 'space-between' }}>
          {draft.id ? (
            <Button variant="danger" onClick={() => setArchiveConfirm(true)}>Archive</Button>
          ) : <span />}
          <Button onClick={save} disabled={saving}>{saving ? 'Saving…' : draft.id ? 'Save changes' : 'Create problem'}</Button>
        </div>
      </div>

      <ConfirmDialog
        open={archiveConfirm}
        onOpenChange={setArchiveConfirm}
        title="Archive this problem?"
        description="It's removed from the bank. Sets and assignments that already use it keep it."
        confirmLabel="Archive"
        onConfirm={() => draft.id && archive(draft.id)}
      />
    </div>
  )
}
