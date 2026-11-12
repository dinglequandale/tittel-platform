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

// The small "made with <name>∎" mark under student and parent pages (OVERHAUL
// R6): the tutor's brand leads, ours is only this, and it's the referral loop.
// Opens the home page in a new tab so a student mid-homework loses nothing.
export function MadeWith({ name }: { name: string }) {
  return (
    <footer className="made-with">
      <a href="/" target="_blank" rel="noopener">
        made with <Wordmark name={name} />
      </a>
    </footer>
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
