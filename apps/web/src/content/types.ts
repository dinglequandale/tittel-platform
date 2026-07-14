export interface Tag {
  id: string
  name: string
  parent_id: string | null
}

export interface FigureDraft {
  id: string
  latex: string
  label?: string
  svg?: string
}

export interface Choice {
  id: string
  content: string
}

export interface Problem {
  id: string
  type: 'mc' | 'multi' | 'numeric' | 'text' | 'frq'
  stem_latex: string
  choices: Choice[]
  correct: unknown
  accept: string[]
  explanation_latex: string | null
  figures: FigureDraft[]
  difficulty: number | null
  source: string | null
  tags: Tag[]
  created_at: string
  updated_at: string
}

export interface ProblemSetSummary {
  id: string
  title: string
  description: string | null
  template: 'neutral' | 'sat'
  problem_count: number
  created_at: string
  updated_at: string
}

export interface ProblemSetDetail extends ProblemSetSummary {
  problems: (Pick<Problem, 'id' | 'type' | 'stem_latex' | 'choices' | 'correct' | 'accept' | 'explanation_latex' | 'figures'> & {
    ordinal: number
  })[]
}

export interface LessonSummary {
  id: string
  title: string
  version: number
  created_at: string
  updated_at: string
}
