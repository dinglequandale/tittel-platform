import { useState } from 'react'
import { emptyState, type GraphState } from '@tittel/graph'
import { GraphCalculator } from './GraphCalculator.tsx'

// Dev-only page (/dev/graph): the calculator on its own, for building and
// checking GRAPH-SPEC behaviour without a board or login. Not routed in
// production builds (router.tsx).
export function GraphPlayground() {
  const [state, setState] = useState<GraphState>(emptyState)
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <GraphCalculator state={state} onChange={setState} />
    </div>
  )
}
