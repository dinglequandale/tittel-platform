import {
  DefaultColorStyle,
  DefaultDashStyle,
  DefaultSizeStyle,
  getDefaultColorTheme,
  react,
  type Editor,
  type StyleProp,
  type TLDefaultColorStyle,
  type TLDefaultDashStyle,
  type TLDefaultSizeStyle,
  type TLUiOverrides,
} from 'tldraw'
import { BoardLineShapeUtil, ShapeInkTool } from './shapeTool.ts'

// What the board's UI can ask of the drawing engine. The toolbar talks only to
// this module, so moving engines means rewriting this file, not the UI.

export type BoardTool = 'select' | 'draw' | 'highlight' | 'eraser' | 'shape-ink' | 'line' | 'arrow' | 'text'
export type InkDash = 'solid' | 'dashed' | 'dotted'

export const INK_COLORS: TLDefaultColorStyle[] = [
  'black', 'grey', 'red', 'light-red', 'orange', 'yellow', 'green', 'light-green', 'blue', 'light-blue', 'violet', 'light-violet',
]
export const INK_SIZES: TLDefaultSizeStyle[] = ['s', 'm', 'l', 'xl']
export const INK_DASHES: InkDash[] = ['solid', 'dashed', 'dotted']

const palette = getDefaultColorTheme({ isDarkMode: false })

export function inkColorValue(color: TLDefaultColorStyle) {
  return palette[color].solid
}

// Handed to <Tldraw>; module-level so tldraw never sees a new array.
export const boardCustomTools = [ShapeInkTool]
export const boardShapeUtils = [BoardLineShapeUtil]

// The tools keep their usual keys and the ones without a toolbar button lose
// theirs. `hand` stays for locked students, `asset` for Ctrl+U.
const KEYBOARD_TOOLS = ['select', 'hand', 'draw', 'highlight', 'eraser', 'line', 'arrow', 'text', 'asset']

export const boardUiOverrides: TLUiOverrides = {
  tools(editor, tools) {
    const kept = Object.fromEntries(KEYBOARD_TOOLS.map((id) => [id, tools[id]]))
    return {
      ...kept,
      'shape-ink': {
        id: 'shape-ink',
        label: 'Shape',
        icon: 'geo-rectangle',
        kbd: 's',
        onSelect: () => editor.setCurrentTool('shape-ink'),
      },
    }
  },
}

/**
 * tldraw's `draw` dash is its pressure-sensitive ink, and its `solid` is a flat
 * uniform stroke. Both are "solid" to a tutor: pens get the ink, and everything
 * else (where `draw` would be a wobble) gets the clean line.
 */
function engineDash(dash: InkDash, tool: string): TLDefaultDashStyle {
  return dash === 'solid' && (tool === 'draw' || tool === 'shape-ink') ? 'draw' : dash
}

function inkDash(dash: TLDefaultDashStyle): InkDash {
  return dash === 'draw' ? 'solid' : dash
}

/** Keeps the dash in step with the tool, whichever way the tool was chosen (button or key). */
export function keepDashInStep(editor: Editor) {
  return react('board dash', () => {
    const current = editor.getStyleForNextShape(DefaultDashStyle)
    const wanted = engineDash(inkDash(current), editor.getCurrentToolId())
    if (wanted !== current) editor.setStyleForNextShapes(DefaultDashStyle, wanted)
  })
}

function currentStyle<T>(editor: Editor, style: StyleProp<T>): T {
  const shared = editor.getSharedStyles().get(style)
  return shared?.type === 'shared' ? shared.value : editor.getStyleForNextShape(style)
}

export function readToolbar(editor: Editor) {
  return {
    tool: editor.getCurrentToolId(),
    color: currentStyle(editor, DefaultColorStyle),
    size: currentStyle(editor, DefaultSizeStyle),
    dash: inkDash(currentStyle(editor, DefaultDashStyle)),
    canUndo: editor.getCanUndo(),
    canRedo: editor.getCanRedo(),
  }
}

export function setTool(editor: Editor, tool: BoardTool) {
  editor.setCurrentTool(tool)
}

function applyStyle<T>(editor: Editor, style: StyleProp<T>, forSelection: T, forNext: T) {
  editor.run(() => {
    if (editor.isIn('select') && editor.getSelectedShapeIds().length > 0) {
      editor.markHistoryStoppingPoint('set style')
      editor.setStyleForSelectedShapes(style, forSelection)
    }
    editor.setStyleForNextShapes(style, forNext)
  })
}

export function setColor(editor: Editor, color: TLDefaultColorStyle) {
  applyStyle(editor, DefaultColorStyle, color, color)
}

export function setSize(editor: Editor, size: TLDefaultSizeStyle) {
  applyStyle(editor, DefaultSizeStyle, size, size)
}

export function setDash(editor: Editor, dash: InkDash) {
  applyStyle(editor, DefaultDashStyle, dash, engineDash(dash, editor.getCurrentToolId()))
}

export function undo(editor: Editor) {
  editor.undo()
}

export function redo(editor: Editor) {
  editor.redo()
}
