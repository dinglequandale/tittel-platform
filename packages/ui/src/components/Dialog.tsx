import * as RadixDialog from '@radix-ui/react-dialog'
import type { ComponentProps, ReactNode } from 'react'

export const Dialog = RadixDialog.Root
export const DialogTrigger = RadixDialog.Trigger
export const DialogTitle = RadixDialog.Title
export const DialogClose = RadixDialog.Close

export function DialogDescription(props: ComponentProps<typeof RadixDialog.Description>) {
  return <RadixDialog.Description className="dialog-description" {...props} />
}

// Radix warns when a dialog has no description — pass aria-describedby={undefined}
// on DialogContent for dialogs that genuinely have none, to silence it deliberately
// rather than by accident.
export function DialogContent({ children, ...props }: { children: ReactNode } & ComponentProps<typeof RadixDialog.Content>) {
  return (
    <RadixDialog.Portal>
      <RadixDialog.Overlay className="overlay" />
      <RadixDialog.Content className="dialog-content" {...props}>{children}</RadixDialog.Content>
    </RadixDialog.Portal>
  )
}
