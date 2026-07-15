import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import './board.css'

type ClassMode = 'small' | 'large'

// Ported from the legacy whiteboard's Landing.tsx — PLAN.md §6.3: "the free
// /try quick-board stays fully ephemeral... unchanged, and doubles as the
// demo." Board identity is just a room id in the URL; nothing here touches
// the database.
function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
}

export function TryLanding() {
  const navigate = useNavigate()
  const [toast, setToast] = useState<string | null>(null)
  const [mode, setMode] = useState<ClassMode>('small')
  const [customName, setCustomName] = useState('')

  async function startBoard() {
    const slug = slugify(customName)
    const roomId = slug || crypto.randomUUID().slice(0, 10)
    const shareLink = `${window.location.origin}/b/${roomId}`
    try {
      await navigator.clipboard.writeText(shareLink)
      setToast('Link copied — send it to your students')
    } catch {
      setToast('Board created — copy the link from the bar up top')
    }
    const fragment = mode === 'large' ? '#host-large' : '#host'
    navigate(`/b/${roomId}${fragment}`)
  }

  return (
    <div className="board-landing board-scope">
      <h1>Quick whiteboard</h1>
      <p>
        Spin up a shared whiteboard in one click. Send the link to your students — no sign-up, no
        install. When everyone leaves, the board disappears.
      </p>

      <div className="mode-picker">
        <ModeOption
          selected={mode === 'small'}
          onSelect={() => setMode('small')}
          title="Individual / small group"
          desc="Everyone can draw freely. Quick and open."
        />
        <ModeOption
          selected={mode === 'large'}
          onSelect={() => setMode('large')}
          title="Large group"
          desc="Students enter a name; you control who can write."
        />
      </div>

      <div className="custom-name">
        <label htmlFor="class-name">Fixed class URL (optional)</label>
        <div className="custom-name-row">
          <span className="custom-name-prefix">/b/</span>
          <input
            id="class-name"
            type="text"
            placeholder="sat-math-bootcamp"
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && startBoard()}
            autoComplete="off"
            spellCheck={false}
          />
        </div>
        <span className="custom-name-hint">
          {slugify(customName)
            ? `Students reuse this same link every session: /b/${slugify(customName)}`
            : 'Leave blank for a one-off board with a random link.'}
        </span>
      </div>

      <button className="board-start-btn" onClick={startBoard}>
        Start a new board
      </button>
      <p className="hint">You drive the view: when you pan or zoom, your students&rsquo; screens follow yours.</p>
      {toast && <div className="board-toast">{toast}</div>}
    </div>
  )
}

function ModeOption({
  selected,
  onSelect,
  title,
  desc,
}: {
  selected: boolean
  onSelect: () => void
  title: string
  desc: string
}) {
  return (
    <button type="button" className={`mode-option ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={onSelect}>
      <span className="mode-option-title">{title}</span>
      <span className="mode-option-desc">{desc}</span>
    </button>
  )
}
