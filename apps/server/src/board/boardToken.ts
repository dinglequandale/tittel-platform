import crypto from 'node:crypto'
import { SignJWT, jwtVerify } from 'jose'

// Short-lived signed board tokens (PLAN.md §6.3): minted server-side on page
// load once we know whether the visitor is the board's host (auth-derived) or
// a guest, then carried by the WS handshake for both the tldraw sync socket
// and the ControlChannel — replacing the legacy `#host` URL-fragment model.
// Signed with BOARD_TOKEN_SECRET so tokens survive a redeploy mid-lesson;
// falls back to a per-boot random secret (dev convenience) if unset — a live
// class loses tokens on restart in that case, same as before this fix.
if (!process.env.BOARD_TOKEN_SECRET && process.env.NODE_ENV === 'production') {
  console.warn('[board] BOARD_TOKEN_SECRET is not set — board links break on every restart.')
}
const secret = new TextEncoder().encode(
  process.env.BOARD_TOKEN_SECRET || crypto.randomBytes(32).toString('hex'),
)

export interface BoardTokenPayload {
  boardId: string
  orgId: string | null
  role: 'host' | 'guest'
  userId: string
  name: string
}

export async function signBoardToken(payload: BoardTokenPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(secret)
}

export async function verifyBoardToken(token: string): Promise<BoardTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret)
    if (typeof payload.boardId !== 'string' || typeof payload.role !== 'string') return null
    return {
      boardId: payload.boardId,
      orgId: typeof payload.orgId === 'string' ? payload.orgId : null,
      role: payload.role === 'host' ? 'host' : 'guest',
      userId: typeof payload.userId === 'string' ? payload.userId : '',
      name: typeof payload.name === 'string' ? payload.name : '',
    }
  } catch {
    return null
  }
}
