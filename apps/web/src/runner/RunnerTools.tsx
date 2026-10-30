import { useState } from 'react'
import { X } from 'lucide-react'
import { emptyState, type GraphState } from '@tittel/graph'
import { GraphCalculator, isGraphState } from '../graph/GraphCalculator.tsx'
import { Tex } from '../graph/Tex.tsx'

// Digital-SAT-style help on a homework page, when the tutor ticked it: the
// graphing calculator (GRAPH-SPEC G2's SAT core) and a reference sheet of the
// standard formulas, typeset here. Loaded lazily so plain homework stays light.

const REFERENCE: { name: string; tex: string }[] = [
  { name: 'Circle', tex: 'A = \\pi r^2 \\qquad C = 2\\pi r' },
  { name: 'Rectangle', tex: 'A = \\ell w' },
  { name: 'Triangle', tex: 'A = \\tfrac{1}{2} b h' },
  { name: 'Pythagorean theorem', tex: 'c^2 = a^2 + b^2' },
  { name: 'Special right triangles', tex: '30^\\circ\\!-\\!60^\\circ\\!-\\!90^\\circ:\\; x,\\ x\\sqrt{3},\\ 2x \\qquad 45^\\circ\\!-\\!45^\\circ\\!-\\!90^\\circ:\\; s,\\ s,\\ s\\sqrt{2}' },
  { name: 'Rectangular prism', tex: 'V = \\ell w h' },
  { name: 'Cylinder', tex: 'V = \\pi r^2 h' },
  { name: 'Sphere', tex: 'V = \\tfrac{4}{3}\\pi r^3' },
  { name: 'Cone', tex: 'V = \\tfrac{1}{3}\\pi r^2 h' },
  { name: 'Pyramid', tex: 'V = \\tfrac{1}{3}\\ell w h' },
]
const FACTS = [
  'A full circle is 360°, or 2π radians.',
  'The angles of a triangle add up to 180°.',
]

function ReferenceSheet() {
  return (
    <div className="ref-sheet">
      {REFERENCE.map((r) => (
        <div key={r.name} className="ref-row">
          <div className="list-row-sub">{r.name}</div>
          <Tex latex={r.tex} />
        </div>
      ))}
      {FACTS.map((f) => <p key={f} className="ref-fact">{f}</p>)}
    </div>
  )
}

/** The calculator's expressions survive a reload of this homework, on this device only. */
function useSavedGraph(token: string): [GraphState, (g: GraphState) => void] {
  const key = `hw-calc:${token}`
  const [graph, setGraph] = useState<GraphState>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? 'null')
      return isGraphState(saved) ? saved : emptyState()
    } catch {
      return emptyState()
    }
  })
  return [graph, (g) => {
    setGraph(g)
    try { localStorage.setItem(key, JSON.stringify(g)) } catch { /* storage full or blocked: still works this visit */ }
  }]
}

export default function RunnerTools({ token, panel, onClose }: { token: string; panel: 'calculator' | 'reference'; onClose: () => void }) {
  const [graph, setGraph] = useSavedGraph(token)
  return (
    <aside className="runner-tool" aria-label={panel === 'calculator' ? 'Calculator' : 'Reference sheet'}>
      <div className="runner-tool-head">
        <strong>{panel === 'calculator' ? 'Calculator' : 'Reference'}</strong>
        <button className="btn btn-ghost" onClick={onClose} aria-label="Close"><X size={16} /></button>
      </div>
      <div className="runner-tool-body">
        {panel === 'calculator' ? <GraphCalculator state={graph} onChange={setGraph} /> : <ReferenceSheet />}
      </div>
    </aside>
  )
}
