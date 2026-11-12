import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { MadeWith } from '@tittel/ui'
import { BRAND_NAME } from '@tittel/shared'
import { apiFetch } from '../lib/api.ts'
import { supabase } from '../lib/supabase.ts'
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

type Resolved = {
  isHost: boolean
  mode: ClassMode
  displayName: string
  authParams: string
  /** Persistent boards: the board token's server-issued id (see joinToken). */
  userId?: string
}

type TokenResponse = { role: string; mode: string; boardToken: string; displayName: string; userId: string }

// Board tokens live 12h; reuse a guest's for a bit less than that.
const TOKEN_REUSE_MS = 11 * 60 * 60 * 1000

/**
 * POST /api/board/:id/token, keeping a guest's token for this tab. The board
 * knows a student by the token's userId (presence, the tutor's write grants,
 * the server's read-only check), so a refresh must not mint a new identity:
 * a student granted the pen would come back locked. Signed-in tutors always
 * mint fresh (their id is their account anyway).
 */
async function joinToken(boardId: string, name?: string): Promise<TokenResponse> {
  const key = `board-join:${boardId}`
  const { data } = await supabase.auth.getSession()
  if (!data.session) {
    try {
      const cached = JSON.parse(sessionStorage.getItem(key) ?? 'null') as (TokenResponse & { at: number }) | null
      if (cached && cached.role === 'guest' && Date.now() - cached.at < TOKEN_REUSE_MS) return cached
    } catch {
      /* unreadable cache: mint a new token */
    }
  }
  const res = (await apiFetch(`/api/board/${boardId}/token`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  })) as TokenResponse
  try {
    if (res.role === 'guest') sessionStorage.setItem(key, JSON.stringify({ ...res, at: Date.now() }))
  } catch {
    /* storage blocked: the student just gets a new id on refresh */
  }
  return res
}

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
      const res = await joinToken(boardId!, name)
      if (cancelled) return
      setNeedsName(null)
      setResolved({
        isHost: res.role === 'host',
        mode: res.mode === 'large' ? 'large' : mode,
        displayName: res.displayName,
        authParams: `boardToken=${encodeURIComponent(res.boardToken)}`,
        userId: res.userId,
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
          joinToken(boardId, name)
            .then((res) => {
              setResolved({
                isHost: false,
                mode: needsName,
                displayName: res.displayName,
                authParams: `boardToken=${encodeURIComponent(res.boardToken)}`,
                userId: res.userId,
              })
            })
            .catch((err) => setError((err as Error).message))
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
  userId: tokenUserId,
}: {
  boardId: string
  isHost: boolean
  mode: ClassMode
  displayName: string
  authParams: string
  userId?: string
}) {
  const [channel, setChannel] = useState<ControlChannel | null>(null)
  // Persistent boards use the token's id (the server enforces grants by it);
  // the /try board has no token, so a per-tab id stands in.
  const userId = tokenUserId ?? stablePerTabId()

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
      <MadeWith name={BRAND_NAME} />
    </div>
  )
}
