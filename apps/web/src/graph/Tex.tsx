import { useMemo } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'

/** Static LaTeX (evaluation chips, point cards). Editable math uses MathQuill. */
export function Tex({ latex, className }: { latex: string; className?: string }) {
  const html = useMemo(() => katex.renderToString(latex, { throwOnError: false }), [latex])
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />
}
