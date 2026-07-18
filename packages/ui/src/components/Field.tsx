import { cloneElement, forwardRef, isValidElement, useId } from 'react'
import type { InputHTMLAttributes, ReactElement, ReactNode } from 'react'
import clsx from 'clsx'

export interface FieldProps {
  label?: string
  hint?: string
  error?: string
  children: ReactNode
}

// Associates the label with its control via htmlFor/id when the field wraps a
// single element (the common case — Input, textarea, a Select trigger).
// Fields wrapping multiple elements (a checkbox row, a tag-pill-row) are left
// unassociated, same as before — there's no single control to point at.
export function Field({ label, hint, error, children }: FieldProps) {
  const generatedId = useId()
  const singleChild = isValidElement(children) ? (children as ReactElement<{ id?: string }>) : null
  const existingId = singleChild?.props.id
  const controlId = singleChild ? existingId ?? generatedId : undefined
  const content = singleChild && !existingId ? cloneElement(singleChild, { id: generatedId }) : children

  return (
    <div className="field">
      {label && <label className="field-label" htmlFor={controlId}>{label}</label>}
      {content}
      {error ? <span className="field-error">{error}</span> : hint ? <span className="field-hint">{hint}</span> : null}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={clsx('input', className)} {...props} />,
)
Input.displayName = 'Input'
