import { Children, cloneElement, isValidElement, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement, ReactNode } from 'react'
import clsx from 'clsx'

// Children rise in with a little bounce when the group first scrolls into
// view (the website's `.reveal`). Stagger is capped so long lists don't drag.
const MAX_STAGGER = 8

export function Reveal({ children, className }: { children: ReactNode; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    const el = ref.current
    if (!el || !('IntersectionObserver' in window)) return setInView(true)
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        setInView(true)
        io.disconnect()
      }
    }, { threshold: 0.1 })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  let i = 0
  return (
    <div ref={ref} className={clsx('reveal', inView && 'reveal-in', className)}>
      {Children.map(children, (child) => {
        if (!isValidElement(child)) return child
        const el = child as ReactElement<{ style?: CSSProperties }>
        const style = { ...el.props.style, '--i': Math.min(i++, MAX_STAGGER) } as CSSProperties
        return cloneElement(el, { style })
      })}
    </div>
  )
}
