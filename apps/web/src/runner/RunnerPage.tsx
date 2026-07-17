import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Button, Dialog, DialogContent, DialogTitle, DialogClose } from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { RichText } from '../lib/Math.tsx'

interface RChoice { id: string; content: string }
interface RProblem {
  id: string
  ordinal: number
  type: 'mc' | 'multi' | 'numeric' | 'text' | 'frq'
  stem_latex: string
  choices: RChoice[]
  figures: { id: string; label?: string; svg: string }[]
}
interface SavedResponse { problem_id: string; answer: unknown; marked_for_review: boolean }
interface AttemptPayload {
  status: string
  submitted: boolean
  studentName: string
  assignmentTitle: string | null
  timeLimitSec: number | null
  dueAt: string | null
  remainingSec: number | null
  problems: RProblem[]
  responses: SavedResponse[]
}

function mmss(total: number): string {
  const s = Math.max(0, Math.floor(total))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

// Functional core loop only (answer, autosave, timer, submit) — the full
// Bluebook-parity skin (calculator, reference sheet, choice elimination) is
// deferred; PLAN.md §10 Phase 2's "visually indistinguishable" bar needs
// Konrad's own visual check against the current app, which can't happen
// until this is live.
export function RunnerPage() {
  const { attemptToken } = useParams()
  const navigate = useNavigate()

  const [data, setData] = useState<AttemptPayload | null>(null)
  const [error, setError] = useState('')
  const [idx, setIdx] = useState(0)
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [marked, setMarked] = useState<Record<string, boolean>>({})
  const [remaining, setRemaining] = useState<number | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [starting, setStarting] = useState(false)
  const [confirmSubmit, setConfirmSubmit] = useState(false)

  const answersRef = useRef(answers)
  answersRef.current = answers
  const markedRef = useRef(marked)
  markedRef.current = marked
  const timeRef = useRef<{ problemId: string; at: number } | null>(null)
  const debounce = useRef<number | undefined>(undefined)
  const submittedRef = useRef(false)
  const dataRef = useRef(data)
  dataRef.current = data
  const idxRef = useRef(idx)
  idxRef.current = idx

  function loadPayload() {
    if (!attemptToken) return
    apiFetch(`/api/attempt/${attemptToken}`)
      .then((d: AttemptPayload) => {
        setData(d)
        setRemaining(d.remainingSec)
        const a: Record<string, unknown> = {}
        const m: Record<string, boolean> = {}
        for (const r of d.responses) {
          if (r.answer != null) a[r.problem_id] = r.answer
          if (r.marked_for_review) m[r.problem_id] = true
        }
        setAnswers(a)
        setMarked(m)
      })
      .catch((e) => setError((e as Error).message))
  }

  useEffect(() => { loadPayload() }, [attemptToken])

  async function begin() {
    setStarting(true)
    try {
      await apiFetch(`/api/attempt/${attemptToken}/start`, { method: 'POST' })
      loadPayload()
    } catch (e) {
      setError((e as Error).message)
      setStarting(false)
    }
  }

  function save(problemId: string, opts: { answer?: unknown; marked?: boolean; timeDelta?: number; changed?: boolean }) {
    const answer = opts.answer !== undefined ? opts.answer : answersRef.current[problemId] ?? null
    const markedForReview = opts.marked !== undefined ? opts.marked : !!markedRef.current[problemId]
    void apiFetch(`/api/attempt/${attemptToken}/response`, {
      method: 'POST',
      body: JSON.stringify({
        problemId, answer, markedForReview,
        timeSpentMsDelta: opts.timeDelta ?? 0, changed: !!opts.changed,
      }),
    }).catch(() => {})
  }

  function flushTimeFor(problemId: string) {
    const t = timeRef.current
    if (!t || t.problemId !== problemId) return
    const delta = Date.now() - t.at
    timeRef.current = null
    if (delta >= 250) save(problemId, { timeDelta: delta })
  }

  useEffect(() => {
    if (!data || data.submitted) return
    const p = data.problems[idx]
    if (!p) return
    timeRef.current = { problemId: p.id, at: Date.now() }
    return () => flushTimeFor(p.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idx, data])

  // A closed tab/backgrounded app can't wait for the debounced save's fetch
  // to land — flush the current question's answer + elapsed time via
  // sendBeacon, which the browser guarantees to send even mid-navigation.
  useEffect(() => {
    function flushBeacon() {
      const d = dataRef.current
      if (!d || d.submitted) return
      const p = d.problems[idxRef.current]
      if (!p) return
      const t = timeRef.current
      const delta = t && t.problemId === p.id ? Date.now() - t.at : 0
      timeRef.current = null
      const body = JSON.stringify({
        problemId: p.id,
        answer: answersRef.current[p.id] ?? null,
        markedForReview: !!markedRef.current[p.id],
        timeSpentMsDelta: delta,
        changed: false,
      })
      navigator.sendBeacon(`/api/attempt/${attemptToken}/response`, new Blob([body], { type: 'application/json' }))
    }
    function onVisibility() {
      if (document.visibilityState === 'hidden') flushBeacon()
    }
    window.addEventListener('pagehide', flushBeacon)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.removeEventListener('pagehide', flushBeacon)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [attemptToken])

  const doSubmit = useMemo(() => async () => {
    if (submittedRef.current) return
    submittedRef.current = true
    setSubmitting(true)
    const cur = data?.problems[idx]
    if (cur) flushTimeFor(cur.id)
    try {
      await apiFetch(`/api/attempt/${attemptToken}/submit`, { method: 'POST' })
      navigate(`/review/${attemptToken}`)
    } catch (e) {
      setError((e as Error).message)
      setSubmitting(false)
      submittedRef.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, idx, attemptToken])

  // Countdown; auto-submits the moment time runs out (server also enforces
  // this independently — see attempt.ts's own expiry check).
  useEffect(() => {
    if (!data || data.submitted || remaining === null) return
    const h = window.setInterval(() => {
      setRemaining((r) => {
        if (r === null) return r
        if (r <= 1) {
          window.clearInterval(h)
          void doSubmit()
          return 0
        }
        return r - 1
      })
    }, 1000)
    return () => window.clearInterval(h)
  }, [data, remaining === null, doSubmit])

  if (error) return <main className="page"><h1>Couldn't open this assignment</h1><p className="muted">{error}</p></main>
  if (!data) return <main className="page"><p className="muted">Loading…</p></main>
  if (data.submitted) {
    return (
      <main className="page">
        <h1>Already submitted</h1>
        <p><Link to={`/review/${attemptToken}`}>Review your answers →</Link></p>
      </main>
    )
  }

  if (data.status === 'pending') {
    const minutes = data.timeLimitSec ? Math.round(data.timeLimitSec / 60) : null
    return (
      <main className="page">
        <h1>{data.assignmentTitle || 'Assignment'}</h1>
        <p className="muted">{data.studentName}</p>
        <p className="muted">
          {minutes ? `${minutes} minutes · ` : ''}{data.problems.length} questions
          {data.dueAt && ` · due ${new Date(data.dueAt).toLocaleDateString()}`}
        </p>
        <Button onClick={begin} disabled={starting}>{starting ? 'Starting…' : 'Begin'}</Button>
      </main>
    )
  }

  const problems = data.problems
  const p = problems[idx]
  const isAnswered = (q: RProblem) => {
    const a = answers[q.id]
    return a != null && a !== '' && !(Array.isArray(a) && a.length === 0)
  }
  const answeredCount = problems.filter(isAnswered).length
  const unansweredCount = problems.length - answeredCount
  const lowTime = remaining !== null && remaining < 60

  function setAnswer(value: unknown, changed = true) {
    setAnswers((a) => ({ ...a, [p.id]: value }))
    window.clearTimeout(debounce.current)
    debounce.current = window.setTimeout(() => save(p.id, { answer: value, changed }), 500)
  }

  function toggleMark() {
    const next = !markedRef.current[p.id]
    setMarked((m) => ({ ...m, [p.id]: next }))
    save(p.id, { marked: next })
  }

  function onSubmitClick() {
    if (unansweredCount > 0) setConfirmSubmit(true)
    else void doSubmit()
  }

  return (
    <div className="page" style={{ maxWidth: 720, margin: '0 auto', padding: '1.5rem 1rem' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{data.assignmentTitle || 'Assignment'}</strong>
        {remaining !== null && <span className={lowTime ? 'badge badge-incorrect' : 'badge'}>{mmss(remaining)}</span>}
      </header>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.375rem', marginTop: '1rem' }}>
        {problems.map((q, i) => (
          <button
            key={q.id}
            onClick={() => setIdx(i)}
            aria-label={`Question ${i + 1}${isAnswered(q) ? ', answered' : ', unanswered'}${marked[q.id] ? ', marked for review' : ''}`}
            className="btn btn-ghost"
            style={{
              width: 32, height: 32, padding: 0, justifyContent: 'center',
              background: isAnswered(q) ? 'var(--accent-wash)' : 'transparent',
              outline: i === idx ? '2px solid var(--accent)' : '1px solid var(--line)',
              color: marked[q.id] ? 'var(--warning)' : undefined,
              fontWeight: i === idx ? 700 : 400,
            }}
          >
            {marked[q.id] ? '★' : i + 1}
          </button>
        ))}
      </div>

      <div className="editor-card" style={{ marginTop: '1rem' }}>
        <div className="page-toolbar" style={{ marginBottom: 0 }}>
          <span className="muted">Question {idx + 1} of {problems.length}</span>
          <Button variant="ghost" onClick={toggleMark}>{marked[p.id] ? '★ Marked' : '☆ Mark for review'}</Button>
        </div>

        <RichText text={p.stem_latex} figures={p.figures} />

        {(p.type === 'mc' || p.type === 'multi') ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', marginTop: '1rem' }}>
            {p.choices.map((c) => {
              const current = answers[p.id]
              const isMulti = p.type === 'multi'
              const selected = isMulti ? Array.isArray(current) && current.includes(c.id) : current === c.id
              return (
                <button key={c.id} className="btn btn-secondary" style={{ justifyContent: 'flex-start', outline: selected ? '2px solid var(--accent)' : 'none' }}
                  onClick={() => {
                    if (isMulti) {
                      const cur = Array.isArray(current) ? current as string[] : []
                      setAnswer(cur.includes(c.id) ? cur.filter((x) => x !== c.id) : [...cur, c.id])
                    } else {
                      setAnswer(c.id)
                    }
                  }}>
                  <strong style={{ marginRight: '0.5rem' }}>{c.id}</strong>
                  <RichText text={c.content} figures={p.figures} />
                </button>
              )
            })}
          </div>
        ) : p.type === 'frq' ? (
          <textarea className="input" rows={4} style={{ marginTop: '1rem' }}
            value={typeof answers[p.id] === 'string' ? (answers[p.id] as string) : ''}
            onChange={(e) => setAnswer(e.target.value)} />
        ) : (
          <input className="input" style={{ marginTop: '1rem' }} placeholder="Your answer"
            value={typeof answers[p.id] === 'string' ? (answers[p.id] as string) : ''}
            onChange={(e) => setAnswer(e.target.value)} />
        )}
      </div>

      <footer style={{ display: 'flex', justifyContent: 'space-between', marginTop: '1rem' }}>
        <Button variant="ghost" disabled={idx === 0} onClick={() => setIdx((i) => i - 1)}>Back</Button>
        <span className="muted">{answeredCount} / {problems.length} answered</span>
        {idx < problems.length - 1 ? (
          <Button onClick={() => setIdx((i) => i + 1)}>Next</Button>
        ) : (
          <Button onClick={onSubmitClick} disabled={submitting}>{submitting ? 'Submitting…' : 'Submit'}</Button>
        )}
      </footer>

      <Dialog open={confirmSubmit} onOpenChange={setConfirmSubmit}>
        <DialogContent>
          <DialogTitle>Submit with unanswered questions?</DialogTitle>
          <p className="muted">
            {unansweredCount} question{unansweredCount === 1 ? ' is' : 's are'} unanswered — submit anyway?
          </p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
            <DialogClose asChild><Button variant="ghost">Keep working</Button></DialogClose>
            <Button variant="danger" onClick={() => { setConfirmSubmit(false); void doSubmit() }}>Submit anyway</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
