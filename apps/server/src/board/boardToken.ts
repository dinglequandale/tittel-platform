import { SignJWT, jwtVerify } from 'jose'

// Short-lived signed board tokens (PLAN.md §6.3): minted server-side on page
// load once we know whether the visitor is the board's host (auth-derived) or
// a guest, then carried by the WS handshake for both the tldraw sync socket
// and the ControlChannel — replacing the legacy `#host` URL-fragment model.
// Signed with a random secret generated at process boot: tokens are minted and
// verified by this same running process within a class's lifetime, so there's
// no need for a persisted signing key (a restart simply requires a page reload,
// which re-mints a token anyway).
const secret = new TextEncoder().encode(
  Array.from({ length: 32 }, () => Math.floor(Math.random() * 256).toString(16).padStart(2, '0')).join(''),
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
