import clsx from 'clsx'

// The brand device: a coral square — the ∎ that ends a proof.
export function Qed({ className }: { className?: string }) {
  return <span className={clsx('qed', className)} aria-hidden="true" />
}

// Product name + ∎. Takes the name as a prop so packages/ui stays free of
// @tittel/shared (BRAND_NAME lives there and is still a placeholder).
export function Wordmark({ name, className }: { name: string; className?: string }) {
  return (
    <span className={clsx('wordmark', className)}>
      {name}
      <Qed />
    </span>
  )
}

// Loading indicator: the ∎ cycling through the palette with a pop.
export function QedLoader({ label = 'Loading' }: { label?: string }) {
  return (
    <span className="qed-loader" role="status" aria-label={label}>
      <span className="qed" aria-hidden="true" />
    </span>
  )
}
