import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowUpRight,
  Eraser,
  Highlighter,
  ImagePlus,
  MousePointer2,
  PenLine,
  Redo2,
  Shapes,
  Slash,
  Type,
  Undo2,
} from 'lucide-react'
import { INK_COLORS, type InkColor, type InkDash, type InkSize } from '@tittel/board'
import type { BoardTool } from './engine/editor.ts'
import { useBoardValue, useEditor } from './engine/react.ts'

const COLORS: InkColor[] = [
  'black', 'grey', 'red', 'light-red', 'orange', 'yellow', 'green', 'light-green', 'blue', 'light-blue', 'violet', 'light-violet',
]
const SIZES: InkSize[] = ['s', 'm', 'l', 'xl']
const DASHES: InkDash[] = ['solid', 'dashed', 'dotted']

const TOOLS: { id: BoardTool; label: string; icon: ReactNode }[] = [
  { id: 'select', label: 'Select (V)', icon: <MousePointer2 size={16} /> },
  { id: 'draw', label: 'Pen (D)', icon: <PenLine size={16} /> },
  { id: 'highlight', label: 'Highlighter (Shift+D)', icon: <Highlighter size={16} /> },
  { id: 'eraser', label: 'Eraser (E)', icon: <Eraser size={16} /> },
  { id: 'shape-ink', label: 'Shape: draw roughly and it snaps (S)', icon: <Shapes size={16} /> },
  { id: 'line', label: 'Line (L)', icon: <Slash size={16} /> },
  { id: 'arrow', label: 'Arrow (A)', icon: <ArrowUpRight size={16} /> },
  { id: 'text', label: 'Text (T)', icon: <Type size={16} /> },
]

const SIZE_NAMES = { s: 'Fine', m: 'Medium', l: 'Thick', xl: 'Extra thick' }
const SIZE_PX = { s: 3, m: 5, l: 8, xl: 12 }
const DASH_NAMES: Record<InkDash, string> = { solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted' }
const DASH_PATTERN: Record<InkDash, string | undefined> = { solid: undefined, dashed: '7 5', dotted: '0.1 5' }

type Panel = 'color' | 'size' | 'dash'

function DashSample({ dash }: { dash: InkDash }) {
  return (
    <svg width="24" height="16" viewBox="0 0 24 16" aria-hidden="true">
      <line x1="2" y1="8" x2="22" y2="8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeDasharray={DASH_PATTERN[dash]} />
    </svg>
  )
}

// The drawing toolbar, bottom-centre. Panels open in place (no portal), like the
// top bar's.
export function BoardToolbar() {
  const editor = useEditor()
  const state = useBoardValue(editor, () => ({
    tool: editor.getCurrentToolId(),
    ...editor.getDisplayStyle(),
    canUndo: editor.doc.canUndo(),
    canRedo: editor.doc.canRedo(),
  }))
  const [panel, setPanel] = useState<Panel | null>(null)
  const root = useRef<HTMLDivElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!panel) return
    const close = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setPanel(null)
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setPanel(null)
    // Capture phase: the canvas stops pointerdown from bubbling.
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', esc)
    }
  }, [panel])

  const trigger = (id: Panel, label: string, content: ReactNode) => (
    <button
      className={`tool-btn ${panel === id ? 'open' : ''}`}
      aria-label={label}
      aria-expanded={panel === id}
      title={label}
      onClick={() => setPanel((p) => (p === id ? null : id))}
    >
      {content}
    </button>
  )

  return (
    <div
      className="board-toolbar"
      ref={root}
      role="toolbar"
      aria-label="Drawing tools"
      // Any click in the toolbar closes an open panel, except the triggers, which toggle it.
      onClick={(e) => {
        if (!(e.target as Element).closest('[aria-expanded]')) setPanel(null)
      }}
    >
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          className={`tool-btn ${state.tool === tool.id ? 'active' : ''}`}
          aria-label={tool.label}
          aria-pressed={state.tool === tool.id}
          title={tool.label}
          onClick={() => editor.setCurrentTool(tool.id)}
        >
          {tool.icon}
        </button>
      ))}
      <button className="tool-btn" aria-label="Image" title="Add an image" onClick={() => fileInput.current?.click()}>
        <ImagePlus size={16} />
      </button>
      <input
        ref={fileInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          if (files.length) void editor.insertFiles(files)
        }}
      />

      <span className="board-toolbar__sep" />

      <button className="tool-btn" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!state.canUndo} onClick={() => editor.doc.undo()}>
        <Undo2 size={16} />
      </button>
      <button className="tool-btn" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!state.canRedo} onClick={() => editor.doc.redo()}>
        <Redo2 size={16} />
      </button>

      <span className="board-toolbar__sep" />

      {trigger('color', 'Colour', <span className="color-dot" style={{ background: INK_COLORS[state.color].solid }} />)}
      {trigger('size', 'Ink width', <span className="size-dot" style={{ width: SIZE_PX[state.size], height: SIZE_PX[state.size] }} />)}
      {trigger('dash', 'Line style', <DashSample dash={state.dash} />)}

      {panel === 'color' && (
        <div className="board-toolbar__panel colors" role="group" aria-label="Colour">
          {COLORS.map((color) => (
            <button
              key={color}
              className={`tool-btn ${state.color === color ? 'open' : ''}`}
              aria-label={color.replace('-', ' ')}
              aria-pressed={state.color === color}
              title={color.replace('-', ' ')}
              onClick={() => editor.setStyle({ color })}
            >
              <span className="color-dot" style={{ background: INK_COLORS[color].solid }} />
            </button>
          ))}
        </div>
      )}

      {panel === 'size' && (
        <div className="board-toolbar__panel" role="group" aria-label="Ink width">
          {SIZES.map((size) => (
            <button
              key={size}
              className={`tool-btn ${state.size === size ? 'open' : ''}`}
              aria-label={SIZE_NAMES[size]}
              aria-pressed={state.size === size}
              title={SIZE_NAMES[size]}
              onClick={() => editor.setStyle({ size })}
            >
              <span className="size-dot" style={{ width: SIZE_PX[size], height: SIZE_PX[size] }} />
            </button>
          ))}
        </div>
      )}

      {panel === 'dash' && (
        <div className="board-toolbar__panel" role="group" aria-label="Line style">
          {DASHES.map((dash) => (
            <button
              key={dash}
              className={`tool-btn ${state.dash === dash ? 'open' : ''}`}
              aria-label={DASH_NAMES[dash]}
              aria-pressed={state.dash === dash}
              title={DASH_NAMES[dash]}
              onClick={() => editor.setStyle({ dash })}
            >
              <DashSample dash={dash} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
