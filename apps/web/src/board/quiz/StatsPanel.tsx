// Host-only floating panel showing live answer statistics for the board's
// lesson questions (ported from the legacy whiteboard, restyled). The server pushes `{type:'quiz-stats', stats}` only to
// hosts (see shared/quiz.ts QuizStatsMsg) — guests never see this data, and
// this component never receives or displays answer keys.
import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ChevronRight, X } from 'lucide-react'
import type { QuestionStats, QuizStats, Submission } from '@tittel/shared'
import { ConfirmDialog } from '@tittel/ui'
import type { ControlChannel } from '../controlChannel.ts'
import { downloadStatsCsv, type LabelFor } from './exportStats.ts'
import './quiz.css'

type Pos = { x: number; y: number }

// Keep roughly in step with `.qs-panel`'s CSS width (see stats.css) so a drag
// can't push the whole panel off-screen. Approximate, like Timer.tsx's own clamp.
const PANEL_WIDTH = 400

function defaultPos(): Pos {
  return { x: 12, y: 80 }
}

function clampPos(p: Pos): Pos {
  return {
    x: Math.min(Math.max(p.x, 0), Math.max(0, window.innerWidth - PANEL_WIDTH)),
    y: Math.min(Math.max(p.y, 0), window.innerHeight - 60),
  }
}

/** ms -> `m:ss`. `null` (no data yet) -> em-dash, never a bogus "0:00". */
function fmtTime(ms: number | null): string {
  if (ms == null || !Number.isFinite(ms)) return '—'
  const totalSecs = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(totalSecs / 60)
  const s = totalSecs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** `num/den` as a rounded percentage. Guards div-by-zero -> em-dash, never NaN%/0%. */
function fmtPct(num: number, den: number): string {
  if (!den) return '—'
  return `${Math.round((num / den) * 100)}%`
}

export function StatsPanel({
  channel,
  initialStats,
  onHide,
  rosterSize,
  openQids,
  allAnswered,
  labelFor,
}: {
  channel: ControlChannel
  initialStats?: QuizStats | null
  onHide: () => void
  /** Class roster size (from tldraw presence), so "answered" can show a denominator. */
  rosterSize?: number
  /** Currently-open (assigned) question ids, from Board's `quiz-open` state — used
   *  to mark live rows and to know which questions count toward `allAnswered`. */
  openQids?: Set<string>
  /** True when every open question has been answered by every student in the
   *  roster. Computed in Board.tsx (single source of truth, shared with the dock
   *  pill) so this panel doesn't duplicate that definition. */
  allAnswered?: boolean
  labelFor: LabelFor
}): JSX.Element {
  const [pos, setPos] = useState<Pos>(() => clampPos(defaultPos()))
  const posRef = useRef(pos)
  posRef.current = pos

  const [stats, setStats] = useState<QuizStats | null>(initialStats ?? null)

  // Which question rows are drilled into. Local UI state only, never synced.
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())

  useEffect(() => channel.on('quiz-stats', (m) => setStats(m.stats as QuizStats)), [channel])

  function toggle(qid: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(qid)) next.delete(qid)
      else next.add(qid)
      return next
    })
  }

  // Drag, copied from Timer.tsx's pointer-capture pattern — but this panel is
  // local to the tutor's own screen, so position is never broadcast.
  const startDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    e.preventDefault()
    const el = e.currentTarget
    el.setPointerCapture(e.pointerId)
    const sx = e.clientX
    const sy = e.clientY
    const base = posRef.current
    const onMove = (ev: PointerEvent) =>
      setPos(clampPos({ x: base.x + (ev.clientX - sx), y: base.y + (ev.clientY - sy) }))
    const onUp = () => {
      el.releasePointerCapture?.(e.pointerId)
      el.removeEventListener('pointermove', onMove)
      el.removeEventListener('pointerup', onUp)
    }
    el.addEventListener('pointermove', onMove)
    el.addEventListener('pointerup', onUp)
  }

  // An in-app dialog, not window.confirm: the browser's own one is blocked in an
  // unfocused tab (it just returns false) and can't be styled or tested.
  const [confirming, setConfirming] = useState<'reveal' | 'reset' | null>(null)

  function handleExport() {
    if (!stats) return
    downloadStatsCsv(stats, labelFor)
  }

  const hasQuestions = !!stats && stats.questions.length > 0

  return (
    <div className="qs-panel" style={{ left: pos.x, top: pos.y }}>
      <div className="qs-header" onPointerDown={startDrag}>
        <span className="qs-title">Answers</span>
        <button className="qs-close-btn" onClick={onHide} aria-label="Hide answers">
          <X size={14} />
        </button>
      </div>

      {allAnswered && (
        <div className="qs-all-answered-banner">Everyone has answered every open question</div>
      )}

      <div className="qs-body">
        {!hasQuestions ? (
          <div className="qs-empty">No questions on the board yet. When a plan with answers goes on the board, its questions show up here.</div>
        ) : (
          <div className="qs-list">
            {stats!.questions.map((q) => (
              <QuestionRow
                key={q.qid}
                q={q}
                label={labelFor(q.qid)}
                rosterSize={rosterSize}
                isOpen={!!openQids?.has(q.qid)}
                expanded={expanded.has(q.qid)}
                onToggle={() => toggle(q.qid)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="qs-footer">
        <button className="qs-btn" onClick={() => setConfirming('reset')} disabled={!hasQuestions}>
          Reset
        </button>
        <button className="qs-btn" onClick={handleExport} disabled={!hasQuestions}>
          Export CSV
        </button>
        <button
          className="qs-btn primary"
          onClick={() => setConfirming('reveal')}
          disabled={!hasQuestions || !!stats?.revealed}
        >
          {stats?.revealed ? 'Answers revealed' : 'Reveal answers'}
        </button>
      </div>

      <ConfirmDialog
        open={confirming === 'reveal'}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="Reveal the answers?"
        description="Every student sees the correct answer under each question. Only Reset takes it back."
        confirmLabel="Reveal answers"
        onConfirm={() => channel.send({ type: 'quiz-reveal' })}
      />
      <ConfirmDialog
        open={confirming === 'reset'}
        onOpenChange={(open) => !open && setConfirming(null)}
        title="Reset this class's answers?"
        description="This wipes every student's submissions, so the numbers start again from zero."
        confirmLabel="Reset answers"
        onConfirm={() => channel.send({ type: 'quiz-reset' })}
      />
    </div>
  )
}

function QuestionRow({
  q,
  label,
  rosterSize,
  isOpen,
  expanded,
  onToggle,
}: {
  q: QuestionStats
  label: string
  rosterSize?: number
  /** Whether this question is currently open (accepting answers) — drives the
   *  row's "live" marker. */
  isOpen: boolean
  expanded: boolean
  onToggle: () => void
}) {
  const answeredLabel =
    rosterSize != null && rosterSize > 0 ? `${q.answered}/${rosterSize}` : `${q.answered}`
  const rowComplete = rosterSize != null && rosterSize > 0 && q.answered >= rosterSize
  const firstPct = fmtPct(q.firstCorrect, q.answered)
  const latestPct = fmtPct(q.latestCorrect, q.answered)
  const barPct = q.answered > 0 ? Math.round((q.firstCorrect / q.answered) * 100) : 0

  return (
    <div className={`qs-row${isOpen ? ' qs-row-open' : ''}`}>
      <button
        type="button"
        className="qs-row-header"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className={`qs-chevron${expanded ? ' open' : ''}`}>
          <ChevronRight size={12} />
        </span>
        <span className="qs-qid" title={label}>{label}</span>
        <span className={`qs-answered${rowComplete ? ' qs-answered-complete' : ''}`} title="Answered">
          {answeredLabel}
        </span>
        <span className="qs-bar-track">
          <span className="qs-bar-fill" style={{ width: `${barPct}%` }} />
        </span>
        <span className="qs-first-pct" title="First-attempt correct">
          {firstPct}
        </span>
        <span className="qs-median" title="Median time">
          {fmtTime(q.medianMs)}
        </span>
      </button>

      {expanded && (
        <div className="qs-row-detail">
          <div className="qs-detail-summary">
            <span className="qs-detail-label">First-attempt correct: {firstPct}</span>
            <span className="qs-detail-label qs-latest-pct">
              Eventually correct: {latestPct}
            </span>
          </div>
          {q.students.length === 0 ? (
            <div className="qs-detail-empty">No submissions yet.</div>
          ) : (
            <table className="qs-student-table">
              <thead>
                <tr>
                  <th>Student</th>
                  <th>First</th>
                  <th>Latest</th>
                  <th>✓</th>
                  <th>Time</th>
                </tr>
              </thead>
              <tbody>
                {q.students.map((s) => (
                  <StudentRow key={s.userId} s={s} />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

function StudentRow({ s }: { s: Submission }) {
  const showLatest = s.latest !== s.first
  return (
    <tr>
      <td className="qs-student-name">{s.name || 'Anonymous'}</td>
      <td>{s.first || '—'}</td>
      <td>{showLatest ? s.latest || '—' : ''}</td>
      <td className={s.firstCorrect ? 'qs-correct' : 'qs-incorrect'}>
        {s.firstCorrect ? '✓' : '✗'}
      </td>
      <td>{fmtTime(s.elapsedMs)}</td>
    </tr>
  )
}
