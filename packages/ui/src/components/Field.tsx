import { forwardRef } from 'react'
import type { InputHTMLAttributes, ReactNode } from 'react'
import clsx from 'clsx'

export interface FieldProps {
  label?: string
  hint?: string
  error?: string
  children: ReactNode
}

export function Field({ label, hint, error, children }: FieldProps) {
  return (
    <div className="field">
      {label && <label className="field-label">{label}</label>}
      {children}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={clsx('input', className)} {...props} />,
)
Input.displayName = 'Input'
