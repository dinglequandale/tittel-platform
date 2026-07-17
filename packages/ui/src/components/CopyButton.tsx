import { useState } from 'react'
import { Button } from './Button.tsx'
import type { ButtonProps } from './Button.tsx'

export interface CopyButtonProps extends Omit<ButtonProps, 'onClick' | 'children'> {
  text: string
  label?: string
}

export function CopyButton({ text, label = 'Copy', variant = 'ghost', ...props }: CopyButtonProps) {
  const [copied, setCopied] = useState(false)

  async function onClick() {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <Button variant={variant} onClick={onClick} {...props}>
      {copied ? 'Copied ✓' : label}
    </Button>
  )
}
