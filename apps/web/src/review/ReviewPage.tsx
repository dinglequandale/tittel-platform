import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { Button, MadeWith } from '@tittel/ui'
import { BRAND_NAME } from '@tittel/shared'
import { apiFetch, linkErrorMessage } from '../lib/api.ts'
import { useSession } from '../lib/useSession.ts'
import { useToast, AppToastProvider } from '../lib/toast.tsx'
import { RichText } from '../lib/Math.tsx'
import { fileUrl, type StoredFile } from '../lib/files.ts'

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
interface RResponse { problem_id: string; answer: unknown; is_correct: boolean | null; marked_for_review: boolean; tutor_marked?: boolean }
interface ReviewPayload {
  studentName: string
  assignmentTitle: string | null
  status: string
  score: number
  total: number
  frqCount: number
  materials: StoredFile[]
  workFiles: StoredFile[]
  tutorComment: string | null
  problems: RProblem[]
  responses: RResponse[]
}

/** An answer as the student saw it: a choice shows its letter and its content. */
function AnswerText({ value, problem }: { value: unknown; problem: RProblem }) {
  if (value == null || value === '') return <>(blank)</>
  const ids = Array.isArray(value) ? value.map(String) : [String(value)]
  if (problem.type === 'mc' || problem.type === 'multi') {
    return <>{ids.map((id, i) => {
      const c = problem.choices.find((x) => x.id === id)
      return <span key={id}>{i > 0 && ', '}{id}{c && <> (<RichText text={c.content} figures={problem.figures} />)</>}</span>
    })}</>
  }
  return <>{ids.join(', ')}</>
}

export function ReviewPage() {
  return <AppToastProvider><Review /></AppToastProvider>
}

// One handed-in homework. The student sees how they did and their tutor's
// comment; the tutor (signed in) also marks answers right or wrong, which
// overrides the auto-grade and grades written answers, and leaves the comment.
function Review() {
  const { attemptToken } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { session } = useSession()
  const tutor = !!session
  const [data, setData] = useState<ReviewPayload | null>(null)
  const [comment, setComment] = useState('')
  const [savedComment, setSavedComment] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!attemptToken) return
    apiFetch(`/api/attempt/${attemptToken}/review`)
      .then((d: ReviewPayload) => { setData(d); setComment(d.tutorComment ?? ''); setSavedComment(d.tutorComment ?? '') })
      .catch((e) => setError(linkErrorMessage(e)))
  }, [attemptToken])

  if (error) {
    return (
      <main className="page">
        <div className="page-card page-error">
          <h1 style={{ fontFamily: 'var(--font-display)' }}>Couldn't open this review</h1>
          <p>{error}</p>
        </div>
      </main>
    )
  }
  if (!data) return <main className="page"><p className="page-loading">Loading…</p></main>

  const responseOf = new Map(data.responses.map((r) => [r.problem_id, r]))

  async function mark(problemId: string, isCorrect: boolean | null) {
    try {
      await apiFetch(`/api/tutor/attempts/${attemptToken}/responses/${problemId}`, { method: 'PATCH', body: JSON.stringify({ isCorrect }) })
      const d: ReviewPayload = await apiFetch(`/api/attempt/${attemptToken}/review`)
      setData(d)
    } catch (err) {
      toast((err as Error).message)
    }
  }

  async function saveComment() {
    try {
      await apiFetch(`/api/tutor/attempts/${attemptToken}`, { method: 'PATCH', body: JSON.stringify({ comment }) })
      setSavedComment(comment)
      toast('Comment saved')
    } catch (err) {
      toast((err as Error).message)
    }
  }

  return (
    <div className="page">
      {tutor && (
        <button className="content-back" onClick={() => (window.history.length > 1 ? navigate(-1) : navigate('/app'))}>
          <ChevronLeft size={14} strokeWidth={2} /> Back
        </button>
      )}
      <h1 style={{ fontFamily: 'var(--font-display)' }}>{data.assignmentTitle || 'Homework'}</h1>
      <p className="muted">
        {data.studentName} · {data.total ? `Score: ${data.score} / ${data.total}` : 'Handed in'}
        {data.frqCount > 0 && ` · ${data.frqCount} written answer${data.frqCount === 1 ? '' : 's'} ${tutor ? 'to mark' : 'not marked yet'}`}
      </p>

      {tutor ? (
        <div className="editor-card review-comment">
          <strong>Comment for {data.studentName.split(' ')[0]}</strong>
          <textarea className="input" rows={3} value={comment} placeholder="What went well, what to look at again…" onChange={(e) => setComment(e.target.value)} />
          <div className="row-end"><Button onClick={saveComment} disabled={comment === savedComment}>Save comment</Button></div>
        </div>
      ) : data.tutorComment ? (
        <div className="editor-card review-comment"><strong>From your tutor</strong><p>{data.tutorComment}</p></div>
      ) : null}

      {data.materials.length > 0 && (
        <p className="muted">Worksheet: {data.materials.map((m, i) => <span key={m.token}>{i > 0 && ', '}<a href={fileUrl(m.token)} target="_blank" rel="noopener noreferrer">{m.name}</a></span>)}</p>
      )}
      {data.workFiles.length > 0 && (
        <div className="work-photos">
          {data.workFiles.map((f) => (
            <a key={f.token} href={fileUrl(f.token)} target="_blank" rel="noopener noreferrer"><img src={fileUrl(f.token)} alt={`Work: ${f.name}`} /></a>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1rem' }}>
        {data.problems.map((p, i) => {
          const r = responseOf.get(p.id)
          const correctness = r?.is_correct === true ? 'correct' : r?.is_correct === false ? 'incorrect' : 'ungraded'
          return (
            <div key={p.id} className="editor-card">
              <div className="page-toolbar" style={{ marginBottom: 0 }}>
                {/* ordinals keep gaps after a problem is removed from the set */}
                <span className="muted">Question {i + 1}{r?.tutor_marked ? ' · marked by your tutor' : ''}</span>
                <span className="badge" style={{
                  color: correctness === 'correct' ? 'var(--correct)' : correctness === 'incorrect' ? 'var(--incorrect)' : undefined,
                }}>
                  {correctness === 'correct' ? 'Correct' : correctness === 'incorrect' ? 'Incorrect' : tutor ? 'To mark' : 'Not marked yet'}
                </span>
              </div>
              <RichText text={p.stem_latex} figures={p.figures} />
              {!(p.type === 'frq' && data.workFiles.length && r?.answer == null) && (
                <p className="muted">{tutor ? 'Answer' : 'Your answer'}: <AnswerText value={r?.answer} problem={p} /></p>
              )}
              {correctness === 'incorrect' && p.type !== 'frq' && (
                <p className="muted">Correct answer: <AnswerText value={p.correct} problem={p} /></p>
              )}
              {p.explanation_latex && (
                <div className="preview-card">
                  <RichText text={p.explanation_latex} figures={p.figures} />
                </div>
              )}
              {tutor && (
                <div className="slot-actions">
                  <Button variant={correctness === 'correct' ? 'primary' : 'secondary'} onClick={() => mark(p.id, true)}>Right</Button>
                  <Button variant={correctness === 'incorrect' ? 'primary' : 'secondary'} onClick={() => mark(p.id, false)}>Wrong</Button>
                </div>
              )}
            </div>
          )
        })}
      </div>
      <MadeWith name={BRAND_NAME} />
    </div>
  )
}
