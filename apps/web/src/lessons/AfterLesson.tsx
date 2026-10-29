import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { FileText } from 'lucide-react'
import { Button } from '@tittel/ui'
import { apiFetch } from '../lib/api.ts'
import { useToast } from '../lib/toast.tsx'
import { fileUrl } from '../lib/files.ts'
import { RichText } from '../lib/Math.tsx'
import { AiImportReview, type AiImportDraft } from '../content/AiImportReview.tsx'
import { type Lesson, shortDate } from './lessons.ts'

interface BoardQuestion { qid: string; stem: string; correct: string | null; right: string[]; wrong: { name: string; answer: string }[] }
interface Miss { problemId: string; stem: string; choices: { id: string; content: string }[]; correct: string | null; who: { name: string; answer: string }[] }
export interface LessonResults {
  endedAt: string | null
  boardPdf: string | null
  board: BoardQuestion[]
  homework: { title: string; handedIn: number; assigned: number; misses: Miss[] }[]
}

export function useLessonResults(lessonId: string) {
  const [results, setResults] = useState<LessonResults | null>(null)
  const reload = () => apiFetch(`/api/tutor/sessions/${lessonId}/results`).then(setResults).catch(() => setResults(null))
  useEffect(() => { void reload() }, [lessonId])
  return { results, reload }
}

const short = (s: string) => (s.length > 90 ? `${s.slice(0, 88).trim()}…` : s)

/**
 * After the lesson (OVERHAUL O3): the board as notes, what came back (answers
 * on the board, last time's homework) and following up on what was missed.
 * Shown once a lesson has started or its time has passed; before that it's
 * only clutter. Follow-ups reuse the missed problems themselves, so nothing
 * here needs AI; "More like these" is an extra, offered only when Claude is on.
 */
export function AfterLesson({ lesson, results, aiEnabled, onChanged }: {
  lesson: Lesson
  results: LessonResults
  aiEnabled: boolean
  onChanged: () => Promise<void>
}) {
  const toast = useToast()
  const misses = [
    ...results.board.filter((q) => q.wrong.length).map((q) => ({ key: `q:${q.qid}`, stem: q.stem, correct: q.correct, who: q.wrong, from: 'board' as const })),
    ...results.homework.flatMap((h) => h.misses.map((m) => ({ key: `p:${m.problemId}`, stem: m.stem, correct: m.correct, who: m.who, from: 'homework' as const, problem: m }))),
  ]
  const [picked, setPicked] = useState<Set<string>>(() => new Set(misses.map((m) => m.key)))
  const [busy, setBusy] = useState<string | null>(null)
  const [draft, setDraft] = useState<AiImportDraft | null>(null)
  useEffect(() => setPicked(new Set(misses.map((m) => m.key))), [misses.length])

  const chosen = misses.filter((m) => picked.has(m.key))
  const body = {
    qids: chosen.filter((m) => m.key.startsWith('q:')).map((m) => m.key.slice(2)),
    problemIds: chosen.filter((m) => m.key.startsWith('p:')).map((m) => m.key.slice(2)),
  }
  const who = lesson.student_name ?? 'them'

  async function followUp(as: 'homework' | 'next') {
    setBusy(as)
    try {
      const r = await apiFetch(`/api/tutor/sessions/${lesson.id}/follow-up`, { method: 'POST', body: JSON.stringify({ ...body, as }) })
      toast(as === 'homework' ? `${r.problems} to practise, on ${who === 'them' ? 'their' : `${who}'s`} portal` : `On the next lesson's board, first page`)
      await onChanged()
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  async function moreLikeThese() {
    setBusy('ai')
    try {
      const { draft: d } = await apiFetch('/api/tutor/ai/similar', {
        method: 'POST',
        body: JSON.stringify({
          topic: `${lesson.student_name ?? lesson.group_name ?? 'lesson'}, ${shortDate(lesson.scheduled_at)}`,
          problems: chosen.map((m) => ({ stem: m.stem, correct: m.correct, choices: 'problem' in m ? m.problem.choices : undefined })),
        }),
      })
      setDraft(d)
    } catch (err) {
      toast((err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  if (draft) {
    return (
      <section className="surface-card slot">
        <AiImportReview draft={draft} filename="follow-up" confirmLabel={`Give to ${lesson.student_name ?? lesson.group_name ?? 'them'}`}
          onDiscard={() => setDraft(null)}
          onCommitted={async (setId) => {
            setDraft(null)
            try {
              await apiFetch(`/api/tutor/sessions/${lesson.id}/homework`, { method: 'POST', body: JSON.stringify({ setId }) })
              toast('Practice given')
              await onChanged()
            } catch (err) {
              toast((err as Error).message)
            }
          }} />
      </section>
    )
  }

  return (
    <section className="surface-card slot after-lesson">
      <div className="slot-head">
        <span className="card-title-lg">After the lesson</span>
        {results.boardPdf && (
          <a href={fileUrl(results.boardPdf)} target="_blank" rel="noopener noreferrer" className="card-link">
            <FileText size={14} strokeWidth={2} /> Board notes
          </a>
        )}
      </div>
      {results.boardPdf && <p className="muted">The board is saved as notes on {lesson.student_name ? `${lesson.student_name}'s` : 'each student’s'} portal.</p>}

      {results.board.length > 0 && (
        <div className="result-block">
          <div className="list-row-sub">On the board</div>
          {results.board.map((q, i) => (
            <div key={q.qid} className="result-row">
              <span className="result-q">Q{i + 1}</span>
              <span className="result-stem"><RichText text={short(q.stem)} /></span>
              <span className={`badge badge-${q.wrong.length ? 'warning' : 'correct'} num`}>
                {q.right.length}/{q.right.length + q.wrong.length} right
              </span>
            </div>
          ))}
        </div>
      )}

      {results.homework.map((h) => (
        <div key={h.title} className="result-block">
          <div className="list-row-sub">
            Homework from last time: {h.title} · {h.handedIn}/{h.assigned} handed in
            {h.handedIn > 0 && ` · ${h.misses.length ? `${h.misses.length} missed` : 'nothing missed'}`}
          </div>
        </div>
      ))}

      {misses.length > 0 ? (
        <>
          <div className="list-row-title">Follow up on what was missed</div>
          <div className="miss-list">
            {misses.map((m) => (
              <label key={m.key} className="miss-row">
                <input type="checkbox" checked={picked.has(m.key)} onChange={(e) => {
                  const next = new Set(picked)
                  if (e.target.checked) next.add(m.key); else next.delete(m.key)
                  setPicked(next)
                }} />
                <span>
                  <RichText text={short(m.stem)} />
                  <span className="muted miss-who">
                    {m.from === 'board' ? 'Board' : 'Homework'}: {m.who.map((w) => `${lesson.group_id ? `${w.name.split(' ')[0]} ` : ''}put ${w.answer || '(blank)'}`).join(', ')}
                    {m.correct ? ` · answer ${m.correct}` : ''}
                  </span>
                </span>
              </label>
            ))}
          </div>
          <div className="slot-actions">
            <Button variant="secondary" disabled={!chosen.length || !!busy} onClick={() => followUp('homework')}>
              {busy === 'homework' ? 'Giving…' : 'Practise them as homework'}
            </Button>
            <Button variant="secondary" disabled={!chosen.length || !!busy} onClick={() => followUp('next')}>
              {busy === 'next' ? 'Adding…' : 'Go over them next lesson'}
            </Button>
            {aiEnabled && (
              <Button variant="ghost" disabled={!chosen.length || !!busy} onClick={moreLikeThese}>
                {busy === 'ai' ? 'Claude is writing…' : 'More like these (Claude)'}
              </Button>
            )}
          </div>
        </>
      ) : (results.board.length > 0 || results.homework.some((h) => h.handedIn > 0)) ? (
        <p className="muted">Nothing missed.</p>
      ) : (
        <p className="muted">
          Nothing came back yet. Answers to the plan's questions on the board, and last time's homework, show up here.
          {' '}<Link to="/app/insights?tab=homework" className="card-link">All homework</Link>
        </p>
      )}
    </section>
  )
}
