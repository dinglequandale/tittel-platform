import * as RadixDialog from '@radix-ui/react-dialog'
import type { ReactNode } from 'react'

export const Dialog = RadixDialog.Root
export const DialogTrigger = RadixDialog.Trigger
export const DialogTitle = RadixDialog.Title
export const DialogClose = RadixDialog.Close

export function DialogContent({ children }: { children: ReactNode }) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="overlay" />
      <RadixDialog.Content className="dialog-content">{children}</RadixDialog.Content>
    </RadixDialog.Portal>
  )
}
