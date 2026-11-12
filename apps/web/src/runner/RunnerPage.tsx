import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Calculator, BookOpen } from 'lucide-react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { Button, Dialog, DialogContent, DialogTitle, DialogClose, MadeWith } from '@tittel/ui'
import { BRAND_NAME } from '@tittel/shared'
import { apiFetch, linkErrorMessage } from '../lib/api.ts'
import { RichText } from '../lib/Math.tsx'
import { fileUrl, type StoredFile } from '../lib/files.ts'
import { dueLabel } from '../lessons/lessons.ts'

const RunnerTools = lazy(() => import('./RunnerTools.tsx'))

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
  materials: StoredFile[]
  workFiles: StoredFile[]
  /** Digital-SAT-style help the tutor turned on for this homework. */
  tools?: { calculator: boolean; reference: boolean }
  problems: RProblem[]
  responses: SavedResponse[]
}

/** A phone photo shrunk to a sensible size before it goes up: quicker on mobile data, and plenty to read. */
async function shrinkPhoto(file: File): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file)
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height))
    if (scale === 1 && file.size < 3_000_000) return file
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bmp.width * scale)
    canvas.height = Math.round(bmp.height * scale)
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve) => canvas.toBlob((b) => resolve(b ?? file), 'image/jpeg', 0.85))
  } catch {
    return file
  }
}

/**
 * The worksheet to work from, and photos of work done on paper. Shown for
 * any homework with a worksheet or a written answer.
 */
function PaperWork({ token, materials, workFiles, onChange }: {
  token: string
  materials: StoredFile[]
  workFiles: StoredFile[]
  onChange: (files: StoredFile[]) => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function add(files: FileList) {
    setBusy(true); setError('')
    try {
      for (const f of [...files]) {
        const blob = await shrinkPhoto(f)
        const r = await apiFetch(`/api/attempt/${token}/work?name=${encodeURIComponent(f.name)}`, {
          method: 'POST', headers: { 'content-type': blob.type || 'image/jpeg' }, body: blob,
        })
        onChange(r.workFiles)
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function remove(fileToken: string) {
    const r = await apiFetch(`/api/attempt/${token}/work/${fileToken}`, { method: 'DELETE' })
    onChange(r.workFiles)
  }
  return (
    <div className="editor-card paper-work">
      {materials.length > 0 && (
        <p>Worksheet: {materials.map((m, i) => <span key={m.token}>{i > 0 && ', '}<a href={fileUrl(m.token)} target="_blank" rel="noopener noreferrer">{m.name}</a></span>)}</p>
      )}
      <div className="list-row-title">Photos of your work</div>
      {workFiles.length > 0 && (
        <div className="work-photos">
          {workFiles.map((f) => (
            <div key={f.token} className="work-photo">
              <img src={fileUrl(f.token)} alt={f.name} />
              <button className="badge-x" aria-label={`Remove ${f.name}`} onClick={() => remove(f.token)}>×</button>
            </div>
          ))}
        </div>
      )}
      <label className="btn btn-secondary" aria-disabled={busy}>
        {busy ? 'Uploading…' : workFiles.length ? 'Add another photo' : 'Take or add a photo'}
        <input type="file" accept="image/*" capture="environment" multiple hidden disabled={busy}
          onChange={(e) => { if (e.target.files?.length) void add(e.target.files); e.target.value = '' }} />
      </label>
      {error && <p className="field-error">{error}</p>}
    </div>
  )
}

function mmss(total: number): string {
  const s = Math.max(0, Math.floor(total))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

// The core loop (answer, autosave, timer, submit), plus the calculator and
// reference sheet when the tutor gave it as digital-SAT-style homework.
// Choice elimination and section timing are not built.
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
  const [tool, setTool] = useState<'calculator' | 'reference' | null>(null)

  const answersRef = useRef(answers)
  answersRef.current = answers
  const markedRef = useRef(marked)
  markedRef.current = marked
  const timeRef = useRef<{ problemId: string; at: number } | null>(null)
  // One pending save per question, so answering the next question quickly
  // can't cancel the previous one's save.
  const debounce = useRef<Record<string, number>>({})
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
      .catch((e) => setError(linkErrorMessage(e)))
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

  function save(problemId: string, opts: { answer?: unknown; marked?: boolean; timeDelta?: number; changed?: boolean }): Promise<void> {
    const answer = opts.answer !== undefined ? opts.answer : answersRef.current[problemId] ?? null
    const markedForReview = opts.marked !== undefined ? opts.marked : !!markedRef.current[problemId]
    return apiFetch(`/api/attempt/${attemptToken}/response`, {
      method: 'POST',
      body: JSON.stringify({
        problemId, answer, markedForReview,
        timeSpentMsDelta: opts.timeDelta ?? 0, changed: !!opts.changed,
      }),
    }).then(() => {}, () => {})
  }

  function flushTimeFor(problemId: string): Promise<void> | undefined {
    const t = timeRef.current
    if (!t || t.problemId !== problemId) return
    const delta = Date.now() - t.at
    timeRef.current = null
    if (delta >= 250) return save(problemId, { timeDelta: delta })
  }

  useEffect(() => {
    if (!data || data.submitted) return
    const p = data.problems[idx]
    if (!p) return
    timeRef.current = { problemId: p.id, at: Date.now() }
    return () => void flushTimeFor(p.id)
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
      if (document.visibilityState === 'hidden') {
        flushBeacon()
        return
      }
      // flushBeacon stopped the clock; restart it for the question on screen.
      const p = dataRef.current?.problems[idxRef.current]
      if (p && !dataRef.current?.submitted) timeRef.current = { problemId: p.id, at: Date.now() }
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
    // Answers typed in the last moment are still waiting in their debounce.
    // Save them (and the current question's time) before grading, or the
    // submit lands first and the late save 409s: the answer is lost.
    const pendingIds = Object.keys(debounce.current)
    for (const h of Object.values(debounce.current)) window.clearTimeout(h)
    debounce.current = {}
    const cur = data?.problems[idx]
    await Promise.all([
      ...pendingIds.map((id) => save(id, { changed: true })),
      cur ? flushTimeFor(cur.id) : undefined,
    ])
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

  if (error) {
    return (
      <main className="page">
        <div className="page-card page-error">
          <h1 style={{ fontFamily: 'var(--font-display)' }}>Couldn't open this assignment</h1>
          <p>{error}</p>
        </div>
      </main>
    )
  }
  if (!data) return <main className="page"><p className="page-loading">Loading…</p></main>
  if (data.submitted) {
    return (
      <main className="page">
        <div className="page-card">
          <h1 style={{ fontFamily: 'var(--font-display)' }}>Already submitted</h1>
          <p><Link to={`/review/${attemptToken}`}>Review your answers →</Link></p>
        </div>
      </main>
    )
  }

  if (data.status === 'pending') {
    const minutes = data.timeLimitSec ? Math.round(data.timeLimitSec / 60) : null
    return (
      <main className="page">
        <div className="page-card" style={{ textAlign: 'center', gap: '0.75rem' }}>
          <h1 style={{ fontFamily: 'var(--font-display)' }}>{data.assignmentTitle || 'Homework'}</h1>
          <p className="muted">{data.studentName}</p>
          <p className="muted">
            {minutes ? `${minutes} minutes · ` : ''}{data.problems.length} questions
            {data.dueAt && ` · due ${dueLabel(data.dueAt)}`}
          </p>
          <Button onClick={begin} disabled={starting} style={{ alignSelf: 'center' }}>{starting ? 'Starting…' : 'Begin'}</Button>
        </div>
        <MadeWith name={BRAND_NAME} />
      </main>
    )
  }

  const problems = data.problems
  const p = problems[idx]
  if (!p) {
    return (
      <main className="page">
        <div className="page-card">
          <h1 style={{ fontFamily: 'var(--font-display)' }}>No questions yet</h1>
          <p className="muted">This assignment is empty. Let your tutor know.</p>
        </div>
      </main>
    )
  }
  const isAnswered = (q: RProblem) => {
    const a = answers[q.id]
    // A written answer can be photos of the work instead of typed text.
    if (q.type === 'frq' && data.workFiles.length) return true
    return a != null && a !== '' && !(Array.isArray(a) && a.length === 0)
  }
  const paper = data.materials.length > 0 || problems.some((q) => q.type === 'frq')
  const answeredCount = problems.filter(isAnswered).length
  const unansweredCount = problems.length - answeredCount
  const lowTime = remaining !== null && remaining < 60

  function setAnswer(value: unknown, changed = true) {
    const id = p.id
    setAnswers((a) => ({ ...a, [id]: value }))
    window.clearTimeout(debounce.current[id])
    debounce.current[id] = window.setTimeout(() => {
      delete debounce.current[id]
      save(id, { answer: value, changed })
    }, 500)
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
    <div className="page">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <strong>{data.assignmentTitle || 'Homework'}</strong>
        <div className="runner-tools-bar">
          {data.tools?.calculator && (
            <Button variant={tool === 'calculator' ? 'primary' : 'ghost'} aria-pressed={tool === 'calculator'}
              onClick={() => setTool((t) => (t === 'calculator' ? null : 'calculator'))}><Calculator size={15} /> Calculator</Button>
          )}
          {data.tools?.reference && (
            <Button variant={tool === 'reference' ? 'primary' : 'ghost'} aria-pressed={tool === 'reference'}
              onClick={() => setTool((t) => (t === 'reference' ? null : 'reference'))}><BookOpen size={15} /> Reference</Button>
          )}
          {remaining !== null && <span className={lowTime ? 'badge badge-incorrect' : 'badge'}>{mmss(remaining)}</span>}
        </div>
      </header>

      {tool && attemptToken && (
        <Suspense fallback={null}>
          <RunnerTools token={attemptToken} panel={tool} onClose={() => setTool(null)} />
        </Suspense>
      )}

      {paper && attemptToken && (
        <PaperWork token={attemptToken} materials={data.materials} workFiles={data.workFiles}
          onChange={(workFiles) => setData((d) => (d ? { ...d, workFiles } : d))} />
      )}

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
                  aria-label={`Choice ${c.id}: ${c.content.replace(/\$/g, '')}`} aria-pressed={selected}
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
          <textarea className="input" rows={4} style={{ marginTop: '1rem' }} aria-label="Your answer"
            placeholder={data.workFiles.length ? 'Anything to add? (optional)' : 'Your answer, or add photos of your work above'}
            value={typeof answers[p.id] === 'string' ? (answers[p.id] as string) : ''}
            onChange={(e) => setAnswer(e.target.value)} />
        ) : (
          <input className="input" style={{ marginTop: '1rem' }} placeholder="Your answer" aria-label="Your answer"
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
      <MadeWith name={BRAND_NAME} />

      <Dialog open={confirmSubmit} onOpenChange={setConfirmSubmit}>
        <DialogContent>
          <DialogTitle>Submit with unanswered questions?</DialogTitle>
          <p className="muted">
            {unansweredCount} question{unansweredCount === 1 ? ' is' : 's are'} unanswered — submit anyway?
          </p>
          <div className="row-end">
            <DialogClose asChild><Button variant="ghost">Keep working</Button></DialogClose>
            <Button variant="danger" onClick={() => { setConfirmSubmit(false); void doSubmit() }}>Submit anyway</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
