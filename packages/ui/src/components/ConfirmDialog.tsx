import { Button } from './Button.tsx'
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogClose } from './Dialog.tsx'

export interface ConfirmDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  confirmLabel?: string
  onConfirm: () => void
}

/** Shared "are you sure?" gate for destructive actions — archive/delete. */
export function ConfirmDialog({
  open, onOpenChange, title, description, confirmLabel = 'Confirm', onConfirm,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent {...(!description && { 'aria-describedby': undefined })}>
        <DialogTitle>{title}</DialogTitle>
        {description && <DialogDescription>{description}</DialogDescription>}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem' }}>
          <DialogClose asChild><Button variant="ghost">Cancel</Button></DialogClose>
          <Button variant="danger" onClick={() => { onOpenChange(false); onConfirm() }}>{confirmLabel}</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
