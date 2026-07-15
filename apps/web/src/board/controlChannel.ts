// A single resilient WebSocket to /control/<boardId> that carries every
// tutor-driven realtime message (camera follow, calculator, timer, quiz,
// games). Ported near-verbatim from the legacy whiteboard (PLAN.md: "solid,
// battle-tested; port as-is"). The one change: the URL carries a signed
// `boardToken` (persistent /b/:boardId boards) instead of a bare `role` query
// param — except for the free ephemeral /try path, which keeps the legacy
// `role` param unchanged (see BoardPage.tsx).
type Handler = (msg: any) => void

const STICKY_TYPES = new Set([
  'camera',
  'page',
  'mode',
  'free-reign',
  'calc-access',
  'quiz-stats',
  'quiz-revealed',
  'quiz-open',
  'game-state',
  'game-view',
])

export class ControlChannel {
  private socket: WebSocket | null = null
  private disposed = false
  private handlers = new Map<string, Set<Handler>>()
  private lastByType = new Map<string, any>()

  constructor(
    private readonly boardId: string,
    readonly isHost: boolean,
    private readonly authParams: string,
  ) {
    this.connect()
  }

  private url() {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    return `${proto}://${window.location.host}/control/${encodeURIComponent(this.boardId)}?${this.authParams}`
  }

  private connect() {
    if (this.disposed) return
    const ws = new WebSocket(this.url())
    this.socket = ws
    ws.onopen = () => this.emit('open', { type: 'open' })
    ws.onmessage = (ev) => {
      try {
        const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : '')
        if (msg && msg.type) {
          if (STICKY_TYPES.has(msg.type)) this.lastByType.set(msg.type, msg)
          this.emit(msg.type, msg)
        }
      } catch {
        /* ignore malformed frames */
      }
    }
    ws.onclose = () => {
      this.socket = null
      if (!this.disposed) setTimeout(() => this.connect(), 1000)
    }
    ws.onerror = () => ws.close()
  }

  private emit(type: string, msg: any) {
    this.handlers.get(type)?.forEach((h) => h(msg))
  }

  on(type: string, handler: Handler): () => void {
    let set = this.handlers.get(type)
    if (!set) {
      set = new Set()
      this.handlers.set(type, set)
    }
    set.add(handler)
    if (STICKY_TYPES.has(type) && this.lastByType.has(type)) {
      const cached = this.lastByType.get(type)
      queueMicrotask(() => {
        if (!this.disposed && this.handlers.get(type)?.has(handler)) handler(cached)
      })
    }
    return () => {
      set!.delete(handler)
    }
  }

  send(msg: unknown) {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg))
    }
  }

  dispose() {
    this.disposed = true
    this.socket?.close()
    this.handlers.clear()
  }
}
