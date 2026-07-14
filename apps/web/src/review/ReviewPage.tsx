import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch } from '../lib/api.ts'
import { RichText } from '../lib/Math.tsx'

interface RChoice { id: string; content: string }
interface RProblem {
  id: string
  ordinal: number
  type: 'mc' | 'multi' | 'numeric' | 'text' | 'frq'
  stem_latex: string
  choices: RChoice[]
  correct: unknown
  explanation_latex: string | null
  figures: { id: string; label?: string; svg: string }[]
}
interface RResponse { problem_id: string; answer: unknown; is_correct: boolean | null; marked_for_review: boolean }
interface ReviewPayload {
  studentName: string
  assignmentTitle: string | null
  status: string
  score: number
  total: number
  problems: RProblem[]
  responses: RResponse[]
}

function answerText(v: unknown): string {
  if (v == null) return '(blank)'
  if (Array.isArray(v)) return v.join(', ')
  return String(v)
}

export function ReviewPage() {
  const { attemptToken } = useParams()
  const [data, setData] = useState<ReviewPayload | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!attemptToken) return
    apiFetch(`/api/attempt/${attemptToken}/review`).then(setData).catch((e) => setError(e.message))
  }, [attemptToken])

  if (error) return <main className="page"><h1>Couldn't open this review</h1><p className="muted">{error}</p></main>
  if (!data) return <main className="page"><p className="muted">Loading…</p></main>

  const responseOf = new Map(data.responses.map((r) => [r.problem_id, r]))

  return (
    <div className="page" style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem 1rem' }}>
      <h1 style={{ fontFamily: 'var(--font-display)' }}>{data.assignmentTitle || 'Review'}</h1>
      <p className="muted">{data.studentName} · Score: {data.score} / {data.total}</p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
        {data.problems.map((p) => {
          const r = responseOf.get(p.id)
          const correctness = r?.is_correct === true ? 'correct' : r?.is_correct === false ? 'incorrect' : 'ungraded'
          return (
            <div key={p.id} className="editor-card">
              <div className="page-toolbar" style={{ marginBottom: 0 }}>
                <span className="muted">Question {p.ordinal + 1}</span>
                <span className="badge" style={{
                  color: correctness === 'correct' ? 'var(--correct)' : correctness === 'incorrect' ? 'var(--incorrect)' : undefined,
                }}>
                  {correctness === 'correct' ? 'Correct' : correctness === 'incorrect' ? 'Incorrect' : 'Needs grading'}
                </span>
              </div>
              <RichText text={p.stem_latex} figures={p.figures} />
              <p className="muted">Your answer: {answerText(r?.answer)}</p>
              {correctness === 'incorrect' && p.type !== 'frq' && (
                <p className="muted">Correct answer: {answerText(p.correct)}</p>
              )}
              {p.explanation_latex && (
                <div className="preview-card">
                  <RichText text={p.explanation_latex} figures={p.figures} />
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
