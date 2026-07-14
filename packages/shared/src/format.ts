// The legacy authoring contract (tittel-sat-homework/shared/format.ts), kept
// verbatim so Phase 1's JSON import can validate/render old problem-set files
// before folding them onto the new bank+set shape (problems are reusable here,
// not embedded in a set — see db/schema.sql set_problems).
//
// Rendering split:
//   - `$...$` / `$$...$$` in any text  -> KaTeX, live in the browser (math only).
//   - `![figId]` references            -> a Figure, pre-rendered to SVG at
//                                          import time via node-tikzjax.

export type LegacyProblemType = 'mc' | 'grid'

export interface LegacyChoice {
  id: string // 'A' | 'B' | 'C' | 'D' (author-chosen, any stable label)
  content: string
}

/** A diagram authored in full LaTeX; pre-rendered to SVG at import time. */
export interface Figure {
  id: string // referenced inline as ![id]
  latex: string
  label?: string
  packages?: string[]
  libraries?: string[]
}

/** A figure after rendering, as stored on the problem and sent to the client. */
export interface RenderedFigure {
  id: string
  label?: string
  svg: string
}

export interface LegacyProblem {
  id: string
  type: LegacyProblemType
  stem: string
  choices?: LegacyChoice[]
  correct?: string
  answers?: string[]
  explanation?: string
  figures?: Figure[]
}

export interface LegacyProblemSet {
  id: string
  title: string
  problems: LegacyProblem[]
}
