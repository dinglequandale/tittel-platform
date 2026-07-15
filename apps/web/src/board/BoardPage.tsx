import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { apiFetch } from '../lib/api.ts'
import { ControlChannel } from './controlChannel.ts'
import { BoardCanvas } from './BoardCanvas.tsx'
import './board.css'

type ClassMode = 'small' | 'large'

function stablePerTabId(): string {
  const key = 'board-user-id'
  let v = sessionStorage.getItem(key)
  if (!v) {
    v = crypto.randomUUID()
    sessionStorage.setItem(key, v)
  }
  return v
}

const ANIMALS = [
  'Fox', 'Owl', 'Bee', 'Otter', 'Hawk', 'Lynx', 'Wolf', 'Crane', 'Newt', 'Toad',
  'Mole', 'Wren', 'Seal', 'Ibis', 'Lark', 'Puma', 'Stag', 'Vole', 'Finch', 'Heron',
]
function animalName(): string {
  const key = 'board-animal'
  let v = sessionStorage.getItem(key)
  if (!v) {
    v = `${ANIMALS[Math.floor(Math.random() * ANIMALS.length)]} ${Math.floor(10 + Math.random() * 90)}`
    sessionStorage.setItem(key, v)
  }
  return v
}

const NAME_KEY = 'board-name'

type Resolved = { isHost: boolean; mode: ClassMode; displayName: string; authParams: string }

/**
 * Resolves who's joining and how, for BOTH board kinds:
 *  - Persistent /b/:boardId (a real `boards` row): auth-derived host/guest via
 *    POST /api/board/:id/token, which mints a short-lived signed board token
 *    (PLAN.md §6.3 — replaces the legacy `#host` fragment).
 *  - The free ephemeral /try quick-board (no `boards` row — GET meta 404s):
 *    stays exactly as it was, `#host`/`#host-large` URL fragment, no auth, no
 *    persistence. It's still the current public product (§6.3), unchanged.
 */
export function BoardPage() {
  const { boardId } = useParams<{ boardId: string }>()
  const [resolved, setResolved] = useState<Resolved | null>(null)
  const [needsName, setNeedsName] = useState<ClassMode | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!boardId) return
    let cancelled = false

    async function joinPersistent(mode: ClassMode, name?: string) {
      const res = await apiFetch(`/api/board/${boardId}/token`, {
        method: 'POST',
        body: JSON.stringify({ name }),
      })
      if (cancelled) return
      setNeedsName(null)
      setResolved({
        isHost: res.role === 'host',
        mode: res.mode === 'large' ? 'large' : mode,
        displayName: res.displayName,
        authParams: `boardToken=${encodeURIComponent(res.boardToken)}`,
      })
    }

    ;(async () => {
      try {
        const meta = await apiFetch(`/api/board/${boardId}/meta`)
        const mode: ClassMode = meta.mode === 'large' ? 'large' : 'small'
        if (mode === 'large') {
          const cached = sessionStorage.getItem(NAME_KEY)
          if (cached) {
            await joinPersistent(mode, cached)
          } else {
            // Try without a name first — an authenticated tutor (the host)
            // never needs the name gate; only an unauthenticated guest does.
            try {
              await joinPersistent(mode)
            } catch (err) {
              if ((err as Error & { status?: number }).status === 400) {
                if (!cancelled) setNeedsName(mode)
              } else {
                throw err
              }
            }
          }
        } else {
          await joinPersistent(mode)
        }
      } catch (err) {
        const status = (err as Error & { status?: number }).status
        if (status === 404) {
          // Ephemeral path: legacy `#host`/`#host-large` fragment, unauthenticated.
          const hash = window.location.hash
          const isHost = hash.startsWith('#host')
          const mode: ClassMode = hash.includes('large') ? 'large' : 'small'
          if (!cancelled) {
            setResolved({
              isHost,
              mode,
              displayName: isHost ? 'Tutor' : animalName(),
              authParams: `role=${isHost ? 'host' : 'guest'}`,
            })
          }
          return
        }
        if (!cancelled) setError((err as Error).message)
      }
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId])

  if (!boardId) return null
  if (error) {
    return (
      <div className="board-status board-scope">
        <div>Couldn&rsquo;t open this board.</div>
        <div style={{ fontSize: '0.85rem' }}>{error}</div>
      </div>
    )
  }
  if (needsName) {
    return (
      <NameGate
        onSubmit={(name) => {
          sessionStorage.setItem(NAME_KEY, name)
          setNeedsName(null)
          // Re-run the effect's join path with the now-cached name.
          apiFetch(`/api/board/${boardId}/token`, { method: 'POST', body: JSON.stringify({ name }) }).then((res) => {
            setResolved({
              isHost: false,
              mode: needsName,
              displayName: res.displayName,
              authParams: `boardToken=${encodeURIComponent(res.boardToken)}`,
            })
          })
        }}
      />
    )
  }
  if (!resolved) {
    return <div className="board-status board-scope">Connecting to the board…</div>
  }
  return <BoardGate boardId={boardId} {...resolved} />
}

// Once host/mode/name are settled, own the ControlChannel for the board's
// lifetime and mount the synced canvas.
function BoardGate({
  boardId,
  isHost,
  mode,
  displayName,
  authParams,
}: {
  boardId: string
  isHost: boolean
  mode: ClassMode
  displayName: string
  authParams: string
}) {
  const [channel, setChannel] = useState<ControlChannel | null>(null)
  const userId = stablePerTabId()

  useEffect(() => {
    const ch = new ControlChannel(boardId, isHost, authParams)
    setChannel(ch)
    return () => {
      ch.dispose()
      setChannel(null)
    }
  }, [boardId, isHost, authParams])

  if (!channel) {
    return <div className="board-status board-scope">Connecting to the board…</div>
  }

  return (
    <BoardCanvas
      boardId={boardId}
      isHost={isHost}
      mode={mode}
      channel={channel}
      displayName={displayName}
      userId={userId}
      authParams={authParams}
    />
  )
}

function NameGate({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [value, setValue] = useState('')
  const trimmed = value.trim()
  return (
    <div className="name-gate board-scope">
      <form
        className="name-gate-card"
        onSubmit={(e) => {
          e.preventDefault()
          if (trimmed) onSubmit(trimmed)
        }}
      >
        <h2>Join the class</h2>
        <p>Enter your name so your tutor can see who&rsquo;s here.</p>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Your name"
          maxLength={40}
        />
        <button type="submit" className="board-start-btn" disabled={!trimmed}>
          Enter the board
        </button>
      </form>
    </div>
  )
}
