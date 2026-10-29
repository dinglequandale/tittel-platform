import { useEffect, useRef, useState } from 'react'
import { BookOpen } from 'lucide-react'
import { apiFetch } from '../../lib/api.ts'

interface LibraryLesson {
  id: string
  title: string
  version: number
}

// Bar button + list of the library's plans. Rendered inside the tutor's top bar
// (not a portal) so it stacks above tldraw's UI without z-index games.
export function LessonPicker({ onPick }: { onPick: (lessonId: string) => void }) {
  const [open, setOpen] = useState(false)
  const [lessons, setLessons] = useState<LibraryLesson[] | null>(null)
  const [error, setError] = useState('')
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    setError('')
    apiFetch('/api/tutor/lessons')
      .then((res) => setLessons(res.lessons))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [open])

  return (
    <div className="lesson-picker" ref={root}>
      <button
        className="dock-btn"
        aria-expanded={open}
        aria-label="Put a plan on the board"
        title="Put a plan from your library on the board"
        onClick={() => setOpen((v) => !v)}
      >
        <BookOpen size={15} />
        <span className="dock-label">Plans</span>
      </button>
      {open && (
        <div className="lesson-picker__panel" role="menu">
          <div className="lesson-picker__title">Put a plan on the board</div>
          {error && <div className="lesson-picker__empty">{error}</div>}
          {!error && lessons === null && <div className="lesson-picker__empty">Loading…</div>}
          {!error && lessons?.length === 0 && <div className="lesson-picker__empty">No plans in your library yet</div>}
          {lessons?.map((l) => (
            <button
              key={l.id}
              role="menuitem"
              className="lesson-picker__item"
              onClick={() => {
                setOpen(false)
                onPick(l.id)
              }}
            >
              {l.title}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
