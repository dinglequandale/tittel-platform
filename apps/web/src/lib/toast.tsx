import { createContext, useCallback, useContext, useState } from 'react'
import type { ReactNode } from 'react'
import { ToastProvider, ToastViewport, ToastRoot, ToastTitle } from '@tittel/ui'

interface ToastEntry { id: number; message: string }

const ToastContext = createContext<((message: string) => void) | null>(null)

export function useToast(): (message: string) => void {
  const push = useContext(ToastContext)
  if (!push) throw new Error('useToast must be used within AppToastProvider')
  return push
}

let nextId = 0

export function AppToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([])

  const push = useCallback((message: string) => {
    setToasts((t) => [...t, { id: nextId++, message }])
  }, [])

  return (
    <ToastContext.Provider value={push}>
      <ToastProvider swipeDirection="right">
        {children}
        {toasts.map((t) => (
          <ToastRoot
            key={t.id}
            duration={4000}
            onOpenChange={(open) => {
              if (!open) setToasts((cur) => cur.filter((x) => x.id !== t.id))
            }}
          >
            <ToastTitle>{t.message}</ToastTitle>
          </ToastRoot>
        ))}
        <ToastViewport />
      </ToastProvider>
    </ToastContext.Provider>
  )
}
