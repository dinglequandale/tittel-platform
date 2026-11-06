import { useEffect, useRef, useState } from 'react'
import { useBoardValue, useEditor } from './engine/react.ts'

const MAX_DOTS = 5

function initial(name: string) {
  return name.trim().charAt(0).toUpperCase() || '?'
}

// Who's on the board, top-right. On a large class the tutor's list also grants
// write access, one student at a time.
export function PeopleMenu({
  granted,
  onToggle,
  selfId,
}: {
  /** Set for the tutor of a large class; absent, this only shows who's here. */
  granted?: Set<string>
  onToggle?: (studentId: string, allow: boolean) => void
  selfId: string
}) {
  const editor = useEditor()
  const people = useBoardValue(editor, () => editor.getCollaborators().filter((c) => c.userId !== selfId))
  const [open, setOpen] = useState(false)
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    window.addEventListener('pointerdown', close, true)
    return () => window.removeEventListener('pointerdown', close, true)
  }, [open])

  if (people.length === 0) return null

  return (
    <div className="people-menu" ref={root}>
      <button
        className="people-menu__dots"
        aria-label={`${people.length} on the board`}
        aria-expanded={granted ? open : undefined}
        title={people.map((p) => p.userName).join(', ')}
        disabled={!granted}
        onClick={() => setOpen((v) => !v)}
      >
        {people.slice(0, MAX_DOTS).map((p) => (
          <span key={p.clientId} className="people-menu__dot" style={{ background: p.color }}>
            {initial(p.userName)}
          </span>
        ))}
        {people.length > MAX_DOTS && <span className="people-menu__more">+{people.length - MAX_DOTS}</span>}
      </button>
      {open && granted && (
        <div className="people-menu__panel write-access">
          <div className="write-access__title">Write access</div>
          {people.map((p) => {
            const can = granted.has(p.userId)
            return (
              <div className="write-access__row" key={p.clientId}>
                <span className="write-access__dot" style={{ background: p.color }} />
                <span className="write-access__name">{p.userName || 'Student'}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={can}
                  title={can ? 'Can write — click to lock' : 'Locked — click to let them write'}
                  className={`calc-switch ${can ? 'on' : ''}`}
                  onClick={() => onToggle?.(p.userId, !can)}
                >
                  <span className="calc-switch-knob" />
                </button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
