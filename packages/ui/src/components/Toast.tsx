import * as RadixToast from '@radix-ui/react-toast'
import type { ReactNode } from 'react'

export const ToastProvider = RadixToast.Provider
export const ToastTitle = RadixToast.Title

export function ToastViewport() {
  return <RadixToast.Viewport className="toast-viewport" />
}

export function ToastRoot({ children, ...props }: RadixToast.ToastProps & { children: ReactNode }) {
  return (
    <RadixToast.Root className="toast" {...props}>
      {children}
    </RadixToast.Root>
  )
}
