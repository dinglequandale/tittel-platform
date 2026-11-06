import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { WebsocketProvider } from 'y-websocket'
import { equalityDeep } from 'lib0/function'
import { BoardDoc } from '@tittel/board'
import { BoardEditor } from './editor.ts'

export const EditorContext = createContext<BoardEditor | null>(null)

export function useEditor() {
  return useContext(EditorContext)!
}

const noSubscription = () => () => {}

/**
 * Reads from the editor and re-renders when the answer changes. By default
 * "changes" means by value, so a read can build a new array each time; pass
 * `Object.is` for anything large that the document already keeps stable.
 */
export function useBoardValue<T>(
  editor: BoardEditor | null,
  read: () => T,
  isEqual: (a: T, b: T) => boolean = equalityDeep,
): T {
  const last = useRef<{ value: T } | null>(null)
  const snapshot = () => {
    const value = read()
    if (last.current && isEqual(last.current.value, value)) return last.current.value
    last.current = { value }
    return value
  }
  return useSyncExternalStore(editor?.subscribe ?? noSubscription, snapshot)
}

export type Connection =
  | { status: 'loading'; editor: null; error: null }
  | { status: 'ready'; editor: BoardEditor; error: null }
  | { status: 'error'; editor: null; error: string }

/** Failed attempts before a board that never opened reports an error. */
const MAX_FIRST_ATTEMPTS = 3

/** Opens the board's sync socket; the editor exists once the document has arrived. */
export function useBoardConnection(
  boardId: string,
  authParams: string,
  user: { userId: string; userName: string; color: string },
): Connection {
  const [connection, setConnection] = useState<Connection>({ status: 'loading', editor: null, error: null })

  useEffect(() => {
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
    const doc = new BoardDoc()
    const provider = new WebsocketProvider(`${proto}://${window.location.host}/connect`, boardId, doc.ydoc, {
      params: Object.fromEntries(new URLSearchParams(authParams)),
      // Off so that two tabs meet at the server, like two computers.
      disableBc: true,
    })
    provider.awareness.setLocalStateField('user', user)

    let editor: BoardEditor | null = null
    let failures = 0
    provider.on('sync', (synced: boolean) => {
      if (!synced || editor) return
      editor = new BoardEditor(doc, provider.awareness)
      setConnection({ status: 'ready', editor, error: null })
    })
    provider.on('status', ({ status }: { status: string }) => editor?.setConnected(status === 'connected'))
    provider.on('connection-close', () => {
      if (!editor && ++failures >= MAX_FIRST_ATTEMPTS) {
        provider.disconnect()
        setConnection({ status: 'error', editor: null, error: 'The board didn’t answer. It may have been archived.' })
      }
    })

    return () => {
      editor?.dispose()
      provider.destroy()
      doc.ydoc.destroy()
      setConnection({ status: 'loading', editor: null, error: null })
    }
    // `user` is fixed for the life of a board visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId, authParams])

  return connection
}
